// Module manifest: `estimates` (SPEC §15.1). Owner: B3.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "estimates",
  name: "Estimates",
  description:
    "Estimates with 1–3 options (one recommended), e-sign, change orders and the price book.",
  owner: "B3",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/invoices",
  nav,
  emits: [
    "estimate.sent",
    "estimate.viewed",
    "estimate.approved",
    "estimate.declined",
    "estimate.expired",
    "change_order.approved",
  ],
  satellites: ["pricebook"],
});
