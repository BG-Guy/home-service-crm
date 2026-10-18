import { describe, expect, it } from "vitest";
import {
  allocateCents,
  applyBps,
  divRoundHalfAway,
  formatBps,
  formatMoney,
  lineTotalCents,
  parseMoneyToCents,
  percentToBps,
  roundHalfAway,
  sumCents,
  taxCents,
} from "@/lib/money";

describe("roundHalfAway", () => {
  it("rounds halves away from zero", () => {
    expect(roundHalfAway(0.5)).toBe(1);
    expect(roundHalfAway(1.5)).toBe(2);
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-0.5)).toBe(-1);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(2.4999)).toBe(2);
    expect(roundHalfAway(-2.4999)).toBe(-2);
    expect(roundHalfAway(0)).toBe(0);
  });
  it("absorbs binary floating noise", () => {
    expect(roundHalfAway(1.005 * 100)).toBe(101);
    expect(roundHalfAway(0.285 * 100)).toBe(29);
  });
  it("rejects non-finite input", () => {
    expect(() => roundHalfAway(Number.NaN)).toThrow();
  });
});

describe("divRoundHalfAway", () => {
  it("is exact for integers", () => {
    expect(divRoundHalfAway(5, 2)).toBe(3);
    expect(divRoundHalfAway(-5, 2)).toBe(-3);
    expect(divRoundHalfAway(5, -2)).toBe(-3);
    expect(divRoundHalfAway(4, 3)).toBe(1);
    expect(divRoundHalfAway(7, 7)).toBe(1);
    expect(() => divRoundHalfAway(1, 0)).toThrow();
  });
});

describe("bps math", () => {
  it("applies basis points", () => {
    expect(applyBps(10_000, 2500)).toBe(2500);
    expect(applyBps(12_345, 2500)).toBe(3086); // 3086.25
    expect(applyBps(12_346, 2500)).toBe(3087); // 3086.5 -> away
    expect(applyBps(-12_346, 2500)).toBe(-3087);
    expect(applyBps(19_999, 825)).toBe(1650); // 1649.9175
  });
  it("converts percent and formats", () => {
    expect(percentToBps(8.25)).toBe(825);
    expect(percentToBps(25)).toBe(2500);
    expect(formatBps(2500)).toBe("25%");
    expect(formatBps(825)).toBe("8.25%");
  });
  it("computes tax", () => {
    expect(taxCents(10_000, 825)).toBe(825);
    expect(taxCents(1_999, 825)).toBe(165); // 164.9175
  });
});

describe("line totals", () => {
  it("rounds qty × price half away from zero before discount", () => {
    expect(lineTotalCents(1, 12_500)).toBe(12_500);
    expect(lineTotalCents(1.5, 333)).toBe(500); // 499.5
    expect(lineTotalCents(0.333, 100)).toBe(33); // 33.3
    expect(lineTotalCents(2, 4_999, 500)).toBe(9_498);
    expect(lineTotalCents(1.005, 1_000)).toBe(1_005);
  });
});

describe("allocateCents", () => {
  it("sums exactly to the total", () => {
    const parts = allocateCents(10_001, [5000, 5000]);
    expect(parts).toEqual([5001, 5000]);
    expect(sumCents(parts)).toBe(10_001);
  });
  it("handles uneven weights and negatives", () => {
    const parts = allocateCents(100, [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocateCents(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocateCents(0, [7000, 3000])).toEqual([0, 0]);
  });
  it("rejects zero weights", () => {
    expect(() => allocateCents(100, [0, 0])).toThrow();
  });
});

describe("parseMoneyToCents", () => {
  it("parses common inputs", () => {
    expect(parseMoneyToCents("12")).toBe(1200);
    expect(parseMoneyToCents("12.3")).toBe(1230);
    expect(parseMoneyToCents("$1,234.56")).toBe(123_456);
    expect(parseMoneyToCents(".5")).toBe(50);
    expect(parseMoneyToCents("-3.10")).toBe(-310);
    expect(parseMoneyToCents("(3.10)")).toBe(-310);
    expect(parseMoneyToCents("12.345")).toBe(1235);
    expect(parseMoneyToCents("12.344")).toBe(1234);
  });
  it("strict: digits past cents are a typo, not rounding (QA T1-06)", () => {
    expect(parseMoneyToCents("12.345", { strict: true })).toBeNull();
    expect(parseMoneyToCents("0.005", { strict: true })).toBeNull();
    expect(parseMoneyToCents("12.34", { strict: true })).toBe(1234);
    expect(parseMoneyToCents("$1,234.5", { strict: true })).toBe(123_450);
    expect(parseMoneyToCents("12.", { strict: true })).toBe(1200);
  });
  it("rejects garbage", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1.2.3")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats with Intl", () => {
    expect(formatMoney(123_456)).toBe("$1,234.56");
    expect(formatMoney(-500)).toBe("-$5.00");
    expect(formatMoney(2500, { compactWhole: true })).toBe("$25");
    expect(formatMoney(2550, { compactWhole: true })).toBe("$25.50");
    expect(formatMoney(500, { signed: true })).toBe("+$5.00");
    expect(formatMoney(null)).toBe("$0.00");
  });
});
