import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { ledgerEntries, payPeriods } from "@/db/schema";
import {
  type ExistingJobEntry,
  JOB_LEDGER_TYPES,
  type Posting,
  periodFor,
} from "../engine";
import { settingsOf } from "./util";

// Append-only ledger (SPEC §6.10 ledger_entries; trigger forbids UPDATE/DELETE).
// Settlement membership is NOT written onto entries (they can't be updated): a frozen
// settlement (approved | paid | locked) stores the ids it covers in
// settlements.totals.entry_ids, and "unsettled" = not in any frozen settlement.
// (Integrator decision: kept as-is for v1 — the append-only trigger stays strict.)

export const FROZEN_SETTLEMENT_STATUSES = [
  "approved",
  "paid",
  "locked",
] as const;

/** SQL predicate: entry `alias` is part of a frozen settlement. */
export function settledSql(alias = "le") {
  return sql.raw(
    `exists (select 1 from settlements s where s.user_id = ${alias}.user_id and s.status in ('approved','paid','locked') and (s.totals->'entry_ids') @> jsonb_build_array(${alias}.id::text))`,
  );
}

/** SQL predicate: entry `alias` has been reversed by another entry. */
export function reversedSql(alias = "le") {
  return sql.raw(
    `exists (select 1 from ledger_entries r where r.reverses_id = ${alias}.id)`,
  );
}

/** Pay period row for a date (created on demand), and whether it is open. */
export async function periodRowFor(
  tx: Tx,
  day: string,
): Promise<{ id: string; startsOn: string; endsOn: string; status: string }> {
  const s = await settingsOf(tx);
  const range = periodFor(day, {
    period: s.payroll.period,
    weekStartsOn: s.payroll.week_starts_on,
    biweeklyAnchor: s.payroll.biweekly_anchor,
  });
  const [existing] = await tx
    .select()
    .from(payPeriods)
    .where(
      and(
        sql`${payPeriods.startsOn} <= ${day}`,
        sql`${payPeriods.endsOn} >= ${day}`,
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [row] = await tx
    .insert(payPeriods)
    .values({ startsOn: range.startsOn, endsOn: range.endsOn })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [again] = await tx
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.startsOn, range.startsOn))
    .limit(1);
  if (!again) throw new Error("pay period insert failed");
  return again;
}

export interface PostContext {
  effectiveDate: string;
  jobId?: string | null;
  refTable: string;
  refId: string | null;
  actorUserId: string | null;
  /** Today in the company TZ (for routing late entries into the open period). */
  today: string;
  /** Keep the effective date even in a closed period (statement corrections in review). */
  keepDate?: boolean;
}

/**
 * Insert postings. An effective date inside a CLOSED period is posted into the open
 * period containing `today` with a memo (BUILD_PLAN §6.6 postLedgerEntry).
 */
export async function insertPostings(
  tx: Tx,
  postings: readonly Posting[],
  ctx: PostContext,
): Promise<string[]> {
  if (postings.length === 0) return [];
  const period = await periodRowFor(tx, ctx.effectiveDate);
  let payPeriodId = period.id;
  let effectiveDate = ctx.effectiveDate;
  let late = false;
  if (period.status !== "open" && !ctx.keepDate) {
    const open = await periodRowFor(tx, ctx.today);
    payPeriodId = open.id;
    effectiveDate = ctx.today;
    late = true;
  }
  const rows = await tx
    .insert(ledgerEntries)
    .values(
      postings.map((p) => ({
        userId: p.userId,
        type: p.type,
        amountCents: p.amountCents,
        effectiveDate,
        jobId: ctx.jobId ?? null,
        refTable: ctx.refTable,
        refId: ctx.refId,
        payPeriodId,
        wageClass: p.wageClass,
        needsReview: p.needsReview ?? false,
        memo: late
          ? `${p.memo} (posted late, for ${ctx.effectiveDate})`
          : p.memo,
        createdBy: ctx.actorUserId,
      })),
    )
    .returning({ id: ledgerEntries.id });
  return rows.map((r) => r.id);
}

/** Reverse entries: insert −amount rows with reverses_id (never edit). */
export async function reverseEntries(
  tx: Tx,
  entries: readonly { id: string }[],
  memo: string,
  ctx: { actorUserId: string | null; today: string },
): Promise<void> {
  if (entries.length === 0) return;
  const ids = entries.map((e) => e.id);
  const originals = await tx
    .select()
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.id, ids));
  if (originals.length === 0) return;
  const open = await periodRowFor(tx, ctx.today);
  await tx.insert(ledgerEntries).values(
    originals.map((o) => ({
      userId: o.userId,
      type: o.type,
      amountCents: -o.amountCents,
      effectiveDate: o.effectiveDate,
      jobId: o.jobId,
      refTable: o.refTable,
      refId: o.refId,
      payPeriodId: o.payPeriodId ?? open.id,
      reversesId: o.id,
      wageClass: o.wageClass,
      needsReview: o.needsReview,
      memo: `Reversal: ${memo}`,
      createdBy: ctx.actorUserId,
    })),
  );
}

/**
 * Σ post-lock `adjustment` entries already posted for a job's financials, by user.
 * Reversal rows carry the same type with −amount, so the plain sum nets them.
 */
export async function jobAdjustmentTotals(
  tx: Tx,
  jobId: string,
): Promise<Map<string, number>> {
  const res = (await tx.execute(sql`
    select le.user_id, coalesce(sum(le.amount_cents), 0)::bigint as total
    from ledger_entries le
    where le.job_id = ${jobId}::uuid and le.ref_table = 'job_financials'
      and le.type = 'adjustment'
    group by le.user_id`)) as unknown as {
    rows: { user_id: string; total: number | string }[];
  };
  return new Map(res.rows.map((r) => [r.user_id, Number(r.total)]));
}

/** Active (not reversed, not a reversal) job-financial entries of a job. */
export async function activeJobEntries(
  tx: Tx,
  jobId: string,
): Promise<ExistingJobEntry[]> {
  const types = JOB_LEDGER_TYPES.map((t) => `'${t}'`).join(",");
  const res = (await tx.execute(sql`
    select le.id, le.user_id, le.type, le.amount_cents::bigint as amount_cents, ${settledSql("le")} as settled
    from ledger_entries le
    where le.job_id = ${jobId}::uuid and le.ref_table = 'job_financials'
      and le.type in (${sql.raw(types)})
      and le.reverses_id is null and not ${reversedSql("le")}`)) as unknown as {
    rows: {
      id: string;
      user_id: string;
      type: string;
      amount_cents: number | string;
      settled: boolean;
    }[];
  };
  return res.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    type: r.type,
    amountCents: Number(r.amount_cents),
    settled: !!r.settled,
  }));
}
