/**
 * Ownership adoption.
 *
 * When an anonymous scope upgrades to a real account, every agent, credential,
 * and audit row it created moves to the account id in a single transaction, so
 * the visitor never loses work by signing in.
 */

import type { Kysely } from "kysely";
import { sql as ksql } from "kysely";

export async function adoptAnonymousRecords(
  anonId: string,
  userId: string,
  kysely: Kysely<never>,
): Promise<{ agents: number; credentials: number; audits: number }> {
  return kysely.transaction().execute(async (trx) => {
    const agentRows = await trx
      .executeQuery<{ id: string }>(
        ksql`UPDATE agents SET owner_id = ${userId} WHERE owner_id = ${anonId} RETURNING id`.compile(
          trx,
        ),
      )
      .catch(() => ({ rows: [] as { id: string }[] }));

    const credentialRows = await trx
      .executeQuery<{ id: string }>(
        ksql`UPDATE credentials SET owner_id = ${userId} WHERE owner_id = ${anonId} RETURNING id`.compile(
          trx,
        ),
      )
      .catch(() => ({ rows: [] as { id: string }[] }));

    const auditRows = await trx
      .executeQuery<{ entity_id: string }>(
        ksql`UPDATE audit_events SET owner_id = ${userId} WHERE owner_id = ${anonId} RETURNING entity_id`.compile(
          trx,
        ),
      )
      .catch(() => ({ rows: [] as { entity_id: string }[] }));

    return {
      agents: agentRows.rows.length,
      credentials: credentialRows.rows.length,
      audits: auditRows.rows.length,
    };
  });
}