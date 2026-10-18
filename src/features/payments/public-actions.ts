"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPayments, hasCardProcessor } from "@/adapters/payments";
import { db } from "@/db";
import { checkoutSessions, payments } from "@/db/schema";
import { createTask } from "@/features/tasks/api";
import { actionFailure } from "@/lib/action";
import { writeActivity } from "@/lib/activity";
import { writeAudit } from "@/lib/audit";
import { requestMeta } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";
import { ConflictError, NotFoundError, RateLimitedError } from "@/lib/errors";
import { emit, processEventsSoon } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { rateLimit } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import { resolvePublicToken } from "@/lib/tokens";
import type { ActionResult, Actor } from "@/lib/types";
import { tipForPreset } from "./engine/fees";
import { loadPayTarget } from "./pay-page";

// Public (no session) payment actions: /p/[token] checkout and the receipt flag (S28).
// action() needs a signed-in user, so these mirror its steps: zod → rate limit →
// token re-validation (logged) → provider call OUTSIDE any transaction → one short
// transaction (rows + events + audit + activity).

const Token = z.string().min(32).max(128);

async function limit(scope: string) {
  const meta = await requestMeta();
  const rl = await rateLimit({
    key: `${scope}:${meta.ip ?? "unknown"}`,
    limit: 20,
    windowSec: 60,
    store: "memory",
  });
  if (!rl.ok) throw new RateLimitedError(rl.retryAfterSec);
  return meta;
}

/**
 * /p/[token] "Pay by card": creates a hosted Checkout Session (itemized lines,
 * service address as shipping, descriptor suffix = job #, metadata, 3DS when the job's
 * risk is High or Critical, 1 h expiry, idempotency key) and redirects to it.
 */
export async function startCheckout(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  let url: string;
  try {
    const token = Token.parse(form.get("token"));
    const tipPct = z.coerce
      .number()
      .min(0)
      .max(100)
      .catch(0)
      .parse(form.get("tipPct") ?? 0);
    const meta = await limit("pay");
    if (!hasCardProcessor())
      throw new ConflictError(
        "no_processor",
        "Card payments aren't available. Please use the instructions below.",
      );
    const tok = await resolvePublicToken("pay", token, {
      path: "/p/[token]",
      action: "pay_opened",
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    if (!tok) throw new NotFoundError("Link");
    const t = await loadPayTarget(tok);
    if (!t || t.state !== "due" || t.dueCents <= 0)
      throw new ConflictError("nothing_due", "There's nothing left to pay.");
    const s = await getSettings();
    const tip =
      t.kind === "invoice" && s.payments.tips_enabled && tipPct > 0
        ? tipForPreset({
            amountCents: t.dueCents,
            feeLinesCents: t.feeLinesCents,
            pct: tipPct,
            tipOnFees: s.payments.tip_on_fees,
          })
        : 0;
    const mode =
      t.kind === "deposit" && t.depositMode === "hold"
        ? ("hold" as const)
        : ("capture" as const);
    const provider = getPayments();
    if (!provider.createPayLink)
      throw new ConflictError("no_links", "Card links aren't supported.");
    const fullLines =
      t.lines.reduce((x, l) => x + l.totalCents, 0) === t.dueCents;
    const lines = [
      ...(fullLines
        ? t.lines
            .filter((l) => l.totalCents > 0)
            .map((l) => ({
              name: l.qty === 1 ? l.name : `${l.name} × ${l.qty}`,
              amountCents: l.totalCents,
              qty: 1,
            }))
        : [
            {
              name: `${t.title}: balance due`,
              amountCents: t.dueCents,
              qty: 1,
            },
          ]),
      ...(tip > 0
        ? [{ name: "Tip (thank you!)", amountCents: tip, qty: 1 }]
        : []),
    ];
    // Discounts/credits make itemized lines differ from the amount: fall back to one line.
    const sum = lines.reduce((x, l) => x + l.amountCents * l.qty, 0);
    const finalLines =
      sum === t.dueCents + tip
        ? lines
        : [
            { name: `${t.title}: amount due`, amountCents: t.dueCents, qty: 1 },
            ...(tip > 0
              ? [{ name: "Tip (thank you!)", amountCents: tip, qty: 1 }]
              : []),
          ];
    const link = await provider.createPayLink({
      invoiceId: t.invoiceId ?? undefined,
      depositRequestId: t.depositRequestId ?? undefined,
      lines: finalLines,
      amountCents: t.dueCents + tip,
      customer: {
        name: t.customer.name,
        email: t.customer.email ?? undefined,
        phone: t.customer.phone ?? undefined,
      },
      serviceAddress: t.address ?? {
        line1: "",
        city: "",
        state: "",
        postal_code: "",
      },
      descriptorSuffix: (t.jobNumber ?? t.title).replace(/[^A-Za-z0-9 -]/g, ""),
      mode,
      require3DS: t.riskBand === "high" || t.riskBand === "critical",
      allowTip: false,
      successUrl: appUrl(`/p/${token}?status=success`),
      cancelUrl: appUrl(`/p/${token}?status=cancel`),
      expiresInMinutes: s.payments.pay_link_expires_minutes,
      idempotencyKey: `checkout:${tok.id}:${t.dueCents}:${tip}:${Math.floor(Date.now() / 600_000)}`,
      metadata: {
        job_id: t.jobId ?? "",
        customer_id: t.customerId,
        tip_cents: String(tip),
        token_id: tok.id,
      },
    });
    const actor: Actor = {
      kind: "public_token",
      userId: null,
      tokenId: tok.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
    await db.transaction(async (tx) => {
      await tx
        .insert(checkoutSessions)
        .values({
          tokenId: tok.id,
          provider: provider.id,
          sessionRef: link.ref,
          invoiceId: t.invoiceId,
          depositRequestId: t.depositRequestId,
          amountCents: t.dueCents + tip,
          mode,
          expiresAt: link.expiresAt,
        })
        .onConflictDoNothing();
      await writeAudit(tx, {
        actor,
        action: "payment.checkout_started",
        entity: t.invoiceId
          ? { type: "invoice", id: t.invoiceId }
          : { type: "deposit_request", id: t.depositRequestId as string },
        after: { amount_cents: t.dueCents, tip_cents: tip, mode },
      });
    });
    url = link.url;
  } catch (e) {
    return actionFailure(e);
  }
  redirect(url);
}

const FlagSchema = z.object({
  token: Token,
  paymentId: z.string().uuid(),
  reason: z.enum(["wrong_amount", "not_me", "other"]),
  note: z.string().trim().max(1000).nullish(),
});

const REASON_LABEL = {
  wrong_amount: "Wrong amount",
  not_me: "I didn't make this payment",
  other: "Something else",
} as const;

/**
 * S28: "Wrong amount? / I didn't pay this" on the receipt (/i/[token]?receipt=).
 * Emits payment.customer_flagged and opens a callback task for the office — the fastest
 * way to stop a chargeback is a call back before the customer calls their bank.
 */
export async function flagReceipt(
  input: z.input<typeof FlagSchema>,
): Promise<ActionResult> {
  try {
    const i = FlagSchema.parse(input);
    const meta = await limit("receipt_flag");
    const tok = await resolvePublicToken("invoice", i.token, {
      path: "/i/[token]?receipt",
      action: "receipt_flagged",
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    if (!tok) throw new NotFoundError("Link");
    const [p] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, i.paymentId))
      .limit(1);
    const covered =
      !!p &&
      (p.invoiceId === tok.entityId ||
        (!!tok.jobId && p.jobId === tok.jobId) ||
        p.customerId === tok.customerId);
    if (!p || !covered) throw new NotFoundError("Payment");
    const actor: Actor = {
      kind: "public_token",
      userId: null,
      tokenId: tok.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
    const note = `${REASON_LABEL[i.reason]}${i.note ? `: ${i.note}` : ""}`;
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({
          raw: {
            ...((p.raw as Record<string, unknown> | null) ?? {}),
            customer_flagged_at: new Date().toISOString(),
            customer_flag: note,
          },
        })
        .where(eq(payments.id, p.id));
      await createTask(
        tx,
        {
          kind: "callback_customer",
          title: `Call back: customer flagged a ${formatMoney(p.amountCents + p.tipCents)} payment`,
          body: note,
          payload: { payment_id: p.id, reason: i.reason },
          assigneeUserId: null,
          entity: { type: "payment", id: p.id },
          customerId: p.customerId,
          jobId: p.jobId,
          dueAt: new Date(Date.now() + 4 * 3_600_000),
        },
        actor,
      );
      await emit(
        tx,
        "payment.customer_flagged",
        { type: "payment", id: p.id },
        { payment_id: p.id, customer_id: p.customerId, note },
        { actor },
      );
      await writeActivity(tx, {
        entity: p.jobId
          ? { type: "job", id: p.jobId }
          : { type: "customer", id: p.customerId },
        customerId: p.customerId,
        jobId: p.jobId,
        kind: "payment.customer_flagged",
        summary: `Customer flagged the receipt: ${REASON_LABEL[i.reason]}`,
        data: { payment_id: p.id },
        actorUserId: null,
      });
      await writeAudit(tx, {
        actor,
        action: "payment.customer_flagged",
        entity: { type: "payment", id: p.id },
        after: { reason: i.reason, note: i.note ?? null },
      });
    });
    await processEventsSoon();
    return { ok: true };
  } catch (e) {
    return actionFailure(e);
  }
}
