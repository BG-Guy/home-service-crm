// The job's money rail (Quote to Paid, part J1): five stages, the current color,
// the summary and the one next step, for every case the money card meets.
import { describe, expect, it } from "vitest";
import {
  type MoneyEstimate,
  type MoneyFacts,
  type MoneyInvoice,
  type MoneyStage,
  moneyStage,
} from "@/features/jobs/money-stage";

const TZ = "America/Denver";
// 4:00 PM in Denver; the estimate was signed at 2:41 PM the same day.
const NOW = new Date("2026-10-24T22:00:00Z");
const SIGNED = "2026-10-24T20:41:00Z";

const base: MoneyFacts = {
  jobStatus: "in_progress",
  paymentStatus: "none",
  estimatesOn: true,
  customerFirstName: "Sophia",
  estimates: [],
  deposit: null,
  invoice: null,
  paidCents: 0,
  depositPaidCents: 0,
};

const est = (o: Partial<MoneyEstimate> = {}): MoneyEstimate => ({
  id: "e1",
  number: "E-1026",
  status: "draft",
  hasLines: true,
  optionCount: 3,
  totalCents: 45073,
  fromCents: 31036,
  approvedLabel: null,
  recommendedLabel: "Better",
  createdAt: "2026-10-24T19:00:00Z",
  ...o,
});
const approvedEst = (o: Partial<MoneyEstimate> = {}) =>
  est({
    status: "approved",
    approvedLabel: "Better",
    approvedAt: SIGNED,
    ...o,
  });
const inv = (o: Partial<MoneyInvoice> = {}): MoneyInvoice => ({
  id: "i1",
  number: "INV-1067",
  status: "draft",
  totalCents: 45073,
  balanceCents: 45073,
  hasLines: true,
  ...o,
});

const run = (o: Partial<MoneyFacts>) =>
  moneyStage({ ...base, ...o }, { tz: TZ, now: NOW });
const rail = (s: MoneyStage) => s.steps.map((x) => x.state).join(" ");

describe("money stage: estimate and present", () => {
  it("no estimate: create one (violet), no deposit rule skips Deposit", () => {
    const s = run({ jobStatus: "scheduled" });
    expect(rail(s)).toBe("now todo skipped todo todo");
    expect(s.current).toBe("estimate");
    expect(s.color).toBe("estimate");
    expect(s.summary).toBe("No estimate yet");
    expect(s.next).toEqual({
      kind: "create_estimate",
      label: "Create estimate",
    });
    expect(s.badge).toBeNull();
  });

  it("a draft with no lines: finish it", () => {
    const s = run({ estimates: [est({ hasLines: false })] });
    expect(rail(s)).toBe("now todo skipped todo todo");
    expect(s.summary).toBe("E-1026 has no items yet");
    expect(s.next).toEqual({
      kind: "finish_estimate",
      label: "Finish estimate",
      estimateId: "e1",
    });
  });

  it("a draft with lines: present to the customer by first name", () => {
    const s = run({ estimates: [est()] });
    expect(rail(s)).toBe("done now skipped todo todo");
    expect(s.color).toBe("estimate");
    expect(s.summary).toBe("E-1026 · 3 options");
    expect(s.detail).toBe("From $310.36 · Better recommended");
    expect(s.next).toEqual({
      kind: "present",
      label: "Present to Sophia",
      estimateId: "e1",
    });
    expect(s.badge).toBe("Estimate ready");
  });

  it("a sent or viewed estimate: still present it, and say when it was opened", () => {
    const sent = run({
      estimates: [
        est({ status: "sent", optionCount: 1, sentAt: "2026-10-21T15:00:00Z" }),
      ],
    });
    expect(sent.summary).toBe("E-1026 · $450.73");
    expect(sent.detail).toBe("Sent Oct 21");
    expect(sent.next?.kind).toBe("present");
    expect(sent.badge).toBe("Estimate sent");
    const viewed = run({
      estimates: [est({ status: "viewed", viewedAt: SIGNED })],
    });
    // Two facts at most (fits a phone): opened first, then the price.
    expect(viewed.detail).toBe("Viewed 2:41 PM · from $310.36");
    expect(viewed.badge).toBe("Estimate viewed");
  });

  it("no first name: present to the customer", () => {
    const s = run({ customerFirstName: null, estimates: [est()] });
    expect(s.next?.label).toBe("Present to customer");
  });

  it("declined, expired and superseded estimates are closed: start a new one", () => {
    const s = run({
      jobStatus: "arrived",
      estimates: [est({ status: "declined", id: "e0", number: "E-1020" })],
    });
    expect(rail(s)).toBe("now todo skipped todo todo");
    expect(s.summary).toBe("E-1020 declined");
    expect(s.next?.kind).toBe("create_estimate");
    // An approved estimate drives the rail; the one it replaced is ignored.
    const t = run({
      estimates: [
        est({ status: "superseded", id: "e0", number: "E-1020" }),
        approvedEst(),
      ],
      invoice: inv(),
    });
    expect(t.current).toBe("invoice");
    expect(t.summary).toBe("Approved · $450.73");
  });

  it("the lead's quoted price alone doesn't make a quick job", () => {
    const s = run({
      jobStatus: "arrived",
      invoice: inv({ hasLines: false, totalCents: 15000, balanceCents: 15000 }),
    });
    expect(s.current).toBe("estimate");
    expect(s.next?.kind).toBe("create_estimate");
  });
});

describe("money stage: deposit and invoice", () => {
  it("approved with an open deposit: collect it (blue)", () => {
    const s = run({
      jobStatus: "arrived",
      estimates: [approvedEst()],
      deposit: { amountCents: 9000, status: "required" },
      invoice: inv(),
    });
    expect(rail(s)).toBe("done done now todo todo");
    expect(s.color).toBe("invoice");
    expect(s.summary).toBe("Approved · $450.73");
    expect(s.detail).toBe("Better · signed 2:41 PM");
    expect(s.next).toEqual({
      kind: "collect_deposit",
      label: "Collect $90 deposit",
      amountCents: 9000,
    });
    expect(s.badge).toBe("Deposit due");
  });

  it("keeps the cents of an uneven deposit", () => {
    const s = run({
      estimates: [approvedEst()],
      deposit: { amountCents: 9050, status: "requested" },
    });
    expect(s.next?.label).toBe("Collect $90.50 deposit");
  });

  it("approved and no deposit due: invoice now", () => {
    const s = run({ estimates: [approvedEst()], invoice: inv() });
    expect(rail(s)).toBe("done done skipped now todo");
    expect(s.color).toBe("invoice");
    expect(s.summary).toBe("Approved · $450.73");
    expect(s.next).toEqual({
      kind: "invoice_now",
      label: "Invoice now",
      invoiceId: "i1",
    });
    expect(s.badge).toBe("Approved");
  });

  it("deposit paid: what's left, while the work is in progress", () => {
    const s = run({
      estimates: [approvedEst()],
      deposit: { amountCents: 9000, status: "paid" },
      invoice: inv(),
      paymentStatus: "deposit_paid",
      paidCents: 9000,
      depositPaidCents: 9000,
    });
    expect(rail(s)).toBe("done done done now todo");
    expect(s.summary).toBe("$90 deposit paid");
    expect(s.detail).toBe("Work in progress · $360.73 left");
    expect(s.next?.kind).toBe("invoice_now");
    expect(s.badge).toBe("Deposit paid");
  });

  it("a deposit still open when the work is done is skipped: bill the balance", () => {
    const s = run({
      jobStatus: "completed",
      estimates: [approvedEst()],
      deposit: { amountCents: 9000, status: "required" },
      invoice: inv(),
    });
    expect(rail(s)).toBe("done done skipped now todo");
    expect(s.next?.kind).toBe("invoice_now");
  });

  it("no invoice yet: invoice now opens the job's invoice tab", () => {
    const s = run({ estimatesOn: false });
    expect(rail(s)).toBe("skipped skipped skipped now todo");
    expect(s.summary).toBe("Nothing billed yet");
    expect(s.next).toEqual({
      kind: "invoice_now",
      label: "Invoice now",
      invoiceId: null,
    });
  });
});

describe("money stage: get paid", () => {
  it("an issued invoice with a balance: get paid", () => {
    const s = run({
      jobStatus: "completed",
      estimates: [approvedEst()],
      deposit: { amountCents: 9000, status: "applied" },
      invoice: inv({ status: "partially_paid", balanceCents: 36073 }),
      paymentStatus: "deposit_paid",
      paidCents: 9000,
      depositPaidCents: 9000,
    });
    expect(rail(s)).toBe("done done done done now");
    expect(s.color).toBe("invoice");
    expect(s.summary).toBe("INV-1067 · $360.73 due");
    expect(s.detail).toBe("$90.00 paid of $450.73");
    expect(s.next).toEqual({
      kind: "get_paid",
      label: "Get paid",
      invoiceId: "i1",
    });
    expect(s.badge).toBe("$360.73 due");
  });

  it("paid in full: green, send the receipt", () => {
    const s = run({
      jobStatus: "completed",
      estimates: [approvedEst()],
      deposit: { amountCents: 9000, status: "applied" },
      invoice: inv({ status: "paid", balanceCents: 0 }),
      paymentStatus: "paid",
      paidCents: 45073,
      depositPaidCents: 9000,
      tipCents: 5411,
    });
    expect(rail(s)).toBe("done done done done done");
    expect(s.current).toBe("paid");
    expect(s.color).toBe("paid");
    expect(s.summary).toBe("Paid in full · $450.73");
    expect(s.detail).toBe("INV-1067 · tip $54.11");
    expect(s.next).toEqual({
      kind: "send_receipt",
      label: "Send receipt",
      invoiceId: "i1",
    });
    expect(s.badge).toBe("Paid");
  });

  it("an estimate never presented is skipped once the job is billed", () => {
    const s = run({
      jobStatus: "completed",
      estimates: [est({ status: "sent" })],
      invoice: inv({ status: "issued" }),
    });
    // Built (done), never presented or approved (skipped), billed anyway.
    expect(rail(s)).toBe("done skipped skipped done now");
    expect(s.next?.kind).toBe("get_paid");
  });

  it("a chargeback keeps the job blue and opens the invoice", () => {
    const s = run({
      jobStatus: "closed",
      estimates: [approvedEst()],
      invoice: inv({ status: "paid", balanceCents: 0 }),
      paymentStatus: "disputed",
      paidCents: 45073,
    });
    expect(s.current).toBe("paid");
    expect(s.color).toBe("invoice");
    expect(s.summary).toBe("Chargeback open");
    expect(s.next?.kind).toBe("open_invoice");
  });

  it("a no-charge job: nothing to collect or send", () => {
    const s = run({
      jobStatus: "completed",
      estimatesOn: false,
      invoice: inv({ status: "paid", totalCents: 0, balanceCents: 0 }),
      paymentStatus: "paid",
    });
    expect(s.color).toBe("paid");
    expect(s.summary).toBe("No charge");
    expect(s.next).toBeNull();
  });
});

describe("money stage: a lockout (no estimate, invoice built directly)", () => {
  const lockout: Partial<MoneyFacts> = {
    jobStatus: "in_progress",
    customerFirstName: "Marcus",
    invoice: inv({
      number: "INV-1071",
      totalCents: 12500,
      balanceCents: 12500,
    }),
  };

  it("skips Estimate, Present and Deposit and invoices now", () => {
    const s = run(lockout);
    expect(rail(s)).toBe("skipped skipped skipped now todo");
    expect(s.color).toBe("invoice");
    expect(s.summary).toBe("INV-1071 · $125.00");
    expect(s.detail).toBe("Draft, not sent yet");
    expect(s.next?.kind).toBe("invoice_now");
  });

  it("then gets paid, then sends the receipt", () => {
    const due = run({
      ...lockout,
      jobStatus: "completed",
      invoice: inv({
        number: "INV-1071",
        status: "issued",
        totalCents: 12500,
        balanceCents: 12500,
      }),
    });
    expect(rail(due)).toBe("skipped skipped skipped done now");
    expect(due.summary).toBe("INV-1071 · $125.00 due");
    expect(due.detail).toBe("Total $125.00");
    expect(due.next?.label).toBe("Get paid");
    const paid = run({
      ...lockout,
      jobStatus: "completed",
      invoice: inv({
        number: "INV-1071",
        status: "paid",
        totalCents: 12500,
        balanceCents: 0,
      }),
      paymentStatus: "paid",
      paidCents: 12500,
    });
    expect(rail(paid)).toBe("skipped skipped skipped done done");
    expect(paid.summary).toBe("Paid in full · $125.00");
    expect(paid.next?.label).toBe("Send receipt");
  });

  it("estimates switched off: the estimate stages are skipped from the start", () => {
    const s = run({ jobStatus: "scheduled", estimatesOn: false });
    expect(rail(s)).toBe("skipped skipped skipped now todo");
  });

  it("a cancelled job offers no next step", () => {
    const s = run({ jobStatus: "cancelled", estimates: [est()] });
    expect(s.next).toBeNull();
  });
});
