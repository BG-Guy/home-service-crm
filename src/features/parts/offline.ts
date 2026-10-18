// Offline-capable actions for `parts` (BUILD_PLAN §4, §6.11). Owner: B6. Client-safe.
// Keys are 'parts.<action>'; values call this module's server actions.

import type { OfflineAction } from "@/lib/offline-types";
import { addPartToJob, submitReceipt } from "./actions";

export const offlineActions: Record<string, OfflineAction> = {
  "parts.addPart": (input) => addPartToJob(input as never),
  "parts.submitReceipt": (input) => submitReceipt(input as never),
};
