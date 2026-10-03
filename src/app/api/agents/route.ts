import {
  createAgentSchema,
  errorResponse,
  errorCode,
  successResponse,
  throttleWrite,
  zodMessage,
} from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import {
  ConflictError,
  createAgent,
  listAgents,
  readIdempotent,
  ValidationError,
  writeIdempotent,
} from "@/lib/db/repository";
import { compilePolicy } from "@/lib/engine";
import { ensureScopeRow, getOrCreateScopeId } from "@/lib/scope";
import { TIERS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusFromError(error: unknown): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof ConflictError) return 409;
  return 500;
}

export async function GET(request: Request) {
  const ownerId = await getOrCreateScopeId();
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);

  try {
    const result = await listAgents(ownerId, {
      status,
      q,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? Math.max(offset, 0) : 0,
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(400, "invalid_query", error.message, error.details);
    }
    return errorResponse(500, "list_failed", "Could not list agents.");
  }
}

export async function POST(request: Request) {
  const ownerId = await getOrCreateScopeId();
  await ensureScopeRow(ownerId);
  const throttle = throttleWrite(`agents:${ownerId}`);
  if (!throttle.allowed) {
    return errorResponse(429, "rate_limited", `Too many writes. Retry in ${throttle.retryAfter}s.`, {
      retryAfter: throttle.retryAfter,
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) {
    const replayed = await readIdempotent(ownerId, idempotencyKey, "POST /api/agents");
    if (replayed) return successResponse(replayed, { status: 200 });
  }

  const parsed = createAgentSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(400, "invalid_input", zodMessage(parsed.error), parsed.error.flatten());
  }

  const input = parsed.data;

  // Validate that every patched lane references a model that really exists.
  const snapshot = await getCatalog();
  const known = new Set(snapshot.models.map((model) => model.id));
  const unknown = TIERS.flatMap((tier) => {
    const modelId = input.lanes?.[tier]?.modelId;
    return modelId && !known.has(modelId) ? [{ tier, modelId }] : [];
  });
  if (unknown.length > 0) {
    return errorResponse(
      400,
      "unknown_model",
      `These model ids are not in the ${snapshot.status} catalog: ${unknown.map((entry) => `${entry.tier}=${entry.modelId}`).join(", ")}.`,
      unknown,
    );
  }

  try {
    const agent = await createAgent({
      ownerId,
      name: input.name,
      taskClass: input.taskClass,
      notes: input.notes ?? "",
      status: input.status,
      budgetUsd: input.budgetUsd,
      lanes: input.lanes,
    });
    const result = compilePolicy({ agent, models: snapshot.models, actor: ownerId });
    const body = { agent, compiled: result };
    if (idempotencyKey) await writeIdempotent(ownerId, idempotencyKey, "POST /api/agents", body);
    return successResponse(body, { status: 201, seal: agent.seal });
  } catch (error) {
    const status = statusFromError(error);
    if (status === 500) return errorResponse(500, "create_failed", "Could not create the agent.");
    return errorResponse(status, errorCode(error), (error as Error).message);
  }
}