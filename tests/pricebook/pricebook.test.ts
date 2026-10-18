// Price book: markup matrix and CSV round trip.
import { describe, expect, it } from "vitest";
import { parseCsv, rowsFromCsv, toCsv } from "@/features/pricebook/csv";
import {
  marginPct,
  markupPct,
  normalizeTiers,
  priceForCost,
  tierFor,
} from "@/features/pricebook/markup";

const tiers = [
  { lt: 1000, mult: 3 },
  { lt: 10000, mult: 2 },
  { lt: null, mult: 1.5 },
];

describe("markup matrix", () => {
  it("picks the first tier whose bound exceeds the cost", () => {
    expect(tierFor(tiers, 999)?.mult).toBe(3);
    expect(tierFor(tiers, 1000)?.mult).toBe(2);
    expect(tierFor(tiers, 50000)?.mult).toBe(1.5);
  });
  it("prices from cost, half away from zero", () => {
    expect(priceForCost(tiers, 333)).toBe(999);
    expect(priceForCost(tiers, 4501)).toBe(9002);
    expect(priceForCost(tiers, 10001)).toBe(15002); // 15001.5 → 15002
  });
  it("markup vs margin", () => {
    expect(markupPct(2000, 1000)).toBe(100);
    expect(marginPct(2000, 1000)).toBe(50);
    expect(markupPct(2000, null)).toBeNull();
  });
  it("normalizes to ascending bounds with one open tier", () => {
    const n = normalizeTiers([
      { lt: null, mult: 1.2 },
      { lt: 5000, mult: 2 },
      { lt: 1000, mult: 3 },
    ]);
    expect(n.map((t) => t.lt)).toEqual([1000, 5000, null]);
  });
});

describe("csv", () => {
  it("parses quotes, commas and newlines inside fields", () => {
    expect(parseCsv('a,"b,c","d ""q"""\n1,2,3\n')).toEqual([
      ["a", "b,c", 'd "q"'],
      ["1", "2", "3"],
    ]);
  });
  it("round-trips export → import", () => {
    const csv = toCsv([
      {
        sku: "SPR-1",
        name: 'Torsion spring, 7" "heavy"',
        kind: "part",
        category: "Garage",
        description: null,
        unitCostCents: 4500,
        unitPriceCents: 14000,
        taxable: true,
        isSpecialOrder: false,
        vendor: "DDM",
        warrantyDays: 365,
        manufacturerWarrantyMonths: null,
        active: true,
      } as never,
    ]);
    const res = rowsFromCsv(parseCsv(csv));
    expect(res.rows[0]?.name).toBe('Torsion spring, 7" "heavy"');
    expect(res.rows[0]?.unitPriceCents).toBe(14000);
    expect(res.rows[0]?.kind).toBe("part");
  });
});
