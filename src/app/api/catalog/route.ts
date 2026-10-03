import { z } from "zod";
import { errorResponse, successResponse, zodMessage } from "@/lib/api";
import { getCatalog, catalogCacheAgeMs } from "@/lib/catalog";
import type { CatalogModel } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 900;

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  provider: z.string().trim().max(80).optional(),
  capability: z.enum(["tools", "reasoning", "vision", "json", "longContext"]).optional(),
  maxInput: z.coerce.number().min(0).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

function matches(model: CatalogModel, needle: string): boolean {
  const haystack = `${model.id} ${model.name} ${model.providerLabel}`.toLowerCase();
  return haystack.includes(needle);
}

/** Live normalized catalog. `status` is "live" or "fallback"; never faked. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    provider: url.searchParams.get("provider") ?? undefined,
    capability: url.searchParams.get("capability") ?? undefined,
    maxInput: url.searchParams.get("maxInput") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return errorResponse(400, "invalid_query", zodMessage(parsed.error), parsed.error.flatten());
  }

  const { q, provider, capability, maxInput, limit } = parsed.data;
  const snapshot = await getCatalog();

  let models = snapshot.models;
  if (q) models = models.filter((model) => matches(model, q.toLowerCase()));
  if (provider) models = models.filter((model) => model.provider === provider.toLowerCase());
  if (capability) models = models.filter((model) => model.capabilities.includes(capability));
  if (maxInput !== undefined) models = models.filter((model) => model.inputPerMTok <= maxInput);

  const providers = Array.from(new Set(snapshot.models.map((model) => model.provider))).sort();

  return successResponse({
    status: snapshot.status,
    fetchedAt: snapshot.fetchedAt,
    cacheAgeMs: Number.isFinite(catalogCacheAgeMs()) ? catalogCacheAgeMs() : null,
    totalUpstreamRecords: snapshot.upstreamRecords,
    totalPricedModels: snapshot.models.length,
    matched: models.length,
    providers,
    sources: snapshot.sources,
    models: models.slice(0, limit),
    truncated: models.length > limit,
  });
}

/** Refresh bypasses the in-process cache so the UI can prove the feed is live. */
export async function POST() {
  const snapshot = await getCatalog({ force: true });
  return successResponse({
    status: snapshot.status,
    fetchedAt: snapshot.fetchedAt,
    totalPricedModels: snapshot.models.length,
    sources: snapshot.sources,
    refreshed: true,
  });
}