// Event handlers for `settings` (BUILD_PLAN §4, §7). Owner: B8.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'settings.<what>'. Slow work → enqueueJob().
import type { HandlerReg, IgnoreReg } from "@/lib/events";

export const handlers: HandlerReg[] = [];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [
  {
    ignore: "permission.changed",
    reason:
      "Permissions are re-read on every request (no cache to invalidate); the event is an audit/automation hook only (BUILD_PLAN §7.2).",
  },
];
