// Module manifest: `leads` (SPEC §15.1). Owner: B1.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "leads",
  name: "Leads & intake API",
  description:
    "Leads inbox with SLA timers, intake endpoints, embed.js, hosted form, lead sources and API keys.",
  owner: "B1",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/lead-sources",
  nav,
  emits: [
    "lead.created",
    "lead.touched",
    "lead.responded",
    "lead.sla_breached",
    "lead.status_changed",
    "lead.converted",
  ],
  customFieldEntities: ["lead"],
});
