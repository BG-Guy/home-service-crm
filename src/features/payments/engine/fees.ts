// Payment fee math (SPEC M09 fee policy, §10.2 fee split). PURE; tested in
// tests/payments/fees.test.ts. All amounts are integer cents; rates are basis points.
import { roundHalfAway } from "@/lib/money";

/** Split an ACTUAL processor fee between the base amount and the tip (§10.2 'actual'). */
export function splitActualFee(i: {
  amountCents: number;
  tipCents: number;
  feeCents: number;
}): { feeOnBaseCents: number; feeOnTipCents: number } {
  const gross = i.amountCents + i.tipCents;
  if (gross <= 0 || i.feeCents <= 0)
    return { feeOnBaseCents: Math.max(0, i.feeCents), feeOnTipCents: 0 };
  const feeOnBaseCents = roundHalfAway((i.feeCents * i.amountCents) / gross);
  return { feeOnBaseCents, feeOnTipCents: i.feeCents - feeOnBaseCents };
}

/**
 * ESTIMATED processor fee for a card charge whose actual fee isn't known yet (QA2: real
 * Stripe webhooks never carry the balance transaction). Rate on the gross charged plus
 * the fixed per-charge part, split base/tip like an actual fee. The `stripe_fee` worker
 * replaces it with the actual fee (and payroll recomputes on `payment.fee_updated`).
 */
export function estimatedCardFee(i: {
  amountCents: number;
  tipCents: number;
  /** What was charged (amount + tip + surcharge); defaults to amount + tip. */
  grossCents?: number;
  bps: number;
  fixedCents: number;
}): { feeCents: number; feeOnBaseCents: number; feeOnTipCents: number } {
  const gross = i.grossCents ?? i.amountCents + i.tipCents;
  if (gross <= 0) return { feeCents: 0, feeOnBaseCents: 0, feeOnTipCents: 0 };
  const feeCents =
    roundHalfAway((gross * Math.max(0, i.bps)) / 10_000) +
    Math.max(0, i.fixedCents);
  return {
    feeCents,
    ...splitActualFee({
      amountCents: i.amountCents,
      tipCents: i.tipCents,
      feeCents,
    }),
  };
}

/** CONFIGURED fee for a method (§10.2 'configured'): base and tip rounded separately. */
export function configuredFee(i: {
  amountCents: number;
  tipCents: number;
  bps: number;
}): { feeCents: number; feeOnBaseCents: number; feeOnTipCents: number } {
  if (!i.bps || i.bps <= 0)
    return { feeCents: 0, feeOnBaseCents: 0, feeOnTipCents: 0 };
  const feeOnBaseCents = roundHalfAway((i.amountCents * i.bps) / 10_000);
  const feeOnTipCents = roundHalfAway((i.tipCents * i.bps) / 10_000);
  return {
    feeCents: feeOnBaseCents + feeOnTipCents,
    feeOnBaseCents,
    feeOnTipCents,
  };
}

/** ⚖️ Surcharge cap by compliance state: blocked in CT and MA, 2 % in CO, 3 % elsewhere. */
export function surchargeCapBps(state: string | null | undefined): number {
  const s = (state ?? "").toUpperCase();
  if (s === "CT" || s === "MA") return 0;
  if (s === "CO") return 200;
  return 300;
}

export function surchargeBlocked(state: string | null | undefined): boolean {
  return surchargeCapBps(state) === 0;
}

/** The surcharge rate actually applied (configured rate, capped by state). */
export function effectiveSurchargeBps(
  configuredBps: number,
  state: string | null | undefined,
): number {
  return Math.max(0, Math.min(configuredBps || 0, surchargeCapBps(state)));
}

/**
 * Surcharge on a card charge. Credit cards only (debit/prepaid can't be surcharged);
 * `funding` unknown at link time ⇒ the caller decides (pay links show it as "up to").
 */
export function surchargeCents(i: {
  amountCents: number;
  configuredBps: number;
  state: string | null | undefined;
  funding?: "credit" | "debit" | "prepaid" | "unknown" | null;
}): number {
  if (i.funding && i.funding !== "credit" && i.funding !== "unknown") return 0;
  const bps = effectiveSurchargeBps(i.configuredBps, i.state);
  return bps ? roundHalfAway((i.amountCents * bps) / 10_000) : 0;
}

/** "Cash price" shown under the cash_discount policy (display only). */
export function cashPriceCents(cardPriceCents: number, discountBps: number) {
  if (!discountBps || discountBps <= 0) return cardPriceCents;
  return (
    cardPriceCents - roundHalfAway((cardPriceCents * discountBps) / 10_000)
  );
}

/**
 * Tip for a preset percentage. Tips are not calculated on fee lines (trip fee,
 * service-call fee) unless `tipOnFees` (SPEC M09 "Tips (none on fees by default)").
 */
export function tipForPreset(i: {
  amountCents: number;
  feeLinesCents: number;
  pct: number;
  tipOnFees?: boolean;
}): number {
  const base = i.tipOnFees
    ? i.amountCents
    : Math.max(0, i.amountCents - Math.max(0, i.feeLinesCents));
  return Math.max(0, roundHalfAway((base * i.pct) / 100));
}

/**
 * Derived invoice balance (mirrors the `invoice_balances` view): total − Σ succeeded
 * payments (non-tip) + Σ succeeded refunds − Σ credit notes. A LOST dispute is recorded
 * as a succeeded refund (reason 'dispute_lost'), so it re-opens the balance. Refunds
 * come off a payment's amount before its tip, so a payment's refunds count up to its
 * amount only (migration 0003; pass `id` / `paymentId` to apply the cap).
 */
export function invoiceBalanceCents(i: {
  totalCents: number;
  payments: { id?: string; amountCents: number; status: string }[];
  refunds: { paymentId?: string; amountCents: number; status: string }[];
  creditedCents?: number;
}): {
  paidCents: number;
  refundedCents: number;
  balanceCents: number;
} {
  const PAID = new Set([
    "succeeded",
    "partially_refunded",
    "refunded",
    "disputed",
  ]);
  const paidCents = i.payments
    .filter((p) => PAID.has(p.status))
    .reduce((s, p) => s + p.amountCents, 0);
  const byPayment = new Map<string, number>();
  let unlinked = 0;
  for (const r of i.refunds) {
    if (r.status !== "succeeded") continue;
    if (r.paymentId)
      byPayment.set(
        r.paymentId,
        (byPayment.get(r.paymentId) ?? 0) + r.amountCents,
      );
    else unlinked += r.amountCents;
  }
  let refundedCents = unlinked;
  for (const [pid, sum] of byPayment) {
    const p = i.payments.find((x) => x.id === pid);
    refundedCents += p ? Math.min(sum, p.amountCents) : sum;
  }
  return {
    paidCents,
    refundedCents,
    balanceCents:
      i.totalCents - paidCents + refundedCents - (i.creditedCents ?? 0),
  };
}
