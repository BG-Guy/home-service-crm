"use client";

import dynamic from "next/dynamic";

/**
 * The lead map in its own chunk (server-rendered, hydrated when the chunk is in),
 * so the inbox's first load never carries it; Leaflet is a second lazy chunk
 * inside it (client only). Props: `LeadsMapProps` (./types.ts).
 *
 * ```tsx
 * <LazyLeadsMap {...mapData} layout="panel" />
 * ```
 */
export const LazyLeadsMap = dynamic(() => import("./LeadsMap"), {
  loading: () => (
    <div aria-hidden className="shimmer h-[60dvh] min-h-80 rounded-card" />
  ),
});
