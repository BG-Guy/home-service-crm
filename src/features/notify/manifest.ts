// Module manifest: `notify` (SPEC §15.1). Owner: B5.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "notify",
  name: "Notifications, activity & audit",
  description:
    "In-app notifications, web push, activity timeline UI, audit viewer and the daily digest.",
  owner: "B5",
  grants,
  flags,
  settingsShape,
  nav,
  emits: ["digest.daily"],
});
