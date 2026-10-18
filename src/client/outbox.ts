// Client outbox (BUILD_PLAN §6.11; SPEC §1.4 "offline outbox for status, notes
// and photos"). IndexedDB-backed FIFO for server actions + a media upload
// queue, retried with exponential backoff and flushed on app open, `online`
// and `visibilitychange`. Server actions are idempotent on `clientId`
// (action_receipts), so replays are safe.
//
// Contract (frozen names): queueAction, queueUpload, useOutboxState, flush.
// Call `startOutbox()` once on the client (AppProviders does it).

import { useSyncExternalStore } from "react";
import { idbAvailable, idbDelete, idbGetAll, idbPut, openDb } from "./idb";
import type { PreparedImage } from "./image";
import type { OfflineActionResult } from "./offline-registry";
import {
  UploadError,
  type UploadMeta,
  type UploadParts,
  uploadMedia,
} from "./upload";

export type { UploadMeta } from "./upload";
export type OfflineActionKey = string;

/* ---------- storage (IndexedDB, memory fallback for private modes) ---------- */

interface ActionRecord {
  clientId: string;
  key: OfflineActionKey;
  input: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  nextAt: number;
  lastError: string | null;
}

interface UploadRecord {
  clientId: string;
  meta: UploadMeta;
  parts: UploadParts;
  createdAt: number;
  attempts: number;
  nextAt: number;
  lastError: string | null;
}

type StoreName = "actions" | "uploads";
const DB = "crm-outbox";
const memory: Record<StoreName, Map<string, unknown>> = {
  actions: new Map(),
  uploads: new Map(),
};

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await openDb(DB, 1, [
      { name: "actions", keyPath: "clientId" },
      { name: "uploads", keyPath: "clientId" },
    ]);
  } catch {
    return null;
  }
}

async function all<T>(store: StoreName): Promise<T[]> {
  const d = await db();
  if (!d) return [...memory[store].values()] as T[];
  return idbGetAll<T>(d, store);
}

async function save<T extends { clientId: string }>(store: StoreName, rec: T) {
  const d = await db();
  if (!d) {
    memory[store].set(rec.clientId, rec);
    return;
  }
  try {
    await idbPut(d, store, rec);
  } catch {
    // Quota / Blob-in-IDB issues: keep it in memory for this session.
    memory[store].set(rec.clientId, rec);
  }
}

async function drop(store: StoreName, clientId: string) {
  memory[store].delete(clientId);
  const d = await db();
  if (d) await idbDelete(d, store, clientId).catch(() => {});
}

/* ---------- observable state ---------- */

export interface OutboxState {
  /** Persisted actions + uploads waiting to sync. */
  pending: number;
  /** Uploads in flight right now. */
  uploading: number;
  syncing: boolean;
  lastError: string | null;
  online: boolean;
}

const SERVER_STATE: OutboxState = {
  pending: 0,
  uploading: 0,
  syncing: false,
  lastError: null,
  online: true,
};
let state: OutboxState = SERVER_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<OutboxState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

async function refreshCounts() {
  try {
    const [a, u] = await Promise.all([all("actions"), all("uploads")]);
    setState({ pending: a.length + u.length });
  } catch {
    /* ignore */
  }
}

/** Live outbox status for banners and badges. */
export function useOutboxState(): OutboxState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER_STATE,
  );
}

/** Non-hook snapshot. */
export function getOutboxState(): OutboxState {
  return state;
}

/* ---------- helpers ---------- */

const isOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/** 2 s, 4 s, 8 s … capped at 10 min, ±20 % jitter. */
export function backoffMs(attempts: number): number {
  const base = Math.min(600_000, 2000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

async function resolveAction(key: string) {
  const { offlineActions } = await import("./offline-registry");
  const fn = offlineActions[key];
  if (!fn) throw new Error(`Unknown offline action "${key}"`);
  return fn;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleNext(records: Array<{ nextAt: number }>) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (records.length === 0) return;
  const next = Math.min(...records.map((r) => r.nextAt));
  timer = setTimeout(() => void flush(), Math.max(1000, next - Date.now()));
}

/* ---------- public API ---------- */

/**
 * Run an offline-capable server action now; when offline or the call throws
 * (network), persist it and retry later. An `{ ok: false }` result is final
 * (validation/permission) and is returned, not retried.
 */
export async function queueAction(
  key: OfflineActionKey,
  input: Record<string, unknown> & { clientId: string; clientTs: string },
): Promise<{ queued: boolean; result?: OfflineActionResult }> {
  const fn = await resolveAction(key);
  if (isOnline()) {
    try {
      const result = await fn(input);
      return { queued: false, result };
    } catch {
      /* fall through: persist and retry */
    }
  }
  await save<ActionRecord>("actions", {
    clientId: input.clientId,
    key,
    input,
    createdAt: Date.now(),
    attempts: 0,
    nextAt: Date.now(),
    lastError: null,
  });
  await refreshCounts();
  if (isOnline()) scheduleNext([{ nextAt: Date.now() + backoffMs(1) }]);
  return { queued: true };
}

/**
 * Upload a photo/document: presign → PUT → complete. Images are compressed
 * first (1600 px + 320 px thumb) unless `opts.prepared` is passed. On network
 * failure or offline, the blobs are persisted in IndexedDB and retried.
 * Non-retryable server errors (bad type, too large, forbidden) reject.
 */
export async function queueUpload(
  file: Blob,
  meta: UploadMeta,
  opts: {
    prepared?: PreparedImage;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<{ clientId: string; queued: boolean; mediaId?: string }> {
  const p =
    opts.prepared ??
    (file.type.startsWith("image/")
      ? await import("./image").then((m) => m.prepareImage(file))
      : null);
  const parts: UploadParts = p
    ? {
        main: p.main,
        thumb: p.thumb,
        original: p.processed ? p.original : null,
        width: p.width,
        height: p.height,
        exif: p.exif,
        name: file instanceof File ? file.name : undefined,
      }
    : { main: file, name: file instanceof File ? file.name : undefined };

  if (isOnline()) {
    setState({ uploading: state.uploading + 1 });
    try {
      const { mediaId } = await uploadMedia(parts, meta, {
        onProgress: opts.onProgress,
      });
      return { clientId: meta.clientId, queued: false, mediaId };
    } catch (e) {
      if (e instanceof UploadError && !e.retryable) throw e;
    } finally {
      setState({ uploading: Math.max(0, state.uploading - 1) });
    }
  }
  await save<UploadRecord>("uploads", {
    clientId: meta.clientId,
    meta,
    parts,
    createdAt: Date.now(),
    attempts: 0,
    nextAt: Date.now(),
    lastError: null,
  });
  await refreshCounts();
  if (isOnline()) scheduleNext([{ nextAt: Date.now() + backoffMs(1) }]);
  return { clientId: meta.clientId, queued: true };
}

let flushing: Promise<void> | null = null;

/** Replay due actions (strict FIFO) and uploads. Single-flight; cross-tab locked when supported. */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  const run = async () => {
    if (!isOnline()) return;
    setState({ syncing: true });
    try {
      const now = Date.now();
      const actions = (await all<ActionRecord>("actions")).sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      const waiting: Array<{ nextAt: number }> = [];
      for (let i = 0; i < actions.length; i++) {
        const rec = actions[i] as ActionRecord;
        if (rec.nextAt > now) {
          // Keep order: nothing after a backed-off action runs before it.
          waiting.push(...actions.slice(i));
          break;
        }
        try {
          const fn = await resolveAction(rec.key);
          const result = await fn(rec.input);
          await drop("actions", rec.clientId);
          if (!result.ok) setState({ lastError: result.error });
        } catch (e) {
          rec.attempts += 1;
          rec.nextAt = Date.now() + backoffMs(rec.attempts);
          rec.lastError = (e as Error).message || "Sync failed";
          await save("actions", rec);
          setState({ lastError: rec.lastError });
          waiting.push(...actions.slice(i));
          break;
        }
      }

      const uploads = await all<UploadRecord>("uploads");
      for (const rec of uploads) {
        if (rec.nextAt > now) {
          waiting.push(rec);
          continue;
        }
        setState({ uploading: state.uploading + 1 });
        try {
          await uploadMedia(rec.parts, rec.meta);
          await drop("uploads", rec.clientId);
        } catch (e) {
          const retryable = !(e instanceof UploadError) || e.retryable;
          rec.lastError = (e as Error).message || "Upload failed";
          setState({ lastError: rec.lastError });
          if (retryable) {
            rec.attempts += 1;
            rec.nextAt = Date.now() + backoffMs(rec.attempts);
            await save("uploads", rec);
            waiting.push(rec);
          } else {
            await drop("uploads", rec.clientId);
          }
        } finally {
          setState({ uploading: Math.max(0, state.uploading - 1) });
        }
      }
      if (waiting.length === 0 && actions.length + uploads.length > 0) {
        setState({ lastError: null });
      }
      scheduleNext(waiting);
    } finally {
      await refreshCounts();
      setState({ syncing: false });
    }
  };
  const locked = async (): Promise<void> => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request("crm-outbox", run);
    } else {
      await run();
    }
  };
  const p = locked().finally(() => {
    flushing = null;
  });
  flushing = p;
  return p;
}

let started = false;

/** Wire auto-flush (app open, `online`, tab visible). Idempotent; returns a stop fn. */
export function startOutbox(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  const onOnline = () => {
    setState({ online: true });
    void flush();
  };
  const onOffline = () => setState({ online: false });
  const onVisible = () => {
    if (document.visibilityState === "visible") void flush();
  };
  setState({ online: isOnline() });
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  void refreshCounts().then(() => flush());
  return () => {
    started = false;
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    if (timer) clearTimeout(timer);
  };
}
