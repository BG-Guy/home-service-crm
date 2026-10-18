// Module manifest: `payroll` (SPEC §15.1). Owner: B6.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "payroll",
  name: "Commission, payroll & payouts",
  description:
    "Commission engine, ledger, settlements, payouts, NACHA, cash custody and the approvals queue.",
  owner: "B6",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/commission",
  nav,
  emits: [
    "cash.over_limit",
    "cash.remitted",
    "cash.received",
    "cash.discrepancy_declared",
    "pay_period.closed",
    "settlement.ready_for_review",
    "settlement.flagged",
    "settlement.approved",
    "settlement.paid",
    "comp_agreement.required",
    "user.bank_changed",
  ],
  satellites: ["approvals"],
});
