// Module manifest: `payments` (SPEC §15.1). Owner: B4.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "payments",
  name: "Deposits & payments",
  description:
    "Payments ledger, manual and Stripe payments, refunds, deposits and reconciliation.",
  owner: "B4",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/payments",
  nav,
  emits: [
    "deposit.required",
    "deposit.paid",
    "deposit.hold_expiring",
    "payment.succeeded",
    "payment.failed",
    "payment.fee_updated",
    "payment.manual_unverified",
    "payment.customer_flagged",
    "refund.created",
    "refund.succeeded",
    "refund.due",
  ],
});
