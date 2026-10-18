// Offline-capable actions for `payments` (BUILD_PLAN §4, §6.11). Owner: B4. Client-safe.
// Keys are 'payments.<action>'; values call this module's server actions.
// Manual methods (cash/check/Zelle/Venmo) can be recorded with no signal: the outbox
// replays them with the same clientId (idempotent in recordPayment and action receipts).

import type { OfflineAction } from "@/lib/offline-types";
import { recordManualPayment } from "./actions";

export const offlineActions: Record<string, OfflineAction> = {
  "payments.recordManual": recordManualPayment as OfflineAction,
};
