// Module manifest: `portal` (SPEC §15.1). Owner: B3.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "portal",
  name: "Customer portal",
  description: "Magic-link pages /j /e /i (no login), branded and logged.",
  owner: "B3",
  grants,
  flags,
  settingsShape,
  nav,
  emits: [],
});
