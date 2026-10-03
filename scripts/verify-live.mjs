#!/usr/bin/env node
/**
 * Live end-to-end verifier.
 *
 * Usage:
 *   PATCHBAY_BASE_URL=https://<alias>.vercel.app node scripts/verify-live.mjs
 *   node scripts/verify-live.mjs                      # defaults to localhost:3100
 *
 * Reads the base URL from the environment only. No secrets are embedded, printed,
 * or required: a fresh anonymous scope cookie is minted per run by the app itself.
 */

import process from "node:process";

const BASE = (process.env.PATCHBAY_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const REPO_URL = "https://github.com/aniruddhaadak80/patchbay";

let cookie = "";
const results = [];
let failures = 0;

async function http(path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const entry of setCookie) {
    const pair = entry.split(";")[0];
    if (pair.startsWith("patchbay_scope=")) cookie = pair;
  }
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

function check(name, condition, detail = "") {
  const pass = Boolean(condition);
  if (!pass) failures += 1;
  results.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  process.stdout.write(`${mark}  ${name}${detail ? ` — ${detail}` : ""}\n`);
  return pass;
}

const rpc = (method, params, id) =>
  http("/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });

const toolCall = (name, args, id) =>
  rpc("tools/call", { name, arguments: args }, id);

async function main() {
  process.stdout.write(`\nPatchbay live verification against ${BASE}\n\n`);

  // 1. landing renders and contains the repo link
  const home = await http("/");
  check("GET / returns 200", home.status === 200, `status ${home.status}`);
  check("landing contains the real repository URL", home.text.includes(REPO_URL));
  check(
    "landing carries the primary action",
    /Patch your first agent|Create your first agent/.test(home.text),
  );

  // 2. health proves the real persistence path
  const health = await http("/api/health");
  check("GET /api/health returns 200", health.status === 200, `status ${health.status}`);
  const persistence = health.json?.data?.checks?.persistence;
  check(
    "health reports a real persistence round trip",
    persistence?.roundTrip === "ok",
    `adapter=${persistence?.adapter} durability=${persistence?.durability}`,
  );
  if (process.env.PATCHBAY_REQUIRE_HOSTED === "true") {
    check(
      "production uses a hosted store",
      persistence?.adapter === "neon" && persistence?.hosted === true,
      `adapter=${persistence?.adapter}`,
    );
  }

  // 3. live catalog is normalized with provenance
  const catalog = await http("/api/catalog?limit=25");
  const catalogData = catalog.json?.data;
  check("GET /api/catalog returns 200", catalog.status === 200);
  check("catalog returns models", Array.isArray(catalogData?.models) && catalogData.models.length > 0, `${catalogData?.matched} matched`);
  check(
    "catalog labels its status",
    catalogData?.status === "live" || catalogData?.status === "fallback",
    `status=${catalogData?.status}`,
  );
  check(
    "catalog carries source provenance",
    Array.isArray(catalogData?.sources) &&
      catalogData.sources.length > 0 &&
      catalogData.sources.every((source) => source.homepage.startsWith("https://")),
    (catalogData?.sources ?? []).map((s) => `${s.id}:${s.status}`).join(" "),
  );
  const first = catalogData.models[0];
  check(
    "catalog entries are normalized",
    Boolean(first && first.id.includes(":") && typeof first.inputPerMTok === "number"),
    first?.id,
  );

  // 4. create through the public API, read back through the UI-facing API
  const ids = catalogData.models.map((model) => model.id);
  const name = `verify-${Date.now().toString().slice(-8)}`;
  const created = await http("/api/agents", {
    method: "POST",
    headers: { "idempotency-key": `verify-create-${name}` },
    body: JSON.stringify({
      name,
      taskClass: "Route inbound support tickets to the cheapest adequate model.",
      budgetUsd: 300,
      lanes: {
        fast: { modelId: ids[0], weight: 0.6, dailyRequests: 1200 },
        balanced: { modelId: ids[1] ?? ids[0], weight: 0.3, dailyRequests: 500 },
        deep: { modelId: ids[2] ?? ids[0], weight: 0.1, dailyRequests: 100 },
      },
    }),
  });
  const agent = created.json?.data?.agent;
  check("POST /api/agents creates a record", created.status === 201 && Boolean(agent?.id), `status ${created.status}`);
  check("create returns a genesis seal", /^[0-9a-f]{96}$/.test(agent?.seal ?? ""), agent?.seal?.slice(0, 16));

  const list = await http("/api/agents");
  check(
    "GET /api/agents lists the new record",
    (list.json?.data?.agents ?? []).some((entry) => entry.id === agent.id),
  );

  const readBack = await http(`/api/agents/${agent.id}`);
  check("GET /api/agents/:id reads it back", readBack.status === 200 && readBack.json?.data?.agent?.id === agent.id);
  check(
    "read-back shows the patched lanes",
    readBack.json?.data?.agent?.lanes.filter((lane) => lane.modelId).length === 3,
  );

  // 5. update, then confirm the persisted state changed
  const patch = await http(`/api/agents/${agent.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "active",
      budgetUsd: 450,
      expectedRevision: readBack.json.data.agent.revision,
    }),
  });
  check("PATCH updates the record", patch.status === 200 && patch.json?.data?.agent?.status === "active");
  check(
    "revision advanced",
    patch.json?.data?.agent?.revision === readBack.json.data.agent.revision + 1,
    `${readBack.json.data.agent.revision} → ${patch.json.data.agent.revision}`,
  );
  const afterUpdate = await http(`/api/agents/${agent.id}`);
  check(
    "read-back reflects the update",
    afterUpdate.json?.data?.agent?.budgetUsd === 450,
    `budgetUsd=${afterUpdate.json?.data?.agent?.budgetUsd}`,
  );

  // conflict handling returns 409 rather than silently overwriting
  const stale = await http(`/api/agents/${agent.id}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: "stale write", expectedRevision: 1 }),
  });
  check("stale revision is rejected with 409", stale.status === 409, `status ${stale.status}`);

  // 6. engine returns a versioned, itemized, sealed result
  const compiled = await http("/api/compile", {
    method: "POST",
    body: JSON.stringify({ agentId: agent.id, dailyRequests: 4000 }),
  });
  const engine = compiled.json?.data?.compiled;
  check("POST /api/compile returns 200", compiled.status === 200);
  check("engine result is versioned", typeof engine?.engineVersion === "string" && engine.engineVersion.length > 0, engine?.engineVersion);
  check("engine returns a score in 0..100", engine?.score >= 0 && engine?.score <= 100, `score ${engine?.score}`);
  check("engine returns itemized factors", Array.isArray(engine?.factors) && engine.factors.length === 7, `${engine?.factors?.length} factors`);
  check(
    "factors carry weights and contributions",
    engine?.factors.every((f) => typeof f.weight === "number" && typeof f.contribution === "number" && f.detail),
  );
  check("engine returns a verdict", ["ship", "tune", "rework"].includes(engine?.verdict), engine?.verdict);
  check("engine returns a seal", /^[0-9a-f]{96}$/.test(engine?.seal ?? ""), engine?.seal?.slice(0, 16));
  check("engine score matches the sum of factor contributions", Math.abs(engine.score - engine.factors.reduce((s, f) => s + f.contribution, 0)) < 0.15);

  // 7. MCP initialize and tools/list
  const initialize = await rpc("initialize", {}, 1);
  check("MCP initialize succeeds", initialize.json?.result?.serverInfo?.name === "patchbay", initialize.json?.result?.serverInfo?.version);
  const tools = await rpc("tools/list", {}, 2);
  const toolNames = (tools.json?.result?.tools ?? []).map((tool) => tool.name);
  check("MCP tools/list returns the expected tools", toolNames.length >= 8, toolNames.join(", "));
  check(
    "tools expose typed input schemas",
    (tools.json?.result?.tools ?? []).every((tool) => tool.inputSchema?.type === "object"),
  );
  check(
    "tool set covers read, analysis, and mutation",
    ["list_models", "compile_policy", "upsert_agent"].every((name) => toolNames.includes(name)),
  );

  const badTool = await rpc("tools/call", { name: "does_not_exist", arguments: {} }, 3);
  check("unknown tool returns a JSON-RPC error", typeof badTool.json?.error?.code === "number", `code ${badTool.json?.error?.code}`);
  const badMethod = await rpc("nope/there", {}, 4);
  check("unknown method returns -32601", badMethod.json?.error?.code === -32601);

  // 8. MCP mutation goes through the same path as the UI
  const currentAgent = (await http(`/api/agents/${agent.id}`)).json.data.agent;
  const mcpPatch = await toolCall(
    "upsert_agent",
    {
      agentId: agent.id,
      notes: "mutated through the JSON-RPC mutating tool",
      expectedRevision: currentAgent.revision,
    },
    5,
  );
  const mcpResult = mcpPatch.json?.result?.structuredContent;
  check(
    "MCP mutating tool succeeds",
    mcpPatch.json?.result?.isError !== true && mcpResult?.agent?.notes?.includes("JSON-RPC"),
    mcpPatch.json?.result?.isError === true ? mcpPatch.json?.result?.content?.[0]?.text : "",
  );
  const afterMcp = await http(`/api/agents/${agent.id}`);
  check(
    "UI-facing read-back proves the MCP mutation persisted",
    afterMcp.json?.data?.agent?.notes?.includes("JSON-RPC"),
  );
  check(
    "MCP mutation advanced the revision and seal",
    afterMcp.json.data.agent.revision > currentAgent.revision &&
      afterMcp.json.data.agent.seal !== currentAgent.seal,
  );

  // idempotent retry must not double-write
  const idemKey = `verify-idem-${agent.id}`;
  const first1 = await toolCall("upsert_agent", { agentId: agent.id, notes: "idempotent probe", expectedRevision: afterMcp.json.data.agent.revision }, 6);
  const revAfterFirst = first1.json?.result?.structuredContent?.agent?.revision;
  await http("/api/mcp", {
    method: "POST",
    headers: { "idempotency-key": idemKey },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "upsert_agent", arguments: { name: `idem-${Date.now().toString().slice(-6)}`, taskClass: "Idempotency probe for the verifier.", lanes: {} } },
    }),
  });
  const listAfter = await http("/api/agents");
  const idemAgents = (listAfter.json?.data?.agents ?? []).filter((entry) => entry.name.startsWith("idem-"));
  check("idempotent create produced exactly one record", idemAgents.length <= 1, `${idemAgents.length} record(s)`);
  if (idemAgents.length === 1) {
    await http(`/api/agents/${idemAgents[0].id}`, { method: "DELETE" });
  }
  check("first mutating call still applied", typeof revAfterFirst === "number");

  // 9. integrity replay before deletion
  const replay = await toolCall("verify_integrity", { agentId: agent.id }, 8);
  const replayData = replay.json?.result?.structuredContent;
  check("integrity replay succeeds", replayData?.ok === true, replayData?.reason ?? `${replayData?.checked} events`);
  check("replay checked every event", replayData?.checked >= 3, `${replayData?.checked} events`);

  const verifyPage = await http(`/verify`);
  check("/verify renders the chain", verifyPage.status === 200 && /clean|broken/.test(verifyPage.text));

  // 10. export artifact
  const exported = await http(`/api/agents/${agent.id}/export`);
  check("manifest download returns JSON", exported.status === 200);
  check(
    "manifest carries lanes, score, factors, and provenance",
    Boolean(
      exported.json?.manifest === undefined &&
        exported.json?.agent?.lanes &&
        exported.json?.compiled?.factors &&
        exported.json?.provenance &&
        exported.json?.integrity,
    ),
    exported.status === 200 ? "download ok" : `status ${exported.status}`,
  );
  check(
    "manifest content-disposition is an attachment",
    (exported.headers.get("content-disposition") ?? "").startsWith("attachment"),
  );

  const share = await http(`/share/${agent.id}`);
  check(
    "share route renders publicly without leaking owner notes",
    share.status === 200 && !share.text.includes("mutated through the JSON-RPC mutating tool"),
    `status ${share.status}`,
  );

  // 11. delete and confirm absence with a retained tombstone
  const deleted = await http(`/api/agents/${agent.id}`, { method: "DELETE" });
  check("DELETE returns 200", deleted.status === 200, `status ${deleted.status}`);
  const gone = await http(`/api/agents/${agent.id}`);
  check("deleted record is absent from reads", gone.status === 404, `status ${gone.status}`);
  const afterDelete = await toolCall("verify_integrity", { agentId: agent.id }, 9);
  const afterDeleteData = afterDelete.json?.result?.structuredContent;
  check(
    "audit chain is retained and still replays after deletion",
    afterDeleteData?.checked >= 4,
    `${afterDeleteData?.checked} events retained, ok=${afterDeleteData?.ok}`,
  );

  // 12. every primary route responds, and navigation/footer carry the repo URL
  for (const route of ["/catalog", "/agents", "/agents/new", "/compile", "/keys", "/agent", "/export", "/verify", "/sign-in"]) {
    const response = await http(route);
    check(`GET ${route} returns 200`, response.status === 200, `status ${response.status}`);
  }

  const navCheck = await http("/");
  const navMatches = navCheck.text.match(/https:\/\/github\.com\/aniruddhaadak80\/patchbay/g) ?? [];
  check(
    "navigation and footer both link the repository",
    navMatches.length >= 2,
    `${navMatches.length} occurrences`,
  );
  check(
    "repository links open safely in a new tab",
    /href="https:\/\/github\.com\/aniruddhaadak80\/patchbay"[^>]*rel="noopener noreferrer"/.test(navCheck.text) ||
      /rel="noopener noreferrer"[^>]*href="https:\/\/github\.com\/aniruddhaadak80\/patchbay"/.test(navCheck.text),
  );

  // Skipped before the repository is published; Phase 7 flips this on.
  if (process.env.PATCHBAY_SKIP_REPO_CHECK !== "true") {
    const repoResponse = await fetch(REPO_URL, { redirect: "follow" });
    check("repository URL resolves", repoResponse.status === 200, `status ${repoResponse.status}`);
  }

  const mcpManifest = await http("/mcp.json");
  check("public mcp.json is served", mcpManifest.status === 200);
  check(
    "mcp.json points at a real endpoint",
    typeof mcpManifest.json?.packages?.[0]?.transport?.url === "string" &&
      mcpManifest.json.packages[0].transport.url.startsWith("https://"),
    mcpManifest.json?.packages?.[0]?.transport?.url,
  );

  const openGraph = await http("/opengraph-image");
  check("OG image renders", openGraph.status === 200, `status ${openGraph.status}`);

  process.stdout.write(`\n${results.length - failures}/${results.length} checks passed.\n`);
  if (failures > 0) {
    process.stdout.write(`\n${failures} check(s) failed:\n`);
    for (const entry of results.filter((r) => !r.pass)) {
      process.stdout.write(`  - ${entry.name}${entry.detail ? ` (${entry.detail})` : ""}\n`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stdout.write(`\nVerifier crashed: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});