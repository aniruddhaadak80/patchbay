/**
 * Normalized domain and external-data types.
 *
 * Every external payload (OpenRouter, models.dev) is mapped into `CatalogModel`
 * before it reaches the UI, the engine, or the database, so upstream schema
 * drift cannot leak into product logic.
 */

export type Tier = "fast" | "balanced" | "deep";

export const TIERS: readonly Tier[] = ["fast", "balanced", "deep"] as const;

export const TIER_META: Record<Tier, { label: string; blurb: string; maxLatencyMs: number }> = {
  fast: {
    label: "Fast lane",
    blurb: "Cheap, high-volume classification, extraction, and short tool loops.",
    maxLatencyMs: 4000,
  },
  balanced: {
    label: "Balanced lane",
    blurb: "Default lane for everyday reasoning and multi-step agent work.",
    maxLatencyMs: 20000,
  },
  deep: {
    label: "Deep lane",
    blurb: "Expensive frontier models for planning, long context, and hard reasoning.",
    maxLatencyMs: 120000,
  },
};

export type Capability = "tools" | "reasoning" | "vision" | "json" | "longContext";

export const CAPABILITIES: readonly Capability[] = [
  "tools",
  "reasoning",
  "vision",
  "json",
  "longContext",
] as const;

export type DataSourceId = "openrouter" | "modelsdev";

export interface SourceStatus {
  id: DataSourceId;
  name: string;
  homepage: string;
  /** "live" when this run fetched upstream, "fallback" when the sealed sample was used. */
  status: "live" | "fallback" | "stale";
  fetchedAt: string;
  itemCount: number;
  latencyMs: number;
  /** Upstream record identifier for the newest model, proving provenance. */
  sampleUpstreamId: string;
  error?: string;
}

export interface CatalogModel {
  /** Stable Patchbay id: `${provider}:${model}`. */
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  name: string;
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  contextTokens: number;
  maxOutputTokens: number;
  capabilities: Capability[];
  releaseDate: string | null;
  openWeights: boolean;
  upstreamIds: { openrouter?: string; modelsdev?: string };
}

export interface CatalogSnapshot {
  status: "live" | "fallback";
  fetchedAt: string;
  sources: SourceStatus[];
  models: CatalogModel[];
  /** Number of upstream records seen before normalization, for honesty about merging. */
  upstreamRecords: number;
}

export type AgentStatus = "draft" | "active" | "paused" | "archived";

export const AGENT_STATUSES: readonly AgentStatus[] = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;

export interface AgentLane {
  tier: Tier;
  /** Catalog model id patched into this lane, or null when the jack is empty. */
  modelId: string | null;
  modelLabel: string | null;
  provider: string | null;
  /** Share of traffic sent to this lane, 0..1. Lanes may sum to less than 1. */
  weight: number;
  /** Daily requests expected on this lane. */
  dailyRequests: number;
}

export interface Agent {
  id: string;
  ownerId: string;
  name: string;
  taskClass: string;
  notes: string;
  status: AgentStatus;
  /** Monthly spend ceiling in USD. */
  budgetUsd: number;
  lanes: AgentLane[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  seal: string;
  revision: number;
}

export interface Factor {
  key: string;
  label: string;
  /** Raw measurement before normalization. */
  value: number;
  /** 0..1 normalized sub-score. */
  normalized: number;
  weight: number;
  /** normalized * weight * 100, rounded to 4 decimals. */
  contribution: number;
  unit: string;
  detail: string;
}

export interface EngineResult {
  engineVersion: string;
  score: number;
  verdict: "ship" | "tune" | "rework";
  verdictReason: string;
  factors: Factor[];
  projectedMonthlyUsd: number;
  projectedPerRequestUsd: number;
  blendedInputPerMTok: number;
  blendedOutputPerMTok: number;
  /** Model id per tier that the compiler recommends, derived from lane assignment. */
  recommendation: { tier: Tier; modelId: string | null; reason: string }[];
  /** Non-fatal observations a human should read before shipping. */
  warnings: string[];
  computedAt: string;
  seal: string;
}

export interface AuditEvent {
  seq: number;
  eventType: "created" | "updated" | "patched" | "compiled" | "deleted";
  entityId: string;
  actor: string;
  payload: Record<string, unknown>;
  prevSeal: string;
  seal: string;
  createdAt: string;
}

export interface ReplayResult {
  entityId: string;
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
  headSeal: string;
  genesisSeal: string;
}

export interface StoredCredential {
  id: string;
  ownerId: string;
  provider: string;
  label: string;
  /** Never the secret: a fingerprint of the ciphertext plus last four characters. */
  fingerprint: string;
  last4: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccess<T> {
  data: T;
  seal?: string;
}