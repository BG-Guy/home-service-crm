"use client";

import { MapPinned } from "lucide-react";
import { type ReactNode, Suspense, use } from "react";
import { cx } from "@/ui/cx";
import { LazyLeadsMap } from "./map/LazyLeadsMap";
import type { LeadsMapData } from "./map/types";

/**
 * The inbox's map (contract 3.4, item 10): the desktop column beside the grid
 * (`panel`) or, on phones and tablets in Map mode, the full-height map with the
 * lead boxes in its drawer (`phone`: `header` and `children` ride in the drawer).
 * The data comes from the page (`getLeadsMapData`, started before the inbox
 * renders) and the map itself is lazy (LazyLeadsMap: its own chunk, Leaflet a
 * second one). Tapping a pin opens that lead's card. A calm placeholder shows
 * while the data is on its way or when it couldn't load.
 */
export function LeadsMapSlot({
  layout,
  map,
  count,
  header,
  onShowGrid,
  children,
}: {
  layout: "panel" | "phone";
  map?: Promise<LeadsMapData | null>;
  /** "N open leads" / "Show N leads". */
  count?: number;
  /** Phone drawer: the count line and the chips. */
  header?: ReactNode;
  /** Phone: the Grid half of the switch on the drawer. */
  onShowGrid?: () => void;
  /** Phone drawer: the inbox grid. */
  children?: ReactNode;
}) {
  const placeholder = <MapPlaceholder layout={layout} />;
  if (!map) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <MapWithData
        layout={layout}
        map={map}
        count={count}
        header={header}
        onShowGrid={onShowGrid}
        placeholder={placeholder}
      >
        {children}
      </MapWithData>
    </Suspense>
  );
}

function MapWithData({
  layout,
  map,
  count,
  header,
  onShowGrid,
  placeholder,
  children,
}: {
  layout: "panel" | "phone";
  map: Promise<LeadsMapData | null>;
  count?: number;
  header?: ReactNode;
  onShowGrid?: () => void;
  placeholder: ReactNode;
  children?: ReactNode;
}) {
  const data = use(map);
  // The map couldn't load: the leads still show (phones keep their grid).
  if (!data)
    return layout === "phone" ? (
      <>
        {header}
        <div className="mt-3">{children}</div>
      </>
    ) : (
      placeholder
    );
  return (
    <LazyLeadsMap
      {...data}
      layout={layout}
      count={count}
      drawerHeader={header}
      onShowGrid={onShowGrid}
    >
      {children}
    </LazyLeadsMap>
  );
}

/** While the map loads (or when it can't): a drawn street grid, so the space reads as a map. */
function MapPlaceholder({ layout }: { layout: "panel" | "phone" }) {
  return (
    <section
      aria-label="Lead map"
      className={cx(
        layout === "panel"
          ? "h-[calc(100dvh-env(safe-area-inset-top)-76px)] min-h-[400px]"
          : "h-[60dvh] min-h-[360px]",
      )}
    >
      <div className="relative flex size-full flex-col items-center justify-center gap-3 overflow-hidden rounded-card bg-card p-6 text-center shadow-card">
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative (aria-hidden) */}
        <svg
          aria-hidden
          className="absolute inset-0 size-full text-label-3"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 400 400"
        >
          <g fill="none" stroke="currentColor" strokeOpacity=".14">
            <path d="M-20 120 L420 60" strokeWidth="14" />
            <path d="M-20 300 L420 250" strokeWidth="10" />
            <path d="M90 -20 L140 420" strokeWidth="12" />
            <path d="M290 -20 L250 420" strokeWidth="8" />
            <path d="M-20 200 L420 190" strokeWidth="4" />
          </g>
        </svg>
        <span className="relative flex size-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_var(--tint-a),transparent)] text-accent-text">
          <MapPinned size={28} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="relative text-title3">Lead map</h2>
        <p className="relative max-w-[30ch] text-subhead text-label-2">
          New leads show here as pins next to today&apos;s jobs.
        </p>
      </div>
    </section>
  );
}
