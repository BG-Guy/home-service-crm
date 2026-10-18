import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { cashRemittances, payments } from "@/db/schema";
import {
  type CustodyCollection,
  type CustodyResult,
  custodyBalance,
  remittanceCredit,
} from "../engine";
import { settledSql } from "./ledger";
import { uuidList } from "./util";

// Cash custody per tech (SPEC M16): identical for every worker type.

export async function custodyFor(
  userIds: string[],
  exec: Tx = db,
): Promise<Record<string, CustodyResult>> {
  const out: Record<string, CustodyResult> = {};
  for (const id of userIds)
    out[id] = {
      heldCents: 0,
      cashCents: 0,
      checksCents: 0,
      cashHeldCents: 0,
      checksHeldCents: 0,
      oldestAt: null,
      oldestCheckAt: null,
    };
  if (userIds.length === 0) return out;
  const pays = await exec
    .select({
      userId: payments.collectedByUserId,
      method: payments.method,
      amount: payments.amountCents,
      tip: payments.tipCents,
      at: payments.succeededAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.collectedByUserId, userIds),
        inArray(payments.method, ["cash", "check"]),
        inArray(payments.status, ["succeeded", "partially_refunded"]),
      ),
    );
  const rem = await exec
    .select({
      userId: cashRemittances.userId,
      n: sql<number>`coalesce(sum(${cashRemittances.amountCents}), 0)::bigint`,
    })
    .from(cashRemittances)
    .where(
      and(
        inArray(cashRemittances.userId, userIds),
        eq(cashRemittances.status, "confirmed"),
      ),
    )
    .groupBy(cashRemittances.userId);
  const netted = (await exec.execute(sql`
    select le.user_id, coalesce(-sum(le.amount_cents), 0)::bigint as n from ledger_entries le
    where le.user_id in (${uuidList(userIds)}) and le.type in ('cash_held','cash_remitted') and ${settledSql("le")}
    group by le.user_id`)) as unknown as {
    rows: { user_id: string; n: string | number }[];
  };
  const remBy = new Map(rem.map((r) => [r.userId, Number(r.n)]));
  const netBy = new Map(netted.rows.map((r) => [r.user_id, Number(r.n)]));
  for (const id of userIds) {
    const collections: CustodyCollection[] = pays
      .filter((p) => p.userId === id)
      .map((p) => ({
        method: p.method === "check" ? "check" : "cash",
        amountCents: p.amount + p.tip,
        at: p.at ?? p.createdAt,
      }));
    out[id] = custodyBalance({
      collections,
      confirmedRemittancesCents: remBy.get(id) ?? 0,
      nettedInSettlementsCents: netBy.get(id) ?? 0,
    });
  }
  return out;
}

/** Pay credit (cash_remitted) owed for a remittance being confirmed (see engine remittanceCredit). */
export async function creditForRemittance(
  tx: Tx,
  userId: string,
  remittanceId: string,
  amountCents: number,
): Promise<number> {
  const [checks] = await tx
    .select({
      n: sql<number>`coalesce(sum(${payments.amountCents} + ${payments.tipCents}), 0)::bigint`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.collectedByUserId, userId),
        eq(payments.method, "check"),
        inArray(payments.status, ["succeeded", "partially_refunded"]),
      ),
    );
  const [prior] = await tx
    .select({
      n: sql<number>`coalesce(sum(${cashRemittances.amountCents}), 0)::bigint`,
    })
    .from(cashRemittances)
    .where(
      and(
        eq(cashRemittances.userId, userId),
        eq(cashRemittances.status, "confirmed"),
        sql`${cashRemittances.id} <> ${remittanceId}::uuid`,
      ),
    );
  const sums = (await tx.execute(sql`
    select
      coalesce(sum(case when le.type = 'cash_held' then -le.amount_cents else 0 end), 0)::bigint as netted,
      coalesce(sum(case when le.type = 'cash_remitted' then le.amount_cents else 0 end), 0)::bigint as credits
    from ledger_entries le
    where le.user_id = ${userId}::uuid and le.type in ('cash_held','cash_remitted')`)) as unknown as {
    rows: { netted: string | number; credits: string | number }[];
  };
  return remittanceCredit({
    remittanceCents: amountCents,
    checksCollectedCents: Number(checks?.n ?? 0),
    priorRemittedCents: Number(prior?.n ?? 0),
    priorCreditsCents: Number(sums.rows[0]?.credits ?? 0),
    cashNettedCents: Number(sums.rows[0]?.netted ?? 0),
  });
}
