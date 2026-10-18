// Autosaved drafts (BUILD_PLAN §6.11): debounced 400 ms writes to IndexedDB,
// restored on mount. `clear()` after a successful submit.

import { useCallback, useEffect, useRef, useState } from "react";
import { idbAvailable, idbDelete, idbGet, idbPut, openDb } from "./idb";

const STORE = "drafts";

async function db(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  try {
    return await openDb("crm-drafts", 1, [{ name: STORE }]);
  } catch {
    return null;
  }
}

export async function readDraft<T>(key: string): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return idbGet<{ v: T }>(d, STORE, key)
    .then((r) => r?.v)
    .catch(() => undefined);
}

export async function writeDraft<T>(key: string, v: T): Promise<void> {
  const d = await db();
  if (d) await idbPut(d, STORE, { v, at: Date.now() }, key).catch(() => {});
}

export async function clearDraft(key: string): Promise<void> {
  const d = await db();
  if (d) await idbDelete(d, STORE, key).catch(() => {});
}

/**
 * `const [note, setNote, clearNote] = useDraft(\`job:${id}:note\`, "")`.
 * The stored value replaces `initial` once loaded (if the user hasn't typed yet).
 */
export function useDraft<T>(
  key: string,
  initial: T,
): [T, (v: T) => void, () => void] {
  const [value, setValue] = useState<T>(initial);
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    touched.current = false;
    let alive = true;
    readDraft<T>(key).then((v) => {
      if (alive && v !== undefined && !touched.current) setValue(v);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const set = useCallback(
    (v: T) => {
      touched.current = true;
      setValue(v);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void writeDraft(key, v), 400);
    },
    [key],
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void clearDraft(key);
  }, [key]);

  return [value, set, clear];
}
