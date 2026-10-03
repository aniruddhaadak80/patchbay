import { headers } from "next/headers";
import { errorResponse, successResponse } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { adoptAnonymousRecords } from "@/lib/db/adopt";
import { getKysely, getReadySql } from "@/lib/db/client";
import { getOrCreateScopeId } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * After sign-up, move everything created under the anonymous scope cookie to the
 * newly created account. Requires a valid session and an anon scope id, so it
 * can never move another owner's records.
 */
export async function POST() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return errorResponse(401, "unauthenticated", "Sign in first, then adopt your anonymous records.");
  }

  const anonId = await getOrCreateScopeId();
  if (!anonId.startsWith("anon_")) {
    return successResponse({
      adopted: false,
      reason: "This session is not an anonymous scope, so there is nothing to adopt.",
    });
  }

  const kysely = await getKysely();
  const adopted = await adoptAnonymousRecords(anonId, session.user.id, kysely);

  // Drop the placeholder user row so the user table holds one row per person.
  const sql = await getReadySql();
  await sql.query(`DELETE FROM "user" WHERE id = $1 AND "isAnonymous" = true`, [anonId]);

  return successResponse({ adopted: true, ...adopted });
}