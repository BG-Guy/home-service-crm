// Offline-capable actions for `vehicles` (BUILD_PLAN §4, §6.11). Owner: B7. Client-safe.
// Keys are 'vehicles.<action>'; values call this module's server actions (idempotent
// on clientId, which is also the new row's id so offline photos can attach to it).

import type { OfflineAction } from "@/lib/offline-types";
import {
  logFuel,
  logOdometer,
  reportVehicleIssue,
  submitInspection,
} from "./actions";

export const offlineActions: Record<string, OfflineAction> = {
  "vehicles.logOdometer": (input) => logOdometer(input as never),
  "vehicles.logFuel": (input) => logFuel(input as never),
  "vehicles.submitInspection": (input) => submitInspection(input as never),
  "vehicles.reportIssue": (input) => reportVehicleIssue(input as never),
};
