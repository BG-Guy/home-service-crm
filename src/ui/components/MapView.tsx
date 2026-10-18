"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import { cx } from "../cx";
import { TONE_VAR, type Tone } from "../tone";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** 1–3 characters drawn in the pin (initials, job #). */
  label?: string;
  /** Tooltip / accessible name. */
  title?: string;
  tone?: Tone;
  /** Soft pulse ring (live tech location). */
  pulse?: boolean;
}

const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function pinHtml(m: MapMarker, selected: boolean): string {
  const color = TONE_VAR[m.tone ?? "accent"];
  const size = selected ? 38 : 30;
  const ring = m.pulse
    ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${color};opacity:.25"></span>`
    : "";
  return `<span style="position:relative;display:flex;width:${size}px;height:${size}px;align-items:center;justify-content:center;border-radius:9999px;background:${color};color:#fff;font:600 ${selected ? 14 : 12}px/1 system-ui,sans-serif;border:2.5px solid #fff;box-shadow:0 2px 6px rgb(0 0 0/.35);transition:transform .3s">${ring}<span style="position:relative">${esc(m.label ?? "")}</span></span>`;
}

/**
 * Leaflet map (SPEC §12.6, §M19). Leaflet JS is imported dynamically on mount;
 * this module (and its CSS) should itself be loaded with `LazyMapView` so the
 * ~43 KB stays off every other route. Markers update in place (no map
 * re-creation); `map.remove()` on unmount. Raster tiles are inverted in dark mode.
 *
 * @param tileUrl tile template, e.g. from `MAP_TILE_URL` (default OpenStreetMap — fine for dev only).
 */
export function MapView({
  markers,
  selectedId,
  onSelect,
  center,
  zoom = 12,
  fit = true,
  tileUrl = OSM,
  attribution = OSM_ATTR,
  label = "Map",
  className,
  height = 360,
}: {
  markers: readonly MapMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  center?: [number, number];
  zoom?: number;
  /** Fit the view to the markers when they first appear. */
  fit?: boolean;
  tileUrl?: string;
  attribution?: string;
  label?: string;
  className?: string;
  height?: number | string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef(new Map<string, Leaflet.Marker>());
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const latest = useRef({ markers, selectedId, fit });
  latest.current = { markers, selectedId, fit };

  const sync = () => {
    const lib = L.current;
    const m = map.current;
    if (!lib || !m) return;
    const { markers: list, selectedId: sel, fit: doFit } = latest.current;
    const seen = new Set<string>();
    for (const mk of list) {
      seen.add(mk.id);
      const icon = lib.divIcon({
        className: "map-pin",
        html: pinHtml(mk, mk.id === sel),
        iconSize: mk.id === sel ? [38, 38] : [30, 30],
        iconAnchor: mk.id === sel ? [19, 19] : [15, 15],
      });
      const existing = layer.current.get(mk.id);
      if (existing) {
        existing.setLatLng([mk.lat, mk.lng]);
        existing.setIcon(icon);
        existing.setZIndexOffset(mk.id === sel ? 1000 : 0);
      } else {
        const marker = lib
          .marker([mk.lat, mk.lng], {
            icon,
            title: mk.title,
            alt: mk.title ?? mk.label ?? "Marker",
            keyboard: true,
            riseOnHover: true,
          })
          .on("click", () => onSelectRef.current?.(mk.id))
          .addTo(m);
        layer.current.set(mk.id, marker);
      }
    }
    for (const [id, marker] of layer.current) {
      if (!seen.has(id)) {
        marker.remove();
        layer.current.delete(id);
      }
    }
    if (doFit && !fitted.current && list.length > 0) {
      fitted.current = true;
      if (list.length === 1) {
        const only = list[0] as MapMarker;
        m.setView([only.lat, only.lng], Math.max(zoom, 14));
      } else {
        m.fitBounds(
          lib.latLngBounds(list.map((x) => [x.lat, x.lng] as [number, number])),
          { padding: [40, 40], maxZoom: 15 },
        );
      }
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
        attributionControl: true,
        center: center ?? [39.5, -98.35],
        zoom: center ? zoom : 4,
      });
      lib.control.zoom({ position: "bottomright" }).addTo(m);
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
      layer.current.clear();
      fitted.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync reads latest props via ref
  useEffect(() => {
    sync();
  }, [markers, selectedId]);

  useEffect(() => {
    if (center && map.current) map.current.panTo(center);
  }, [center?.[0], center?.[1]]); // eslint-friendly primitive deps

  return (
    <div
      className={cx(
        "map-view relative overflow-hidden rounded-card",
        className,
      )}
      style={{ height }}
    >
      <div
        ref={el}
        role="application"
        aria-label={label}
        className="size-full"
      />
    </div>
  );
}

export default MapView;
