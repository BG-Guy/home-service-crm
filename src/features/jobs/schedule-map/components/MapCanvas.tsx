"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import {
  drawArrows,
  drawRoute,
  ROUTE_CSS,
  styleRoute,
} from "@/features/map/route-draw";
import { declutter, type PlaceItem } from "@/lib/declutter";
import { MARKER_CSS } from "./marker-css";

// Schedule map canvas (lazy chunk via next/dynamic ssr:false; Leaflet loads on
// mount). Job markers are window boxes in the tech's color that collapse to
// numbered dots below zoom 10 or where boxes would overlap (greedy, by priority;
// hover or select expands one). One polyline per tech (start → stops in window
// order) with a chevron at every leg's midpoint. Markers are created when the
// data changes; selection, hover and isolation only flip data attributes, so a
// click repaints nothing else. Styles: map-css.ts (route-local).

export interface CanvasStop {
  id: string;
  lat: number;
  lng: number;
  /** The primary tech's color; gray for unassigned. */
  color: string;
  seq: number | null;
  /** "8–10" */
  win: string;
  /** "Dana W." */
  name: string;
  techId: string | null;
  /** Space-separated: done, live, late, un. */
  st: string;
  /** Accessible name. */
  label: string;
  startMin: number;
}

export interface CanvasRoute {
  techId: string;
  name: string;
  color: string;
  start: { lat: number; lng: number } | null;
  /** Start (when known) then every located stop, in route order. */
  points: readonly [number, number][];
}

export interface MapCanvasProps {
  stops: readonly CanvasStop[];
  routes: readonly CanvasRoute[];
  selected: string | null;
  hovered: string | null;
  /** Isolated tech: everyone else fades to 25%. */
  iso: string | null;
  /** The emphasized route (the selected job's tech, else the isolated one). */
  focusTech: string | null;
  /** Live stops allowed to pulse (at most two per screen, M12). */
  pulse: ReadonlySet<string>;
  /** Re-fit the bounds when this changes (day, isolation). */
  fitKey: string;
  /** Every tech's home base: the view for a day without located stops. */
  homes: readonly [number, number][];
  /** Pixels covered on the right by the details drawer (tablet). */
  padRight: number;
  /** Share of the viewport covered at the bottom by the details sheet (phone). */
  coverBottom: number;
  tileUrl: string;
  attribution: string;
  setupHref: string | null;
  onSelect: (id: string | null) => void;
  onIso: (techId: string) => void;
  onHover: (id: string | null) => void;
}

const BOX_H = 42;
const TAIL = 7;
const DOT = 28;
const GAP = 6;
const HOME = 26;
const MIN_BOX_ZOOM = 10;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CHECK =
  '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style="flex:none"><path d="M2.5 6.3 5 8.6l4.5-5" fill="none" style="stroke:currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HOUSE =
  '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" style="fill:currentColor"/></svg>';

function stopHtml(s: CanvasStop, dx: number): string {
  const done = s.st.includes("done");
  const num = done ? CHECK : s.seq != null ? String(s.seq) : "";
  const top = `${
    s.seq != null ? `${done ? CHECK : ""}${s.seq} · ${esc(s.win)}` : esc(s.win)
  }${s.st.includes("late") ? '<span class="sm-late">Late</span>' : ""}`;
  return `<div class="sm-m" data-st="${s.st}" style="--c:${esc(s.color)};left:${dx}px"><span class="sm-dot">${num}</span><span class="sm-box"><span class="sm-b1">${top}</span><span class="sm-b2">${esc(s.name)}</span></span></div>`;
}

/** Box width estimate for decluttering (12 px bold / 11 px text). */
const boxWidth = (s: CanvasStop) =>
  Math.min(
    136,
    Math.max(
      60,
      22 +
        Math.max(
          6.6 * ((s.seq != null ? `${s.seq} · ` : "").length + s.win.length) +
            (s.st.includes("late") ? 34 : 0),
          5.9 * s.name.length,
        ),
    ),
  );

type Mk = {
  m: Leaflet.Marker;
  key: string;
  s: CanvasStop;
  dx: number;
  /** Measured size of the expanded box (an estimate until drawn). */
  w: number;
  h: number;
};

export default function MapCanvas(props: MapCanvasProps) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const marks = useRef(new Map<string, Mk>());
  const routeLayer = useRef<Leaflet.LayerGroup | null>(null);
  const arrowLayer = useRef<Leaflet.LayerGroup | null>(null);
  const lines = useRef(
    new Map<
      string,
      {
        casing: Leaflet.Polyline;
        line: Leaflet.Polyline;
        start?: Leaflet.Marker;
      }
    >(),
  );
  const fitted = useRef<string | null>(null);
  const auto = useRef(false);
  const userMoved = useRef(false);
  const hoverEl = useRef<string | null>(null);
  const p = useRef(props);
  p.current = props;

  const elOf = (id: string) =>
    (marks.current.get(id)?.m.getElement()?.firstElementChild ??
      null) as HTMLElement | null;

  /** Markers: (re)create only the stops whose look changed. */
  const syncMarkers = () => {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    const { stops } = p.current;
    // Same spot (two jobs at one address): fan the duplicates out sideways.
    const seenAt = new Map<string, number>();
    const keep = new Set<string>();
    const fresh: Mk[] = [];
    for (const s of stops) {
      const at = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      const k = seenAt.get(at) ?? 0;
      seenAt.set(at, k + 1);
      const dx = k * 26;
      const key = `${s.lat},${s.lng},${dx},${s.color},${s.seq},${s.win},${s.name},${s.st},${s.label}`;
      keep.add(s.id);
      const cur = marks.current.get(s.id);
      if (cur && cur.key === key) {
        cur.s = s;
        continue;
      }
      cur?.m.remove();
      const mk = lib
        .marker([s.lat, s.lng], {
          icon: lib.divIcon({
            className: "sm-pin",
            html: stopHtml(s, dx),
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          title: s.label,
          alt: s.label,
          keyboard: true,
          riseOnHover: true,
          riseOffset: 20000,
        })
        .on("click", () => p.current.onSelect(s.id))
        .on("mouseover", () => p.current.onHover(s.id))
        .on("mouseout", () => p.current.onHover(null))
        .addTo(m);
      const made: Mk = { m: mk, key, s, dx, w: boxWidth(s), h: BOX_H };
      marks.current.set(s.id, made);
      fresh.push(made);
    }
    for (const [id, mk] of marks.current)
      if (!keep.has(id)) {
        mk.m.remove();
        marks.current.delete(id);
      }
    // Measure the new boxes in one layout pass (drawn hidden for a moment), so
    // decluttering works with their real size, not a guess.
    const nodes = fresh.map(
      (f) => f.m.getElement()?.firstElementChild as HTMLElement | undefined,
    );
    for (const n of nodes) n?.setAttribute("data-measure", "");
    fresh.forEach((f, i) => {
      const b = nodes[i]?.querySelector<HTMLElement>(".sm-box");
      if (b?.offsetWidth) {
        f.w = b.offsetWidth;
        f.h = b.offsetHeight;
      }
    });
    for (const n of nodes) n?.removeAttribute("data-measure");
  };

  /** Routes: one cased polyline per tech and its start (home base) pin. */
  const syncRoutes = () => {
    const lib = L.current;
    const rl = routeLayer.current;
    if (!lib || !rl) return;
    const { routes } = p.current;
    rl.clearLayers();
    lines.current.clear();
    for (const r of routes) {
      if (r.points.length < 2 && !r.start) continue;
      const { casing, line } = drawRoute(lib, rl, r.points, r.color, () =>
        p.current.onIso(r.techId),
      );
      let start: Leaflet.Marker | undefined;
      if (r.start)
        start = lib
          .marker([r.start.lat, r.start.lng], {
            icon: lib.divIcon({
              className: "sm-pin",
              html: `<span class="sm-start" style="--c:${esc(r.color)}">${HOUSE}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
            title: `${r.name}: start (home base)`,
            alt: `${r.name}: start`,
            keyboard: false,
            interactive: false,
            zIndexOffset: -2000,
          })
          .addTo(rl);
      lines.current.set(r.techId, { casing, line, start });
    }
  };

  /** Stacking: selected, then hovered, the isolated tech, others; faded last. */
  const zOf = (id: string, mk: Mk) => {
    const { selected, iso } = p.current;
    if (id === selected) return 12000;
    if (id === hoverEl.current) return 11000;
    if (iso && mk.s.techId !== iso) return -1000;
    return iso ? 1000 : 0;
  };

  /** Selection / isolation: emphasis, fades, pulses, z-order, then declutter. */
  const syncState = () => {
    const m = map.current;
    if (!m) return;
    const { selected, iso, focusTech, pulse } = p.current;
    for (const [id, mk] of marks.current) {
      const node = elOf(id);
      if (!node) continue;
      const sel = id === selected;
      const fade = !!iso && mk.s.techId !== iso && !sel;
      node.toggleAttribute("data-sel", sel);
      node.toggleAttribute("data-fade", fade);
      node.toggleAttribute("data-pulse", pulse.has(id) && !fade);
      node.toggleAttribute("data-hover", id === hoverEl.current);
      mk.m.setZIndexOffset(zOf(id, mk));
    }
    for (const [techId, r] of lines.current) {
      const fade = !!iso && techId !== iso;
      styleRoute(r, { focus: techId === focusTech, fade });
      const s = r.start?.getElement()?.firstElementChild;
      s?.toggleAttribute("data-fade", fade);
    }
    layoutLabels();
  };

  /** Zoom-dependent: which markers show boxes, and the leg arrows. */
  const layoutLabels = () => {
    const lib = L.current;
    const m = map.current;
    const al = arrowLayer.current;
    if (!lib || !m || !al) return;
    const { selected, iso, routes } = p.current;
    const items: PlaceItem[] = [];
    for (const [id, mk] of marks.current) {
      if (iso && mk.s.techId !== iso && id !== selected) continue;
      const pt = m.latLngToContainerPoint([mk.s.lat, mk.s.lng]);
      items.push({
        id,
        x: pt.x + mk.dx,
        y: pt.y,
        w: mk.w,
        h: mk.h,
        priority:
          (mk.s.st.includes("live") ? 0 : mk.s.st.includes("done") ? 2 : 1) *
            10_000 +
          mk.s.startMin,
      });
    }
    const force = new Set<string>();
    if (selected) force.add(selected);
    const obstacles = routes.flatMap((r) =>
      r.start && (!iso || r.techId === iso)
        ? [{ ...m.latLngToContainerPoint([r.start.lat, r.start.lng]), d: HOME }]
        : [],
    );
    const boxes = declutter(items, {
      boxH: BOX_H,
      tail: TAIL,
      dot: DOT,
      gap: GAP,
      obstacles,
      bounds: { w: m.getSize().x - p.current.padRight, h: m.getSize().y },
      dotsOnly: m.getZoom() < MIN_BOX_ZOOM,
      force,
    });
    for (const id of marks.current.keys()) {
      const node = elOf(id);
      if (node) node.dataset.mode = boxes.has(id) ? "box" : "dot";
    }

    drawArrows(
      lib,
      m,
      al,
      routes.map((r) => ({
        color: r.color,
        points: r.points,
        fade: !!iso && r.techId !== iso,
      })),
    );
  };

  /** Hover (from the timeline or the map) expands one marker; no relayout. */
  const applyHover = (id: string | null) => {
    const prev = hoverEl.current;
    if (prev === id) return;
    hoverEl.current = id;
    for (const k of [prev, id]) {
      const mk = k ? marks.current.get(k) : null;
      if (!k || !mk) continue;
      elOf(k)?.toggleAttribute("data-hover", k === id);
      mk.m.setZIndexOffset(zOf(k, mk));
    }
  };

  /**
   * Center the selected stop in the part of the map nothing covers: the tablet
   * drawer on the right, the phone sheet at the bottom, the nav bar on top. A
   * pan only (never a zoom), and none when the stop is already near the middle.
   */
  const focusSelected = (animate: boolean) => {
    const m = map.current;
    const box = el.current;
    const id = p.current.selected;
    const mk = id ? marks.current.get(id) : null;
    if (!m || !box || !mk) return;
    const r = box.getBoundingClientRect();
    // The page's nav bar covers the top, except in full screen (hidden there).
    const bar = document.documentElement.hasAttribute("data-fullscreen")
      ? 0
      : (document
          .querySelector(".lt-bar[data-chrome], .nav-bar[data-chrome]")
          ?.getBoundingClientRect().bottom ?? 0);
    const top = Math.max(0, bar - r.top);
    const bottom = Math.min(
      r.height,
      window.innerHeight * (1 - p.current.coverBottom) - r.top,
    );
    const right = r.width - p.current.padRight;
    if (bottom - top < 80 || right < 80) return;
    const pt = m.latLngToContainerPoint(mk.m.getLatLng());
    // The box sits above its point: aim a little below the middle.
    const dx = pt.x + mk.dx - right / 2;
    const dy = pt.y - (top + (bottom - top) * 0.6);
    if (Math.abs(dx) < right * 0.12 && Math.abs(dy) < (bottom - top) * 0.12)
      return;
    m.stop();
    auto.current = true;
    m.panBy([dx, dy], { animate, duration: 0.4, easeLinearity: 0.3 });
    auto.current = false;
  };

  const fit = (animate: boolean) => {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    const { routes, stops, iso, padRight } = p.current;
    let pts: [number, number][] = [];
    if (iso) pts = [...(routes.find((r) => r.techId === iso)?.points ?? [])];
    if (pts.length === 0) {
      pts = stops.map((s) => [s.lat, s.lng] as [number, number]);
      for (const r of routes)
        if (r.start && r.points.length > 1)
          pts.push([r.start.lat, r.start.lng]);
    }
    if (pts.length === 0) pts = [...p.current.homes];
    if (pts.length === 0) return;
    m.stop();
    auto.current = true;
    if (pts.length === 1)
      m.setView(pts[0] as [number, number], 13, { animate });
    else
      m.fitBounds(lib.latLngBounds(pts), {
        paddingTopLeft: [48, 64],
        paddingBottomRight: [48 + padRight, 40],
        maxZoom: 15,
        animate,
      });
    auto.current = false;
    userMoved.current = false;
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
        keyboard: false, // ← / → step through stops (ScheduleMapView)
        center: [39.5, -98.35],
        zoom: 4,
      });
      lib.control.zoom({ position: "bottomright" }).addTo(m);
      if (p.current.tileUrl)
        lib
          .tileLayer(p.current.tileUrl, {
            attribution: p.current.attribution,
            maxZoom: 19,
          })
          .addTo(m);
      routeLayer.current = lib.layerGroup().addTo(m);
      arrowLayer.current = lib.layerGroup().addTo(m);
      map.current = m;
      m.on("click", () => p.current.onSelect(null));
      // Boxes cut by the map edge fold to dots; re-place them after a move.
      m.on("zoomend moveend", layoutLabels);
      m.on("movestart", () => {
        if (!auto.current) userMoved.current = true;
      });
      syncMarkers();
      syncRoutes();
      fitted.current = p.current.fitKey;
      fit(false);
      syncState();
      let lastW = 0;
      ro = new ResizeObserver(([e]) => {
        const r = e?.contentRect;
        if (!r || r.width === 0 || r.height === 0) return;
        m.invalidateSize({ animate: false });
        // A layout change (panel, rotation) re-fits unless the user moved the
        // map or a job is open: then it only keeps that stop in view.
        const changed = Math.abs(r.width - lastW) > 60 && lastW > 0;
        lastW = r.width;
        if (p.current.selected) focusSelected(false);
        else if (changed && !userMoved.current) fit(false);
        layoutLabels();
      });
      ro.observe(el.current);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      marks.current.clear();
      lines.current.clear();
      fitted.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads the latest props via ref
  useEffect(() => {
    syncMarkers();
    syncState();
  }, [props.stops]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads the latest props via ref
  useEffect(() => {
    syncRoutes();
    syncState();
  }, [props.routes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads the latest props via ref
  useEffect(() => {
    syncState();
    if (fitted.current != null && fitted.current !== props.fitKey) {
      fitted.current = props.fitKey;
      fit(true);
    }
  }, [props.selected, props.iso, props.focusTech, props.pulse, props.fitKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads the latest props via ref
  useEffect(() => {
    applyHover(props.hovered);
  }, [props.hovered]);

  // A new selection: once the layout has settled (the tablet drawer opens and the
  // tech panel folds away), pan gently to center the stop in the visible part.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new selection
  useEffect(() => {
    if (!props.selected) return;
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => focusSelected(true));
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [props.selected, props.padRight, props.coverBottom]);

  return (
    <div className="sm-canvas map-view">
      <style href="schedule-map-markers" precedence="default">
        {MARKER_CSS}
      </style>
      <style href="map-routes" precedence="default">
        {ROUTE_CSS}
      </style>
      <div
        ref={el}
        role="application"
        aria-label="Map of the day's jobs and technician routes"
        className="size-full"
        style={{ background: "var(--card-2)" }}
      />
      {!props.tileUrl && (
        <p className="sm-off pointer-events-none rounded-full bg-card px-3 py-1 text-center text-footnote text-label-2 shadow-card">
          {props.setupHref ? (
            <>
              Street map is off.{" "}
              <a
                href={props.setupHref}
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
