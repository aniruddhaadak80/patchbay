/**
 * Database access layer.
 *
 * One typed `SqlClient` interface with two adapters:
 *   - `neon`   hosted Postgres (production). Selected only when DATABASE_URL is
 *              set and points at a hosted instance.
 *   - `pglite` embedded Postgres in the local process, persisted to disk. Zero
 *              configuration, used by `npm run dev` and the test suite.
 *
 * PGlite is never selected in a production build: `assertProductionAdapter`
 * throws when NODE_ENV=production resolves to pglite, so a misconfigured deploy
 * fails loudly instead of silently losing writes on cold start.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { Kysely } from "kysely";

export type AdapterId = "neon" | "pglite";

export interface SqlClient {
  adapter: AdapterId;
  /** Parameterized query. Returns rows. */
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs `fn` inside a transaction when the adapter supports it. */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  /**
   * Runs a multi-statement script in one round trip. Used for migrations, where
   * per-statement round trips dominate cold-start time on the embedded adapter.
   */
  exec?(script: string): Promise<void>;
}

export const ADAPTER_LABELS: Record<AdapterId, string> = {
  neon: "Neon Postgres (hosted)",
  pglite: "PGlite (embedded Postgres, local disk)",
};

const HOSTED_HOST_PATTERN =
  /neon\.tech|prisma\.data|supabase\.com|amazonaws\.com|azure\.com|gcp\.com|databricks\.com|cloudsql\.postgres|ondigitalocean\.com/i;

export function isHostedDatabaseUrl(url: string): boolean {
  if (!/^postgres(ql)?:\/\//i.test(url)) return false;
  return HOSTED_HOST_PATTERN.test(url);
}

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
}

type GlobalCache = {
  __patchbaySql?: Promise<SqlClient>;
  __patchbayKysely?: Promise<Kysely<never>>;
  __patchbayPglite?: Promise<unknown>;
};

const globalCache = globalThis as unknown as GlobalCache;

function pgliteDataDir(): string {
  const configured = process.env.PGLITE_DATA_DIR;
  if (!configured) return join(process.cwd(), ".patchbay", "pglite");
  // A relative value is resolved against the project root, and the parent
  // directory is created here: PGlite fails with a bare ENOENT otherwise.
  const absolute = isAbsolute(configured) ? configured : join(process.cwd(), configured);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

async function createNeonClient(url: string): Promise<SqlClient> {
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10_000 });

  return {
    adapter: "neon",
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await pool.query(text, params as unknown[]);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      const connection = await pool.connect();
      const txClient: SqlClient = {
        adapter: "neon",
        query: async <R>(text: string, params?: readonly unknown[]) =>
          (await connection.query(text, params as unknown[])).rows as R[],
        transaction: async () => {
          throw new Error("Nested transactions are not supported");
        },
      };
      try {
        await connection.query("BEGIN");
        const value = await fn(txClient);
        await connection.query("COMMIT");
        return value;
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}

async function loadPglite(): Promise<unknown> {
  if (!globalCache.__patchbayPglite) {
    globalCache.__patchbayPglite = (async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      return PGlite.create({ dataDir: pgliteDataDir() });
    })();
  }
  return globalCache.__patchbayPglite;
}

type PgliteLike = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(script: string): Promise<unknown>;
  transaction<T>(fn: (tx: PgliteLike) => Promise<T>): Promise<T>;
};

async function createPgliteClient(): Promise<SqlClient> {
  const db = (await loadPglite()) as PgliteLike;
  return {
    adapter: "pglite",
    async query<T>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params as unknown[]);
      return result.rows;
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      return db.transaction(async (rawTx) => {
        const txClient: SqlClient = {
          adapter: "pglite",
          query: async <R>(text: string, params?: readonly unknown[]) => {
            const result = await rawTx.query<R>(text, params as unknown[]);
            return result.rows;
          },
          transaction: async () => {
            throw new Error("Nested transactions are not supported");
          },
        };
        return fn(txClient);
      }) as Promise<T>;
    },
    // PGlite's simple-query protocol accepts a whole script in one round trip,
    // which is what makes local cold start bearable.
    async exec(script: string): Promise<void> {
      await db.exec(script);
    },
  };
}

export function resolveAdapter(): AdapterId {
  const url = databaseUrl();
  if (url.length > 0) return "neon";
  return "pglite";
}

/**
 * Embedded Postgres loses its data on cold start, so it must never be picked
 * silently on a serverless host. Running `next start` locally with NODE_ENV=production
 * is a legitimate self-hosted case, so that requires an explicit opt-in.
 */
export function embeddedAllowed(): boolean {
  return process.env.ALLOW_EMBEDDED_DB === "true" || process.env.PGLITE_DATA_DIR !== undefined;
}

export function assertProductionAdapter(adapter: AdapterId): void {
  if (process.env.NODE_ENV !== "production") return;

  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  const mustUseHosted = serverless && !embeddedAllowed();

  if (adapter !== "neon") {
    if (mustUseHosted) {
      throw new Error(
        "Refusing to serve traffic from the pglite adapter on a serverless host, where cold starts discard it. Set DATABASE_URL to a hosted Postgres connection string.",
      );
    }
    if (!embeddedAllowed()) {
      throw new Error(
        "Refusing to start with the embedded database in production mode. Set DATABASE_URL, or set ALLOW_EMBEDDED_DB=true to accept that data lives in .patchbay/pglite and is lost on redeploy.",
      );
    }
    return;
  }

  if (!isHostedDatabaseUrl(databaseUrl())) {
    throw new Error(
      "DATABASE_URL does not point at a recognized hosted Postgres provider. Refusing to run in production.",
    );
  }
}

/** Human-readable adapter safety state, reported by the health endpoint. */
export function adapterSafety(): {
  serverless: boolean;
  embeddedAllowed: boolean;
  guarded: boolean;
} {
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  const allowed = embeddedAllowed();
  return { serverless, embeddedAllowed: allowed, guarded: serverless && !allowed };
}

export async function getSql(): Promise<SqlClient> {
  if (!globalCache.__patchbaySql) {
    globalCache.__patchbaySql = (async () => {
      const adapter = resolveAdapter();
      assertProductionAdapter(adapter);
      return adapter === "neon" ? createNeonClient(databaseUrl()) : createPgliteClient();
    })().catch((error) => {
      globalCache.__patchbaySql = undefined;
      throw error;
    });
  }
  return globalCache.__patchbaySql;
}

/**
 * A Kysely instance over the same adapter. Better Auth consumes this, so auth
 * rows and product rows live in one database with one migration path.
 */
export async function getKysely(): Promise<Kysely<never>> {
  if (!globalCache.__patchbayKysely) {
    globalCache.__patchbayKysely = (async () => {
      const { Kysely, PGliteDialect, PostgresAdapter, PostgresDriver, PostgresIntrospector, PostgresQueryCompiler } =
        await import("kysely");
      if (resolveAdapter() === "neon") {
        const { Pool } = await import("@neondatabase/serverless");
        const pool = new Pool({ connectionString: databaseUrl(), max: 4 });
        return new Kysely<never>({
          dialect: {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new PostgresDriver({ pool: pool as never }),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
          },
        });
      }
      const db = await loadPglite();
      return new Kysely<never>({ dialect: new PGliteDialect({ pglite: db as never }) });
    })().catch((error) => {
      globalCache.__patchbayKysely = undefined;
      throw error;
    });
  }
  return globalCache.__patchbayKysely;
}

const MIGRATION_FILE = join(process.cwd(), "src", "lib", "db", "migrations", "0001_init.sql");

let migrationPromise: Promise<void> | null = null;

/**
 * Split a migration file into single statements. Both adapters reject a
 * multi-statement string, so the file is split on `--> statement-breakpoint`
 * and any remaining statements inside a chunk are separated on a top-level
 * semicolon. Quoted literals and `--` comments are respected.
 */
export function splitStatements(sql: string): string[] {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const out: string[] = [];
  for (const chunk of stripped.split("--> statement-breakpoint")) {
    let current = "";
    let quote: string | null = null;
    for (const char of chunk) {
      if (quote) {
        current += char;
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        current += char;
        continue;
      }
      if (char === ";") {
        if (current.trim().length > 0) out.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim().length > 0) out.push(current.trim());
  }
  return out;
}

/**
 * Idempotent first-run schema creation. Safe to call on every cold start.
 *
 * Uses the adapter's batched `exec` when available: a script of ~90 statements
 * costs one WASM round trip instead of ninety, which is the difference between
 * a few seconds and minutes of local startup. Falls back to per-statement
 * queries on adapters without `exec`.
 */
export function migrate(sql: SqlClient): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const script = readFileSync(MIGRATION_FILE, "utf8");
      if (sql.exec) {
        await sql.exec(script);
        return;
      }
      for (const statement of splitStatements(script)) {
        await sql.query(statement);
      }
    })().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }
  return migrationPromise;
}

export async function getReadySql(): Promise<SqlClient> {
  const sql = await getSql();
  await migrate(sql);
  return sql;
}