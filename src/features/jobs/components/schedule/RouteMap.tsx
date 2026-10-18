"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import { cx } from "@/ui/cx";
import type { RouteLine, RoutePin } from "../../route-plan";

// Route map canvas (SPEC M05 map layout; tech "Today's route"): numbered L.divIcon
// pins in each tech's color and a dashed straight line per tech joining the stops
// in visit order. Free: Leaflet + the tile URL from getMapConfig() + coordinates the
// app already geocodes; no routing service. This module is a lazy chunk (next/dynamic,
// ssr:false) and Leaflet JS loads on mount. The map is created once; pins and lines
// update in place. It fits the pins on load and whenever `fitKey` changes. Without a
// tile URL the pins sit on the plain background with the "Street map is off" note.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Marker HTML is a string: only a hex or a `var(--token)` color gets in. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\))$/i;
const safeColor = (c: string) => (SAFE_COLOR.test(c) ? c : "var(--sys-gray)");

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const pinSize = (selected: boolean, compact: boolean) =>
  selected ? (compact ? 32 : 36) : compact ? 24 : 28;

function pinHtml(p: RoutePin, selected: boolean, compact: boolean): string {
  const s = pinSize(selected, compact);
  const color = safeColor(p.color);
  const font = selected ? 15 : compact ? 11 : 13;
  const ring = selected
    ? `,0 0 0 5px color-mix(in srgb,${color} 32%,transparent)`
    : "";
  // A visited stop is faded but opaque, so the route line never shows through its number.
  const fill =
    p.done && !selected ? `color-mix(in srgb,${color} 55%,var(--card))` : color;
  return `<span style="display:flex;width:${s}px;height:${s}px;align-items:center;justify-content:center;border-radius:9999px;background:${fill};color:#fff;font:700 ${font}px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;border:2px solid #fff;box-shadow:0 1px 4px rgb(0 0 0/.35)${ring}">${esc(p.label)}</span>`;
}

/** Leaflet writes `color` into an SVG attribute; CSS variables need the style property. */
function paint(line: Leaflet.Polyline, color: string) {
  const el = line.getElement() as SVGElement | undefined;
  if (el) el.style.stroke = color;
}

export default function RouteMap({
  pins,
  lines,
  selectedJobId = null,
  onSelect,
  fitKey = "",
  tileUrl,
  attribution,
  canSetup = false,
  compact = false,
  label,
  className,
}: {
  pins: readonly RoutePin[];
  lines: readonly RouteLine[];
  selectedJobId?: string | null;
  onSelect?: (jobId: string) => void;
  /** Refit to the pins whenever this changes (day, tech filter). */
  fitKey?: string;
  tileUrl: string;
  attribution: string;
  /** Admins see how to turn the street map on; everyone else a plain note. */
  canSetup?: boolean;
  /** Small card: smaller pins, no zoom buttons, no wheel zoom, two-finger pan on touch. */
  compact?: boolean;
  /** Accessible name of the map. */
  label: string;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const paths = useRef(new Map<string, [Leaflet.Polyline, Leaflet.Polyline]>());
  const fitted = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const latest = useRef({ pins, lines, selectedJobId, fitKey, compact });
  latest.current = { pins, lines, selectedJobId, fitKey, compact };

  const sync = () => {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    const {
      pins: ps,
      lines: ls,
      selectedJobId: sel,
      fitKey: fk,
    } = latest.current;
    const c = latest.current.compact;

    const seenLines = new Set<string>();
    for (const line of ls) {
      seenLines.add(line.key);
      const color = safeColor(line.color);
      const cur = paths.current.get(line.key);
      if (cur) {
        cur[0].setLatLngs(line.points);
        cur[1].setLatLngs(line.points);
        paint(cur[1], color);
        continue;
      }
      const shared = {
        interactive: false,
        lineCap: "round",
        lineJoin: "round",
      } as const;
      // A light casing under the dashed line keeps it readable on busy tiles.
      const casing = lib
        .polyline(line.points, {
          ...shared,
          color: "#ffffff",
          weight: c ? 6 : 7,
          opacity: 0.8,
        })
        .addTo(m);
      const dash = lib
        .polyline(line.points, {
          ...shared,
          color: "#8e8e93",
          weight: c ? 3 : 3.5,
          opacity: 0.95,
          dashArray: c ? "6 7" : "8 9",
        })
        .addTo(m);
      paint(casing, "var(--card)");
      paint(dash, color);
      paths.current.set(line.key, [casing, dash]);
    }
    for (const [k, pair] of paths.current)
      if (!seenLines.has(k)) {
        pair[0].remove();
        pair[1].remove();
        paths.current.delete(k);
      }

    const seen = new Set<string>();
    for (const p of ps) {
      seen.add(p.key);
      const isSel = p.jobId === sel;
      const s = pinSize(isSel, c);
      const icon = lib.divIcon({
        className: "map-pin",
        html: pinHtml(p, isSel, c),
        iconSize: [s, s],
        iconAnchor: [s / 2 - p.dx, s / 2],
      });
      const z = isSel ? 1000 : p.done ? -100 : 0;
      let mk = markers.current.get(p.key);
      if (mk) {
        mk.setLatLng([p.lat, p.lng]);
        mk.setIcon(icon);
        mk.setZIndexOffset(z);
      } else {
        const jobId = p.jobId;
        mk = lib
          .marker([p.lat, p.lng], {
            icon,
            keyboard: true,
            riseOnHover: true,
            zIndexOffset: z,
          })
          .on("click", () => onSelectRef.current?.(jobId))
          .addTo(m);
        // Leaflet gives the pin role="button" but only maps Enter to popups:
        // Enter and Space press it here.
        mk.getElement()?.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (!e.repeat) onSelectRef.current?.(jobId);
        });
        markers.current.set(p.key, mk);
      }
      const node = mk.getElement();
      if (node) {
        node.title = p.title;
        node.setAttribute("aria-label", p.title);
        if (!c) node.setAttribute("aria-pressed", String(isSel));
      }
    }
    for (const [k, mk] of markers.current)
      if (!seen.has(k)) {
        mk.remove();
        markers.current.delete(k);
      }

    if (fitted.current !== fk && ps.length > 0) {
      const first = fitted.current === null;
      fitted.current = fk;
      const animate = !first && !reducedMotion();
      if (ps.length === 1) {
        const only = ps[0] as RoutePin;
        m.setView([only.lat, only.lng], 14, { animate });
      } else {
        const pad = c ? 28 : 56;
        const pts = ps.map((p): [number, number] => [p.lat, p.lng]);
        m.fitBounds(lib.latLngBounds(pts), {
          padding: [pad, pad],
          maxZoom: 15,
          animate,
        });
      }
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: create the map once
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const mod = await import("leaflet");
      const lib =
        (mod as unknown as { default?: typeof Leaflet }).default ?? mod;
      if (cancelled || !el.current) return;
      L.current = lib;
      const still = reducedMotion();
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const m = lib.map(el.current, {
        zoomControl: false,
        center: [39.5, -98.35],
        zoom: 4,
        zoomAnimation: !still,
        fadeAnimation: !still,
        markerZoomAnimation: !still,
        inertia: !still,
        // In the page-embedded card a one-finger swipe scrolls the page; pinch still zooms.
        scrollWheelZoom: !compact,
        dragging: !(compact && touch),
      });
      if (!compact) lib.control.zoom({ position: "bottomright" }).addTo(m);
      if (tileUrl)
        lib
          .tileLayer(tileUrl, { attribution, maxZoom: 19, detectRetina: true })
          .addTo(m);
      map.current = m;
      ro = new ResizeObserver(() => m.invalidateSize({ pan: false }));
      ro.observe(el.current);
      sync();
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      markers.current.clear();
      paths.current.clear();
      fitted.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync reads the latest props via ref
  useEffect(() => {
    sync();
  }, [pins, lines, selectedJobId, fitKey]);

  // Keep the selected stop in view, clear of the selected-stop card at the bottom.
  useEffect(() => {
    const m = map.current;
    if (!m || !selectedJobId) return;
    const p = latest.current.pins.find((x) => x.jobId === selectedJobId);
    if (!p) return;
    m.panInside([p.lat, p.lng], {
      paddingTopLeft: [40, 40],
      paddingBottomRight: [40, latest.current.compact ? 40 : 180],
      animate: !reducedMotion(),
    });
  }, [selectedJobId]);

  return (
    <div className={cx("map-view relative overflow-hidden", className)}>
      <div
        ref={el}
        role="application"
        aria-label={label}
        className="isolate size-full"
        // leaflet.css is unlayered, so its #ddd beats the layered `.map-view
        // .leaflet-container` rule: stay see-through so the parent's themed
        // fill shows when there are no tiles (dark mode too).
        style={{ background: "transparent" }}
      />
      {!tileUrl && (
        <p className="absolute inset-x-0 top-2 z-10 mx-auto w-fit max-w-[calc(100%-24px)] rounded-full bg-card px-3 py-1 text-center text-footnote text-label-2 shadow-card">
          {canSetup ? (
            <>
              Street map is off.{" "}
              <a href="/settings/integrations" className="text-accent-text">
                Set it up
              </a>
            </>
          ) : (
            "Street map isn’t available"
          )}
        </p>
      )}
    </div>
  );
}
