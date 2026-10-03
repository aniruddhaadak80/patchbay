import {
  errorCode,
  errorResponse,
  successResponse,
  throttleWrite,
  updateAgentSchema,
  zodMessage,
} from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import {
  ConflictError,
  deleteAgent,
  getAgent,
  NotFoundError,
  updateAgent,
  ValidationError,
} from "@/lib/db/repository";
import { compilePolicy } from "@/lib/engine";
import { getOrCreateScopeId } from "@/lib/scope";
import { TIERS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const ownerId = await getOrCreateScopeId();
  const agent = await getAgent(ownerId, id);
  if (!agent) return errorResponse(404, "not_found", "Agent not found in your workspace.");

  const snapshot = await getCatalog();
  const resolvedLanes = agent.lanes.map((lane) => {
    const model = lane.modelId ? snapshot.models.find((entry) => entry.id === lane.modelId) : undefined;
    return { ...lane, modelLabel: model?.name ?? lane.modelLabel, provider: model?.provider ?? lane.provider };
  });
  const compiled = compilePolicy({ agent, models: snapshot.models, actor: ownerId });

  return successResponse(
    {
      agent: { ...agent, lanes: resolvedLanes },
      compiled,
      catalogStatus: snapshot.status,
      catalogFetchedAt: snapshot.fetchedAt,
      sources: snapshot.sources,
    },
    { seal: agent.seal },
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const ownerId = await getOrCreateScopeId();
  const throttle = throttleWrite(`agents:${ownerId}`);
  if (!throttle.allowed) {
    return errorResponse(429, "rate_limited", `Too many writes. Retry in ${throttle.retryAfter}s.`);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
  }
  const parsed = updateAgentSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(400, "invalid_input", zodMessage(parsed.error), parsed.error.flatten());
  }

  const snapshot = await getCatalog();
  const unknown = TIERS.flatMap((tier) => {
    const modelId = parsed.data.lanes?.[tier]?.modelId;
    return modelId && !snapshot.models.some((model) => model.id === modelId) ? [{ tier, modelId }] : [];
  });
  if (unknown.length > 0) {
    return errorResponse(400, "unknown_model", "Patch references a model missing from the current catalog.", unknown);
  }

  try {
    const { expectedRevision, ...rest } = parsed.data;
    const updated = await updateAgent(ownerId, id, { ...rest, actor: ownerId }, expectedRevision);
    const compiled = compilePolicy({ agent: updated, models: snapshot.models, actor: ownerId });
    return successResponse({ agent: updated, compiled }, { seal: updated.seal });
  } catch (error) {
    if (error instanceof NotFoundError) return errorResponse(404, errorCode(error, "not_found"), error.message);
    if (error instanceof ConflictError) return errorResponse(409, errorCode(error, "conflict"), error.message);
    if (error instanceof ValidationError) {
      return errorResponse(400, errorCode(error, "invalid_input"), error.message, error.details);
    }
    return errorResponse(500, "update_failed", "Could not update the agent.");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const ownerId = await getOrCreateScopeId();
  const throttle = throttleWrite(`agents:${ownerId}`);
  if (!throttle.allowed) {
    return errorResponse(429, "rate_limited", `Too many writes. Retry in ${throttle.retryAfter}s.`);
  }
  try {
    const result = await deleteAgent(ownerId, id);
    return successResponse(
      {
        id: result.id,
        deleted: true,
        tombstone: true,
        note: "The record is soft-deleted and retained so its seal chain stays replayable. Audit events are never removed.",
      },
      { seal: result.seal },
    );
  } catch (error) {
    if (error instanceof NotFoundError) return errorResponse(404, errorCode(error, "not_found"), error.message);
    return errorResponse(500, "delete_failed", "Could not delete the agent.");
  }
}