/**
 * Live model catalog.
 *
 * Two keyless public upstreams are merged and normalized:
 *   - OpenRouter https://openrouter.ai/api/v1/models  (prices, context, modality)
 *   - models.dev https://models.dev/api.json          (capabilities, open weights)
 *
 * Every response declares `live` or `fallback`. When both upstreams fail the
 * sealed offline sample below is served and clearly labelled; it is never
 * presented as current pricing.
 */

import type { Capability, CatalogModel, CatalogSnapshot, SourceStatus } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const MODELSDEV_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Sealed offline sample. Fixed identifiers, fixed prices, frozen at the values
 * recorded on 2026-09-30 so a fallback build is reproducible and auditable.
 */
export const FALLBACK_SNAPSHOT: CatalogSnapshot = {
  status: "fallback",
  fetchedAt: "2026-09-30T00:00:00.000Z",
  upstreamRecords: 8,
  sources: [
    {
      id: "openrouter",
      name: "OpenRouter",
      homepage: "https://openrouter.ai/api/v1/models",
      status: "fallback",
      fetchedAt: "2026-09-30T00:00:00.000Z",
      itemCount: 4,
      latencyMs: 0,
      sampleUpstreamId: "openai/gpt-5.4",
    },
    {
      id: "modelsdev",
      name: "models.dev",
      homepage: "https://models.dev/api.json",
      status: "fallback",
      fetchedAt: "2026-09-30T00:00:00.000Z",
      itemCount: 4,
      latencyMs: 0,
      sampleUpstreamId: "openai:gpt-5.4",
    },
  ],
  models: [
    {
      id: "openai:gpt-5.4",
      provider: "openai",
      providerLabel: "OpenAI",
      model: "gpt-5.4",
      name: "OpenAI: GPT-5.4",
      inputPerMTok: 1.25,
      outputPerMTok: 10,
      contextTokens: 400_000,
      maxOutputTokens: 128_000,
      capabilities: ["tools", "reasoning", "json", "longContext", "vision"],
      releaseDate: "2026-01-15",
      openWeights: false,
      upstreamIds: { openrouter: "openai/gpt-5.4", modelsdev: "openai:gpt-5.4" },
    },
    {
      id: "anthropic:claude-sonnet-4.6",
      provider: "anthropic",
      providerLabel: "Anthropic",
      model: "claude-sonnet-4.6",
      name: "Anthropic: Claude Sonnet 4.6",
      inputPerMTok: 3,
      outputPerMTok: 15,
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
      capabilities: ["tools", "vision", "json", "longContext"],
      releaseDate: "2026-02-10",
      openWeights: false,
      upstreamIds: { openrouter: "anthropic/claude-sonnet-4.6", modelsdev: "anthropic:claude-sonnet-4.6" },
    },
    {
      id: "google:gemini-3-flash",
      provider: "google",
      providerLabel: "Google",
      model: "gemini-3-flash",
      name: "Google: Gemini 3 Flash",
      inputPerMTok: 0.3,
      outputPerMTok: 2.5,
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
      capabilities: ["tools", "vision", "json", "longContext"],
      releaseDate: "2026-01-20",
      openWeights: false,
      upstreamIds: { openrouter: "google/gemini-3-flash", modelsdev: "google:gemini-3-flash" },
    },
    {
      id: "meta-llama:llama-4-405b-instruct",
      provider: "meta-llama",
      providerLabel: "Meta",
      model: "llama-4-405b-instruct",
      name: "Meta: Llama 4 405B Instruct",
      inputPerMTok: 0.55,
      outputPerMTok: 1.65,
      contextTokens: 128_000,
      maxOutputTokens: 16_000,
      capabilities: ["tools", "json"],
      releaseDate: "2025-09-05",
      openWeights: true,
      upstreamIds: {
        openrouter: "meta-llama/llama-4-405b-instruct",
        modelsdev: "meta-llama:llama-4-405b-instruct",
      },
    },
    {
      id: "mistral:mistral-large-2507",
      provider: "mistralai",
      providerLabel: "Mistral",
      model: "mistral-large-2507",
      name: "Mistral: Mistral Large 2507",
      inputPerMTok: 2,
      outputPerMTok: 6,
      contextTokens: 128_000,
      maxOutputTokens: 32_000,
      capabilities: ["tools", "json"],
      releaseDate: "2025-07-15",
      openWeights: false,
      upstreamIds: { modelsdev: "mistralai:mistral-large-2507" },
    },
    {
      id: "qwen:qwen3-coder-480b",
      provider: "qwen",
      providerLabel: "Alibaba",
      model: "qwen3-coder-480b",
      name: "Qwen: Qwen3 Coder 480B",
      inputPerMTok: 0.45,
      outputPerMTok: 1.8,
      contextTokens: 262_144,
      maxOutputTokens: 32_000,
      capabilities: ["tools", "json"],
      releaseDate: "2025-11-20",
      openWeights: true,
      upstreamIds: { modelsdev: "qwen:qwen3-coder-480b" },
    },
    {
      id: "deepseek:deepseek-v3.2",
      provider: "deepseek",
      providerLabel: "DeepSeek",
      model: "deepseek-v3.2",
      name: "DeepSeek: DeepSeek V3.2",
      inputPerMTok: 0.28,
      outputPerMTok: 0.42,
      contextTokens: 163_840,
      maxOutputTokens: 16_000,
      capabilities: ["tools", "json", "reasoning"],
      releaseDate: "2025-12-01",
      openWeights: true,
      upstreamIds: { modelsdev: "deepseek:deepseek-v3.2" },
    },
    {
      id: "x-ai:grok-4",
      provider: "x-ai",
      providerLabel: "xAI",
      model: "grok-4",
      name: "xAI: Grok 4",
      inputPerMTok: 3,
      outputPerMTok: 15,
      contextTokens: 256_000,
      maxOutputTokens: 32_000,
      capabilities: ["tools", "vision", "json", "reasoning"],
      releaseDate: "2025-07-09",
      openWeights: false,
      upstreamIds: { modelsdev: "x-ai:grok-4" },
    },
  ],
};

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number | null;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  pricing?: { prompt?: string | null; completion?: string | null };
  top_provider?: { max_completion_tokens?: number | null };
  created?: number | null;
}

interface ModelsDevProvider {
  id: string;
  name: string;
  models: Record<
    string,
    {
      id: string;
      name?: string;
      reasoning?: boolean;
      tool_call?: boolean;
      attachment?: boolean;
      open_weights?: boolean;
      release_date?: string;
      limit?: { context?: number; output?: number };
      modalities?: { input?: string[]; output?: string[] };
    }
  >;
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Upstream prices are decimal strings per token, so multiplying by a million
 * produces binary-float noise ($0.024999999999999998). Rounding to six decimals
 * is well below any real price difference and keeps the UI readable.
 */
function price(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function capabilitiesFrom(inputModalities: string[], meta: Partial<Record<Capability, boolean>>): Capability[] {
  const caps: Capability[] = [];
  if (meta.tools) caps.push("tools");
  if (meta.reasoning) caps.push("reasoning");
  if (inputModalities.includes("image")) caps.push("vision");
  caps.push("json");
  if (meta.longContext) caps.push("longContext");
  return caps;
}

async function fetchJson<T>(url: string): Promise<{ data: T; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "patchbay-catalog/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`upstream responded ${response.status}`);
    const data = (await response.json()) as T;
    return { data, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function loadOpenRouter(): Promise<{
  models: Map<string, OpenRouterModel>;
  status: SourceStatus;
} | null> {
  try {
    const { data, latencyMs } = await fetchJson<{ data: OpenRouterModel[] }>(OPENROUTER_URL);
    const models = new Map<string, OpenRouterModel>();
    for (const model of data.data) models.set(model.id, model);
    const sample = data.data[0];
    return {
      models,
      status: {
        id: "openrouter",
        name: "OpenRouter",
        homepage: OPENROUTER_URL,
        status: "live",
        fetchedAt: new Date().toISOString(),
        itemCount: models.size,
        latencyMs,
        sampleUpstreamId: sample?.id ?? "none",
      },
    };
  } catch {
    // Reported honestly as a fallback source by the caller.
    return null;
  }
}

async function loadModelsDev(): Promise<{
  providers: Map<string, ModelsDevProvider>;
  status: SourceStatus;
} | null> {
  try {
    const { data, latencyMs } = await fetchJson<Record<string, ModelsDevProvider>>(MODELSDEV_URL);
    const providers = new Map<string, ModelsDevProvider>();
    for (const [key, provider] of Object.entries(data)) {
      providers.set(key, provider);
    }
    const first = providers.values().next().value;
    const sampleModel = first ? Object.keys(first.models)[0] : undefined;
    return {
      providers,
      status: {
        id: "modelsdev",
        name: "models.dev",
        homepage: MODELSDEV_URL,
        status: "live",
        fetchedAt: new Date().toISOString(),
        itemCount: Array.from(providers.values()).reduce(
          (sum, provider) => sum + Object.keys(provider.models).length,
          0,
        ),
        latencyMs,
        sampleUpstreamId: sampleModel ? `${first!.id}:${sampleModel}` : "none",
      },
    };
  } catch {
    // Reported honestly as a fallback source by the caller.
    return null;
  }
}

export function normalize(
  openrouter: Map<string, OpenRouterModel> | null,
  openrouterStatus: SourceStatus | null,
  modelsdev: Map<string, ModelsDevProvider> | null,
  modelsdevStatus: SourceStatus | null,
): CatalogSnapshot {
  const merged = new Map<string, CatalogModel>();

  // models.dev first: it carries the capability metadata.
  if (modelsdev) {
    for (const provider of modelsdev.values()) {
      for (const model of Object.values(provider.models)) {
        const inputModalities = model.modalities?.input ?? ["text"];
        const displayName = model.name ?? model.id;
        const mergedId = `${provider.id}:${model.id}`;
        merged.set(mergedId, {
          id: mergedId,
          provider: provider.id,
          providerLabel: provider.name ?? provider.id,
          model: model.id,
          name: `${provider.name ?? provider.id}: ${displayName}`,
          inputPerMTok: 0,
          outputPerMTok: 0,
          contextTokens: model.limit?.context ?? 0,
          maxOutputTokens: model.limit?.output ?? 0,
          capabilities: capabilitiesFrom(inputModalities, {
            tools: model.tool_call === true,
            reasoning: model.reasoning === true,
            vision: inputModalities.includes("image"),
            json: true,
            longContext: (model.limit?.context ?? 0) >= 200_000,
          }),
          releaseDate: model.release_date ?? null,
          openWeights: model.open_weights === true,
          upstreamIds: { modelsdev: mergedId },
        });
      }
    }
  }

  // OpenRouter second: prices and context win where present.
  let upstreamRecords = 0;
  if (openrouter) {
    upstreamRecords += openrouter.size;
    for (const model of openrouter.values()) {
      const providerId = model.id.includes("/") ? model.id.split("/")[0] : model.id;
      const modelId = model.id.includes("/") ? model.id.slice(model.id.indexOf("/") + 1) : model.id;
      const mergedId = `${providerId}:${modelId}`;
      const inputModalities = model.architecture?.input_modalities ?? ["text"];
      const existing = merged.get(mergedId);
      const inputPerMTok = num(model.pricing?.prompt) * 1_000_000;
      const outputPerMTok = num(model.pricing?.completion) * 1_000_000;
      merged.set(mergedId, {
        id: mergedId,
        provider: existing?.provider ?? providerId,
        providerLabel: existing?.providerLabel ?? providerId,
        model: existing?.model ?? modelId,
        name: model.name ?? existing?.name ?? mergedId,
        inputPerMTok: Number.isFinite(inputPerMTok) ? price(inputPerMTok) : (existing?.inputPerMTok ?? 0),
        outputPerMTok: Number.isFinite(outputPerMTok) ? price(outputPerMTok) : (existing?.outputPerMTok ?? 0),
        contextTokens: model.context_length ?? existing?.contextTokens ?? 0,
        maxOutputTokens: model.top_provider?.max_completion_tokens ?? existing?.maxOutputTokens ?? 0,
        capabilities: existing
          ? Array.from(
              new Set([
                ...existing.capabilities,
                ...capabilitiesFrom(inputModalities, {
                  tools: inputModalities.includes("text"),
                  reasoning: false,
                  vision: inputModalities.includes("image"),
                  json: true,
                  longContext: (model.context_length ?? 0) >= 200_000,
                }),
              ]),
            )
          : capabilitiesFrom(inputModalities, {
              tools: true,
              reasoning: false,
              vision: inputModalities.includes("image"),
              json: true,
              longContext: (model.context_length ?? 0) >= 200_000,
            }),
        releaseDate:
          existing?.releaseDate ??
          (typeof model.created === "number" && model.created > 0
            ? new Date(model.created * 1000).toISOString().slice(0, 10)
            : null),
        openWeights: existing?.openWeights ?? false,
        upstreamIds: {
          openrouter: model.id,
          modelsdev: existing?.upstreamIds.modelsdev,
        },
      });
    }
  }

  const sources: SourceStatus[] = [];
  if (openrouterStatus) sources.push(openrouterStatus);
  if (modelsdevStatus) sources.push(modelsdevStatus);

  // Models with a real price are the useful set for a routing patchbay.
  const models = Array.from(merged.values())
    .filter((model) => model.inputPerMTok > 0 || model.outputPerMTok > 0)
    .sort((a, b) => a.inputPerMTok + a.outputPerMTok - (b.inputPerMTok + b.outputPerMTok));

  return {
    status: "live",
    fetchedAt: new Date().toISOString(),
    sources,
    models,
    upstreamRecords,
  };
}

type CacheEntry = { at: number; snapshot: CatalogSnapshot };

const globalCache = globalThis as unknown as { __patchbayCatalog?: CacheEntry };

export async function getCatalog(options: { force?: boolean } = {}): Promise<CatalogSnapshot> {
  const existing = globalCache.__patchbayCatalog;
  if (!options.force && existing && Date.now() - existing.at < CACHE_TTL_MS) {
    return existing.snapshot;
  }

  const [openrouter, modelsdev] = await Promise.all([loadOpenRouter(), loadModelsDev()]);

  if (!openrouter && !modelsdev) {
    const fallback: CatalogSnapshot = {
      ...FALLBACK_SNAPSHOT,
      sources: FALLBACK_SNAPSHOT.sources.map((source) => ({
        ...source,
        error: "upstream unreachable during this request",
      })),
    };
    globalCache.__patchbayCatalog = { at: Date.now(), snapshot: fallback };
    return fallback;
  }

  const partialStatus = (status: SourceStatus | null, id: SourceStatus["id"], name: string, homepage: string) =>
    status ??
    ({
      id,
      name,
      homepage,
      status: "fallback" as const,
      fetchedAt: new Date().toISOString(),
      itemCount: 0,
      latencyMs: 0,
      sampleUpstreamId: "unavailable",
      error: "upstream unreachable during this request",
    } satisfies SourceStatus);

  const snapshot = normalize(
    openrouter?.models ?? null,
    partialStatus(openrouter?.status ?? null, "openrouter", "OpenRouter", OPENROUTER_URL),
    modelsdev?.providers ?? null,
    partialStatus(modelsdev?.status ?? null, "modelsdev", "models.dev", MODELSDEV_URL),
  );

  if (snapshot.models.length === 0) {
    const fallback: CatalogSnapshot = {
      ...FALLBACK_SNAPSHOT,
      sources: FALLBACK_SNAPSHOT.sources.map((source) => ({
        ...source,
        error: "upstream returned no priced models",
      })),
    };
    globalCache.__patchbayCatalog = { at: Date.now(), snapshot: fallback };
    return fallback;
  }

  globalCache.__patchbayCatalog = { at: Date.now(), snapshot };
  return snapshot;
}

export function catalogCacheAgeMs(): number {
  const entry = globalCache.__patchbayCatalog;
  return entry ? Date.now() - entry.at : Number.POSITIVE_INFINITY;
}

export { OPENROUTER_URL, MODELSDEV_URL };