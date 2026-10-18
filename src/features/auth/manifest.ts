// Module manifest: `auth` (SPEC §15.1). Owner: F.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "auth",
  name: "Auth & onboarding",
  description:
    "Signup, login, sessions, invites, password reset and the install prompt.",
  owner: "F",
  grants,
  flags,
  settingsShape,
  nav,
  emits: ["user.invited"],
});
