"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  invoiceBalances,
  invoiceRevisions,
  invoices,
  lineItems,
  payments,
} from "@/db/schema";
import { contactRevealedFor } from "@/features/customers/api";
import { assertJobAccess } from "@/features/jobs/api";
import { invoicePickableIds, lockEvidenceMedia } from "@/features/media/api";
import { enqueueMessage, queuedOutcome } from "@/features/messaging/api";
import { action, zf } from "@/lib/action";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { sha256Json } from "@/lib/hash";
import { newId } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone } from "@/lib/settings";
import {
  mintOrReusePublicToken,
  mintPublicToken,
  TOKEN_TTL,
} from "@/lib/tokens";
import {
  assertInvoiceAccess,
  createCreditNote,
  emitLinesChanged,
  getOrCreateDraftInvoice,
  insertLines,
  invoiceLines,
  issueDraftInvoice,
  lineValues,
  recomputeInvoice,
  snapshotInvoice,
  syncInvoicePaymentState,
} from "./api";
import {
  assertDiscountAllowed,
  LineSchema,
  mathLines,
  toLineInput,
} from "./lines";
import { diffSnapshots, isEmptyDiff, summarizeDiff } from "./snapshot";

// Invoice mutations (SPEC M08). Every action: perm + zod + row scope
// (assertInvoiceAccess) + one transaction with audit/activity/events.

const paths = (invoiceId: string, jobId?: string | null) => [
  `/invoices/${invoiceId}`,
  "/invoices",
  ...(jobId ? [`/jobs/${jobId}`, "/today"] : []),
];

async function draftOrThrow(tx: Tx, invoiceId: string) {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.status !== "draft")
    throw new ConflictError(
      "invoice_issued",
      "This invoice is issued. Use Revise to change it.",
    );
  return inv;
}

// ------------------------------------------------------------------ drafts

/** Open (or create) the job's invoice. */
export const createInvoiceForJob = action({
  perm: "invoices.create",
  input: z.object({ jobId: z.uuid() }),
  audit: "invoice.created",
  async run({ input, user, tx, actor }) {
    await assertJobAccess(user, input.jobId, "read");
    return getOrCreateDraftInvoice(tx, input.jobId, actor);
  },
  auditEntity: ({ data }) => ({ type: "invoice", id: data.invoiceId }),
  revalidate: ({ input, data }) => paths(data.invoiceId, input.jobId),
});

/** Add or edit one line on a DRAFT invoice. */
export const saveInvoiceLine = action({
  perm: "invoices.create",
  input: z.object({ invoiceId: z.uuid(), line: LineSchema }),
  audit: "invoice.line_saved",
  async run({ input, user, tx, actor, activity }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const inv = await draftOrThrow(tx, input.invoiceId);
    const existing = await invoiceLines(tx, inv.id);
    const values = lineValues(toLineInput(input.line));
    const next = input.line.id
      ? existing.map((l) => (l.id === input.line.id ? { ...l, ...values } : l))
      : [...existing, { ...values, isOptional: false, isSelected: true }];
    await assertDiscountAllowed(user, mathLines(next));
    let lineId = input.line.id ?? null;
    if (input.line.id) {
      if (!existing.some((l) => l.id === input.line.id))
        throw new NotFoundError("Line");
      await tx
        .update(lineItems)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(lineItems.id, input.line.id));
    } else {
      const [id] = await insertLines(tx, "invoice", inv.id, [
        toLineInput(input.line),
      ]);
      lineId = id ?? null;
    }
    await recomputeInvoice(tx, inv.id);
    await activity({
      entity: { type: "invoice", id: inv.id },
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: input.line.id ? "invoice.line_updated" : "invoice.line_added",
      summary:
        `${input.line.id ? "Line updated" : "Line added"}: ${input.line.name}`.slice(
          0,
          200,
        ),
      data: { line_item_id: lineId },
    });
    await emitLinesChanged(tx, inv.id, inv.jobId, actor);
    return { invoiceId: inv.id, lineId, jobId: inv.jobId };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

export const deleteInvoiceLine = action({
  perm: "invoices.create",
  input: z.object({ invoiceId: z.uuid(), lineId: z.uuid() }),
  audit: "invoice.line_removed",
  async run({ input, user, tx, actor, activity }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const inv = await draftOrThrow(tx, input.invoiceId);
    const [l] = await tx
      .delete(lineItems)
      .where(
        and(
          eq(lineItems.id, input.lineId),
          eq(lineItems.parentType, "invoice"),
          eq(lineItems.parentId, inv.id),
        ),
      )
      .returning({ name: lineItems.name });
    if (!l) throw new NotFoundError("Line");
    await recomputeInvoice(tx, inv.id);
    await activity({
      entity: { type: "invoice", id: inv.id },
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: "invoice.line_removed",
      summary: `Line removed: ${l.name}`.slice(0, 200),
    });
    await emitLinesChanged(tx, inv.id, inv.jobId, actor);
    return { invoiceId: inv.id, jobId: inv.jobId };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

/** Notes, terms text and warranty on a DRAFT. */
export const updateInvoiceInfo = action({
  perm: "invoices.create",
  input: z.object({
    invoiceId: z.uuid(),
    notes: z.string().trim().max(4000).nullable(),
    warrantyText: z.string().trim().max(2000).nullable(),
  }),
  audit: "invoice.info_updated",
  async run({ input, user, tx }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const inv = await draftOrThrow(tx, input.invoiceId);
    await tx
      .update(invoices)
      .set({
        notes: input.notes || null,
        warrantyText: input.warrantyText || null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));
    return { invoiceId: inv.id, jobId: inv.jobId };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

/**
 * Photos on the invoice (presentation, not part of the signed snapshot): an ordered
 * selection of the job's photos. Picking is what shows them (Quote to Paid I5): an
 * empty pick means no photos (show_photos off), never a silent fallback. Only live
 * photos of this invoice's job with an invoice tag are kept (no "goal" photos, no
 * other jobs' media). On an issued invoice, newly picked photos are evidence-locked.
 */
export const setInvoicePhotos = action({
  perm: "invoices.create",
  input: z.object({
    invoiceId: z.uuid(),
    showPhotos: zf.checkbox(),
    photoMediaIds: zf.array(z.uuid()).pipe(z.array(z.uuid()).max(8)),
  }),
  audit: "invoice.photos_updated",
  async run({ input, user, tx }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "void") throw new ConflictError("invoice_void");
    const ids = inv.jobId
      ? await invoicePickableIds(tx, inv.jobId, input.photoMediaIds)
      : [];
    await tx
      .update(invoices)
      .set({
        showPhotos: input.showPhotos && ids.length > 0,
        photoMediaIds: ids,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));
    if (inv.status !== "draft" && ids.length) await lockEvidenceMedia(tx, ids);
    return { invoiceId: inv.id, jobId: inv.jobId, photoMediaIds: ids };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

// ------------------------------------------------------------------ lifecycle

export const issueInvoice = action({
  perm: "invoices.create",
  input: z.object({ invoiceId: z.uuid() }),
  audit: "invoice.issued",
  async run({ input, user, tx, actor }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const inv = await draftOrThrow(tx, input.invoiceId);
    // issueDraftInvoice refuses an empty invoice (EMPTY_INVOICE_MESSAGE).
    const res = await issueDraftInvoice(tx, inv.id, "manual", actor);
    return { ...res, jobId: inv.jobId };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

/**
 * Revise an issued invoice (M08): same number, version + 1, the full new snapshot +
 * sha256 + a diff against the previous version and a reason, all append-only in
 * invoice_revisions. Revising after a payment needs invoices.revise (as every
 * revision does) and is flagged for the anomaly report (diff.afterPayment).
 */
export const reviseInvoice = action({
  perm: "invoices.revise",
  input: z.object({
    invoiceId: z.uuid(),
    reason: z
      .string()
      .trim()
      .min(3, "Give a reason for the revision.")
      .max(500),
    lines: z.array(LineSchema).max(200),
    notes: z.string().trim().max(4000).nullable().optional(),
    warrantyText: z.string().trim().max(2000).nullable().optional(),
  }),
  audit: "invoice.revised",
  async run({ input, user, tx, actor, emit, activity }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!inv) throw new NotFoundError("Invoice");
    if (!["issued", "partially_paid", "paid"].includes(inv.status))
      throw new ConflictError(
        "not_revisable",
        inv.status === "draft"
          ? "Drafts can be edited directly."
          : "Void or written-off invoices can't be revised.",
      );
    const before = await snapshotInvoice(tx, inv.id);
    // Make sure the version being replaced is on record (seeded/legacy invoices).
    const [hasCurrent] = await tx
      .select({ v: invoiceRevisions.version })
      .from(invoiceRevisions)
      .where(
        and(
          eq(invoiceRevisions.invoiceId, inv.id),
          eq(invoiceRevisions.version, inv.version),
        ),
      )
      .limit(1);
    if (!hasCurrent)
      await tx.insert(invoiceRevisions).values({
        invoiceId: inv.id,
        version: inv.version,
        snapshot: before as never,
        sha256: sha256Json(before),
        reason: "baseline",
        createdBy: user.id,
      });
    const existing = await invoiceLines(tx, inv.id);
    const byId = new Map(existing.map((l) => [l.id, l]));
    const keep = new Set<string>();
    const merged = input.lines.map((l) => {
      if (l.id && byId.has(l.id)) keep.add(l.id);
      return lineValues(toLineInput(l));
    });
    await assertDiscountAllowed(user, mathLines(merged));
    const removed = existing.filter((l) => !keep.has(l.id)).map((l) => l.id);
    if (removed.length)
      await tx.delete(lineItems).where(inArray(lineItems.id, removed));
    let sort = 0;
    for (const l of input.lines) {
      const values = { ...lineValues(toLineInput(l)), sort: sort++ };
      if (l.id && byId.has(l.id))
        await tx
          .update(lineItems)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(lineItems.id, l.id));
      else
        await tx
          .insert(lineItems)
          .values({ ...values, parentType: "invoice", parentId: inv.id });
    }
    const version = inv.version + 1;
    await tx
      .update(invoices)
      .set({
        version,
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.warrantyText !== undefined
          ? { warrantyText: input.warrantyText || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));
    await recomputeInvoice(tx, inv.id);
    const after = await snapshotInvoice(tx, inv.id);
    const diff = diffSnapshots(before, after);
    if (isEmptyDiff(diff))
      throw new ConflictError(
        "no_changes",
        "Nothing changed — no revision needed.",
      );
    const [paidRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(payments)
      .where(
        and(
          eq(payments.invoiceId, inv.id),
          inArray(payments.status, [
            "succeeded",
            "partially_refunded",
            "refunded",
            "disputed",
          ]),
        ),
      );
    const afterPayment = Number(paidRow?.n ?? 0) > 0;
    const sha = sha256Json(after);
    await tx.insert(invoiceRevisions).values({
      invoiceId: inv.id,
      version,
      snapshot: after as never,
      sha256: sha,
      diff: { ...diff, afterPayment } as never,
      reason: input.reason,
      createdBy: user.id,
    });
    const entity = { type: "invoice", id: inv.id } as const;
    await emit("invoice.revised", entity, {
      invoice_id: inv.id,
      version,
      reason: input.reason,
    });
    await activity({
      entity,
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: "invoice.revised",
      summary:
        `Invoice ${inv.number} revised to v${version}${afterPayment ? " after payment" : ""}: ${summarizeDiff(diff, (c) => formatMoney(c))}`.slice(
          0,
          480,
        ),
      data: { version, sha256: sha, after_payment: afterPayment },
    });
    const sync = await syncInvoicePaymentState(tx, inv.id, actor);
    return {
      invoiceId: inv.id,
      jobId: inv.jobId,
      version,
      balanceCents: sync.balanceCents,
      afterPayment,
    };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

async function netPaid(tx: Tx, invoiceId: string): Promise<number> {
  const [b] = await tx
    .select()
    .from(invoiceBalances)
    .where(eq(invoiceBalances.invoiceId, invoiceId))
    .limit(1);
  return Number(b?.paidCents ?? 0) - Number(b?.refundedCents ?? 0);
}

export const voidInvoice = action({
  perm: "invoices.void",
  input: z.object({
    invoiceId: z.uuid(),
    reason: z.string().trim().min(3, "Give a reason.").max(500),
  }),
  audit: "invoice.voided",
  async run({ input, user, tx, emit, activity }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "void") return { invoiceId: inv.id, jobId: inv.jobId };
    if ((await netPaid(tx, inv.id)) > 0)
      throw new ConflictError(
        "has_payments",
        "This invoice has payments. Refund them first, or issue a credit note instead.",
      );
    const now = new Date();
    await tx
      .update(invoices)
      .set({
        status: "void",
        voidedAt: now,
        voidReason: input.reason,
        updatedAt: now,
      })
      .where(eq(invoices.id, inv.id));
    const entity = { type: "invoice", id: inv.id } as const;
    await emit("invoice.voided", entity, {
      invoice_id: inv.id,
      reason: input.reason,
    });
    await activity({
      entity,
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: "invoice.voided",
      summary: `Invoice ${inv.number} voided`,
      data: { reason: input.reason },
    });
    return { invoiceId: inv.id, jobId: inv.jobId };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

export const markUncollectible = action({
  perm: "invoices.void",
  input: z.object({
    invoiceId: z.uuid(),
    reason: z.string().trim().min(3, "Give a reason.").max(500),
  }),
  audit: "invoice.uncollectible",
  async run({ input, user, tx, activity }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!inv) throw new NotFoundError("Invoice");
    if (!["issued", "partially_paid"].includes(inv.status))
      throw new ConflictError(
        "not_open",
        "Only open invoices can be written off.",
      );
    await tx
      .update(invoices)
      .set({
        status: "uncollectible",
        voidReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));
    await activity({
      entity: { type: "invoice", id: inv.id },
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: "invoice.uncollectible",
      summary: `Invoice ${inv.number} written off`,
      data: { reason: input.reason },
    });
    return { invoiceId: inv.id, jobId: inv.jobId };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

/** Credit note (M08: reductions after payment). Lowers the balance; can go negative (refund due). */
export const addCreditNote = action({
  perm: "invoices.revise",
  input: z.object({
    invoiceId: z.uuid(),
    amountCents: z.coerce.number().int().positive("Enter an amount."),
    reason: z.string().trim().min(3, "Give a reason.").max(300),
  }),
  audit: "credit_note.created",
  async run({ input, user, tx, actor }) {
    const inv = await assertInvoiceAccess(user, input.invoiceId, "write");
    // action() writes the audit row (cfg.audit); the API writes the activity.
    const { number } = await createCreditNote(
      tx,
      {
        invoiceId: input.invoiceId,
        amountCents: input.amountCents,
        reason: input.reason,
      },
      actor,
      { audit: false },
    );
    const sync = await syncInvoicePaymentState(tx, input.invoiceId, actor);
    return {
      invoiceId: inv.id,
      jobId: inv.jobId,
      number,
      balanceCents: sync.balanceCents,
    };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => paths(data.invoiceId, data.jobId),
});

// ------------------------------------------------------------------ links & sending

async function mintInvoiceLink(
  tx: Tx,
  inv: { id: string; customerId: string; jobId: string | null },
) {
  return mintPublicToken(tx, {
    kind: "invoice",
    entity: { type: "invoice", id: inv.id },
    customerId: inv.customerId,
    jobId: inv.jobId,
    expiresAt: new Date(Date.now() + TOKEN_TTL.invoice),
  });
}

/**
 * A DRAFT being sent or shared is issued first (Quote to Paid: Send on a draft, like
 * "Get paid", has no separate "Issue?" step). `via: "send"`: the person is sending it
 * right now, so the built-in `invoice_sent` automation doesn't text it a second time.
 */
async function issueForSend(
  tx: Tx,
  inv: typeof invoices.$inferSelect,
  user: Parameters<typeof assertInvoiceAccess>[0],
  actor: Parameters<typeof issueDraftInvoice>[3],
): Promise<typeof invoices.$inferSelect> {
  if (inv.status !== "draft") return inv;
  if (!user.perms.has("invoices.create"))
    throw new ConflictError(
      "invoice_draft",
      "Issue the invoice before sharing it.",
    );
  await assertInvoiceAccess(user, inv.id, "write");
  await issueDraftInvoice(tx, inv.id, "send", actor);
  const [fresh] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, inv.id))
    .limit(1);
  if (!fresh) throw new NotFoundError("Invoice");
  return fresh;
}

/**
 * Mint a customer link (/i/…, optionally a payment's receipt) to copy or share. A
 * draft is issued first when `issueDraft` is set (the send sheet's "Share or copy
 * link" says so); otherwise drafts are refused.
 */
export const getInvoiceLink = action({
  perm: "invoices.view",
  input: z.object({
    invoiceId: z.uuid(),
    receiptPaymentId: z.uuid().optional(),
    issueDraft: z.boolean().optional(),
  }),
  audit: "invoice.link_created",
  async run({ input, user, tx, actor }) {
    await assertInvoiceAccess(user, input.invoiceId, "read");
    const [row] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!row) throw new NotFoundError("Invoice");
    if (row.status === "draft" && !input.issueDraft)
      throw new ConflictError(
        "invoice_draft",
        "Issue the invoice before sharing it.",
      );
    const inv = await issueForSend(tx, row, user, actor);
    const { url } = await mintInvoiceLink(tx, inv);
    return {
      url: input.receiptPaymentId
        ? `${url}?receipt=${input.receiptPaymentId}`
        : url,
      issued: row.status === "draft",
      jobId: inv.jobId,
    };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ input, data }) =>
    data.issued ? paths(input.invoiceId, data.jobId) : [],
});

/** How long a preview link lives (reused per half: 12–24 h left). */
const PREVIEW_TTL_MS = 86_400_000;

/**
 * "Preview" (Quote to Paid I6): the customer's own /i page, opened by staff with
 * `?preview=1` (no access-log row, no "viewed", Pay off, drafts allowed). The link
 * is reused per invoice for a while (mintOrReusePublicToken), short-lived, and never
 * sent to anyone.
 */
export const previewInvoice = action({
  perm: "invoices.view",
  input: z.object({ invoiceId: z.uuid() }),
  async run({ input, user, tx }) {
    await assertInvoiceAccess(user, input.invoiceId, "read");
    const [inv] = await tx
      .select({
        id: invoices.id,
        customerId: invoices.customerId,
        jobId: invoices.jobId,
        status: invoices.status,
      })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "void")
      throw new ConflictError("invoice_void", "This invoice was voided.");
    const link = await mintOrReusePublicToken(tx, {
      kind: "invoice",
      entity: { type: "invoice", id: inv.id },
      customerId: inv.customerId,
      jobId: inv.jobId,
      purpose: "invoice.preview",
      ttlMs: PREVIEW_TTL_MS,
    });
    return { href: `${new URL(link.url).pathname}?preview=1` };
  },
});

/**
 * Send / resend (template `invoice.sent`, via B5 enqueueMessage: consent, quiet hours,
 * caps). A draft is issued first (`via: "send"`). The text card goes to the sender's
 * own outbox (like the composer) when they may see the customer's number, and the
 * result says what happened: status, channel, where, why not, when (Quote to Paid I4).
 */
export const sendInvoice = action({
  perm: "invoices.create",
  input: z.object({
    invoiceId: z.uuid(),
    channel: z.enum(["customer_preferred", "sms", "email"]),
    clientId: z.uuid().optional(),
  }),
  audit: "invoice.sent",
  async run({ input, user, tx, actor, activity }) {
    await assertInvoiceAccess(user, input.invoiceId, "write");
    const [row] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);
    if (!row) throw new NotFoundError("Invoice");
    if (row.status === "void") throw new ConflictError("invoice_void");
    const inv = await issueForSend(tx, row, user, actor);
    const { url } = await mintInvoiceLink(tx, inv);
    const [b] = await tx
      .select()
      .from(invoiceBalances)
      .where(eq(invoiceBalances.invoiceId, inv.id))
      .limit(1);
    const balance =
      inv.totalCents -
      Number(b?.paidCents ?? 0) +
      Number(b?.refundedCents ?? 0) -
      Number(b?.creditedCents ?? 0);
    const { revealed } = await contactRevealedFor(user, inv.customerId);
    const res = await enqueueMessage(
      tx,
      {
        templateKey: "invoice.sent",
        channel: input.channel,
        purpose: "transactional",
        audience: { type: "customer", customerId: inv.customerId },
        entity: { type: "invoice", id: inv.id },
        jobId: inv.jobId,
        vars: {
          "invoice.link": url,
          "invoice.number": inv.number,
          "invoice.total": formatMoney(inv.totalCents),
          "invoice.balance": formatMoney(balance),
          link: url,
        },
        dedupeKey: `manual:${input.clientId ?? newId()}`,
        // Outside the contact window the number stays hidden: the office sends it.
        outboxAssigneeUserId: revealed ? user.id : null,
      },
      actor,
    );
    const outcome = await queuedOutcome(
      tx,
      res.scheduledMessageId,
      res.status,
      { userId: user.id, revealed, timeZone: await getCompanyTimezone() },
    );
    await activity({
      entity: { type: "invoice", id: inv.id },
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: "invoice.sent",
      summary: `Invoice ${inv.number} sent (${input.channel.replace("_", " ")})`,
      data: {
        scheduled_message_id: res.scheduledMessageId,
        status: res.status,
      },
    });
    return {
      invoiceId: inv.id,
      jobId: inv.jobId,
      status: res.status,
      url,
      issued: row.status === "draft",
      outcome,
    };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ data }) => [
    ...paths(data.invoiceId, data.jobId),
    "/messages/outbox",
  ],
});
