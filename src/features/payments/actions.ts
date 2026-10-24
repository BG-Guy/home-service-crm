"use server";

import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import {
  getPaymentProvider,
  processorReady,
  providerErrorMessage,
} from "@/adapters/payments";
import { db, type Tx } from "@/db";
import {
  customers,
  depositRequests,
  depositRules,
  estimates,
  invoices,
  jobs,
  payments,
  refunds,
  scheduledMessages,
} from "@/db/schema";
import { contactRevealedFor } from "@/features/customers/api";
import {
  assertInvoiceAccess,
  issueDraftInvoice,
} from "@/features/invoices/api";
import { paymentMethodLabel } from "@/features/invoices/doc";
import { assertJobAccess } from "@/features/jobs/api";
import { enqueueMessage, queuedOutcome } from "@/features/messaging/api";
import { closeTasksFor } from "@/features/tasks/api";
import { action, actionFailure } from "@/lib/action";
import { requireUser } from "@/lib/auth/current";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { maskEmail, maskPhone } from "@/lib/mask";
import { formatMoney } from "@/lib/money";
import { publishPolicyVersion } from "@/lib/policies";
import {
  getCompanyTimezone,
  getSettings,
  updateSettings,
} from "@/lib/settings";
import { formatInTz } from "@/lib/time";
import { mintOrReusePublicToken, mintPublicToken } from "@/lib/tokens";
import type { ActionResult, Actor, SessionUser } from "@/lib/types";
import { getPaymentReceiptData, recordPayment } from "./api";
import type { CollectContext, ReceiptAutoSend, ReceiptView } from "./contracts";
import { effectiveSurchargeBps } from "./engine/fees";
import {
  companyState,
  DEPOSIT_JOB_STATUSES,
  methodLabel,
  PAID_STATUSES,
} from "./internal";
import { finalizeRefundSucceeded } from "./provider-events";
import { getCollectContext } from "./queries";

// Payments mutations (SPEC M09). Every write goes through action(): perm → flag → zod →
// clientId idempotency → one transaction (write + events + audit + activity).
// Provider calls (refunds) happen OUTSIDE transactions (PGlite has one connection).

const uuid = z.string().uuid();
// "" (an empty form field) means none.
const optUuid = z.preprocess((v) => (v === "" ? null : v), uuid.nullish());

/**
 * "Get paid" on a DRAFT invoice issues it first, in the same transaction (Quote to
 * Paid I2): no separate "Issue?" confirm, and `via: "collect"` keeps the built-in
 * `invoice_sent` automation from texting the invoice too. Needs invoices.create and
 * write access to the invoice; a no-op once it's issued. Returns whether it issued.
 */
async function issueForCollect(
  tx: Tx,
  user: SessionUser,
  actor: Actor,
  invoiceId: string,
): Promise<boolean> {
  const [cur] = await tx
    .select({ status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (cur?.status !== "draft") return false;
  if (!user.perms.has("invoices.create"))
    throw new ForbiddenError(
      "Issuing the invoice needs permission to create invoices. Ask the office to issue it first.",
      "invoices.create",
    );
  await assertInvoiceAccess(user, invoiceId, "write");
  await issueDraftInvoice(tx, invoiceId, "collect", actor);
  return true;
}

function jobPaths(jobId: string | null | undefined, extra: string[] = []) {
  return [
    ...(jobId ? [`/jobs/${jobId}`, `/jobs/${jobId}/evidence`] : []),
    "/today",
    "/payments",
    ...extra,
  ];
}

// ------------------------------------------------------------------ collect

/** Sheet context loader (read) for the client sheet. */
export async function loadCollectContext(input: {
  jobId?: string | null;
  invoiceId?: string | null;
  allowDeposit?: boolean;
}): Promise<ActionResult<CollectContext>> {
  try {
    const user = await requireUser();
    if (
      !user.perms.has("payments.record_manual") &&
      !user.perms.has("payments.collect")
    )
      throw new ForbiddenError();
    const ctx = await getCollectContext(user, {
      jobId: input.jobId ? uuid.parse(input.jobId) : null,
      invoiceId: input.invoiceId ? uuid.parse(input.invoiceId) : null,
      allowDeposit: input.allowDeposit,
    });
    return { ok: true, data: ctx };
  } catch (e) {
    return actionFailure(e);
  }
}

/** S20: the customer's open invoices (balance > 0) to pick from. */
export async function loadOpenInvoices(input: { customerId: string }): Promise<
  ActionResult<
    {
      id: string;
      number: string;
      jobId: string | null;
      totalCents: number;
      balanceCents: number;
    }[]
  >
> {
  try {
    const user = await requireUser("payments.record_manual");
    const customerId = uuid.parse(input.customerId);
    const { assertCustomerAccess } = await import("@/features/customers/api");
    await assertCustomerAccess(user, customerId, "read");
    const { getCustomerPayments } = await import("./queries");
    const r = await getCustomerPayments(customerId);
    return { ok: true, data: r.openInvoices };
  } catch (e) {
    return actionFailure(e);
  }
}

const RecordSchema = z.object({
  jobId: optUuid,
  invoiceId: optUuid,
  depositRequestId: optUuid,
  customerId: optUuid,
  kind: z.enum(["deposit", "payment", "tip_only"]).default("payment"),
  method: z.enum(["cash", "check", "zelle", "venmo", "ach", "other"]),
  amountCents: z.coerce.number().int().min(0).max(100_000_000),
  tipCents: z.coerce.number().int().min(0).max(10_000_000).default(0),
  reference: z.string().trim().max(120).nullish(),
  payerName: z.string().trim().max(120).nullish(),
  proofMediaId: optUuid,
  proofClientId: optUuid,
  collectedByUserId: optUuid,
  /** A draft invoice is issued first ("Get paid" on a draft, Quote to Paid I2). */
  issueDraft: z.boolean().optional(),
  clientId: uuid,
  clientTs: z.string().datetime({ offset: true }).nullish(),
});

/** Record a cash/check/Zelle/Venmo/ACH payment (offline-capable via `payments.recordManual`). */
export const recordManualPayment = action({
  name: "payments.recordManual",
  perm: "payments.record_manual",
  input: RecordSchema,
  audit: "payment.recorded",
  async run({ input, user, tx, actor }) {
    // Every id in the input must be in the viewer's scope AND belong together
    // (invoice ↔ job ↔ deposit ↔ customer), so a tech can't pair their own job
    // with someone else's invoice, deposit or customer (T5-02).
    let customerId = input.customerId ?? null;
    let jobId = input.jobId ?? null;
    let scoped = false;
    if (input.invoiceId) {
      const inv = await assertInvoiceAccess(user, input.invoiceId, "read");
      if (jobId && inv.jobId !== jobId) throw new ForbiddenError();
      if (customerId && inv.customerId !== customerId)
        throw new ForbiddenError();
      customerId = inv.customerId;
      jobId = jobId ?? inv.jobId;
      scoped = true;
    }
    if (input.depositRequestId) {
      const [d] = await tx
        .select({
          jobId: depositRequests.jobId,
          estimateId: depositRequests.estimateId,
        })
        .from(depositRequests)
        .where(eq(depositRequests.id, input.depositRequestId))
        .limit(1);
      if (!d) throw new NotFoundError("Deposit");
      if (d.jobId) {
        if (jobId && d.jobId !== jobId) throw new ForbiddenError();
        jobId = d.jobId;
      } else {
        // An estimate deposit (no job yet): bind it to the estimate's customer/job.
        const [e] = d.estimateId
          ? await tx
              .select({
                customerId: estimates.customerId,
                jobId: estimates.jobId,
              })
              .from(estimates)
              .where(eq(estimates.id, d.estimateId))
              .limit(1)
          : [];
        if (!e) throw new NotFoundError("Deposit");
        if (jobId && e.jobId !== jobId) throw new ForbiddenError();
        if (customerId && e.customerId !== customerId)
          throw new ForbiddenError();
        customerId = e.customerId;
      }
    }
    let band: string | null = null;
    if (jobId) {
      const job = await assertJobAccess(user, jobId, "read");
      if (customerId && job.customerId !== customerId)
        throw new ForbiddenError();
      customerId = job.customerId;
      band = job.riskBand;
      scoped = true;
    }
    if (!customerId) throw new NotFoundError("Customer");
    if (!scoped) {
      // Customer-only payment (account credit / AR): the customer must be visible.
      const { assertCustomerAccess } = await import("@/features/customers/api");
      await assertCustomerAccess(user, customerId, "read");
    }
    const s = await getSettings();
    if (
      band === "critical" &&
      s.risk.critical_control === "cash_only" &&
      s.risk.enforce_controls &&
      input.method === "venmo"
    )
      throw new ConflictError(
        "cash_only",
        "Critical-risk job: cash, check, Zelle or ACH only.",
      );
    // Techs record only what they collected themselves. Office staff hold cash they
    // take at the counter; a check recorded by the office (mailed in, AR) has no
    // field collector, so the receipt doesn't say "paid to <office user>" (T2-20).
    const collectedBy =
      user.baseRole === "tech"
        ? user.id
        : (input.collectedByUserId ??
          (input.method === "cash" ? user.id : null));
    // "Get paid" on a draft: issue it in this same transaction, so the payment never
    // lands on an editable invoice. Offline replays carry the flag and the clientId.
    const issued =
      input.issueDraft && input.invoiceId && input.kind !== "deposit"
        ? await issueForCollect(tx, user, actor, input.invoiceId)
        : false;
    const r = await recordPayment(
      tx,
      {
        customerId,
        invoiceId: input.invoiceId ?? null,
        jobId,
        depositRequestId: input.depositRequestId ?? null,
        kind: input.kind,
        method: input.method,
        amountCents: input.amountCents,
        tipCents: input.tipCents,
        reference: input.reference ?? null,
        payerName: input.payerName ?? null,
        proofMediaId: input.proofMediaId ?? null,
        proofClientId: input.proofClientId ?? null,
        collectedByUserId: collectedBy,
        clientId: input.clientId,
        clientTs: input.clientTs ? new Date(input.clientTs) : null,
      },
      actor,
    );
    return {
      ...r,
      jobId,
      customerId,
      invoiceId: input.invoiceId ?? null,
      issued,
    };
  },
  auditEntity: ({ data }) => ({ type: "payment", id: data.paymentId }),
  revalidate: ({ data }) =>
    jobPaths(data.jobId, [
      `/customers/${data.customerId}`,
      ...(data.invoiceId ? [`/invoices/${data.invoiceId}`] : []),
    ]),
});

/** Office marks manual payments as verified in the bank (guards against fake screenshots). */
export const verifyPayments = action({
  perm: "payments.verify_manual",
  input: z.object({ paymentIds: z.array(uuid).min(1).max(200) }),
  audit: "payment.verified",
  async run({ input, tx, user, activity }) {
    const rows = await tx
      .update(payments)
      .set({
        verifiedAt: new Date(),
        verifiedBy: user.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(payments.id, input.paymentIds),
          eq(payments.provider, "manual"),
          isNull(payments.verifiedAt),
        ),
      )
      .returning({
        id: payments.id,
        jobId: payments.jobId,
        customerId: payments.customerId,
        amount: payments.amountCents,
        method: payments.method,
      });
    for (const r of rows)
      await activity({
        entity: r.jobId
          ? { type: "job", id: r.jobId }
          : { type: "customer", id: r.customerId },
        customerId: r.customerId,
        jobId: r.jobId,
        kind: "payment.verified",
        summary: `${methodLabel({ method: r.method })} ${formatMoney(r.amount)} verified in the bank`,
        data: { payment_id: r.id },
      });
    return { verified: rows.length };
  },
  revalidate: () => ["/payments"],
});

// ------------------------------------------------------------------ pay links

async function invoicePayLink(
  tx: Tx,
  invoiceId: string,
  /** "Get paid" on a draft: issue it first (Quote to Paid I2). */
  issue?: { user: SessionUser; actor: Actor },
) {
  if (issue) await issueForCollect(tx, issue.user, issue.actor, invoiceId);
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.status === "void" || inv.status === "draft")
    throw new ConflictError("invoice_not_issued", "Issue the invoice first.");
  const link = await mintPublicToken(tx, {
    kind: "pay",
    entity: { type: "invoice", id: invoiceId },
    customerId: inv.customerId,
    jobId: inv.jobId,
  });
  return { inv, link };
}

/** Mint a /p/ pay link for the invoice or an open deposit (open on this phone, copy). */
export const createPayLink = action({
  perm: "payments.collect",
  input: z
    .object({
      invoiceId: uuid.optional(),
      depositRequestId: uuid.optional(),
      /** Issue a draft invoice first ("Get paid" on a draft). */
      issueDraft: z.boolean().optional(),
      clientId: uuid.optional(),
    })
    .refine((v) => !!v.invoiceId !== !!v.depositRequestId, {
      message: "Pick an invoice or a deposit.",
    }),
  audit: "payment.link_created",
  async run({ input, tx, user, actor, activity }) {
    if (input.depositRequestId) {
      const [d] = await tx
        .select({ d: depositRequests, customerId: jobs.customerId })
        .from(depositRequests)
        .leftJoin(jobs, eq(jobs.id, depositRequests.jobId))
        .where(eq(depositRequests.id, input.depositRequestId))
        .limit(1);
      if (!d?.customerId) throw new NotFoundError("Deposit");
      if (d.d.jobId) await assertJobAccess(user, d.d.jobId, "read");
      else if (!user.perms.has("payments.view_all")) throw new ForbiddenError();
      if (!["required", "requested"].includes(d.d.status))
        throw new ConflictError(
          "deposit_closed",
          "This deposit is no longer open.",
        );
      const link = await mintPublicToken(tx, {
        kind: "pay",
        entity: { type: "deposit_request", id: d.d.id },
        customerId: d.customerId,
        jobId: d.d.jobId,
      });
      return { url: link.url, jobId: d.d.jobId };
    }
    const invoiceId = input.invoiceId as string;
    await assertInvoiceAccess(user, invoiceId, "read");
    const { inv, link } = await invoicePayLink(
      tx,
      invoiceId,
      input.issueDraft ? { user, actor } : undefined,
    );
    await activity({
      entity: { type: "invoice", id: inv.id },
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: "payment.link_created",
      summary: `Pay link created for invoice ${inv.number}`,
    });
    return { url: link.url, jobId: inv.jobId };
  },
  auditEntity: ({ input }) =>
    input.invoiceId
      ? { type: "invoice", id: input.invoiceId }
      : { type: "deposit_request", id: input.depositRequestId as string },
  revalidate: ({ input, data }) =>
    input.issueDraft && input.invoiceId
      ? jobPaths(data.jobId, [`/invoices/${input.invoiceId}`, "/invoices"])
      : [],
});

/** Text/email the pay link (template `invoice.pay_link`). */
export const sendPayLink = action({
  perm: "payments.collect",
  input: z.object({
    invoiceId: uuid,
    channel: z
      .enum(["customer_preferred", "sms", "email"])
      .default("customer_preferred"),
    /** Issue a draft invoice first ("Get paid" on a draft). */
    issueDraft: z.boolean().optional(),
    clientId: uuid.optional(),
  }),
  audit: "payment.link_sent",
  async run({ input, tx, user, actor, activity }) {
    await assertInvoiceAccess(user, input.invoiceId, "read");
    const { inv, link } = await invoicePayLink(
      tx,
      input.invoiceId,
      input.issueDraft ? { user, actor } : undefined,
    );
    const bal = await (await import("./internal")).balanceOf(tx, inv.id);
    // The text card goes to the person sending it (like the composer), when they may
    // see the customer's number; else the office outbox sends it.
    const { revealed } = await contactRevealedFor(user, inv.customerId);
    const r = await enqueueMessage(
      tx,
      {
        templateKey: "invoice.pay_link",
        channel: input.channel,
        audience: { type: "customer", customerId: inv.customerId },
        entity: { type: "invoice", id: inv.id },
        jobId: inv.jobId,
        vars: {
          pay_link: link.url,
          "invoice.pay_link": link.url,
          amount: formatMoney(bal?.balanceCents ?? inv.totalCents),
        },
        dedupeKey: `paylink:${inv.id}:${input.clientId ?? link.tokenId}`,
        outboxAssigneeUserId: revealed ? user.id : null,
      },
      actor,
    );
    const outcome = await queuedOutcome(tx, r.scheduledMessageId, r.status, {
      userId: user.id,
      revealed,
      timeZone: await getCompanyTimezone(),
    });
    await activity({
      entity: { type: "invoice", id: inv.id },
      customerId: inv.customerId,
      jobId: inv.jobId,
      kind: "payment.link_sent",
      summary: `Pay link sent for invoice ${inv.number}`,
      data: { status: r.status },
    });
    return { status: r.status, url: link.url, jobId: inv.jobId, outcome };
  },
  auditEntity: ({ input }) => ({ type: "invoice", id: input.invoiceId }),
  revalidate: ({ input, data }) =>
    jobPaths(data.jobId, [
      "/messages/outbox",
      `/invoices/${input.invoiceId}`,
      "/invoices",
    ]),
});

/** The payment if the viewer may see it (its job, its invoice, or payments.view_all). */
async function paymentFor(user: SessionUser, paymentId: string) {
  const [p] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!p) throw new NotFoundError("Payment");
  if (p.jobId) await assertJobAccess(user, p.jobId, "read");
  else if (p.invoiceId) await assertInvoiceAccess(user, p.invoiceId, "read");
  else if (!user.perms.has("payments.view_all")) throw new ForbiddenError();
  return p;
}

/**
 * Send (or re-send) a payment receipt (template `payment.receipt`): by the customer's
 * preferred channel, or Text / Email as picked on the success screen. The text card
 * goes to the sender's own outbox when they may see the number; the result says what
 * happened (Quote to Paid I3/I4).
 */
export const sendReceipt = action({
  perm: "payments.collect",
  input: z.object({
    paymentId: uuid,
    channel: z
      .enum(["customer_preferred", "sms", "email"])
      .default("customer_preferred"),
    clientId: uuid.optional(),
  }),
  audit: "payment.receipt_sent",
  async run({ input, tx, user, actor, activity }) {
    const p = await paymentFor(user, input.paymentId);
    if (!(PAID_STATUSES as readonly string[]).includes(p.status))
      throw new ConflictError(
        "not_paid",
        "Only completed payments have receipts.",
      );
    const { revealed } = await contactRevealedFor(user, p.customerId);
    const r = await enqueueMessage(
      tx,
      {
        templateKey: "payment.receipt",
        channel: input.channel,
        audience: { type: "customer", customerId: p.customerId },
        entity: { type: "payment", id: p.id },
        jobId: p.jobId,
        dedupeKey: `receipt:${p.id}:${input.clientId ?? Date.now()}`,
        outboxAssigneeUserId: revealed ? user.id : null,
      },
      actor,
    );
    const outcome = await queuedOutcome(tx, r.scheduledMessageId, r.status, {
      userId: user.id,
      revealed,
      timeZone: await getCompanyTimezone(),
    });
    await activity({
      entity: p.jobId
        ? { type: "job", id: p.jobId }
        : { type: "customer", id: p.customerId },
      customerId: p.customerId,
      jobId: p.jobId,
      kind: "payment.receipt_sent",
      summary: `Receipt sent for ${formatMoney(p.amountCents + p.tipCents)}`,
      data: { payment_id: p.id, status: r.status },
    });
    return { status: r.status, jobId: p.jobId, outcome };
  },
  auditEntity: ({ input }) => ({ type: "payment", id: input.paymentId }),
  revalidate: ({ data }) => jobPaths(data.jobId, ["/messages/outbox"]),
});

const ENTRY_LABEL: Record<string, string> = {
  tap: "Tap to pay",
  chip: "Chip",
  swipe: "Swipe",
  keyed: "Card number entered",
  online: "Online",
  wallet: "Mobile wallet",
};

/** "4:05 PM" today, else "Oct 24, 4:05 PM". */
function atLabel(d: Date, tz: string, now = new Date()): string {
  const day = (x: Date) =>
    formatInTz(x, tz, { year: "numeric", month: "numeric", day: "numeric" });
  return formatInTz(
    d,
    tz,
    day(d) === day(now)
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

/**
 * The receipt, in the app (Quote to Paid I3): the receipt sheet and the get-paid
 * success screen read it instead of opening the customer's page in a new tab.
 */
export async function loadReceipt(input: {
  paymentId: string;
}): Promise<ActionResult<ReceiptView>> {
  try {
    const user = await requireUser();
    if (
      !user.perms.has("payments.collect") &&
      !user.perms.has("payments.record_manual") &&
      !user.perms.has("payments.view_all") &&
      !user.perms.has("invoices.view")
    )
      throw new ForbiddenError();
    const p = await paymentFor(user, uuid.parse(input.paymentId));
    const [r, tz, cust, inv] = await Promise.all([
      getPaymentReceiptData(p.id),
      getCompanyTimezone(),
      db
        .select({
          name: customers.displayName,
          firstName: customers.firstName,
          phone: customers.phone,
          email: customers.email,
        })
        .from(customers)
        .where(eq(customers.id, p.customerId))
        .limit(1)
        .then((x) => x[0] ?? null),
      p.invoiceId
        ? db
            .select({ number: invoices.number, status: invoices.status })
            .from(invoices)
            .where(eq(invoices.id, p.invoiceId))
            .limit(1)
            .then((x) => x[0] ?? null)
        : null,
    ]);
    if (!r) throw new NotFoundError("Payment");
    const siblings = p.invoiceId
      ? await db
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.invoiceId, p.invoiceId),
              inArray(payments.status, [...PAID_STATUSES]),
            ),
          )
      : [p];
    siblings.sort(
      (a, b) =>
        (a.succeededAt ?? a.createdAt).getTime() -
        (b.succeededAt ?? b.createdAt).getTime(),
    );
    return {
      ok: true,
      data: {
        paymentId: p.id,
        kind: p.kind,
        amountCents: r.amountCents,
        tipCents: r.tipCents,
        methodLabel: paymentMethodLabel(p),
        at: r.at.toISOString(),
        atLabel: atLabel(r.at, tz),
        collectedByName: r.collectedByName,
        entryLabel: r.entryMode ? (ENTRY_LABEL[r.entryMode] ?? null) : null,
        authCode: r.authCode,
        invoiceId: p.invoiceId,
        invoiceNumber: inv?.number ?? null,
        invoiceStatus: inv?.status ?? null,
        remainingBalanceCents: r.remainingBalanceCents,
        jobNumber: r.jobNumber,
        customerFirstName:
          cust?.firstName?.trim() ||
          cust?.name?.split(" ")[0] ||
          "the customer",
        customerHasPhone: !!cust?.phone,
        customerHasEmail: !!cust?.email,
        invoicePayments: siblings.map((s) => {
          const at = s.succeededAt ?? s.createdAt;
          return {
            id: s.id,
            label:
              s.kind === "deposit"
                ? "Deposit"
                : s.kind === "tip_only"
                  ? "Tip"
                  : s.id === p.id
                    ? "This payment"
                    : "Payment",
            atLabel: atLabel(at, tz),
            cents: s.amountCents + s.tipCents,
          };
        }),
      },
    };
  } catch (e) {
    return actionFailure(e);
  }
}

/**
 * The customer's receipt page link (/i/…?receipt=), to share or copy. Reused per
 * payment for a while (mintOrReusePublicToken), not minted on every tap.
 */
export const receiptLink = action({
  anyPerm: ["payments.collect", "payments.record_manual", "invoices.view"],
  input: z.object({ paymentId: uuid }),
  async run({ input, tx, user }) {
    const p = await paymentFor(user, input.paymentId);
    if (!p.invoiceId)
      throw new ConflictError(
        "no_invoice",
        "This payment isn't on an invoice, so it has no receipt page.",
      );
    const link = await mintOrReusePublicToken(tx, {
      kind: "invoice",
      entity: { type: "invoice", id: p.invoiceId },
      customerId: p.customerId,
      jobId: p.jobId,
      purpose: "invoice.receipt",
    });
    return { url: `${link.url}?receipt=${p.id}` };
  },
});

/**
 * Whether the automatic receipt (built-in `payment_receipt`) went out for this
 * payment, and where: the success screen says "Receipt emailed to s•••@…".
 */
export async function receiptStatus(input: {
  paymentId: string;
}): Promise<ActionResult<ReceiptAutoSend[]>> {
  try {
    const user = await requireUser();
    const p = await paymentFor(user, uuid.parse(input.paymentId));
    const { revealed } = await contactRevealedFor(user, p.customerId);
    const rows = await db
      .select({
        channel: scheduledMessages.channel,
        status: scheduledMessages.status,
        to: scheduledMessages.toAddress,
      })
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.entityType, "payment"),
          eq(scheduledMessages.entityId, p.id),
          eq(scheduledMessages.templateKey, "payment.receipt"),
          inArray(scheduledMessages.status, [
            "scheduled",
            "pending_tap",
            "sent",
            "sent_manual",
            "delivered",
          ]),
        ),
      );
    return {
      ok: true,
      data: rows.map((r) => ({
        channel: r.channel,
        status: r.status,
        to: !r.to
          ? null
          : revealed
            ? r.to
            : r.to.includes("@")
              ? maskEmail(r.to)
              : maskPhone(r.to),
      })),
    };
  } catch (e) {
    return actionFailure(e);
  }
}

// ------------------------------------------------------------------ deposits

/** Office asks for a deposit manually (amount chosen by staff). */
export const requestDeposit = action({
  perm: "payments.collect",
  feature: "deposits",
  input: z.object({
    jobId: uuid,
    amountCents: z.coerce.number().int().min(100).max(10_000_000),
    mode: z.enum(["capture", "hold", "manual"]).default("capture"),
    send: z.boolean().default(true),
  }),
  audit: "deposit.requested",
  async run({ input, tx, user, actor, emit: emitE, activity }) {
    const job = await assertJobAccess(user, input.jobId, "read");
    if (user.baseRole === "tech") throw new ForbiddenError();
    const open = await tx
      .select({ id: depositRequests.id })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.jobId, input.jobId),
          inArray(depositRequests.status, ["required", "requested", "held"]),
        ),
      )
      .limit(1);
    if (open.length)
      throw new ConflictError(
        "deposit_open",
        "This job already has an open deposit.",
      );
    // QA2: a deposit is for a job that hasn't started (or is on hold) and has no
    // ISSUED invoice; a draft invoice is fine (the deposit applies when it's issued).
    if (!DEPOSIT_JOB_STATUSES.has(job.status))
      throw new ConflictError(
        "deposit_job_started",
        "A deposit can only be asked for before the work starts.",
      );
    const [issued] = await tx
      .select({ number: invoices.number })
      .from(invoices)
      .where(
        and(
          eq(invoices.jobId, input.jobId),
          notInArray(invoices.status, ["draft", "void"]),
        ),
      )
      .limit(1);
    if (issued)
      throw new ConflictError(
        "invoice_issued",
        `Invoice ${issued.number} is already issued. Collect the balance instead.`,
      );
    const { hasCardProcessor } = await import("@/adapters/payments");
    const { getCurrentPolicy } = await import("@/lib/policies");
    const pol = await getCurrentPolicy("deposit", tx);
    const mode = hasCardProcessor() ? input.mode : "manual";
    const s = await getSettings();
    const [row] = await tx
      .insert(depositRequests)
      .values({
        jobId: input.jobId,
        amountCents: input.amountCents,
        mode,
        status: "required",
        policyVersionId: pol?.id ?? null,
        policySha256: pol?.sha256 ?? null,
        dueAt:
          s.deposits.due_hours != null
            ? new Date(Date.now() + s.deposits.due_hours * 3_600_000)
            : null,
      })
      .returning();
    if (!row) throw new Error("deposit insert failed");
    // One text per request (QA2). An office request is texted only by the office:
    // "Send the link now" sends it here, or later via "Send link". `office_request`
    // makes the built-in `deposit_request` automation (which texts rule-made
    // deposits) skip this one, so the customer never gets two deposit texts.
    await emitE(
      "deposit.required",
      { type: "deposit_request", id: row.id },
      {
        deposit_request_id: row.id,
        job_id: input.jobId,
        amount_cents: row.amountCents,
        office_request: true,
      },
    );
    await activity({
      entity: { type: "job", id: input.jobId },
      customerId: job.customerId,
      jobId: input.jobId,
      kind: "deposit.required",
      summary: `Deposit ${formatMoney(row.amountCents)} requested`,
      data: { deposit_request_id: row.id },
    });
    if (input.send) await sendDepositLinkInTx(tx, row.id, actor);
    return { depositRequestId: row.id, jobId: input.jobId };
  },
  auditEntity: ({ data }) => ({
    type: "deposit_request",
    id: data.depositRequestId,
  }),
  revalidate: ({ data }) => jobPaths(data.jobId, ["/schedule"]),
});

async function sendDepositLinkInTx(
  tx: Tx,
  depositId: string,
  actor: Parameters<typeof enqueueMessage>[2],
) {
  const [d] = await tx
    .select({ d: depositRequests, customerId: jobs.customerId })
    .from(depositRequests)
    .leftJoin(jobs, eq(jobs.id, depositRequests.jobId))
    .where(eq(depositRequests.id, depositId))
    .limit(1);
  if (!d?.customerId) throw new NotFoundError("Deposit");
  const link = await mintPublicToken(tx, {
    kind: "pay",
    entity: { type: "deposit_request", id: depositId },
    customerId: d.customerId,
    jobId: d.d.jobId,
  });
  await tx
    .update(depositRequests)
    .set({
      status: d.d.status === "required" ? "requested" : d.d.status,
      requestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(depositRequests.id, depositId));
  await enqueueMessage(
    tx,
    {
      templateKey: "deposit.request",
      channel: "customer_preferred",
      audience: { type: "customer", customerId: d.customerId },
      entity: { type: "deposit_request", id: depositId },
      jobId: d.d.jobId,
      vars: {
        "deposit.link": link.url,
        "deposit.amount": formatMoney(d.d.amountCents),
      },
      dedupeKey: `deposit_link:${depositId}:${link.tokenId}`,
    },
    actor,
  );
  return link.url;
}

/** Send (or re-send) the deposit pay link. */
export const sendDepositLink = action({
  perm: "payments.collect",
  feature: "deposits",
  input: z.object({ depositRequestId: uuid }),
  audit: "deposit.link_sent",
  async run({ input, tx, user, actor, activity }) {
    const [d] = await tx
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.id, input.depositRequestId))
      .limit(1);
    if (!d) throw new NotFoundError("Deposit");
    if (d.jobId) await assertJobAccess(user, d.jobId, "read");
    else if (!user.perms.has("payments.view_all")) throw new ForbiddenError();
    if (!["required", "requested"].includes(d.status))
      throw new ConflictError(
        "deposit_closed",
        "This deposit is no longer open.",
      );
    const url = await sendDepositLinkInTx(tx, d.id, actor);
    if (d.jobId)
      await activity({
        entity: { type: "job", id: d.jobId },
        jobId: d.jobId,
        kind: "deposit.link_sent",
        summary: `Deposit link sent (${formatMoney(d.amountCents)})`,
      });
    return { url, jobId: d.jobId };
  },
  auditEntity: ({ input }) => ({
    type: "deposit_request",
    id: input.depositRequestId,
  }),
  revalidate: ({ data }) => jobPaths(data.jobId, ["/messages/outbox"]),
});

/** Waive a required deposit (deposits.waive, reason required). */
export const waiveDeposit = action({
  perm: "deposits.waive",
  input: z.object({
    depositRequestId: uuid,
    reason: z.string().trim().min(3, "Say why the deposit is waived.").max(500),
  }),
  audit: "deposit.waived",
  async run({ input, tx, user, activity }) {
    const [d] = await tx
      .update(depositRequests)
      .set({
        status: "waived",
        waivedBy: user.id,
        waiveReason: input.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(depositRequests.id, input.depositRequestId),
          inArray(depositRequests.status, ["required", "requested"]),
        ),
      )
      .returning();
    if (!d)
      throw new ConflictError(
        "deposit_closed",
        "This deposit is no longer open.",
      );
    if (d.jobId)
      await activity({
        entity: { type: "job", id: d.jobId },
        jobId: d.jobId,
        kind: "deposit.waived",
        summary: `Deposit ${formatMoney(d.amountCents)} waived: ${input.reason}`,
      });
    return { jobId: d.jobId };
  },
  auditEntity: ({ input }) => ({
    type: "deposit_request",
    id: input.depositRequestId,
  }),
  revalidate: ({ data }) => jobPaths(data.jobId, ["/schedule"]),
});

// ------------------------------------------------------------------ refunds

const RefundSchema = z.object({
  paymentId: uuid,
  amountCents: z.coerce.number().int().min(1),
  reason: z.string().trim().min(3, "Add a reason.").max(500),
  clientId: uuid.optional(),
});

async function refundableCents(exec: Tx, paymentId: string) {
  const [p] = await exec
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!p) throw new NotFoundError("Payment");
  const rs = await exec
    .select({ amount: refunds.amountCents, status: refunds.status })
    .from(refunds)
    .where(
      and(
        eq(refunds.paymentId, paymentId),
        notInArray(refunds.status, ["failed"]),
      ),
    );
  const used = rs.reduce((s, r) => s + r.amount, 0);
  return { p, left: p.amountCents + p.tipCents - used };
}

async function assertRefundLimit(amountCents: number) {
  const user = await requireUser("payments.refund");
  const s = await getSettings();
  const lim =
    s.limits.max_refund_cents[user.baseRole as "admin" | "office" | "tech"];
  if (lim != null && amountCents > lim)
    throw new ConflictError(
      "refund_limit",
      lim === 0
        ? "Your role can't issue refunds."
        : `Your refund limit is ${formatMoney(lim)}.`,
    );
  return user;
}

/** Step 1 (tx): record a pending refund and emit refund.created. */
const prepareRefund = action({
  name: "payments.prepareRefund",
  perm: "payments.refund",
  input: RefundSchema,
  audit: "refund.created",
  async run({ input, tx, actor, emit: emitE, activity }) {
    await assertRefundLimit(input.amountCents);
    const { p, left } = await refundableCents(tx, input.paymentId);
    if (
      !(PAID_STATUSES as readonly string[]).includes(p.status) ||
      p.status === "disputed"
    )
      throw new ConflictError(
        "not_refundable",
        "This payment can't be refunded.",
      );
    if (input.amountCents > left)
      throw new ConflictError(
        "over_refund",
        `At most ${formatMoney(Math.max(0, left))} can be refunded.`,
      );
    // A card payment goes back through its processor: refuse up front (no pending
    // refund, no refund.created) when that processor isn't connected (QA2).
    if (p.provider !== "manual" && !(await processorReady(p.provider)))
      throw new ConflictError(
        "processor_not_connected",
        "Card refunds need the payment processor connected. Promise the refund by a date instead, then mark it refunded once it's paid back.",
      );
    const [r] = await tx
      .insert(refunds)
      .values({
        paymentId: p.id,
        amountCents: input.amountCents,
        reason: input.reason,
        status: "pending",
        createdBy: actor.userId,
      })
      .returning({ id: refunds.id });
    if (!r) throw new Error("refund insert failed");
    await emitE(
      "refund.created",
      { type: "refund", id: r.id },
      {
        refund_id: r.id,
        payment_id: p.id,
        amount_cents: input.amountCents,
        invoice_id: p.invoiceId,
        job_id: p.jobId,
      },
    );
    await activity({
      entity: p.jobId
        ? { type: "job", id: p.jobId }
        : { type: "customer", id: p.customerId },
      customerId: p.customerId,
      jobId: p.jobId,
      kind: "refund.created",
      summary: `Refund ${formatMoney(input.amountCents)} started`,
      data: { refund_id: r.id },
    });
    return {
      refundId: r.id,
      provider: p.provider as "manual" | "stripe" | "square",
      providerRef: p.providerRef,
      jobId: p.jobId,
    };
  },
  auditEntity: ({ data }) => ({ type: "refund", id: data.refundId }),
});

/** Step 3 (tx): apply the provider result. */
const settleRefund = action({
  name: "payments.settleRefund",
  perm: "payments.refund",
  input: z.object({
    refundId: uuid,
    status: z.enum(["succeeded", "pending", "failed"]),
    providerRef: z.string().max(200).nullish(),
    error: z.string().max(500).nullish(),
  }),
  async run({ input, tx, actor, activity }) {
    const [r] = await tx
      .update(refunds)
      .set({
        status: input.status,
        providerRef: input.providerRef ?? null,
        completedAt: input.status === "succeeded" ? new Date() : null,
      })
      .where(and(eq(refunds.id, input.refundId), eq(refunds.status, "pending")))
      .returning();
    if (!r) return { jobId: null as string | null };
    const [p] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, r.paymentId))
      .limit(1);
    if (input.status === "succeeded")
      await finalizeRefundSucceeded(tx, r.id, actor);
    if (input.status === "failed" && p)
      await activity({
        entity: p.jobId
          ? { type: "job", id: p.jobId }
          : { type: "customer", id: p.customerId },
        customerId: p.customerId,
        jobId: p.jobId,
        kind: "refund.failed",
        summary: `Refund ${formatMoney(r.amountCents)} failed${input.error ? `: ${input.error}` : ""}`,
      });
    return { jobId: p?.jobId ?? null };
  },
  revalidate: ({ data }) => jobPaths(data.jobId),
});

/**
 * Refund to the original method (payments.refund up to the role limit). Card refunds go
 * through the processor; manual methods are recorded (pay back by the original method).
 */
export async function refundPayment(
  input: z.input<typeof RefundSchema>,
): Promise<ActionResult<{ status: string }>> {
  const prep = await prepareRefund(input);
  if (!prep.ok || !prep.data) return prep as ActionResult<{ status: string }>;
  const { refundId, provider, providerRef } = prep.data;
  let status: "succeeded" | "pending" | "failed" = "succeeded";
  let ref: string | null = null;
  let error: string | null = null;
  try {
    const driver = getPaymentProvider(provider);
    if (provider !== "manual" && !providerRef)
      throw new Error("Missing processor reference");
    const snap = await driver.refund(
      providerRef ?? refundId,
      Number(input.amountCents),
      String(input.reason),
      `refund:${refundId}`,
    );
    status = snap.status;
    ref = snap.ref;
  } catch (e) {
    status = "failed";
    // Never show a raw adapter message such as "STRIPE_SECRET_KEY is not configured".
    error = providerErrorMessage(e, "Refund failed");
  }
  const done = await settleRefund({
    refundId,
    status,
    providerRef: ref,
    error,
  });
  if (!done.ok) return done as ActionResult<{ status: string }>;
  if (status === "failed")
    return { ok: false, error: error ?? "The processor declined the refund." };
  return { ok: true, data: { status } };
}

/** Promise a refund by a date (prevents "credit not processed" disputes). */
export const schedulePromisedRefund = action({
  perm: "payments.refund",
  input: z.object({
    paymentId: uuid,
    amountCents: z.coerce.number().int().min(1),
    reason: z.string().trim().min(3).max(500),
    dueOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
  }),
  audit: "refund.scheduled",
  async run({ input, tx, actor, emit: emitE, activity }) {
    await assertRefundLimit(input.amountCents);
    const { p, left } = await refundableCents(tx, input.paymentId);
    if (input.amountCents > left)
      throw new ConflictError(
        "over_refund",
        `At most ${formatMoney(Math.max(0, left))} can be refunded.`,
      );
    const s = await getSettings();
    const due = input.dueOn
      ? new Date(`${input.dueOn}T17:00:00`)
      : new Date(Date.now() + s.payments.promised_refund_days * 86_400_000);
    const [r] = await tx
      .insert(refunds)
      .values({
        paymentId: p.id,
        amountCents: input.amountCents,
        reason: input.reason,
        status: "scheduled",
        dueAt: due,
        createdBy: actor.userId,
      })
      .returning({ id: refunds.id });
    if (!r) throw new Error("refund insert failed");
    await emitE(
      "refund.created",
      { type: "refund", id: r.id },
      {
        refund_id: r.id,
        payment_id: p.id,
        amount_cents: input.amountCents,
        invoice_id: p.invoiceId,
        job_id: p.jobId,
      },
    );
    await activity({
      entity: p.jobId
        ? { type: "job", id: p.jobId }
        : { type: "customer", id: p.customerId },
      customerId: p.customerId,
      jobId: p.jobId,
      kind: "refund.scheduled",
      summary: `Refund ${formatMoney(input.amountCents)} promised by ${due.toLocaleDateString("en-US")}`,
      data: { refund_id: r.id },
    });
    return { refundId: r.id, jobId: p.jobId };
  },
  auditEntity: ({ data }) => ({ type: "refund", id: data.refundId }),
  revalidate: ({ data }) => jobPaths(data.jobId),
});

/** Mark a promised/pending refund as paid back (money moved outside the app). */
export const markRefundPaid = action({
  perm: "payments.refund",
  input: z.object({ refundId: uuid }),
  audit: "refund.marked_paid",
  async run({ input, tx, actor }) {
    const [r] = await tx
      .update(refunds)
      .set({ status: "succeeded", completedAt: new Date() })
      .where(
        and(
          eq(refunds.id, input.refundId),
          inArray(refunds.status, ["scheduled", "pending"]),
        ),
      )
      .returning();
    if (!r)
      throw new ConflictError(
        "refund_closed",
        "This refund is already closed.",
      );
    await finalizeRefundSucceeded(tx, r.id, actor);
    await closeTasksFor(
      tx,
      { kind: "refund_due", entity: { type: "refund", id: r.id } },
      "done",
      actor,
    );
    const [p] = await tx
      .select({ jobId: payments.jobId })
      .from(payments)
      .where(eq(payments.id, r.paymentId))
      .limit(1);
    return { jobId: p?.jobId ?? null };
  },
  auditEntity: ({ input }) => ({ type: "refund", id: input.refundId }),
  revalidate: ({ data }) => jobPaths(data.jobId, ["/tasks"]),
});

// ------------------------------------------------------------------ settings

const PaymentsSettingsSchema = z.object({
  methods: z
    .array(z.enum(["card", "ach", "cash", "check", "zelle", "venmo", "other"]))
    .min(1),
  fee_policy: z.enum(["absorb", "cash_discount", "surcharge"]),
  surcharge_bps: z.coerce.number().int().min(0).max(300),
  cash_discount_bps: z.coerce.number().int().min(0).max(1000),
  tips_enabled: z.boolean(),
  tip_presets_pct: z.array(z.coerce.number().min(0).max(100)).max(5),
  tip_on_fees: z.boolean(),
  allow_keyed: z.boolean(),
  require_check_photo: z.boolean(),
  reference_required: z.array(
    z.enum(["check", "zelle", "venmo", "ach", "other"]),
  ),
  statement_descriptor: z.string().trim().max(22).nullable(),
  descriptor_suffix: z.enum(["job_number", "invoice_number"]),
  pay_link_expires_minutes: z.coerce.number().int().min(30).max(1440),
  unverified_alert_days: z.coerce.number().int().min(1).max(30),
  manual_instructions: z.string().max(1000),
  promised_refund_days: z.coerce.number().int().min(1).max(60),
  fee_pct_by_method: z.record(
    z.string(),
    z.coerce.number().int().min(0).max(1000),
  ),
  max_refund_cents: z.object({
    admin: z.number().int().min(0).nullable(),
    office: z.number().int().min(0).nullable(),
    tech: z.number().int().min(0).nullable(),
  }),
});

export const savePaymentSettings = action({
  perm: "settings.manage",
  input: PaymentsSettingsSchema,
  async run({ input, tx, actor }) {
    const { max_refund_cents, ...payments_ } = input;
    if (payments_.fee_policy === "surcharge") {
      const state = await companyState();
      if (effectiveSurchargeBps(payments_.surcharge_bps, state) === 0)
        throw new ConflictError(
          "surcharge_blocked",
          `Surcharging isn't allowed in ${state ?? "your state"}. Use cash discount instead.`,
        );
      payments_.surcharge_bps = effectiveSurchargeBps(
        payments_.surcharge_bps,
        state,
      );
    }
    await updateSettings(
      tx,
      { payments: payments_, limits: { max_refund_cents } },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => ["/settings/payments", "/payments"],
});

const DepositSettingsSchema = z.object({
  hold_max_days_out: z.coerce.number().int().min(1).max(7),
  round_to_cents: z.coerce.number().int().min(1).max(10_000),
  refundable_until_hours: z.coerce.number().int().min(0).max(720),
  restocking_pct: z.coerce.number().min(0).max(100),
  nonrefundable_after_po: z.boolean(),
  due_hours: z.coerce.number().int().min(1).max(720).nullable(),
});

export const saveDepositSettings = action({
  perm: "settings.manage",
  input: DepositSettingsSchema,
  async run({ input, tx, actor }) {
    await updateSettings(tx, { deposits: input }, actor);
    return { ok: true };
  },
  revalidate: () => ["/settings/deposits"],
});

const RuleSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(80),
  priority: z.coerce.number().int().min(0).max(1000),
  active: z.boolean().default(true),
  trigger: z.object({
    type: z.enum([
      "always",
      "estimate_total_gte",
      "has_special_order_parts",
      "after_hours",
      "new_customer",
      "risk_band_gte",
      "scheduled_days_out_gte",
      "service_type_in",
      "lead_source_in",
      "customer_flag",
    ]),
    value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  }),
  amount: z.object({
    type: z.enum([
      "fixed",
      "percent_total",
      "percent_parts",
      "parts_plus_percent",
    ]),
    value: z.coerce.number().min(0),
    min_cents: z.coerce.number().int().min(0).optional(),
    max_cents: z.coerce.number().int().min(0).optional(),
    round_to_cents: z.coerce.number().int().min(1).optional(),
  }),
  mode: z.enum(["capture", "hold", "card_on_file", "manual"]),
});

export const saveDepositRule = action({
  perm: "settings.manage",
  input: RuleSchema,
  audit: "deposit_rule.saved",
  async run({ input, tx }) {
    const { getCurrentPolicy } = await import("@/lib/policies");
    const pol = await getCurrentPolicy("deposit", tx);
    const values = {
      name: input.name,
      priority: input.priority,
      active: input.active,
      trigger: input.trigger,
      amount: input.amount,
      mode: input.mode,
      updatedAt: new Date(),
    };
    if (input.id) {
      const [r] = await tx
        .update(depositRules)
        .set(values)
        .where(eq(depositRules.id, input.id))
        .returning({ id: depositRules.id });
      if (!r) throw new NotFoundError("Rule");
      return { id: r.id };
    }
    const [r] = await tx
      .insert(depositRules)
      .values({ ...values, policyVersionId: pol?.id ?? null })
      .returning({ id: depositRules.id });
    if (!r) throw new Error("rule insert failed");
    return { id: r.id };
  },
  auditEntity: ({ data }) => ({ type: "setting", id: data.id }),
  revalidate: () => ["/settings/deposits"],
});

/** Rules referenced by deposits are deactivated, never deleted (history). */
export const deleteDepositRule = action({
  perm: "settings.manage",
  input: z.object({ id: uuid }),
  audit: "deposit_rule.deleted",
  async run({ input, tx }) {
    const used = await tx
      .select({ id: depositRequests.id })
      .from(depositRequests)
      .where(eq(depositRequests.ruleId, input.id))
      .limit(1);
    if (used.length)
      await tx
        .update(depositRules)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(depositRules.id, input.id));
    else await tx.delete(depositRules).where(eq(depositRules.id, input.id));
    return { deactivated: used.length > 0 };
  },
  auditEntity: ({ input }) => ({ type: "setting", id: input.id }),
  revalidate: () => ["/settings/deposits"],
});

/** Publish a new deposit-policy version (snapshotted on each deposit request). */
export const publishDepositPolicy = action({
  perm: "settings.manage",
  input: z.object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(20).max(10_000),
    applyToRules: z.boolean().default(true),
  }),
  audit: "deposit_policy.published",
  async run({ input, tx, actor }) {
    const p = await publishPolicyVersion(
      tx,
      { kind: "deposit", title: input.title, body: input.body },
      actor,
    );
    if (input.applyToRules)
      await tx
        .update(depositRules)
        .set({ policyVersionId: p.id, updatedAt: new Date() });
    return { version: p.version };
  },
  revalidate: () => ["/settings/deposits"],
});
