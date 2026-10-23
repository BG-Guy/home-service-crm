// Distance helpers shared by the Assign hub ranking, booking availability, the
// route maps and the route timelines (pure, client-safe). Straight-line miles,
// the same measure the hub ranks techs by.

export interface GeoPoint {
  lat: number;
  lng: number;
}

const R_MI = 3958.7613;

/** Haversine distance in miles. */
export function milesBetween(a: GeoPoint, b: GeoPoint): number {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A leg's distance for a label: "0.4 mi", "3.2 mi", "14 mi"; under 0.1 → "< 0.1 mi". */
export function formatMiles(mi: number): string {
  if (!Number.isFinite(mi) || mi < 0) return "";
  if (mi < 0.1) return "< 0.1 mi";
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/** Miles from each point to the next (null where either end has no position). */
export function legMiles(
  points: readonly (GeoPoint | null | undefined)[],
): (number | null)[] {
  return points.slice(1).map((p, i) => {
    const a = points[i];
    return a && p ? milesBetween(a, p) : null;
  });
}
