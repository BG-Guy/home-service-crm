// Contract types for B6 payroll (BUILD_PLAN §5.2, §6.6). Types only.
export type TraceStep = {
  step: string;
  label: string;
  amount_cents: number;
  running_cents: number;
};
export interface JobFinancialsView {
  jobId: string;
  locked: boolean;
  planKey: string;
  planVersion: number;
  company: null | {
    revenueCents: number;
    taxCents: number;
    tipCents: number;
    companyPartsCents: number;
    techPartsCents: number;
    feesCents: number;
    feesOnTipsCents: number;
    otherDeductionsCents: number;
    baseCents: number;
    companyNetCents: number;
    trace: TraceStep[];
  };
  earnings: {
    userId: string;
    name: string;
    splitBps: number;
    rateBps: number;
    rateSource: string;
    commissionCents: number;
    spiffsCents: number;
    tipCents: number;
    reimbursementCents: number;
    cashHeldCents: number;
    netCents: number;
    trace: TraceStep[];
  }[];
}
export type ExternalLedgerType =
  | "reimbursement_mileage"
  | "reimbursement_expense"
  | "tool_deduction"
  | "tool_allowance"
  | "tool_deposit"
  | "adjustment";
export type CustodyBalance = {
  heldCents: number;
  cashCents: number;
  checksCents: number;
  oldestAt: Date | null;
};

// §5.2 slot props
export type JobEarningsPanelProps = { jobId: string };
export type CashOnHandPillProps = { userId: string };
export type MyEarningsCardProps = { userId: string };
export type TechCompSectionProps = { userId: string };
export type CashCheckSectionProps = { userId: string };
