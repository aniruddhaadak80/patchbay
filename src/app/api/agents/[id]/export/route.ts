import { errorResponse } from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import { getAgent } from "@/lib/db/repository";
import { buildManifest, compileFor } from "@/lib/manifest";
import { getOrCreateScopeId } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Downloadable routing manifest: lanes, score, factors, seal, provenance. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const ownerId = await getOrCreateScopeId();
  const agent = await getAgent(ownerId, id);
  if (!agent) {
    return errorResponse(404, "not_found", "Agent not found in your workspace.");
  }

  const snapshot = await getCatalog();
  const { compiled, lanes } = compileFor(agent, snapshot.models, ownerId);
  const manifest = buildManifest(agent, compiled, snapshot.status, snapshot.fetchedAt, snapshot.sources);

  const body = `${JSON.stringify({ ...manifest, agent: { ...manifest.agent, lanes } }, null, 2)}\n`;
  const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="patchbay-${slug}-manifest.json"`,
      "cache-control": "no-store",
      "x-patchbay-seal": agent.seal,
    },
  });
}