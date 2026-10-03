import { describe, expect, it } from "vitest";
import {
  compilePolicy,
  ENGINE_VERSION,
  priceRequest,
  REFERENCE_REQUEST,
  TIER_CONTEXT_TARGET,
  TIER_COST_TARGET_USD,
} from "@/lib/engine";
import type { Agent, AgentLane, CatalogModel, Tier } from "@/lib/types";
import { TIERS } from "@/lib/types";

function model(overrides: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    provider: overrides.id.split(":")[0] ?? "openai",
    providerLabel: "Test Provider",
    model: overrides.id.split(":")[1] ?? "test",
    name: overrides.id,
    inputPerMTok: 1,
    outputPerMTok: 4,
    contextTokens: 200_000,
    maxOutputTokens: 16_000,
    capabilities: ["tools", "json"],
    releaseDate: "2026-01-01",
    openWeights: false,
    upstreamIds: {},
    ...overrides,
  };
}

function lane(tier: Tier, modelId: string | null, weight: number): AgentLane {
  return { tier, modelId, modelLabel: null, provider: null, weight, dailyRequests: 1000 };
}

function agent(lanes: AgentLane[], overrides: Partial<Agent> = {}): Agent {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    ownerId: "anon_test",
    name: "test-agent",
    taskClass: "Test task class for the compiler",
    notes: "",
    status: "draft",
    budgetUsd: 500,
    lanes,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    deletedAt: null,
    seal: "a".repeat(96),
    revision: 1,
    ...overrides,
  };
}

const FULL_MODELS: CatalogModel[] = [
  model({ id: "openai:cheap", inputPerMTok: 0.1, outputPerMTok: 0.3, contextTokens: 128_000 }),
  model({ id: "anthropic:mid", inputPerMTok: 3, outputPerMTok: 15, contextTokens: 200_000, openWeights: false }),
  model({ id: "meta:frontier", inputPerMTok: 5, outputPerMTok: 25, contextTokens: 1_000_000, openWeights: true }),
];

const FIXED_TIME = "2026-10-01T12:00:00.000Z";

function compile(target: Agent, models: CatalogModel[] = FULL_MODELS, dailyRequests?: number) {
  return compilePolicy({
    agent: target,
    models,
    dailyRequests,
    actor: "test",
    computedAt: FIXED_TIME,
  });
}

describe("priceRequest", () => {
  it("prices a request from per-million-token rates", () => {
    const cost = priceRequest(1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(REFERENCE_REQUEST.inputTokens + REFERENCE_REQUEST.outputTokens, 6);
  });

  it("returns zero for a free model", () => {
    expect(priceRequest(0, 0)).toBe(0);
  });

  it("is proportional to output token count", () => {
    const cheap = priceRequest(0, 1_000_000);
    const pricier = priceRequest(0, 2_000_000);
    expect(pricier).toBeCloseTo(cheap * 2, 8);
  });
});

describe("compilePolicy — shape and versioning", () => {
  it("returns the versioned engine id", () => {
    const result = compile(
      agent([lane("fast", "openai:cheap", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)]),
    );
    expect(result.engineVersion).toBe(ENGINE_VERSION);
  });

  it("returns seven itemized factors with weights summing to one", () => {
    const result = compile(
      agent([lane("fast", "openai:cheap", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)]),
    );
    expect(result.factors).toHaveLength(7);
    const total = result.factors.reduce((sum, factor) => sum + factor.weight, 0);
    expect(total).toBeCloseTo(1, 6);
    for (const factor of result.factors) {
      expect(factor.normalized).toBeGreaterThanOrEqual(0);
      expect(factor.normalized).toBeLessThanOrEqual(1);
      expect(factor.contribution).toBeCloseTo(factor.normalized * factor.weight * 100, 3);
      expect(factor.detail.length).toBeGreaterThan(0);
    }
  });

  it("keeps the score equal to the sum of contributions", () => {
    const result = compile(
      agent([lane("fast", "openai:cheap", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)]),
    );
    const summed = result.factors.reduce((sum, factor) => sum + factor.contribution, 0);
    expect(result.score).toBeCloseTo(summed, 1);
  });

  it("returns a verdict in the allowed set with a reason", () => {
    const result = compile(
      agent([lane("fast", "openai:cheap", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)]),
    );
    expect(["ship", "tune", "rework"]).toContain(result.verdict);
    expect(result.verdictReason.length).toBeGreaterThan(10);
  });

  it("recommends one entry per tier", () => {
    const result = compile(
      agent([lane("fast", "openai:cheap", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)]),
    );
    expect(result.recommendation.map((entry) => entry.tier)).toEqual([...TIERS]);
    for (const entry of result.recommendation) expect(entry.reason.length).toBeGreaterThan(5);
  });

  it("returns a seal that changes when the score changes", () => {
    const good = compile(
      agent([lane("fast", "openai:cheap", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)]),
    );
    const bad = compile(
      agent([lane("fast", "openai:cheap", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)], { budgetUsd: 1 }),
    );
    expect(good.seal).toMatch(/^[0-9a-f]{96}$/);
    expect(good.seal).not.toBe(bad.seal);
  });
});

describe("compilePolicy — determinism", () => {
  it("is byte-identical across repeated runs with the same input", () => {
    const target = agent([
      lane("fast", "openai:cheap", 0.5),
      lane("balanced", "anthropic:mid", 0.3),
      lane("deep", "meta:frontier", 0.2),
    ]);
    expect(JSON.stringify(compile(target))).toBe(JSON.stringify(compile(target)));
  });

  it("does not depend on lane array order", () => {
    const ordered = agent([
      lane("fast", "openai:cheap", 0.6),
      lane("balanced", "anthropic:mid", 0.3),
      lane("deep", "meta:frontier", 0.1),
    ]);
    const shuffled = agent([
      lane("deep", "meta:frontier", 0.1),
      lane("fast", "openai:cheap", 0.6),
      lane("balanced", "anthropic:mid", 0.3),
    ]);
    expect(compile(ordered).score).toBe(compile(shuffled).score);
  });
});

describe("compilePolicy — boundary and empty cases", () => {
  it("scores an all-empty board at zero coverage and forces rework", () => {
    const result = compile(agent([lane("fast", null, 0.6), lane("balanced", null, 0.3), lane("deep", null, 0.1)]));
    expect(result.verdict).toBe("rework");
    expect(result.score).toBe(0);
    expect(result.projectedMonthlyUsd).toBe(0);
    expect(result.warnings.some((warning) => /empty/i.test(warning))).toBe(true);
    for (const entry of result.recommendation) {
      expect(entry.modelId).toBeNull();
      expect(entry.reason).toMatch(/Patch one/);
    }
  });

  it("never throws on an empty lane list", () => {
    const result = compile(agent([]));
    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(7);
  });

  it("handles a zero budget without dividing by zero", () => {
    const result = compile(
      agent([lane("fast", "openai:cheap", 1), lane("balanced", null, 0), lane("deep", null, 0)], { budgetUsd: 0 }),
    );
    const headroom = result.factors.find((factor) => factor.key === "headroom")!;
    expect(Number.isFinite(headroom.normalized)).toBe(true);
    expect(headroom.normalized).toBe(0);
  });

  it("handles zero weights on every lane", () => {
    const result = compile(agent([lane("fast", "openai:cheap", 0), lane("balanced", "anthropic:mid", 0), lane("deep", "meta:frontier", 0)]));
    const balance = result.factors.find((factor) => factor.key === "balance")!;
    expect(Number.isFinite(balance.normalized)).toBe(true);
  });
});

describe("compilePolicy — malformed and missing input", () => {
  it("warns and skips a lane pointing at a model outside the snapshot", () => {
    const result = compile(
      agent([lane("fast", "ghost:model", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)]),
    );
    expect(result.warnings.some((warning) => /ghost:model/.test(warning))).toBe(true);
    expect(result.recommendation.find((entry) => entry.tier === "fast")?.modelId).toBeNull();
  });

  it("survives an empty model snapshot", () => {
    const result = compile(agent([lane("fast", "openai:cheap", 1)]), []);
    expect(result.score).toBe(0);
    expect(result.blendedInputPerMTok).toBe(0);
  });

  it("treats negative price values as data, not as an error", () => {
    const weird = [model({ id: "weird:model", inputPerMTok: -5, outputPerMTok: -1 })];
    const result = compile(agent([lane("fast", "weird:model", 1)]), weird);
    expect(Number.isFinite(result.score)).toBe(true);
  });
});

describe("compilePolicy — behavioural signals", () => {
  it("rewards covering every lane over a partial board", () => {
    const partial = compile(agent([lane("fast", "openai:cheap", 1), lane("balanced", null, 0), lane("deep", null, 0)]));
    const full = compile(
      agent([lane("fast", "openai:cheap", 0.6), lane("balanced", "anthropic:mid", 0.3), lane("deep", "meta:frontier", 0.1)]),
    );
    expect(full.score).toBeGreaterThan(partial.score);
    expect(full.verdict).not.toBe("rework");
  });

  it("penalises concentrating all traffic on one lane", () => {
    const concentrated = compile(
      agent([lane("fast", "openai:cheap", 1), lane("balanced", "anthropic:mid", 0), lane("deep", "meta:frontier", 0)]),
    );
    const spread = compile(
      agent([lane("fast", "openai:cheap", 0.34), lane("balanced", "anthropic:mid", 0.33), lane("deep", "meta:frontier", 0.33)]),
    );
    const concentratedBalance = concentrated.factors.find((factor) => factor.key === "balance")!;
    const spreadBalance = spread.factors.find((factor) => factor.key === "balance")!;
    expect(spreadBalance.normalized).toBeGreaterThan(concentratedBalance.normalized);
    expect(concentrated.warnings.some((warning) => /concentrated/i.test(warning))).toBe(true);
  });

  it("rewards more than one provider behind the lanes", () => {
    const singleProvider = compile(
      agent([lane("fast", "openai:cheap", 0.34), lane("balanced", "anthropic:mid", 0.33), lane("deep", "meta:frontier", 0.33)]),
    );
    const sameProvider = [
      model({ id: "openai:a", inputPerMTok: 0.1, outputPerMTok: 0.3 }),
      model({ id: "openai:b", inputPerMTok: 0.2, outputPerMTok: 0.4 }),
      model({ id: "openai:c", inputPerMTok: 0.3, outputPerMTok: 0.5 }),
    ];
    const same = compile(
      agent([lane("fast", "openai:a", 0.34), lane("balanced", "openai:b", 0.33), lane("deep", "openai:c", 0.33)]),
      sameProvider,
    );
    const multi = singleProvider.factors.find((factor) => factor.key === "redundancy")!;
    const mono = same.factors.find((factor) => factor.key === "redundancy")!;
    expect(multi.normalized).toBeGreaterThan(mono.normalized);
  });

  it("scores cheaper models above expensive ones for the same shape", () => {
    const cheap = [
      model({ id: "p:cheap", inputPerMTok: 0.05, outputPerMTok: 0.1, contextTokens: 1_000_000, openWeights: true }),
    ];
    const pricey = [model({ id: "p:pricey", inputPerMTok: 15, outputPerMTok: 75, contextTokens: 1_000_000, openWeights: true })];
    const cheapResult = compile(agent([lane("fast", "p:cheap", 1), lane("balanced", null, 0), lane("deep", null, 0)]), cheap);
    const priceyResult = compile(agent([lane("fast", "p:pricey", 1), lane("balanced", null, 0), lane("deep", null, 0)]), pricey);
    const cheapCost = cheapResult.factors.find((factor) => factor.key === "cost")!;
    const priceyCost = priceyResult.factors.find((factor) => factor.key === "cost")!;
    expect(cheapCost.normalized).toBeGreaterThan(priceyCost.normalized);
  });

  it("flags a model whose context is below its lane target", () => {
    const small = [model({ id: "p:small", contextTokens: 8_000 })];
    const result = compile(
      agent([lane("deep", "p:small", 1), lane("fast", null, 0), lane("balanced", null, 0)]),
      small,
    );
    expect(result.warnings.some((warning) => /below the/.test(warning))).toBe(true);
    expect(TIER_CONTEXT_TARGET.deep).toBe(200_000);
  });

  it("warns when the projection exceeds the ceiling", () => {
    const expensive = [model({ id: "p:big", inputPerMTok: 20, outputPerMTok: 100 })];
    const result = compile(
      agent([lane("fast", "p:big", 1), lane("balanced", null, 0), lane("deep", null, 0)], { budgetUsd: 5 }),
      expensive,
      500_000,
    );
    expect(result.projectedMonthlyUsd).toBeGreaterThan(5);
    expect(result.warnings.some((warning) => /exceeds/.test(warning))).toBe(true);
    expect(TIER_COST_TARGET_USD.fast).toBeGreaterThan(0);
  });

  it("scales the monthly projection linearly with request volume", () => {
    const target = agent([lane("fast", "openai:cheap", 1), lane("balanced", null, 0), lane("deep", null, 0)]);
    const low = compile(target, FULL_MODELS, 1000);
    const high = compile(target, FULL_MODELS, 2000);
    expect(high.projectedMonthlyUsd).toBeCloseTo(low.projectedMonthlyUsd * 2, 3);
  });

  it("rewards open-weight models on the mobility factor", () => {
    const open = compile(agent([lane("fast", "meta:frontier", 1), lane("balanced", null, 0), lane("deep", null, 0)]));
    const mobility = open.factors.find((factor) => factor.key === "mobility")!;
    expect(mobility.normalized).toBe(1);
  });

  it("keeps every score inside 0..100", () => {
    const variants: Agent[] = [
      agent([lane("fast", "openai:cheap", 1), lane("balanced", "anthropic:mid", 1), lane("deep", "meta:frontier", 1)]),
      agent([lane("fast", "meta:frontier", 0.01), lane("balanced", "meta:frontier", 0.01), lane("deep", "meta:frontier", 0.01)]),
      agent([lane("fast", null, 0.5), lane("balanced", null, 0.5), lane("deep", null, 0)]),
    ];
    for (const variant of variants) {
      const result = compile(variant);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });
});