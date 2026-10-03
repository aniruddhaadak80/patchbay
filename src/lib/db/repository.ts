/**
 * Typed repository over `SqlClient`. All product queries live here so the REST
 * routes, the MCP tools, and the server components share one implementation and
 * one set of ownership rules.
 */

import { randomUUID } from "node:crypto";
import { getReadySql } from "./client";
import { replayChain } from "../seal";
import { GENESIS_SEAL, sealEvent, type ReplayInput } from "../seal";
import {
  AGENT_STATUSES,
  TIERS,
  type Agent,
  type AgentLane,
  type AgentStatus,
  type AuditEvent,
  type ReplayResult,
  type StoredCredential,
  type Tier,
} from "../types";

export class NotFoundError extends Error {
  readonly code = "not_found";
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly code = "conflict";
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class ValidationError extends Error {
  readonly code = "invalid_input";
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "ValidationError";
  }
}

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  task_class: string;
  notes: string;
  status: string;
  budget_usd: string | number;
  fast_model_id: string | null;
  fast_weight: string | number;
  fast_daily: number;
  balanced_model_id: string | null;
  balanced_weight: string | number;
  balanced_daily: number;
  deep_model_id: string | null;
  deep_weight: string | number;
  deep_daily: number;
  revision: number;
  seal: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

export function rowToAgent(row: AgentRow): Agent {
  const lanes: AgentLane[] = TIERS.map((tier) => ({
    tier,
    modelId: row[`${tier}_model_id` as "fast_model_id"],
    modelLabel: null,
    provider: null,
    weight: Number(row[`${tier}_weight` as "fast_weight"]),
    dailyRequests: Number(row[`${tier}_daily` as "fast_daily"]),
  }));
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    taskClass: row.task_class,
    notes: row.notes,
    status: row.status as AgentStatus,
    budgetUsd: Number(row.budget_usd),
    lanes,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIsoOrNull(row.deleted_at),
    seal: row.seal,
    revision: row.revision,
  };
}

const AGENT_COLUMNS = `id, owner_id, name, task_class, notes, status, budget_usd,
  fast_model_id, fast_weight, fast_daily,
  balanced_model_id, balanced_weight, balanced_daily,
  deep_model_id, deep_weight, deep_daily,
  revision, seal, created_at, updated_at, deleted_at`;

export interface LaneInput {
  modelId?: string | null;
  weight?: number;
  dailyRequests?: number;
}

export type LanePatches = Partial<Record<Tier, LaneInput>>;

export interface CreateAgentInput {
  ownerId: string;
  name: string;
  taskClass: string;
  notes?: string;
  status?: AgentStatus;
  budgetUsd?: number;
  lanes?: LanePatches;
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const sql = await getReadySql();
  const id = randomUUID();
  const now = new Date().toISOString();
  const lane = (tier: Tier) => input.lanes?.[tier] ?? {};

  // The audit payload stored in the row must be byte-identical to the payload
  // that was hashed, or replay cannot reproduce the genesis seal.
  const createPayload = {
    name: input.name,
    taskClass: input.taskClass,
    budgetUsd: input.budgetUsd ?? 50,
    lanes: TIERS.map((tier) => ({
      tier,
      modelId: lane(tier).modelId ?? null,
      weight: lane(tier).weight ?? null,
    })),
  };

  const created = sealEvent(GENESIS_SEAL, {
    seq: 1,
    eventType: "created",
    entityId: id,
    actor: input.ownerId,
    payload: createPayload,
    createdAt: now,
  });

  try {
    await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO agents (id, owner_id, name, task_class, notes, status, budget_usd,
           fast_model_id, fast_weight, fast_daily,
           balanced_model_id, balanced_weight, balanced_daily,
           deep_model_id, deep_weight, deep_daily,
           revision, seal, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1,$17,$18,$18)`,
        [
          id,
          input.ownerId,
          input.name,
          input.taskClass,
          input.notes ?? "",
          input.status ?? "draft",
          input.budgetUsd ?? 50,
          lane("fast").modelId ?? null,
          lane("fast").weight ?? 0.6,
          lane("fast").dailyRequests ?? 1500,
          lane("balanced").modelId ?? null,
          lane("balanced").weight ?? 0.3,
          lane("balanced").dailyRequests ?? 400,
          lane("deep").modelId ?? null,
          lane("deep").weight ?? 0.1,
          lane("deep").dailyRequests ?? 100,
          created,
          now,
        ],
      );
      await tx.query(
        `INSERT INTO audit_events (entity_id, owner_id, seq, event_type, actor, payload, prev_seal, seal, created_at)
         VALUES ($1,$2,1,'created',$3,$4,$5,$6,$7)`,
        [id, input.ownerId, input.ownerId, JSON.stringify(createPayload), GENESIS_SEAL, created, now],
      );
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      throw new ConflictError(
        `An agent named "${input.name}" already exists. Choose another name.`,
      );
    }
    throw error;
  }

  const agent = await getAgent(input.ownerId, id);
  if (!agent) throw new Error("Agent insert did not persist");
  return agent;
}

export async function listAgents(
  ownerId: string,
  options: { status?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<{ agents: Agent[]; total: number }> {
  const sql = await getReadySql();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const clauses: string[] = ["owner_id = $1", "deleted_at IS NULL"];
  const params: unknown[] = [ownerId];

  if (options.status && options.status !== "all") {
    if (!AGENT_STATUSES.includes(options.status as AgentStatus)) {
      throw new ValidationError(`Unknown status "${options.status}".`, {
        allowed: [...AGENT_STATUSES],
      });
    }
    params.push(options.status);
    clauses.push(`status = $${params.length}`);
  }
  if (options.q) {
    params.push(`%${options.q.toLowerCase()}%`);
    clauses.push(`(lower(name) LIKE $${params.length} OR lower(task_class) LIKE $${params.length})`);
  }
  const where = clauses.join(" AND ");

  const rows = await sql.query<AgentRow>(
    `SELECT ${AGENT_COLUMNS} FROM agents WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const totals = await sql.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM agents WHERE ${where}`,
    params,
  );
  return {
    agents: rows.map(rowToAgent),
    total: Number(totals[0]?.count ?? 0),
  };
}

export async function getAgent(ownerId: string, id: string): Promise<Agent | null> {
  const sql = await getReadySql();
  const rows = await sql.query<AgentRow>(
    `SELECT ${AGENT_COLUMNS} FROM agents WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [id, ownerId],
  );
  const row = rows[0];
  return row ? rowToAgent(row) : null;
}

/** Public read for the share route: no owner check, but never exposes notes. */
export async function getSharedAgent(id: string): Promise<Agent | null> {
  const sql = await getReadySql();
  const rows = await sql.query<AgentRow>(
    `SELECT ${AGENT_COLUMNS} FROM agents WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const agent = rowToAgent(row);
  return { ...agent, notes: "", ownerId: "shared" };
}

export interface UpdateAgentInput {
  name?: string;
  taskClass?: string;
  notes?: string;
  status?: AgentStatus;
  budgetUsd?: number;
  lanes?: LanePatches;
  actor?: string;
  expectedRevision?: number;
}

export async function updateAgent(
  ownerId: string,
  id: string,
  input: UpdateAgentInput,
  expectedRevision?: number,
): Promise<Agent> {
  const sql = await getReadySql();
  const current = await getAgent(ownerId, id);
  if (!current) throw new NotFoundError("Agent not found.");

  const guard = expectedRevision ?? input.expectedRevision;
  if (guard !== undefined && guard !== current.revision) {
    throw new ConflictError(
      `Agent was updated by someone else (revision ${current.revision}, you sent ${guard}). Reload and retry.`,
    );
  }

  const next: Agent = {
    ...current,
    name: input.name ?? current.name,
    taskClass: input.taskClass ?? current.taskClass,
    notes: input.notes ?? current.notes,
    status: input.status ?? current.status,
    budgetUsd: input.budgetUsd ?? current.budgetUsd,
    lanes: current.lanes.map((lane) => {
      const patch = input.lanes?.[lane.tier];
      if (!patch) return lane;
      return {
        ...lane,
        modelId: patch.modelId === undefined ? lane.modelId : patch.modelId,
        weight: patch.weight ?? lane.weight,
        dailyRequests: patch.dailyRequests ?? lane.dailyRequests,
      };
    }),
    revision: current.revision + 1,
  };

  const now = new Date().toISOString();
  const seq = current.revision + 1;
  const history = await listAudit(ownerId, id);
  const prevSeal = history.length === 0 ? GENESIS_SEAL : history[history.length - 1].seal;
  const updatePayload = {
    name: next.name,
    taskClass: next.taskClass,
    status: next.status,
    budgetUsd: next.budgetUsd,
    lanes: next.lanes.map((lane) => ({
      tier: lane.tier,
      modelId: lane.modelId,
      weight: lane.weight,
      dailyRequests: lane.dailyRequests,
    })),
  };
  const seal = sealEvent(prevSeal, {
    seq,
    eventType: "updated",
    entityId: id,
    actor: input.actor ?? ownerId,
    payload: updatePayload,
    createdAt: now,
  });

  const laneValue = (tier: Tier) => next.lanes.find((lane) => lane.tier === tier)!;
  try {
    await sql.transaction(async (tx) => {
      await tx.query(
        `UPDATE agents SET name=$3, task_class=$4, notes=$5, status=$6, budget_usd=$7,
           fast_model_id=$8, fast_weight=$9, fast_daily=$10,
           balanced_model_id=$11, balanced_weight=$12, balanced_daily=$13,
           deep_model_id=$14, deep_weight=$15, deep_daily=$16,
           revision=$17, seal=$18, updated_at=$19
         WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL`,
        [
          id,
          ownerId,
          next.name,
          next.taskClass,
          next.notes,
          next.status,
          next.budgetUsd,
          laneValue("fast").modelId,
          laneValue("fast").weight,
          laneValue("fast").dailyRequests,
          laneValue("balanced").modelId,
          laneValue("balanced").weight,
          laneValue("balanced").dailyRequests,
          laneValue("deep").modelId,
          laneValue("deep").weight,
          laneValue("deep").dailyRequests,
          next.revision,
          seal,
          now,
        ],
      );
      await tx.query(
        `INSERT INTO audit_events (entity_id, owner_id, seq, event_type, actor, payload, prev_seal, seal, created_at)
         VALUES ($1,$2,$3,'updated',$4,$5,$6,$7,$8)`,
        [id, ownerId, seq, input.actor ?? ownerId, JSON.stringify(updatePayload), prevSeal, seal, now],
      );
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      throw new ConflictError(`An agent named "${next.name}" already exists. Choose another name.`);
    }
    throw error;
  }

  const updated = await getAgent(ownerId, id);
  if (!updated) throw new Error("Agent update did not persist");
  return updated;
}

/**
 * Soft delete. The row and every audit event are retained so the seal chain
 * remains replayable after deletion; the record disappears from all owner reads.
 */
export async function deleteAgent(ownerId: string, id: string): Promise<{ id: string; seal: string }> {
  const sql = await getReadySql();
  const current = await getAgent(ownerId, id);
  if (!current) throw new NotFoundError("Agent not found.");

  const now = new Date().toISOString();
  const history = await listAudit(ownerId, id);
  const seq = history.length + 1;
  const prevSeal = history.length === 0 ? GENESIS_SEAL : history[history.length - 1].seal;
  const seal = sealEvent(prevSeal, {
    seq,
    eventType: "deleted",
    entityId: id,
    actor: ownerId,
    payload: { name: current.name, tombstone: true },
    createdAt: now,
  });

  await sql.transaction(async (tx) => {
    await tx.query(
      `UPDATE agents SET deleted_at=$3, status='archived', updated_at=$3, revision=revision+1, seal=$4
       WHERE id=$1 AND owner_id=$2`,
      [id, ownerId, now, seal],
    );
    await tx.query(
      `INSERT INTO audit_events (entity_id, owner_id, seq, event_type, actor, payload, prev_seal, seal, created_at)
       VALUES ($1,$2,$3,'deleted',$4,$5,$6,$7,$8)`,
      [
        id,
        ownerId,
        seq,
        ownerId,
        JSON.stringify({ name: current.name, tombstone: true }),
        prevSeal,
        seal,
        now,
      ],
    );
  });

  return { id, seal };
}

interface AuditRow {
  seq: number;
  event_type: string;
  entity_id: string;
  actor: string;
  payload: Record<string, unknown>;
  prev_seal: string;
  seal: string;
  created_at: Date | string;
}

export async function listAudit(ownerId: string, entityId: string): Promise<AuditEvent[]> {
  const sql = await getReadySql();
  const rows = await sql.query<AuditRow>(
    `SELECT seq, event_type, entity_id, actor, payload, prev_seal, seal, created_at
     FROM audit_events WHERE entity_id=$1 AND owner_id=$2 ORDER BY seq ASC`,
    [entityId, ownerId],
  );
  return rows.map((row) => ({
    seq: row.seq,
    eventType: row.event_type as AuditEvent["eventType"],
    entityId: row.entity_id,
    actor: row.actor,
    payload: row.payload,
    prevSeal: row.prev_seal,
    seal: row.seal,
    createdAt: toIso(row.created_at),
  }));
}

/** Owner-scoped replay. Uses only stored rows, never an in-memory cache. */
export async function replayAgent(ownerId: string, entityId: string): Promise<ReplayResult> {
  const events = await listAudit(ownerId, entityId);
  const input: ReplayInput[] = events.map((event) => ({ ...event, sealLink: event.seal }));
  const result = replayChain(GENESIS_SEAL, input);
  return {
    entityId,
    ok: result.ok,
    checked: result.checked,
    brokenAtSeq: result.brokenAtSeq,
    reason: result.reason,
    headSeal: result.headSeal,
    genesisSeal: GENESIS_SEAL,
  };
}

export async function listAllAgentsForReplay(ownerId: string): Promise<Agent[]> {
  const sql = await getReadySql();
  const rows = await sql.query<AgentRow>(
    `SELECT ${AGENT_COLUMNS} FROM agents WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
    [ownerId],
  );
  return rows.map(rowToAgent);
}

// --- credentials ----------------------------------------------------------

export async function createCredential(input: {
  ownerId: string;
  provider: string;
  label: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  fingerprint: string;
  last4: string;
}): Promise<StoredCredential> {
  const sql = await getReadySql();
  const id = randomUUID();
  try {
    await sql.query(
      `INSERT INTO credentials (id, owner_id, provider, label, ciphertext, iv, auth_tag, fingerprint, last4)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        input.ownerId,
        input.provider,
        input.label,
        input.ciphertext,
        input.iv,
        input.authTag,
        input.fingerprint,
        input.last4,
      ],
    );
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      throw new ConflictError(
        `A credential for ${input.provider} is already stored. Delete it before adding another.`,
      );
    }
    throw error;
  }
  const rows = await sql.query<{
    id: string;
    owner_id: string;
    provider: string;
    label: string;
    fingerprint: string;
    last4: string;
    created_at: Date | string;
    deleted_at: Date | string | null;
  }>(
    `SELECT id, owner_id, provider, label, fingerprint, last4, created_at, deleted_at
     FROM credentials WHERE id=$1`,
    [id],
  );
  const row = rows[0];
  return {
    id: row.id,
    ownerId: row.owner_id,
    provider: row.provider,
    label: row.label,
    fingerprint: row.fingerprint,
    last4: row.last4,
    createdAt: toIso(row.created_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  };
}

export async function listCredentials(ownerId: string): Promise<StoredCredential[]> {
  const sql = await getReadySql();
  const rows = await sql.query<{
    id: string;
    owner_id: string;
    provider: string;
    label: string;
    fingerprint: string;
    last4: string;
    created_at: Date | string;
    deleted_at: Date | string | null;
  }>(
    `SELECT id, owner_id, provider, label, fingerprint, last4, created_at, deleted_at
     FROM credentials WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [ownerId],
  );
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    provider: row.provider,
    label: row.label,
    fingerprint: row.fingerprint,
    last4: row.last4,
    createdAt: toIso(row.created_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  }));
}

export async function deleteCredential(ownerId: string, id: string): Promise<void> {
  const sql = await getReadySql();
  const rows = await sql.query<{ id: string }>(
    `UPDATE credentials SET deleted_at=now() WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL RETURNING id`,
    [id, ownerId],
  );
  if (rows.length === 0) throw new NotFoundError("Credential not found.");
}

// --- idempotency ----------------------------------------------------------

export async function readIdempotent(
  ownerId: string,
  key: string,
  endpoint: string,
): Promise<Record<string, unknown> | null> {
  const sql = await getReadySql();
  const rows = await sql.query<{ response: Record<string, unknown> }>(
    `SELECT response FROM idempotency_keys WHERE key=$1 AND owner_id=$2 AND endpoint=$3`,
    [key, ownerId, endpoint],
  );
  return rows[0]?.response ?? null;
}

export async function writeIdempotent(
  ownerId: string,
  key: string,
  endpoint: string,
  response: Record<string, unknown>,
): Promise<void> {
  const sql = await getReadySql();
  await sql.query(
    `INSERT INTO idempotency_keys (key, owner_id, endpoint, response)
     VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING`,
    [key, ownerId, endpoint, JSON.stringify(response)],
  );
}

// --- catalog snapshot -----------------------------------------------------

export async function saveCatalogSnapshot(id: string, status: string, fetchedAt: string, payload: unknown): Promise<void> {
  const sql = await getReadySql();
  await sql.query(
    `INSERT INTO catalog_snapshots (id, status, fetched_at, payload) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, fetched_at=EXCLUDED.fetched_at, payload=EXCLUDED.payload`,
    [id, status, fetchedAt, JSON.stringify(payload)],
  );
}

export async function pruneCatalogSnapshots(keep = 5): Promise<void> {
  const sql = await getReadySql();
  await sql.query(
    `DELETE FROM catalog_snapshots WHERE id NOT IN (
       SELECT id FROM catalog_snapshots ORDER BY fetched_at DESC LIMIT $1
     )`,
    [keep],
  );
}