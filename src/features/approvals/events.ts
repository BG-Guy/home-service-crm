// Event handlers for `approvals` (BUILD_PLAN §4, §7). Owner: B6.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'approvals.<what>'. Slow work → enqueueJob().
import type { HandlerReg, IgnoreReg } from "@/lib/events";

export const handlers: HandlerReg[] = [];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
