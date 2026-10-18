// Module manifest: `insights` (SPEC §15.1). Owner: B8.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "insights",
  name: "Insights dashboards",
  description:
    "Admin, office (Ops Today) and tech dashboards plus the anomaly report.",
  owner: "B8",
  grants,
  flags,
  settingsShape,
  nav,
  emits: [],
});
