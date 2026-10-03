/**
 * The portable artifact: a routing manifest containing lanes, the compiled
 * score, itemized factors, the seal, and catalog provenance. Shared by the
 * download endpoint, the export page, the share view, and the MCP export tool.
 */

import type { Agent, CatalogModel, EngineResult, SourceStatus } from "./types";
import { compilePolicy } from "./engine";

export interface RoutingManifest {
  manifestVersion: string;
  generator: string;
  exportedAt: string;
  agent: {
    id: string;
    name: string;
    taskClass: string;
    budgetUsdMonthly: number;
    revision: number;
    seal: string;
    createdAt: string;
    updatedAt: string;
    lanes: Agent["lanes"];
  };
  compiled: {
    engineVersion: string;
    score: number;
    verdict: EngineResult["verdict"];
    verdictReason: string;
    projectedMonthlyUsd: number;
    projectedPerRequestUsd: number;
    blendedInputPerMTok: number;
    blendedOutputPerMTok: number;
    factors: EngineResult["factors"];
    recommendation: EngineResult["recommendation"];
    warnings: string[];
    computedAt: string;
    seal: string;
  };
  provenance: {
    catalogStatus: string;
    catalogFetchedAt: string;
    sources: SourceStatus[];
  };
  integrity: {
    algorithm: string;
    genesisSeal: string;
    agentSeal: string;
    compileSeal: string;
    replayEndpoint: string;
  };
}

export function buildManifest(
  agent: Agent,
  compiled: EngineResult,
  catalogStatus: string,
  catalogFetchedAt: string,
  sources: SourceStatus[],
  /** Injected so a client-rendered manifest hydrates identically. */
  exportedAt: string = new Date().toISOString(),
): RoutingManifest {
  return {
    manifestVersion: "1.0",
    generator: `patchbay ${compiled.engineVersion}`,
    exportedAt,
    agent: {
      id: agent.id,
      name: agent.name,
      taskClass: agent.taskClass,
      budgetUsdMonthly: agent.budgetUsd,
      revision: agent.revision,
      seal: agent.seal,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      lanes: agent.lanes,
    },
    compiled: {
      engineVersion: compiled.engineVersion,
      score: compiled.score,
      verdict: compiled.verdict,
      verdictReason: compiled.verdictReason,
      projectedMonthlyUsd: compiled.projectedMonthlyUsd,
      projectedPerRequestUsd: compiled.projectedPerRequestUsd,
      blendedInputPerMTok: compiled.blendedInputPerMTok,
      blendedOutputPerMTok: compiled.blendedOutputPerMTok,
      factors: compiled.factors,
      recommendation: compiled.recommendation,
      warnings: compiled.warnings,
      computedAt: compiled.computedAt,
      seal: compiled.seal,
    },
    provenance: {
      catalogStatus,
      catalogFetchedAt,
      sources,
    },
    integrity: {
      algorithm: "seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )",
      genesisSeal: "0".repeat(96),
      agentSeal: agent.seal,
      compileSeal: compiled.seal,
      replayEndpoint: "/api/verify?agentId=" + agent.id,
    },
  };
}

/** Resolve lanes against the current snapshot and compile in one step. */
export function compileFor(
  agent: Agent,
  models: CatalogModel[],
  actor: string,
): { compiled: EngineResult; lanes: Agent["lanes"] } {
  const byId = new Map(models.map((model) => [model.id, model]));
  const lanes = agent.lanes.map((lane) => {
    const model = lane.modelId ? byId.get(lane.modelId) : undefined;
    return {
      ...lane,
      modelLabel: model?.name ?? null,
      provider: model?.provider ?? null,
    };
  });
  const compiled = compilePolicy({ agent: { ...agent, lanes }, models, actor });
  return { compiled, lanes };
}