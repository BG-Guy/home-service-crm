// Offline-capable actions for `jobs` (BUILD_PLAN §4, §6.11). Owner: B2. Client-safe.
// Keys are 'jobs.<action>'; values call this module's server actions. Each input
// carries clientId + clientTs; action() returns the stored result on replay.

import type { OfflineAction } from "@/lib/offline-types";
import {
  addEntityNote,
  markRunningLate,
  setJobStatus,
  updateChecklistItem,
} from "./actions";

export const offlineActions: Record<string, OfflineAction> = {
  "jobs.setStatus": setJobStatus as OfflineAction,
  "jobs.runningLate": markRunningLate as OfflineAction,
  "jobs.addNote": addEntityNote as OfflineAction,
  "jobs.checklist": updateChecklistItem as OfflineAction,
};
