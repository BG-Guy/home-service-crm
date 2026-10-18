import "server-only";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  creditNotes,
  estimates,
  invoices,
  jobAssignments,
  jobEarnings,
  jobFinancials,
  jobs,
  leads,
  lineItems,
  partPurchases,
  payments,
  refunds,
  reviewRequests,
} from "@/db/schema";
import { writeActivity } from "@/lib/activity";
import { lineTotalCents } from "@/lib/money";
import { addDaysToKey, dateKey } from "@/lib/time";
import type { Actor } from "@/lib/types";
import {
  computeJob,
  type JobFinancialInputs,
  type JobResult,
  jobPostings,
  type PaymentInput,
  type PaymentMethod,
  planRecompute,
  resolvePlan,
} from "../engine";
import {
  activeJobEntries,
  insertPostings,
  jobAdjustmentTotals,
  reverseEntries,
} from "./ledger";
import { planVersionOn, type TechPlan, techPlans, toTechInput } from "./plans";
import { companyTz, settingsOf, todayKey } from "./util";

const COMPANY_SOURCES = new Set([
  "company_stock",
  "company_po",
  "company_card",
]);
const PAID_STATUSES = [
  "succeeded",
  "partially_refunded",
  "refunded",
  "disputed",
];

export interface LoadedJob {
  fin: JobFinancialInputs;
  job: typeof jobs.$inferSelect;
  invoiceStatus: string | null;
  /** Settled by payments + credits (refunds afterwards don't un-earn it). */
  paidInFull: boolean;
  effectiveDate: string;
  earnedCandidate: boolean;
  techPlans: Map<string, TechPlan>;
  primaryPlan: TechPlan | null;
}

/** loadJobFinancialInputs (SPEC §10.2) — every read goes through `tx`. */
export async function loadJobFinancialInputs(
  tx: Tx,
  jobId: string,
): Promise<LoadedJob | null> {
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;
  const tz = await companyTz(tx);
  const today = todayKey(tz);

  const assigns = await tx
    .select({
      userId: jobAssignments.userId,
      role: jobAssignments.role,
      splitBps: jobAssignments.splitBps,
      at: jobAssignments.assignedAt,
    })
    .from(jobAssignments)
    .where(eq(jobAssignments.jobId, jobId))
    .orderBy(asc(jobAssignments.assignedAt));
  const assignees = [...assigns]
    .sort(
      (a, b) =>
        (a.role === "primary" ? 0 : 1) - (b.role === "primary" ? 0 : 1) ||
        a.at.getTime() - b.at.getTime(),
    )
    .map((a) => ({
      userId: a.userId,
      role: (a.role === "helper" ? "helper" : "primary") as
        | "primary"
        | "helper",
      splitBps: a.splitBps,
    }));

  const [inv] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.version), desc(invoices.createdAt))
    .limit(1);
  const lines = inv
    ? await tx
        .select()
        .from(lineItems)
        .where(
          and(
            eq(lineItems.parentType, "invoice"),
            eq(lineItems.parentId, inv.id),
          ),
        )
    : [];
  let revenue = 0;
  let companyParts = 0;
  let laborCost = 0;
  let hasDiscountLine = false;
  const pricebookTotals: Record<string, number> = {};
  for (const l of lines) {
    if (l.isOptional && !l.isSelected) continue;
    if (l.type === "discount") {
      hasDiscountLine = true;
      revenue -= Math.abs(l.totalCents);
      continue;
    }
    revenue += l.totalCents;
    if (l.pricebookItemId)
      pricebookTotals[l.pricebookItemId] =
        (pricebookTotals[l.pricebookItemId] ?? 0) + l.totalCents;
    const cost =
      l.unitCostCents != null
        ? lineTotalCents(Number(l.qty), l.unitCostCents)
        : 0;
    if (
      (l.type === "part" || l.type === "material") &&
      (l.partSource == null || COMPANY_SOURCES.has(l.partSource))
    )
      companyParts += cost;
    if (l.type === "labor") laborCost += cost;
  }
  if (inv && !hasDiscountLine && inv.discountCents > 0)
    revenue -= inv.discountCents;

  const purchases = await tx
    .select({
      purchaser: partPurchases.purchaserUserId,
      total: partPurchases.totalCents,
      status: partPurchases.status,
    })
    .from(partPurchases)
    .where(
      and(eq(partPurchases.jobId, jobId), eq(partPurchases.paidBy, "tech")),
    );
  const techPartsByUser: Record<string, number> = {};
  let pending = 0;
  for (const p of purchases) {
    if (!p.purchaser) continue;
    if (p.status === "approved")
      techPartsByUser[p.purchaser] =
        (techPartsByUser[p.purchaser] ?? 0) + p.total;
    else if (p.status === "pending") pending += p.total;
  }

  const payRows = await tx
    .select()
    .from(payments)
    .where(
      and(
        inv
          ? or(eq(payments.jobId, jobId), eq(payments.invoiceId, inv.id))
          : eq(payments.jobId, jobId),
        inArray(payments.status, PAID_STATUSES),
      ),
    );
  // A lost dispute is recorded as a `dispute_lost` refund; the chargeback rules
  // (hold/release/clawback) already handle it, so it never touches earnings here.
  const refundRows = payRows.length
    ? await tx
        .select({ paymentId: refunds.paymentId, amount: refunds.amountCents })
        .from(refunds)
        .where(
          and(
            inArray(
              refunds.paymentId,
              payRows.map((p) => p.id),
            ),
            eq(refunds.status, "succeeded"),
            ne(refunds.reason, "dispute_lost"),
          ),
        )
    : [];
  const refunded = new Map<string, number>();
  for (const r of refundRows)
    refunded.set(r.paymentId, (refunded.get(r.paymentId) ?? 0) + r.amount);
  // Amounts as charged; the engine nets refunds (amount first, tip only beyond it).
  const pays: PaymentInput[] = payRows.map((p) => ({
    id: p.id,
    method: p.method as PaymentMethod,
    amountCents: p.amountCents,
    tipCents: p.tipCents,
    refundedCents: refunded.get(p.id) ?? 0,
    feeCents: p.feeCents,
    collectedByUserId: p.collectedByUserId,
    kind: p.kind as PaymentInput["kind"],
  }));
  const [credit] = inv
    ? await tx
        .select({
          c: sql<number>`coalesce(sum(${creditNotes.amountCents}), 0)::bigint`,
        })
        .from(creditNotes)
        .where(eq(creditNotes.invoiceId, inv.id))
    : [];
  const creditedCents = Number(credit?.c ?? 0);
  // "Paid in full" = the invoice was settled by payments and credits, whatever was
  // refunded afterwards: a partial refund adjusts commission proportionally instead
  // of un-earning the whole job (lead decision, QA T6-07).
  const grossPaid = pays.reduce((a, p) => a + p.amountCents, 0);
  const paidInFull =
    inv?.status === "paid" ||
    (!!inv &&
      inv.status !== "draft" &&
      inv.totalCents > 0 &&
      grossPaid + creditedCents >= inv.totalCents);

  let recallInWindow = false;
  const userIds = new Set<string>([
    ...assignees.map((a) => a.userId),
    ...Object.keys(techPartsByUser),
  ]);
  for (const p of pays)
    if (p.collectedByUserId) userIds.add(p.collectedByUserId);
  const completedDay = job.completedAt ? dateKey(job.completedAt, tz) : null;
  const effectiveDate = completedDay ?? today;
  const plans = await techPlans(tx, [...userIds], effectiveDate);
  const primary = assignees[0]
    ? (plans.get(assignees[0].userId) ?? null)
    : null;
  if (job.isCallback && job.callbackOfJobId) {
    const [orig] = await tx
      .select({ completedAt: jobs.completedAt })
      .from(jobs)
      .where(eq(jobs.id, job.callbackOfJobId))
      .limit(1);
    const windowDays = primary?.plan.recalls.window_days ?? 30;
    if (orig?.completedAt) {
      const origDay = dateKey(orig.completedAt, tz);
      recallInWindow =
        addDaysToKey(origDay, windowDays) >= dateKey(job.createdAt, tz);
    }
  }

  let leadCost = 0;
  if (job.leadId) {
    const [l] = await tx
      .select({ c: leads.sourceCostCents })
      .from(leads)
      .where(eq(leads.id, job.leadId))
      .limit(1);
    leadCost = l?.c ?? 0;
  }
  let soldBy: string | null = null;
  if (job.estimateId) {
    const [e] = await tx
      .select({ by: estimates.createdBy })
      .from(estimates)
      .where(eq(estimates.id, job.estimateId))
      .limit(1);
    soldBy = e?.by ?? null;
  }
  const reviews = await tx
    .select({ tech: reviewRequests.techUserId })
    .from(reviewRequests)
    .where(
      and(
        eq(reviewRequests.jobId, jobId),
        sql`${reviewRequests.reviewReceivedAt} is not null`,
      ),
    );

  const fin: JobFinancialInputs = {
    jobId,
    revenueCents: revenue,
    taxCents: inv?.taxCents ?? 0,
    serviceTypeId: job.serviceTypeId,
    customRateBps: job.customRateBps,
    isCallback: job.isCallback,
    recallInWindow,
    payments: pays,
    companyPartsCents: companyParts,
    techPartsByUser,
    pendingTechPartsCents: pending,
    leadCostCents: leadCost,
    subcontractCostCents: 0,
    laborCostCents: laborCost,
    pricebookTotals,
    reviewBonusUserIds: reviews
      .map((r) => r.tech)
      .filter((x): x is string => !!x),
    soldByUserId: soldBy,
    assignees,
    invoiceTotalCents: inv?.totalCents ?? 0,
    creditedCents,
  };
  return {
    fin,
    job,
    invoiceStatus: inv?.status ?? null,
    paidInFull,
    effectiveDate,
    earnedCandidate: job.status === "completed" || job.status === "closed",
    techPlans: plans,
    primaryPlan: primary,
  };
}

export interface RecomputeResult {
  computed: boolean;
  earned: boolean;
  locked: boolean;
  reversed: number;
  posted: number;
  result: JobResult | null;
}

/**
 * Compute job financials + earnings and post the ledger (§10.2): reverse prior
 * unsettled entries that changed, post new ones; after lock → adjustments only.
 * Idempotent: an unchanged job posts nothing.
 */
export async function recomputeJobFinancials(
  tx: Tx,
  jobId: string,
  actor: Actor,
  reason = "recompute",
): Promise<RecomputeResult> {
  const loaded = await loadJobFinancialInputs(tx, jobId);
  const none: RecomputeResult = {
    computed: false,
    earned: false,
    locked: false,
    reversed: 0,
    posted: 0,
    result: null,
  };
  if (!loaded) return none;
  const { job, fin, primaryPlan } = loaded;
  const hasReimb = Object.keys(fin.techPartsByUser).length > 0;
  const [existingFin] = await tx
    .select()
    .from(jobFinancials)
    .where(eq(jobFinancials.jobId, jobId))
    .limit(1);
  const locked = !!existingFin?.lockedAt;
  const existing = await activeJobEntries(tx, jobId);
  if (
    !loaded.earnedCandidate &&
    !hasReimb &&
    existing.length === 0 &&
    !existingFin
  )
    return none;

  const planRef = primaryPlan ?? [...loaded.techPlans.values()][0] ?? null;
  let usePlan = planRef?.plan;
  if (!usePlan) {
    const s = await settingsOf(tx);
    usePlan =
      (
        await planVersionOn(
          tx,
          s.payroll.default_plan_key,
          loaded.effectiveDate,
        )
      )?.plan ?? resolvePlan({});
  }
  const techs = [...loaded.techPlans.values()].map(toTechInput);
  const result = computeJob(fin, usePlan, techs, {
    planLabel: planRef
      ? `${planRef.planName} v${planRef.planVersion}`
      : undefined,
  });

  const cancelled = job.status === "cancelled";
  const earned =
    !cancelled &&
    loaded.earnedCandidate &&
    (usePlan.earned_on === "job_done" || loaded.paidInFull);

  if (!locked && !cancelled) {
    const values = {
      revenueCents: result.revenueCents,
      taxCents: result.taxCents,
      tipCents: result.tipCents,
      companyPartsCents: result.companyPartsCents,
      techPartsCents: result.techPartsCents,
      feesCents: result.feesCents,
      feesOnTipsCents: result.feesOnTipsCents,
      otherDeductionsCents: result.otherDeductionsCents,
      baseCents: result.baseCents,
      companyNetCents: result.companyNetCents,
      planKey: planRef?.planKey ?? "partner_25",
      planVersion: planRef?.planVersion ?? 1,
      trace: {
        company: result.trace,
        flags: result.flags,
        earned,
        reason,
      } as unknown as Record<string, unknown>,
      computedAt: new Date(),
    };
    await tx
      .insert(jobFinancials)
      .values({ jobId, ...values })
      .onConflictDoUpdate({ target: jobFinancials.jobId, set: values });
    await tx.delete(jobEarnings).where(eq(jobEarnings.jobId, jobId));
    if (result.earnings.length)
      await tx.insert(jobEarnings).values(
        result.earnings.map((e) => ({
          jobId,
          userId: e.userId,
          splitBps: e.splitBps,
          rateBps: e.rateBps,
          rateSource: e.rateSource,
          commissionCents: e.commissionCents,
          spiffsCents: e.spiffsCents,
          tipCents: e.tipCents,
          reimbursementCents: e.reimbursementCents,
          cashHeldCents: e.cashHeldCents,
          netCents: e.netCents,
          trace: {
            steps: e.trace,
            techKeepsCash: e.techKeepsCash,
            cashSettlement: e.cashSettlement,
          } as unknown as Record<string, unknown>,
        })),
      );
  }

  const target = jobPostings(result, { earned, jobNumber: job.number }).filter(
    (p) => !cancelled || p.type === "reimbursement_parts",
  );
  const plan2 = planRecompute(existing, target, {
    locked,
    memo: `Job ${job.number} changed after lock (${reason})`,
    postedAdjustments: locked
      ? await jobAdjustmentTotals(tx, jobId)
      : undefined,
  });
  const tz = await companyTz(tx);
  const today = todayKey(tz);
  if (plan2.reverse.length)
    await reverseEntries(tx, plan2.reverse, `job ${job.number} ${reason}`, {
      actorUserId: actor.userId,
      today,
    });
  if (plan2.post.length)
    await insertPostings(tx, plan2.post, {
      effectiveDate: locked ? today : loaded.effectiveDate,
      jobId,
      refTable: "job_financials",
      refId: jobId,
      actorUserId: actor.userId,
      today,
    });
  if (plan2.reverse.length || plan2.post.length) {
    await writeActivity(tx, {
      entity: { type: "job", id: jobId },
      customerId: job.customerId,
      kind: "job.financials_recomputed",
      summary: locked
        ? `Pay adjustment posted for ${job.number}`
        : `Earnings ${earned ? "posted" : "updated"} for ${job.number}`,
      data: {
        reason,
        reversed: plan2.reverse.length,
        posted: plan2.post.length,
      },
      actorUserId: actor.userId,
    });
  }
  return {
    computed: true,
    earned,
    locked,
    reversed: plan2.reverse.length,
    posted: plan2.post.length,
    result,
  };
}
