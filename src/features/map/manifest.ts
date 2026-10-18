// Module manifest: `map` (SPEC §15.1). Owner: B7.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "map",
  name: "Live tech map",
  description: "Location pings, the live map and the customer tracking page.",
  owner: "B7",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/map",
  nav,
  emits: [],
});
