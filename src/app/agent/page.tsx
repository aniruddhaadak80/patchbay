import type { Metadata } from "next";
import { McpConsole } from "@/components/mcp-console";
import { listAgents } from "@/lib/db/repository";
import { getScopeId } from "@/lib/scope";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Agent API console",
  description:
    "Live MCP-style JSON-RPC 2.0 console with eight typed tools: read, analysis, and mutating paths that share the UI's service layer.",
  alternates: { canonical: "/agent" },
};

export const dynamic = "force-dynamic";

const TOOLS = [
  ["list_models", "read", "Normalized catalog with prices, context, capabilities, and source provenance."],
  ["list_agents", "read", "Your agents, newest first, scoped to the session or account."],
  ["get_agent", "read", "One agent plus a freshly compiled policy result."],
  ["upsert_agent", "mutate", "Create or update lanes. Honours the Idempotency-Key header."],
  ["delete_agent", "mutate", "Soft-delete while retaining the replayable audit chain."],
  ["compile_policy", "analysis", `${"policy-compiler@1.0.0"}: versioned score with weighted factors.`],
  ["verify_integrity", "read", "Replay the SHA-384 chain and report the first broken link."],
  ["export_agent", "read", "The portable routing manifest, including provenance."],
];

export default async function AgentApiPage() {
  const ownerId = await getScopeId();
  const { agents } = await listAgents(ownerId, { limit: 25 });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">Agent API console</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
          A live MCP-style JSON-RPC 2.0 endpoint at{" "}
          <code className="font-mono text-brass-300">{site.liveUrl}/api/mcp</code>. Register it in{" "}
          <code className="font-mono text-brass-300">mcp.json</code> and your assistant can read the catalog,
          compile policies, and patch lanes through the same code path this app uses.
        </p>
      </header>

      <section className="panel p-5" aria-label="Tool catalogue">
        <h2 className="silkscreen mb-3">Available tools</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {TOOLS.map(([name, kind, description]) => (
            <li key={name} className="rounded border border-rack-200 bg-rack-100/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-[12px] text-ivory-100">{name}</code>
                <span
                  className={`silkscreen text-[9px] ${
                    kind === "mutate"
                      ? "text-signal-amber"
                      : kind === "analysis"
                        ? "text-signal-violet"
                        : "text-signal-cyan"
                  }`}
                >
                  {kind}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ivory-400">{description}</p>
            </li>
          ))}
        </ul>
        <pre className="mt-4 overflow-auto rounded border border-rack-200 bg-rack-000 p-3 font-mono text-[11px] text-ivory-200">
{`{
  "mcpServers": {
    "patchbay": {
      "type": "http",
      "url": "${site.liveUrl}/api/mcp"
    }
  }
}`}
        </pre>
      </section>

      <McpConsole
        endpoint="/api/mcp"
        agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
      />
    </div>
  );
}