import { errorResponse, successResponse, compileSchema, zodMessage } from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import { getAgent, listAgents } from "@/lib/db/repository";
import { compilePolicy, ENGINE_VERSION, REFERENCE_REQUEST } from "@/lib/engine";
import { getOrCreateScopeId } from "@/lib/scope";
import { TIERS, type Agent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ad-hoc compile: either score a stored agent by id, or score an inline lane
 * board. Both paths call the same `compilePolicy` the UI and MCP tool use.
 */
export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = compileSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(400, "invalid_input", zodMessage(parsed.error), parsed.error.flatten());
  }

  const ownerId = await getOrCreateScopeId();
  const snapshot = await getCatalog();
  const byId = new Map(snapshot.models.map((model) => [model.id, model]));

  let agent: Pick<Agent, "id" | "name" | "budgetUsd" | "lanes">;
  if (parsed.data.agentId) {
    const stored = await getAgent(ownerId, parsed.data.agentId);
    if (!stored) return errorResponse(404, "not_found", "Agent not found in your workspace.");
    agent = stored;
  } else if (parsed.data.lanes) {
    agent = {
      id: "inline",
      name: "Inline policy",
      budgetUsd: parsed.data.budgetUsd ?? 50,
      lanes: TIERS.map((tier) => {
        const lane = parsed.data.lanes!.find((entry) => entry.tier === tier)!;
        return {
          tier,
          modelId: lane.modelId,
          modelLabel: lane.modelId ? (byId.get(lane.modelId)?.name ?? null) : null,
          provider: lane.modelId ? (byId.get(lane.modelId)?.provider ?? null) : null,
          weight: lane.weight,
          dailyRequests: lane.dailyRequests,
        };
      }),
    };
  } else {
    const agents = await listAgents(ownerId, { limit: 20 });
    if (agents.agents.length === 0) {
      return errorResponse(
        404,
        "no_agents",
        "Create an agent first, or POST a full lane array to compile an inline policy.",
      );
    }
    agent = agents.agents[0];
  }

  const unknown = agent.lanes.flatMap((lane) =>
    lane.modelId && !byId.has(lane.modelId) ? [{ tier: lane.tier, modelId: lane.modelId }] : [],
  );
  if (unknown.length > 0) {
    return errorResponse(
      400,
      "unknown_model",
      `These models are not in the ${snapshot.status} catalog and cannot be priced.`,
      unknown,
    );
  }

  const compiled = compilePolicy({
    agent,
    models: snapshot.models,
    dailyRequests: parsed.data.dailyRequests,
    actor: ownerId,
  });

  return successResponse(
    {
      compiled,
      catalogStatus: snapshot.status,
      catalogFetchedAt: snapshot.fetchedAt,
      referenceRequest: REFERENCE_REQUEST,
      engineVersion: ENGINE_VERSION,
    },
    { seal: compiled.seal },
  );
}