import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { jobEarnings, jobFinancials, payPeriods, users } from "@/db/schema";
import { can } from "@/lib/permissions";
import type { Actor, SessionUser } from "@/lib/types";
import type {
  CustodyBalance,
  ExternalLedgerType,
  JobFinancialsView,
} from "./contracts";
import type { TraceStep } from "./engine";
import { custodyFor } from "./server/custody";
import { insertPostings } from "./server/ledger";
import { latestPlans, techPlans } from "./server/plans";
import { companyTz, todayKey } from "./server/util";

// B6 payroll API (BUILD_PLAN §6.6). Writes take `tx` first and `actor` last; no perms
// unless a viewer is passed. Internals live in ./server/* (not for other groups).

export type * from "./contracts";

/** jobs.view_financials → everything; otherwise payroll.view_own → company=null and only the viewer's row. */
export async function getJobFinancials(
  jobId: string,
  viewer: SessionUser,
): Promise<JobFinancialsView | null> {
  const full = can(viewer, "jobs.view_financials");
  if (!full && !can(viewer, "payroll.view_own")) return null;
  const [f] = await db
    .select()
    .from(jobFinancials)
    .where(eq(jobFinancials.jobId, jobId))
    .limit(1);
  if (!f) return null;
  const rows = await db
    .select({ e: jobEarnings, name: users.name })
    .from(jobEarnings)
    .innerJoin(users, eq(users.id, jobEarnings.userId))
    .where(eq(jobEarnings.jobId, jobId));
  const visible = full ? rows : rows.filter((r) => r.e.userId === viewer.id);
  if (!full && visible.length === 0) return null;
  const trace = (f.trace ?? {}) as { company?: TraceStep[] };
  return {
    jobId,
    locked: !!f.lockedAt,
    planKey: f.planKey,
    planVersion: f.planVersion,
    company: full
      ? {
          revenueCents: f.revenueCents,
          taxCents: f.taxCents,
          tipCents: f.tipCents,
          companyPartsCents: f.companyPartsCents,
          techPartsCents: f.techPartsCents,
          feesCents: f.feesCents,
          feesOnTipsCents: f.feesOnTipsCents,
          otherDeductionsCents: f.otherDeductionsCents,
          baseCents: f.baseCents,
          companyNetCents: f.companyNetCents,
          trace: trace.company ?? [],
        }
      : null,
    earnings: visible.map(({ e, name }) => ({
      userId: e.userId,
      name,
      splitBps: e.splitBps,
      rateBps: e.rateBps,
      rateSource: e.rateSource,
      commissionCents: e.commissionCents,
      spiffsCents: e.spiffsCents,
      tipCents: e.tipCents,
      reimbursementCents: e.reimbursementCents,
      cashHeldCents: e.cashHeldCents,
      netCents: e.netCents,
      trace: ((e.trace ?? {}) as { steps?: TraceStep[] }).steps ?? [],
    })),
  };
}

/** Custody balance per tech (SPEC M16 formula; checks never netted). */
export async function getCustodyBalances(
  userIds: string[],
): Promise<Record<string, CustodyBalance>> {
  const r = await custodyFor(userIds);
  return Object.fromEntries(
    Object.entries(r).map(([id, c]) => [
      id,
      {
        heldCents: c.heldCents,
        cashCents: c.cashCents,
        checksCents: c.checksCents,
        oldestAt: c.oldestAt,
      },
    ]),
  );
}

/** Live earnings in the current pay period (entries effective in the period, excluding payouts). */
export async function getPeriodEarnings(userId: string): Promise<{
  payPeriodId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  netCents: number;
  byType: Partial<Record<string, number>>;
}> {
  const today = todayKey(await companyTz());
  const [p] = await db
    .select()
    .from(payPeriods)
    .where(and(lte(payPeriods.startsOn, today), gte(payPeriods.endsOn, today)))
    .limit(1);
  if (!p)
    return {
      payPeriodId: null,
      startsOn: null,
      endsOn: null,
      netCents: 0,
      byType: {},
    };
  const rows = (await db.execute(sql`
    select type, coalesce(sum(amount_cents), 0)::bigint as n from ledger_entries
    where user_id = ${userId}::uuid and type <> 'payout' and effective_date between ${p.startsOn}::date and ${p.endsOn}::date
      and not (needs_review and reverses_id is null and not exists (select 1 from ledger_entries r where r.reverses_id = ledger_entries.id))
    group by type`)) as unknown as {
    rows: { type: string; n: string | number }[];
  };
  const byType: Record<string, number> = {};
  let net = 0;
  for (const r of rows.rows) {
    byType[r.type] = Number(r.n);
    net += Number(r.n);
  }
  return {
    payPeriodId: p.id,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    netCents: net,
    byType,
  };
}

const WAGE_CLASS: Record<
  ExternalLedgerType,
  "wage" | "reimbursement" | "custody" | "n/a"
> = {
  reimbursement_mileage: "reimbursement",
  reimbursement_expense: "reimbursement",
  tool_deduction: "wage",
  tool_allowance: "wage",
  tool_deposit: "wage",
  adjustment: "wage",
};

/**
 * Append-only insert for other groups. W-2 deductions (tool_*) are forced needs_review;
 * an effective date in a closed period is posted into the open period with a memo.
 * Never call for commission/tip/cash types.
 */
export async function postLedgerEntry(
  tx: Tx,
  input: {
    userId: string;
    type: ExternalLedgerType;
    amountCents: number;
    effectiveDate: string;
    jobId?: string | null;
    refTable: string;
    refId: string;
    wageClass?: "wage" | "reimbursement" | "custody" | "n/a";
    memo?: string | null;
    needsReview?: boolean;
  },
  actor: Actor,
): Promise<{ ledgerEntryId: string }> {
  const [u] = await tx
    .select({ workerType: users.workerType })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const w2Deduction =
    u?.workerType === "w2" &&
    (input.type === "tool_deduction" ||
      input.type === "tool_deposit" ||
      (input.type === "adjustment" && input.amountCents < 0));
  const today = todayKey(await companyTz(tx));
  const [id] = await insertPostings(
    tx,
    [
      {
        userId: input.userId,
        type: input.type,
        amountCents: input.amountCents,
        wageClass: input.wageClass ?? WAGE_CLASS[input.type],
        needsReview: w2Deduction || (input.needsReview ?? false),
        memo: input.memo ?? input.type.replace(/_/g, " "),
      },
    ],
    {
      effectiveDate: input.effectiveDate,
      jobId: input.jobId ?? null,
      refTable: input.refTable,
      refId: input.refId,
      actorUserId: actor.userId,
      today,
    },
  );
  if (!id) throw new Error("ledger insert failed");
  return { ledgerEntryId: id };
}

/** Plan key + latest version vs the version the tech signed (agreement banner, team list). */
export async function getCompAgreementStatuses(userIds: string[]): Promise<
  Record<
    string,
    {
      planKey: string | null;
      currentVersion: number | null;
      signedVersion: number | null;
      required: boolean;
    }
  >
> {
  const out: Record<
    string,
    {
      planKey: string | null;
      currentVersion: number | null;
      signedVersion: number | null;
      required: boolean;
    }
  > = {};
  if (userIds.length === 0) return out;
  const today = todayKey(await companyTz());
  const plans = await techPlans(db, userIds, today);
  const latest = new Map(
    (await latestPlans()).map((p) => [p.planKey, p.version]),
  );
  for (const id of userIds) {
    const tp = plans.get(id);
    // Agreements apply to techs and to anyone explicitly assigned a plan (tech_comp row).
    if (!tp || (tp.baseRole !== "tech" && !tp.techCompId)) {
      out[id] = {
        planKey: null,
        currentVersion: null,
        signedVersion: null,
        required: false,
      };
      continue;
    }
    const currentVersion = latest.get(tp.planKey) ?? tp.planVersion;
    const signedVersion = tp.agreementSignatureId
      ? tp.agreementPlanVersion
      : null;
    out[id] = {
      planKey: tp.planKey,
      currentVersion,
      signedVersion,
      required: signedVersion !== currentVersion,
    };
  }
  return out;
}
