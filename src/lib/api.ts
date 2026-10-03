/**
 * Request helpers: input validation, stable error envelopes, and abuse control.
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { TIERS, type ApiError } from "./types";

export const agentNameSchema = z
  .string()
  .trim()
  .min(3, "Agent name must be at least 3 characters.")
  .max(64, "Agent name must be 64 characters or fewer.")
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._\-/&']*$/u, "Use letters, numbers, spaces, and . _ - / & ' only.");

export const taskClassSchema = z
  .string()
  .trim()
  .min(8, "Describe the task class in at least 8 characters.")
  .max(280, "Task class must be 280 characters or fewer.");

export const notesSchema = z.string().trim().max(2000, "Notes must be 2000 characters or fewer.");

// Normalized ids are `provider:model` where model may contain `-`, `_`, `.`,
// `/`, `:` but never a path segment. Rejecting `..` and leading separators
// blocks traversal-shaped input before it can reach a query or a URL.
export const laneModelIdSchema = z
  .string()
  .trim()
  .min(3, "Model id is too short.")
  .max(200, "Model id is too long.")
  .regex(/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.:/-]+$/, "Model ids look like provider:model-name.")
  .refine((value) => !value.includes(".."), "Model id must not contain '..'.")
  .refine((value) => !value.endsWith("/"), "Model id must not end with '/'.");

const weightSchema = z.number().min(0, "Lane weight cannot be negative.").max(1, "Lane weight cannot exceed 1.");
const dailySchema = z
  .number()
  .int("Daily requests must be a whole number.")
  .min(0, "Daily requests cannot be negative.")
  .max(10_000_000, "Daily requests is unrealistically high.");

const statusEnum = z.enum(["draft", "active", "paused", "archived"]);
const laneShape = {
  fast: z.object({ modelId: laneModelIdSchema.nullable().optional(), weight: weightSchema.optional(), dailyRequests: dailySchema.optional() }).optional(),
  balanced: z.object({ modelId: laneModelIdSchema.nullable().optional(), weight: weightSchema.optional(), dailyRequests: dailySchema.optional() }).optional(),
  deep: z.object({ modelId: laneModelIdSchema.nullable().optional(), weight: weightSchema.optional(), dailyRequests: dailySchema.optional() }).optional(),
};

export const createAgentSchema = z.object({
  name: agentNameSchema,
  taskClass: taskClassSchema,
  notes: notesSchema.optional(),
  status: statusEnum.optional(),
  budgetUsd: z.number().min(1, "Budget must be at least $1.").max(1_000_000, "Budget cap is $1,000,000.").optional(),
  lanes: z.object(laneShape).optional(),
});

export const updateAgentSchema = z
  .object({
    name: agentNameSchema.optional(),
    taskClass: taskClassSchema.optional(),
    notes: notesSchema.optional(),
    status: statusEnum.optional(),
    budgetUsd: z.number().min(1).max(1_000_000).optional(),
    expectedRevision: z.number().int().min(1).optional(),
    lanes: z.object(laneShape).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const compileSchema = z.object({
  agentId: z.string().uuid("agentId must be a UUID.").optional(),
  dailyRequests: z.number().int().min(1).max(1_000_000).optional(),
  lanes: z
    .array(
      z.object({
        tier: z.enum(["fast", "balanced", "deep"]),
        modelId: z.string().max(200).nullable(),
        weight: z.number().min(0).max(1),
        dailyRequests: z.number().int().min(0).max(10_000_000),
      }),
    )
    .length(TIERS.length, "Provide exactly one lane per tier.")
    .optional(),
  budgetUsd: z.number().min(1).max(1_000_000).optional(),
});

export const credentialSchema = z.object({
  provider: z.enum(["openai", "anthropic", "openrouter", "groq", "google", "custom"]),
  label: z.string().trim().min(2, "Label must be at least 2 characters.").max(64, "Label must be 64 characters or fewer."),
  secret: z.string().min(12).max(400),
});

export const mcpToolNameSchema = z.enum([
  "list_models",
  "list_agents",
  "get_agent",
  "upsert_agent",
  "delete_agent",
  "compile_policy",
  "verify_integrity",
  "export_agent",
]);

export const agentStatusValues = z.enum(["draft", "active", "paused", "archived"]);

/** Per-tier lane patch shape shared by the REST and MCP mutation paths. */
export const lanePatchSchema = z.object({
  modelId: laneModelIdSchema.nullable().optional(),
  weight: weightSchema.optional(),
  dailyRequests: dailySchema.optional(),
});

export const lanePatchesSchema = z.object({
  fast: lanePatchSchema.optional(),
  balanced: lanePatchSchema.optional(),
  deep: lanePatchSchema.optional(),
});

export type LanePatches = z.infer<typeof lanePatchesSchema>;

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );
}

export function successResponse<T>(data: T, init?: { status?: number; seal?: string }): NextResponse {
  return NextResponse.json(
    { data, ...(init?.seal ? { seal: init.seal } : {}) },
    { status: init?.status ?? 200 },
  );
}

/**
 * Best-effort per-scope write throttle. In-memory on serverless, so it is a
 * courtesy brake rather than a guarantee; the README documents deploying a
 * hosted rate limiter for real abuse control.
 */
type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 120;

export function throttleWrite(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const window = windows.get(key);
  if (!window || window.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (window.count >= MAX_WRITES_PER_WINDOW) {
    return { allowed: false, retryAfter: Math.ceil((window.resetAt - now) / 1000) };
  }
  window.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/** Read a stable machine code off a domain error without leaking a stack trace. */
export function errorCode(error: unknown, fallback = "internal_error"): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return fallback;
}

export function zodMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid input.";
  const path = first.path.length > 0 ? first.path.join(".") : "body";
  return `${path}: ${first.message}`;
}

export function isTier(value: string): boolean {
  return (TIERS as readonly string[]).includes(value);
}