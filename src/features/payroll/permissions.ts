// Permission keys + default grants for module `payroll` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B6. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "payroll.view_own": "AOT", // Own earnings, statements, ledger
  "payroll.view_all": "A", // All techs' pay
  "payroll.manage": "A", // Run periods, adjustments, settlements
  "payroll.approve": "A", // Approve settlements
  "payroll.payout": "A", // Record payouts / NACHA export
  "comp_plans.manage": "A", // Edit commission plans & assignments
  "cash.remit_own": "AOT", // Record own cash remittance
  "cash.receive": "AO", // Confirm cash received from tech
  "payroll.bank_edit_own": "AOT", // Enter/change own direct-deposit bank details
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type PayrollPerm = keyof typeof grants;
export const perms = Object.keys(grants) as PayrollPerm[];

export const flags = [{ key: "payroll", default: true }] as const;
