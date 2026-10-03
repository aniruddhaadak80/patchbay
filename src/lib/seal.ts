/**
 * Canonical JSON + SHA-384 seal chain.
 *
 * seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
 *
 * Canonical JSON recursively sorts object keys, preserves array order, and
 * serializes numbers/dates deterministically so two runs on two machines
 * produce byte-identical input to the hash.
 */

import { createHash } from "node:crypto";

export const GENESIS_SEAL = "0".repeat(96);

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry === undefined) continue;
      out[key] = canonicalize(entry);
    }
    return out;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Avoid -0 and float drift producing different bytes across engines.
    return value === 0 ? 0 : value;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function sha384Hex(input: string): string {
  return createHash("sha384").update(Buffer.from(input, "utf8")).digest("hex");
}

/** One link in the chain: the previous digest concatenated with this event. */
export function chainSeal(prevSeal: string, event: unknown): string {
  return sha384Hex(prevSeal + canonicalJson(event));
}

export interface SealableEvent {
  seq: number;
  eventType: string;
  entityId: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** The exact object that is hashed, so replay recomputes an identical input. */
export function sealEventBody(event: SealableEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    eventType: event.eventType,
    entityId: event.entityId,
    actor: event.actor,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}

export function sealEvent(prevSeal: string, event: SealableEvent): string {
  return chainSeal(prevSeal, sealEventBody(event));
}

/**
 * Walk a stored event list and report the first broken link.
 * Detects rewrites, reordering, deletions from the middle, and seal tampering.
 */
export type ReplayInput = SealableEvent & { sealLink: string };

export function replayChain(
  genesisSeal: string,
  events: readonly ReplayInput[],
  expectedHead?: string,
): { ok: boolean; checked: number; brokenAtSeq: number | null; reason: string | null; headSeal: string } {
  let prev = genesisSeal;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.seq !== index + 1) {
      return {
        ok: false,
        checked: index,
        brokenAtSeq: event.seq,
        reason: `sequence gap: expected seq ${index + 1}, found ${event.seq}`,
        headSeal: prev,
      };
    }
    const expected = sealEvent(prev, event);
    if (expected !== event.sealLink) {
      return {
        ok: false,
        checked: index,
        brokenAtSeq: event.seq,
        reason: `seal mismatch at seq ${event.seq}: recomputed ${expected.slice(0, 16)}…, stored ${String(event.sealLink).slice(0, 16)}…`,
        headSeal: prev,
      };
    }
    prev = expected;
  }
  if (expectedHead && expectedHead !== prev) {
    return {
      ok: false,
      checked: events.length,
      brokenAtSeq: null,
      reason: `head seal mismatch: expected ${expectedHead}, chain produces ${prev}`,
      headSeal: prev,
    };
  }
  return { ok: true, checked: events.length, brokenAtSeq: null, reason: null, headSeal: prev };
}