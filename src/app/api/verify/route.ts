import { errorResponse, successResponse } from "@/lib/api";
import { listAgents, replayAgent } from "@/lib/db/repository";
import { getOrCreateScopeId } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replay every seal chain owned by the current session. */
export async function GET(request: Request) {
  const ownerId = await getOrCreateScopeId();
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");

  if (agentId) {
    const agents = await listAgents(ownerId, { limit: 1 });
    const exists = agents.agents.some((agent) => agent.id === agentId);
    if (!exists) {
      // Distinguish "not yours" from "no such agent" without leaking existence.
      const result = await replayAgent(ownerId, agentId);
      if (result.checked === 0) return errorResponse(404, "not_found", "Agent not found.");
    }
    return successResponse(await replayAgent(ownerId, agentId));
  }

  const agents = await listAgents(ownerId, { limit: 100 });
  const results = [];
  for (const agent of agents.agents) {
    results.push({ name: agent.name, ...(await replayAgent(ownerId, agent.id)) });
  }
  return successResponse({
    checked: results.length,
    allOk: results.every((result) => result.ok),
    results,
    algorithm: "seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) ), genesis = 96 zeros",
  });
}