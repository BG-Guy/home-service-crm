// Module manifest: `customers` (SPEC §15.1). Owner: B1.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "customers",
  name: "Customers & properties",
  description:
    "Customers, properties, timeline, search, duplicate detection, merge and anonymize.",
  owner: "B1",
  grants,
  flags,
  settingsShape,
  nav,
  emits: ["customer.created", "customer.updated", "customer.merged"],
  customFieldEntities: ["customer", "property"],
});
