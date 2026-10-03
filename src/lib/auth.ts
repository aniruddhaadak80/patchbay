/**
 * Better Auth configuration.
 *
 * Accounts are optional. Every visitor gets an anonymous scope cookie and a real
 * database row immediately; `/sign-in` upgrades that anonymous scope into an
 * email+password account and adopts the records created before sign-up. Auth
 * rows live in the same database, over the same adapter, as product rows.
 *
 * The instance is built lazily so importing this module never opens a database
 * connection during `next build`.
 */

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import type { Kysely } from "kysely";
import { getKysely } from "./db/client";

function baseUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

/**
 * Better Auth rejects any request whose Origin is not trusted. Alongside the
 * configured base URL, trust the Vercel preview/production domains and the
 * local dev ports so the auth endpoints work in every environment.
 */
function trustedOrigins(): string[] {
  const origins = new Set<string>([baseUrl()]);
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) origins.add(`https://${process.env.VERCEL_BRANCH_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  const configured = process.env.TRUSTED_ORIGINS;
  if (configured) {
    for (const entry of configured.split(",").map((value) => value.trim())) {
      if (entry.length > 0) origins.add(entry);
    }
  }
  if (process.env.NODE_ENV !== "production") {
    for (const port of ["3000", "3100", "3101", "4173", "5173"]) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return [...origins];
}

function authSecret(): string {
  const configured = process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET must be set to at least 16 characters in production. Generate one with: openssl rand -base64 32",
    );
  }
  return "patchbay-local-development-auth-secret";
}

export type Auth = Awaited<ReturnType<typeof buildAuth>>;

let cached: Promise<Auth> | null = null;

async function buildAuth() {
  const kysely: Kysely<never> = await getKysely();
  return betterAuth({
    appName: "Patchbay",
    baseURL: baseUrl(),
    secret: authSecret(),
    // Better Auth expects `{ db, type }` for a pre-built Kysely instance. A bare
    // Kysely object is not recognised and fails with "Failed to initialize
    // database adapter", because it has neither a `db` nor a `dialect` key.
    database: { db: kysely, type: "postgres" as const },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 10,
      maxPasswordLength: 200,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    trustedOrigins: trustedOrigins(),
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      },
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
    plugins: [nextCookies()],
  });
}

export function getAuth(): Promise<Auth> {
  if (!cached) {
    cached = buildAuth().catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}