// Offline action signature (BUILD_PLAN §4 offline.ts, §6.11). Client-safe, type-only.
import type { ActionResult } from "./types";

/** Declared with method syntax so typed action inputs stay assignable. */
export type OfflineAction = {
  call(input: Record<string, unknown>): Promise<ActionResult<unknown>>;
}["call"];
