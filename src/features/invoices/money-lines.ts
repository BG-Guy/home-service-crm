// Invoice money lines (QA round 2). PURE and client-safe: the invoice detail, the job's
// invoice panel, print and the portal /i/[token] render these, and
// tests/golden/invoice-money-lines.test.ts pins them.
//
// Every line under "Total" moves the balance, so they always reconcile:
//   total − payments − credits + refunds = balance due   (the invoice_balances view)
// Payments count without their tip. Refunds come off a payment's amount first and off
// its tip only beyond it (lead decision T6-07, migration 0003), so a refund line shows
// only its invoice part; the tip part goes to a separate "Tips" block (tips paid and
// tips refunded) that never touches the balance.

export interface DocCredit {
  id: string;
  kind: "deposit" | "payment" | "tip_only" | "credit_note" | "refund";
  label: string;
  at: Date;
  /** Positive = reduces the balance; refunds are negative (add back). */
  amountCents: number;
  /** Payments: the tip paid on top. Refunds: the tip part refunded (positive). */
  tipCents: number;
  status: string;
  paymentId: string | null;
}

/** A line of the "Tips" block (not part of the invoice balance). */
export interface DocTipLine {
  id: string;
  label: string;
  /** Tip paid (+) or tip refunded (−). */
  cents: number;
}

export interface MoneyPaymentIn {
  id: string;
  kind: string;
  amountCents: number;
  tipCents: number;
  status: string;
  at: Date;
  /** Local day, e.g. "10/17" (the caller formats it in the company time zone). */
  day: string;
  /** "Visa ••4242", "Cash", "Check #1001"… */
  method: string;
}

export interface MoneyRefundIn {
  id: string;
  paymentId: string;
  amountCents: number;
  reason: string | null;
  at: Date;
  day: string;
}

export interface MoneyCreditNoteIn {
  id: string;
  number: string;
  reason: string;
  amountCents: number;
  at: Date;
}

/**
 * Split each refund into its invoice part and its tip part: per payment, in time
 * order, refunds use up the payment's amount first and the tip only after it.
 * Σ base parts of a payment = min(Σ its refunds, its amount), as in invoice_balances.
 */
export function splitRefunds(
  payments: readonly { id: string; amountCents: number }[],
  refunds: readonly {
    id: string;
    paymentId: string;
    amountCents: number;
    at: Date;
  }[],
): Map<string, { baseCents: number; tipCents: number }> {
  const out = new Map<string, { baseCents: number; tipCents: number }>();
  const used = new Map<string, number>();
  const ordered = [...refunds].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id),
  );
  for (const r of ordered) {
    const p = payments.find((x) => x.id === r.paymentId);
    const amount = Math.max(0, r.amountCents);
    if (!p) {
      out.set(r.id, { baseCents: amount, tipCents: 0 });
      continue;
    }
    const before = used.get(p.id) ?? 0;
    const baseCents = Math.min(amount, Math.max(0, p.amountCents - before));
    used.set(p.id, before + baseCents);
    out.set(r.id, { baseCents, tipCents: amount - baseCents });
  }
  return out;
}

/** Credits (balance lines, in time order) and the tips block of an invoice. */
export function buildInvoiceMoneyLines(i: {
  payments: readonly MoneyPaymentIn[];
  refunds: readonly MoneyRefundIn[];
  creditNotes: readonly MoneyCreditNoteIn[];
}): { credits: DocCredit[]; tips: DocTipLine[] } {
  const split = splitRefunds(i.payments, i.refunds);
  const credits: DocCredit[] = [
    ...i.payments.map((p) => ({
      id: p.id,
      kind: p.kind as DocCredit["kind"],
      label:
        p.kind === "deposit"
          ? `Deposit ${p.day}, ${p.method}`
          : `Payment ${p.day}, ${p.method}`,
      at: p.at,
      amountCents: p.amountCents,
      tipCents: p.tipCents,
      status: p.status,
      paymentId: p.id,
    })),
    ...i.refunds.map((r) => {
      const s = split.get(r.id) ?? { baseCents: r.amountCents, tipCents: 0 };
      return {
        id: r.id,
        kind: "refund" as const,
        label: `Refund ${r.day}${r.reason === "dispute_lost" ? " (dispute)" : ""}`,
        at: r.at,
        amountCents: -s.baseCents,
        tipCents: s.tipCents,
        status: "succeeded",
        paymentId: r.paymentId,
      };
    }),
    ...i.creditNotes.map((c) => ({
      id: c.id,
      kind: "credit_note" as const,
      label: `Credit ${c.number}: ${c.reason}`.slice(0, 120),
      at: c.at,
      amountCents: c.amountCents,
      tipCents: 0,
      status: "applied",
      paymentId: null,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const tips: DocTipLine[] = [
    ...i.payments
      .filter((p) => p.tipCents > 0)
      .map((p) => ({
        id: `tip:${p.id}`,
        label: `Tip ${p.day}, ${p.method}`,
        cents: p.tipCents,
        at: p.at,
      })),
    ...i.refunds
      .map((r) => ({ r, tip: split.get(r.id)?.tipCents ?? 0 }))
      .filter((x) => x.tip > 0)
      .map(({ r, tip }) => ({
        id: `tip:${r.id}`,
        label: `Tip refunded ${r.day}${r.reason === "dispute_lost" ? " (dispute)" : ""}`,
        cents: -tip,
        at: r.at,
      })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ id, label, cents }) => ({ id, label, cents }));
  return { credits, tips };
}

/** Rows under "Total": every one moves the balance (tip-only payments carry none). */
export function balanceRows(
  credits: readonly DocCredit[],
): { label: string; cents: number; muted: true }[] {
  return credits
    .filter(
      (c) =>
        c.kind !== "tip_only" && !(c.kind === "refund" && c.amountCents === 0),
    )
    .map((c) => ({ label: c.label, cents: -c.amountCents, muted: true }));
}

/** A row of an invoice's totals block. */
export interface TotalRow {
  label: string;
  cents: number;
  muted?: true;
  kind: "subtotal" | "discount" | "tax" | "total" | "balance";
}

/**
 * Every row of an invoice's totals block, from Subtotal down to the last balance
 * line (the grand "Balance due" is the caller's). One list for the invoice
 * document, the job's invoice panel and the public pay page /p, so they foot the
 * same way: subtotal − discount + tax = total, and total + Σ balance rows = the
 * balance due (payments and credits come off, refunds add back).
 */
export function invoiceTotalRows(
  inv: {
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
  },
  credits: readonly DocCredit[],
  opts: { taxExempt?: boolean } = {},
): TotalRow[] {
  return [
    { label: "Subtotal", cents: inv.subtotalCents, kind: "subtotal" },
    ...(inv.discountCents > 0
      ? [
          {
            label: "Discount",
            cents: -inv.discountCents,
            kind: "discount" as const,
          },
        ]
      : []),
    {
      label: opts.taxExempt ? "Tax (exempt)" : "Tax",
      cents: inv.taxCents,
      kind: "tax",
    },
    { label: "Total", cents: inv.totalCents, kind: "total" },
    ...balanceRows(credits).map((r) => ({ ...r, kind: "balance" as const })),
  ];
}
