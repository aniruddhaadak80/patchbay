import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api";
import {
  ADAPTER_LABELS,
  adapterSafety,
  databaseUrl,
  getReadySql,
  isHostedDatabaseUrl,
  resolveAdapter,
} from "@/lib/db/client";
import { FALLBACK_SNAPSHOT } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check that exercises the real production persistence path rather than
 * returning a static success object: it runs a write/read/delete round trip.
 */
export async function GET() {
  const started = Date.now();
  const adapter = resolveAdapter();
  const checks: Record<string, unknown> = {};

  try {
    const sql = await getReadySql();
    const probeId = `health_${Date.now()}`;
    await sql.query(
      `INSERT INTO catalog_snapshots (id, status, fetched_at, payload)
       VALUES ($1,'probe',now(),'{}'::jsonb)`,
      [probeId],
    );
    const readBack = await sql.query<{ id: string }>(
      `SELECT id FROM catalog_snapshots WHERE id=$1`,
      [probeId],
    );
    await sql.query(`DELETE FROM catalog_snapshots WHERE id=$1`, [probeId]);
    const confirmedAbsent = await sql.query<{ id: string }>(
      `SELECT id FROM catalog_snapshots WHERE id=$1`,
      [probeId],
    );
    checks.persistence = {
      adapter,
      label: ADAPTER_LABELS[adapter],
      hosted: adapter === "neon" ? isHostedDatabaseUrl(databaseUrl()) : false,
      durability: adapter === "neon" ? "hosted-persistent" : "embedded-disk",
      safety: adapterSafety(),
      roundTrip: readBack.length === 1 && confirmedAbsent.length === 0 ? "ok" : "failed",
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    checks.persistence = {
      adapter,
      label: ADAPTER_LABELS[adapter],
      safety: adapterSafety(),
      roundTrip: "failed",
      error: error instanceof Error ? error.message : "unknown persistence error",
    };
    return NextResponse.json(
      {
        status: "degraded",
        checks,
        fallbackCatalogAvailable: FALLBACK_SNAPSHOT.models.length,
      },
      { status: 503 },
    );
  }

  const agentRows = await (async () => {
    try {
      const sql = await getReadySql();
      const rows = await sql.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM agents WHERE deleted_at IS NULL`,
      );
      return Number(rows[0]?.count ?? 0);
    } catch {
      return null;
    }
  })();

  return successResponse({
    status: "ok",
    checkedAt: new Date().toISOString(),
    adapter,
    adapterLabel: ADAPTER_LABELS[adapter],
    checks,
    agents: agentRows,
    fallbackCatalogSize: FALLBACK_SNAPSHOT.models.length,
    engine: "policy-compiler@1.0.0",
  });
}