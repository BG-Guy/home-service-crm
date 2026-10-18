// Module manifest: `messaging` (SPEC §15.1). Owner: B5.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "messaging",
  name: "Messaging",
  description:
    "The one send path (enqueueMessage), outbox, threads, consent ledger and templates.",
  owner: "B5",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/messaging",
  nav,
  emits: [
    "message.sent",
    "message.received",
    "message.failed",
    "message.optout_detected",
    "consent.changed",
  ],
});
