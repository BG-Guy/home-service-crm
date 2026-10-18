"use client";

// Client glue for offline-capable job/time actions (BUILD_PLAN §6.11): registers
// this module's offline actions with the outbox registry (so queued items replay
// after a reload once any job screen has loaded) and wraps queueAction.

import { registerOfflineActions } from "@/client/offline-registry";
import { queueAction } from "@/client/outbox";
import { offlineActions as timeOffline } from "@/features/time/offline";
import { newId } from "@/lib/ids";
import type { ActionResult } from "@/lib/types";
import { offlineActions as jobsOffline } from "../offline";

registerOfflineActions({ ...jobsOffline, ...timeOffline });

export function newClientId(): string {
  return newId();
}

export type OfflineKey =
  | "jobs.setStatus"
  | "jobs.runningLate"
  | "jobs.addNote"
  | "jobs.checklist"
  | "time.clockIn"
  | "time.clockOut"
  | "time.break";

/**
 * Run now when online; persist + retry when offline or the request fails.
 * `queued: true` means it will sync later (show "Saved — will sync").
 */
export async function runOffline<T = unknown>(
  key: OfflineKey,
  input: Record<string, unknown>,
): Promise<{ queued: boolean; result?: ActionResult<T> }> {
  const clientId = (input.clientId as string | undefined) ?? newClientId();
  const res = await queueAction(key, {
    ...input,
    clientId,
    clientTs: new Date().toISOString(),
  });
  return res as { queued: boolean; result?: ActionResult<T> };
}
