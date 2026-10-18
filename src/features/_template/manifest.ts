// Template manifest — NOT registered (src/features/registry.ts doesn't import it).
// To create a module: copy this folder to src/features/<key>/, replace "example",
// then follow README.md. Registering = one line in `modules` + the ModuleKey union.
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "example" as never, // becomes a ModuleKey once added to the union
  name: "Example module",
  description: "Reference module showing the conventions end to end.",
  owner: "?",
  grants,
  flags,
  settingsShape,
  nav,
  // Domain events this module emits (declare them in src/lib/event-types.ts EventMap).
  emits: [],
});
