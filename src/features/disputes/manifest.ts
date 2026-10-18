// Module manifest: `disputes` (SPEC §15.1). Owner: B4.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "disputes",
  name: "Chargeback protection",
  description:
    "Risk and readiness scores, transition controls, disputes and the evidence pack.",
  owner: "B4",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/chargebacks",
  nav,
  emits: [
    "dispute.created",
    "dispute.updated",
    "dispute.closed",
    "dispute.evidence_submitted",
    "efw.created",
  ],
});
