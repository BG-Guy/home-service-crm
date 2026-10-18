// Event handlers for `team` (BUILD_PLAN §4, §7). Owner: B8.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'team.<what>'. Slow work → enqueueJob().
import type { HandlerReg, IgnoreReg } from "@/lib/events";

export const handlers: HandlerReg[] = [];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [
  {
    ignore: "user.deactivated",
    reason:
      "Side effects run in the emitting transaction (sessions, push devices); B2's reassign list and B6's cash flag are queries (BUILD_PLAN §7.2).",
  },
  {
    ignore: "user.invited",
    reason:
      "B8 delivers the invite link in the same action via enqueueMessage.",
  },
];
