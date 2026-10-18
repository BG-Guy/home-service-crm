import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, execRows, type Tx } from "@/db";
import {
  company,
  customers,
  type depositRequests,
  depositRules,
  disputes,
  estimateOptions,
  estimates,
  invoices,
  jobs,
  leads,
  lineItems,
  payments,
  policyVersions,
  pricebookItems,
  refunds,
  serviceTypes,
} from "@/db/schema";
import { setJobPaymentStatus } from "@/features/jobs/api";
import type { PaymentStatus } from "@/features/jobs/contracts";
import { getSettings } from "@/lib/settings";
import type { DepositBrief, PaymentBrief } from "./contracts";
import type { DepositFacts, DepositRuleLike } from "./engine/deposit-rules";

// Internal helpers shared by payments api/actions/webhooks (not a cross-module contract).

export const PAID_STATUSES = [
  "succeeded",
  "partially_refunded",
  "refunded",
  "disputed",
] as const;
export const OPEN_DISPUTE_STATUSES = [
  "inquiry",
  "needs_response",
  "under_review",
] as const;
export const OPEN_DEPOSIT_STATUSES = ["required", "requested"] as const;
/** Job statuses where the office can still ask for a deposit (pre-start, on hold). */
export const DEPOSIT_JOB_STATUSES: ReadonlySet<string> = new Set([
  "unscheduled",
  "scheduled",
  "confirmed",
  "on_hold",
]);
export const LIVE_DEPOSIT_STATUSES = [
  "required",
  "requested",
  "paid",
  "held",
  "applied",
  "waived",
] as const;

export type PaymentRow = typeof payments.$inferSelect;
export type DepositRow = typeof depositRequests.$inferSelect;

export const METHOD_LABEL: Record<string, string> = {
  card: "Card",
  ach: "Bank (ACH)",
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  venmo: "Venmo",
  other: "Other",
};

export function methodLabel(p: {
  method: string;
  cardBrand?: string | null;
  cardLast4?: string | null;
}): string {
  if (p.method === "card" && p.cardLast4) {
    const b = p.cardBrand
      ? p.cardBrand.charAt(0).toUpperCase() + p.cardBrand.slice(1)
      : "Card";
    return `${b} ••${p.cardLast4}`;
  }
  return METHOD_LABEL[p.method] ?? p.method;
}

export function toPaymentBrief(
  p: PaymentRow,
  refundedCents: number,
): PaymentBrief {
  return {
    id: p.id,
    kind: p.kind as PaymentBrief["kind"],
    method: p.method,
    provider: p.provider,
    status: p.status,
    amountCents: p.amountCents,
    tipCents: p.tipCents,
    feeCents: p.feeCents,
    succeededAt: p.succeededAt,
    collectedByUserId: p.collectedByUserId,
    verifiedAt: p.verifiedAt,
    last4: p.cardLast4,
    entryMode: p.entryMode,
    refundedCents,
  };
}

export function toDepositBrief(
  d: DepositRow,
  paidAt: Date | null,
): DepositBrief {
  return {
    id: d.id,
    jobId: d.jobId,
    estimateId: d.estimateId,
    amountCents: d.amountCents,
    mode: d.mode as DepositBrief["mode"],
    status: d.status,
    dueAt: d.dueAt,
    paidAt,
    policyVersionId: d.policyVersionId,
    capWarning: d.capWarning,
  };
}

/** Σ succeeded refunds per payment. */
export async function refundedByPayment(
  paymentIds: string[],
  exec: Tx = db,
): Promise<Map<string, number>> {
  if (paymentIds.length === 0) return new Map();
  const rows = await exec
    .select({
      paymentId: refunds.paymentId,
      amount: sql<number>`coalesce(sum(${refunds.amountCents}), 0)::bigint`,
    })
    .from(refunds)
    .where(
      and(
        inArray(refunds.paymentId, paymentIds),
        eq(refunds.status, "succeeded"),
      ),
    )
    .groupBy(refunds.paymentId);
  return new Map(rows.map((r) => [r.paymentId, Number(r.amount)]));
}

async function latestInvoiceRow(exec: Tx, jobId: string) {
  const [r] = await exec
    .select()
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return r ?? null;
}

/** Live balance from the invoice_balances view (inside the caller's tx). */
export async function balanceOf(exec: Tx, invoiceId: string) {
  const [row] = await execRows<{
    t: number | string;
    p: number | string;
    r: number | string;
    c: number | string;
  }>(
    sql`select total_cents as t, paid_cents as p, refunded_cents as r, credited_cents as c from invoice_balances where invoice_id = ${invoiceId}`,
    exec,
  );
  if (!row) return null;
  const t = Number(row.t);
  const p = Number(row.p);
  const r = Number(row.r);
  const c = Number(row.c);
  return {
    totalCents: t,
    paidCents: p,
    refundedCents: r,
    creditedCents: c,
    balanceCents: t - p + r - c,
  };
}

/**
 * Recompute the job's payment_status cache (B2 setter) from payments, refunds,
 * disputes and the latest invoice. Idempotent; returns the new status.
 */
export async function recomputeJobPaymentStatus(
  tx: Tx,
  jobId: string,
): Promise<PaymentStatus> {
  const [job] = await tx
    .select({ status: jobs.paymentStatus })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return "none";
  const pays = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.jobId, jobId),
        inArray(payments.status, [...PAID_STATUSES]),
      ),
    );
  const refunded = await refundedByPayment(
    pays.map((p) => p.id),
    tx,
  );
  const open = pays.length
    ? await tx
        .select({ id: disputes.id })
        .from(disputes)
        .where(
          and(
            inArray(
              disputes.paymentId,
              pays.map((p) => p.id),
            ),
            inArray(disputes.status, [...OPEN_DISPUTE_STATUSES]),
          ),
        )
        .limit(1)
    : [];
  const gross = pays.reduce((s, p) => s + p.amountCents, 0);
  const refundTotal = [...refunded.values()].reduce((s, v) => s + v, 0);
  const net = gross - refundTotal;
  const inv = await latestInvoiceRow(tx, jobId);
  let next: PaymentStatus;
  if (open.length) next = "disputed";
  else if (gross > 0 && net <= 0) next = "refunded";
  else if (inv && inv.status !== "draft") {
    const bal = await balanceOf(tx, inv.id);
    const balance = bal?.balanceCents ?? inv.totalCents;
    if (balance <= 0) next = "paid";
    else if (net > 0)
      next = pays.every((p) => p.kind === "deposit")
        ? "deposit_paid"
        : "partial";
    else next = "none";
  } else if (net > 0) {
    next = pays.every((p) => p.kind === "deposit") ? "deposit_paid" : "partial";
  } else next = "none";
  if (next !== job.status) await setJobPaymentStatus(tx, jobId, next);
  return next;
}

// ------------------------------------------------------------------ deposits

export async function activeDepositRules(): Promise<DepositRuleLike[]> {
  const rows = await db
    .select()
    .from(depositRules)
    .where(eq(depositRules.active, true));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    active: r.active,
    trigger: r.trigger as DepositRuleLike["trigger"],
    amount: r.amount as DepositRuleLike["amount"],
    mode: r.mode,
    policyVersionId: r.policyVersionId,
  }));
}

type LineLite = {
  type: string;
  totalCents: number;
  pricebookItemId: string | null;
  isSelected: boolean;
};

async function lineFacts(lines: LineLite[]) {
  const sel = lines.filter((l) => l.isSelected);
  const ids = [
    ...new Set(sel.map((l) => l.pricebookItemId).filter(Boolean) as string[]),
  ];
  const special = ids.length
    ? new Set(
        (
          await db
            .select({ id: pricebookItems.id })
            .from(pricebookItems)
            .where(
              and(
                inArray(pricebookItems.id, ids),
                eq(pricebookItems.isSpecialOrder, true),
              ),
            )
        ).map((r) => r.id),
      )
    : new Set<string>();
  const total = sel.reduce((s, l) => s + l.totalCents, 0);
  const parts = sel
    .filter((l) => l.type === "part" || l.type === "material")
    .reduce((s, l) => s + l.totalCents, 0);
  const so = sel
    .filter((l) => l.pricebookItemId && special.has(l.pricebookItemId))
    .reduce((s, l) => s + l.totalCents, 0);
  return {
    totalCents: Math.max(0, total),
    partsCents: parts,
    specialOrderPartsCents: so,
  };
}

async function customerFacts(customerId: string, excludeJobId?: string | null) {
  const [c] = await db
    .select({
      prepay: customers.prepayRequired,
      dispute: customers.disputeHistory,
      leadSourceId: customers.leadSourceId,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const [prior] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(
      and(
        eq(jobs.customerId, customerId),
        inArray(jobs.status, ["completed", "closed"]),
        excludeJobId ? ne(jobs.id, excludeJobId) : undefined,
      ),
    );
  return {
    flags: { prepayRequired: !!c?.prepay, disputeHistory: !!c?.dispute },
    leadSourceId: c?.leadSourceId ?? null,
    newCustomer: Number(prior?.n ?? 0) === 0,
  };
}

function daysOut(start: Date | null, now = new Date()): number | null {
  if (!start) return null;
  return Math.max(
    0,
    Math.floor((start.getTime() - now.getTime()) / 86_400_000),
  );
}

/** Engine facts for a job (lines from its latest invoice, else the approved option). */
export async function depositFactsForJob(
  jobId: string,
): Promise<{ facts: DepositFacts; customerId: string } | null> {
  const [j] = await db
    .select({
      job: jobs,
      contractKind: serviceTypes.contractKind,
      leadSourceId: leads.leadSourceId,
      quoted: leads.quotedPriceCents,
    })
    .from(jobs)
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .leftJoin(leads, eq(leads.id, jobs.leadId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!j) return null;
  const inv = await latestInvoiceRow(db, jobId);
  let lines: LineLite[] = [];
  if (inv) {
    lines = await db
      .select({
        type: lineItems.type,
        totalCents: lineItems.totalCents,
        pricebookItemId: lineItems.pricebookItemId,
        isSelected: lineItems.isSelected,
      })
      .from(lineItems)
      .where(
        and(
          eq(lineItems.parentType, "invoice"),
          eq(lineItems.parentId, inv.id),
        ),
      );
  }
  if (lines.length === 0) {
    lines = await db
      .select({
        type: lineItems.type,
        totalCents: lineItems.totalCents,
        pricebookItemId: lineItems.pricebookItemId,
        isSelected: lineItems.isSelected,
      })
      .from(estimates)
      .innerJoin(
        lineItems,
        and(
          eq(lineItems.parentType, "estimate_option"),
          eq(lineItems.parentId, estimates.approvedOptionId),
        ),
      )
      .where(and(eq(estimates.jobId, jobId), eq(estimates.status, "approved")));
  }
  const lf = await lineFacts(lines);
  const cf = await customerFacts(j.job.customerId, jobId);
  const total = Math.max(lf.totalCents, Number(j.quoted ?? 0));
  return {
    customerId: j.job.customerId,
    facts: {
      totalCents: total,
      partsCents: lf.partsCents,
      specialOrderPartsCents: lf.specialOrderPartsCents,
      afterHours: j.job.afterHours,
      newCustomer: cf.newCustomer,
      riskBand: (j.job.riskBand as DepositFacts["riskBand"]) ?? null,
      scheduledDaysOut: daysOut(j.job.scheduledStart ?? j.job.windowStart),
      serviceTypeId: j.job.serviceTypeId,
      leadSourceId: j.leadSourceId ?? cf.leadSourceId,
      customerFlags: cf.flags,
      contractKind: (j.contractKind as DepositFacts["contractKind"]) ?? null,
    },
  };
}

/** Engine facts for an estimate option (recommended, else the most expensive). */
export async function depositFactsForEstimate(
  estimateId: string,
  optionId?: string | null,
): Promise<{
  facts: DepositFacts;
  customerId: string;
  jobId: string | null;
  optionId: string | null;
} | null> {
  const [est] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!est) return null;
  const opts = await db
    .select()
    .from(estimateOptions)
    .where(eq(estimateOptions.estimateId, estimateId));
  const allLines = opts.length
    ? await db
        .select({
          parentId: lineItems.parentId,
          type: lineItems.type,
          totalCents: lineItems.totalCents,
          pricebookItemId: lineItems.pricebookItemId,
          isSelected: lineItems.isSelected,
        })
        .from(lineItems)
        .where(
          and(
            eq(lineItems.parentType, "estimate_option"),
            inArray(
              lineItems.parentId,
              opts.map((o) => o.id),
            ),
          ),
        )
    : [];
  const totals = opts.map((o) => ({
    o,
    total: allLines
      .filter((l) => l.parentId === o.id && l.isSelected)
      .reduce((s, l) => s + l.totalCents, 0),
  }));
  const chosen =
    (optionId && totals.find((t) => t.o.id === optionId)) ||
    (est.approvedOptionId &&
      totals.find((t) => t.o.id === est.approvedOptionId)) ||
    totals.find((t) => t.o.recommended) ||
    totals.sort((a, b) => b.total - a.total)[0];
  const lf = await lineFacts(
    allLines.filter((l) => l.parentId === chosen?.o.id),
  );
  const cf = await customerFacts(est.customerId, est.jobId);
  let job: typeof jobs.$inferSelect | null = null;
  let contractKind: string | null = null;
  if (est.jobId) {
    const [j] = await db
      .select({ job: jobs, ck: serviceTypes.contractKind })
      .from(jobs)
      .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
      .where(eq(jobs.id, est.jobId))
      .limit(1);
    job = j?.job ?? null;
    contractKind = j?.ck ?? null;
  }
  return {
    customerId: est.customerId,
    jobId: est.jobId,
    optionId: chosen?.o.id ?? null,
    facts: {
      totalCents: lf.totalCents,
      partsCents: lf.partsCents,
      specialOrderPartsCents: lf.specialOrderPartsCents,
      afterHours: job?.afterHours ?? false,
      newCustomer: cf.newCustomer,
      riskBand: (job?.riskBand as DepositFacts["riskBand"]) ?? null,
      scheduledDaysOut: daysOut(
        job?.scheduledStart ?? job?.windowStart ?? null,
      ),
      serviceTypeId: job?.serviceTypeId ?? null,
      leadSourceId: cf.leadSourceId,
      customerFlags: cf.flags,
      contractKind: (contractKind as DepositFacts["contractKind"]) ?? null,
    },
  };
}

export async function companyState(): Promise<string | null> {
  const [c] = await db
    .select({ state: company.state })
    .from(company)
    .where(eq(company.id, 1))
    .limit(1);
  return c?.state ?? null;
}

/** One-line policy summary shown with a deposit (estimate builder, /e/, /p/). */
export async function depositPolicyShort(): Promise<string> {
  const s = await getSettings();
  const parts: string[] = [];
  if (s.deposits.refundable_until_hours > 0)
    parts.push(
      `Refundable if you cancel at least ${s.deposits.refundable_until_hours} hours before your appointment.`,
    );
  else parts.push("Refundable until work begins.");
  if (s.deposits.nonrefundable_after_po)
    parts.push("Non-refundable once special-order parts are ordered.");
  if (s.deposits.restocking_pct > 0)
    parts.push(`A ${s.deposits.restocking_pct}% restocking fee may apply.`);
  parts.push("Applied to your final invoice.");
  return parts.join(" ");
}

export async function policySha(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [p] = await db
    .select({ sha: policyVersions.sha256 })
    .from(policyVersions)
    .where(eq(policyVersions.id, id))
    .limit(1);
  return p?.sha ?? null;
}
