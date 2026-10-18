// Module manifest: `team` (SPEC §15.1). Owner: B8.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "team",
  name: "Team & roles",
  description:
    "Team list, profiles, invites, role changes, deactivation and compensation agreement status.",
  owner: "B8",
  grants,
  flags,
  settingsShape,
  nav,
  emits: ["user.deactivated"],
});
