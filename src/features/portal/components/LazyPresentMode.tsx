"use client";

import dynamic from "next/dynamic";

/**
 * Present mode for /e/…?present=1 as its own chunk (FullscreenHub + the start
 * screen): a customer opening their link never loads it. Server-rendered, so
 * the estimate itself paints at once.
 */
export const LazyPresentMode = dynamic(() =>
  import("./PresentMode").then((m) => m.PresentMode),
);
