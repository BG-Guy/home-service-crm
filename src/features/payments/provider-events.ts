import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { NormalizedEvent, PaymentSnapshot } from "@/adapters/payments";
import { db, type Tx } from "@/db";
import {
  checkoutSessions,
  depositRequests,
  disputes,
  invoices,
  jobs,
  payments,
  refunds,
  webhookEvents,
} from "@/db/schema";
import { addCardFingerprint } from "@/features/customers/api";
import {
  createCreditNote,
  syncInvoicePaymentState,
} from "@/features/invoices/api";
import { writeActivity } from "@/lib/activity";
import { emit } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { enqueueJob } from "@/lib/queue";
import { getSettings } from "@/lib/settings";
import { type Actor, SYSTEM_ACTOR } from "@/lib/types";
import { estimatedCardFee, splitActualFee } from "./engine/fees";
import {
  balanceOf,
  PAID_STATUSES,
  recomputeJobPaymentStatus,
} from "./internal";

// Provider (Stripe) webhook processing (SPEC §8.4). The route stores the raw event in
// webhook_events (unique → idempotent) and calls processWebhookEvent(); the cron
// `payments.webhook_retry` replays rows whose processed_at is null.

const WEBHOOK_ACTOR: Actor = { kind: "webhook", userId: null };

type DisputeStatus =
  | "inquiry"
  | "needs_response"
  | "under_review"
  | "won"
  | "lost"
  | "accepted"
  | "warning_closed";

/** Stripe dispute status → ours. */
export function mapDisputeStatus(s: string): DisputeStatus {
  switch (s) {
    case "warning_needs_response":
    case "warning_under_review":
      return "inquiry";
    case "warning_closed":
      return "warning_closed";
    case "needs_response":
      return "needs_response";
    case "under_review":
      return "under_review";
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "charge_refunded":
      return "accepted";
    default:
      return "needs_response";
  }
}

const CATEGORIES = new Set([
  "fraudulent",
  "unrecognized",
  "product_not_received",
  "product_unacceptable",
  "credit_not_processed",
  "duplicate",
  "subscription_canceled",
  "general",
]);

async function findPayment(tx: Tx, ref: string) {
  if (!ref) return null;
  const [p] = await tx
    .select()
    .from(payments)
    .where(eq(payments.providerRef, ref))
    .limit(1);
  return p ?? null;
}

/** The PaymentIntent's charge when expanded (real webhooks send only its id). */
function chargeOf(raw: unknown): Record<string, unknown> | null {
  const ch = (raw as Record<string, unknown> | null | undefined)?.latest_charge;
  return ch && typeof ch === "object" ? (ch as Record<string, unknown>) : null;
}

function trimRaw(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ch = chargeOf(r);
  const pmd = (ch?.payment_method_details ?? null) as Record<
    string,
    unknown
  > | null;
  const card = (pmd?.card ?? pmd?.card_present ?? null) as Record<
    string,
    unknown
  > | null;
  return {
    id: r.id,
    status: r.status,
    amount: r.amount,
    amount_received: r.amount_received,
    metadata: r.metadata,
    latest_charge: ch
      ? {
          id: ch.id,
          authorization_code: ch.authorization_code,
          billing_details: ch.billing_details,
          payment_method_details: pmd
            ? {
                type: pmd.type,
                card: card
                  ? {
                      brand: card.brand,
                      country: card.country,
                      funding: card.funding,
                      last4: card.last4,
                      checks: card.checks,
                      three_d_secure: card.three_d_secure,
                      wallet: card.wallet,
                    }
                  : undefined,
              }
            : undefined,
        }
      : typeof r.latest_charge === "string"
        ? { id: r.latest_charge }
        : undefined,
  };
}

function payerNameOf(raw: unknown): string | null {
  const bd = (chargeOf(raw)?.billing_details ?? null) as Record<
    string,
    unknown
  > | null;
  return typeof bd?.name === "string" ? bd.name : null;
}

type PaymentEvent = Extract<NormalizedEvent, { payment: PaymentSnapshot }>;

/** Options for applying one normalized event (internal; not a provider contract). */
export interface ApplyOptions {
  /**
   * The snapshot has no card details (a Checkout Session whose PaymentIntent wasn't
   * expanded): amounts come from the session metadata, card data from a later PI event.
   */
  partial?: boolean;
}

/** Statuses of a settled payment: a late or replayed event never downgrades them. */
const SETTLED = new Set<string>(PAID_STATUSES);

const mdStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

function metadataOf(raw: unknown): Record<string, unknown> {
  const md = (raw as Record<string, unknown> | null | undefined)?.metadata;
  return md && typeof md === "object" ? (md as Record<string, unknown>) : {};
}

/** Tip and surcharge ride in the session/PI metadata; the invoice portion is the rest. */
export function splitGross(
  grossCents: number,
  metadata: Record<string, unknown>,
): { amountCents: number; tipCents: number; surchargeCents: number } {
  const tipCents = Math.max(
    0,
    Math.round(Number(metadata.tip_cents ?? 0) || 0),
  );
  const surchargeCents = Math.max(
    0,
    Math.round(Number(metadata.surcharge_cents ?? 0) || 0),
  );
  return {
    amountCents: Math.max(0, grossCents - tipCents - surchargeCents),
    tipCents,
    surchargeCents,
  };
}

type PaymentRow = typeof payments.$inferSelect;
type PaymentPatch = Partial<typeof payments.$inferInsert>;

/** Card fields the stored payment is still missing, from a provider snapshot. */
function cardPatch(existing: PaymentRow, snap: PaymentSnapshot): PaymentPatch {
  const patch: PaymentPatch = {};
  const fill = <K extends keyof typeof payments.$inferInsert>(
    key: K,
    value: (typeof payments.$inferInsert)[K] | undefined,
  ) => {
    if (value != null && existing[key as keyof typeof existing] == null)
      patch[key] = value;
  };
  fill("cardBrand", snap.brand);
  fill("cardFunding", snap.funding);
  fill("cardLast4", snap.last4);
  fill("cardFingerprint", snap.fingerprint);
  fill("avsResult", snap.avs);
  fill("cvcResult", snap.cvc);
  fill("threeDs", snap.threeDS);
  fill("wallet", snap.wallet);
  fill("payerIp", snap.ip);
  fill("payerName", payerNameOf(snap.raw) ?? undefined);
  return patch;
}

/**
 * Fee columns of a settled card payment (QA2): the processor's actual fee when the
 * snapshot has it, else an ESTIMATE from the configured card rate (payments settings
 * `card_fee_estimate_*`), so commission is net of the card fee from the start. The
 * `stripe_fee` worker later swaps in the actual fee and emits `payment.fee_updated`.
 */
async function feeColumns(
  snap: PaymentSnapshot,
  amountCents: number,
  tipCents: number,
): Promise<Pick<PaymentPatch, "feeCents" | "feeOnTipCents" | "feeSource">> {
  if (snap.feeCents != null)
    return {
      feeCents: snap.feeCents,
      feeOnTipCents: splitActualFee({
        amountCents,
        tipCents,
        feeCents: snap.feeCents,
      }).feeOnTipCents,
      feeSource: "actual",
    };
  const s = (await getSettings()).payments;
  const est = estimatedCardFee({
    amountCents,
    tipCents,
    grossCents: snap.amountCents > 0 ? snap.amountCents : undefined,
    bps: s.card_fee_estimate_bps,
    fixedCents: s.card_fee_estimate_fixed_cents,
  });
  return {
    feeCents: est.feeCents,
    feeOnTipCents: est.feeOnTipCents,
    feeSource: "configured",
  };
}

/**
 * Merge a trimmed snapshot into the stored raw without losing an expanded charge (auth
 * code, card country) to a later event that only carries the charge id.
 */
function mergeRaw(
  prevRaw: Record<string, unknown>,
  next: Record<string, unknown> | null,
): Record<string, unknown> {
  const out = { ...prevRaw, ...(next ?? {}) };
  if (
    isExpandedCharge(prevRaw.latest_charge) &&
    !isExpandedCharge(next?.latest_charge)
  )
    out.latest_charge = prevRaw.latest_charge;
  return out;
}

/** A stored/trimmed charge with more than its id. */
function isExpandedCharge(v: unknown): boolean {
  return (
    !!v &&
    typeof v === "object" &&
    Object.entries(v).some(([k, x]) => k !== "id" && x !== undefined)
  );
}

/** Emit `payment.fee_updated` (+ activity) after a payment's fee changed in this tx. */
async function emitFeeUpdated(
  tx: Tx,
  p: PaymentRow,
  feeCents: number,
  actor: Actor,
): Promise<void> {
  await emit(
    tx,
    "payment.fee_updated",
    { type: "payment", id: p.id },
    {
      payment_id: p.id,
      job_id: p.jobId,
      invoice_id: p.invoiceId,
      fee_cents: feeCents,
      previous_fee_cents: p.feeCents,
    },
    { actor },
  );
  await writeActivity(tx, {
    entity: p.jobId
      ? { type: "job", id: p.jobId }
      : { type: "customer", id: p.customerId },
    customerId: p.customerId,
    jobId: p.jobId,
    kind: "payment.fee_updated",
    summary: `Card fee ${formatMoney(feeCents)} confirmed by the processor (estimated ${formatMoney(p.feeCents)})`,
    data: {
      payment_id: p.id,
      fee_cents: feeCents,
      previous_fee_cents: p.feeCents,
    },
    actorUserId: actor.userId,
  });
}

/**
 * A later event for an already-settled payment (duplicate delivery, or
 * `payment_intent.succeeded` after `checkout.session.completed`): fill in the card
 * snapshot and actual fee, and correct amount/tip from an authoritative PI snapshot.
 * Never re-emits payment.succeeded; a changed fee emits payment.fee_updated.
 */
async function enrichSettledPayment(
  tx: Tx,
  existing: PaymentRow,
  snap: PaymentSnapshot,
  partial: boolean,
): Promise<void> {
  const patch = cardPatch(existing, snap);
  if (snap.feeCents != null && existing.feeSource !== "actual") {
    patch.feeCents = snap.feeCents;
    patch.feeSource = "actual";
  }
  let amountsChanged = false;
  if (!partial) {
    if (snap.entryMode && snap.entryMode !== existing.entryMode)
      patch.entryMode = snap.entryMode;
    const split = splitGross(snap.amountCents, metadataOf(snap.raw));
    if (
      snap.amountCents > 0 &&
      (split.amountCents !== existing.amountCents ||
        split.tipCents !== existing.tipCents)
    ) {
      patch.amountCents = split.amountCents;
      patch.tipCents = split.tipCents;
      amountsChanged = true;
    }
    const prevRaw = (existing.raw ?? {}) as Record<string, unknown>;
    patch.raw = {
      ...mergeRaw(prevRaw, trimRaw(snap.raw)),
      surcharge_cents: split.surchargeCents || undefined,
    };
  }
  // The fee's base/tip split follows the (possibly corrected) amounts.
  if (patch.feeCents != null || amountsChanged)
    patch.feeOnTipCents = splitActualFee({
      amountCents: patch.amountCents ?? existing.amountCents,
      tipCents: patch.tipCents ?? existing.tipCents,
      feeCents: patch.feeCents ?? existing.feeCents,
    }).feeOnTipCents;
  if (Object.keys(patch).length === 0) return;
  await tx
    .update(payments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(payments.id, existing.id));
  if (patch.cardFingerprint)
    await addCardFingerprint(tx, existing.customerId, patch.cardFingerprint);
  if (patch.feeCents != null && patch.feeCents !== existing.feeCents)
    await emitFeeUpdated(tx, existing, patch.feeCents, WEBHOOK_ACTOR);
  if (!amountsChanged) return;
  if (existing.invoiceId)
    await syncInvoicePaymentState(tx, existing.invoiceId, WEBHOOK_ACTOR);
  if (existing.jobId) await recomputeJobPaymentStatus(tx, existing.jobId);
  await writeActivity(tx, {
    entity: existing.jobId
      ? { type: "job", id: existing.jobId }
      : { type: "customer", id: existing.customerId },
    customerId: existing.customerId,
    jobId: existing.jobId,
    kind: "payment.corrected",
    summary: `Card payment split corrected: ${formatMoney(patch.amountCents ?? existing.amountCents)} + ${formatMoney(patch.tipCents ?? existing.tipCents)} tip`,
    data: {
      payment_id: existing.id,
      from: {
        amount_cents: existing.amountCents,
        tip_cents: existing.tipCents,
      },
      to: { amount_cents: patch.amountCents, tip_cents: patch.tipCents },
    },
    actorUserId: null,
  });
}

/** Upsert a card payment from a provider snapshot; emits payment.succeeded once. */
async function applyPayment(
  tx: Tx,
  ev: PaymentEvent,
  opts: ApplyOptions = {},
): Promise<void> {
  const snap = ev.payment;
  const existing = await findPayment(tx, snap.ref);
  if (existing && SETTLED.has(existing.status)) {
    // Duplicate or out-of-order delivery (e.g. checkout.session.completed and
    // payment_intent.succeeded in either order, or a stale failed/authorized event):
    // never downgrade or re-book a settled payment; only enrich it (T6-01).
    if (ev.type === "payment.succeeded")
      await enrichSettledPayment(tx, existing, snap, !!opts.partial);
    return;
  }

  // Context from metadata / checkout session ("" metadata values mean "none").
  let invoiceId = ev.invoiceId || existing?.invoiceId || null;
  let depositId = ev.depositRequestId || existing?.depositRequestId || null;
  const md = metadataOf(snap.raw);
  const split = splitGross(snap.amountCents, md);
  const tipCents = split.tipCents;
  const surcharge = split.surchargeCents;
  let jobId: string | null = mdStr(md.job_id) ?? existing?.jobId ?? null;
  let customerId: string | null =
    mdStr(md.customer_id) ?? existing?.customerId ?? null;
  if (invoiceId && (!jobId || !customerId)) {
    const [inv] = await tx
      .select({ jobId: invoices.jobId, customerId: invoices.customerId })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    jobId = jobId ?? inv?.jobId ?? null;
    customerId = customerId ?? inv?.customerId ?? null;
  }
  let deposit: typeof depositRequests.$inferSelect | null = null;
  if (depositId) {
    const [d] = await tx
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.id, depositId))
      .limit(1);
    deposit = d ?? null;
    jobId = jobId ?? deposit?.jobId ?? null;
  }
  if (!customerId && jobId) {
    const [j] = await tx
      .select({ customerId: jobs.customerId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    customerId = j?.customerId ?? null;
  }
  if (!customerId) throw new Error(`payment ${snap.ref}: no customer context`);
  if (!depositId) depositId = null;
  // A deposit paid after the invoice exists is applied immediately.
  if (deposit && !invoiceId && jobId) {
    const [inv] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")))
      .limit(1);
    invoiceId = inv?.id ?? null;
  }

  const status =
    ev.type === "payment.succeeded"
      ? "succeeded"
      : ev.type === "payment.authorized"
        ? "authorized"
        : ev.type === "payment.failed"
          ? "failed"
          : "canceled";
  const amount = split.amountCents;
  const now = new Date();
  const values = {
    invoiceId,
    jobId,
    customerId,
    depositRequestId: deposit?.id ?? null,
    kind: deposit ? "deposit" : "payment",
    method: "card",
    provider: "stripe",
    providerRef: snap.ref,
    status,
    amountCents: amount,
    tipCents,
    // A settled charge always carries a fee: actual, else the configured estimate.
    ...(status === "succeeded" || snap.feeCents != null
      ? await feeColumns(snap, amount, tipCents)
      : {}),
    entryMode: snap.entryMode,
    cardBrand: snap.brand ?? null,
    cardFunding: snap.funding ?? null,
    cardLast4: snap.last4 ?? null,
    cardFingerprint: snap.fingerprint ?? null,
    avsResult: snap.avs ?? null,
    cvcResult: snap.cvc ?? null,
    threeDs: snap.threeDS ?? null,
    wallet: snap.wallet ?? null,
    payerName: payerNameOf(snap.raw),
    payerIp: snap.ip ?? null,
    authorizedAt:
      status === "authorized" ? now : (existing?.authorizedAt ?? null),
    captureBefore: snap.captureBefore ?? existing?.captureBefore ?? null,
    succeededAt: status === "succeeded" ? (snap.capturedAt ?? now) : null,
    raw: { ...trimRaw(snap.raw), surcharge_cents: surcharge || undefined },
    updatedAt: now,
  };
  let paymentId: string;
  if (existing) {
    await tx.update(payments).set(values).where(eq(payments.id, existing.id));
    paymentId = existing.id;
  } else {
    const [row] = await tx
      .insert(payments)
      .values({ ...values, idempotencyKey: `stripe:${snap.ref}` })
      .returning({ id: payments.id });
    if (!row) throw new Error("payment insert failed");
    paymentId = row.id;
  }
  await tx
    .update(checkoutSessions)
    .set({
      status:
        status === "succeeded" || status === "authorized"
          ? "completed"
          : "open",
    })
    .where(
      and(
        eq(checkoutSessions.status, "open"),
        deposit
          ? eq(checkoutSessions.depositRequestId, deposit.id)
          : invoiceId
            ? eq(checkoutSessions.invoiceId, invoiceId)
            : eq(checkoutSessions.sessionRef, "__none__"),
      ),
    );

  if (status === "authorized" && deposit) {
    await tx
      .update(depositRequests)
      .set({ status: "held", paymentId, updatedAt: now })
      .where(eq(depositRequests.id, deposit.id));
    await writeActivity(tx, {
      entity: jobId
        ? { type: "job", id: jobId }
        : { type: "customer", id: customerId },
      customerId,
      jobId,
      kind: "deposit.held",
      summary: `Card hold ${formatMoney(amount)} placed for the deposit`,
      data: { payment_id: paymentId },
      actorUserId: null,
    });
  }
  if (status === "failed" || status === "canceled") {
    if (status === "failed")
      await emit(
        tx,
        "payment.failed",
        { type: "payment", id: paymentId },
        { payment_id: paymentId, error: "Card payment failed" },
        { actor: WEBHOOK_ACTOR },
      );
    if (deposit?.status === "held")
      await tx
        .update(depositRequests)
        .set({ status: "requested", updatedAt: now })
        .where(eq(depositRequests.id, deposit.id));
    await writeActivity(tx, {
      entity: jobId
        ? { type: "job", id: jobId }
        : { type: "customer", id: customerId },
      customerId,
      jobId,
      kind: status === "failed" ? "payment.failed" : "payment.canceled",
      summary: `Card payment ${status === "failed" ? "failed" : "canceled"}`,
      data: { payment_id: paymentId },
      actorUserId: null,
    });
  }
  if (status !== "succeeded") {
    if (jobId) await recomputeJobPaymentStatus(tx, jobId);
    return;
  }

  if (snap.fingerprint)
    await addCardFingerprint(tx, customerId, snap.fingerprint);
  if (snap.feeCents == null)
    await enqueueJob(
      tx,
      "stripe_fee",
      { paymentId },
      {
        dedupeKey: `stripe_fee:${paymentId}`,
        runAt: new Date(Date.now() + 60_000),
      },
    );
  if (invoiceId) await syncInvoicePaymentState(tx, invoiceId, WEBHOOK_ACTOR);
  if (deposit)
    await tx
      .update(depositRequests)
      .set({
        status: invoiceId ? "applied" : "paid",
        paymentId,
        updatedAt: now,
      })
      .where(eq(depositRequests.id, deposit.id));
  if (jobId) await recomputeJobPaymentStatus(tx, jobId);
  await emit(
    tx,
    "payment.succeeded",
    { type: "payment", id: paymentId },
    {
      payment_id: paymentId,
      invoice_id: invoiceId,
      method: "card",
      amount_cents: amount,
      collected_by: null,
      job_id: jobId,
      customer_id: customerId,
      kind: deposit ? "deposit" : "payment",
      tip_cents: tipCents,
      deposit_request_id: deposit?.id ?? null,
      provider: "stripe",
      entry_mode: snap.entryMode,
    },
    { actor: WEBHOOK_ACTOR },
  );
  await writeActivity(tx, {
    entity: jobId
      ? { type: "job", id: jobId }
      : { type: "customer", id: customerId },
    customerId,
    jobId,
    kind: "payment.succeeded",
    summary: `${deposit ? "Deposit" : "Card payment"} ${formatMoney(amount + tipCents)}${snap.last4 ? ` (••${snap.last4})` : ""}`,
    data: { payment_id: paymentId, amount_cents: amount, tip_cents: tipCents },
    actorUserId: null,
  });
  if (deposit)
    await emit(
      tx,
      "deposit.paid",
      { type: "deposit_request", id: deposit.id },
      { deposit_request_id: deposit.id, payment_id: paymentId },
      { actor: WEBHOOK_ACTOR },
    );
}

/**
 * Worker `stripe_fee` (QA2): apply the processor's current view of a card payment
 * (charge expanded) to the stored row. Fills the card snapshot that webhooks don't
 * carry (brand, last4, fingerprint, AVS/CVC, 3DS, wallet, payer name, auth code),
 * swaps the fee estimate for the actual fee and emits `payment.fee_updated` when the
 * fee changed, so payroll recomputes. Idempotent (fills only what's missing).
 */
export async function applyFetchedPayment(
  tx: Tx,
  paymentId: string,
  snap: PaymentSnapshot,
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ updated: boolean; feeChanged: boolean }> {
  const [p] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .for("update")
    .limit(1);
  if (!p) return { updated: false, feeChanged: false };
  const patch = cardPatch(p, snap);
  const expanded = chargeOf(snap.raw);
  if (expanded) {
    if (snap.entryMode && snap.entryMode !== p.entryMode)
      patch.entryMode = snap.entryMode;
    const prevRaw = (p.raw ?? {}) as Record<string, unknown>;
    const ch = trimRaw(snap.raw)?.latest_charge;
    if (ch && !isExpandedCharge(prevRaw.latest_charge))
      patch.raw = { ...prevRaw, latest_charge: ch };
  }
  let feeChanged = false;
  if (snap.feeCents != null && p.feeSource !== "actual") {
    patch.feeCents = snap.feeCents;
    patch.feeOnTipCents = splitActualFee({
      amountCents: p.amountCents,
      tipCents: p.tipCents,
      feeCents: snap.feeCents,
    }).feeOnTipCents;
    patch.feeSource = "actual";
    feeChanged = snap.feeCents !== p.feeCents;
  }
  if (Object.keys(patch).length === 0)
    return { updated: false, feeChanged: false };
  await tx
    .update(payments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(payments.id, p.id));
  if (patch.cardFingerprint)
    await addCardFingerprint(tx, p.customerId, patch.cardFingerprint);
  if (feeChanged && patch.feeCents != null)
    await emitFeeUpdated(tx, p, patch.feeCents, actor);
  return { updated: true, feeChanged };
}

async function applyRefund(
  tx: Tx,
  ev: Extract<NormalizedEvent, { type: "refund.updated" }>,
): Promise<void> {
  const pay = await findPayment(tx, ev.paymentRef);
  if (!pay) throw new Error(`refund for unknown payment ${ev.paymentRef}`);
  const r = ev.refund;
  const [existing] = await tx
    .select()
    .from(refunds)
    .where(eq(refunds.providerRef, r.ref))
    .limit(1);
  // A refund we created ourselves (pending, no ref yet) → match by amount.
  let row = existing ?? null;
  if (!row) {
    const [pending] = await tx
      .select()
      .from(refunds)
      .where(
        and(
          eq(refunds.paymentId, pay.id),
          eq(refunds.amountCents, r.amountCents),
          inArray(refunds.status, ["pending"]),
        ),
      )
      .limit(1);
    row = pending ?? null;
  }
  const status =
    r.status === "succeeded"
      ? "succeeded"
      : r.status === "failed"
        ? "failed"
        : "pending";
  const wasSucceeded = row?.status === "succeeded";
  let refundId: string;
  if (row) {
    await tx
      .update(refunds)
      .set({
        providerRef: r.ref,
        status,
        completedAt:
          status === "succeeded" ? (row.completedAt ?? new Date()) : null,
      })
      .where(eq(refunds.id, row.id));
    refundId = row.id;
  } else {
    const [ins] = await tx
      .insert(refunds)
      .values({
        paymentId: pay.id,
        amountCents: r.amountCents,
        reason: "Refunded in the processor dashboard",
        status,
        providerRef: r.ref,
        completedAt: status === "succeeded" ? new Date() : null,
      })
      .returning({ id: refunds.id });
    if (!ins) throw new Error("refund insert failed");
    refundId = ins.id;
    await emit(
      tx,
      "refund.created",
      { type: "refund", id: refundId },
      {
        refund_id: refundId,
        payment_id: pay.id,
        amount_cents: r.amountCents,
        invoice_id: pay.invoiceId,
        job_id: pay.jobId,
      },
      { actor: WEBHOOK_ACTOR },
    );
  }
  if (status === "succeeded" && !wasSucceeded)
    await finalizeRefundSucceeded(tx, refundId, WEBHOOK_ACTOR);
}

/**
 * How much of a partial refund to credit on a paid invoice so it stays paid (pure).
 * Refunds come out of the base before the tip; only the base part is credited, never
 * more than the balance the refund re-opened or the invoice's uncredited total.
 */
export function partialRefundCreditCents(i: {
  paymentAmountCents: number;
  refundCents: number;
  /** Σ succeeded refunds on the payment, this one included. */
  refundedTotalCents: number;
  /** Invoice balance after the refund (invoice_balances view). */
  balanceAfterCents: number;
  invoiceTotalCents: number;
  creditedCents: number;
}): number {
  if (i.refundedTotalCents >= i.paymentAmountCents) return 0; // a full refund re-opens
  const before = i.refundedTotalCents - i.refundCents;
  const baseLeft = Math.max(0, i.paymentAmountCents - before);
  const base = Math.min(i.refundCents, baseLeft);
  return Math.max(
    0,
    Math.min(base, i.balanceAfterCents, i.invoiceTotalCents - i.creditedCents),
  );
}

/**
 * Partial refunds (lead decision, QA2): a partial refund on a PAID invoice is a
 * concession, not an un-payment. Post a credit note for the refunded base so the
 * invoice stays paid (no dunning, commission stays earned; B6 scales it to the net
 * collected). A full refund, or a refund on an open invoice, still re-opens it.
 * Idempotent per refund (payments.raw.refund_credit_notes).
 */
async function creditPartialRefund(
  tx: Tx,
  r: {
    refund: typeof refunds.$inferSelect;
    pay: typeof payments.$inferSelect;
  },
  refundedTotalCents: number,
  invoiceStatusBefore: string,
  actor: Actor,
): Promise<void> {
  const invoiceId = r.pay.invoiceId;
  if (!invoiceId || invoiceStatusBefore !== "paid") return;
  if (r.refund.reason === "dispute_lost") return;
  const raw = (r.pay.raw ?? {}) as Record<string, unknown>;
  const done = (raw.refund_credit_notes ?? {}) as Record<string, string>;
  if (done[r.refund.id]) return;
  const bal = await balanceOf(tx, invoiceId);
  if (!bal) return;
  const [inv] = await tx
    .select({
      id: invoices.id,
      number: invoices.number,
      customerId: invoices.customerId,
      jobId: invoices.jobId,
      totalCents: invoices.totalCents,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv) return;
  const credit = partialRefundCreditCents({
    paymentAmountCents: r.pay.amountCents,
    refundCents: r.refund.amountCents,
    refundedTotalCents,
    balanceAfterCents: bal.balanceCents,
    invoiceTotalCents: Number(inv.totalCents),
    creditedCents: bal.creditedCents,
  });
  if (credit <= 0) return;
  const cn = await createCreditNote(
    tx,
    {
      invoiceId: inv.id,
      amountCents: credit,
      reason: `Partial refund of ${formatMoney(r.refund.amountCents)}`,
      note: "(partial refund)",
      data: { refund_id: r.refund.id },
    },
    actor,
  );
  await tx
    .update(payments)
    .set({
      raw: { ...raw, refund_credit_notes: { ...done, [r.refund.id]: cn.id } },
    })
    .where(eq(payments.id, r.pay.id));
}

/** Σ succeeded refunds covers everything charged: the amount AND the tip (pure). */
export function refundedInFull(
  refundedTotalCents: number,
  p: { amountCents: number; tipCents: number },
): boolean {
  return refundedTotalCents >= p.amountCents + p.tipCents;
}

/** Shared by webhooks and the manual "Mark refunded": payment status, invoice sync, events. */
export async function finalizeRefundSucceeded(
  tx: Tx,
  refundId: string,
  actor: Actor,
): Promise<void> {
  const [r] = await tx
    .select({ refund: refunds, pay: payments })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(eq(refunds.id, refundId))
    .limit(1);
  if (!r) return;
  const all = await tx
    .select({ amount: refunds.amountCents })
    .from(refunds)
    .where(
      and(eq(refunds.paymentId, r.pay.id), eq(refunds.status, "succeeded")),
    );
  const total = all.reduce((s, x) => s + x.amount, 0);
  // Fully refunded only once the tip is back too (amount_cents excludes it, QA2);
  // the invoice side still counts refunds up to the amount (invoice_balances).
  const fullyRefunded = refundedInFull(total, r.pay);
  if (r.pay.status !== "disputed")
    await tx
      .update(payments)
      .set({
        status: fullyRefunded ? "refunded" : "partially_refunded",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, r.pay.id));
  if (r.pay.depositRequestId && fullyRefunded)
    await tx
      .update(depositRequests)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(eq(depositRequests.id, r.pay.depositRequestId));
  if (r.pay.invoiceId) {
    const [inv] = await tx
      .select({ status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, r.pay.invoiceId))
      .limit(1);
    if (inv) await creditPartialRefund(tx, r, total, inv.status, actor);
    await syncInvoicePaymentState(tx, r.pay.invoiceId, actor);
  }
  if (r.pay.jobId) await recomputeJobPaymentStatus(tx, r.pay.jobId);
  await emit(
    tx,
    "refund.succeeded",
    { type: "refund", id: refundId },
    {
      refund_id: refundId,
      payment_id: r.pay.id,
      amount_cents: r.refund.amountCents,
      invoice_id: r.pay.invoiceId,
      job_id: r.pay.jobId,
    },
    { actor },
  );
  await writeActivity(tx, {
    entity: r.pay.jobId
      ? { type: "job", id: r.pay.jobId }
      : { type: "customer", id: r.pay.customerId },
    customerId: r.pay.customerId,
    jobId: r.pay.jobId,
    kind: "refund.succeeded",
    summary: `Refunded ${formatMoney(r.refund.amountCents)}`,
    data: { refund_id: refundId, payment_id: r.pay.id },
    actorUserId: actor.userId,
  });
}

async function applyDispute(
  tx: Tx,
  ev: Extract<NormalizedEvent, { dispute: unknown }>,
): Promise<void> {
  const d = ev.dispute;
  const pay = await findPayment(tx, d.paymentRef);
  if (!pay) throw new Error(`dispute for unknown payment ${d.paymentRef}`);
  const status = mapDisputeStatus(d.status);
  const category = CATEGORIES.has(d.category) ? d.category : "general";
  const [existing] = await tx
    .select()
    .from(disputes)
    .where(eq(disputes.providerRef, d.ref))
    .limit(1);
  const now = new Date();
  if (!existing) {
    const { openDisputeInTx } = await import("@/features/disputes/server");
    await openDisputeInTx(tx, {
      payment: pay,
      providerRef: d.ref,
      provider: "stripe",
      category,
      networkReasonCode: d.networkCode ?? null,
      amountCents: d.amountCents,
      status,
      dueBy: d.dueBy ?? null,
    });
    if (ev.type === "dispute.created") return;
  }
  const [cur] = await tx
    .select()
    .from(disputes)
    .where(eq(disputes.providerRef, d.ref))
    .limit(1);
  if (!cur) return;
  const closed = ["won", "lost", "accepted", "warning_closed"].includes(status);
  const outcome =
    status === "won" || status === "lost" || status === "accepted"
      ? status
      : ev.type === "dispute.funds_withdrawn"
        ? (cur.outcome ?? null)
        : (cur.outcome ?? null);
  if (
    cur.status === status &&
    !(
      ev.type === "dispute.funds_withdrawn" ||
      ev.type === "dispute.funds_reinstated"
    )
  )
    return; // no change
  await tx
    .update(disputes)
    .set({
      status,
      dueBy: d.dueBy ?? cur.dueBy,
      outcome,
      closedAt: closed ? (cur.closedAt ?? now) : null,
      updatedAt: now,
    })
    .where(eq(disputes.id, cur.id));
  const payload = {
    dispute_id: cur.id,
    status,
    outcome,
    job_id: pay.jobId,
    amount_cents: cur.amountCents,
    customer_id: pay.customerId,
  };
  if (closed) {
    // Lost (or accepted) = the money left: record a refund so balances re-open.
    if ((status === "lost" || status === "accepted") && cur.status !== status) {
      const [has] = await tx
        .select({ id: refunds.id })
        .from(refunds)
        .where(
          and(
            eq(refunds.paymentId, pay.id),
            eq(refunds.reason, "dispute_lost"),
          ),
        )
        .limit(1);
      if (!has)
        await tx.insert(refunds).values({
          paymentId: pay.id,
          amountCents: cur.amountCents,
          reason: "dispute_lost",
          status: "succeeded",
          providerRef: `${d.ref}:lost`,
          completedAt: now,
        });
      await tx
        .update(payments)
        .set({ status: "refunded", updatedAt: now })
        .where(eq(payments.id, pay.id));
    } else if (status === "won" || status === "warning_closed") {
      await tx
        .update(payments)
        .set({ status: "succeeded", updatedAt: now })
        .where(and(eq(payments.id, pay.id), eq(payments.status, "disputed")));
    }
    if (pay.invoiceId)
      await syncInvoicePaymentState(tx, pay.invoiceId, WEBHOOK_ACTOR);
    if (pay.jobId) await recomputeJobPaymentStatus(tx, pay.jobId);
    await emit(tx, "dispute.closed", { type: "dispute", id: cur.id }, payload, {
      actor: WEBHOOK_ACTOR,
    });
  } else {
    await emit(
      tx,
      "dispute.updated",
      { type: "dispute", id: cur.id },
      payload,
      {
        actor: WEBHOOK_ACTOR,
      },
    );
  }
  await writeActivity(tx, {
    entity: pay.jobId
      ? { type: "job", id: pay.jobId }
      : { type: "customer", id: pay.customerId },
    customerId: pay.customerId,
    jobId: pay.jobId,
    kind: closed ? "dispute.closed" : "dispute.updated",
    summary: closed
      ? `Dispute ${status === "won" ? "won" : status === "lost" ? "lost" : "closed"}`
      : `Dispute ${status.replace(/_/g, " ")}${ev.type === "dispute.funds_withdrawn" ? " (funds withdrawn)" : ev.type === "dispute.funds_reinstated" ? " (funds reinstated)" : ""}`,
    data: { dispute_id: cur.id },
    actorUserId: null,
  });
}

async function applyEfw(
  tx: Tx,
  ev: Extract<NormalizedEvent, { type: "efw.created" }>,
): Promise<void> {
  const pay = await findPayment(tx, ev.paymentRef);
  if (!pay) throw new Error(`EFW for unknown payment ${ev.paymentRef}`);
  const raw = (pay.raw ?? {}) as Record<string, unknown>;
  if (raw.efw_at) return; // already recorded (duplicate delivery)
  await tx
    .update(payments)
    .set({
      raw: {
        ...raw,
        efw_at: new Date().toISOString(),
        efw_fraud_type: ev.fraudType ?? null,
      },
    })
    .where(eq(payments.id, pay.id));
  await emit(
    tx,
    "efw.created",
    { type: "payment", id: pay.id },
    { payment_id: pay.id, amount_cents: ev.amountCents || pay.amountCents },
    { actor: WEBHOOK_ACTOR },
  );
  await writeActivity(tx, {
    entity: pay.jobId
      ? { type: "job", id: pay.jobId }
      : { type: "customer", id: pay.customerId },
    customerId: pay.customerId,
    jobId: pay.jobId,
    kind: "efw.created",
    summary: `Early fraud warning on a ${formatMoney(pay.amountCents)} card payment`,
    data: { payment_id: pay.id, fraud_type: ev.fraudType ?? null },
    actorUserId: null,
  });
}

/** Apply one normalized provider event inside the caller's transaction. */
export async function applyNormalizedEvent(
  tx: Tx,
  ev: NormalizedEvent,
  opts: ApplyOptions = {},
): Promise<void> {
  switch (ev.type) {
    case "payment.succeeded":
    case "payment.authorized":
    case "payment.failed":
    case "payment.canceled":
      return applyPayment(tx, ev, opts);
    case "refund.updated":
      return applyRefund(tx, ev);
    case "dispute.created":
    case "dispute.updated":
    case "dispute.closed":
    case "dispute.funds_withdrawn":
    case "dispute.funds_reinstated":
      return applyDispute(tx, ev);
    case "efw.created":
      return applyEfw(tx, ev);
  }
}

/**
 * Stripe payload → normalized events for applyNormalizedEvent. A
 * `checkout.session.completed` keeps the session metadata (tip, job, customer) on the
 * snapshot so the tip is never booked as invoice payment, and is flagged `partial`
 * when its PaymentIntent (and card details) isn't expanded (T6-01).
 */
export async function normalizeStripePayload(payload: {
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<{ ev: NormalizedEvent; partial: boolean }[]> {
  const { normalizeStripeEvent } = await import("@/adapters/payments");
  const out = normalizeStripeEvent(payload);
  if (payload.type !== "checkout.session.completed")
    return out.map((ev) => ({ ev, partial: false }));
  const session = payload.data.object ?? {};
  const sessionMd = metadataOf(session);
  const pi =
    session.payment_intent && typeof session.payment_intent === "object"
      ? (session.payment_intent as Record<string, unknown>)
      : null;
  const hasCard = !!(pi?.latest_charge && typeof pi.latest_charge === "object");
  return out.map((ev) => {
    if (!("payment" in ev)) return { ev, partial: false };
    const raw = (ev.payment.raw ?? {}) as Record<string, unknown>;
    return {
      ev: {
        ...ev,
        invoiceId: ev.invoiceId || mdStr(sessionMd.invoice_id) || undefined,
        depositRequestId:
          ev.depositRequestId ||
          mdStr(sessionMd.deposit_request_id) ||
          undefined,
        payment: {
          ...ev.payment,
          raw: { ...raw, metadata: { ...sessionMd, ...metadataOf(raw) } },
        },
      },
      partial: !hasCard,
    };
  });
}

/**
 * Process a stored webhook_events row (idempotent: skipped once processed). Errors are
 * written to the row and retried by the cron.
 */
export async function processWebhookEvent(
  id: string,
): Promise<"processed" | "skipped" | "failed"> {
  const [row] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id))
    .limit(1);
  if (!row || row.processedAt) return "skipped";
  try {
    const normalized =
      row.provider === "stripe"
        ? await normalizeStripePayload(
            row.payload as {
              type: string;
              data: { object: Record<string, unknown> };
            },
          )
        : [];
    await db.transaction(async (tx) => {
      for (const { ev, partial } of normalized)
        await applyNormalizedEvent(tx, ev, { partial });
      await tx
        .update(webhookEvents)
        .set({ processedAt: new Date(), error: null })
        .where(eq(webhookEvents.id, id));
    });
    return "processed";
  } catch (e) {
    await db
      .update(webhookEvents)
      .set({ error: String((e as Error)?.message ?? e).slice(0, 500) })
      .where(eq(webhookEvents.id, id));
    return "failed";
  }
}
