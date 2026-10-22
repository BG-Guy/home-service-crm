"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import { cx } from "@/ui/cx";
import {
  drawArrows,
  drawRoute,
  type LatLng,
  ROUTE_CSS,
  styleRoute,
} from "../route-draw";

// Route map for the Assign hub (/dispatch): every tech's day as a straight-line
// route in their color, drawn like the schedule map's (../route-draw.ts: cased
// line, direction chevrons, the picked tech's route on top and the rest faded),
// with numbered stop pins, the job being assigned as an accent pin, and the
// recommended insertion as a dashed detour. Same Leaflet setup as TechMap (lazy
// chunk via next/dynamic ssr:false, L.divIcon pins, no tiles unless a street map
// is set: NEXT_PUBLIC_TILE_URL or Settings → Map). Bounds auto-fit to the selection.

export interface RouteMapStop {
  id: string;
  seq: number;
  lat: number;
  lng: number;
  label: string;
  done: boolean;
}
export interface RouteMapRoute {
  techId: string;
  name: string;
  color: string;
  initials: string;
  start: { lat: number; lng: number } | null;
  stops: RouteMapStop[];
}
export interface RouteMapProps {
  routes: readonly RouteMapRoute[];
  selected: string | null;
  job: { lat: number; lng: number; label: string } | null;
  /** Dashed detour for the selected (or recommended) tech: prev → job → next. */
  proposal: {
    techId: string;
    from: { lat: number; lng: number } | null;
    to: { lat: number; lng: number } | null;
  } | null;
  onSelect: (techId: string) => void;
  tileUrl: string;
  attribution: string;
  canSetup?: boolean;
  className?: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function stopHtml(n: number, color: string, on: boolean, done: boolean) {
  const size = on ? 26 : 20;
  return `<span style="display:flex;width:${size}px;height:${size}px;align-items:center;justify-content:center;border-radius:9999px;background:${done && on ? "#fff" : color};color:${done && on ? color : "#fff"};font:700 ${on ? 12 : 10}px/1 system-ui,sans-serif;border:2px solid ${done && on ? color : "#fff"};box-shadow:0 1px 4px rgb(0 0 0/.35);opacity:${on ? 1 : 0.55}">${n}</span>`;
}
function startHtml(color: string, initials: string) {
  return `<span style="display:flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:9px;background:#fff;color:${color};font:700 11px/1 system-ui,sans-serif;border:2px solid ${color};box-shadow:0 1px 4px rgb(0 0 0/.3)">${esc(initials)}</span>`;
}
function jobHtml(label: string) {
  return `<span style="display:flex;flex-direction:column;align-items:center"><span style="display:flex;height:26px;padding:0 9px;align-items:center;justify-content:center;border-radius:9999px;background:var(--accent-fill,#0074d9);color:#fff;font:700 12px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 2px 8px rgb(0 0 0/.35);white-space:nowrap">${esc(label)}</span><span style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid var(--accent-fill,#0074d9);margin-top:-1px"></span></span>`;
}

export default function RouteMap({
  routes,
  selected,
  job,
  proposal,
  onSelect,
  tileUrl,
  attribution,
  canSetup = false,
  className,
}: RouteMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const arrowLayer = useRef<Leaflet.LayerGroup | null>(null);
  /** The drawn routes' points and fades, for the arrows (redrawn on zoom). */
  const drawn = useRef<{ color: string; points: LatLng[]; fade: boolean }[]>(
    [],
  );
  const fitKey = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const latest = useRef({ routes, selected, job, proposal });
  latest.current = { routes, selected, job, proposal };

  const draw = () => {
    const lib = L.current;
    const m = map.current;
    const g = layer.current;
    if (!lib || !m || !g) return;
    g.clearLayers();
    const { routes: rs, selected: sel, job: jb, proposal: pr } = latest.current;
    const focus: [number, number][] = [];
    const all: [number, number][] = [];
    // Unselected routes first so the selected one paints on top.
    const ordered = [...rs].sort(
      (a, b) => Number(a.techId === sel) - Number(b.techId === sel),
    );
    drawn.current = [];
    for (const r of ordered) {
      const on = !sel || r.techId === sel;
      const line: LatLng[] = [];
      if (r.start) line.push([r.start.lat, r.start.lng]);
      for (const s of r.stops) line.push([s.lat, s.lng]);
      all.push(...line);
      if (r.techId === sel) focus.push(...line);
      if (line.length > 1) {
        styleRoute(
          drawRoute(lib, g, line, r.color, () => onSelectRef.current(r.techId)),
          { focus: r.techId === sel, fade: !on },
        );
        drawn.current.push({ color: r.color, points: line, fade: !on });
      }
      if (r.start && r.techId === sel)
        lib
          .marker([r.start.lat, r.start.lng], {
            icon: lib.divIcon({
              className: "map-pin",
              html: startHtml(r.color, r.initials),
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            }),
            title: `${r.name}: start`,
            alt: `${r.name}: start`,
            zIndexOffset: 500,
          })
          .addTo(g);
      for (const s of r.stops) {
        const big = r.techId === sel;
        const size = big ? 26 : 20;
        lib
          .marker([s.lat, s.lng], {
            icon: lib.divIcon({
              className: "map-pin",
              html: stopHtml(s.seq, r.color, on, s.done),
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
            }),
            title: `${r.name} · stop ${s.seq}: ${s.label}`,
            alt: `${r.name} stop ${s.seq}`,
            keyboard: true,
            riseOnHover: true,
            zIndexOffset: big ? 800 : 0,
          })
          .on("click", () => onSelectRef.current(r.techId))
          .addTo(g);
      }
    }
    if (jb) {
      all.push([jb.lat, jb.lng]);
      focus.push([jb.lat, jb.lng]);
      const route = rs.find((r) => r.techId === pr?.techId);
      if (pr && route) {
        const pts: [number, number][] = [];
        if (pr.from) pts.push([pr.from.lat, pr.from.lng]);
        pts.push([jb.lat, jb.lng]);
        if (pr.to) pts.push([pr.to.lat, pr.to.lng]);
        if (pts.length > 1)
          lib
            .polyline(pts, {
              color: route.color,
              weight: 4,
              opacity: 0.95,
              dashArray: "2 9",
              lineCap: "round",
              interactive: false,
            })
            .addTo(g);
      }
      lib
        .marker([jb.lat, jb.lng], {
          icon: lib.divIcon({
            className: "map-pin",
            html: jobHtml(jb.label),
            iconSize: [80, 34],
            iconAnchor: [40, 34],
          }),
          title: `Job to assign: ${jb.label}`,
          alt: `Job to assign: ${jb.label}`,
          zIndexOffset: 2000,
        })
        .addTo(g);
    }
    // Re-fit only when the selection (or the data set) changes.
    const key = `${sel ?? "all"}|${jb ? `${jb.lat},${jb.lng}` : ""}|${rs.length}`;
    if (key !== fitKey.current) {
      fitKey.current = key;
      const use = sel && focus.length > 1 ? focus : all.length ? all : focus;
      // No animation: a refit can land while the previous one is still
      // zooming (a refresh right after an assign), and Leaflet then ends off.
      m.stop();
      if (use.length === 1)
        m.setView(use[0] as [number, number], 13, { animate: false });
      else if (use.length > 1)
        m.fitBounds(lib.latLngBounds(use), {
          // Room for the "Street map is off" note and the job label on top.
          paddingTopLeft: [40, 72],
          paddingBottomRight: [56, 40],
          maxZoom: 14,
          animate: false,
        });
    }
    const al = arrowLayer.current;
    if (al) drawArrows(lib, m, al, drawn.current);
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
      const m = lib.map(el.current, {
        zoomControl: false,
        zoomSnap: 0.25,
        center: [39.5, -98.35],
        zoom: 4,
      });
      lib.control.zoom({ position: "bottomright" }).addTo(m);
      if (tileUrl)
        lib
          .tileLayer(tileUrl, { attribution, maxZoom: 19, detectRetina: true })
          .addTo(m);
      layer.current = lib.layerGroup().addTo(m);
      arrowLayer.current = lib.layerGroup().addTo(m);
      map.current = m;
      draw();
      // Arrows depend on the zoom (legs too short on screen get none).
      m.on("zoomend", () => {
        const al = arrowLayer.current;
        if (al) drawArrows(lib, m, al, drawn.current);
      });
      // The map lives in a column that can be hidden (phone list) or resized
      // (tablet ↔ desktop): keep Leaflet's size in step, and re-fit on reveal.
      let last = "";
      ro = new ResizeObserver(([entry]) => {
        const r = entry?.contentRect;
        const size = r ? `${Math.round(r.width)}x${Math.round(r.height)}` : "";
        if (!r || r.width === 0 || r.height === 0 || size === last) return;
        last = size;
        m.invalidateSize();
        fitKey.current = null;
        draw();
      });
      ro.observe(el.current);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      layer.current = null;
      arrowLayer.current = null;
      fitKey.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: draw reads the latest props via ref
  useEffect(() => {
    draw();
  }, [routes, selected, job, proposal]);

  return (
    <div className={cx("map-view relative overflow-hidden", className)}>
      <style href="map-routes" precedence="default">
        {ROUTE_CSS}
      </style>
      <div
        ref={el}
        role="application"
        aria-label="Map of technician routes for the day"
        className="size-full"
        // Beats leaflet.css's #ddd (loaded later, in this chunk) in dark mode.
        style={{ background: "var(--card-2)" }}
      />
      {!tileUrl && (
        <p
          style={{ zIndex: 500 }}
          className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit max-w-[calc(100%-24px)] rounded-full bg-card px-3 py-1 text-center text-footnote text-label-2 shadow-card"
        >
          {canSetup ? (
            <>
              Street map is off.{" "}
              <a
                href="/settings/map"
                style={{ pointerEvents: "auto" }}
                className="text-accent-text"
              >
                Set it up
              </a>
            </>
          ) : (
            "Street map is off"
          )}
        </p>
      )}
    </div>
  );
}
