// Offline-capable actions for `payroll` (BUILD_PLAN §4, §6.11). Owner: B6. Client-safe.
// Keys are 'payroll.<action>'; values call this module's server actions.

import type { OfflineAction } from "@/lib/offline-types";
import { declareCash, remitCash } from "./actions";

export const offlineActions: Record<string, OfflineAction> = {
  "payroll.remitCash": (input) => remitCash(input as never),
  "payroll.declareCash": (input) => declareCash(input as never),
};
