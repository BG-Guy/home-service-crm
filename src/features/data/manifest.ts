// Module manifest: `data` (SPEC §15.1). Owner: B1.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "data",
  name: "Data import/export & backups",
  description: "Full export, CSV import, nightly backups and restore.",
  owner: "B1",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/data",
  nav,
  emits: [],
});
