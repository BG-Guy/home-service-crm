// Offline action registry (BUILD_PLAN §4: `offline.ts` per module, keys
// '<module>.<action>'). Loaded lazily by the outbox at flush time, so these
// action references don't weigh on every page. A queued action replays after a
// reload on any page because every module's map is spread in statically here.
import { offlineActions as jobs } from "@/features/jobs/offline";
import { offlineActions as parts } from "@/features/parts/offline";
import { offlineActions as payments } from "@/features/payments/offline";
import { offlineActions as payroll } from "@/features/payroll/offline";
import { offlineActions as time } from "@/features/time/offline";
import { offlineActions as tools } from "@/features/tools/offline";
import { offlineActions as vehicles } from "@/features/vehicles/offline";

export type OfflineActionResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type OfflineActionMap = Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: each action has its own input type
  (input: any) => Promise<OfflineActionResult>
>;

const registered: OfflineActionMap = {
  ...jobs,
  ...time,
  ...payments,
  ...parts,
  ...payroll,
  ...vehicles,
  ...tools,
} as OfflineActionMap;

/** Runtime registration (tests, dev gallery, or modules that self-register). */
export function registerOfflineActions(map: OfflineActionMap): void {
  Object.assign(registered, map);
}

export const offlineActions: OfflineActionMap = registered;
