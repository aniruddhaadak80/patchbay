/**
 * Session ownership.
 *
 * Every record is owned either by a Better Auth account or by an anonymous
 * server session whose id lives in an HTTP-only cookie minted by middleware.
 * The cookie is HMAC-signed and re-verified with a constant-time compare, and it
 * is never accepted from the query string, so a client cannot claim another
 * visitor's scope.
 */

import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql, migrate } from "./db/client";

const COOKIE_NAME = "patchbay_scope";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function secret(): string {
  const configured = process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set to a value of at least 16 characters in production.");
  }
  // Deterministic dev fallback so local sessions survive a restart. Never used in production.
  return "patchbay-local-development-scope-secret";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Thrown when a request carries no usable scope cookie. */
export class MissingScopeError extends Error {
  readonly code = "missing_scope";
  constructor(message: string) {
    super(message);
    this.name = "MissingScopeError";
  }
}

/**
 * Reads and verifies the scope cookie. Read-only, so it is safe inside a Server
 * Component. Throws {@link MissingScopeError} when the cookie is absent or its
 * signature does not verify.
 */
export async function getScopeId(): Promise<string> {
  const id = await peekSignedScope();
  if (!id) {
    throw new MissingScopeError(
      "No valid anonymous scope cookie. Load a page first so the scope can be issued, or send the patchbay_scope cookie.",
    );
  }
  return id;
}

/**
 * Reads the scope cookie, minting a new signed one when absent.
 * Only legal in a Route Handler or Server Action, which are the contexts where
 * Next.js permits writing cookies.
 */
export async function getOrCreateScopeId(): Promise<string> {
  const existing = await peekSignedScope();
  if (existing) return existing;

  const id = `anon_${randomBytes(16).toString("hex")}`;
  const store = await cookies();
  store.set(COOKIE_NAME, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return id;
}

async function peekSignedScope(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const separator = raw.indexOf(".");
  if (separator <= 0) return null;
  const id = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  return safeEqual(signature, sign(id)) ? id : null;
}

/**
 * Ensures the anonymous scope has a real database row. Called from route
 * handlers, which may write, the first time an anon scope writes.
 */
export async function ensureScopeRow(scopeId: string): Promise<void> {
  if (!scopeId.startsWith("anon_")) return;
  const sql = await getSql();
  await migrate(sql);
  await sql.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "isAnonymous")
     VALUES ($1,$2,$3,false,true) ON CONFLICT (id) DO NOTHING`,
    [scopeId, "Anonymous operator", `${scopeId}@anonymous.patchbay.local`],
  );
}

export function isAnonScope(ownerId: string): boolean {
  return ownerId.startsWith("anon_");
}