import type * as Leaflet from "leaflet";
import { formatMiles, milesBetween } from "@/lib/geo";

// Route drawing shared by every Leaflet map with technician routes: the schedule
// map (jobs/schedule-map MapCanvas) and the Assign hub (map/components/RouteMap).
// One cased polyline per route (a --card casing under the tech color), thicker
// when focused and at 25 % when faded, and a chevron at the midpoint of every leg
// long enough on screen, pointing along the route. Colors go through
// `style.stroke`, so var(--sys-*) works on SVG. Runs in each map's lazy Leaflet
// chunk; render ROUTE_CSS with the map.

type Lib = typeof Leaflet;
export type LatLng = [number, number];

export const ROUTE_CSS = `.rt-pin{background:none;border:0}
.rt-arrow{position:absolute;left:0;top:0;width:16px;height:16px;margin:-8px 0 0 -8px;pointer-events:none}
.rt-arrow[data-fade]{opacity:.25}
.rt-mi{position:absolute;left:0;top:0;white-space:nowrap;padding:0 6px;border-radius:999px;background:var(--card);color:var(--label);font:600 11px/16px system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.01em;box-shadow:0 0 0 1.5px var(--c),0 1px 4px rgb(0 0 0/.18);pointer-events:none}`;

const CHEVRON = "M-3 -5 L3 0 L-3 5";
/** Legs shorter than this on screen get no arrow. */
export const MIN_ARROW_PX = 44;
/** Legs at least this long on screen also get their miles, along the line. */
export const MIN_LABEL_PX = 96;
/** More routes in focus than this (the all-techs overview): arrows only, no miles. */
export const MAX_LABELED_ROUTES = 3;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface RouteLines {
  casing: Leaflet.Polyline;
  line: Leaflet.Polyline;
}

/** One route: the casing and the colored line (a click on it → `onClick`). */
export function drawRoute(
  lib: Lib,
  layer: Leaflet.LayerGroup,
  points: readonly LatLng[],
  color: string,
  onClick?: () => void,
): RouteLines {
  const casing = lib
    .polyline(points as LatLng[], {
      weight: 7,
      opacity: 0.9,
      lineJoin: "round",
      lineCap: "round",
      interactive: false,
    })
    .addTo(layer);
  const line = lib
    .polyline(points as LatLng[], {
      weight: 3.5,
      opacity: 0.95,
      lineJoin: "round",
      lineCap: "round",
      interactive: !!onClick,
      bubblingMouseEvents: false,
    })
    .addTo(layer);
  if (onClick) line.on("click", onClick);
  // var(--…) colors work in a style, not in SVG presentation attributes.
  const c = casing.getElement() as SVGElement | undefined;
  if (c) c.style.stroke = "var(--card)";
  const l = line.getElement() as SVGElement | undefined;
  if (l) l.style.stroke = color;
  return { casing, line };
}

/** Focus a drawn route (thicker, on top) or fade it (25 %). */
export function styleRoute(
  r: RouteLines,
  { focus, fade }: { focus: boolean; fade: boolean },
): void {
  r.line.setStyle({ weight: focus ? 6 : 3.5, opacity: fade ? 0.25 : 0.95 });
  r.casing.setStyle({ weight: focus ? 10 : 7, opacity: fade ? 0.2 : 0.9 });
  if (focus) {
    r.casing.bringToFront();
    r.line.bringToFront();
  }
}

/**
 * Chevrons at the midpoint of every leg, pointing along the route, and, on legs
 * long enough on screen, the leg's straight-line miles in a pill on the line,
 * turned along it (the chevron then moves to a third of the way). Faded routes
 * and the busy all-techs overview get arrows only. Screen-size dependent: call it
 * again after a zoom (it clears `layer` first).
 */
export function drawArrows(
  lib: Lib,
  map: Leaflet.Map,
  layer: Leaflet.LayerGroup,
  routes: readonly {
    color: string;
    points: readonly LatLng[];
    fade?: boolean;
  }[],
  minPx = MIN_ARROW_PX,
): void {
  layer.clearLayers();
  const labeled = routes.filter((r) => !r.fade).length <= MAX_LABELED_ROUTES;
  for (const r of routes)
    for (let i = 1; i < r.points.length; i++) {
      const pa = r.points[i - 1] as LatLng;
      const pb = r.points[i] as LatLng;
      const a = map.latLngToLayerPoint(pa);
      const b = map.latLngToLayerPoint(pb);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < minPx) continue;
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const label =
        labeled && !r.fade && len >= MIN_LABEL_PX
          ? formatMiles(
              milesBetween(
                { lat: pa[0], lng: pa[1] },
                { lat: pb[0], lng: pb[1] },
              ),
            )
          : "";
      if (label) {
        // Upright text: turn with the line, but never upside down.
        const turn = deg > 90 ? deg - 180 : deg < -90 ? deg + 180 : deg;
        lib
          .marker(
            map.layerPointToLatLng(lib.point((a.x + b.x) / 2, (a.y + b.y) / 2)),
            {
              icon: lib.divIcon({
                className: "rt-pin",
                html: `<span class="rt-mi" style="--c:${esc(r.color)};transform:translate(-50%,-50%) rotate(${turn.toFixed(1)}deg)">${esc(label)}</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              }),
              interactive: false,
              keyboard: false,
              zIndexOffset: -1400,
            },
          )
          .addTo(layer);
      }
      const at = label ? 0.28 : 0.5;
      const mid = map.layerPointToLatLng(
        lib.point(a.x + dx * at, a.y + dy * at),
      );
      lib
        .marker(mid, {
          icon: lib.divIcon({
            className: "rt-pin",
            html: `<svg class="rt-arrow"${r.fade ? " data-fade" : ""} viewBox="-8 -8 16 16" style="--c:${esc(r.color)};transform:rotate(${deg.toFixed(1)}deg)" aria-hidden="true"><path d="${CHEVRON}" fill="none" style="stroke:var(--card)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="${CHEVRON}" fill="none" style="stroke:var(--c)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: false,
          keyboard: false,
          zIndexOffset: -1500,
        })
        .addTo(layer);
    }
}
