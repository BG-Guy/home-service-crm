// Module manifest: `parts` (SPEC §15.1). Owner: B6.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "parts",
  name: "Parts & inventory",
  description:
    "Parts on jobs (company- and tech-paid), receipts, reimbursements and inventory.",
  owner: "B6",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/parts",
  nav,
  emits: [
    "part_purchase.submitted",
    "part_purchase.approved",
    "part_purchase.rejected",
  ],
});
