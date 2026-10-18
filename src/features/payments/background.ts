import "server-only";
import { and, eq, gt, isNull, lt, lte, sql } from "drizzle-orm";
import { getPaymentProvider, type PaymentSnapshot } from "@/adapters/payments";
import { db, type Tx } from "@/db";
import {
  checkoutSessions,
  depositRequests,
  payments,
  refunds,
  tasks,
  webhookEvents,
} from "@/db/schema";
import { createTask } from "@/features/tasks/api";
import { writeActivity } from "@/lib/activity";
import { emit } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { SYSTEM_ACTOR } from "@/lib/types";
import {
  applyFetchedPayment,
  applyNormalizedEvent,
  processWebhookEvent,
} from "./provider-events";

// Background work for payments (cron hooks + queue workers). Provider calls always
// happen OUTSIDE a transaction (PGlite has one connection); results are applied in a
// short transaction afterwards.

type RawObj = Record<string, unknown>;
const rawOf = (r: unknown): RawObj =>
  r && typeof r === "object" ? (r as RawObj) : {};

/** `payments.webhook_retry`: reprocess stored webhook events that failed. */
export async function retryWebhooks(now: Date): Promise<number> {
  const rows = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        isNull(webhookEvents.processedAt),
        lt(webhookEvents.receivedAt, new Date(now.getTime() - 30_000)),
        gt(webhookEvents.receivedAt, new Date(now.getTime() - 3 * 86_400_000)),
      ),
    )
    .limit(25);
  let ok = 0;
  for (const r of rows)
    if ((await processWebhookEvent(r.id)) === "processed") ok++;
  return ok;
}

/** `payments.manual_unverified`: one alert per manual payment unverified past the window. */
export async function alertUnverified(now: Date): Promise<number> {
  const s = await getSettings();
  const days = s.payments.unverified_alert_days;
  const rows = await db
    .select({
      id: payments.id,
      at: payments.succeededAt,
      raw: payments.raw,
    })
    .from(payments)
    .where(
      and(
        eq(payments.provider, "manual"),
        isNull(payments.verifiedAt),
        eq(payments.status, "succeeded"),
        lt(payments.succeededAt, new Date(now.getTime() - days * 86_400_000)),
        sql`coalesce(${payments.raw}->>'unverified_alerted_at', '') = ''`,
      ),
    )
    .limit(200);
  for (const r of rows) {
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({
          raw: { ...rawOf(r.raw), unverified_alerted_at: now.toISOString() },
        })
        .where(eq(payments.id, r.id));
      await emit(
        tx,
        "payment.manual_unverified",
        { type: "payment", id: r.id },
        {
          payment_id: r.id,
          age_days: Math.floor(
            (now.getTime() - (r.at?.getTime() ?? now.getTime())) / 86_400_000,
          ),
        },
        { actor: SYSTEM_ACTOR },
      );
    });
  }
  return rows.length;
}

/** `deposits.hold_expiring`: alert 24 h before an auth hold expires. */
export async function alertExpiringHolds(now: Date): Promise<number> {
  const rows = await db
    .select({
      id: payments.id,
      raw: payments.raw,
      captureBefore: payments.captureBefore,
      depositId: payments.depositRequestId,
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, "authorized"),
        lte(payments.captureBefore, new Date(now.getTime() + 24 * 3_600_000)),
        gt(payments.captureBefore, now),
        sql`coalesce(${payments.raw}->>'hold_alerted_at', '') = ''`,
      ),
    )
    .limit(100);
  for (const r of rows) {
    if (!r.depositId || !r.captureBefore) continue;
    const depositId = r.depositId;
    const before = r.captureBefore;
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ raw: { ...rawOf(r.raw), hold_alerted_at: now.toISOString() } })
        .where(eq(payments.id, r.id));
      await emit(
        tx,
        "deposit.hold_expiring",
        { type: "deposit_request", id: depositId },
        {
          deposit_request_id: depositId,
          capture_before: before.toISOString(),
        },
        { actor: SYSTEM_ACTOR },
      );
    });
  }
  return rows.length;
}

/** `refunds.due`: promised refunds past their date → refund.due + a refund_due task. */
export async function promisedRefundsDue(now: Date): Promise<number> {
  const rows = await db
    .select({ r: refunds, p: payments })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(and(eq(refunds.status, "scheduled"), lte(refunds.dueAt, now)))
    .limit(100);
  let n = 0;
  for (const { r, p } of rows) {
    const [has] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.kind, "refund_due"),
          eq(tasks.entityType, "refund"),
          eq(tasks.entityId, r.id),
        ),
      )
      .limit(1);
    if (has) continue;
    n++;
    await db.transaction(async (tx) => {
      await createTask(
        tx,
        {
          kind: "refund_due",
          title: `Refund ${formatMoney(r.amountCents)} is due`,
          body: `Promised refund: ${r.reason}. Pay it back by the original method, then mark it refunded on Payments → Refunds.`,
          payload: { refund_id: r.id, payment_id: p.id },
          assigneeUserId: null,
          entity: { type: "refund", id: r.id },
          customerId: p.customerId,
          jobId: p.jobId,
          dueAt: r.dueAt,
        },
        SYSTEM_ACTOR,
      );
      await emit(
        tx,
        "refund.due",
        { type: "refund", id: r.id },
        {
          refund_id: r.id,
          payment_id: p.id,
          amount_cents: r.amountCents,
          invoice_id: p.invoiceId,
          job_id: p.jobId,
        },
        { actor: SYSTEM_ACTOR },
      );
      await writeActivity(tx, {
        entity: p.jobId
          ? { type: "job", id: p.jobId }
          : { type: "customer", id: p.customerId },
        customerId: p.customerId,
        jobId: p.jobId,
        kind: "refund.due",
        summary: `Promised refund ${formatMoney(r.amountCents)} is due`,
        data: { refund_id: r.id },
        actorUserId: null,
      });
    });
  }
  return n;
}

/** `checkout.expire`: expire open checkout sessions past their expiry. */
export async function expireCheckouts(now: Date): Promise<number> {
  const rows = await db
    .update(checkoutSessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(checkoutSessions.status, "open"),
        lt(checkoutSessions.expiresAt, now),
      ),
    )
    .returning({ id: checkoutSessions.id });
  return rows.length;
}

/**
 * `payments.capture_holds`: capture auth holds flagged at job completion and cancel
 * holds flagged at cancellation (provider call outside any transaction).
 */
export async function settleHolds(): Promise<number> {
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.status, "authorized"),
        sql`(${payments.raw}->>'capture_requested_at' is not null or ${payments.raw}->>'cancel_requested_at' is not null)`,
      ),
    )
    .limit(20);
  let n = 0;
  for (const p of rows) {
    if (!p.providerRef || p.provider === "manual") continue;
    const raw = rawOf(p.raw);
    const driver = getPaymentProvider(p.provider as "stripe");
    try {
      if (raw.cancel_requested_at) {
        await driver.cancelHold?.(p.providerRef);
        await db.transaction(async (tx) => {
          await tx
            .update(payments)
            .set({ status: "canceled", updatedAt: new Date() })
            .where(eq(payments.id, p.id));
          if (p.depositRequestId)
            await tx
              .update(depositRequests)
              .set({ status: "expired", updatedAt: new Date() })
              .where(eq(depositRequests.id, p.depositRequestId));
        });
      } else if (driver.capture) {
        const snap = await driver.capture(p.providerRef);
        await db.transaction((tx) =>
          applyNormalizedEvent(tx, {
            type: "payment.succeeded",
            payment: {
              ...snap,
              raw: { ...rawOf(snap.raw), metadata: rawOf(raw.metadata) },
            },
            invoiceId: p.invoiceId ?? undefined,
            depositRequestId: p.depositRequestId ?? undefined,
          }),
        );
      }
      n++;
    } catch (e) {
      await db
        .update(payments)
        .set({
          raw: {
            ...raw,
            hold_error: String((e as Error)?.message ?? e).slice(0, 300),
          },
        })
        .where(eq(payments.id, p.id));
    }
  }
  return n;
}

/** Flag the job's auth holds for capture (job.completed) or cancel (job.cancelled). */
export async function flagHolds(
  tx: Tx,
  jobId: string,
  op: "capture" | "cancel",
): Promise<number> {
  const rows = await tx
    .select({ id: payments.id, raw: payments.raw })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), eq(payments.status, "authorized")));
  const key = op === "capture" ? "capture_requested_at" : "cancel_requested_at";
  for (const r of rows) {
    const raw = rawOf(r.raw);
    if (raw[key]) continue;
    await tx
      .update(payments)
      .set({ raw: { ...raw, [key]: new Date().toISOString() } })
      .where(eq(payments.id, r.id));
  }
  return rows.length;
}

/**
 * Worker `stripe_fee`: fetch the actual processor fee AND the card snapshot for a card
 * payment (QA2: real webhooks carry the charge as an id, so neither arrives with them).
 * The provider call runs outside any transaction; the result is applied in a short one
 * that swaps the fee estimate for the actual fee, fills missing card fields and emits
 * `payment.fee_updated` when the fee changed (payroll recomputes commission).
 * Throws to retry while the processor hasn't settled the fee yet.
 */
export async function fetchStripeFee(paymentId: string): Promise<void> {
  const [p] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!p || !p.providerRef || p.provider !== "stripe") return;
  const needsCard = p.method === "card" && (!p.cardLast4 || !p.cardFingerprint);
  if (p.feeSource === "actual" && !needsCard) return;
  const driver = getPaymentProvider("stripe");
  if (driver.retrievePayment) {
    const snap = await driver.retrievePayment(p.providerRef);
    await db.transaction((tx) => applyFetchedPayment(tx, p.id, snap));
    if (snap.feeCents == null && p.feeSource !== "actual")
      throw new Error("The processor hasn't reported the fee yet");
    return;
  }
  // Older drivers: the fee only.
  if (!driver.fetchFee || p.feeSource === "actual") return;
  const fee = await driver.fetchFee(p.providerRef);
  await db.transaction((tx) =>
    applyFetchedPayment(tx, p.id, {
      ref: p.providerRef as string,
      status: "succeeded",
      amountCents: p.amountCents + p.tipCents,
      feeCents: fee,
      entryMode: p.entryMode as PaymentSnapshot["entryMode"],
    }),
  );
}
