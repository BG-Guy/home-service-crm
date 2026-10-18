// Module manifest: `tech` (SPEC §15.1). Owner: B2.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "tech",
  name: "Technician mobile experience",
  description:
    "Today (My Day), the tech job screen and action bar, Finish my day, offline outbox and drafts.",
  owner: "B2",
  grants,
  flags,
  settingsShape,
  nav,
  emits: [],
});
