"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
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
// chunk (next/dynamic, ssr:false). Markers update in place; the map is created once.

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

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function techHtml(t: MapTech, selected: boolean): string {
  const size = selected ? 42 : 34;
  const fade = t.staleness === "live" ? 1 : t.staleness === "stale" ? 0.5 : 0.3;
  const fill =
    t.staleness === "live" ? (t.color ?? "var(--accent)") : "var(--sys-gray)";
  const pulse =
    t.staleness === "live" && t.status !== "off"
      ? `<span class="tech-pulse" style="position:absolute;inset:-5px;border-radius:9999px;border:2px solid ${RING[t.status]};"></span>`
      : "";
  return `<span style="position:relative;display:flex;width:${size}px;height:${size}px;align-items:center;justify-content:center;border-radius:9999px;background:${fill};color:#fff;font:600 ${selected ? 15 : 13}px/1 system-ui,sans-serif;border:3px solid ${RING[t.status]};box-shadow:0 0 0 2px #fff,0 2px 8px rgb(0 0 0/.35);opacity:${fade};transition:transform .35s var(--ease-spring,ease)">${pulse}<span style="position:relative">${esc(t.initials)}</span></span>`;
}

function jobHtml(j: LiveJob, selected: boolean): string {
  const color = JOB_TONE[j.status] ?? "var(--sys-gray)";
  const label = esc(j.number.replace(/^[A-Z]+-?/, "").slice(-4));
  const s = selected ? 1.15 : 1;
  return `<span style="display:flex;flex-direction:column;align-items:center;transform:scale(${s});transform-origin:bottom center;transition:transform .3s"><span style="display:flex;min-width:30px;height:22px;padding:0 6px;align-items:center;justify-content:center;border-radius:7px;background:${color};color:#fff;font:600 11px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 2px 6px rgb(0 0 0/.3)">${label}</span><span style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${color};margin-top:-1px"></span></span>`;
}

export default function TechMap({
  techs,
  jobs,
  selected,
  onSelect,
  tileUrl,
  attribution,
  canSetup = false,
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
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const halos = useRef(new Map<string, Leaflet.Circle>());
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const latest = useRef({ techs, jobs, selected });
  latest.current = { techs, jobs, selected };

  const sync = () => {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    const { techs: ts, jobs: js, selected: sel } = latest.current;
    const seen = new Set<string>();
    const pts: [number, number][] = [];
    const place = (
      key: string,
      lat: number,
      lng: number,
      html: string,
      size: [number, number],
      anchor: [number, number],
      title: string,
      z: number,
      pick: () => void,
    ) => {
      seen.add(key);
      const icon = lib.divIcon({
        className: "map-pin",
        html,
        iconSize: size,
        iconAnchor: anchor,
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
        jobHtml(j, isSel),
        [40, 30],
        [20, 30],
        `Job ${j.number}: ${j.title}`,
        isSel ? 900 : 0,
        () => onSelectRef.current({ kind: "job", id: j.id }),
      );
    }
    const haloSeen = new Set<string>();
    for (const t of ts) {
      if (!t.location || t.staleness === "hidden") continue;
      const { lat, lng, accuracyM } = t.location;
      const isSel = sel?.kind === "tech" && sel.id === t.id;
      pts.push([lat, lng]);
      const size = isSel ? 42 : 34;
      place(
        `t:${t.id}`,
        lat,
        lng,
        techHtml(t, isSel),
        [size, size],
        [size / 2, size / 2],
        `${t.name}`,
        isSel ? 2000 : 1000,
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
      if (pts.length === 1) m.setView(pts[0] as [number, number], 14);
      else
        m.fitBounds(lib.latLngBounds(pts), { padding: [48, 48], maxZoom: 14 });
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: create the map once
  useEffect(() => {
    let cancelled = false;
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
    })();
    return () => {
      cancelled = true;
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
  }, [techs, jobs, selected]);

  return (
    <div className={cx("map-view relative overflow-hidden", className)}>
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
