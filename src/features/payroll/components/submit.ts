"use client";

import { registerOfflineActions } from "@/client/offline-registry";
import { queueAction } from "@/client/outbox";
import type { ActionResult } from "@/lib/types";
import { toast } from "@/ui/components/Toast";
import { offlineActions as parts } from "../../parts/offline";
import { offlineActions as payroll } from "../offline";

// Online-or-queue submit for B6's offline-capable actions (receipts, parts on a job,
// cash hand-ins). Replays are idempotent on clientId (action receipts).

let registered = false;
function ensureRegistered() {
  if (registered) return;
  registerOfflineActions({ ...parts, ...payroll });
  registered = true;
}

export type Outcome<T> =
  | { ok: true; queued: boolean; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function submitOffline<T>(
  key: string,
  input: Record<string, unknown> & { clientId: string },
): Promise<Outcome<T>> {
  ensureRegistered();
  const res = await queueAction(key, {
    ...input,
    clientTs: new Date().toISOString(),
  });
  if (res.queued) return { ok: true, queued: true };
  const r = res.result as ActionResult<T> | undefined;
  if (!r) return { ok: true, queued: true };
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  return { ok: true, queued: false, data: r.data };
}

export function toastQueued(what: string) {
  toast({
    title: `${what} saved offline`,
    message: "It will sync when you're back online.",
    tone: "warning",
  });
}

/** First error for a field. */
export const fe = (errs: Record<string, string[]> | undefined, key: string) =>
  errs?.[key]?.[0];
