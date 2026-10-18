// Module manifest: `automations` (SPEC §15.1). Owner: B5.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "automations",
  name: "Automations & reminders",
  description:
    "Automation engine and editor, built-in automations and custom reminders.",
  owner: "B5",
  grants,
  flags,
  settingsShape,
  nav,
  emits: ["reminder.due"],
});
