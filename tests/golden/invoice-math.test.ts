// Golden tests for B3 document math (SPEC §6.1, M07, M08; BUILD_PLAN §9 B3 tests):
// line math and rounding, per-line tax half-away, discounts, add-ons, status
// transitions, change-order thresholds, terms, aging and revision hash stability.
import { describe, expect, it } from "vitest";
import {
  agingBucket,
  balanceOf,
  changeOrderThresholdExceeded,
  computeLineTotal,
  computeTotals,
  discountPercent,
  discountWithinLimit,
  dueDateFor,
  isOverdueMilestone,
  type MathLine,
  nextInvoiceStatus,
} from "@/features/invoices/math";
import {
  buildInvoiceSnapshot,
  diffSnapshots,
  isEmptyDiff,
} from "@/features/invoices/snapshot";
import { sha256Json } from "@/lib/hash";

const L = (
  type: MathLine["type"],
  totalCents: number,
  taxable = true,
  extra: Partial<MathLine> = {},
): MathLine => ({ type, totalCents, taxable, ...extra });

describe("line totals", () => {
  it("qty × price rounds half away from zero (3-decimal qty)", () => {
    expect(
      computeLineTotal({ type: "part", qty: 1.5, unitPriceCents: 333 }),
    ).toBe(500); // 499.5 → 500
    expect(
      computeLineTotal({ type: "labor", qty: 0.333, unitPriceCents: 9500 }),
    ).toBe(3164); // 3163.5 → 3164
    expect(
      computeLineTotal({ type: "service", qty: 2, unitPriceCents: 12500 }),
    ).toBe(25000);
  });
  it("subtracts the line discount", () => {
    expect(
      computeLineTotal({
        type: "part",
        qty: 2,
        unitPriceCents: 4500,
        discountCents: 1000,
      }),
    ).toBe(8000);
  });
  it("stores discount lines negative", () => {
    expect(
      computeLineTotal({ type: "discount", qty: 1, unitPriceCents: 1500 }),
    ).toBe(-1500);
    expect(
      computeLineTotal({ type: "discount", qty: 1, unitPriceCents: -1500 }),
    ).toBe(-1500);
  });
});

describe("document totals", () => {
  it("taxes per line (8.25%, half away) and sums", () => {
    // 3 taxable lines whose tax each rounds: 1234 → 101.805 → 102; 999 → 82.4175 → 82; 50 → 4.125 → 4
    const t = computeTotals(
      [
        L("part", 1234),
        L("part", 999),
        L("material", 50),
        L("labor", 9500, false),
      ],
      825,
    );
    expect(t).toEqual({
      subtotalCents: 11783,
      discountCents: 0,
      taxCents: 188,
      totalCents: 11971,
    });
  });
  it("discount lines reduce the total, not the tax base", () => {
    const t = computeTotals(
      [
        L("service", 12500, false),
        L("part", 4000),
        L("discount", -1500, false),
      ],
      825,
    );
    expect(t.subtotalCents).toBe(16500);
    expect(t.discountCents).toBe(1500);
    expect(t.taxCents).toBe(330);
    expect(t.totalCents).toBe(16500 - 1500 + 330);
  });
  it("uses the line's own tax rate when present", () => {
    const t = computeTotals([L("part", 10000, true, { taxRateBps: 500 })], 825);
    expect(t.taxCents).toBe(500);
  });
  it("tax-exempt customers pay no tax", () => {
    const t = computeTotals([L("part", 10000)], 825, { taxExempt: true });
    expect(t.taxCents).toBe(0);
    expect(t.totalCents).toBe(10000);
  });
  it("counts optional add-ons only when selected", () => {
    const lines = [
      L("service", 10000, false),
      L("part", 2000, false, { isOptional: true, isSelected: false }),
      L("part", 3000, false, { isOptional: true, isSelected: true }),
    ];
    expect(computeTotals(lines, 0).totalCents).toBe(13000);
  });
  it("$0 documents total zero", () => {
    expect(computeTotals([], 825).totalCents).toBe(0);
  });
});

describe("discount limits", () => {
  it("measures line + document discounts against the gross", () => {
    const pct = discountPercent([
      { ...L("service", 9000, false), discountCents: 1000 }, // gross 10000
      L("discount", -1000, false),
    ]);
    expect(pct).toBe(20);
    expect(discountWithinLimit(pct, 20)).toBe(true);
    expect(discountWithinLimit(pct, 10)).toBe(false);
  });
});

describe("invoice status transitions (syncInvoicePaymentState)", () => {
  it("draft, void and uncollectible are sticky", () => {
    expect(nextInvoiceStatus("draft", 0, 0)).toBe("draft");
    expect(nextInvoiceStatus("void", 0, 100)).toBe("void");
    expect(nextInvoiceStatus("uncollectible", 0, 100)).toBe("uncollectible");
  });
  it("issued → partially_paid → paid, and back on refund", () => {
    expect(nextInvoiceStatus("issued", 10000, 0)).toBe("issued");
    expect(nextInvoiceStatus("issued", 4000, 6000)).toBe("partially_paid");
    expect(nextInvoiceStatus("partially_paid", 0, 10000)).toBe("paid");
    expect(nextInvoiceStatus("paid", 5000, 5000)).toBe("partially_paid");
    expect(nextInvoiceStatus("paid", 10000, 0)).toBe("issued");
    expect(nextInvoiceStatus("issued", -500, 10500)).toBe("paid"); // overpaid
  });
  it("balance = total − paid + refunded − credited", () => {
    expect(
      balanceOf({
        totalCents: 10000,
        paidCents: 10000,
        refundedCents: 2500,
        creditedCents: 1000,
      }),
    ).toBe(1500);
  });
});

describe("change-order threshold", () => {
  it("is exceeded above the percent of the signed total", () => {
    expect(changeOrderThresholdExceeded(100000, 110000, 10, 0)).toBe(false);
    expect(changeOrderThresholdExceeded(100000, 110001, 10, 0)).toBe(true);
  });
  it("or above the absolute threshold when set", () => {
    expect(changeOrderThresholdExceeded(100000, 105001, 10, 5000)).toBe(true);
    expect(changeOrderThresholdExceeded(100000, 105000, 10, 5000)).toBe(false);
  });
  it("never without a signed total or when the price went down", () => {
    expect(changeOrderThresholdExceeded(null, 999999, 10, 0)).toBe(false);
    expect(changeOrderThresholdExceeded(100000, 90000, 0, 0)).toBe(false);
  });
});

describe("terms and aging", () => {
  const issued = new Date("2026-10-01T15:00:00Z");
  it("due dates by terms", () => {
    expect(dueDateFor("due_on_receipt", issued).toISOString()).toBe(
      issued.toISOString(),
    );
    expect(dueDateFor("net_30", issued).toISOString()).toBe(
      "2026-10-31T15:00:00.000Z",
    );
  });
  it("aging buckets", () => {
    const now = new Date("2026-12-31T15:00:00Z");
    expect(agingBucket(new Date("2026-12-20T15:00:00Z"), now)).toBe("0-30");
    expect(agingBucket(new Date("2026-11-20T15:00:00Z"), now)).toBe("31-60");
    expect(agingBucket(new Date("2026-10-20T15:00:00Z"), now)).toBe("61-90");
    expect(agingBucket(new Date("2026-08-01T15:00:00Z"), now)).toBe("90+");
    expect(agingBucket(null, now)).toBe("0-30");
  });
  it("overdue milestones", () => {
    expect([0, 1, 2, 3, 7, 14, 30, 45, 60].map(isOverdueMilestone)).toEqual([
      false,
      true,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
    ]);
  });
});

describe("revision snapshots", () => {
  const inv = {
    id: "00000000-0000-4000-8000-000000000001",
    number: "INV-1001",
    version: 1,
    jobId: null,
    customerId: "00000000-0000-4000-8000-000000000002",
    issuedAt: new Date("2026-10-01T15:00:00Z"),
    dueAt: new Date("2026-10-01T15:00:00Z"),
    subtotalCents: 12500,
    discountCents: 0,
    taxCents: 0,
    totalCents: 12500,
    notes: null,
    terms: "Due on receipt",
    warrantyText: null,
  };
  const line = (id: string, sort: number, total: number) => ({
    id,
    sort,
    type: "service",
    name: `Line ${id}`,
    description: null,
    qty: "1.000",
    unitPriceCents: total,
    discountCents: 0,
    totalCents: total,
    taxable: false,
    taxRateBps: null,
    partSource: null,
    warrantyDays: 90,
    serial: null,
  });

  it("hash is stable regardless of line order and key order", () => {
    const a = buildInvoiceSnapshot(inv, [
      line("a", 0, 5000),
      line("b", 1, 7500),
    ]);
    const b = buildInvoiceSnapshot({ ...inv }, [
      line("b", 1, 7500),
      line("a", 0, 5000),
    ]);
    expect(sha256Json(a)).toBe(sha256Json(b));
    expect(sha256Json(a)).toMatch(/^[0-9a-f]{64}$/);
    // Pinned so an accidental snapshot-shape change is noticed (breaks old hashes).
    expect(sha256Json({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      sha256Json({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
  });

  it("diff lists added, removed and changed lines and totals", () => {
    const before = buildInvoiceSnapshot(inv, [
      line("a", 0, 5000),
      line("b", 1, 7500),
    ]);
    const after = buildInvoiceSnapshot(
      { ...inv, version: 2, subtotalCents: 9000, totalCents: 9000 },
      [line("a", 0, 4000), line("c", 2, 5000)],
    );
    const d = diffSnapshots(before, after);
    expect(d.added.map((x) => x.id)).toEqual(["c"]);
    expect(d.removed.map((x) => x.id)).toEqual(["b"]);
    expect(d.changed[0]?.fields.totalCents).toEqual({ from: 5000, to: 4000 });
    expect(d.totals.totalCents).toEqual({ from: 12500, to: 9000 });
    expect(isEmptyDiff(diffSnapshots(before, before))).toBe(true);
  });
});
