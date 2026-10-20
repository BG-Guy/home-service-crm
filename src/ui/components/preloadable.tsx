import {
  type ComponentType,
  lazy,
  type ReactElement,
  Suspense,
  useState,
} from "react";

/**
 * A lazy component that renders synchronously once its chunk is loaded.
 *
 * `next/dynamic` and `React.lazy` suspend on an instance's first render even when
 * the chunk is already in the module cache, and React then holds the reveal for its
 * 300 ms fallback throttle, so a sheet warmed on idle still opened ~300 ms late.
 * Here `preload()` (call it on idle / hover) keeps the resolved component; an
 * instance mounted after that renders it directly, with no Suspense in the way.
 * Before the chunk arrives it falls back to `React.lazy` (fallback `null`).
 * Client-only use: mount it after an interaction (it is never server-rendered).
 */
export function preloadable<P extends object>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> & { preload: () => Promise<ComponentType<P>> } {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () => {
    pending ??= load().then(
      (c) => {
        loaded = c;
        return c;
      },
      (e: unknown) => {
        pending = null; // a failed fetch (offline) may be retried
        throw e;
      },
    );
    return pending;
  };
  const Lazy = lazy(() => preload().then((c) => ({ default: c })));
  function Preloadable(props: P): ReactElement {
    // Fixed per instance: switching from Lazy to the direct component would remount.
    const [Direct] = useState(() => loaded);
    if (Direct) return <Direct {...props} />;
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return Object.assign(Preloadable, { preload });
}
