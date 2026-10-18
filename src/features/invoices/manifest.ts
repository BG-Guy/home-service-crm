// Module manifest: `invoices` (SPEC §15.1). Owner: B3.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "invoices",
  name: "Invoices & receipts",
  description:
    "Invoices, revisions, credit notes, receipts, statements, print pages and signatures.",
  owner: "B3",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/invoices",
  nav,
  emits: [
    "invoice.issued",
    "invoice.revised",
    "invoice.overdue",
    "invoice.paid",
    "invoice.voided",
    "signature.captured",
  ],
  satellites: ["signatures"],
});
