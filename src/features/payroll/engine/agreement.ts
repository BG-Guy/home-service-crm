// Compensation agreement generator (SPEC M16): renders a plan into readable terms
// with formulas and two worked examples computed from the tech's actual rate. Pure.
import { formatBps, formatMoney } from "@/lib/money";
import { computeJob } from "./compute-job";
import { effectiveCash, PAYMENT_METHOD_LABELS } from "./plan";
import type { CompPlan, TechOverrides, TraceStep, WorkerType } from "./types";

export interface AgreementDoc {
  title: string;
  planKey: string;
  planVersion: number;
  sections: { heading: string; items: string[] }[];
  examples: { title: string; description: string; steps: TraceStep[] }[];
}

const m = (c: number) => formatMoney(c);

export function renderAgreement(i: {
  companyName: string;
  techName: string;
  workerType: WorkerType;
  planKey: string;
  planName: string;
  planVersion: number;
  plan: CompPlan;
  overrides: TechOverrides;
}): AgreementDoc {
  const { plan } = i;
  const rate = i.overrides.rate_bps ?? plan.rate_bps;
  const cash = effectiveCash(plan, i.workerType, i.overrides);
  const d = plan.deductions_before_split;
  const fee =
    d.processing_fees === "none"
      ? "Processing fees are not deducted."
      : d.processing_fees === "actual"
        ? `The actual processing fee charged on ${plan.fee_methods.map((x) => PAYMENT_METHOD_LABELS[x]).join(", ")} payments (the share on the job amount, not on tips) is deducted.`
        : `A processing fee of ${Object.entries(
            d.processing_fees.pct_bps_by_method,
          )
            .map(
              ([k, v]) =>
                `${formatBps(v ?? 0)} on ${PAYMENT_METHOD_LABELS[k as keyof typeof PAYMENT_METHOD_LABELS] ?? k}`,
            )
            .join(", ")} payments is deducted (job amount only, not tips).`;
  const deductions: string[] = [];
  if (d.company_parts)
    deductions.push(
      "parts the company paid for (truck stock, purchase orders, company card)",
    );
  if (d.tech_parts) deductions.push("parts you bought and were reimbursed for");
  if (d.processing_fees !== "none")
    deductions.push("card / ACH processing fees");
  if (d.lead_cost) deductions.push("the cost of the lead");
  if (d.subcontract_cost) deductions.push("subcontractor costs");

  const basisText: Record<CompPlan["basis"], string> = {
    revenue: `Commission = ${formatBps(rate)} × the job total (before tax and tips).`,
    net_after_deductions: `Commission = ${formatBps(rate)} × (job total before tax and tips − ${deductions.join(" − ") || "nothing"}).`,
    gross_profit: `Commission = ${formatBps(rate)} × gross profit (job total − ${[...deductions, "labor cost"].join(" − ")}).`,
    flat_per_job: `A flat ${m(plan.flat_per_job_cents ?? 0)} per completed job.`,
    hourly: `Hourly pay of ${m(plan.hourly_cents ?? 0)} per hour worked, from the time clock.`,
    hourly_plus_commission: `Hourly pay of ${m(plan.hourly_cents ?? 0)} per hour plus ${formatBps(rate)} commission on the job base.`,
  };

  const overrides = Object.entries(i.overrides.by_service_type ?? {}).length
    ? [
        "Some service types pay a different rate; your statement shows the rate used on every job.",
      ]
    : [];

  const sections: AgreementDoc["sections"] = [
    {
      heading: "How your commission is calculated",
      items: [
        basisText[plan.basis],
        fee,
        "Sales tax is never part of the commission base. A deposit is a payment toward the job, not extra revenue.",
        ...overrides,
        plan.earned_on === "paid_in_full"
          ? "Commission is earned when the customer has paid the invoice in full."
          : "Commission is earned when the job is completed.",
      ],
    },
    {
      heading: "Tips, parts and splits",
      items: [
        `You receive ${formatBps(plan.tips.pct_to_tech_bps)} of tips. ${plan.tips.deduct_card_fee_on_tip && i.workerType !== "w2" ? "The card fee on the tip is deducted first." : "The company absorbs the card fee on tips."}`,
        `Parts you buy with your own money are reimbursed at ${formatBps(plan.tech_parts_reimburse_bps)} once the receipt is approved. Reimbursements are paid separately from wages and are never taxed as wages.`,
        plan.splits.default === "even"
          ? "When several technicians work a job, commission, spiffs and tips are split evenly unless the job sets a different split."
          : "When several technicians work a job, commission, spiffs and tips follow the split set on the job (the primary technician gets 100% unless set otherwise).",
      ],
    },
    {
      heading: "Cash you collect",
      items: [
        cash.techKeepsCash && cash.settlement === "net_in_payout"
          ? 'You may keep cash you collect. It is subtracted from that pay period\'s earnings ("deducted from the paycheck"). If a period ends negative, the balance carries forward to the next period.'
          : `Cash you collect must be handed in or deposited within ${plan.cash.remit_within_days} day(s). It is never deducted from your wages.`,
        "Checks are payable to the company and are always handed in.",
        `Please keep cash on hand below ${m(plan.cash.max_cash_held_cents)}.`,
      ],
    },
    {
      heading: "Chargebacks and callbacks",
      items: [
        plan.chargebacks.on_open === "hold"
          ? `If a customer disputes a card payment within ${plan.chargebacks.window_days} days, the commission on that job is held until the dispute is decided.`
          : "Commission is not held while a card dispute is open.",
        plan.chargebacks.on_lost === "none"
          ? "Lost disputes do not change your commission."
          : plan.chargebacks.on_lost === "clawback_100"
            ? "If the dispute is lost, the commission on that job is taken back."
            : `If the dispute is lost, ${formatBps(plan.chargebacks.clawback_bps ?? 0)} of the commission on that job is taken back.`,
        plan.chargebacks.dispute_fee_to_tech
          ? "The bank's dispute fee is charged to you."
          : "You are never charged the bank's dispute fee.",
        plan.recalls.policy === "none"
          ? "Callbacks are paid like any other job."
          : plan.recalls.policy === "no_commission_on_recall"
            ? `A callback for the same problem within ${plan.recalls.window_days} days earns no commission.`
            : `A callback within ${plan.recalls.window_days} days takes back ${formatBps(plan.recalls.clawback_bps ?? 0)} of the original job's commission.`,
        ...(i.workerType === "w2"
          ? [
              "As a W-2 employee, any deduction from wages is reviewed by an administrator first and is only applied where the law allows it.",
            ]
          : []),
      ],
    },
    {
      heading: "Pay periods and statements",
      items: [
        "You get a statement for every pay period. You have 48 hours to review it and flag any line before it is approved.",
        "Payment is sent by the method on file (direct deposit, Zelle, check or cash). Changing your bank details pauses direct deposit for a short security hold.",
        ...(i.workerType === "w2"
          ? [
              "Your pay never falls below the minimum wage for the hours you work, and overtime is paid for hours over 40 in a week.",
            ]
          : []),
      ],
    },
  ];

  const tech = {
    userId: "you",
    workerType: i.workerType,
    overrides: i.overrides,
  };
  const ex1 = computeJob(
    {
      jobId: "example-1",
      revenueCents: 40000,
      taxCents: 0,
      serviceTypeId: null,
      customRateBps: null,
      isCallback: false,
      payments: [
        {
          id: "p1",
          method: "card",
          amountCents: 40000,
          tipCents: 2000,
          feeCents: 1260,
          collectedByUserId: null,
        },
      ],
      companyPartsCents: 4000,
      techPartsByUser: { you: 2500 },
      assignees: [{ userId: "you", splitBps: 10000, role: "primary" }],
    },
    plan,
    [tech],
    { planLabel: `${i.planName} v${i.planVersion}` },
  );
  const ex2 = computeJob(
    {
      jobId: "example-2",
      revenueCents: 30000,
      taxCents: 0,
      serviceTypeId: null,
      customRateBps: null,
      isCallback: false,
      payments: [
        {
          id: "p2",
          method: "cash",
          amountCents: 30000,
          tipCents: 0,
          feeCents: 0,
          collectedByUserId: "you",
        },
      ],
      companyPartsCents: 0,
      techPartsByUser: { you: 3000 },
      assignees: [{ userId: "you", splitBps: 10000, role: "primary" }],
    },
    plan,
    [tech],
    { planLabel: `${i.planName} v${i.planVersion}` },
  );

  return {
    title: `Compensation agreement: ${i.techName}`,
    planKey: i.planKey,
    planVersion: i.planVersion,
    sections,
    examples: [
      {
        title: "Example 1: card payment with a tip",
        description:
          "A $400.00 job paid by card with a $20.00 tip (card fee $12.60), $40.00 of company parts and $25.00 of parts you bought.",
        steps: ex1.earnings[0]?.trace ?? [],
      },
      {
        title: "Example 2: cash payment",
        description:
          "A $300.00 job paid in cash that you collected, with $30.00 of parts you bought.",
        steps: ex2.earnings[0]?.trace ?? [],
      },
    ],
  };
}
