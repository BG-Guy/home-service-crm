// ★ Golden tests: invoice / portal money lines reconcile (QA round 2, money fixer).
// Every line under "Total" moves the balance:
//   total − payments − credits + refunds = balance due (invoice_balances, 0003 cap)
// Payments are shown without their tip and refunds come off the amount before the tip,
// so a refund line shows only its invoice part; the tip part is listed under "Tips"
// (not part of the invoice). Evidence: INV-1032 and INV-1061 from the money verifier.
import { describe, expect, it } from "vitest";
import { computeTotals } from "@/features/invoices/math";
import {
  balanceRows,
  buildInvoiceMoneyLines,
  invoiceTotalRows,
  type MoneyCreditNoteIn,
  type MoneyPaymentIn,
  type MoneyRefundIn,
  splitRefunds,
} from "@/features/invoices/money-lines";
import { invoiceBalanceCents } from "@/features/payments/engine/fees";

const t = (min: number) => new Date(Date.UTC(2026, 9, 17, 15, min));

function pay(
  id: string,
  amount: number,
  tip: number,
  at: Date,
): MoneyPaymentIn {
  return {
    id,
    kind: "payment",
    amountCents: amount,
    tipCents: tip,
    status: "succeeded",
    at,
    day: "10/17",
    method: "Visa ••4242",
  };
}
function refund(
  id: string,
  paymentId: string,
  amount: number,
  at: Date,
  reason: string | null = null,
): MoneyRefundIn {
  return { id, paymentId, amountCents: amount, reason, at, day: "10/17" };
}

/** Lines + the view's balance; asserts the lines foot to it. */
function reconcile(i: {
  totalCents: number;
  payments: MoneyPaymentIn[];
  refunds: MoneyRefundIn[];
  creditNotes?: MoneyCreditNoteIn[];
}) {
  const lines = buildInvoiceMoneyLines({
    payments: i.payments,
    refunds: i.refunds,
    creditNotes: i.creditNotes ?? [],
  });
  const rows = balanceRows(lines.credits);
  const footed = i.totalCents + rows.reduce((a, r) => a + r.cents, 0);
  const view = invoiceBalanceCents({
    totalCents: i.totalCents,
    payments: i.payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      status: p.status,
    })),
    refunds: i.refunds.map((r) => ({
      paymentId: r.paymentId,
      amountCents: r.amountCents,
      status: "succeeded",
    })),
    creditedCents: (i.creditNotes ?? []).reduce((a, c) => a + c.amountCents, 0),
  });
  expect(footed).toBe(view.balanceCents);
  return {
    rows: rows.map((r) => [r.label, r.cents]),
    tips: lines.tips.map((x) => [x.label, x.cents]),
    balance: view.balanceCents,
  };
}

describe("INV-1032: $125 + $20 tip, $130 refunded", () => {
  it("before: Payment −125 · Refund +130 · Balance 125 (didn't foot); now Refund +125 and a tip line", () => {
    const r = reconcile({
      totalCents: 12500,
      payments: [pay("p", 12500, 2000, t(0))],
      refunds: [refund("r", "p", 13000, t(5))],
    });
    expect(r.rows).toEqual([
      ["Payment 10/17, Visa ••4242", -12500],
      ["Refund 10/17", 12500],
    ]);
    expect(r.balance).toBe(12500);
    expect(r.tips).toEqual([
      ["Tip 10/17, Visa ••4242", 2000],
      ["Tip refunded 10/17", -500],
    ]);
  });
});

describe("INV-1061: $125 + $10 tip, $30 partial refund (credit note), then $105", () => {
  it("before: −125 · credit −30 · refund 30 · refund 105 · Balance 95; now the second refund shows 95", () => {
    const r = reconcile({
      totalCents: 12500,
      payments: [pay("p", 12500, 1000, t(0))],
      refunds: [refund("r1", "p", 3000, t(5)), refund("r2", "p", 10500, t(9))],
      creditNotes: [
        {
          id: "cn",
          number: "CN-1002",
          reason: "Partial refund of $30.00",
          amountCents: 3000,
          at: t(6),
        },
      ],
    });
    expect(r.rows).toEqual([
      ["Payment 10/17, Visa ••4242", -12500],
      ["Refund 10/17", 3000],
      ["Credit CN-1002: Partial refund of $30.00", -3000],
      ["Refund 10/17", 9500],
    ]);
    expect(r.balance).toBe(9500);
    expect(r.tips).toEqual([
      ["Tip 10/17, Visa ••4242", 1000],
      ["Tip refunded 10/17", -1000],
    ]);
  });
});

describe("other shapes", () => {
  it("a lost dispute that includes the tip: refund (dispute) = the amount, tip apart", () => {
    const r = reconcile({
      totalCents: 15606,
      payments: [pay("p", 15606, 2000, t(0))],
      refunds: [refund("d", "p", 17606, t(30), "dispute_lost")],
    });
    expect(r.rows).toEqual([
      ["Payment 10/17, Visa ••4242", -15606],
      ["Refund 10/17 (dispute)", 15606],
    ]);
    expect(r.tips).toEqual([
      ["Tip 10/17, Visa ••4242", 2000],
      ["Tip refunded 10/17 (dispute)", -2000],
    ]);
  });

  it("a refund of only the tip after the amount: no balance line, a tip line", () => {
    const r = reconcile({
      totalCents: 10000,
      payments: [pay("p", 10000, 1500, t(0))],
      refunds: [refund("a", "p", 10000, t(3)), refund("b", "p", 1500, t(4))],
    });
    expect(r.rows).toEqual([
      ["Payment 10/17, Visa ••4242", -10000],
      ["Refund 10/17", 10000],
    ]);
    expect(r.tips.at(-1)).toEqual(["Tip refunded 10/17", -1500]);
  });

  it("two payments: each payment's refunds are capped at its own amount", () => {
    const r = reconcile({
      totalCents: 30000,
      payments: [pay("a", 10000, 0, t(0)), pay("b", 20000, 1000, t(1))],
      refunds: [refund("ra", "a", 4000, t(2)), refund("rb", "b", 21000, t(3))],
    });
    expect(r.balance).toBe(24000);
    expect(r.rows.slice(2)).toEqual([
      ["Refund 10/17", 4000],
      ["Refund 10/17", 20000],
    ]);
  });

  it("a tip-only payment shows only under Tips", () => {
    const tipOnly = {
      ...pay("t", 0, 800, t(2)),
      kind: "tip_only",
      method: "Cash",
    };
    const r = reconcile({
      totalCents: 5000,
      payments: [pay("p", 5000, 0, t(0)), tipOnly],
      refunds: [],
    });
    expect(r.rows).toEqual([["Payment 10/17, Visa ••4242", -5000]]);
    expect(r.tips).toEqual([["Tip 10/17, Cash", 800]]);
  });

  it("splitRefunds: refunds use the amount first, in time order", () => {
    const s = splitRefunds(
      [{ id: "p", amountCents: 12500 }],
      [
        { id: "late", paymentId: "p", amountCents: 10500, at: t(9) },
        { id: "early", paymentId: "p", amountCents: 3000, at: t(5) },
      ],
    );
    expect(s.get("early")).toEqual({ baseCents: 3000, tipCents: 0 });
    expect(s.get("late")).toEqual({ baseCents: 9500, tipCents: 1000 });
  });
});

// /p pay page (QA2 re-check): it showed the lines, "Total $334.54" and "$150.00
// already paid" over a $164.54 balance: no tax row and the $20 credit note was
// invisible, so it didn't add up for the customer. It now renders the invoice
// document's own totals rows (invoiceTotalRows), which foot to the balance.
describe("INV-1069 totals rows (pay page, invoice doc, job panel)", () => {
  const lines = [
    { type: "part" as const, totalCents: 24900, taxable: true }, // Smart deadbolt
    { type: "labor" as const, totalCents: 7500, taxable: false }, // Lock installation
    { type: "discount" as const, totalCents: -1000, taxable: false },
  ];
  const totals = computeTotals(lines, 825);
  const payments: MoneyPaymentIn[] = [
    { ...pay("chk", 10000, 0, t(0)), method: "Check #1042" },
    { ...pay("cash", 5000, 0, t(5)), method: "Cash" },
  ];
  const creditNotes: MoneyCreditNoteIn[] = [
    {
      id: "cn",
      number: "CN-1002",
      reason: "Goodwill for the delay",
      amountCents: 2000,
      at: t(10),
    },
  ];
  const { credits } = buildInvoiceMoneyLines({
    payments,
    refunds: [],
    creditNotes,
  });
  const rows = invoiceTotalRows(totals, credits);
  const view = invoiceBalanceCents({
    totalCents: totals.totalCents,
    payments: payments.map((p) => ({ ...p })),
    refunds: [],
    creditedCents: 2000,
  });

  it("shows subtotal, discount, tax, total, each payment and the credit", () => {
    expect(rows.map((r) => [r.kind, r.label, r.cents])).toEqual([
      ["subtotal", "Subtotal", 32400],
      ["discount", "Discount", -1000],
      ["tax", "Tax", 2054],
      ["total", "Total", 33454],
      ["balance", "Payment 10/17, Check #1042", -10000],
      ["balance", "Payment 10/17, Cash", -5000],
      ["balance", "Credit CN-1002: Goodwill for the delay", -2000],
    ]);
  });

  it("subtotal − discount + tax = total, and total + balance rows = balance due", () => {
    const by = (k: string) =>
      rows.filter((r) => r.kind === k).reduce((a, r) => a + r.cents, 0);
    expect(by("subtotal") + by("discount") + by("tax")).toBe(by("total"));
    // The same balance as the invoice_balances math (total − paid − credits).
    expect(by("total") + by("balance")).toBe(view.balanceCents);
    expect(view.balanceCents).toBe(16454);
  });

  it("a tax-exempt customer gets a zero 'Tax (exempt)' row", () => {
    const ex = computeTotals(lines, 825, { taxExempt: true });
    const r = invoiceTotalRows(ex, [], { taxExempt: true });
    expect(r.find((x) => x.kind === "tax")).toMatchObject({
      label: "Tax (exempt)",
      cents: 0,
    });
    expect(r.find((x) => x.kind === "total")?.cents).toBe(31400);
  });
});
