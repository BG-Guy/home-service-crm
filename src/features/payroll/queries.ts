import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { cache } from "react";
import { db, execRows } from "@/db";
import {
  cashRemittances,
  compPlans,
  invoices,
  jobEarnings,
  jobFinancials,
  jobs,
  ledgerEntries,
  mileageRates,
  partPurchases,
  payments,
  payoutSettlements,
  payouts,
  payPeriods,
  properties,
  roles,
  serviceTypes,
  settlementFlags,
  settlements,
  techComp,
  users,
} from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { JOB_LEDGER_TYPES, type TraceStep } from "./engine";
import { agreementFor } from "./server/agreement";
import { custodyFor } from "./server/custody";
import { reversedSql } from "./server/ledger";
import { latestPlans, techPlans } from "./server/plans";
import {
  computeSettlement,
  FROZEN_STATUSES,
  type SettlementTotalsJson,
} from "./server/settlements";
import { companyTz, todayKey } from "./server/util";

// Read DAL for /pay, statements, settlements and the commission settings. Every query
// calls requireUser() first and scopes rows: payroll.view_own sees only the viewer's
// pay; payroll.view_all (admin) sees everyone's.

export const LEDGER_TYPE_LABEL: Record<string, string> = {
  commission: "Commission",
  tip: "Tips",
  spiff: "Spiffs",
  reimbursement_parts: "Parts reimbursements",
  reimbursement_expense: "Expense reimbursements",
  reimbursement_mileage: "Mileage reimbursements",
  cash_held: "Cash kept",
  cash_remitted: "Cash handed in",
  chargeback_hold: "Chargeback holds",
  chargeback_release: "Chargeback releases",
  chargeback_clawback: "Chargeback clawbacks",
  recall_clawback: "Recall clawbacks",
  tool_deduction: "Tool deductions",
  tool_allowance: "Tool allowance",
  tool_deposit: "Tool deposits",
  draw: "Draws",
  guarantee_topup: "Minimum-wage top-up",
  ot_topup: "Overtime premium",
  adjustment: "Adjustments",
  payout: "Payouts",
  carry_forward: "Carried forward",
};

export interface LedgerLine {
  id: string;
  type: string;
  amountCents: number;
  effectiveDate: string;
  memo: string | null;
  jobId: string | null;
  jobNumber: string | null;
  wageClass: string;
  needsReview: boolean;
  reversesId: string | null;
}

function canSeeUser(viewer: SessionUser, userId: string) {
  return viewer.id === userId || viewer.perms.has("payroll.view_all");
}

async function currentPeriod() {
  const tz = await companyTz();
  const today = todayKey(tz);
  const [p] = await db
    .select()
    .from(payPeriods)
    .where(and(lte(payPeriods.startsOn, today), gte(payPeriods.endsOn, today)))
    .limit(1);
  return { tz, today, period: p ?? null };
}

/** Ledger lines of a user by id list (statement) or in a date range (live period). */
async function ledgerLines(q: {
  userId: string;
  ids?: string[];
  from?: string;
  to?: string;
  unsettledOnly?: boolean;
}): Promise<LedgerLine[]> {
  if (q.ids && q.ids.length === 0) return [];
  const rows = await db
    .select({
      e: ledgerEntries,
      jobNumber: jobs.number,
    })
    .from(ledgerEntries)
    .leftJoin(jobs, eq(jobs.id, ledgerEntries.jobId))
    .where(
      and(
        eq(ledgerEntries.userId, q.userId),
        q.ids ? inArray(ledgerEntries.id, q.ids) : undefined,
        q.from ? gte(ledgerEntries.effectiveDate, q.from) : undefined,
        q.to ? lte(ledgerEntries.effectiveDate, q.to) : undefined,
      ),
    )
    .orderBy(asc(ledgerEntries.effectiveDate), asc(ledgerEntries.createdAt));
  return rows.map((r) => ({
    id: r.e.id,
    type: r.e.type,
    amountCents: r.e.amountCents,
    effectiveDate: r.e.effectiveDate,
    memo: r.e.memo,
    jobId: r.e.jobId,
    jobNumber: r.jobNumber,
    wageClass: r.e.wageClass,
    needsReview: r.e.needsReview,
    reversesId: r.e.reversesId,
  }));
}

/**
 * A job row on the stub is built from the job's own financial lines; a later
 * adjustment, chargeback or clawback on that job is listed on its own line with
 * the job number instead of being folded silently into the row (QA T3-18).
 */
const isJobLine = (l: LedgerLine) =>
  !!l.jobId && (JOB_LEDGER_TYPES as readonly string[]).includes(l.type);

export interface JobPayLine {
  jobId: string;
  jobNumber: string;
  title: string;
  completedAt: Date | null;
  city: string | null;
  totalCents: number;
  methods: string[];
  feesCents: number;
  companyPartsCents: number;
  techPartsCents: number;
  baseCents: number;
  rateBps: number;
  splitBps: number;
  commissionCents: number;
  spiffsCents: number;
  tipCents: number;
  reimbursementCents: number;
  cashHeldCents: number;
  netCents: number;
  /** Σ of this job's ledger lines on the statement (what actually counts). */
  postedCents: number;
  trace: TraceStep[];
  pendingReimbursement: boolean;
  earned: boolean;
}

/** Per-job statement rows (pay stub M16): job #, date, city, total, method, fee, parts, base, rate… */
async function jobPayLines(
  userId: string,
  lines: LedgerLine[],
): Promise<JobPayLine[]> {
  const jobIds = [
    ...new Set(lines.map((l) => l.jobId).filter((x): x is string => !!x)),
  ];
  if (jobIds.length === 0) return [];
  const rows = await db
    .select({
      job: jobs,
      city: properties.city,
      fin: jobFinancials,
      e: jobEarnings,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(jobFinancials, eq(jobFinancials.jobId, jobs.id))
    .leftJoin(
      jobEarnings,
      and(eq(jobEarnings.jobId, jobs.id), eq(jobEarnings.userId, userId)),
    )
    .where(inArray(jobs.id, jobIds));
  const invRows = await db
    .select({ jobId: invoices.jobId, total: invoices.totalCents })
    .from(invoices)
    .where(
      and(inArray(invoices.jobId, jobIds), sql`${invoices.status} <> 'void'`),
    );
  const pays = await db
    .select({ jobId: payments.jobId, method: payments.method })
    .from(payments)
    .where(
      and(
        inArray(payments.jobId, jobIds),
        inArray(payments.status, [
          "succeeded",
          "partially_refunded",
          "disputed",
          "refunded",
        ]),
      ),
    );
  return rows
    .map((r) => {
      const trace = ((r.e?.trace ?? {}) as { steps?: TraceStep[] }).steps ?? [];
      const ft = (r.fin?.trace ?? {}) as {
        flags?: { pendingReimbursements?: boolean };
        earned?: boolean;
      };
      return {
        jobId: r.job.id,
        jobNumber: r.job.number,
        title: r.job.title,
        completedAt: r.job.completedAt,
        city: r.city ?? null,
        totalCents: invRows.find((i) => i.jobId === r.job.id)?.total ?? 0,
        methods: [
          ...new Set(
            pays.filter((p) => p.jobId === r.job.id).map((p) => p.method),
          ),
        ],
        feesCents: r.fin?.feesCents ?? 0,
        companyPartsCents: r.fin?.companyPartsCents ?? 0,
        techPartsCents: r.fin?.techPartsCents ?? 0,
        baseCents: r.fin?.baseCents ?? 0,
        rateBps: r.e?.rateBps ?? 0,
        splitBps: r.e?.splitBps ?? 0,
        commissionCents: r.e?.commissionCents ?? 0,
        spiffsCents: r.e?.spiffsCents ?? 0,
        tipCents: r.e?.tipCents ?? 0,
        reimbursementCents: r.e?.reimbursementCents ?? 0,
        cashHeldCents: r.e?.cashHeldCents ?? 0,
        netCents: r.e?.netCents ?? 0,
        postedCents: lines
          .filter((l) => l.jobId === r.job.id)
          .reduce((a, l) => a + l.amountCents, 0),
        trace,
        pendingReimbursement: !!ft.flags?.pendingReimbursements,
        earned: ft.earned !== false,
      };
    })
    .sort(
      (a, b) =>
        (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0),
    );
}

/**
 * YTD totals per wage class (statement footer, reports). `paidUpTo` (default
 * `upTo`) bounds the payouts: a stub counts its own payouts, which are dated after
 * the period ends (QA T3-18).
 */
async function ytd(
  userId: string,
  year: string,
  upTo?: string,
  paidUpTo?: string,
) {
  const paidTo = paidUpTo ?? upTo;
  const [r] = await execRows<{
    wages: string;
    reimb: string;
    paid: string;
  }>(sql`
    select
      coalesce(sum(case when wage_class = 'wage' ${upTo ? sql`and effective_date <= ${upTo}::date` : sql``} then amount_cents end), 0)::bigint as wages,
      coalesce(sum(case when wage_class = 'reimbursement' ${upTo ? sql`and effective_date <= ${upTo}::date` : sql``} then amount_cents end), 0)::bigint as reimb,
      coalesce(sum(case when type = 'payout' ${paidTo ? sql`and effective_date <= ${paidTo}::date` : sql``} then -amount_cents end), 0)::bigint as paid
    from ledger_entries
    where user_id = ${userId}::uuid and effective_date >= ${`${year}-01-01`}::date
      ${upTo && paidTo ? sql`and effective_date <= ${paidTo > upTo ? paidTo : upTo}::date` : sql``}
      and not (needs_review and reverses_id is null and not exists (select 1 from ledger_entries r where r.reverses_id = ledger_entries.id))`);
  return {
    wagesCents: Number(r?.wages ?? 0),
    reimbursementsCents: Number(r?.reimb ?? 0),
    paidCents: Number(r?.paid ?? 0),
  };
}

// ------------------------------------------------------------------ /pay (tech)

export const getPayOverview = cache(async () => {
  const user = await requireUser("payroll.view_own");
  const { period, today } = await currentPeriod();
  const lines = period
    ? (
        await ledgerLines({
          userId: user.id,
          from: period.startsOn,
          to: period.endsOn,
        })
      ).filter((l) => l.type !== "payout")
    : [];
  const visible = lines.filter((l) => !(l.needsReview && !l.reversesId));
  const netCents = visible.reduce((a, l) => a + l.amountCents, 0);
  const byType: Record<string, number> = {};
  for (const l of visible)
    byType[l.type] = (byType[l.type] ?? 0) + l.amountCents;
  const jobLines = await jobPayLines(user.id, visible.filter(isJobLine));
  const otherLines = visible.filter((l) => !isJobLine(l));
  const custody = (await custodyFor([user.id]))[user.id];
  const pendingRemit = await db
    .select({
      id: cashRemittances.id,
      amount: cashRemittances.amountCents,
      method: cashRemittances.method,
      createdAt: cashRemittances.createdAt,
    })
    .from(cashRemittances)
    .where(
      and(
        eq(cashRemittances.userId, user.id),
        eq(cashRemittances.status, "pending"),
      ),
    )
    .orderBy(desc(cashRemittances.createdAt));
  const pendingParts = await db
    .select({
      id: partPurchases.id,
      total: partPurchases.totalCents,
      vendor: partPurchases.vendor,
      category: partPurchases.category,
      createdAt: partPurchases.createdAt,
    })
    .from(partPurchases)
    .where(
      and(
        eq(partPurchases.purchaserUserId, user.id),
        eq(partPurchases.paidBy, "tech"),
        eq(partPurchases.status, "pending"),
      ),
    )
    .orderBy(desc(partPurchases.createdAt));
  const toAck = await db
    .select({
      id: settlements.id,
      status: settlements.status,
      closing: settlements.closingBalanceCents,
      startsOn: payPeriods.startsOn,
      endsOn: payPeriods.endsOn,
      reviewDeadline: settlements.reviewDeadline,
    })
    .from(settlements)
    .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
    .where(
      and(
        eq(settlements.userId, user.id),
        sql`${settlements.techAckAt} is null`,
        sql`${settlements.status} <> 'draft'`,
      ),
    )
    .orderBy(desc(payPeriods.startsOn))
    .limit(6);
  const agreement = await agreementFor(user.id);
  const [bank] = await db
    .select({
      last4: users.bankLast4,
      changedAt: users.bankChangedAt,
      verifiedAt: users.bankVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const tp = (await techPlans(db, [user.id], today)).get(user.id);
  const toConfirm = user.perms.has("cash.receive")
    ? await db
        .select({
          id: cashRemittances.id,
          name: users.name,
          amount: cashRemittances.amountCents,
          method: cashRemittances.method,
          createdAt: cashRemittances.createdAt,
        })
        .from(cashRemittances)
        .innerJoin(users, eq(users.id, cashRemittances.userId))
        .where(
          and(
            eq(cashRemittances.status, "pending"),
            sql`${cashRemittances.userId} <> ${user.id}::uuid`,
          ),
        )
        .orderBy(asc(cashRemittances.createdAt))
    : [];
  return {
    user,
    period,
    toConfirm,
    netCents,
    byType,
    jobLines,
    otherLines,
    pendingReviewLines: lines.filter((l) => l.needsReview && !l.reversesId),
    custody: custody ?? null,
    pendingRemit,
    pendingParts,
    toAck,
    agreement,
    bank: bank ?? null,
    cash: tp
      ? {
          keeps: tp.overrides.tech_keeps_cash ?? tp.plan.cash.tech_keeps_cash,
          settlement:
            tp.workerType === "w2" ||
            !(tp.overrides.tech_keeps_cash ?? tp.plan.cash.tech_keeps_cash)
              ? "separate_remittance"
              : (tp.overrides.cash_settlement ?? tp.plan.cash.settlement),
          maxHeldCents: tp.plan.cash.max_cash_held_cents,
          remitWithinDays: tp.plan.cash.remit_within_days,
        }
      : null,
    workerType: tp?.workerType ?? user.workerType,
    planName: tp ? `${tp.planName} v${tp.planVersion}` : null,
    ytd: await ytd(user.id, today.slice(0, 4)),
  };
});

// ------------------------------------------------------------------ statements

export const listStatements = cache(async (userId?: string) => {
  const viewer = await requireUser("payroll.view_own");
  const uid = userId ?? viewer.id;
  if (!canSeeUser(viewer, uid)) throw new ForbiddenError();
  const rows = await db
    .select({
      s: settlements,
      startsOn: payPeriods.startsOn,
      endsOn: payPeriods.endsOn,
    })
    .from(settlements)
    .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
    .where(eq(settlements.userId, uid))
    .orderBy(desc(payPeriods.startsOn))
    .limit(60);
  const paid = rows.length
    ? await db
        .select({
          id: payoutSettlements.settlementId,
          n: sql<string>`sum(${payoutSettlements.amountCents})`,
        })
        .from(payoutSettlements)
        .where(
          inArray(
            payoutSettlements.settlementId,
            rows.map((r) => r.s.id),
          ),
        )
        .groupBy(payoutSettlements.settlementId)
    : [];
  return rows.map((r) => ({
    id: r.s.id,
    status: r.s.status,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    closingCents: r.s.closingBalanceCents,
    periodNetCents: r.s.periodNetCents,
    paidCents: Number(paid.find((p) => p.id === r.s.id)?.n ?? 0),
    acknowledged: !!r.s.techAckAt,
  }));
});

export const getStatement = cache(async (settlementId: string) => {
  const viewer = await requireUser("payroll.view_own");
  const [r] = await db
    .select({
      s: settlements,
      startsOn: payPeriods.startsOn,
      endsOn: payPeriods.endsOn,
      periodStatus: payPeriods.status,
      name: users.name,
      email: users.email,
      bankLast4: users.bankLast4,
      bankChangedAt: users.bankChangedAt,
      bankVerifiedAt: users.bankVerifiedAt,
      bankRouting: users.bankRoutingEnc,
    })
    .from(settlements)
    .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
    .innerJoin(users, eq(users.id, settlements.userId))
    .where(eq(settlements.id, settlementId))
    .limit(1);
  if (!r) throw new NotFoundError("Statement");
  if (!canSeeUser(viewer, r.s.userId)) throw new ForbiddenError();
  const frozen = (FROZEN_STATUSES as readonly string[]).includes(r.s.status);
  let totals = r.s.totals as SettlementTotalsJson;
  let opening = r.s.openingBalanceCents;
  let closing = r.s.closingBalanceCents;
  let periodNet = r.s.periodNetCents;
  if (!frozen) {
    const c = await computeSettlement(db, r.s);
    totals = c.json;
    opening = c.openingCents;
    closing = c.closingCents;
    periodNet = c.periodNetCents;
  }
  const lines = await ledgerLines({
    userId: r.s.userId,
    ids: totals.entry_ids ?? [],
  });
  const pending = await ledgerLines({
    userId: r.s.userId,
    ids: totals.pending_ids ?? [],
  });
  const jobLines = await jobPayLines(r.s.userId, lines.filter(isJobLine));
  const otherLines = lines.filter((l) => !isJobLine(l));
  const pays = await db
    .select({ p: payouts, amount: payoutSettlements.amountCents })
    .from(payoutSettlements)
    .innerJoin(payouts, eq(payouts.id, payoutSettlements.payoutId))
    .where(eq(payoutSettlements.settlementId, r.s.id))
    .orderBy(asc(payouts.paidOn));
  const flags = await db
    .select()
    .from(settlementFlags)
    .where(eq(settlementFlags.settlementId, r.s.id))
    .orderBy(desc(settlementFlags.createdAt));
  const tp = (await techPlans(db, [r.s.userId], r.endsOn)).get(r.s.userId);
  const paidCents = pays.reduce((a, p) => a + p.amount, 0);
  return {
    viewerIsOwner: viewer.id === r.s.userId,
    settlement: r.s,
    status: r.s.status,
    frozen,
    period: { startsOn: r.startsOn, endsOn: r.endsOn, status: r.periodStatus },
    tech: {
      id: r.s.userId,
      name: r.name,
      email: r.email,
      workerType: r.s.workerType,
      bankLast4: r.bankLast4,
      hasBank: !!r.bankRouting,
      bankChangedAt: r.bankChangedAt,
      bankVerifiedAt: r.bankVerifiedAt,
    },
    plan: tp
      ? { name: tp.planName, version: tp.planVersion, key: tp.planKey }
      : null,
    totals,
    openingCents: opening,
    periodNetCents: periodNet,
    closingCents: closing,
    paidCents,
    owedCents: Math.max(0, closing - paidCents),
    jobLines,
    otherLines,
    pendingLines: pending,
    payouts: pays.map((p) => ({ ...p.p, allocatedCents: p.amount })),
    flags,
    ytd: await ytd(
      r.s.userId,
      r.endsOn.slice(0, 4),
      r.endsOn,
      pays.reduce((a, p) => (p.p.paidOn > a ? p.p.paidOn : a), r.endsOn),
    ),
  };
});

// ------------------------------------------------------------------ settlements (admin)

export const listPayPeriods = cache(async () => {
  await requireUser("payroll.view_all");
  return db
    .select()
    .from(payPeriods)
    .orderBy(desc(payPeriods.startsOn))
    .limit(26);
});

export const listSettlementsForAdmin = cache(
  async (q: { periodId?: string | null; status?: string | null }) => {
    await requireUser("payroll.view_all");
    const s = await getSettings();
    const holdMs = s.payroll.bank_change_hold_hours * 3_600_000;
    const rows = await db
      .select({
        s: settlements,
        name: users.name,
        startsOn: payPeriods.startsOn,
        endsOn: payPeriods.endsOn,
        bankLast4: users.bankLast4,
        bankRouting: users.bankRoutingEnc,
        bankChangedAt: users.bankChangedAt,
        bankVerifiedAt: users.bankVerifiedAt,
      })
      .from(settlements)
      .innerJoin(users, eq(users.id, settlements.userId))
      .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
      .where(
        and(
          q.periodId ? eq(settlements.payPeriodId, q.periodId) : undefined,
          q.status ? eq(settlements.status, q.status) : undefined,
        ),
      )
      .orderBy(desc(payPeriods.startsOn), asc(users.name))
      .limit(200);
    const ids = rows.map((r) => r.s.id);
    const paid = ids.length
      ? await db
          .select({
            id: payoutSettlements.settlementId,
            n: sql<string>`sum(${payoutSettlements.amountCents})`,
          })
          .from(payoutSettlements)
          .where(inArray(payoutSettlements.settlementId, ids))
          .groupBy(payoutSettlements.settlementId)
      : [];
    const flags = ids.length
      ? await db
          .select({
            id: settlementFlags.settlementId,
            n: sql<string>`count(*)`,
          })
          .from(settlementFlags)
          .where(
            and(
              inArray(settlementFlags.settlementId, ids),
              eq(settlementFlags.status, "open"),
            ),
          )
          .groupBy(settlementFlags.settlementId)
      : [];
    const now = Date.now();
    return rows.map((r) => {
      const paidCents = Number(paid.find((p) => p.id === r.s.id)?.n ?? 0);
      const t = (r.s.totals ?? {}) as SettlementTotalsJson;
      return {
        id: r.s.id,
        userId: r.s.userId,
        name: r.name,
        status: r.s.status,
        workerType: r.s.workerType,
        startsOn: r.startsOn,
        endsOn: r.endsOn,
        periodId: r.s.payPeriodId,
        closingCents: r.s.closingBalanceCents,
        paidCents,
        owedCents: Math.max(0, r.s.closingBalanceCents - paidCents),
        wagesCents: t.wagesCents ?? 0,
        reimbursementsCents: t.reimbursementsCents ?? 0,
        pendingReviewCount: t.pendingReviewCount ?? 0,
        openFlags: Number(flags.find((f) => f.id === r.s.id)?.n ?? 0),
        acknowledged: !!r.s.techAckAt,
        reviewDeadline: r.s.reviewDeadline,
        hasBank: !!r.bankRouting,
        bankLast4: r.bankLast4,
        // The hold only matters for a statement still to be paid (QA T3-18).
        bankHold:
          r.s.status !== "paid" &&
          r.s.status !== "locked" &&
          !!r.bankChangedAt &&
          now - r.bankChangedAt.getTime() < holdMs &&
          !(r.bankVerifiedAt && r.bankVerifiedAt >= r.bankChangedAt),
      };
    });
  },
);

/** Reports in /pay/settlements (M16): YTD per tech, cash aging, reimbursements, holds, job P&L, 1099. */
export const getPayrollReports = cache(async () => {
  await requireUser("payroll.view_all");
  const s = await getSettings();
  const tz = await companyTz();
  const year = todayKey(tz).slice(0, 4);
  const people = await db
    .select({
      id: users.id,
      name: users.name,
      workerType: users.workerType,
      baseRole: roles.baseRole,
    })
    .from(users)
    .innerJoin(roles, eq(roles.key, users.role))
    .where(eq(users.status, "active"))
    .orderBy(asc(users.name));
  const techs = people.filter((p) => p.baseRole === "tech");
  const ytdRows = (await db.execute(sql`
    select le.user_id,
      coalesce(sum(case when le.wage_class = 'wage' then le.amount_cents end), 0)::bigint as wages,
      coalesce(sum(case when le.wage_class = 'reimbursement' then le.amount_cents end), 0)::bigint as reimb,
      coalesce(sum(case when le.type = 'payout' then -le.amount_cents end), 0)::bigint as paid
    from ledger_entries le
    where le.effective_date >= ${`${year}-01-01`}::date
      and not (le.needs_review and le.reverses_id is null and not ${reversedSql("le")})
    group by le.user_id`)) as unknown as {
    rows: { user_id: string; wages: string; reimb: string; paid: string }[];
  };
  const ytdBy = new Map(ytdRows.rows.map((r) => [r.user_id, r]));
  const custody = await custodyFor(techs.map((t) => t.id));
  const pendingParts = await db
    .select({
      id: partPurchases.id,
      user: users.name,
      total: partPurchases.totalCents,
      vendor: partPurchases.vendor,
      createdAt: partPurchases.createdAt,
      category: partPurchases.category,
    })
    .from(partPurchases)
    .leftJoin(users, eq(users.id, partPurchases.purchaserUserId))
    .where(
      and(
        eq(partPurchases.paidBy, "tech"),
        eq(partPurchases.status, "pending"),
      ),
    )
    .orderBy(asc(partPurchases.createdAt))
    .limit(50);
  const holds = (await db.execute(sql`
    select le.ref_id as dispute_id, le.user_id, u.name, j.number as job_number, le.job_id,
      sum(case when le.type = 'chargeback_hold' then le.amount_cents else 0 end)::bigint as held,
      sum(case when le.type = 'chargeback_release' then le.amount_cents else 0 end)::bigint as released
    from ledger_entries le
    join users u on u.id = le.user_id
    left join jobs j on j.id = le.job_id
    where le.ref_table = 'disputes' and le.type in ('chargeback_hold','chargeback_release')
    group by le.ref_id, le.user_id, u.name, j.number, le.job_id
    having sum(case when le.type = 'chargeback_hold' then le.amount_cents else 0 end) + sum(case when le.type = 'chargeback_release' then le.amount_cents else 0 end) < 0`)) as unknown as {
    rows: {
      dispute_id: string;
      user_id: string;
      name: string;
      job_number: string | null;
      job_id: string | null;
      held: string;
      released: string;
    }[];
  };
  const pnl = await db
    .select({
      jobId: jobs.id,
      number: jobs.number,
      title: jobs.title,
      completedAt: jobs.completedAt,
      f: jobFinancials,
    })
    .from(jobFinancials)
    .innerJoin(jobs, eq(jobs.id, jobFinancials.jobId))
    .orderBy(desc(jobs.completedAt))
    .limit(25);
  const pendingRemits = await db
    .select({
      id: cashRemittances.id,
      userId: cashRemittances.userId,
      name: users.name,
      amount: cashRemittances.amountCents,
      method: cashRemittances.method,
      createdAt: cashRemittances.createdAt,
      proof: cashRemittances.proofMediaId,
    })
    .from(cashRemittances)
    .innerJoin(users, eq(users.id, cashRemittances.userId))
    .where(eq(cashRemittances.status, "pending"))
    .orderBy(asc(cashRemittances.createdAt));
  const threshold = s.payroll.threshold_1099_cents;
  return {
    year,
    perTech: people
      .filter((p) => p.baseRole === "tech" || ytdBy.has(p.id))
      .map((p) => {
        const y = ytdBy.get(p.id);
        return {
          userId: p.id,
          name: p.name,
          workerType: p.workerType,
          wagesCents: Number(y?.wages ?? 0),
          reimbursementsCents: Number(y?.reimb ?? 0),
          paidCents: Number(y?.paid ?? 0),
        };
      }),
    cash: techs
      .map((t) => ({ userId: t.id, name: t.name, ...custody[t.id] }))
      .filter((c) => (c.heldCents ?? 0) > 0),
    pendingRemits,
    pendingParts,
    holds: holds.rows.map((h) => ({
      disputeId: h.dispute_id,
      userId: h.user_id,
      name: h.name,
      jobId: h.job_id,
      jobNumber: h.job_number,
      outstandingCents: -(Number(h.held) + Number(h.released)),
    })),
    pnl: pnl.map((r) => ({
      jobId: r.jobId,
      number: r.number,
      title: r.title,
      completedAt: r.completedAt,
      revenueCents: r.f.revenueCents,
      companyNetCents: r.f.companyNetCents,
      partsCents: r.f.companyPartsCents + r.f.techPartsCents,
      feesCents: r.f.feesCents + r.f.feesOnTipsCents,
      locked: !!r.f.lockedAt,
    })),
    threshold1099Cents: threshold,
    over1099: people
      .filter((p) => p.workerType === "1099")
      .map((p) => ({
        userId: p.id,
        name: p.name,
        wagesCents: Number(ytdBy.get(p.id)?.wages ?? 0),
      }))
      .filter((p) => p.wagesCents >= threshold),
  };
});

/** Approved settlements with something owed (NACHA batch / record payouts). */
export const listPayable = cache(async () => {
  await requireUser("payroll.payout");
  const rows = await listSettlementsForAdmin({ status: "approved" });
  return rows.filter((r) => r.owedCents > 0);
});

// ------------------------------------------------------------------ commission settings

export const getCommissionSettings = cache(async () => {
  await requireUser("comp_plans.manage");
  const s = await getSettings();
  const tz = await companyTz();
  const today = todayKey(tz);
  const versions = await db
    .select()
    .from(compPlans)
    .orderBy(asc(compPlans.planKey), desc(compPlans.version));
  const latest = await latestPlans();
  const people = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      workerType: users.workerType,
      baseRole: roles.baseRole,
      status: users.status,
    })
    .from(users)
    .innerJoin(roles, eq(roles.key, users.role))
    .where(eq(users.status, "active"))
    .orderBy(asc(users.name));
  const tps = await techPlans(
    db,
    people.map((p) => p.id),
    today,
  );
  const tc = await db.select({ userId: techComp.userId }).from(techComp);
  const roleRows = await db
    .select({ key: roles.key, name: roles.name, baseRole: roles.baseRole })
    .from(roles)
    .orderBy(asc(roles.name));
  const svc = await db
    .select({ id: serviceTypes.id, name: serviceTypes.name })
    .from(serviceTypes)
    .orderBy(asc(serviceTypes.name));
  const mileage = await db
    .select()
    .from(mileageRates)
    .orderBy(desc(mileageRates.effectiveFrom));
  return {
    settings: s.payroll,
    versions: versions.map((v) => ({
      id: v.id,
      planKey: v.planKey,
      name: v.name,
      version: v.version,
      effectiveFrom: v.effectiveFrom,
      archivedAt: v.archivedAt,
      createdAt: v.createdAt,
      config: v.config,
    })),
    latest: latest.map((l) => ({
      planKey: l.planKey,
      name: l.name,
      version: l.version,
      archived: !!l.archivedAt,
      plan: l.plan,
    })),
    people: people
      .filter((p) => p.baseRole === "tech" || tc.some((t) => t.userId === p.id))
      .map((p) => {
        const t = tps.get(p.id);
        return {
          id: p.id,
          name: p.name,
          role: p.role,
          workerType: p.workerType,
          planKey: t?.planKey ?? s.payroll.default_plan_key,
          planName: t?.planName ?? s.payroll.default_plan_key,
          overrides: t?.overrides ?? {},
          agreementSigned: !!t?.agreementSignatureId,
          agreementVersion: t?.agreementPlanVersion ?? null,
        };
      }),
    roles: roleRows,
    serviceTypes: svc,
    mileage,
  };
});

/** S43 data: one person's plan, overrides, agreement and bank status. */
export async function techCompSummary(userId: string) {
  const tz = await companyTz();
  const tp = (await techPlans(db, [userId], todayKey(tz))).get(userId);
  if (!tp) return null;
  const agreement = await agreementFor(userId);
  const [bank] = await db
    .select({
      last4: users.bankLast4,
      routing: users.bankRoutingEnc,
      changedAt: users.bankChangedAt,
      verifiedAt: users.bankVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const s = await getSettings();
  const holdMs = s.payroll.bank_change_hold_hours * 3_600_000;
  const svc = tp.overrides.by_service_type
    ? await db
        .select({ id: serviceTypes.id, name: serviceTypes.name })
        .from(serviceTypes)
        .where(
          inArray(serviceTypes.id, Object.keys(tp.overrides.by_service_type)),
        )
    : [];
  return {
    tp,
    agreement,
    serviceNames: Object.fromEntries(svc.map((x) => [x.id, x.name])),
    bank: {
      hasBank: !!bank?.routing,
      last4: bank?.last4 ?? null,
      changedAt: bank?.changedAt ?? null,
      hold:
        !!bank?.changedAt &&
        Date.now() - bank.changedAt.getTime() < holdMs &&
        !(bank.verifiedAt && bank.verifiedAt >= bank.changedAt),
    },
  };
}

/** S42 extras for a user (viewer already authorized by the slot). */
export async function getPayOverviewFor(userId: string) {
  const [pp] = await db
    .select({ n: sql<string>`coalesce(sum(${partPurchases.totalCents}), 0)` })
    .from(partPurchases)
    .where(
      and(
        eq(partPurchases.purchaserUserId, userId),
        eq(partPurchases.paidBy, "tech"),
        eq(partPurchases.status, "pending"),
      ),
    );
  const [ack] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(settlements)
    .where(
      and(
        eq(settlements.userId, userId),
        sql`${settlements.techAckAt} is null`,
        sql`${settlements.status} <> 'draft'`,
      ),
    );
  const agreement = await agreementFor(userId);
  return {
    pendingReimbursementCents: Number(pp?.n ?? 0),
    toAck: ack?.n ?? 0,
    agreementRequired: !!agreement?.required,
  };
}
