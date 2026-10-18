import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  jobEarnings,
  jobFinancials,
  jobs,
  payoutSettlements,
  payPeriods,
  roles,
  settlementFlags,
  settlements,
  timeEntries,
  users,
} from "@/db/schema";
import { closeJobIfEligible, lockJobsForSettlement } from "@/features/jobs/api";
import { writeActivity } from "@/lib/activity";
import { writeAudit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { addDaysToKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import type { Actor } from "@/lib/types";
import {
  closeOut,
  deductionCap,
  deductionsOf,
  floorCheck,
  openingBalance,
  type Posting,
  type SettlementEntry,
  summarizeEntries,
  type TierJob,
  tierAdjustment,
  weeksIn,
} from "../engine";
import { insertPostings, reversedSql, settledSql } from "./ledger";
import { techPlans } from "./plans";
import { companyTz, emitB6, isQuiet, settingsOf, todayKey } from "./util";

export type SettlementRow = typeof settlements.$inferSelect;
export const SOFT_STATUSES = ["draft", "tech_review"] as const;
export const FROZEN_STATUSES = ["approved", "paid", "locked"] as const;

export interface SettlementTotalsJson {
  byType: Record<string, number>;
  wagesCents: number;
  grossEarningsCents: number;
  reimbursementsCents: number;
  custodyCents: number;
  otherCents: number;
  pendingReviewCents: number;
  pendingReviewCount: number;
  entry_ids: string[];
  pending_ids: string[];
  job_ids: string[];
  payable_cents: number;
  paid_cents: number;
  preview?: {
    guaranteeTopupCents: number;
    otTopupCents: number;
    tierAdjustmentCents: number;
    deferredCents: number;
    minutes: number;
  };
  [k: string]: unknown;
}

export interface LedgerRow {
  id: string;
  type: string;
  amountCents: number;
  wageClass: string;
  needsReview: boolean;
  reversesId: string | null;
  reversed: boolean;
  jobId: string | null;
  effectiveDate: string;
  memo: string | null;
  refTable: string | null;
  refId: string | null;
  createdAt: Date;
}

const isFrozen = (s: string) =>
  (FROZEN_STATUSES as readonly string[]).includes(s);

/** Unsettled entries of a user with effective_date in (afterDay, endsOn]. */
export async function unsettledEntries(
  tx: Tx,
  userId: string,
  endsOn: string,
  afterDay: string | null,
): Promise<LedgerRow[]> {
  const res = (await tx.execute(sql`
    select le.id, le.type, le.amount_cents::bigint as amount_cents, le.wage_class, le.needs_review, le.reverses_id,
      ${reversedSql("le")} as reversed, le.job_id, le.effective_date::text as effective_date, le.memo, le.ref_table, le.ref_id, le.created_at
    from ledger_entries le
    where le.user_id = ${userId}::uuid and le.type <> 'payout'
      and le.effective_date <= ${endsOn}::date
      ${afterDay ? sql`and le.effective_date > ${afterDay}::date` : sql``}
      and not ${settledSql("le")}
    order by le.effective_date, le.created_at`)) as unknown as {
    rows: {
      id: string;
      type: string;
      amount_cents: string | number;
      wage_class: string;
      needs_review: boolean;
      reverses_id: string | null;
      reversed: boolean;
      job_id: string | null;
      effective_date: string;
      memo: string | null;
      ref_table: string | null;
      ref_id: string | null;
      created_at: Date | string;
    }[];
  };
  return res.rows.map((r) => ({
    id: r.id,
    type: r.type,
    amountCents: Number(r.amount_cents),
    wageClass: r.wage_class,
    needsReview: r.needs_review,
    reversesId: r.reverses_id,
    reversed: !!r.reversed,
    jobId: r.job_id,
    effectiveDate: r.effective_date,
    memo: r.memo,
    refTable: r.ref_table,
    refId: r.ref_id,
    createdAt: new Date(r.created_at),
  }));
}

/** needs_review entries: pending (excluded) until an admin applies or waives them. */
export function classify(rows: readonly LedgerRow[]): {
  included: LedgerRow[];
  pending: LedgerRow[];
} {
  const included: LedgerRow[] = [];
  const pending: LedgerRow[] = [];
  for (const r of rows) {
    if (r.needsReview) {
      if (!r.reversesId && !r.reversed) pending.push(r);
      continue; // resolved review pairs net to zero and stay out
    }
    included.push(r);
  }
  return { included, pending };
}

const toEntry = (r: LedgerRow, pending = false): SettlementEntry => ({
  id: r.id,
  type: r.type,
  amountCents: r.amountCents,
  wageClass: r.wageClass,
  pendingReview: pending,
  jobId: r.jobId,
  effectiveDate: r.effectiveDate,
});

async function periodOf(tx: Tx, id: string) {
  const [p] = await tx
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.id, id))
    .limit(1);
  if (!p) throw new NotFoundError("Pay period");
  return p;
}

/** Settlements of a user ordered by period (with period dates). */
async function userSettlements(tx: Tx, userId: string) {
  return tx
    .select({
      s: settlements,
      startsOn: payPeriods.startsOn,
      endsOn: payPeriods.endsOn,
    })
    .from(settlements)
    .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
    .where(eq(settlements.userId, userId))
    .orderBy(asc(payPeriods.startsOn));
}

export async function paidOn(tx: Tx, settlementId: string): Promise<number> {
  const [r] = await tx
    .select({
      n: sql<number>`coalesce(sum(${payoutSettlements.amountCents}), 0)::bigint`,
    })
    .from(payoutSettlements)
    .where(eq(payoutSettlements.settlementId, settlementId));
  return Number(r?.n ?? 0);
}

/** Live totals of a soft settlement computed from the ledger (pure read, no write). */
export async function computeSettlement(
  tx: Tx,
  s: SettlementRow,
): Promise<{
  openingCents: number;
  periodNetCents: number;
  closingCents: number;
  json: SettlementTotalsJson;
}> {
  const period = await periodOf(tx, s.payPeriodId);
  const all = await userSettlements(tx, s.userId);
  const idx = all.findIndex((x) => x.s.id === s.id);
  const prev = idx > 0 ? all[idx - 1] : undefined;
  const prevSoftEnds = prev && !isFrozen(prev.s.status) ? prev.endsOn : null;
  const rows = await unsettledEntries(
    tx,
    s.userId,
    period.endsOn,
    prevSoftEnds,
  );
  const { included, pending } = classify(rows);
  const totals = summarizeEntries([
    ...included.map((r) => toEntry(r)),
    ...pending.map((r) => toEntry(r, true)),
  ]);
  const opening = prev
    ? openingBalance({
        closingCents: prev.s.closingBalanceCents,
        paidCents: await paidOn(tx, prev.s.id),
      })
    : 0;
  const { closingCents, payableCents } = closeOut(
    opening,
    totals.periodNetCents,
  );
  const preview = await previewAdjustments(tx, s.userId, period, included);
  const prevJson = (s.totals ?? {}) as Partial<SettlementTotalsJson>;
  const json: SettlementTotalsJson = {
    ...totals,
    entry_ids: included.map((r) => r.id),
    pending_ids: pending.map((r) => r.id),
    job_ids: [
      ...new Set(included.map((r) => r.jobId).filter((x): x is string => !!x)),
    ],
    payable_cents: payableCents,
    paid_cents: 0,
    preview,
    ...(prevJson.review_deadline_notified
      ? { review_deadline_notified: true }
      : {}),
  };
  return {
    openingCents: opening,
    periodNetCents: totals.periodNetCents,
    closingCents,
    json,
  };
}

/** Recompute a soft settlement (draft | tech_review) from the ledger. Frozen ones are returned as-is. */
export async function refreshSettlement(
  tx: Tx,
  settlementId: string,
): Promise<SettlementRow> {
  const [s] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);
  if (!s) throw new NotFoundError("Settlement");
  if (isFrozen(s.status)) return s;
  const c = await computeSettlement(tx, s);
  const [u] = await tx
    .select({ workerType: users.workerType })
    .from(users)
    .where(eq(users.id, s.userId))
    .limit(1);
  const [row] = await tx
    .update(settlements)
    .set({
      openingBalanceCents: c.openingCents,
      periodNetCents: c.periodNetCents,
      closingBalanceCents: c.closingCents,
      totals: c.json,
      workerType: u?.workerType ?? s.workerType,
      updatedAt: new Date(),
    })
    .where(eq(settlements.id, s.id))
    .returning();
  return row ?? s;
}

async function minutesWorked(
  tx: Tx,
  userId: string,
  fromDay: string,
  toDay: string,
  tz: string,
): Promise<number> {
  const from = zonedTimeToUtc(parseDateKey(fromDay), tz);
  const to = zonedTimeToUtc(parseDateKey(addDaysToKey(toDay, 1)), tz);
  const rows = await tx
    .select({
      inAt: timeEntries.clockInAt,
      outAt: timeEntries.clockOutAt,
      brk: timeEntries.breakMinutes,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.clockInAt, from),
        lt(timeEntries.clockInAt, to),
      ),
    );
  let m = 0;
  for (const r of rows)
    if (r.outAt)
      m += Math.max(
        0,
        Math.round((r.outAt.getTime() - r.inAt.getTime()) / 60000) - r.brk,
      );
  return m;
}

/** Floor/OT top-ups, tier adjustment and the deduction cap (posted on approval). */
async function previewAdjustments(
  tx: Tx,
  userId: string,
  period: { startsOn: string; endsOn: string },
  included: readonly LedgerRow[],
): Promise<
  NonNullable<SettlementTotalsJson["preview"]> & {
    weeks: { endsOn: string; guarantee: number; ot: number }[];
  }
> {
  const tz = await companyTz(tx);
  const s = await settingsOf(tx);
  const tp = (await techPlans(tx, [userId], period.endsOn)).get(userId);
  const out = {
    guaranteeTopupCents: 0,
    otTopupCents: 0,
    tierAdjustmentCents: 0,
    deferredCents: 0,
    minutes: 0,
    weeks: [] as { endsOn: string; guarantee: number; ot: number }[],
  };
  if (!tp) return out;
  const plan = tp.plan;
  if (plan.tiers?.length) {
    const jobIds = [
      ...new Set(
        included
          .filter((r) => r.type === "commission" && r.jobId)
          .map((r) => r.jobId as string),
      ),
    ];
    if (jobIds.length) {
      const ear = await tx
        .select()
        .from(jobEarnings)
        .where(
          and(
            inArray(jobEarnings.jobId, jobIds),
            eq(jobEarnings.userId, userId),
          ),
        );
      const fins = await tx
        .select()
        .from(jobFinancials)
        .where(inArray(jobFinancials.jobId, jobIds));
      const tj: TierJob[] = ear.map((e) => {
        const f = fins.find((x) => x.jobId === e.jobId);
        return {
          revenueCents: Math.round(
            ((f?.revenueCents ?? 0) * e.splitBps) / 10000,
          ),
          baseCents: Math.round(((f?.baseCents ?? 0) * e.splitBps) / 10000),
          appliedRateBps: e.rateBps,
        };
      });
      out.tierAdjustmentCents = tierAdjustment(tj, plan.tiers);
    }
  }
  if (plan.w2_floor_check || tp.workerType === "w2") {
    for (const w of weeksIn(period, s.payroll.week_starts_on)) {
      const minutes = await minutesWorked(tx, userId, w.startsOn, w.endsOn, tz);
      out.minutes += minutes;
      if (minutes === 0) continue;
      const wages =
        included
          .filter(
            (r) =>
              r.wageClass === "wage" &&
              r.effectiveDate >= w.startsOn &&
              r.effectiveDate <= w.endsOn &&
              ["commission", "spiff", "tip", "adjustment"].includes(r.type),
          )
          .reduce((a, r) => a + r.amountCents, 0) +
        // The tier adjustment is posted on the period's last day: it is commission
        // too, so it counts toward that week's regular rate.
        (w.startsOn <= period.endsOn && period.endsOn <= w.endsOn
          ? out.tierAdjustmentCents
          : 0);
      const f = floorCheck({
        wagesCents: wages,
        minutesWorked: minutes,
        minWageCentsPerHour: plan.min_wage_cents_per_hour,
      });
      out.guaranteeTopupCents += f.guaranteeTopupCents;
      out.otTopupCents += f.otTopupCents;
      out.weeks.push({
        endsOn: w.endsOn,
        guarantee: f.guaranteeTopupCents,
        ot: f.otTopupCents,
      });
    }
  }
  if (plan.max_deduction_per_period_bps != null) {
    const entries = included.map((r) => toEntry(r));
    const gross =
      summarizeEntries(entries).grossEarningsCents +
      out.guaranteeTopupCents +
      out.otTopupCents +
      Math.max(0, out.tierAdjustmentCents);
    out.deferredCents = deductionCap(
      gross,
      deductionsOf(entries),
      plan.max_deduction_per_period_bps,
    ).deferredCents;
  }
  return out;
}

/** Create the settlement row for (user, period) if missing and refresh it. */
export async function ensureSettlement(
  tx: Tx,
  userId: string,
  payPeriodId: string,
  actor: Actor,
  /** The caller's clock (cron tick / event handler `now`): the review window starts here. */
  now: Date = new Date(),
): Promise<{ row: SettlementRow; created: boolean }> {
  const [existing] = await tx
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.userId, userId),
        eq(settlements.payPeriodId, payPeriodId),
      ),
    )
    .limit(1);
  if (existing)
    return { row: await refreshSettlement(tx, existing.id), created: false };
  const s = await settingsOf(tx);
  const [u] = await tx
    .select({ workerType: users.workerType })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [row] = await tx
    .insert(settlements)
    .values({
      userId,
      payPeriodId,
      status: "tech_review",
      workerType: u?.workerType ?? "1099",
      openingBalanceCents: 0,
      periodNetCents: 0,
      closingBalanceCents: 0,
      totals: {},
      reviewDeadline: new Date(
        now.getTime() + s.payroll.review_hours * 3_600_000,
      ),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const [again] = await tx
      .select()
      .from(settlements)
      .where(
        and(
          eq(settlements.userId, userId),
          eq(settlements.payPeriodId, payPeriodId),
        ),
      )
      .limit(1);
    if (!again) throw new Error("settlement insert failed");
    return { row: await refreshSettlement(tx, again.id), created: false };
  }
  const fresh = await refreshSettlement(tx, row.id);
  await emitB6(
    tx,
    "settlement.ready_for_review",
    { type: "settlement", id: row.id },
    { settlement_id: row.id, user_id: userId },
    { actor },
  );
  await writeActivity(tx, {
    entity: { type: "user", id: userId },
    kind: "settlement.ready_for_review",
    summary: "Pay statement ready for review",
    data: { settlement_id: row.id },
    actorUserId: actor.userId,
  });
  return { row: fresh, created: true };
}

/** Draft settlements for a closed period: techs plus anyone with unsettled entries (§10.3). */
export async function generateSettlements(
  tx: Tx,
  payPeriodId: string,
  actor: Actor,
  now: Date = new Date(),
): Promise<number> {
  const period = await periodOf(tx, payPeriodId);
  const techRows = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.key, users.role))
    .where(and(eq(users.status, "active"), eq(roles.baseRole, "tech")));
  const withEntries = (await tx.execute(sql`
    select distinct le.user_id from ledger_entries le
    where le.effective_date <= ${period.endsOn}::date and le.type <> 'payout' and not ${settledSql("le")}`)) as unknown as {
    rows: { user_id: string }[];
  };
  const ids = new Set<string>([
    ...techRows.map((r) => r.id),
    ...withEntries.rows.map((r) => r.user_id),
  ]);
  let created = 0;
  for (const userId of ids) {
    const rows = await unsettledEntries(tx, userId, period.endsOn, null);
    const [prev] = await tx
      .select({ closing: settlements.closingBalanceCents, id: settlements.id })
      .from(settlements)
      .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
      .where(
        and(
          eq(settlements.userId, userId),
          lt(payPeriods.startsOn, period.startsOn),
        ),
      )
      .orderBy(desc(payPeriods.startsOn))
      .limit(1);
    const carry = prev ? prev.closing - (await paidOn(tx, prev.id)) : 0;
    if (rows.length === 0 && carry === 0) continue;
    const r = await ensureSettlement(tx, userId, payPeriodId, actor, now);
    if (r.created) created++;
  }
  return created;
}

/** Close a pay period and draft its settlements. Idempotent. */
export async function closePayPeriod(
  tx: Tx,
  payPeriodId: string,
  actor: Actor,
  /** The cron tick's clock (T6-14): closed_at follows it, not the wall clock. */
  now: Date = new Date(),
): Promise<boolean> {
  const [p] = await tx
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.id, payPeriodId))
    .for("update")
    .limit(1);
  if (!p || p.status === "closed") return false;
  await tx
    .update(payPeriods)
    .set({ status: "closed", closedAt: now })
    .where(eq(payPeriods.id, payPeriodId));
  await emitB6(
    tx,
    "pay_period.closed",
    null,
    { pay_period_id: payPeriodId },
    { actor },
  );
  return true;
}

/**
 * Approve (payroll.approve): post floor/OT top-ups, tier adjustment and deduction-cap
 * carry-forward, freeze the covered entries, snapshot the jobs' financials.
 */
export async function approveSettlement(
  tx: Tx,
  settlementId: string,
  actor: Actor,
  opts: { force?: boolean } = {},
): Promise<SettlementRow> {
  const [s] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .for("update")
    .limit(1);
  if (!s) throw new NotFoundError("Settlement");
  if (isFrozen(s.status))
    throw new ConflictError(
      "already_approved",
      "This statement is already approved.",
    );
  const all = await userSettlements(tx, s.userId);
  const idx = all.findIndex((x) => x.s.id === s.id);
  if (all.slice(0, idx).some((x) => !isFrozen(x.s.status)))
    throw new ConflictError(
      "approve_in_order",
      "Approve this tech's earlier statement first.",
    );
  const [openFlag] = await tx
    .select({ id: settlementFlags.id })
    .from(settlementFlags)
    .where(
      and(
        eq(settlementFlags.settlementId, s.id),
        eq(settlementFlags.status, "open"),
      ),
    )
    .limit(1);
  if (openFlag)
    throw new ConflictError(
      "open_flags",
      "Resolve the tech's flagged lines first (Approvals).",
    );
  const reviewOpen =
    !s.techAckAt && s.reviewDeadline && s.reviewDeadline.getTime() > Date.now();
  if (reviewOpen && !opts.force)
    throw new ConflictError(
      "in_review",
      "The tech review window is still open.",
    );

  const period = await periodOf(tx, s.payPeriodId);
  const tz = await companyTz(tx);
  const today = todayKey(tz);
  let fresh = await refreshSettlement(tx, s.id);
  const preview = (fresh.totals as SettlementTotalsJson).preview as
    | (SettlementTotalsJson["preview"] & {
        weeks?: { endsOn: string; guarantee: number; ot: number }[];
      })
    | undefined;
  const ctx = {
    jobId: null,
    refTable: "settlements",
    refId: s.id,
    actorUserId: actor.userId,
    today,
  };
  const toPost: { p: Posting; eff: string }[] = [];
  for (const w of preview?.weeks ?? []) {
    if (w.guarantee)
      toPost.push({
        eff: w.endsOn,
        p: {
          userId: s.userId,
          type: "guarantee_topup",
          amountCents: w.guarantee,
          wageClass: "wage",
          memo: `Minimum-wage top-up, week ending ${w.endsOn}`,
        },
      });
    if (w.ot)
      toPost.push({
        eff: w.endsOn,
        p: {
          userId: s.userId,
          type: "ot_topup",
          amountCents: w.ot,
          wageClass: "wage",
          memo: `Overtime premium, week ending ${w.endsOn}`,
        },
      });
  }
  if (preview?.tierAdjustmentCents)
    toPost.push({
      eff: period.endsOn,
      p: {
        userId: s.userId,
        type: "adjustment",
        amountCents: preview.tierAdjustmentCents,
        wageClass: "wage",
        memo: "Tier commission adjustment",
      },
    });
  if (preview?.deferredCents) {
    toPost.push({
      eff: period.endsOn,
      p: {
        userId: s.userId,
        type: "carry_forward",
        amountCents: preview.deferredCents,
        wageClass: "n/a",
        memo: "Deductions over the per-period cap, deferred",
      },
    });
  }
  // keepDate: top-ups, the tier adjustment and the cap carry-forward belong to THIS
  // statement's (closed) period, so they stay there and land in its closing balance
  // instead of being rerouted "posted late" into the open period (QA T6-03/T3-01).
  for (const x of toPost)
    await insertPostings(tx, [x.p], {
      ...ctx,
      effectiveDate: x.eff,
      keepDate: true,
    });
  if (preview?.deferredCents) {
    // The deferred part lands in the next period (−), even when that period is
    // already closed: its statement is still soft (statements approve in order).
    await insertPostings(
      tx,
      [
        {
          userId: s.userId,
          type: "carry_forward",
          amountCents: -preview.deferredCents,
          wageClass: "n/a",
          memo: "Deferred deductions from the previous period",
        },
      ],
      {
        ...ctx,
        effectiveDate: addDaysToKey(period.endsOn, 1),
        keepDate: true,
      },
    );
  }
  if (toPost.length) fresh = await refreshSettlement(tx, s.id);
  const totals = { ...(fresh.totals as SettlementTotalsJson) };
  delete totals.preview;
  const now = new Date();
  const [row] = await tx
    .update(settlements)
    .set({
      status: "approved",
      approvedBy: actor.userId,
      approvedAt: now,
      totals,
      updatedAt: now,
    })
    .where(eq(settlements.id, s.id))
    .returning();
  const jobIds = totals.job_ids ?? [];
  if (jobIds.length)
    await tx
      .update(jobFinancials)
      .set({ lockedSettlementId: s.id, lockedAt: now })
      .where(
        and(
          inArray(jobFinancials.jobId, jobIds),
          sql`${jobFinancials.lockedAt} is null`,
        ),
      );
  await emitB6(
    tx,
    "settlement.approved",
    { type: "settlement", id: s.id },
    { settlement_id: s.id, user_id: s.userId },
    { actor },
  );
  await writeActivity(tx, {
    entity: { type: "user", id: s.userId },
    kind: "settlement.approved",
    summary: `Pay statement approved (${formatMoney(fresh.closingBalanceCents)})`,
    data: { settlement_id: s.id },
    actorUserId: actor.userId,
  });
  await writeAudit(tx, {
    actor,
    action: "settlement.approved",
    entity: { type: "settlement", id: s.id },
    after: {
      closing_cents: fresh.closingBalanceCents,
      entries: totals.entry_ids.length,
    },
  });
  return row ?? fresh;
}

/** Lock: jobs get settlement_locked_at and close when eligible (BUILD_PLAN §6.9 settlement lock → job close). */
export async function lockSettlement(
  tx: Tx,
  settlementId: string,
  actor: Actor,
): Promise<void> {
  const [s] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);
  if (!s || s.status === "locked") return;
  if (!isFrozen(s.status))
    throw new ConflictError("not_approved", "Approve the statement first.");
  const now = new Date();
  await tx
    .update(settlements)
    .set({ status: "locked", lockedAt: now, updatedAt: now })
    .where(eq(settlements.id, s.id));
  const jobIds = (s.totals as SettlementTotalsJson).job_ids ?? [];
  if (jobIds.length) {
    await lockJobsForSettlement(tx, jobIds, s.id, now);
    const done = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(inArray(jobs.id, jobIds), eq(jobs.status, "completed")));
    if (!isQuiet())
      for (const j of done) await closeJobIfEligible(tx, j.id, actor);
  }
}

/** Approved settlements with nothing to pay (closing ≤ 0) are closed without a payout. */
export async function closeWithoutPayout(
  tx: Tx,
  settlementId: string,
  actor: Actor,
): Promise<void> {
  const [s] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, settlementId))
    .limit(1);
  if (!s) throw new NotFoundError("Settlement");
  if (s.status !== "approved")
    throw new ConflictError(
      "not_approved",
      "Only approved statements can be closed.",
    );
  if (s.closingBalanceCents - (await paidOn(tx, s.id)) > 0)
    throw new ConflictError("unpaid", "Record the payout first.");
  await lockSettlement(tx, s.id, actor);
  await writeAudit(tx, {
    actor,
    action: "settlement.closed",
    entity: { type: "settlement", id: s.id },
  });
}

/** Mark fully-paid settlements paid → locked and emit settlement.paid. */
export async function settleAfterPayout(
  tx: Tx,
  settlementIds: string[],
  actor: Actor,
): Promise<void> {
  for (const id of settlementIds) {
    const [s] = await tx
      .select()
      .from(settlements)
      .where(eq(settlements.id, id))
      .limit(1);
    if (!s) continue;
    const paid = await paidOn(tx, id);
    const totals = { ...(s.totals as SettlementTotalsJson), paid_cents: paid };
    const fully = paid >= Math.max(0, s.closingBalanceCents);
    const now = new Date();
    await tx
      .update(settlements)
      .set({
        totals,
        ...(fully ? { status: "paid", paidAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(settlements.id, id));
    if (fully) {
      await emitB6(
        tx,
        "settlement.paid",
        { type: "settlement", id },
        { settlement_id: id, user_id: s.userId },
        { actor },
      );
      await lockSettlement(tx, id, actor);
    }
  }
}
