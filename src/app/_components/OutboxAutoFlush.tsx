"use client";

import { useEffect } from "react";

/**
 * Starts the offline outbox auto-flush (lazy chunk) for the signed-in app.
 * Mounted once by `(app)/layout.tsx`; public and auth pages don't run it.
 */
export function OutboxAutoFlush() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    import("@/client/outbox").then((m) => {
      if (!cancelled) stop = m.startOutbox();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return null;
}
