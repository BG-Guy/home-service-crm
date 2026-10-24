// Golden tests for estimate rules (SPEC M07): option totals with add-ons, the
// headline total, cooling-off, the signed snapshot hash and close rate.
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
  optionTotals,
  planInvoiceReplace,
  signedJobTotal,
} from "@/features/estimates/logic";
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

describe("status rules", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it("open = draft, sent, viewed", () => {
    expect(["draft", "sent", "viewed"].every(isEstimateOpen)).toBe(true);
    expect(
      ["approved", "declined", "expired", "superseded"].some(isEstimateOpen),
    ).toBe(false);
  });
  it("a replaced (superseded) estimate can't be signed", () => {
    expect(
      canApproveEstimate({ status: "superseded", expiresAt: null }, now),
    ).toBe(false);
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

describe("never bill twice: replacing the draft invoice's lines (E1)", () => {
  const D = (
    id: string,
    o: Partial<{
      type: string;
      name: string;
      pricebookItemId: string | null;
      isServiceFee: boolean;
      sourceType: string | null;
      partTied: boolean;
    }> = {},
  ) => ({
    id,
    type: o.type ?? "service",
    name: o.name ?? id,
    pricebookItemId: o.pricebookItemId ?? null,
    isServiceFee: o.isServiceFee ?? false,
    sourceType: o.sourceType ?? null,
    partTied: o.partTied ?? false,
  });
  const A = (
    name: string,
    type = "service",
    pricebookItemId = null as string | null,
  ) => ({
    name,
    type,
    pricebookItemId,
  });

  it("replaces the quote, earlier estimates, change orders and manual lines", () => {
    const plan = planInvoiceReplace(
      [
        D("quote", { sourceType: "lead_quote" }),
        D("old-est", { sourceType: "estimate" }),
        D("co", { sourceType: "change_order" }),
        D("manual", { sourceType: "manual" }),
        D("older", { sourceType: null }),
      ],
      [A("Rekey")],
    );
    expect(plan.remove.map((l) => l.id)).toEqual([
      "quote",
      "old-est",
      "co",
      "manual",
      "older",
    ]);
    expect(plan.keep).toEqual([]);
    expect(plan.add.map((a) => a.name)).toEqual(["Rekey"]);
  });

  it("keeps parts used on the job and fees; a kept part covers one approved line", () => {
    const plan = planInvoiceReplace(
      [
        D("stock", { type: "part", pricebookItemId: "pb-1", partTied: true }),
        D("flow", {
          type: "part",
          name: "Door reinforcer",
          sourceType: "part",
        }),
        D("fee", { isServiceFee: true }),
        D("labor", { type: "labor", name: "Install" }),
      ],
      [
        A("Grade 1 deadbolt", "part", "pb-1"),
        A("Grade 1 deadbolt", "part", "pb-1"),
        A("door reinforcer ", "part"),
        A("Install", "labor"),
      ],
    );
    expect(plan.keep.map((l) => l.id)).toEqual(["stock", "flow", "fee"]);
    expect(plan.remove.map((l) => l.id)).toEqual(["labor"]);
    // One deadbolt is covered by the stock line; the second one is added.
    expect(plan.covered.map((a) => a.name)).toEqual([
      "Grade 1 deadbolt",
      "door reinforcer ",
    ]);
    expect(plan.add.map((a) => a.name)).toEqual([
      "Grade 1 deadbolt",
      "Install",
    ]);
  });

  it("matches by price-book item when both have one, else by name and type", () => {
    const plan = planInvoiceReplace(
      [
        D("p", {
          type: "part",
          name: "Strike",
          pricebookItemId: "pb-9",
          partTied: true,
        }),
      ],
      [A("Strike", "part", "pb-2"), A("Strike", "material")],
    );
    expect(plan.covered).toEqual([]);
    expect(plan.add).toHaveLength(2);
  });
});

describe("signed job total (newest approved estimate + later change orders)", () => {
  const at = (iso: string) => new Date(iso);
  it("null without an approved estimate", () => {
    expect(
      signedJobTotal([], [{ signedAt: null, deltaCents: 5000 }]),
    ).toBeNull();
    expect(
      signedJobTotal(
        [{ approvedAt: at("2026-10-01T10:00:00Z"), totalCents: null }],
        [],
      ),
    ).toBeNull();
  });
  it("the newest estimate replaces the earlier ones (no sum)", () => {
    expect(
      signedJobTotal(
        [
          { approvedAt: at("2026-10-01T10:00:00Z"), totalCents: 11500 },
          { approvedAt: at("2026-10-02T10:00:00Z"), totalCents: 28400 },
        ],
        [],
      ),
    ).toBe(28400);
  });
  it("adds change orders signed after it; earlier ones were folded into it", () => {
    expect(
      signedJobTotal(
        [{ approvedAt: at("2026-10-02T10:00:00Z"), totalCents: 28400 }],
        [
          { signedAt: at("2026-10-01T12:00:00Z"), deltaCents: 4000 },
          { signedAt: at("2026-10-03T09:00:00Z"), deltaCents: 2500 },
        ],
      ),
    ).toBe(30900);
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
