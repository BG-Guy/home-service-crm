// Module manifest: `settings` (SPEC §15.1). Owner: B8.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "settings",
  name: "Settings",
  description:
    "Settings shell and general pages, features, permissions and integrations.",
  owner: "B8",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/company",
  nav,
  emits: ["permission.changed"],
});
