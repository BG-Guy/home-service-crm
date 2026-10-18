// Module manifest: `media` (SPEC §15.1). Owner: B4.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "media",
  name: "Photos & evidence media",
  description:
    "Hashed, geostamped photos, before/after, gallery, compare and invoice embedding.",
  owner: "B4",
  grants,
  flags,
  settingsShape,
  nav,
  emits: ["photo.uploaded"],
});
