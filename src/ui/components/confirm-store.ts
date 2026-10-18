/**
 * The state behind `useConfirm()` (Alert.tsx), kept outside React state on
 * purpose. `useSyncExternalStore` re-renders on a store change synchronously,
 * never as part of a pending transition. That matters because the common call
 * site is
 *
 * ```ts
 * start(async () => { if (!(await confirm({...}))) return; … });
 * ```
 *
 * A `setState` there is a transition update, and React holds every transition
 * update until the async Action settles, so the alert never committed and the
 * Action waited on it forever (QA T2-01).
 */
export interface ConfirmStore<T> {
  subscribe: (listener: () => void) => () => void;
  /** The open request, or null. Stable between changes (a snapshot). */
  get: () => (T & { resolve: (v: boolean) => void }) | null;
  /** Opens a confirm; a newer one cancels (resolves `false`) the open one. */
  open: (options: T) => Promise<boolean>;
  /** Closes the open confirm with `value`. No-op when none is open. */
  finish: (value: boolean) => void;
}

export function createConfirmStore<T extends object>(): ConfirmStore<T> {
  let current: (T & { resolve: (v: boolean) => void }) | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => current,
    open(options) {
      return new Promise<boolean>((resolve) => {
        const prev = current;
        current = { ...options, resolve };
        emit();
        prev?.resolve(false);
      });
    },
    finish(value) {
      const c = current;
      if (!c) return;
      current = null;
      emit();
      c.resolve(value);
    },
  };
}
