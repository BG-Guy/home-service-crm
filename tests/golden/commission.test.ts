// ★ Golden tests for the commission engine: SPEC §10.4 worked examples A–G, exactly,
// including both F variants (F-same-period, F-hold-earlier). Plan: 25% partner plan,
// card fee 3% configured, company absorbs the fee on tips.
import { describe, expect, it } from "vitest";
import {
  type CompPlan,
  chargebackPostings,
  closeOut,
  computeJob,
  type JobFinancialInputs,
  jobPostings,
  type Posting,
  resolvePlan,
  type SettlementEntry,
  summarizeEntries,
  type TechInput,
} from "@/features/payroll/engine";
import { floorCheck } from "@/features/payroll/engine/settle";

const plan: CompPlan = resolvePlan({
  deductions_before_split: {
    processing_fees: { pct_bps_by_method: { card: 300 } },
  },
});
const LOCKOUT = "svc-after-hours-lockout";

const tech1099: TechInput = {
  userId: "t1",
  workerType: "1099",
  overrides: { by_service_type: { [LOCKOUT]: 5000 } },
};
const techW2: TechInput = {
  userId: "t1",
  workerType: "w2",
  overrides: { by_service_type: { [LOCKOUT]: 5000 } },
};

const base = (over: Partial<JobFinancialInputs>): JobFinancialInputs => ({
  jobId: "j",
  revenueCents: 0,
  taxCents: 0,
  serviceTypeId: null,
  customRateBps: null,
  isCallback: false,
  payments: [],
  companyPartsCents: 0,
  techPartsByUser: {},
  assignees: [{ userId: "t1", splitBps: 10000, role: "primary" }],
  ...over,
});

const caseA = base({
  jobId: "A",
  revenueCents: 40000,
  payments: [
    {
      id: "pa",
      method: "card",
      amountCents: 40000,
      tipCents: 2000,
      feeCents: 0,
      collectedByUserId: "t1",
    },
  ],
  companyPartsCents: 4000,
  techPartsByUser: { t1: 2500 },
});
const caseB = base({
  jobId: "B",
  revenueCents: 30000,
  payments: [
    {
      id: "pb",
      method: "cash",
      amountCents: 30000,
      tipCents: 0,
      feeCents: 0,
      collectedByUserId: "t1",
    },
  ],
  techPartsByUser: { t1: 3000 },
});
const caseC = base({
  jobId: "C",
  revenueCents: 25000,
  serviceTypeId: LOCKOUT,
  payments: [
    {
      id: "pc",
      method: "card",
      amountCents: 25000,
      tipCents: 0,
      feeCents: 0,
      collectedByUserId: "t1",
    },
  ],
  techPartsByUser: { t1: 2000 },
});
const caseD = base({
  jobId: "D",
  revenueCents: 60000,
  payments: [
    {
      id: "pd",
      method: "card",
      amountCents: 60000,
      tipCents: 0,
      feeCents: 0,
      collectedByUserId: "t1",
    },
  ],
  companyPartsCents: 5000,
});

const toEntries = (ps: Posting[]): SettlementEntry[] =>
  ps.map((p) => ({
    type: p.type,
    amountCents: p.amountCents,
    wageClass: p.wageClass,
    pendingReview: p.needsReview ?? false,
  }));

describe("§10.4 worked examples", () => {
  it("A: card job with tip, company + tech parts", () => {
    const r = computeJob(caseA, plan, [tech1099]);
    expect(r.feesCents).toBe(1200);
    expect(r.feesOnTipsCents).toBe(60);
    expect(r.baseCents).toBe(32300);
    const e = r.earnings[0];
    expect(e?.commissionCents).toBe(8075);
    expect(e?.tipCents).toBe(2000);
    expect(e?.reimbursementCents).toBe(2500);
    expect(e?.netCents).toBe(12575);
    expect(r.companyNetCents).toBe(24165);
  });

  it("A: the trace reads like §10.5", () => {
    const r = computeJob(caseA, plan, [tech1099], {
      planLabel: "Partner 25 v1",
    });
    const t = r.earnings[0]?.trace ?? [];
    expect(t.map((s) => [s.step, s.amount_cents])).toEqual([
      ["revenue", 40000],
      ["company_parts", -4000],
      ["tech_parts", -2500],
      ["fees", -1200],
      ["base", 32300],
      ["rate", 0],
      ["commission", 8075],
      ["tip", 2000],
      ["reimbursement", 2500],
      ["net", 12575],
    ]);
    expect(t.find((s) => s.step === "fees")?.label).toBe(
      "Card processing fee (3%)",
    );
    expect(t.find((s) => s.step === "rate")?.label).toBe(
      "Your rate (25%, plan Partner 25 v1)",
    );
    expect(t.find((s) => s.step === "tech_parts")?.label).toBe(
      "Parts you bought",
    );
  });

  it("B: cash kept by a 1099 tech is netted", () => {
    const r = computeJob(caseB, plan, [tech1099]);
    const e = r.earnings[0];
    expect(r.baseCents).toBe(27000);
    expect(e?.commissionCents).toBe(6750);
    expect(e?.reimbursementCents).toBe(3000);
    expect(e?.cashHeldCents).toBe(30000);
    expect(e?.netCents).toBe(-20250);
  });

  it("C: tech × service-type override 50%", () => {
    const r = computeJob(caseC, plan, [tech1099]);
    const e = r.earnings[0];
    expect(r.baseCents).toBe(22250);
    expect(e?.rateBps).toBe(5000);
    expect(e?.rateSource).toBe("tech_service");
    expect(e?.commissionCents).toBe(11125);
    expect(e?.netCents).toBe(13125);
  });

  it("D: lost dispute claws back 133.00 (plus release of the hold if held)", () => {
    const r = computeJob(caseD, plan, [tech1099]);
    expect(r.feesCents).toBe(1800);
    expect(r.baseCents).toBe(53200);
    expect(r.earnings[0]?.commissionCents).toBe(13300);
    const earning = [
      {
        userId: "t1",
        commissionCents: 13300,
        spiffsCents: 0,
        workerType: "1099" as const,
      },
    ];

    const noHold = {
      ...plan,
      chargebacks: { ...plan.chargebacks, on_open: "none" as const },
    };
    expect(chargebackPostings(noHold, "open", earning, [], "D")).toEqual([]);
    const lostNoHold = chargebackPostings(noHold, "lost", earning, [], "D");
    expect(lostNoHold.map((p) => [p.type, p.amountCents])).toEqual([
      ["chargeback_clawback", -13300],
    ]);

    const open = chargebackPostings(plan, "open", earning, [], "D");
    expect(open.map((p) => [p.type, p.amountCents])).toEqual([
      ["chargeback_hold", -13300],
    ]);
    // Idempotent: the hold exists already.
    expect(
      chargebackPostings(
        plan,
        "open",
        earning,
        [{ userId: "t1", type: "chargeback_hold", amountCents: -13300 }],
        "D",
      ),
    ).toEqual([]);
    const lost = chargebackPostings(
      plan,
      "lost",
      earning,
      [{ userId: "t1", type: "chargeback_hold", amountCents: -13300 }],
      "D",
    );
    expect(lost.map((p) => [p.type, p.amountCents])).toEqual([
      ["chargeback_release", 13300],
      ["chargeback_clawback", -13300],
    ]);
    const won = chargebackPostings(
      plan,
      "won",
      earning,
      [{ userId: "t1", type: "chargeback_hold", amountCents: -13300 }],
      "D",
    );
    expect(won.map((p) => [p.type, p.amountCents])).toEqual([
      ["chargeback_release", 13300],
    ]);
  });

  it("E: 50/50 split, the last assignee absorbs rounding", () => {
    const r = computeJob(
      base({
        jobId: "E",
        revenueCents: 33333,
        payments: [
          {
            id: "pe",
            method: "card",
            amountCents: 33333,
            tipCents: 501,
            feeCents: 0,
            collectedByUserId: "t1",
          },
        ],
        assignees: [
          { userId: "t1", splitBps: 5000, role: "primary" },
          { userId: "t2", splitBps: 5000, role: "helper" },
        ],
      }),
      plan,
      [tech1099, { userId: "t2", workerType: "1099", overrides: {} }],
    );
    expect(r.feesCents).toBe(1000);
    expect(r.baseCents).toBe(32333);
    expect(r.commissionTotalCents).toBe(8083);
    const [a, b] = r.earnings;
    expect([a?.commissionCents, b?.commissionCents]).toEqual([4042, 4041]);
    expect([a?.tipCents, b?.tipCents]).toEqual([251, 250]);
    expect([a?.netCents, b?.netCents]).toEqual([4293, 4291]);
  });

  const weekPostings = (t: TechInput, dPhase: Posting[]) => [
    ...jobPostings(computeJob(caseA, plan, [t]), {
      earned: true,
      jobNumber: "A",
    }),
    ...jobPostings(computeJob(caseB, plan, [t]), {
      earned: true,
      jobNumber: "B",
    }),
    ...jobPostings(computeJob(caseC, plan, [t]), {
      earned: true,
      jobNumber: "C",
    }),
    ...dPhase,
  ];
  const dEarning = (w: "1099" | "w2") => [
    { userId: "t1", commissionCents: 13300, spiffsCents: 0, workerType: w },
  ];

  it("F: weekly 1099 (on_open none) → −118.50", () => {
    const noHold = {
      ...plan,
      chargebacks: { ...plan.chargebacks, on_open: "none" as const },
    };
    const d = chargebackPostings(noHold, "lost", dEarning("1099"), [], "D");
    const s = summarizeEntries(toEntries(weekPostings(tech1099, d)));
    expect(s.periodNetCents).toBe(-7850);
    expect(closeOut(-4000, s.periodNetCents).closingCents).toBe(-11850);
  });

  it("F-same-period: hold opened and lost inside the week → −118.50", () => {
    const hold = chargebackPostings(plan, "open", dEarning("1099"), [], "D");
    const lost = chargebackPostings(
      plan,
      "lost",
      dEarning("1099"),
      hold.map((p) => ({
        userId: p.userId,
        type: "chargeback_hold" as const,
        amountCents: p.amountCents,
      })),
      "D",
    );
    const s = summarizeEntries(
      toEntries(weekPostings(tech1099, [...hold, ...lost])),
    );
    expect([...hold, ...lost].reduce((a, p) => a + p.amountCents, 0)).toBe(
      -13300,
    );
    expect(closeOut(-4000, s.periodNetCents).closingCents).toBe(-11850);
  });

  it("F-hold-earlier: hold carried by an earlier settlement → +14.50", () => {
    const earlierHold = chargebackPostings(
      plan,
      "open",
      dEarning("1099"),
      [],
      "D",
    );
    const lost = chargebackPostings(
      plan,
      "lost",
      dEarning("1099"),
      earlierHold.map((p) => ({
        userId: p.userId,
        type: "chargeback_hold" as const,
        amountCents: p.amountCents,
      })),
      "D",
    );
    expect(lost.reduce((a, p) => a + p.amountCents, 0)).toBe(0);
    const s = summarizeEntries(toEntries(weekPostings(tech1099, lost)));
    expect(closeOut(-4000, s.periodNetCents).closingCents).toBe(1450);
  });

  it("G: same week as a W-2 tech — wages vs reimbursements, cash not netted, floor + OT at 45 h", () => {
    const d = chargebackPostings(
      { ...plan, chargebacks: { ...plan.chargebacks, on_open: "none" } },
      "lost",
      dEarning("w2"),
      [],
      "D",
    );
    expect(d[0]?.needsReview).toBe(true);
    const ps = weekPostings(techW2, d);
    const cash = ps.find((p) => p.type === "cash_held");
    expect(cash?.amountCents).toBe(0); // $300 → remittance ledger, informational
    const s = summarizeEntries(toEntries(ps));
    expect(s.wagesCents).toBe(27950);
    expect(s.reimbursementsCents).toBe(7500);
    expect(s.pendingReviewCents).toBe(-13300);
    expect(s.byType.cash_held ?? 0).toBe(0);
    const f = floorCheck({
      wagesCents: s.wagesCents,
      minutesWorked: 45 * 60,
      minWageCentsPerHour: 725,
    });
    expect(f.guaranteeTopupCents).toBe(4675);
    expect(f.otTopupCents).toBe(1813);
  });
});

describe("engine rules", () => {
  it("W-2 techs never net cash and never pay the fee on tips", () => {
    const p = { ...plan, tips: { ...plan.tips, deduct_card_fee_on_tip: true } };
    const r1 = computeJob(caseA, p, [tech1099]);
    const r2 = computeJob(caseA, p, [techW2]);
    expect(r1.earnings[0]?.tipCents).toBe(1940);
    expect(r2.earnings[0]?.tipCents).toBe(2000);
    expect(computeJob(caseB, plan, [techW2]).earnings[0]?.netCents).toBe(9750);
  });

  it("tech_keeps_cash=false forces separate remittance (nothing netted)", () => {
    const t = {
      userId: "t1",
      workerType: "1099" as const,
      overrides: { tech_keeps_cash: false },
    };
    const e = computeJob(caseB, plan, [t]).earnings[0];
    expect(e?.cashSettlement).toBe("separate_remittance");
    expect(e?.netCents).toBe(9750);
  });

  it("checks are never netted (cash.methods = ['cash'])", () => {
    const fin = base({
      revenueCents: 10000,
      payments: [
        {
          id: "x",
          method: "check",
          amountCents: 10000,
          tipCents: 0,
          feeCents: 0,
          collectedByUserId: "t1",
        },
      ],
    });
    expect(computeJob(fin, plan, [tech1099]).earnings[0]?.netCents).toBe(2500);
  });

  it("rate resolution: job custom beats every override", () => {
    const r = computeJob({ ...caseC, customRateBps: 1000 }, plan, [tech1099]);
    expect(r.earnings[0]?.rateSource).toBe("job");
    expect(r.earnings[0]?.commissionCents).toBe(2225);
  });

  it("recall within the window earns no commission", () => {
    const r = computeJob(
      { ...caseA, isCallback: true, recallInWindow: true },
      plan,
      [tech1099],
    );
    expect(r.earnings[0]?.commissionCents).toBe(0);
    expect(r.earnings[0]?.reimbursementCents).toBe(2500);
    expect(r.flags.recall).toBe(true);
  });

  it("actual fees split pro rata between base and tip", () => {
    const p = resolvePlan({});
    const r = computeJob(
      {
        ...caseA,
        payments: [
          {
            id: "pa",
            method: "card",
            amountCents: 40000,
            tipCents: 2000,
            feeCents: 1260,
            collectedByUserId: null,
          },
        ],
      },
      p,
      [tech1099],
    );
    expect(r.feesCents).toBe(1200);
    expect(r.feesOnTipsCents).toBe(60);
    expect(r.earnings[0]?.commissionCents).toBe(8075);
  });

  it("spiffs: flat per service type to the seller; review bonus to the reviewed tech", () => {
    const p = {
      ...plan,
      spiffs: [
        {
          match: { service_type_id: LOCKOUT },
          amount: { flat_cents: 1500 },
          credit: "sold_by" as const,
        },
        {
          match: { kind: "review_bonus" as const },
          amount: { flat_cents: 1000 },
          credit: "worked_by" as const,
        },
      ],
    };
    const r = computeJob({ ...caseC, reviewBonusUserIds: ["t1"] }, p, [
      tech1099,
    ]);
    expect(r.earnings[0]?.spiffsCents).toBe(2500);
  });
});
