// Event handlers for `automations` (BUILD_PLAN §4, §7). Owner: B5.
// `automations.engine` is the wildcard handler: every event runs cancel_on + triggers
// for every automation (built-in and custom). Idempotent: dedupe keys + status filters.
import type { HandlerReg, IgnoreReg } from "@/lib/events";
import { runAutomationEngine } from "./engine";
import { deliverReminder } from "./reminders";

export const handlers: HandlerReg[] = [
  {
    event: "*",
    name: "automations.engine",
    async run(e, { tx }) {
      await runAutomationEngine(tx, e);
    },
  },
  {
    event: "reminder.due",
    name: "automations.reminder_deliver",
    async run(e, { tx, now }) {
      const id = (e.payload as { reminder_id?: string }).reminder_id;
      if (id) await deliverReminder(tx, id, e.id, now);
    },
  },
];

/** Event types this module deliberately does not handle (the '*' engine covers all). */
export const ignores: IgnoreReg[] = [];
