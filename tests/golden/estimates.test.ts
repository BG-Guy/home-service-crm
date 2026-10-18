// Golden tests for estimate rules (SPEC M07): option totals with add-ons, the
// headline total, option labels, cooling-off, the signed snapshot hash and close
// rate.
import { describe, expect, it } from "vitest";
import { complianceNotes } from "@/features/estimates/compliance";
import {
  buildEstimateSnapshot,
  canApproveEstimate,
  closeRate,
  coolingOffApplies,
  coolingOffDeadline,
  headlineTotal,
  isEstimateOpen,
  MAX_ESTIMATE_OPTIONS,
  nextOptionLabel,
  optionTotals,
} from "@/features/estimates/logic";
import { settingsShape } from "@/features/estimates/settings";
import { sha256Json } from "@/lib/hash";

const L = (
  id: string,
  totalCents: number,
  o: Partial<{
    taxable: boolean;
    isOptional: boolean;
    isSelected: boolean;
    type: "service" | "part" | "discount";
  }> = {},
) => ({
  id,
  type: o.type ?? "part",
  totalCents,
  taxable: o.taxable ?? true,
  isOptional: o.isOptional ?? false,
  isSelected: o.isSelected ?? true,
});

describe("option totals", () => {
  const lines = [
    L("svc", 18500, { type: "service", taxable: false }),
    L("spring", 28000),
    L("remote", 4500, { isOptional: true, isSelected: false }),
    L("disc", -2000, { type: "discount", taxable: false }),
  ];
  it("required lines only by default (unselected add-on excluded)", () => {
    // 18500 + 28000 = 46500 subtotal; tax 8.25% of 28000 = 2310; − 2000 discount
    expect(optionTotals(lines, 825)).toEqual({
      subtotalCents: 46500,
      discountCents: 2000,
      taxCents: 2310,
      totalCents: 46810,
    });
  });
  it("adds a chosen add-on with its own per-line tax (half away)", () => {
    // + 4500, tax 371.25 → 371
    expect(
      optionTotals(lines, 825, { selectedAddonIds: ["remote"] }).totalCents,
    ).toBe(46810 + 4500 + 371);
  });
  it("ignores ids that aren't add-ons of this option", () => {
    expect(
      optionTotals(lines, 825, { selectedAddonIds: ["nope"] }).totalCents,
    ).toBe(46810);
  });
  it("tax-exempt customers pay no tax", () => {
    expect(optionTotals(lines, 825, { taxExempt: true }).taxCents).toBe(0);
  });
});

describe("headline total", () => {
  it("is the recommended option", () => {
    expect(
      headlineTotal([
        { recommended: false, totalCents: 100 },
        { recommended: true, totalCents: 50 },
        { recommended: false, totalCents: 300 },
      ]),
    ).toBe(50);
  });
  it("else the highest option", () => {
    expect(
      headlineTotal([
        { recommended: false, totalCents: 100 },
        { recommended: false, totalCents: 300 },
      ]),
    ).toBe(300);
    expect(headlineTotal([])).toBe(0);
  });
  it("is the approved option once the customer chose one (QA T2-06)", () => {
    expect(
      headlineTotal([
        { recommended: true, totalCents: 50 },
        { recommended: false, totalCents: 300, approved: true },
        { recommended: false, totalCents: 900 },
      ]),
    ).toBe(300);
  });
});

describe("option labels (1–3 options, one recommended)", () => {
  const defaults = settingsShape.estimates.parse({}).option_labels;
  it("default to Option 1 / 2 / 3, at most 3 options", () => {
    expect(defaults).toEqual(["Option 1", "Option 2", "Option 3"]);
    expect(MAX_ESTIMATE_OPTIONS).toBe(3);
  });
  it("a new option takes the label for its position", () => {
    expect(nextOptionLabel(defaults, [])).toBe("Option 1");
    expect(nextOptionLabel(defaults, ["Option 1"])).toBe("Option 2");
    expect(nextOptionLabel(defaults, ["Option 1", "Option 2"])).toBe(
      "Option 3",
    );
  });
  it("stored labels win; older estimates keep their own", () => {
    const gbb = ["Good", "Better", "Best"];
    expect(nextOptionLabel(gbb, ["Good"])).toBe("Better");
    // An older "Good" estimate gets a second option under the new defaults.
    expect(nextOptionLabel(defaults, ["Good"])).toBe("Option 2");
  });
  it("falls back to an unused label, then to an unused Option N", () => {
    // "Option 1" was deleted: the position's label is taken, the free one is used.
    expect(nextOptionLabel(defaults, ["Option 2"])).toBe("Option 1");
    expect(nextOptionLabel(["Repair"], ["Repair"])).toBe("Option 2");
    expect(nextOptionLabel([], ["Option 2", "Custom"])).toBe("Option 3");
    expect(nextOptionLabel(["", "Replace"], [])).toBe("Replace");
  });
});

describe("status rules", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it("open = draft, sent, viewed", () => {
    expect(["draft", "sent", "viewed"].every(isEstimateOpen)).toBe(true);
    expect(["approved", "declined", "expired"].some(isEstimateOpen)).toBe(
      false,
    );
  });
  it("can't approve past the expiry even before the cron flips it", () => {
    expect(
      canApproveEstimate(
        { status: "sent", expiresAt: new Date("2026-10-16T00:00:00Z") },
        now,
      ),
    ).toBe(true);
    expect(
      canApproveEstimate(
        { status: "viewed", expiresAt: new Date("2026-10-15T11:59:00Z") },
        now,
      ),
    ).toBe(false);
    expect(
      canApproveEstimate({ status: "approved", expiresAt: null }, now),
    ).toBe(false);
  });
});

describe("FTC cooling-off ⚖️", () => {
  const base = {
    totalCents: 2500,
    atHome: true,
    serviceTypeUpsellCovered: false,
    hasUpsellLines: true,
  };
  it("applies to home sales of $25+ beyond the requested repair", () => {
    expect(coolingOffApplies(base)).toBe(true);
    expect(
      coolingOffApplies({
        ...base,
        hasUpsellLines: false,
        serviceTypeUpsellCovered: true,
      }),
    ).toBe(true);
  });
  it("not under $25, not away from home, not for the requested repair alone", () => {
    expect(coolingOffApplies({ ...base, totalCents: 2499 })).toBe(false);
    expect(coolingOffApplies({ ...base, atHome: false })).toBe(false);
    expect(coolingOffApplies({ ...base, hasUpsellLines: false })).toBe(false);
  });
  it("deadline is the third business day (Sundays skipped)", () => {
    // Fri Oct 16 2026 → Sat 17, (Sun 18 skipped), Mon 19, Tue 20
    expect(
      coolingOffDeadline(new Date("2026-10-16T15:00:00Z"))
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-20");
  });
});

describe("signed snapshot", () => {
  const input = {
    estimate: {
      id: "e1",
      number: "EST-1001",
      title: "Spring",
      customerId: "c1",
      jobId: "j1",
      expiresAt: new Date("2026-11-14T05:00:00Z"),
      notes: null,
      warrantyText: null,
    },
    option: { id: "o2", label: "Better" },
    lines: [
      {
        id: "b",
        sort: 1,
        type: "part",
        name: "Spring",
        description: null,
        qty: "2.000",
        unitPriceCents: 14000,
        discountCents: 0,
        totalCents: 28000,
        taxable: true,
        isOptional: false,
      },
      {
        id: "a",
        sort: 0,
        type: "service",
        name: "Labor",
        description: null,
        qty: 1,
        unitPriceCents: 18500,
        discountCents: 0,
        totalCents: 18500,
        taxable: false,
        isOptional: false,
      },
      {
        id: "x",
        sort: 2,
        type: "part",
        name: "Remote",
        description: null,
        qty: 1,
        unitPriceCents: 4500,
        discountCents: 0,
        totalCents: 4500,
        taxable: true,
        isOptional: true,
      },
    ],
    selectedAddonIds: [] as string[],
    totals: {
      subtotalCents: 46500,
      discountCents: 0,
      taxCents: 2310,
      totalCents: 48810,
    },
    policies: [
      { id: "p2", kind: "warranty", version: 3, sha256: "bb" },
      { id: "p1", kind: "deposit", version: 1, sha256: "aa" },
    ],
    depositCents: null,
  };
  it("keeps only required lines + chosen add-ons, in sort order", () => {
    const s = buildEstimateSnapshot(input);
    expect(s.lines.map((l) => l.id)).toEqual(["a", "b"]);
    expect(
      buildEstimateSnapshot({ ...input, selectedAddonIds: ["x"] }).lines.map(
        (l) => l.id,
      ),
    ).toEqual(["a", "b", "x"]);
    expect(s.lines[1]?.qty).toBe(2);
  });
  it("hash is stable regardless of input order", () => {
    const h1 = sha256Json(buildEstimateSnapshot(input));
    const h2 = sha256Json(
      buildEstimateSnapshot({
        ...input,
        lines: [...input.lines].reverse(),
        policies: [...input.policies].reverse(),
      }),
    );
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
  it("any change in what was agreed changes the hash", () => {
    const h1 = sha256Json(buildEstimateSnapshot(input));
    const h2 = sha256Json(
      buildEstimateSnapshot({
        ...input,
        totals: { ...input.totals, totalCents: 48811 },
      }),
    );
    expect(h1).not.toBe(h2);
  });
});

describe("close rate", () => {
  it("approved ÷ decided, one decimal", () => {
    expect(closeRate({ approved: 2, declined: 1, expired: 0 })).toBe(66.7);
    expect(closeRate({ approved: 0, declined: 0, expired: 0 })).toBeNull();
  });
});

describe("compliance notes ⚖️", () => {
  it("only for improvement work when enabled", () => {
    expect(
      complianceNotes({ contractKind: "repair", state: "CA", enabled: true }),
    ).toEqual([]);
    expect(
      complianceNotes({
        contractKind: "improvement",
        state: "CA",
        enabled: false,
      }),
    ).toEqual([]);
    expect(
      complianceNotes({
        contractKind: "improvement",
        state: "ca",
        enabled: true,
      })[0]?.title,
    ).toMatch(/California/);
    expect(
      complianceNotes({
        contractKind: "improvement",
        state: "TX",
        enabled: true,
      })[0]?.title,
    ).toBe("Home-improvement contract");
  });
});
