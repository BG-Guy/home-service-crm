// Don't lose call outcomes (build SPEC fix): a call started from a lead is kept on
// this device until its outcome is logged, so a Skip or the page reloading after
// the phone app comes back asks again. Plain client module (localStorage).
import { useSyncExternalStore } from "react";

const KEY = "leads:pending-call";
/** Old calls stop asking after 2 hours, or after the third Skip. */
const MAX_AGE_MS = 2 * 60 * 60_000;
const MAX_SKIPS = 3;

export interface PendingCall {
  leadId: string;
  name: string;
  at: number;
  skips: number;
}

const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};

function read(): PendingCall | null {
  try {
    const v = JSON.parse(
      localStorage.getItem(KEY) ?? "null",
    ) as PendingCall | null;
    if (!v?.leadId || Date.now() - v.at > MAX_AGE_MS) return null;
    return v;
  } catch {
    return null;
  }
}

function write(v: PendingCall | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode / blocked storage: the sheet still opens after the call
  }
  snapshot = undefined;
  emit();
}

export function readPendingCall(): PendingCall | null {
  return read();
}

export function startPendingCall(leadId: string, name: string): void {
  write({ leadId, name, at: Date.now(), skips: 0 });
}

export function clearPendingCall(leadId?: string): void {
  const v = read();
  if (!v || !leadId || v.leadId === leadId) write(null);
}

/** Skip: ask again next time (up to MAX_SKIPS). */
export function skipPendingCall(leadId: string): void {
  const v = read();
  if (!v || v.leadId !== leadId) return;
  write(v.skips + 1 >= MAX_SKIPS ? null : { ...v, skips: v.skips + 1 });
}

let snapshot: string | null | undefined;

function subscribe(cb: () => void) {
  subs.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      snapshot = undefined;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    subs.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** The lead id with a call waiting for its outcome (null on the server). */
export function usePendingCallLead(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (snapshot === undefined) snapshot = read()?.leadId ?? null;
      return snapshot;
    },
    () => null,
  );
}
