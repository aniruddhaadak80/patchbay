/**
 * MCP-style JSON-RPC 2.0 endpoint.
 *
 * Implements `initialize`, `tools/list`, and `tools/call` over POST. Tools call
 * the same repository and the same engine as the REST routes, so a mutation made
 * by an agent is visible in the UI immediately.
 *
 * Tools: list_models (read), list_agents (read), get_agent (read),
 *        upsert_agent (mutate, idempotent), delete_agent (mutate),
 *        compile_policy (analysis), verify_integrity (read), export_agent (read).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAgentSchema,
  mcpToolNameSchema,
  successResponse,
  throttleWrite,
  updateAgentSchema,
  zodMessage,
} from "@/lib/api";
import { getCatalog } from "@/lib/catalog";
import {
  ConflictError,
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  NotFoundError,
  readIdempotent,
  replayAgent,
  updateAgent,
  ValidationError,
  writeIdempotent,
} from "@/lib/db/repository";
import { compilePolicy, ENGINE_VERSION } from "@/lib/engine";
import { buildManifest, compileFor } from "@/lib/manifest";
import { ensureScopeRow, getOrCreateScopeId } from "@/lib/scope";
import { site } from "@/lib/site";
import { TIERS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const JSON_RPC_ERRORS: Record<number, { code: number; message: string }> = {
  32700: { code: -32700, message: "Parse error" },
  32600: { code: -32600, message: "Invalid Request" },
  32601: { code: -32601, message: "Method not found" },
  32602: { code: -32602, message: "Invalid params" },
  32603: { code: -32603, message: "Internal error" },
};

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  const known = Object.values(JSON_RPC_ERRORS).find((entry) => entry.code === code);
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code: known?.code ?? code, message: known?.message ?? message, ...(data ? { data } : {}) },
  };
}

export async function GET() {
  return successResponse({
    protocol: "MCP-style JSON-RPC 2.0",
    transport: "HTTP POST",
    endpoint: `${site.liveUrl}/api/mcp`,
    methods: ["initialize", "tools/list", "tools/call", "ping"],
    tools: TOOLS.map((tool) => tool.name),
    note: "Sessions are scoped to the HTTP-only scope cookie or a signed-in account. Tools never see another owner's records.",
  });
}

const TOOLS = [
  {
    name: "list_models",
    description:
      "Read the live model catalog normalized from OpenRouter and models.dev. Returns priced models with context windows and capabilities.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Free-text filter over id, name, and provider." },
        capability: {
          type: "string",
          enum: ["tools", "reasoning", "vision", "json", "longContext"],
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_agents",
    description: "List routing agents owned by the current session, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "active", "paused", "archived", "all"] },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_agent",
    description: "Fetch one agent with its resolved lanes and a fresh compiled policy result.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", format: "uuid" } },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "upsert_agent",
    description:
      "Create or update an agent and its lane assignments. Pass `agentId` to update, omit it to create. Honours the Idempotency-Key header so a retried call does not double-write.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", format: "uuid" },
        name: { type: "string", minLength: 3, maxLength: 64 },
        taskClass: { type: "string", minLength: 8, maxLength: 280 },
        notes: { type: "string", maxLength: 2000 },
        status: { type: "string", enum: ["draft", "active", "paused", "archived"] },
        budgetUsd: { type: "number", minimum: 1, maximum: 1000000 },
        expectedRevision: { type: "integer", minimum: 1 },
        lanes: {
          type: "object",
          properties: {
            fast: { $ref: "#/$defs/lane" },
            balanced: { $ref: "#/$defs/lane" },
            deep: { $ref: "#/$defs/lane" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
      $defs: {
        lane: {
          type: "object",
          properties: {
            modelId: { type: ["string", "null"], maxLength: 200 },
            weight: { type: "number", minimum: 0, maximum: 1 },
            dailyRequests: { type: "integer", minimum: 0, maximum: 10000000 },
          },
          additionalProperties: false,
        },
      },
    },
  },
  {
    name: "delete_agent",
    description:
      "Soft-delete an agent. The row and its audit trail are retained so the seal chain stays replayable; the agent disappears from all owner reads.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", format: "uuid" } },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "compile_policy",
    description:
      `Run ${ENGINE_VERSION} over an agent (by id) or an inline lane board. Returns a versioned score, itemized weighted factors, a verdict, warnings, and a seal reference.`,
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", format: "uuid" },
        dailyRequests: { type: "integer", minimum: 1, maximum: 1000000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "verify_integrity",
    description:
      "Replay the SHA-384 seal chain for an agent and report the first broken link, or verify every agent owned by the session.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", format: "uuid" } },
      additionalProperties: false,
    },
  },
  {
    name: "export_agent",
    description:
      "Produce the routing manifest for an agent: lanes, compiled score, factors, and seal. This is the portable artifact you can commit or ship.",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string", format: "uuid" } },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
];

const argsSchema = z.record(z.string(), z.unknown());

async function callTool(
  name: z.infer<typeof mcpToolNameSchema>,
  rawArgs: unknown,
  ownerId: string,
  idempotencyKey: string | null,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: unknown }> {
  const parsedArgs = argsSchema.safeParse(rawArgs ?? {});
  const args = parsedArgs.success ? parsedArgs.data : {};
  const ok = (structuredContent: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  });

  switch (name) {
    case "list_models": {
      const snapshot = await getCatalog();
      const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 50) : 20;
      const q = typeof args.q === "string" ? args.q.toLowerCase() : null;
      const capability =
        typeof args.capability === "string"
          ? (["tools", "reasoning", "vision", "json", "longContext"] as const).find(
              (value) => value === args.capability,
            )
          : undefined;
      let models = snapshot.models;
      if (q) {
        models = models.filter((model) =>
          `${model.id} ${model.name} ${model.providerLabel}`.toLowerCase().includes(q),
        );
      }
      if (capability) models = models.filter((model) => model.capabilities.includes(capability));
      return ok({
        status: snapshot.status,
        fetchedAt: snapshot.fetchedAt,
        sources: snapshot.sources,
        totalPricedModels: snapshot.models.length,
        models: models.slice(0, limit),
      });
    }

    case "list_agents": {
      const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 100) : 25;
      const status = typeof args.status === "string" ? args.status : undefined;
      const result = await listAgents(ownerId, { status, limit });
      return ok(result);
    }

    case "get_agent": {
      const agentId = typeof args.agentId === "string" ? args.agentId : "";
      const agent = await getAgent(ownerId, agentId);
      if (!agent) return { content: [{ type: "text", text: `Agent ${agentId} not found.` }], isError: true };
      const snapshot = await getCatalog();
      const compiled = compilePolicy({ agent, models: snapshot.models, actor: ownerId });
      return ok({ agent, compiled, catalogStatus: snapshot.status });
    }

    case "upsert_agent": {
      const throttle = throttleWrite(`agents:${ownerId}`);
      if (!throttle.allowed) {
        return { content: [{ type: "text", text: `Rate limited. Retry in ${throttle.retryAfter}s.` }], isError: true };
      }
      const agentId = typeof args.agentId === "string" ? args.agentId : null;
      const snapshot = await getCatalog();
      const known = new Set(snapshot.models.map((model) => model.id));

      if (agentId) {
        const body = { ...args };
        delete (body as Record<string, unknown>).agentId;
        const parsed = updateAgentSchema.safeParse(body);
        if (!parsed.success) {
          return { content: [{ type: "text", text: zodMessage(parsed.error) }], isError: true };
        }
        const unknown = TIERS.flatMap((tier) => {
          const modelId = parsed.data.lanes?.[tier]?.modelId;
          return modelId && !known.has(modelId) ? [{ tier, modelId }] : [];
        });
        if (unknown.length > 0) {
          return {
            content: [
              { type: "text", text: `Unknown model ids for the ${snapshot.status} catalog: ${unknown.map((entry) => `${entry.tier}=${entry.modelId}`).join(", ")}.` },
            ],
            isError: true,
          };
        }
        try {
          const { expectedRevision, ...rest } = parsed.data;
          const updated = await updateAgent(ownerId, agentId, { ...rest, actor: "mcp:upsert_agent" }, expectedRevision);
          const compiled = compilePolicy({ agent: updated, models: snapshot.models, actor: "mcp:upsert_agent" });
          return ok({ agent: updated, compiled, created: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Update failed.";
          const isError = true;
          return { content: [{ type: "text", text: message }], isError };
        }
      }

      if (idempotencyKey) {
        const replayed = await readIdempotent(ownerId, idempotencyKey, "mcp:upsert_agent");
        if (replayed) return ok({ ...replayed, replayed: true });
      }
      const parsed = createAgentSchema.safeParse(args);
      if (!parsed.success) {
        return { content: [{ type: "text", text: zodMessage(parsed.error) }], isError: true };
      }
      const unknown = TIERS.flatMap((tier) => {
        const modelId = parsed.data.lanes?.[tier]?.modelId;
        return modelId && !known.has(modelId) ? [{ tier, modelId }] : [];
      });
      if (unknown.length > 0) {
        return {
          content: [{ type: "text", text: `Unknown model ids: ${unknown.map((entry) => `${entry.tier}=${entry.modelId}`).join(", ")}.` }],
          isError: true,
        };
      }
      const agent = await createAgent({
        ownerId,
        name: parsed.data.name,
        taskClass: parsed.data.taskClass,
        notes: parsed.data.notes ?? "",
        status: parsed.data.status,
        budgetUsd: parsed.data.budgetUsd,
        lanes: parsed.data.lanes,
      });
      const compiled = compilePolicy({ agent, models: snapshot.models, actor: "mcp:upsert_agent" });
      const body = { agent, compiled, created: true };
      if (idempotencyKey) await writeIdempotent(ownerId, idempotencyKey, "mcp:upsert_agent", body);
      return ok(body);
    }

    case "delete_agent": {
      const agentId = typeof args.agentId === "string" ? args.agentId : "";
      const throttle = throttleWrite(`agents:${ownerId}`);
      if (!throttle.allowed) {
        return { content: [{ type: "text", text: `Rate limited. Retry in ${throttle.retryAfter}s.` }], isError: true };
      }
      try {
        const result = await deleteAgent(ownerId, agentId);
        return ok({ id: result.id, deleted: true, tombstone: true, seal: result.seal });
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "Delete failed." }],
          isError: true,
        };
      }
    }

    case "compile_policy": {
      const agentId = typeof args.agentId === "string" ? args.agentId : null;
      if (!agentId) {
        return { content: [{ type: "text", text: "compile_policy requires agentId." }], isError: true };
      }
      const agent = await getAgent(ownerId, agentId);
      if (!agent) return { content: [{ type: "text", text: `Agent ${agentId} not found.` }], isError: true };
      const snapshot = await getCatalog();
      const compiled = compilePolicy({
        agent,
        models: snapshot.models,
        dailyRequests: typeof args.dailyRequests === "number" ? args.dailyRequests : undefined,
        actor: "mcp:compile_policy",
      });
      return ok({ compiled, engineVersion: ENGINE_VERSION, catalogStatus: snapshot.status });
    }

    case "verify_integrity": {
      const agentId = typeof args.agentId === "string" ? args.agentId : null;
      if (agentId) {
        const result = await replayAgent(ownerId, agentId);
        return ok(result);
      }
      const agents = await listAgents(ownerId, { limit: 100 });
      const results = [];
      for (const agent of agents.agents) {
        results.push(await replayAgent(ownerId, agent.id));
      }
      return ok({
        checked: results.length,
        allOk: results.every((result) => result.ok),
        results,
      });
    }

    case "export_agent": {
      const agentId = typeof args.agentId === "string" ? args.agentId : "";
      const agent = await getAgent(ownerId, agentId);
      if (!agent) return { content: [{ type: "text", text: `Agent ${agentId} not found.` }], isError: true };
      const snapshot = await getCatalog();
      const { compiled, lanes } = compileFor(agent, snapshot.models, "mcp:export_agent");
      return ok({
        manifest: buildManifest(
          { ...agent, lanes },
          compiled,
          snapshot.status,
          snapshot.fetchedAt,
          snapshot.sources,
        ),
      });
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool ${name}.` }], isError: true };
  }
}

export async function POST(request: Request) {
  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = (await request.json()) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  const batch = Array.isArray(body) ? body : [body];

  if (Array.isArray(body) && body.length === 0) {
    return NextResponse.json(rpcError(null, -32600, "Invalid Request: empty batch"), { status: 400 });
  }

  const ownerId = await getOrCreateScopeId();
  await ensureScopeRow(ownerId);
  const responses: unknown[] = [];

  for (const message of batch) {
    const id = message?.id ?? null;
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      responses.push(rpcError(id, -32600, "Invalid Request"));
      continue;
    }

    try {
      switch (message.method) {
        case "initialize": {
          responses.push(
            rpcResult(id, {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: "patchbay", version: ENGINE_VERSION },
              instructions:
                "Patchbay exposes model routing tools. Call list_models, then upsert_agent with per-tier lane model ids, then compile_policy to score the policy.",
              owner: ownerId.startsWith("anon_") ? "anonymous-session" : "account",
            }),
          );
          break;
        }
        case "notifications/initialized":
          responses.push(rpcResult(id, { acknowledged: true }));
          break;
        case "ping":
          responses.push(rpcResult(id, { pong: true, at: new Date().toISOString() }));
          break;
        case "tools/list":
          responses.push(rpcResult(id, { tools: TOOLS }));
          break;
        case "tools/call": {
          const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
          const parsedName = mcpToolNameSchema.safeParse(params.name);
          if (!parsedName.success) {
            responses.push(
              rpcError(id, -32602, "Invalid params: unknown tool name", {
                available: TOOLS.map((tool) => tool.name),
              }),
            );
            break;
          }
          const outcome = await callTool(parsedName.data, params.arguments, ownerId, idempotencyKey);
          responses.push(rpcResult(id, outcome));
          break;
        }
        default:
          responses.push(rpcError(id, -32601, `Method not found: ${message.method}`));
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        responses.push(rpcError(id, -32602, error.message));
      } else if (error instanceof ConflictError || error instanceof ValidationError) {
        responses.push(rpcError(id, -32602, error.message));
      } else {
        responses.push(rpcError(id, -32603, "Internal error"));
      }
    }
  }

  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}