import "server-only";
import { and, asc, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  creditNotes,
  customers,
  invoiceBalances,
  invoiceRevisions,
  invoices,
  jobAssignments,
  jobs,
  lineItems,
  serviceTypes,
  taxRates,
} from "@/db/schema";
import { setJobPaymentStatus } from "@/features/jobs/api";
import { lockEvidenceMedia, selectInvoicePhotos } from "@/features/media/api";
import { linkDepositsToInvoice } from "@/features/payments/api";
import { writeActivity } from "@/lib/activity";
import { writeAudit } from "@/lib/audit";
import { nextNumber } from "@/lib/counters";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { emit } from "@/lib/events";
import { sha256Json } from "@/lib/hash";
import { descriptorSuffix } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import type { Actor, SessionUser } from "@/lib/types";
import type {
  InvoiceStatus,
  InvoiceSummary,
  JobLine,
  LineInput,
  LineType,
  PartSource,
} from "./contracts";
import {
  balanceOf,
  computeLineTotal,
  computeTotals,
  type DueTerms,
  dueDateFor,
  mathLines,
  nextInvoiceStatus,
  TERMS_LABEL,
} from "./math";
import { buildInvoiceSnapshot, type InvoiceSnapshot } from "./snapshot";

// B3 invoices API (BUILD_PLAN §6.3). Writes take tx first and actor last, run inside
// the caller's transaction, emit B3's own events and write B3's activity/audit rows.
// Issued invoices are immutable: lines change only through a revision (reviseInvoice
// in actions.ts), which snapshots, hashes and diffs the document.

export type * from "./contracts";

type InvoiceRow = typeof invoices.$inferSelect;
type LineRow = typeof lineItems.$inferSelect;

const OPEN: InvoiceStatus[] = ["issued", "partially_paid"];
export const EDITABLE_STATUSES: readonly string[] = ["draft"];

// ------------------------------------------------------------------ helpers

export async function defaultTaxBps(exec: Tx = db): Promise<number> {
  const [t] = await exec
    .select({ bps: taxRates.rateBps })
    .from(taxRates)
    .where(and(eq(taxRates.isDefault, true), eq(taxRates.active, true)))
    .limit(1);
  return t?.bps ?? 0;
}

async function loadInvoice(tx: Tx, invoiceId: string): Promise<InvoiceRow> {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new NotFoundError("Invoice");
  return inv;
}

export async function invoiceLines(
  tx: Tx,
  invoiceId: string,
): Promise<LineRow[]> {
  return tx
    .select()
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, "invoice"),
        eq(lineItems.parentId, invoiceId),
      ),
    )
    .orderBy(asc(lineItems.sort), asc(lineItems.createdAt));
}

async function latestInvoice(
  exec: Tx,
  jobId: string,
): Promise<InvoiceRow | null> {
  const [r] = await exec
    .select()
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return r ?? null;
}

/** Customer terms: residential due on receipt; commercial/property manager/warranty net N. */
export async function termsForCustomer(
  tx: Tx,
  customerId: string,
): Promise<DueTerms> {
  const [c] = await tx
    .select({ type: customers.type })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const s = (await getSettings()).invoices;
  return c?.type && c.type !== "residential"
    ? s.commercial_terms
    : s.residential_terms;
}

/** LineInput → line_items values (parent supplied by the caller). */
export function lineValues(line: LineInput) {
  const discount = Math.abs(line.discountCents ?? 0);
  return {
    type: line.type,
    pricebookItemId: line.pricebookItemId ?? null,
    name: line.name.trim().slice(0, 200),
    description: line.description?.trim() || null,
    qty: line.qty,
    unitPriceCents:
      line.type === "discount"
        ? Math.abs(line.unitPriceCents)
        : line.unitPriceCents,
    unitCostCents: line.unitCostCents ?? null,
    discountCents: line.type === "discount" ? 0 : discount,
    totalCents: computeLineTotal({
      type: line.type,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      discountCents: discount,
    }),
    taxable:
      line.type === "discount"
        ? false
        : (line.taxable ?? (line.type === "part" || line.type === "material")),
    partSource:
      line.type === "part" || line.type === "material"
        ? (line.partSource ?? null)
        : null,
    partPurchaseId: line.partPurchaseId ?? null,
    warrantyDays: line.warrantyDays ?? null,
    manufacturerWarrantyMonths: line.manufacturerWarrantyMonths ?? null,
    serial: line.serial ?? null,
    isServiceFee: line.isServiceFee ?? false,
    isUpsell: line.isUpsell ?? false,
    // Only when given: the editors' updates go through here too and must keep the
    // tag an approval wrote (estimates/api linesToInvoice reads it).
    ...(line.sourceType
      ? { sourceType: line.sourceType, sourceId: line.sourceId ?? null }
      : {}),
  };
}

/** Recompute subtotal/discount/tax/total from lines (per-line tax, tax-exempt aware). */
export async function recomputeInvoice(
  tx: Tx,
  invoiceId: string,
): Promise<{
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}> {
  const inv = await loadInvoice(tx, invoiceId);
  const [lines, bps, cust] = await Promise.all([
    invoiceLines(tx, invoiceId),
    defaultTaxBps(tx),
    tx
      .select({ taxExempt: customers.taxExempt })
      .from(customers)
      .where(eq(customers.id, inv.customerId))
      .limit(1),
  ]);
  const totals = computeTotals(mathLines(lines), bps, {
    taxExempt: cust[0]?.taxExempt,
  });
  await tx
    .update(invoices)
    .set({ ...totals, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
  return totals;
}

async function nextSort(
  tx: Tx,
  parentType: string,
  parentId: string,
): Promise<number> {
  const [r] = await tx
    .select({ m: max(lineItems.sort) })
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, parentType),
        eq(lineItems.parentId, parentId),
      ),
    );
  return (r?.m ?? -1) + 1;
}

/** Insert lines at the end of a parent (estimate option, invoice, change order). */
export async function insertLines(
  tx: Tx,
  parentType: "estimate_option" | "invoice" | "change_order",
  parentId: string,
  lines: readonly (LineInput & {
    isOptional?: boolean;
    isSelected?: boolean;
  })[],
): Promise<string[]> {
  if (lines.length === 0) return [];
  let sort = await nextSort(tx, parentType, parentId);
  const rows = await tx
    .insert(lineItems)
    .values(
      lines.map((l) => ({
        ...lineValues(l),
        parentType,
        parentId,
        sort: sort++,
        isOptional: l.isOptional ?? false,
        isSelected: l.isSelected ?? true,
      })),
    )
    .returning({ id: lineItems.id });
  return rows.map((r) => r.id);
}

/** Canonical snapshot of an invoice as stored now (for revisions and hashes). */
export async function snapshotInvoice(
  tx: Tx,
  invoiceId: string,
): Promise<InvoiceSnapshot> {
  const inv = await loadInvoice(tx, invoiceId);
  const lines = await invoiceLines(tx, invoiceId);
  return buildInvoiceSnapshot(inv, lines);
}

// ------------------------------------------------------------------ contract: drafts & lines

/**
 * The job's latest non-void invoice, or a new draft (terms by customer type, warranty
 * from the service type, photo default from settings/service type). A new draft
 * links the job's paid deposits (B4 linkDepositsToInvoice).
 */
export async function getOrCreateDraftInvoice(
  tx: Tx,
  jobId: string,
  actor: Actor,
): Promise<{ invoiceId: string; created: boolean }> {
  const existing = await latestInvoice(tx, jobId);
  if (existing) return { invoiceId: existing.id, created: false };
  const [job] = await tx
    .select({
      id: jobs.id,
      number: jobs.number,
      customerId: jobs.customerId,
      propertyId: jobs.propertyId,
      serviceTypeId: jobs.serviceTypeId,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) throw new NotFoundError("Job");
  const [st] = job.serviceTypeId
    ? await tx
        .select({
          warrantyDays: serviceTypes.warrantyDays,
          photosOnInvoice: serviceTypes.photosOnInvoice,
        })
        .from(serviceTypes)
        .where(eq(serviceTypes.id, job.serviceTypeId))
        .limit(1)
    : [];
  const settings = await getSettings();
  const terms = await termsForCustomer(tx, job.customerId);
  const number = await nextNumber(tx, "invoice");
  const [row] = await tx
    .insert(invoices)
    .values({
      number,
      jobId,
      customerId: job.customerId,
      propertyId: job.propertyId,
      terms: TERMS_LABEL[terms],
      warrantyText: st?.warrantyDays
        ? `Workmanship warranty: ${st.warrantyDays} days from the date of service.`
        : null,
      showPhotos:
        settings.invoices.photos_on_invoice && (st?.photosOnInvoice ?? true),
      descriptorSuffix: descriptorSuffix(
        settings.payments.descriptor_suffix === "invoice_number"
          ? number
          : job.number,
      ),
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id });
  if (!row) throw new Error("invoice insert failed");
  await writeActivity(tx, {
    entity: { type: "invoice", id: row.id },
    customerId: job.customerId,
    jobId,
    kind: "invoice.created",
    summary: `Invoice ${number} started`,
    actorUserId: actor.userId,
  });
  await linkDepositsToInvoice(tx, jobId, row.id, actor);
  return { invoiceId: row.id, created: true };
}

/**
 * Adds a line to the job's DRAFT invoice (creating it); recomputes totals; activity
 * 'invoice.line_added'. ConflictError('invoice_issued') when the invoice is issued.
 */
export async function addJobLine(
  tx: Tx,
  jobId: string,
  line: LineInput,
  actor: Actor,
): Promise<{ lineItemId: string; invoiceId: string }> {
  const { invoiceId } = await getOrCreateDraftInvoice(tx, jobId, actor);
  const inv = await loadInvoice(tx, invoiceId);
  if (inv.status !== "draft")
    throw new ConflictError(
      "invoice_issued",
      `Invoice ${inv.number} is already issued. Revise it to change lines.`,
    );
  const [lineItemId] = await insertLines(tx, "invoice", invoiceId, [line]);
  if (!lineItemId) throw new Error("line insert failed");
  await recomputeInvoice(tx, invoiceId);
  await writeActivity(tx, {
    entity: { type: "invoice", id: invoiceId },
    customerId: inv.customerId,
    jobId,
    kind: "invoice.line_added",
    summary: `Line added: ${line.name}`.slice(0, 200),
    data: { line_item_id: lineItemId, type: line.type },
    actorUserId: actor.userId,
  });
  await emitLinesChanged(tx, invoiceId, jobId, actor);
  return { lineItemId, invoiceId };
}

/** Removes a line from a DRAFT invoice. */
export async function removeJobLine(
  tx: Tx,
  lineItemId: string,
  actor: Actor,
): Promise<void> {
  const [l] = await tx
    .select()
    .from(lineItems)
    .where(eq(lineItems.id, lineItemId))
    .limit(1);
  if (!l || l.parentType !== "invoice") throw new NotFoundError("Line");
  const inv = await loadInvoice(tx, l.parentId);
  if (inv.status !== "draft")
    throw new ConflictError(
      "invoice_issued",
      `Invoice ${inv.number} is already issued. Revise it to change lines.`,
    );
  await tx.delete(lineItems).where(eq(lineItems.id, lineItemId));
  await recomputeInvoice(tx, inv.id);
  await writeActivity(tx, {
    entity: { type: "invoice", id: inv.id },
    customerId: inv.customerId,
    jobId: inv.jobId,
    kind: "invoice.line_removed",
    summary: `Line removed: ${l.name}`.slice(0, 200),
    data: { line_item_id: lineItemId },
    actorUserId: actor.userId,
  });
  await emitLinesChanged(tx, inv.id, inv.jobId, actor);
}

/**
 * 'invoice.lines_changed' after a DRAFT's lines change, so payments re-checks the
 * deposit rules ("total ≥ $X") for jobs that haven't started (QA T6-09). Every
 * line writer (addJobLine, removeJobLine, the invoice editor actions) calls it.
 */
export async function emitLinesChanged(
  tx: Tx,
  invoiceId: string,
  jobId: string | null,
  actor: Actor,
): Promise<void> {
  if (!jobId) return;
  await emit(
    tx,
    "invoice.lines_changed",
    { type: "invoice", id: invoiceId },
    { invoice_id: invoiceId, job_id: jobId },
    { actor },
  );
}

export async function listJobLines(jobId: string): Promise<JobLine[]> {
  const invs = await db
    .select({ id: invoices.id, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")));
  if (invs.length === 0) return [];
  const status = new Map(invs.map((i) => [i.id, i.status]));
  const rows = await db
    .select()
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, "invoice"),
        inArray(
          lineItems.parentId,
          invs.map((i) => i.id),
        ),
      ),
    )
    .orderBy(asc(lineItems.sort), asc(lineItems.createdAt));
  return rows.map((l) => ({
    id: l.id,
    invoiceId: l.parentId,
    invoiceStatus: status.get(l.parentId) ?? "draft",
    totalCents: l.totalCents,
    type: l.type as LineType,
    pricebookItemId: l.pricebookItemId,
    name: l.name,
    description: l.description,
    qty: Number(l.qty),
    unitPriceCents: l.unitPriceCents,
    unitCostCents: l.unitCostCents,
    discountCents: l.discountCents,
    taxable: l.taxable,
    partSource: (l.partSource as PartSource | null) ?? null,
    partPurchaseId: l.partPurchaseId,
    warrantyDays: l.warrantyDays,
    manufacturerWarrantyMonths: l.manufacturerWarrantyMonths,
    serial: l.serial,
    isServiceFee: l.isServiceFee,
    isUpsell: l.isUpsell,
  }));
}

// ------------------------------------------------------------------ contract: issue

/** Shown when someone tries to issue an invoice with no lines (QA T1-02). */
export const EMPTY_INVOICE_MESSAGE =
  "Add at least one item before issuing. For a no-charge visit, add a $0 line.";

/**
 * Issue a draft: freeze totals, due date by customer terms, lock the embedded
 * photos (B4), store revision v1 (snapshot + sha256), emit invoice.issued and sync
 * against deposits already applied. An invoice with no lines is never issued
 * (ValidationError): a no-charge visit is an explicit $0 line, and only such an
 * explicitly no-charge invoice goes straight to paid (+ invoice.paid). The job's
 * payment_status cache is re-derived through B4 → B2 (`setJobPaymentStatus`).
 * The row is locked first, so two issues at once (Get paid on two phones, or Send
 * and Get paid together) can't both pass the draft check: the later one finds it
 * issued and returns `issued: false`.
 */
export async function issueDraftInvoice(
  tx: Tx,
  invoiceId: string,
  via: "job_completed" | "manual" | "collect" | "send",
  actor: Actor,
): Promise<{
  invoiceId: string;
  number: string;
  totalCents: number;
  /** False when it wasn't a draft any more (nothing was done). */
  issued: boolean;
}> {
  await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .for("update");
  const inv = await loadInvoice(tx, invoiceId);
  if (inv.status !== "draft")
    return {
      invoiceId,
      number: inv.number,
      totalCents: inv.totalCents,
      issued: false,
    };
  if ((await invoiceLines(tx, invoiceId)).length === 0)
    throw new ValidationError(
      { lines: [EMPTY_INVOICE_MESSAGE] },
      EMPTY_INVOICE_MESSAGE,
    );
  const totals = await recomputeInvoice(tx, invoiceId);
  const now = new Date();
  const terms = await termsForCustomer(tx, inv.customerId);
  const dueAt = dueDateFor(terms, now);
  const zero = totals.totalCents === 0;
  await tx
    .update(invoices)
    .set({
      status: zero ? "paid" : "issued",
      issuedAt: now,
      dueAt,
      terms: inv.terms ?? TERMS_LABEL[terms],
      updatedAt: now,
    })
    .where(eq(invoices.id, invoiceId));
  // Evidence: the photos printed on the invoice can no longer be deleted.
  const photoIds = inv.photoMediaIds.length
    ? inv.photoMediaIds
    : inv.showPhotos
      ? (await selectInvoicePhotos(invoiceId, "invoice")).map((m) => m.id)
      : [];
  if (photoIds.length) await lockEvidenceMedia(tx, photoIds);
  const snap = await snapshotInvoice(tx, invoiceId);
  await tx
    .insert(invoiceRevisions)
    .values({
      invoiceId,
      version: inv.version,
      snapshot: snap as never,
      sha256: sha256Json(snap),
      diff: null,
      reason: "issued",
      createdBy: actor.userId,
    })
    .onConflictDoNothing();
  const entity = { type: "invoice", id: invoiceId } as const;
  await emit(
    tx,
    "invoice.issued",
    entity,
    {
      invoice_id: invoiceId,
      total_cents: totals.totalCents,
      due_at: dueAt.toISOString(),
      via,
    },
    { actor },
  );
  await writeActivity(tx, {
    entity,
    customerId: inv.customerId,
    jobId: inv.jobId,
    kind: "invoice.issued",
    summary: `Invoice ${inv.number} issued · ${formatMoney(totals.totalCents)}`,
    data: { via, total_cents: totals.totalCents },
    actorUserId: actor.userId,
  });
  let paid = zero;
  if (zero) {
    await emit(
      tx,
      "invoice.paid",
      entity,
      { invoice_id: invoiceId },
      { actor },
    );
    await writeActivity(tx, {
      entity,
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: "invoice.paid",
      summary: `Invoice ${inv.number} closed at $0`,
      actorUserId: actor.userId,
    });
  } else {
    // Deposits linked at draft time may already cover it.
    paid =
      (await syncInvoicePaymentState(tx, invoiceId, actor)).status === "paid";
  }
  // Keep jobs.payment_status in step (QA T1-02): an explicitly no-charge invoice,
  // or one the deposits already cover, leaves the job paid, written through the
  // jobs API. A disputed or refunded job keeps B4's status.
  if (paid && inv.jobId) {
    const [j] = await tx
      .select({ paymentStatus: jobs.paymentStatus })
      .from(jobs)
      .where(eq(jobs.id, inv.jobId))
      .limit(1);
    if (j && !["paid", "disputed", "refunded"].includes(j.paymentStatus))
      await setJobPaymentStatus(tx, inv.jobId, "paid");
  }
  return {
    invoiceId,
    number: inv.number,
    totalCents: totals.totalCents,
    issued: true,
  };
}

/**
 * Called by B2 on completion (via 'job_completed', honoring
 * settings.invoices.auto_issue_on_complete) and by B3's manual Issue.
 * Completing a job never auto-issues an empty invoice: with no lines the draft
 * stays a draft (returns null) for the office to fill in; the complete sheet warns
 * about it (B2). A manual issue of an empty draft throws ValidationError.
 */
export async function issueInvoiceForJob(
  tx: Tx,
  jobId: string,
  via: "job_completed" | "manual",
  actor: Actor,
): Promise<{ invoiceId: string; number: string; totalCents: number } | null> {
  if (
    via === "job_completed" &&
    !(await getSettings()).invoices.auto_issue_on_complete
  )
    return null;
  const { invoiceId } = await getOrCreateDraftInvoice(tx, jobId, actor);
  if (
    via === "job_completed" &&
    (await loadInvoice(tx, invoiceId)).status === "draft" &&
    (await invoiceLines(tx, invoiceId)).length === 0
  )
    return null;
  return issueDraftInvoice(tx, invoiceId, via, actor);
}

// ------------------------------------------------------------------ contract: reads

async function summarize(
  inv: InvoiceRow,
  exec: Tx = db,
): Promise<InvoiceSummary> {
  const [b] = await exec
    .select()
    .from(invoiceBalances)
    .where(eq(invoiceBalances.invoiceId, inv.id))
    .limit(1);
  return {
    id: inv.id,
    number: inv.number,
    jobId: inv.jobId,
    customerId: inv.customerId,
    status: inv.status as InvoiceStatus,
    version: inv.version,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    subtotalCents: inv.subtotalCents,
    discountCents: inv.discountCents,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    balanceCents:
      inv.status === "void"
        ? 0
        : b
          ? balanceOf({
              totalCents: Number(b.totalCents),
              paidCents: Number(b.paidCents),
              refundedCents: Number(b.refundedCents),
              creditedCents: Number(b.creditedCents),
            })
          : inv.totalCents,
  };
}

export async function getInvoiceSummary(
  invoiceId: string,
): Promise<InvoiceSummary | null> {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  return inv ? summarize(inv) : null;
}

export async function getInvoiceForJob(
  jobId: string,
): Promise<InvoiceSummary | null> {
  const inv = await latestInvoice(db, jobId);
  return inv ? summarize(inv) : null;
}

/**
 * Recompute the status cache from the balance (invoice_balances view, read in the
 * caller's tx); emits invoice.paid on the transition to paid. Idempotent. Called
 * by B4 after every payment, refund and dispute change, and by B3 after credits.
 */
export async function syncInvoicePaymentState(
  tx: Tx,
  invoiceId: string,
  actor: Actor,
): Promise<{ status: InvoiceStatus; balanceCents: number }> {
  const inv = await loadInvoice(tx, invoiceId);
  const [b] = await tx
    .select()
    .from(invoiceBalances)
    .where(eq(invoiceBalances.invoiceId, invoiceId))
    .limit(1);
  const paid = Number(b?.paidCents ?? 0) - Number(b?.refundedCents ?? 0);
  const balance = b
    ? balanceOf({
        totalCents: Number(b.totalCents),
        paidCents: Number(b.paidCents),
        refundedCents: Number(b.refundedCents),
        creditedCents: Number(b.creditedCents),
      })
    : inv.totalCents;
  const next = nextInvoiceStatus(inv.status as InvoiceStatus, balance, paid);
  if (next !== inv.status) {
    await tx
      .update(invoices)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    const entity = { type: "invoice", id: invoiceId } as const;
    if (next === "paid") {
      await emit(
        tx,
        "invoice.paid",
        entity,
        { invoice_id: invoiceId },
        { actor },
      );
      await writeActivity(tx, {
        entity,
        customerId: inv.customerId,
        jobId: inv.jobId,
        kind: "invoice.paid",
        summary: `Invoice ${inv.number} paid in full`,
        actorUserId: actor.userId,
      });
    } else {
      await writeActivity(tx, {
        entity,
        customerId: inv.customerId,
        jobId: inv.jobId,
        kind: "invoice.status_changed",
        summary: `Invoice ${inv.number}: ${next.replace("_", " ")} · balance ${formatMoney(balance)}`,
        data: { from: inv.status, to: next, balance_cents: balance },
        actorUserId: actor.userId,
      });
    }
  }
  return { status: next, balanceCents: inv.status === "void" ? 0 : balance };
}

/**
 * Post a credit note on an issued invoice (M08: reductions after payment). Credits
 * never exceed the invoice total. Writes the audit row (unless the caller's action()
 * already audits) and the 'credit_note.created' activity. It does NOT sync the
 * status cache: callers run syncInvoicePaymentState afterwards (B4's partial-refund
 * credit runs it once after the refund; the addCreditNote action right away).
 */
export async function createCreditNote(
  tx: Tx,
  i: {
    invoiceId: string;
    amountCents: number;
    reason: string;
    /** Extra activity data, e.g. { refund_id }. */
    data?: Record<string, unknown>;
    /** Appended to the activity summary, e.g. "(partial refund)". */
    note?: string;
  },
  actor: Actor,
  opts: { audit?: boolean } = {},
): Promise<{ id: string; number: string }> {
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0)
    throw new ValidationError({ amountCents: ["Enter an amount."] });
  const inv = await loadInvoice(tx, i.invoiceId);
  if (!["issued", "partially_paid", "paid"].includes(inv.status))
    throw new ConflictError(
      "not_issued",
      "Credit notes apply to issued invoices.",
    );
  const [cred] = await tx
    .select({
      c: sql<number>`coalesce(sum(${creditNotes.amountCents}),0)::bigint`,
    })
    .from(creditNotes)
    .where(eq(creditNotes.invoiceId, inv.id));
  if (Number(cred?.c ?? 0) + i.amountCents > inv.totalCents)
    throw new ConflictError(
      "credit_exceeds_total",
      `Credits can't exceed the invoice total (${formatMoney(inv.totalCents)}).`,
    );
  const number = await nextNumber(tx, "credit_note");
  const [cn] = await tx
    .insert(creditNotes)
    .values({
      number,
      invoiceId: inv.id,
      amountCents: i.amountCents,
      reason: i.reason,
      createdBy: actor.userId,
    })
    .returning({ id: creditNotes.id });
  if (!cn) throw new Error("credit note insert failed");
  if (opts.audit !== false)
    await writeAudit(tx, {
      actor,
      action: "credit_note.created",
      entity: { type: "invoice", id: inv.id },
      after: {
        credit_note_id: cn.id,
        number,
        amount_cents: i.amountCents,
        reason: i.reason,
      },
      full: true,
    });
  await writeActivity(tx, {
    entity: { type: "invoice", id: inv.id },
    customerId: inv.customerId,
    jobId: inv.jobId,
    kind: "credit_note.created",
    summary:
      `Credit ${number} ${formatMoney(i.amountCents)} on ${inv.number}${i.note ? ` ${i.note}` : ""}`.slice(
        0,
        200,
      ),
    data: { credit_note_id: cn.id, reason: i.reason, ...i.data },
    actorUserId: actor.userId,
  });
  return { id: cn.id, number };
}

/**
 * Row scope: invoices.view (read) / invoices.create (write); techs without
 * jobs.view_all only for jobs they're assigned to. Throws Forbidden/NotFound.
 */
export async function assertInvoiceAccess(
  user: SessionUser,
  invoiceId: string,
  mode: "read" | "write",
): Promise<InvoiceSummary> {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new NotFoundError("Invoice");
  const need = mode === "read" ? "invoices.view" : "invoices.create";
  if (!user.perms.has(need)) throw new ForbiddenError(undefined, need);
  if (!user.perms.has("jobs.view_all")) {
    const assigned = inv.jobId
      ? await db
          .select({ u: jobAssignments.userId })
          .from(jobAssignments)
          .where(
            and(
              eq(jobAssignments.jobId, inv.jobId),
              eq(jobAssignments.userId, user.id),
            ),
          )
          .limit(1)
      : [];
    if (assigned.length === 0) throw new ForbiddenError();
  }
  return summarize(inv);
}

/** Open (issued / partially paid) invoices count for a status list. */
export const OPEN_INVOICE_STATUSES = OPEN;

/**
 * SQL fragment: invoice is open and past due. `cutoff` = math.ts overdueCutoff(now, tz)
 * (local midnight today): overdue only from the day after the due date (QA2).
 */
export const overdueSql = (cutoff: Date) =>
  sql`${invoices.status} in ('issued','partially_paid') and ${invoices.dueAt} < ${cutoff}`;
