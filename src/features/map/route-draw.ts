import type * as Leaflet from "leaflet";

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
.rt-arrow[data-fade]{opacity:.25}`;

const CHEVRON = "M-3 -5 L3 0 L-3 5";
/** Legs shorter than this on screen get no arrow. */
export const MIN_ARROW_PX = 44;

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
 * Chevrons at the midpoint of every leg, pointing along the route. Screen-size
 * dependent: call it again after a zoom (it clears `layer` first).
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
  for (const r of routes)
    for (let i = 1; i < r.points.length; i++) {
      const a = map.latLngToLayerPoint(r.points[i - 1] as LatLng);
      const b = map.latLngToLayerPoint(r.points[i] as LatLng);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.hypot(dx, dy) < minPx) continue;
      const mid = map.layerPointToLatLng(
        lib.point((a.x + b.x) / 2, (a.y + b.y) / 2),
      );
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
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
