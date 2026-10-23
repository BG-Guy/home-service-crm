"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import type { Rect } from "@/lib/declutter";
import { PIN_CSS } from "./map-css";
import {
  DOT,
  fanOut,
  jobHtml,
  layoutPins,
  PIN,
  pinHtml,
  pinLabel,
  pinPriority,
  pinRing,
  pulseIds,
  ringColor,
  tagSide,
} from "./pins";
import type { LeadsMapJob, LeadsMapPoint } from "./types";

// The lead map's Leaflet canvas (its own lazy chunk: next/dynamic ssr:false from
// LeadsMap; Leaflet itself loads on mount, like the schedule map's MapCanvas and
// the Assign hub's RouteMap). Lead pins are divIcons built once per lead; the
// clock (timer rings), the selection, the pulses and the zoom only flip CSS
// variables and data attributes. Overlapping pins fold to dots by the shared
// declutter rule (./pins.ts); the selected or hovered pin gets a name tag on the
// first free side. Today's jobs are small squares under the pins, with their
// label in a tooltip. Styles: PIN_CSS (shipped here, with the code that draws).

export interface LeadsMapCanvasProps {
  points: readonly LeadsMapPoint[];
  jobs: readonly LeadsMapJob[];
  selected: string | null;
  /** The shared 15 s clock (null until hydrated): timer rings and pulses. */
  now: number | null;
  /** Pixels covered at the top (notes, the expand button) and the bottom (drawer, pill). */
  coverTop: number;
  coverBottom: number;
  /** Lift the bottom controls (attribution) above `coverBottom` (the drawer, the pill). */
  liftControls?: boolean;
  zoomControl: boolean;
  tileUrl: string;
  attribution: string;
  /** The map's accessible name. */
  label: string;
  onPick: (id: string) => void;
  onClear: () => void;
  onHover?: (id: string | null) => void;
}

type PinMk = {
  m: Leaflet.Marker;
  key: string;
  p: LeadsMapPoint;
  dx: number;
  prio: number;
  /** The name tag's size, measured once it is drawn. */
  tw: number;
  th: number;
};

/** Below this much visible map, don't fit or pan (the drawer covers it). */
const MIN_VISIBLE = 120;

export default function LeadsMapCanvas(props: LeadsMapCanvasProps) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const pins = useRef(new Map<string, PinMk>());
  const jobs = useRef(new Map<string, { m: Leaflet.Marker; key: string }>());
  const hover = useRef<string | null>(null);
  const auto = useRef(false);
  const userMoved = useRef(false);
  const dataKey = useRef<string | null>(null);
  const p = useRef(props);
  p.current = props;

  const nodeOf = (id: string) =>
    (pins.current.get(id)?.m.getElement()?.firstElementChild ??
      null) as HTMLElement | null;

  /** Markers: (re)create only the pins and jobs whose look changed. */
  const syncMarkers = () => {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    // The most urgent lead keeps the true spot when several share one.
    const ordered = [...p.current.points].sort(
      (a, b) => pinPriority(a) - pinPriority(b),
    );
    const fan = fanOut(ordered);
    const keep = new Set<string>();
    const fresh: PinMk[] = [];
    for (const pt of ordered) {
      const dx = fan.get(pt.id) ?? 0;
      const key = `${pt.lat},${pt.lng},${dx},${pt.initials},${pt.name},${pt.seed ?? ""}`;
      keep.add(pt.id);
      const cur = pins.current.get(pt.id);
      if (cur && cur.key === key) {
        cur.p = pt;
        cur.prio = pinPriority(pt);
        continue;
      }
      cur?.m.remove();
      const mk = lib
        .marker([pt.lat, pt.lng], {
          icon: lib.divIcon({
            className: "lm-pin",
            html: pinHtml(pt, dx),
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          title: pt.name,
          keyboard: true,
          riseOnHover: true,
          riseOffset: 50_000,
        })
        .on("click", () => p.current.onPick(pt.id))
        .on("mouseover", () => setHover(pt.id))
        .on("mouseout", () => setHover(null))
        .addTo(m);
      const made: PinMk = {
        m: mk,
        key,
        p: pt,
        dx,
        prio: pinPriority(pt),
        tw: 80,
        th: 22,
      };
      pins.current.set(pt.id, made);
      fresh.push(made);
    }
    for (const [id, mk] of pins.current)
      if (!keep.has(id)) {
        mk.m.remove();
        pins.current.delete(id);
      }
    // Measure the new name tags in one layout pass (drawn hidden for a moment).
    const nodes = fresh.map(
      (f) => f.m.getElement()?.firstElementChild as HTMLElement | undefined,
    );
    for (const n of nodes) n?.setAttribute("data-measure", "");
    fresh.forEach((f, i) => {
      const t = nodes[i]?.querySelector<HTMLElement>(".lm-tag");
      if (t?.offsetWidth) {
        f.tw = t.offsetWidth;
        f.th = t.offsetHeight;
      }
    });
    for (const n of nodes) n?.removeAttribute("data-measure");

    const seenJobs = new Set<string>();
    for (const j of p.current.jobs) {
      seenJobs.add(j.id);
      const key = `${j.lat},${j.lng},${j.state ?? ""},${j.label}`;
      const cur = jobs.current.get(j.id);
      if (cur?.key === key) continue;
      cur?.m.remove();
      const mk = lib
        .marker([j.lat, j.lng], {
          icon: lib.divIcon({
            className: "lm-pin",
            html: jobHtml(j),
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          keyboard: false,
          zIndexOffset: -100_000,
        })
        .bindTooltip(j.label, {
          direction: "top",
          offset: [0, -12],
          className: "lm-tip",
        })
        .addTo(m);
      jobs.current.set(j.id, { m: mk, key });
    }
    for (const [id, j] of jobs.current)
      if (!seenJobs.has(id)) {
        j.m.remove();
        jobs.current.delete(id);
      }
  };

  /** Clock, selection, pulses and stacking (no rebuild), then the zoom layout. */
  const syncState = () => {
    const { selected, now, points } = p.current;
    const pulse = pulseIds(points, now);
    const order = [...pins.current.values()].sort((a, b) => a.prio - b.prio);
    order.forEach((mk, i) => {
      const id = mk.p.id;
      const node = nodeOf(id);
      if (!node) return;
      const ring = pinRing(mk.p, now);
      const sel = id === selected;
      node.toggleAttribute("data-sel", sel);
      node.toggleAttribute("data-pulse", pulse.has(id) && !sel);
      node.dataset.ring = ring.progress > 0 ? "1" : "0";
      node.style.setProperty("--p", String(Math.round(ring.progress * 100)));
      node.style.setProperty("--t", ringColor(ring.tone));
      mk.m.getElement()?.setAttribute("aria-label", pinLabel(mk.p, now));
      // The most urgent pin on top; the selected and hovered ones above all.
      mk.m.setZIndexOffset(
        sel
          ? 400_000
          : id === hover.current
            ? 300_000
            : (order.length - i) * 1000,
      );
    });
    layout();
  };

  /** Zoom-dependent: which pins show full size, and the name tags. */
  const layout = () => {
    const m = map.current;
    if (!m) return;
    const { selected } = p.current;
    const spots = [...pins.current.values()].map((mk) => {
      const pt = m.latLngToContainerPoint([mk.p.lat, mk.p.lng]);
      return { id: mk.p.id, x: pt.x + mk.dx, y: pt.y, priority: mk.prio };
    });
    const full = layoutPins(spots, { zoom: m.getZoom(), selected });
    for (const s of spots) {
      const node = nodeOf(s.id);
      if (node) node.dataset.mode = full.has(s.id) ? "pin" : "dot";
    }
    // Tags: the selected pin first, then the hovered one, each clear of the
    // other pins, the job markers and the tags placed before it.
    const size = m.getSize();
    const rects: Rect[] = spots.map((s) => {
      const d = full.has(s.id) ? PIN : DOT;
      return { l: s.x - d / 2, r: s.x + d / 2, t: s.y - d / 2, b: s.y + d / 2 };
    });
    for (const j of jobs.current.values()) {
      const pt = m.latLngToContainerPoint(j.m.getLatLng());
      rects.push({ l: pt.x - 9, r: pt.x + 9, t: pt.y - 9, b: pt.y + 9 });
    }
    const tagged = [selected, hover.current].filter(
      (id, i, a): id is string => !!id && a.indexOf(id) === i,
    );
    for (const mk of pins.current.values()) {
      const node = nodeOf(mk.p.id);
      if (node && !tagged.includes(mk.p.id)) delete node.dataset.tag;
    }
    for (const id of tagged) {
      const mk = pins.current.get(id);
      const node = nodeOf(id);
      const s = spots.find((x) => x.id === id);
      if (!mk || !node || !s) continue;
      const own = spots.indexOf(s);
      const side = tagSide(
        { id, x: s.x, y: s.y, full: full.has(id) },
        { w: mk.tw, h: mk.th },
        rects.filter((_, i) => i !== own),
        { w: size.x, h: size.y },
      );
      if (side) {
        node.dataset.tag = side;
        const r = (full.has(id) ? PIN : DOT) / 2 + 6;
        rects.push(
          side === "below"
            ? {
                l: s.x - mk.tw / 2,
                r: s.x + mk.tw / 2,
                t: s.y + r,
                b: s.y + r + mk.th,
              }
            : side === "above"
              ? {
                  l: s.x - mk.tw / 2,
                  r: s.x + mk.tw / 2,
                  t: s.y - r - mk.th,
                  b: s.y - r,
                }
              : side === "right"
                ? {
                    l: s.x + r,
                    r: s.x + r + mk.tw,
                    t: s.y - mk.th / 2,
                    b: s.y + mk.th / 2,
                  }
                : {
                    l: s.x - r - mk.tw,
                    r: s.x - r,
                    t: s.y - mk.th / 2,
                    b: s.y + mk.th / 2,
                  },
        );
      } else delete node.dataset.tag;
    }
  };

  const setHover = (id: string | null) => {
    if (hover.current === id) return;
    hover.current = id;
    p.current.onHover?.(id);
    syncState();
  };

  /** Room left for the map between the chrome on top and the drawer below. */
  const visible = () => {
    const m = map.current;
    if (!m) return null;
    const size = m.getSize();
    const top = p.current.coverTop;
    const bottom = size.y - p.current.coverBottom;
    return bottom - top >= MIN_VISIBLE && size.x >= MIN_VISIBLE
      ? { top, bottom, w: size.x }
      : null;
  };

  /** Fit every pin and job into the visible part (or a wide default view). */
  const fit = (animate: boolean) => {
    const lib = L.current;
    const m = map.current;
    const room = visible();
    if (!lib || !m || !room) return;
    // The leads are what the office came for: fit them (today's jobs only
    // when there are fewer than two leads to frame).
    const leadPts = p.current.points.map(
      (x) => [x.lat, x.lng] as [number, number],
    );
    const pts: [number, number][] =
      leadPts.length >= 2
        ? leadPts
        : [
            ...leadPts,
            ...p.current.jobs.map((x) => [x.lat, x.lng] as [number, number]),
          ];
    m.stop();
    auto.current = true;
    if (pts.length === 0) m.setView([39.5, -98.35], 4, { animate: false });
    else if (pts.length === 1)
      m.setView(pts[0] as [number, number], 13, { animate });
    else
      m.fitBounds(lib.latLngBounds(pts), {
        paddingTopLeft: [36, room.top + 20],
        paddingBottomRight: [36, m.getSize().y - room.bottom + 28],
        maxZoom: 14,
        animate,
      });
    auto.current = false;
    userMoved.current = false;
  };

  /**
   * Keep the selected pin in the part of the map nothing covers: a pan (never a
   * zoom), and none when it is already comfortably inside.
   */
  const focusSelected = (animate: boolean) => {
    const m = map.current;
    const id = p.current.selected;
    const mk = id ? pins.current.get(id) : null;
    const room = visible();
    if (!m || !mk || !room) return;
    const pt = m.latLngToContainerPoint([mk.p.lat, mk.p.lng]);
    const x = pt.x + mk.dx;
    const inset = 56;
    if (
      x > inset &&
      x < room.w - inset &&
      pt.y > room.top + inset &&
      pt.y < room.bottom - inset
    )
      return;
    m.stop();
    auto.current = true;
    m.panBy([x - room.w / 2, pt.y - (room.top + room.bottom) / 2], {
      animate,
      duration: 0.4,
      easeLinearity: 0.3,
    });
    auto.current = false;
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
      if (p.current.zoomControl)
        lib.control.zoom({ position: "topright" }).addTo(m);
      if (p.current.tileUrl)
        lib
          .tileLayer(p.current.tileUrl, {
            attribution: p.current.attribution,
            maxZoom: 19,
            detectRetina: true,
          })
          .addTo(m);
      map.current = m;
      m.on("click", () => p.current.onClear());
      // Pins fold and open up with the zoom; tags re-place after a move.
      m.on("zoomend moveend", layout);
      m.on("movestart", () => {
        if (!auto.current) userMoved.current = true;
      });
      syncMarkers();
      dataKey.current = keyOf(p.current);
      fit(false);
      syncState();
      let last = "";
      ro = new ResizeObserver(([e]) => {
        const r = e?.contentRect;
        if (!r || r.width === 0 || r.height === 0) return;
        const size = `${Math.round(r.width)}x${Math.round(r.height)}`;
        if (size === last) return;
        const first = last === "";
        last = size;
        m.invalidateSize({ animate: false });
        // A new size (rotation, full screen, the panel) re-fits unless the
        // user moved the map; a selected pin then stays in view.
        if (!first && !userMoved.current) fit(false);
        else if (p.current.selected) focusSelected(false);
        layout();
      });
      ro.observe(el.current);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      pins.current.clear();
      jobs.current.clear();
    };
  }, []);

  // New data (a lead came in, one was booked): new markers; re-fit unless the
  // user moved the map.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads the latest props via ref
  useEffect(() => {
    if (!map.current) return;
    syncMarkers();
    const key = keyOf(props);
    if (key !== dataKey.current) {
      dataKey.current = key;
      if (!userMoved.current) fit(true);
    }
    syncState();
  }, [props.points, props.jobs]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads the latest props via ref
  useEffect(() => {
    syncState();
  }, [props.selected, props.now]);

  // A new selection: once the layout settles, pan it into the visible part.
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
  }, [props.selected]);

  // The drawer moved: make room (a re-fit unless the user moved the map), else
  // keep the selected pin in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a cover change
  useEffect(() => {
    if (!map.current) return;
    if (!userMoved.current) fit(true);
    else focusSelected(true);
  }, [props.coverBottom, props.coverTop]);

  return (
    <div
      className="lm-canvas map-view"
      style={{
        ["--lm-cover" as string]: `${props.liftControls ? props.coverBottom : 0}px`,
      }}
    >
      <style href="leads-map-pins" precedence="default">
        {PIN_CSS}
      </style>
      <div
        ref={el}
        role="application"
        aria-label={props.label}
        className="size-full"
        // Beats leaflet.css's #ddd (loaded later, in this chunk) in dark mode.
        style={{ background: "var(--card-2)" }}
      />
    </div>
  );
}

/** The data identity (ids and places): a change re-fits an untouched map. */
function keyOf(p: Pick<LeadsMapCanvasProps, "points" | "jobs">): string {
  return [
    ...p.points.map((x) => `${x.id}@${x.lat},${x.lng}`),
    ...p.jobs.map((x) => `${x.id}@${x.lat},${x.lng}`),
  ]
    .sort()
    .join("|");
}
