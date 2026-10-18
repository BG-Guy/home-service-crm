// Offline-capable actions for `time` (BUILD_PLAN §4, §6.11). Owner: B2. Client-safe.
// Keys are 'time.<action>'; values call this module's server actions.

import type { OfflineAction } from "@/lib/offline-types";
import { clockIn, clockOut, logBreak } from "./actions";

export const offlineActions: Record<string, OfflineAction> = {
  "time.clockIn": clockIn as OfflineAction,
  "time.clockOut": clockOut as OfflineAction,
  "time.break": logBreak as OfflineAction,
};
