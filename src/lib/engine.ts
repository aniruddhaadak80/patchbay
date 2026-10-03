/**
 * Policy Compiler v1.0.0
 *
 * A deterministic, explainable router-quality score for an agent's lane
 * assignment. The same function is used by the UI, the REST endpoint, and the
 * MCP `compile_policy` tool. No randomness, no clock input, no I/O: the only
 * variable inputs are the agent's lanes and the resolved catalog models.
 *
 * Seven weighted factors:
 *   cost        0.24  blended $/request efficiency against a per-tier budget
 *   coverage    0.18  every tier has a patched model and required capabilities
 *   balance     0.16  lane weights are spread, not concentrated on one lane
 *   headroom    0.14  budget headroom for growth
 *   context     0.12  patched models' context windows match tier expectations
 *   redundancy  0.10  more than one provider behind the lanes
 *   mobility    0.06  open-weight models are easier to self-host later
 *
 * Score = round(100 * sum(normalized_i * weight_i)), 1 decimal.
 */

import type { Agent, AgentLane, CatalogModel, EngineResult, Factor, Tier } from "./types";
import { TIER_META } from "./types";
import { sealEvent, GENESIS_SEAL } from "./seal";

export const ENGINE_VERSION = "policy-compiler@1.0.0";

/** USD per request the compiler considers acceptable at each tier. */
export const TIER_COST_TARGET_USD: Record<Tier, number> = {
  fast: 0.0008,
  balanced: 0.004,
  deep: 0.03,
};

/** Minimum context window a lane should expose for its tier. */
export const TIER_CONTEXT_TARGET: Record<Tier, number> = {
  fast: 32_000,
  balanced: 128_000,
  deep: 200_000,
};

const WEIGHTS = {
  cost: 0.24,
  coverage: 0.18,
  balance: 0.16,
  headroom: 0.14,
  context: 0.12,
  redundancy: 0.1,
  mobility: 0.06,
} as const;

/** Reference request shape used to price a lane. Blended input/output tokens. */
export const REFERENCE_REQUEST = { inputTokens: 1800, outputTokens: 700 } as const;

export function priceRequest(inputPerMTok: number, outputPerMTok: number): number {
  const input = (REFERENCE_REQUEST.inputTokens / 1_000_000) * inputPerMTok;
  const output = (REFERENCE_REQUEST.outputTokens / 1_000_000) * outputPerMTok;
  return input + output;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface CompileInput {
  agent: Pick<Agent, "id" | "name" | "budgetUsd" | "lanes">;
  models: readonly CatalogModel[];
  /** Daily request volume used for monthly projection. Defaults to 2000. */
  dailyRequests?: number;
  actor?: string;
  /** Injected so a compiled result is byte-reproducible in tests. */
  computedAt?: string;
}

export function compilePolicy(input: CompileInput): EngineResult {
  const { agent, models } = input;
  const dailyRequests = input.dailyRequests ?? 2000;
  const computedAt = input.computedAt ?? new Date().toISOString();
  const byId = new Map(models.map((model) => [model.id, model]));

  const resolved = agent.lanes.map((lane) => ({
    lane,
    model: lane.modelId ? (byId.get(lane.modelId) ?? null) : null,
  }));

  const warnings: string[] = [];

  // --- cost ---------------------------------------------------------------
  // Each lane is priced at its own reference request; the fleet cost is the
  // weighted mean across patched lanes only.
  const patched = resolved.filter((entry) => entry.model !== null);
  const perLaneCost = new Map<Tier, number>();
  for (const entry of patched) {
    perLaneCost.set(
      entry.lane.tier,
      priceRequest(entry.model!.inputPerMTok, entry.model!.outputPerMTok),
    );
  }

  const totalWeight = patched.reduce((sum, entry) => sum + Math.max(0, entry.lane.weight), 0);
  const costRatio =
    totalWeight > 0
      ? patched.reduce((sum, entry) => {
          const w = Math.max(0, entry.lane.weight);
          return sum + w * perLaneCost.get(entry.lane.tier)!;
        }, 0) / totalWeight
      : 0;

  // costRatio is dollars-per-request; map onto the mean of tier targets.
  const meanTarget =
    (TIER_COST_TARGET_USD.fast + TIER_COST_TARGET_USD.balanced + TIER_COST_TARGET_USD.deep) / 3;
  const costNormalized = patched.length === 0 ? 0 : clamp01(1 - costRatio / (meanTarget * 2));
  const costDetail =
    patched.length === 0
      ? "No lane is patched, so there is nothing to price."
      : `Blended $${round(costRatio, 6)} per reference request against a $${round(meanTarget * 2, 6)} allowance ceiling.`;

  // --- coverage -----------------------------------------------------------
  const patchedTiers = new Set(resolved.filter((e) => e.model !== null).map((e) => e.lane.tier));
  const hasLanes = agent.lanes.length > 0;
  const allTiersCovered = hasLanes && agent.lanes.every((lane) => patchedTiers.has(lane.tier));
  const unknownRefs = resolved.filter((e) => e.lane.modelId !== null && e.model === null);
  const coverageNormalized = patchedTiers.size === 0
    ? 0
    : allTiersCovered
      ? 1
      : patchedTiers.size / agent.lanes.length;
  for (const entry of unknownRefs) {
    warnings.push(
      `Lane ${entry.lane.tier} points at ${entry.lane.modelId}, which is not in the current catalog snapshot and was skipped.`,
    );
  }
  if (!allTiersCovered) {
    warnings.push("At least one tier lane is empty, so traffic on that tier has no destination.");
  }

  // --- balance ------------------------------------------------------------
  // Shannon entropy of lane weights (uniform across three lanes = 1.0, all on
  // one = 0.0), scaled by the coverage fraction. Without that scaling, a board
  // with a single patched lane would score perfect balance while two thirds of
  // its traffic has nowhere to go.
  let balanceNormalized = 0;
  if (totalWeight > 0 && patched.length > 0) {
    let entropy = 0;
    for (const entry of patched) {
      const share = Math.max(0, entry.lane.weight) / totalWeight;
      if (share > 0) entropy -= share * Math.log(share);
    }
    const maxEntropy = Math.log(patched.length || 1);
    const spread = maxEntropy > 0 ? clamp01(entropy / maxEntropy) : 1;
    const coverageShare = agent.lanes.length > 0 ? patched.length / agent.lanes.length : 0;
    balanceNormalized = clamp01(spread * coverageShare);
    if (balanceNormalized < 0.34) {
      warnings.push(
        "Traffic is concentrated on one lane; a single provider outage would take down the agent.",
      );
    }
  }

  // --- headroom ------------------------------------------------------------
  // Projected monthly spend against the declared ceiling.
  const projectedMonthlyUsd = round(costRatio * dailyRequests * 30, 4);
  // An empty board spends nothing, which must not read as perfect headroom.
  const headroomNormalized =
    patched.length === 0 || agent.budgetUsd <= 0
      ? 0
      : clamp01(1 - projectedMonthlyUsd / agent.budgetUsd);
  if (agent.budgetUsd > 0 && projectedMonthlyUsd > agent.budgetUsd) {
    warnings.push(
      `Projected $${projectedMonthlyUsd.toFixed(2)}/month exceeds the $${agent.budgetUsd.toFixed(2)} ceiling at ${dailyRequests} requests/day.`,
    );
  }

  // --- context -------------------------------------------------------------
  let contextHit = 0;
  let contextTotal = 0;
  for (const entry of patched) {
    contextTotal += 1;
    if (entry.model!.contextTokens >= TIER_CONTEXT_TARGET[entry.lane.tier]) contextHit += 1;
    if (entry.model!.contextTokens < TIER_CONTEXT_TARGET[entry.lane.tier]) {
      warnings.push(
        `${entry.model!.name} gives ${entry.model!.contextTokens.toLocaleString("en-US")} context on the ${entry.lane.tier} lane, below the ${TIER_CONTEXT_TARGET[entry.lane.tier].toLocaleString("en-US")} target for that tier.`,
      );
    }
  }
  const contextNormalized = contextTotal === 0 ? 0 : contextHit / contextTotal;

  // --- redundancy ----------------------------------------------------------
  const providers = new Set(patched.map((entry) => entry.model!.provider));
  const redundancyNormalized =
    providers.size >= 3 ? 1 : providers.size === 2 ? 0.7 : providers.size === 1 ? 0.25 : 0;

  // --- mobility ------------------------------------------------------------
  const openCount = patched.filter((entry) => entry.model!.openWeights).length;
  const mobilityNormalized = patched.length === 0 ? 0 : openCount / patched.length;

  // Contribution is derived from the already-rounded normalized value so that
  // `contribution === normalized * weight * 100` holds exactly for consumers
  // reading the itemized factors, and so the score sums back precisely.
  const factor = (
    key: string,
    label: string,
    value: number,
    normalizedValue: number,
    weight: number,
    unit: string,
    detail: string,
  ): Factor => {
    const normalized = round(clamp01(normalizedValue), 4);
    return {
      key,
      label,
      value,
      normalized,
      weight,
      contribution: round(normalized * weight * 100, 4),
      unit,
      detail,
    };
  };

  const factors: Factor[] = [
    factor("cost", "Cost efficiency", round(costRatio, 6), costNormalized, WEIGHTS.cost, "USD/request", costDetail),
    factor(
      "coverage",
      "Tier coverage",
      patchedTiers.size,
      coverageNormalized,
      WEIGHTS.coverage,
      "tiers patched",
      allTiersCovered
        ? "Every tier lane has a destination model."
        : `${patchedTiers.size} of ${agent.lanes.length} tier lanes are patched.`,
    ),
    factor(
      "balance",
      "Lane balance",
      round(totalWeight, 4),
      balanceNormalized,
      WEIGHTS.balance,
      "weight entropy",
      patched.length === 0
        ? "No weights to compare."
        : `Weight spread ${round(balanceNormalized, 3)} across ${patched.length} of ${agent.lanes.length} lanes.`,
    ),
    factor(
      "headroom",
      "Budget headroom",
      projectedMonthlyUsd,
      headroomNormalized,
      WEIGHTS.headroom,
      "USD/month",
      patched.length === 0
        ? "No patched lane, so there is no spend to compare against the ceiling."
        : `Projected $${projectedMonthlyUsd.toFixed(2)}/month against a $${agent.budgetUsd.toFixed(2)} ceiling.`,
    ),
    factor(
      "context",
      "Context fit",
      contextHit,
      contextNormalized,
      WEIGHTS.context,
      "lanes meeting tier target",
      contextTotal === 0
        ? "No patched lanes to check."
        : `${contextHit} of ${contextTotal} patched lanes meet their tier context target.`,
    ),
    factor(
      "redundancy",
      "Provider redundancy",
      providers.size,
      redundancyNormalized,
      WEIGHTS.redundancy,
      "distinct providers",
      providers.size === 0
        ? "No providers behind the lanes."
        : `${providers.size} distinct provider(s): ${[...providers].sort().join(", ")}.`,
    ),
    factor(
      "mobility",
      "Self-host mobility",
      openCount,
      mobilityNormalized,
      WEIGHTS.mobility,
      "open-weight models",
      patched.length === 0
        ? "No patched lanes."
        : `${openCount} of ${patched.length} patched models publish open weights.`,
    ),
  ];

  const score = round(
    factors.reduce((sum, factor) => sum + factor.contribution, 0),
    1,
  );

  const verdict: EngineResult["verdict"] =
    !allTiersCovered ? "rework" : score >= 78 ? "ship" : score >= 58 ? "tune" : "rework";

  const weakest = [...factors].sort(
    (a, b) => a.normalized * a.weight - b.normalized * b.weight,
  )[0];

  const verdictReason =
    verdict === "ship"
      ? `Weighted score ${score} clears the 78 ship threshold with no empty lane.`
      : verdict === "tune"
        ? `Weighted score ${score} is workable but ${weakest.label.toLowerCase()} is the weakest factor.`
        : allTiersCovered
          ? `Weighted score ${score} is below the 58 tune threshold; ${weakest.label.toLowerCase()} drags the policy down.`
          : "An empty tier lane makes this policy unroutable regardless of price.";

  const recommendation: EngineResult["recommendation"] = agent.lanes
    .filter((lane): lane is AgentLane => lane !== undefined)
    .map((lane) => {
      const model = lane.modelId ? byId.get(lane.modelId) : undefined;
      if (!model) {
        return {
          tier: lane.tier,
          modelId: null,
          reason: `No model is patched on the ${TIER_META[lane.tier].label.toLowerCase()}. Patch one before this agent can route traffic.`,
        };
      }
      return {
        tier: lane.tier,
        modelId: model.id,
        reason: `$${priceRequest(model.inputPerMTok, model.outputPerMTok).toFixed(6)} per reference request, ${model.contextTokens.toLocaleString("en-US")} context, ${model.providerLabel}.`,
      };
    });

  const blendedInputPerMTok =
    patched.length === 0
      ? 0
      : round(
          patched.reduce((sum, entry) => sum + entry.model!.inputPerMTok, 0) / patched.length,
          4,
        );
  const blendedOutputPerMTok =
    patched.length === 0
      ? 0
      : round(
          patched.reduce((sum, entry) => sum + entry.model!.outputPerMTok, 0) / patched.length,
          4,
        );

  const result: Omit<EngineResult, "seal"> = {
    engineVersion: ENGINE_VERSION,
    score,
    verdict,
    verdictReason,
    factors,
    projectedMonthlyUsd,
    projectedPerRequestUsd: round(costRatio, 8),
    blendedInputPerMTok,
    blendedOutputPerMTok,
    recommendation,
    warnings,
    computedAt,
  };

  const seal = sealEvent(GENESIS_SEAL, {
    seq: 1,
    eventType: "compiled",
    entityId: agent.id,
    actor: input.actor ?? "compiler",
    payload: {
      engineVersion: ENGINE_VERSION,
      score,
      verdict,
      projectedMonthlyUsd,
      lanes: agent.lanes.map((lane) => ({ tier: lane.tier, modelId: lane.modelId, weight: lane.weight })),
    },
    createdAt: computedAt,
  });

  return { ...result, seal };
}