// Module manifest: `tools` (SPEC §15.1). Owner: B7.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "tools",
  name: "Tools",
  description:
    "Tool register, kits, custody, audits, incidents and maintenance.",
  owner: "B7",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/tools",
  nav,
  emits: [
    "tool.audit_due",
    "tool.audit_submitted",
    "tool.incident",
    "tool.maintenance_due",
  ],
  customFieldEntities: ["tool"],
});
