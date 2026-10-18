import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  depositRequests,
  invoices,
  jobs,
  lineItems,
  policyVersions,
  properties,
} from "@/db/schema";
import { loadInvoiceDoc } from "@/features/invoices/doc";
import {
  invoiceTotalRows,
  type TotalRow,
} from "@/features/invoices/money-lines";
import type { PublicTokenRow } from "@/lib/tokens";
import { balanceOf, OPEN_DEPOSIT_STATUSES } from "./internal";

// Data for the public pay page /p/[token] and its checkout action. The pay token's
// entity is an invoice (balance due) or a deposit request (deposit amount).

export interface PayTarget {
  kind: "invoice" | "deposit";
  invoiceId: string | null;
  depositRequestId: string | null;
  jobId: string | null;
  jobNumber: string | null;
  customerId: string;
  customer: { name: string; email: string | null; phone: string | null };
  address: {
    line1: string;
    city: string;
    state: string;
    postal_code: string;
  } | null;
  title: string;
  /** Amount due now (balance or open deposit); 0 when settled. */
  dueCents: number;
  totalCents: number;
  paidCents: number;
  state: "due" | "paid" | "closed";
  lines: { name: string; qty: number; unitCents: number; totalCents: number }[];
  /**
   * Invoices: the totals rows of the invoice document (subtotal, discount, tax,
   * total, then payments, credits and refunds), so the page foots to the
   * balance due like the invoice does (QA2 re-check). Null for deposits.
   */
  totals: TotalRow[] | null;
  /** Fee lines (trip / service-call fee) — tips aren't calculated on them by default. */
  feeLinesCents: number;
  depositMode: "capture" | "hold" | "card_on_file" | "manual" | null;
  policy: { title: string; body: string; version: number } | null;
  riskBand: string | null;
}

export async function loadPayTarget(
  tok: PublicTokenRow,
): Promise<PayTarget | null> {
  if (tok.entityType === "invoice") {
    const [r] = await db
      .select({ inv: invoices, job: jobs, c: customers, p: properties })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(jobs, eq(jobs.id, invoices.jobId))
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(invoices.id, tok.entityId))
      .limit(1);
    if (!r) return null;
    const bal = await balanceOf(db, r.inv.id);
    const lines = await db
      .select()
      .from(lineItems)
      .where(
        and(
          eq(lineItems.parentType, "invoice"),
          eq(lineItems.parentId, r.inv.id),
        ),
      )
      .orderBy(asc(lineItems.sort));
    const due = Math.max(0, bal?.balanceCents ?? Number(r.inv.totalCents));
    const doc = await loadInvoiceDoc(r.inv.id);
    return {
      kind: "invoice",
      invoiceId: r.inv.id,
      depositRequestId: null,
      jobId: r.inv.jobId,
      jobNumber: r.job?.number ?? null,
      customerId: r.c.id,
      customer: { name: r.c.displayName, email: r.c.email, phone: r.c.phone },
      address: r.p
        ? {
            line1: r.p.street,
            city: r.p.city,
            state: r.p.state,
            postal_code: r.p.zip,
          }
        : null,
      title: `Invoice ${r.inv.number}`,
      dueCents: due,
      totalCents: Number(r.inv.totalCents),
      paidCents: bal?.paidCents ?? 0,
      state:
        r.inv.status === "void" || r.inv.status === "draft"
          ? "closed"
          : due <= 0
            ? "paid"
            : "due",
      lines: lines
        .filter((l) => !l.isOptional || l.isSelected)
        .map((l) => ({
          name: l.name,
          qty: Number(l.qty),
          unitCents: Number(l.unitPriceCents),
          totalCents: Number(l.totalCents),
        })),
      totals: doc
        ? invoiceTotalRows(doc.invoice, doc.credits, {
            taxExempt: doc.customer.taxExempt,
          })
        : null,
      feeLinesCents: lines
        .filter((l) => l.type === "fee" || l.isServiceFee)
        .reduce((s, l) => s + Number(l.totalCents), 0),
      depositMode: null,
      policy: null,
      riskBand: r.job?.riskBand ?? null,
    };
  }
  if (tok.entityType === "deposit_request") {
    const [r] = await db
      .select({
        d: depositRequests,
        job: jobs,
        c: customers,
        p: properties,
        pol: policyVersions,
      })
      .from(depositRequests)
      .leftJoin(jobs, eq(jobs.id, depositRequests.jobId))
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .leftJoin(
        policyVersions,
        eq(policyVersions.id, depositRequests.policyVersionId),
      )
      .where(eq(depositRequests.id, tok.entityId))
      .limit(1);
    if (!r?.c) return null;
    const open = (OPEN_DEPOSIT_STATUSES as readonly string[]).includes(
      r.d.status,
    );
    const paid = ["paid", "held", "applied"].includes(r.d.status);
    return {
      kind: "deposit",
      invoiceId: null,
      depositRequestId: r.d.id,
      jobId: r.d.jobId,
      jobNumber: r.job?.number ?? null,
      customerId: r.c.id,
      customer: { name: r.c.displayName, email: r.c.email, phone: r.c.phone },
      address: r.p
        ? {
            line1: r.p.street,
            city: r.p.city,
            state: r.p.state,
            postal_code: r.p.zip,
          }
        : null,
      title: r.job?.number ? `Deposit for job ${r.job.number}` : "Deposit",
      dueCents: open ? r.d.amountCents : 0,
      totalCents: r.d.amountCents,
      paidCents: paid ? r.d.amountCents : 0,
      state: open ? "due" : paid ? "paid" : "closed",
      lines: [
        {
          name: r.job?.title ? `Deposit: ${r.job.title}` : "Deposit",
          qty: 1,
          unitCents: r.d.amountCents,
          totalCents: r.d.amountCents,
        },
      ],
      totals: null,
      feeLinesCents: 0,
      depositMode: r.d.mode as PayTarget["depositMode"],
      policy: r.pol
        ? { title: r.pol.title, body: r.pol.body, version: r.pol.version }
        : null,
      riskBand: r.job?.riskBand ?? null,
    };
  }
  return null;
}
