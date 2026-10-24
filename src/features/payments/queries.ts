import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { cache } from "react";
import { getPayments, hasCardProcessor } from "@/adapters/payments";
import { db } from "@/db";
import {
  customers,
  depositRequests,
  depositRules,
  invoices,
  jobs,
  lineItems,
  media,
  payments,
  policyVersions,
  refunds,
  users,
} from "@/db/schema";
import { assertInvoiceAccess } from "@/features/invoices/api";
import { assertJobAccess } from "@/features/jobs/api";
import { requireUser } from "@/lib/auth/current";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { getSettings, isEnabled } from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import type {
  CollectContext,
  PaymentListRow,
  RefundListRow,
} from "./contracts";
import {
  balanceOf,
  methodLabel,
  OPEN_DEPOSIT_STATUSES,
  PAID_STATUSES,
  refundedByPayment,
} from "./internal";

// Read DAL for payments screens. requireUser(perm) first; row scope enforced here.

const PAGE = 50;

function dayBounds(
  from: string | undefined,
  to: string | undefined,
  tz: string,
) {
  const at = (key: string) =>
    zonedTimeToUtc({ ...parseDateKey(key), hour: 0, minute: 0 }, tz);
  return {
    from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? at(from) : null,
    to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? at(addDaysToKey(to, 1)) : null,
  };
}

export type PaymentsTab = "all" | "unverified" | "reconciliation" | "refunds";

export interface PaymentFilters {
  tab: PaymentsTab;
  method?: string;
  tech?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

function rowOf(
  r: {
    p: typeof payments.$inferSelect;
    customerName: string | null;
    jobNumber: string | null;
    invoiceNumber: string | null;
    collector: string | null;
  },
  refunded: number,
  unverifiedDays: number,
  now: Date,
): PaymentListRow {
  const p = r.p;
  const manual = p.provider === "manual";
  const at = p.succeededAt ?? p.authorizedAt ?? p.createdAt;
  return {
    id: p.id,
    kind: p.kind,
    method: p.method,
    methodLabel: methodLabel(p),
    provider: p.provider,
    status: p.status,
    amountCents: p.amountCents,
    tipCents: p.tipCents,
    feeCents: p.feeCents,
    feeSource: p.feeSource,
    refundedCents: refunded,
    at: at.toISOString(),
    customerId: p.customerId,
    customerName: r.customerName ?? "Customer",
    jobId: p.jobId,
    jobNumber: r.jobNumber,
    invoiceId: p.invoiceId,
    invoiceNumber: r.invoiceNumber,
    collectedByName: r.collector,
    reference: p.reference,
    entryMode: p.entryMode,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    needsVerify:
      manual &&
      !p.verifiedAt &&
      (PAID_STATUSES as readonly string[]).includes(p.status),
    staleUnverified:
      manual &&
      !p.verifiedAt &&
      now.getTime() - at.getTime() > unverifiedDays * 86_400_000,
    providerRef: p.providerRef,
    proofMediaId: p.proofMediaId,
  };
}

const listBase = () =>
  db
    .select({
      p: payments,
      customerName: customers.displayName,
      jobNumber: jobs.number,
      invoiceNumber: invoices.number,
      collector: users.name,
    })
    .from(payments)
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(jobs, eq(jobs.id, payments.jobId))
    .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
    .leftJoin(users, eq(users.id, payments.collectedByUserId));

/** /payments list (all or unverified), cursor = ISO created_at of the last row. */
export const listPayments = cache(
  async (
    f: PaymentFilters,
  ): Promise<{ rows: PaymentListRow[]; nextCursor: string | null }> => {
    await requireUser("payments.view_all");
    const s = await getSettings();
    const { getCompanyTimezone } = await import("@/lib/settings");
    const tz = await getCompanyTimezone();
    const b = dayBounds(f.from, f.to, tz);
    const conds = [ne(payments.status, "pending")];
    if (f.tab === "unverified")
      conds.push(
        eq(payments.provider, "manual"),
        isNull(payments.verifiedAt),
        inArray(payments.status, [...PAID_STATUSES]),
      );
    if (f.method) conds.push(eq(payments.method, f.method));
    if (f.tech) conds.push(eq(payments.collectedByUserId, f.tech));
    if (b.from) conds.push(gte(payments.createdAt, b.from));
    if (b.to) conds.push(lt(payments.createdAt, b.to));
    if (f.cursor && !Number.isNaN(Date.parse(f.cursor)))
      conds.push(lt(payments.createdAt, new Date(f.cursor)));
    const rows = await listBase()
      .where(and(...conds))
      .orderBy(
        f.tab === "unverified"
          ? asc(payments.createdAt)
          : desc(payments.createdAt),
      )
      .limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    const refunded = await refundedByPayment(page.map((r) => r.p.id));
    const now = new Date();
    return {
      rows: page.map((r) =>
        rowOf(
          r,
          refunded.get(r.p.id) ?? 0,
          s.payments.unverified_alert_days,
          now,
        ),
      ),
      nextCursor:
        rows.length > PAGE && f.tab !== "unverified"
          ? (page.at(-1)?.p.createdAt.toISOString() ?? null)
          : null,
    };
  },
);

export interface PaymentsSummary {
  todayCents: number;
  weekCents: number;
  unverifiedCount: number;
  unverifiedStale: number;
  refundsDue: number;
  cardFeesMonthCents: number;
}

export const getPaymentsSummary = cache(async (): Promise<PaymentsSummary> => {
  await requireUser("payments.view_all");
  const { getCompanyTimezone } = await import("@/lib/settings");
  const tz = await getCompanyTimezone();
  const s = await getSettings();
  const today = dateKey(new Date(), tz);
  const at = (key: string) =>
    zonedTimeToUtc({ ...parseDateKey(key), hour: 0, minute: 0 }, tz);
  const startToday = at(today);
  const startWeek = at(addDaysToKey(today, -6));
  const startMonth = at(`${today.slice(0, 8)}01`);
  const sum = async (from: Date) => {
    const [r] = await db
      .select({
        n: sql<number>`coalesce(sum(${payments.amountCents} + ${payments.tipCents}), 0)::bigint`,
      })
      .from(payments)
      .where(
        and(
          inArray(payments.status, [...PAID_STATUSES]),
          gte(payments.succeededAt, from),
        ),
      );
    return Number(r?.n ?? 0);
  };
  const [unv] = await db
    .select({
      n: sql<number>`count(*)::int`,
      stale: sql<number>`count(*) filter (where ${payments.succeededAt} < now() - make_interval(days => ${s.payments.unverified_alert_days}))::int`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.provider, "manual"),
        isNull(payments.verifiedAt),
        inArray(payments.status, [...PAID_STATUSES]),
      ),
    );
  const [due] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(refunds)
    .where(inArray(refunds.status, ["scheduled", "pending"]));
  const [fees] = await db
    .select({ n: sql<number>`coalesce(sum(${payments.feeCents}), 0)::bigint` })
    .from(payments)
    .where(
      and(
        eq(payments.method, "card"),
        inArray(payments.status, [...PAID_STATUSES]),
        gte(payments.succeededAt, startMonth),
      ),
    );
  return {
    todayCents: await sum(startToday),
    weekCents: await sum(startWeek),
    unverifiedCount: Number(unv?.n ?? 0),
    unverifiedStale: Number(unv?.stale ?? 0),
    refundsDue: Number(due?.n ?? 0),
    cardFeesMonthCents: Number(fees?.n ?? 0),
  };
});

export interface ReconDay {
  day: string;
  count: number;
  grossCents: number;
  feeCents: number;
  refundCents: number;
  netCents: number;
  missingFee: number;
}
export interface ReconIssue {
  kind:
    | "no_processor_ref"
    | "fee_not_fetched"
    | "invoice_paid_unmatched"
    | "manual_unverified"
    | "authorized_hold";
  label: string;
  detail: string;
  href: string;
  amountCents: number;
}

/**
 * Reconciliation (SPEC M09): card settlements by day (gross − fees − refunds = expected
 * payout) and flagged items: card payments without a processor ref or actual fee,
 * invoices marked paid whose card payments don't add up, manual payments unverified
 * longer than the alert window, open auth holds.
 */
export const getReconciliation = cache(
  async (days = 14): Promise<{ days: ReconDay[]; issues: ReconIssue[] }> => {
    await requireUser("payments.view_all");
    const { getCompanyTimezone } = await import("@/lib/settings");
    const tz = await getCompanyTimezone();
    const s = await getSettings();
    const since = new Date(Date.now() - days * 86_400_000);
    const cards = await db
      .select({ p: payments, jobNumber: jobs.number })
      .from(payments)
      .leftJoin(jobs, eq(jobs.id, payments.jobId))
      .where(
        and(
          eq(payments.method, "card"),
          inArray(payments.status, [...PAID_STATUSES, "authorized"]),
          gte(payments.createdAt, since),
        ),
      )
      .orderBy(desc(payments.createdAt));
    const refunded = await refundedByPayment(cards.map((c) => c.p.id));
    const byDay = new Map<string, ReconDay>();
    const issues: ReconIssue[] = [];
    for (const { p, jobNumber } of cards) {
      const at = p.succeededAt ?? p.createdAt;
      const label = jobNumber ? `Job ${jobNumber}` : "Card payment";
      if (p.status === "authorized") {
        issues.push({
          kind: "authorized_hold",
          label,
          detail: p.captureBefore
            ? `Hold to capture before ${p.captureBefore.toLocaleDateString("en-US")}`
            : "Card hold not captured yet",
          href: p.jobId ? `/jobs/${p.jobId}?tab=invoice` : "/payments",
          amountCents: p.amountCents,
        });
        continue;
      }
      const k = dateKey(at, tz);
      const d = byDay.get(k) ?? {
        day: k,
        count: 0,
        grossCents: 0,
        feeCents: 0,
        refundCents: 0,
        netCents: 0,
        missingFee: 0,
      };
      d.count += 1;
      d.grossCents += p.amountCents + p.tipCents;
      d.feeCents += p.feeCents;
      d.refundCents += refunded.get(p.id) ?? 0;
      if (p.feeSource !== "actual") d.missingFee += 1;
      d.netCents = d.grossCents - d.feeCents - d.refundCents;
      byDay.set(k, d);
      if (!p.providerRef && p.provider !== "manual")
        issues.push({
          kind: "no_processor_ref",
          label,
          detail: "Card payment has no processor reference",
          href: p.jobId ? `/jobs/${p.jobId}?tab=invoice` : "/payments",
          amountCents: p.amountCents,
        });
      else if (p.provider === "stripe" && p.feeSource !== "actual")
        issues.push({
          kind: "fee_not_fetched",
          label,
          detail: "Processor fee not fetched yet (estimate used)",
          href: p.jobId ? `/jobs/${p.jobId}?tab=invoice` : "/payments",
          amountCents: p.amountCents,
        });
    }
    // Invoices marked paid in the window whose payments don't cover the total.
    const paidInv = await db
      .select({
        id: invoices.id,
        number: invoices.number,
        jobId: invoices.jobId,
        total: invoices.totalCents,
      })
      .from(invoices)
      .where(and(eq(invoices.status, "paid"), gte(invoices.updatedAt, since)))
      .limit(200);
    for (const inv of paidInv) {
      const bal = await balanceOf(db, inv.id);
      if (bal && bal.balanceCents > 0)
        issues.push({
          kind: "invoice_paid_unmatched",
          label: `Invoice ${inv.number}`,
          detail: `Marked paid but ${(bal.balanceCents / 100).toFixed(2)} is unaccounted for`,
          href: `/invoices/${inv.id}`,
          amountCents: bal.balanceCents,
        });
    }
    const stale = await db
      .select({ p: payments, jobNumber: jobs.number })
      .from(payments)
      .leftJoin(jobs, eq(jobs.id, payments.jobId))
      .where(
        and(
          eq(payments.provider, "manual"),
          isNull(payments.verifiedAt),
          inArray(payments.status, [...PAID_STATUSES]),
          lte(
            payments.succeededAt,
            new Date(
              Date.now() - s.payments.unverified_alert_days * 86_400_000,
            ),
          ),
        ),
      )
      .limit(100);
    for (const { p, jobNumber } of stale)
      issues.push({
        kind: "manual_unverified",
        label: jobNumber ? `Job ${jobNumber}` : "Manual payment",
        detail: `${methodLabel(p)} not verified in the bank for over ${s.payments.unverified_alert_days} days`,
        href: "/payments?tab=unverified",
        amountCents: p.amountCents,
      });
    return {
      days: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)),
      issues,
    };
  },
);

/** Refunds tab: scheduled (promised) and pending first, then recent. */
export const listRefunds = cache(async (): Promise<RefundListRow[]> => {
  await requireUser("payments.view_all");
  const rows = await db
    .select({
      r: refunds,
      p: payments,
      customerName: customers.displayName,
      jobNumber: jobs.number,
      creator: users.name,
    })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(jobs, eq(jobs.id, payments.jobId))
    .leftJoin(users, eq(users.id, refunds.createdBy))
    .orderBy(
      sql`case when ${refunds.status} in ('scheduled','pending') then 0 else 1 end`,
      asc(refunds.dueAt),
      desc(refunds.createdAt),
    )
    .limit(100);
  const now = Date.now();
  return rows.map(({ r, p, customerName, jobNumber, creator }) => ({
    id: r.id,
    paymentId: p.id,
    amountCents: r.amountCents,
    reason: r.reason,
    status: r.status,
    dueAt: r.dueAt?.toISOString() ?? null,
    overdue:
      !!r.dueAt &&
      ["scheduled", "pending"].includes(r.status) &&
      r.dueAt.getTime() < now,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    customerName: customerName ?? "Customer",
    jobId: p.jobId,
    jobNumber,
    methodLabel: methodLabel(p),
    provider: p.provider,
    createdByName: creator,
  }));
});

/** Payments for one job (S16). Row scope via assertJobAccess. */
export async function getJobPaymentsPanel(jobId: string, user: SessionUser) {
  const job = await assertJobAccess(user, jobId, "read");
  const rows = await listBase()
    .where(eq(payments.jobId, jobId))
    .orderBy(asc(payments.createdAt));
  const refunded = await refundedByPayment(rows.map((r) => r.p.id));
  const s = await getSettings();
  const now = new Date();
  const refundRows = rows.length
    ? await db
        .select()
        .from(refunds)
        .where(
          inArray(
            refunds.paymentId,
            rows.map((r) => r.p.id),
          ),
        )
        .orderBy(asc(refunds.createdAt))
    : [];
  const deps = await db
    .select()
    .from(depositRequests)
    .where(eq(depositRequests.jobId, jobId))
    .orderBy(desc(depositRequests.createdAt));
  const [inv] = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      total: invoices.totalCents,
    })
    .from(invoices)
    .where(
      and(eq(invoices.jobId, jobId), notInArray(invoices.status, ["void"])),
    )
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  const bal = inv ? await balanceOf(db, inv.id) : null;
  return {
    job,
    invoice: inv
      ? {
          id: inv.id,
          number: inv.number,
          status: inv.status,
          totalCents: Number(inv.total),
          balanceCents: bal?.balanceCents ?? Number(inv.total),
          /** Payments net of refunds (invoice part; tips excluded). */
          paidNetCents: bal ? bal.paidCents - bal.refundedCents : 0,
          creditedCents: bal?.creditedCents ?? 0,
        }
      : null,
    payments: rows.map((r) =>
      rowOf(
        r,
        refunded.get(r.p.id) ?? 0,
        s.payments.unverified_alert_days,
        now,
      ),
    ),
    refunds: refundRows.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      amountCents: r.amountCents,
      status: r.status,
      reason: r.reason,
      dueAt: r.dueAt?.toISOString() ?? null,
    })),
    deposits: deps.map((d) => ({
      id: d.id,
      amountCents: d.amountCents,
      mode: d.mode,
      status: d.status,
      dueAt: d.dueAt?.toISOString() ?? null,
      capWarning: d.capWarning,
      specialOrderPoAt: d.specialOrderPoAt?.toISOString() ?? null,
      paidAt:
        rows
          .find((r) => r.p.id === d.paymentId)
          ?.p.succeededAt?.toISOString() ?? null,
      waiveReason: d.waiveReason,
    })),
  };
}

/** Customer payments history (S17). */
export async function getCustomerPayments(customerId: string) {
  const rows = await listBase()
    .where(eq(payments.customerId, customerId))
    .orderBy(desc(payments.createdAt))
    .limit(30);
  const refunded = await refundedByPayment(rows.map((r) => r.p.id));
  const s = await getSettings();
  const now = new Date();
  const open = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      jobId: invoices.jobId,
      total: invoices.totalCents,
      issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        inArray(invoices.status, ["issued", "partially_paid"]),
      ),
    )
    .orderBy(asc(invoices.issuedAt));
  const openWithBal = [];
  for (const i of open) {
    const b = await balanceOf(db, i.id);
    if ((b?.balanceCents ?? 0) > 0)
      openWithBal.push({
        id: i.id,
        number: i.number,
        jobId: i.jobId,
        totalCents: Number(i.total),
        balanceCents: b?.balanceCents ?? 0,
      });
  }
  return {
    payments: rows.map((r) =>
      rowOf(
        r,
        refunded.get(r.p.id) ?? 0,
        s.payments.unverified_alert_days,
        now,
      ),
    ),
    openInvoices: openWithBal,
  };
}

const ON_SITE = new Set(["en_route", "arrived", "in_progress", "on_hold"]);

/** The visit is happening, or finished within the last 12 hours. */
function onSiteVisit(
  job: { status: string; completedAt: Date | null } | null,
  now: Date,
): boolean {
  if (!job) return false;
  if (ON_SITE.has(job.status)) return true;
  return (
    job.status === "completed" &&
    !!job.completedAt &&
    now.getTime() - job.completedAt.getTime() < 12 * 3_600_000
  );
}

/**
 * Everything the Collect-payment sheet needs (S19/S20). Scoped: the job must be visible
 * to the viewer; risk-band card restrictions applied (§11.1).
 */
export async function getCollectContext(
  user: SessionUser,
  q: {
    jobId?: string | null;
    invoiceId?: string | null;
    allowDeposit?: boolean;
  },
): Promise<CollectContext> {
  const s = await getSettings();
  let jobId = q.jobId ?? null;
  let invoiceId = q.invoiceId ?? null;
  if (invoiceId) {
    // Always scope the invoice (T5-03): it must belong to the requested job, and a
    // jobless invoice needs office-wide visibility.
    const [inv] = await db
      .select({ jobId: invoices.jobId, customerId: invoices.customerId })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (!inv) throw new NotFoundError("Invoice");
    if (jobId && inv.jobId !== jobId) throw new ForbiddenError();
    jobId = inv.jobId ?? null;
    if (!jobId && !user.perms.has("payments.view_all"))
      await assertInvoiceAccess(user, invoiceId, "read");
  }
  let job: Awaited<ReturnType<typeof assertJobAccess>> | null = null;
  if (jobId) job = await assertJobAccess(user, jobId, "read");
  if (!invoiceId && jobId) {
    const [inv] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(eq(invoices.jobId, jobId), notInArray(invoices.status, ["void"])),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    invoiceId = inv?.id ?? null;
  }
  const [inv] = invoiceId
    ? await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1)
    : [];
  const bal = inv ? await balanceOf(db, inv.id) : null;
  const customerId = inv?.customerId ?? job?.customerId ?? null;
  const [cust] = customerId
    ? await db
        .select({
          name: customers.displayName,
          firstName: customers.firstName,
          phone: customers.phone,
          email: customers.email,
          prepay: customers.prepayRequired,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1)
    : [];
  // Fee lines (no tips on them by default) and the line count (an empty draft has
  // nothing to collect yet).
  const feeLines = inv
    ? await db
        .select({
          n: sql<number>`coalesce(sum(${lineItems.totalCents}) filter (where ${or(eq(lineItems.type, "fee"), eq(lineItems.isServiceFee, true))}), 0)::bigint`,
          lines: sql<number>`count(*)::int`,
        })
        .from(lineItems)
        .where(
          and(
            eq(lineItems.parentType, "invoice"),
            eq(lineItems.parentId, inv.id),
          ),
        )
    : [];
  const deps = jobId
    ? await db
        .select()
        .from(depositRequests)
        .where(eq(depositRequests.jobId, jobId))
        .orderBy(desc(depositRequests.createdAt))
    : [];
  const openDeposit = deps.find((d) =>
    (OPEN_DEPOSIT_STATUSES as readonly string[]).includes(d.status),
  );
  const paidDeposits = jobId
    ? await db
        .select({ amount: payments.amountCents, at: payments.succeededAt })
        .from(payments)
        .where(
          and(
            eq(payments.jobId, jobId),
            eq(payments.kind, "deposit"),
            inArray(payments.status, [...PAID_STATUSES]),
          ),
        )
    : [];
  const band = (job?.riskBand ?? null) as CollectContext["riskBand"];
  const protection = await isEnabled("chargeback_protection");
  const high =
    protection &&
    s.risk.enforce_controls &&
    (band === "high" || band === "critical");
  const cashOnly =
    protection &&
    s.risk.enforce_controls &&
    band === "critical" &&
    s.risk.critical_control === "cash_only";
  const processor = hasCardProcessor();
  const methods = (s.payments.methods as string[]).filter(
    (m) => !(cashOnly && (m === "card" || m === "venmo")),
  );
  const depositsOn = await isEnabled("deposits");
  return {
    jobId,
    jobNumber: job?.number ?? null,
    invoiceId: inv?.id ?? null,
    invoiceNumber: inv?.number ?? null,
    invoiceStatus: inv?.status ?? null,
    invoiceHasLines: Number(feeLines[0]?.lines ?? 0) > 0,
    issuesDraft: inv?.status === "draft" && user.perms.has("invoices.create"),
    manualInstructions: s.payments.manual_instructions,
    customerFirstName:
      cust?.firstName?.trim() || cust?.name?.split(" ")[0] || null,
    customerId,
    customerName: cust?.name ?? null,
    customerHasPhone: !!cust?.phone,
    customerHasEmail: !!cust?.email,
    totalCents: inv ? Number(inv.totalCents) : 0,
    balanceCents: bal ? Math.max(0, bal.balanceCents) : 0,
    feeLinesCents: Number(feeLines[0]?.n ?? 0),
    depositPaid: paidDeposits.length
      ? {
          amountCents: paidDeposits.reduce((x, d) => x + d.amount, 0),
          at: paidDeposits[0]?.at?.toISOString() ?? null,
        }
      : null,
    openDeposit:
      depositsOn && openDeposit && q.allowDeposit !== false
        ? {
            id: openDeposit.id,
            amountCents: openDeposit.amountCents,
            mode: openDeposit.mode,
            status: openDeposit.status,
          }
        : null,
    methods,
    // T2-20: tips are offered on site (a tech collecting, or the visit is happening /
    // just finished), never on an office-recorded AR payment like a mailed check.
    tipsEnabled:
      s.payments.tips_enabled &&
      (user.baseRole === "tech" || onSiteVisit(job, new Date())),
    tipPresets: s.payments.tip_presets_pct,
    tipOnFees: s.payments.tip_on_fees,
    referenceRequired: s.payments.reference_required as string[],
    requireCheckPhoto: s.payments.require_check_photo,
    cardLinks: processor && getPayments().caps.links,
    keyedAllowed:
      !high && s.payments.allow_keyed && user.perms.has("payments.keyed_entry"),
    riskBand: band,
    cardRestriction: cashOnly
      ? "Critical risk: cash or bank transfer only."
      : high
        ? "High risk: card only via a 3-D Secure pay link (no typed cards)."
        : null,
    feePolicy: s.payments.fee_policy,
    cashDiscountBps: s.payments.cash_discount_bps,
    canRecordManual: user.perms.has("payments.record_manual"),
    canCollectCard: user.perms.has("payments.collect"),
    isTech: user.baseRole === "tech",
    userId: user.id,
    prepayRequired: !!cust?.prepay,
  };
}

// ------------------------------------------------------------------ settings

export const getDepositRulesForSettings = cache(async () => {
  await requireUser("settings.manage");
  const rows = await db
    .select({
      r: depositRules,
      policyTitle: policyVersions.title,
      v: policyVersions.version,
    })
    .from(depositRules)
    .leftJoin(
      policyVersions,
      eq(policyVersions.id, depositRules.policyVersionId),
    )
    .orderBy(asc(depositRules.priority), asc(depositRules.name));
  const used = rows.length
    ? await db
        .select({
          ruleId: depositRequests.ruleId,
          n: sql<number>`count(*)::int`,
        })
        .from(depositRequests)
        .where(
          inArray(
            depositRequests.ruleId,
            rows.map((r) => r.r.id),
          ),
        )
        .groupBy(depositRequests.ruleId)
    : [];
  const usedBy = new Map(used.map((u) => [u.ruleId, Number(u.n)]));
  return rows.map(({ r, policyTitle, v }) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    active: r.active,
    trigger: r.trigger,
    amount: r.amount,
    mode: r.mode,
    policyLabel: policyTitle ? `${policyTitle} v${v}` : null,
    uses: usedBy.get(r.id) ?? 0,
  }));
});

/** Proof photo URL for a payment (resolves an offline client id). */
export async function proofMediaFor(paymentId: string): Promise<string | null> {
  const [p] = await db
    .select({ id: payments.proofMediaId, raw: payments.raw })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!p) return null;
  if (p.id) return p.id;
  const cid = (p.raw as Record<string, unknown> | null)?.proof_client_id;
  if (typeof cid !== "string") return null;
  const [m] = await db
    .select({ id: media.id })
    .from(media)
    .where(eq(media.clientId, cid))
    .limit(1);
  return m?.id ?? null;
}
