"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { ErrorNotice } from "@/components/feedback";

interface Preset {
  label: string;
  tool: string;
  args: Record<string, unknown>;
  note: string;
}

/**
 * Live JSON-RPC console. Every preset issues a real request to /api/mcp and
 * shows the exact request and response. The mutating preset writes through the
 * same service layer the UI uses, so its result appears on the agent page.
 */
export function McpConsole({
  endpoint,
  agents,
}: {
  endpoint: string;
  agents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? "");
  const [method, setMethod] = useState("tools/call");
  const [tool, setTool] = useState("list_models");
  const [limit, setLimit] = useState(5);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [request, setRequest] = useState("");
  const [response, setResponse] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  const buildPreset = useCallback((): Preset | null => {
    const agentId = selectedAgentId || agents[0]?.id;
    switch (`${method}:${tool}`) {
      case "tools/call:list_models":
        return { label: "Read live models", tool, args: { limit }, note: "Read tool. Normalized catalog with provenance." };
      case "tools/call:list_agents":
        return { label: "List my agents", tool, args: { limit: 10 }, note: "Read tool. Scoped to your session." };
      case "tools/call:get_agent":
        return agentId
          ? { label: "Get an agent", tool, args: { agentId }, note: "Read tool. Returns lanes and a fresh compiled result." }
          : null;
      case "tools/call:compile_policy":
        return agentId
          ? { label: "Compile a policy", tool, args: { agentId, dailyRequests: 2000 }, note: "Analysis tool. Same engine as the UI." }
          : null;
      case "tools/call:verify_integrity":
        return agentId
          ? { label: "Verify one chain", tool, args: { agentId }, note: "Read tool. Reports the first broken link." }
          : null;
      case "tools/call:export_agent":
        return agentId
          ? { label: "Export a manifest", tool, args: { agentId }, note: "Read tool. Returns the portable artifact." }
          : null;
      case "tools/call:upsert_agent":
        return {
          label: "Mutate: patch the deep lane",
          tool,
          args: {
            agentId: agentId ?? undefined,
            lanes: agentId ? { deep: { modelId: null, weight: 0.15 } } : undefined,
            ...(agentId
              ? {}
              : {
                  name: `mcp-agent-${Date.now().toString().slice(-5)}`,
                  taskClass: "Created through the JSON-RPC console to prove the mutation path.",
                  budgetUsd: 60,
                  lanes: { fast: { modelId: null, weight: 0.6 } },
                }),
          },
          note: "Mutating tool. Writes through the same service layer as the UI.",
        };
      case "tools/call:delete_agent":
        return agentId
          ? { label: "Mutate: soft-delete", tool, args: { agentId }, note: "Mutating tool. Retains a tombstone for replay." }
          : null;
      default:
        return null;
    }
  }, [agents, limit, method, selectedAgentId, tool]);

  const preset = buildPreset();

  const send = async (payload: unknown, label: string) => {
    setPending(true);
    setError(null);
    setRequest(JSON.stringify(payload, null, 2));
    setResponse("");
    setDurationMs(null);
    const started = performance.now();
    try {
      const call = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      const text = await call.text();
      setDurationMs(Math.round(performance.now() - started));
      setResponse(text);
      if (!call.ok) {
        setError(`HTTP ${call.status}. The response body above is the server's actual answer.`);
      }
      router.refresh();
    } catch {
      setError("Network error. The console could not reach the endpoint.");
    } finally {
      setPending(false);
    }
    void label;
  };

  return (
    <div className="space-y-5">
      <section className="panel p-5" aria-label="Call builder">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rpc-method" className="silkscreen text-[9px]">
              Method
            </label>
            <select
              id="rpc-method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
            >
              {["initialize", "tools/list", "tools/call", "ping"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rpc-tool" className="silkscreen text-[9px]">
              MCP tool
            </label>
            <select
              id="rpc-tool"
              value={tool}
              onChange={(event) => setTool(event.target.value)}
              disabled={method !== "tools/call"}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[13px] text-ivory-100 disabled:opacity-50"
            >
              {[
                "list_models",
                "list_agents",
                "get_agent",
                "upsert_agent",
                "delete_agent",
                "compile_policy",
                "verify_integrity",
                "export_agent",
              ].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rpc-agent" className="silkscreen text-[9px]">
              Target agent
            </label>
            <select
              id="rpc-agent"
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              disabled={method !== "tools/call"}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[13px] text-ivory-100 disabled:opacity-50"
            >
              <option value="">No agent selected</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rpc-limit" className="silkscreen text-[9px]">
              Limit
            </label>
            <input
              id="rpc-limit"
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              disabled={tool !== "list_models"}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 font-mono text-[13px] text-ivory-100 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="rpc-idempotency" className="silkscreen text-[9px]">
            Idempotency-Key header
          </label>
          <div className="flex gap-2">
            <input
              id="rpc-idempotency"
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
              className="flex-1 rounded border border-rack-300 bg-rack-050 px-3 py-2 font-mono text-[12px] text-ivory-200"
            />
            <button
              type="button"
              onClick={() => setIdempotencyKey(crypto.randomUUID())}
              className="rounded border border-rack-300 px-3 py-2 text-[12px] font-semibold text-ivory-200 hover:border-brass-400"
            >
              New key
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void send(
                method === "tools/call"
                  ? { jsonrpc: "2.0", id: crypto.randomUUID().slice(0, 8), method, params: { name: tool, arguments: preset?.args ?? {} } }
                  : { jsonrpc: "2.0", id: crypto.randomUUID().slice(0, 8), method },
                "primary",
              )
            }
            disabled={pending || (method === "tools/call" && !preset)}
            className="inline-flex items-center gap-2 rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {pending ? "Calling…" : "Send call"}
          </button>

          {preset ? (
            <span className="self-center text-[12px] text-ivory-400">
              <span className="text-ivory-200">{preset.label}</span> — {preset.note}
            </span>
          ) : (
            <span className="self-center text-[12px] text-signal-amber">
              Select an agent to enable the agent-scoped tools.
            </span>
          )}
        </div>
      </section>

      {error ? <ErrorNotice title="Call did not succeed" detail={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5" role="region" aria-label="JSON-RPC request">
          <div className="flex items-center justify-between gap-3">
            <h2 className="silkscreen">Request</h2>
            <span className="silkscreen text-[9px]">POST {endpoint}</span>
          </div>
          <pre className="mt-3 max-h-80 overflow-auto rounded border border-rack-200 bg-rack-000 p-3 font-mono text-[11px] leading-relaxed text-ivory-200">
            {request || "Press “Send call” to issue a request."}
          </pre>
        </section>
        <section className="panel p-5" role="region" aria-label="JSON-RPC response">
          <div className="flex items-center justify-between gap-3">
            <h2 className="silkscreen">Response</h2>
            <span className="silkscreen text-[9px]">
              {durationMs === null ? "—" : `${durationMs}ms`}
            </span>
          </div>
          <pre
            className="mt-3 max-h-80 overflow-auto rounded border border-rack-200 bg-rack-000 p-3 font-mono text-[11px] leading-relaxed text-ivory-200"
            aria-live="polite"
          >
            {response || "No response yet."}
          </pre>
        </section>
      </div>
    </div>
  );
}