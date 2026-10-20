"use client";

import { type ComponentType, useEffect, useState } from "react";

export interface ShellIdleProps {
  /** For the install nudge ("Install Brightside"). */
  appName: string;
  /** Techs also get the location pill (S53). */
  tech: boolean;
}

/**
 * The shell's non-critical client pieces, loaded in one chunk once the page has
 * loaded and the main thread is idle (docs/DESIGN.md §2, budget.md): the offline
 * outbox replay, the sync capsule, the install nudge and, for techs, the location
 * pill. None of it is needed for the first paint or the first tap, so it stays out
 * of the shell's initial JS (and never delays hydration). All of it floats, so
 * arriving late shifts nothing.
 */
export function ShellDeferred(props: ShellIdleProps) {
  const [Idle, setIdle] = useState<ComponentType<ShellIdleProps> | null>(null);
  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    const load = () => {
      import("./ShellIdle").then((m) => {
        if (!cancelled) setIdle(() => m.ShellIdle);
      });
    };
    const whenIdle = () => {
      handle =
        typeof window.requestIdleCallback === "function"
          ? window.requestIdleCallback(load, { timeout: 1500 })
          : window.setTimeout(load, 300);
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", whenIdle);
      if (typeof window.cancelIdleCallback === "function")
        window.cancelIdleCallback(handle);
      clearTimeout(handle);
    };
  }, []);
  return Idle ? <Idle {...props} /> : null;
}
