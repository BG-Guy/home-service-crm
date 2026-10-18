// Offline-capable actions for `tools` (BUILD_PLAN §4, §6.11). Owner: B7. Client-safe.
// Keys are 'tools.<action>'; values call this module's server actions (idempotent on
// clientId; photos replay through the upload outbox).

import type { OfflineAction } from "@/lib/offline-types";
import {
  logToolMaintenance,
  reportToolIncident,
  saveAuditItem,
} from "./actions";

export const offlineActions: Record<string, OfflineAction> = {
  "tools.logMaintenance": (input) => logToolMaintenance(input as never),
  "tools.reportIncident": (input) => reportToolIncident(input as never),
  "tools.saveAuditItem": (input) => saveAuditItem(input as never),
};
