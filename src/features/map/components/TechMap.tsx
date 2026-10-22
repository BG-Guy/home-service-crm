"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import {
  declutter,
  type LabelItem,
  labelRect,
  type PlaceItem,
  placeLabels,
  type Rect,
  square,
} from "@/lib/declutter";
import { cx } from "@/ui/cx";
import type { LiveJob, LiveTech } from "../contracts";
import {
  HALO_MIN_ACCURACY_M,
  type Staleness,
  type TechMapStatus,
} from "../rules";

// Live tech map (SPEC M19): Leaflet with L.divIcon markers — initials in the tech's
// color with a status ring, staleness fade, an accuracy halo above 100 m, and job
// pins colored by status. Leaflet JS loads on mount; this module itself is a lazy
// chunk (next/dynamic, ssr:false). The map is created once and follows its box
// (ResizeObserver → invalidateSize). Markers are zero-size anchors drawn by CSS
// (TM_CSS, in this chunk). Tech avatars always sit above job pins. Job pins
// declutter like the schedule map's boxes (src/lib/declutter.ts): a pin's number
// box shows only where it covers no other pin, avatar or name tag and isn't cut
// by the map edge, else it folds to a dot (zooming in expands them again; a dot
// under its tech's avatar hides). `wall` (wall mode): each tech's first name on a
// tag, on the first side that covers nothing (else hidden), and on a screen
// ≥ 1200 px wide (an office TV) bigger markers.

export type MapTech = LiveTech & { staleness: Staleness };

const RING: Record<TechMapStatus, string> = {
  on_job: "var(--sys-green)",
  en_route: "var(--sys-teal)",
  idle: "var(--sys-orange)",
  off: "var(--sys-gray)",
};
const JOB_TONE: Record<string, string> = {
  scheduled: "var(--sys-blue)",
  confirmed: "var(--sys-indigo)",
  en_route: "var(--sys-teal)",
  arrived: "var(--sys-purple)",
  in_progress: "var(--sys-orange)",
  on_hold: "var(--sys-yellow)",
  completed: "var(--sys-green)",
  closed: "var(--sys-gray)",
  unscheduled: "var(--sys-gray)",
};
/** Which pins keep their box first: live work, then booked, then the rest. */
const PIN_RANK: Record<string, number> = {
  en_route: 0,
  arrived: 0,
  in_progress: 0,
  scheduled: 1,
  confirmed: 1,
  on_hold: 2,
  unscheduled: 2,
  completed: 3,
  closed: 3,
};

/** Marker sizes (px): the page (and wall mode on phones and tablets), or wall mode ≥ 1200 px. */
const SIZES = {
  page: { tech: 34, techSel: 42, font: 13, fontSel: 15, boxH: 22, tail: 8 },
  big: { tech: 44, techSel: 52, font: 16, fontSel: 18, boxH: 28, tail: 10 },
} as const;
const BIG_QUERY = "(min-width: 1200px)";
/** The white ring (box-shadow) around avatars, boxes and dots. */
const RING_W = 2;
/** A folded job pin. */
const DOT = 12;
/** Avatar edge → name tag (TM_CSS `calc(100% + 8px)`). */
const TAG_GAP = 8;
/** Clear space kept around a pin box. */
const BOX_GAP = 6;
/** Below this zoom every pin is a dot (the whole region at a glance). */
const MIN_BOX_ZOOM = 9;

const TM_CSS = `.tm-tech{position:absolute;left:0;top:0;width:var(--s);height:var(--s);margin:calc(var(--s)/-2) 0 0 calc(var(--s)/-2);opacity:var(--o);cursor:pointer}
.tm-av{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--c);color:#fff;font:600 var(--f)/1 system-ui,sans-serif;border:3px solid var(--ring);box-shadow:0 0 0 2px #fff,0 2px 8px rgb(0 0 0/.35)}
.tm-av>span{position:relative}
.tech-pulse{position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--ring);animation:tm-pulse 2.2s var(--ease-spring,ease-out) infinite}
@keyframes tm-pulse{0%{transform:scale(.9);opacity:.9}70%{transform:scale(1.35);opacity:0}100%{opacity:0}}
.tm-tag{position:absolute;display:none;padding:2px 8px;border-radius:9999px;background:var(--card);color:var(--label);font:600 12px/16px system-ui,sans-serif;white-space:nowrap;box-shadow:0 0 0 1px var(--hairline),0 2px 8px rgb(0 0 0/.35);pointer-events:none}
.tm-tech[data-big] .tm-tag{padding:3px 10px;font-size:15px;line-height:20px}
.tm-tag[data-side]{display:block}
.tm-tag[data-side=below]{left:50%;top:calc(100% + 8px);transform:translateX(-50%)}
.tm-tag[data-side=above]{left:50%;bottom:calc(100% + 8px);transform:translateX(-50%)}
.tm-tag[data-side=right]{left:calc(100% + 8px);top:50%;transform:translateY(-50%)}
.tm-tag[data-side=left]{right:calc(100% + 8px);top:50%;transform:translateY(-50%)}
.tm-job{position:absolute;left:0;top:0;cursor:pointer}
.tm-box{position:absolute;left:0;bottom:8px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;min-width:30px;height:22px;padding:0 6px;border-radius:7px;background:var(--c);color:#fff;font:600 11px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;box-shadow:0 0 0 2px #fff,0 2px 6px rgb(0 0 0/.3);transform-origin:50% 100%;transition:transform .3s var(--ease-spring,ease)}
.tm-box::after{content:"";position:absolute;left:50%;top:100%;margin:2px 0 0 -5px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--c)}
.tm-job[data-big] .tm-box{bottom:10px;min-width:38px;height:28px;padding:0 8px;border-radius:9px;font-size:13px}
.tm-job[data-big] .tm-box::after{margin-left:-6px;border-left-width:6px;border-right-width:6px;border-top-width:8px}
.tm-job[data-sel] .tm-box{transform:translateX(-50%) scale(1.15)}
.tm-dot{position:absolute;left:0;top:0;display:none;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--c);box-shadow:0 0 0 2px #fff,0 1px 3px rgb(0 0 0/.35)}
.tm-job[data-mode=dot] .tm-box{display:none}
.tm-job[data-mode=dot] .tm-dot{display:block}
.tm-job[data-mode=hide]{display:none}
@media (hover:hover){.tm-job[data-mode=dot]:hover .tm-box{display:flex}.tm-job[data-mode=dot]:hover .tm-dot{display:none}}
.map-pin:focus-visible{outline:none}
.map-pin:focus-visible .tm-av,.map-pin:focus-visible .tm-box,.map-pin:focus-visible .tm-dot{outline:2px solid var(--accent);outline-offset:3px}
@media (prefers-reduced-motion:reduce){.tech-pulse{animation:none;opacity:.5}.tm-box{transition:none}}`;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const sizesFor = (big: boolean) => (big ? SIZES.big : SIZES.page);
const techSize = (selected: boolean, big: boolean) =>
  selected ? sizesFor(big).techSel : sizesFor(big).tech;

function techHtml(
  t: MapTech,
  selected: boolean,
  big: boolean,
  tag: boolean,
): string {
  const s = sizesFor(big);
  const fade = t.staleness === "live" ? 1 : t.staleness === "stale" ? 0.5 : 0.3;
  const fill =
    t.staleness === "live" ? (t.color ?? "var(--accent)") : "var(--sys-gray)";
  const pulse =
    t.staleness === "live" && t.status !== "off"
      ? `<span class="tech-pulse"></span>`
      : "";
  const name = tag
    ? `<span class="tm-tag">${esc(t.name.split(" ")[0] ?? t.name)}</span>`
    : "";
  return `<span class="tm-tech"${big ? " data-big" : ""} style="--s:${techSize(selected, big)}px;--f:${selected ? s.fontSel : s.font}px;--c:${fill};--ring:${RING[t.status]};--o:${fade}"><span class="tm-av">${pulse}<span>${esc(t.initials)}</span></span>${name}</span>`;
}

function jobHtml(j: LiveJob, selected: boolean, big: boolean): string {
  const color = JOB_TONE[j.status] ?? "var(--sys-gray)";
  const label = esc(j.number.replace(/^[A-Z]+-?/, "").slice(-4));
  return `<span class="tm-job" data-mode="box"${big ? " data-big" : ""}${selected ? " data-sel" : ""} style="--c:${color}"><span class="tm-box">${label}</span><span class="tm-dot"></span></span>`;
}

export default function TechMap({
  techs,
  jobs,
  selected,
  onSelect,
  tileUrl,
  attribution,
  canSetup = false,
  wall = false,
  fitKey,
  className,
}: {
  techs: readonly MapTech[];
  jobs: readonly LiveJob[];
  selected: { kind: "tech" | "job"; id: string } | null;
  onSelect: (s: { kind: "tech" | "job"; id: string }) => void;
  tileUrl: string;
  attribution: string;
  /** Admins see how to turn the street map on; everyone else a plain note. */
  canSetup?: boolean;
  /** Wall mode: name tags; bigger markers on a screen ≥ 1200 px wide. */
  wall?: boolean;
  /** Frame everything again whenever this changes (entering / leaving wall mode). */
  fitKey?: string | number;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const halos = useRef(new Map<string, Leaflet.Circle>());
  const fitted = useRef(false);
  const big = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const latest = useRef({ techs, jobs, selected, wall });
  latest.current = { techs, jobs, selected, wall };

  const sync = () => {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    const { techs: ts, jobs: js, selected: sel, wall: tags } = latest.current;
    const large = tags && matchMedia(BIG_QUERY).matches;
    big.current = large;
    const seen = new Set<string>();
    const pts: [number, number][] = [];
    const place = (
      key: string,
      lat: number,
      lng: number,
      html: string,
      title: string,
      z: number,
      pick: () => void,
    ) => {
      seen.add(key);
      // Zero-size anchor at the point; TM_CSS draws the marker around it.
      const icon = lib.divIcon({
        className: "map-pin",
        html,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      const cur = markers.current.get(key);
      if (cur) {
        cur.setLatLng([lat, lng]);
        cur.setIcon(icon);
        cur.setZIndexOffset(z);
      } else {
        const mk = lib
          .marker([lat, lng], {
            icon,
            title,
            alt: title,
            keyboard: true,
            riseOnHover: true,
            zIndexOffset: z,
          })
          .on("click", pick)
          .addTo(m);
        markers.current.set(key, mk);
      }
    };
    for (const j of js) {
      if (j.lat == null || j.lng == null) continue;
      const isSel = sel?.kind === "job" && sel.id === j.id;
      pts.push([j.lat, j.lng]);
      place(
        `j:${j.id}`,
        j.lat,
        j.lng,
        jobHtml(j, isSel, large),
        `Job ${j.number}: ${j.title}`,
        isSel ? 5000 : 0,
        () => onSelectRef.current({ kind: "job", id: j.id }),
      );
    }
    const haloSeen = new Set<string>();
    for (const t of ts) {
      if (!t.location || t.staleness === "hidden") continue;
      const { lat, lng, accuracyM } = t.location;
      const isSel = sel?.kind === "tech" && sel.id === t.id;
      pts.push([lat, lng]);
      // Avatars always above job pins (and the picked one above the rest).
      place(
        `t:${t.id}`,
        lat,
        lng,
        techHtml(t, isSel, large, tags),
        `${t.name}`,
        isSel ? 20_000 : 10_000,
        () => onSelectRef.current({ kind: "tech", id: t.id }),
      );
      if (accuracyM != null && accuracyM > HALO_MIN_ACCURACY_M) {
        haloSeen.add(t.id);
        const h = halos.current.get(t.id);
        if (h) {
          h.setLatLng([lat, lng]);
          h.setRadius(accuracyM);
        } else {
          halos.current.set(
            t.id,
            lib
              .circle([lat, lng], {
                radius: accuracyM,
                stroke: false,
                fillColor: "#0a84ff",
                fillOpacity: 0.12,
                interactive: false,
              })
              .addTo(m),
          );
        }
      }
    }
    for (const [k, mk] of markers.current)
      if (!seen.has(k)) {
        mk.remove();
        markers.current.delete(k);
      }
    for (const [k, h] of halos.current)
      if (!haloSeen.has(k)) {
        h.remove();
        halos.current.delete(k);
      }
    if (!fitted.current && pts.length > 0) {
      fitted.current = true;
      const pad = large ? 72 : 48;
      if (pts.length === 1)
        m.setView(pts[0] as [number, number], 14, { animate: false });
      else
        m.fitBounds(lib.latLngBounds(pts), {
          padding: [pad, pad],
          maxZoom: 14,
          animate: false,
        });
    }
    layout();
  };

  /**
   * Zoom- and size-dependent: name tags (first free side), then which pins keep
   * their number box (the rest fold to dots), measured in one layout pass.
   */
  const layout = () => {
    const m = map.current;
    if (!m) return;
    const { techs: ts, jobs: js, selected: sel, wall: tags } = latest.current;
    const large = big.current;
    const s = sizesFor(large);
    const size = m.getSize();
    const bounds = { w: size.x, h: size.y };
    const node = (key: string, cls: string) =>
      markers.current.get(key)?.getElement()?.querySelector<HTMLElement>(cls) ??
      null;

    // Measure: every box and tag drawn once (no paint happens in between).
    const pins = js.flatMap((j) => {
      const n =
        j.lat != null && j.lng != null ? node(`j:${j.id}`, ".tm-job") : null;
      if (!n || j.lat == null || j.lng == null) return [];
      n.dataset.mode = "box";
      return [{ j, n, p: m.latLngToContainerPoint([j.lat, j.lng]) }];
    });
    const people = ts.flatMap((t) => {
      if (!t.location || t.staleness === "hidden") return [];
      const tag = tags ? node(`t:${t.id}`, ".tm-tag") : null;
      if (tag) tag.dataset.side = "below";
      const on = sel?.kind === "tech" && sel.id === t.id;
      return [
        {
          t,
          tag,
          on,
          p: m.latLngToContainerPoint([t.location.lat, t.location.lng]),
          d: techSize(on, large) + 2 * RING_W,
        },
      ];
    });
    const boxW = new Map(
      pins.map(({ j, n }) => [
        j.id,
        (n.querySelector<HTMLElement>(".tm-box")?.offsetWidth ?? 38) +
          2 * RING_W,
      ]),
    );
    const tagSize = new Map(
      people.map(({ t, tag }) => [
        t.id,
        tag ? { w: tag.offsetWidth, h: tag.offsetHeight } : null,
      ]),
    );

    // Avatars are fixed and on top; a pin under one (its tech is there) hides.
    const avatars: Rect[] = people.map(({ p, d }) => square(p.x, p.y, d));
    const under = new Set(
      pins
        .filter(({ p }) =>
          avatars.some((a) => p.x > a.l && p.x < a.r && p.y > a.t && p.y < a.b),
        )
        .map(({ j }) => j.id),
    );
    const dots = pins
      .filter(({ j }) => !under.has(j.id))
      .map(({ p }) => square(p.x, p.y, DOT + 2 * RING_W));

    // Name tags (wall mode): the picked tech first, then the list order.
    const labelItems: LabelItem[] = [...people]
      .sort((a, b) => Number(b.on) - Number(a.on))
      .flatMap(({ t, p, d }) => {
        const z = tagSize.get(t.id);
        return z?.w ? [{ id: t.id, x: p.x, y: p.y, r: d / 2, ...z }] : [];
      });
    const gap = TAG_GAP - RING_W;
    const sides = placeLabels(labelItems, {
      gap,
      avoid: [...avatars, ...dots],
      bounds,
    });
    const labels = labelItems.flatMap((i) => {
      const side = sides.get(i.id);
      return side ? [labelRect(i, side, gap)] : [];
    });

    // Pin boxes: clear of every avatar, tag, box and other pin's dot.
    const items: PlaceItem[] = pins
      .filter(({ j }) => !under.has(j.id))
      .map(({ j, p }) => ({
        id: j.id,
        x: p.x,
        y: p.y,
        w: boxW.get(j.id) ?? 38,
        priority:
          (PIN_RANK[j.status] ?? 2) * 1e13 +
          (j.windowStart ? Date.parse(j.windowStart) : 9e12),
      }));
    const pickedJob = sel?.kind === "job" ? sel.id : null;
    const boxes = declutter(items, {
      boxH: s.boxH + 2 * RING_W,
      tail: s.tail - RING_W,
      dot: DOT + 2 * RING_W,
      gap: BOX_GAP,
      rects: [...avatars, ...labels],
      bounds,
      dotsOnly: m.getZoom() < MIN_BOX_ZOOM,
      force: new Set(pickedJob ? [pickedJob] : []),
    });

    for (const { j, n } of pins)
      n.dataset.mode =
        boxes.has(j.id) || j.id === pickedJob
          ? "box"
          : under.has(j.id)
            ? "hide"
            : "dot";
    for (const { t, tag } of people) {
      if (!tag) continue;
      const side = sides.get(t.id);
      if (side) tag.dataset.side = side;
      else delete tag.dataset.side;
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
      const m = lib.map(el.current, {
        zoomControl: false,
        center: [39.5, -98.35],
        zoom: 4,
      });
      lib.control.zoom({ position: "bottomright" }).addTo(m);
      if (tileUrl)
        lib
          .tileLayer(tileUrl, { attribution, maxZoom: 19, detectRetina: true })
          .addTo(m);
      map.current = m;
      sync();
      m.on("zoomend moveend", layout);
      // Keep Leaflet's size in step with its box (full screen, rotation); the
      // marker size can change with it (wall mode across 1200 px).
      let last = "";
      ro = new ResizeObserver(([e]) => {
        const r = e?.contentRect;
        if (!r?.width || !r.height) return;
        const box = `${Math.round(r.width)}x${Math.round(r.height)}`;
        if (box === last) return;
        last = box;
        m.invalidateSize({ animate: false });
        sync();
      });
      ro.observe(el.current);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      markers.current.clear();
      halos.current.clear();
      fitted.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync reads latest props via ref
  useEffect(() => {
    sync();
    const m = map.current;
    const sel = latest.current.selected;
    if (!m || !sel) return;
    const pos =
      sel.kind === "tech"
        ? techs.find((t) => t.id === sel.id)?.location
        : jobs.find((j) => j.id === sel.id);
    if (pos && pos.lat != null && pos.lng != null)
      m.panTo([pos.lat, pos.lng], { animate: true });
  }, [techs, jobs, selected, wall]);

  // Frame everything again at the box's new size (wall mode on / off).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the key only
  useEffect(() => {
    const m = map.current;
    if (!m || fitKey === undefined) return;
    m.invalidateSize({ animate: false });
    fitted.current = false;
    sync();
  }, [fitKey]);

  return (
    <div className={cx("map-view relative overflow-hidden", className)}>
      <style href="tech-map" precedence="default">
        {TM_CSS}
      </style>
      <div
        ref={el}
        role="application"
        aria-label="Live map of technicians and today's jobs"
        className="size-full"
      />
      {!tileUrl && (
        <p className="absolute inset-x-0 top-2 mx-auto w-fit max-w-[calc(100%-24px)] rounded-full bg-card px-3 py-1 text-center text-footnote text-label-2 shadow-card">
          {canSetup ? (
            <>
              Street map is off.{" "}
              <a href="/settings/map" className="text-accent-text">
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
