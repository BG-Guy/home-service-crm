// Pure geo helpers for media flags (SPEC M11 `far_from_site`). Client-safe.

/** Great-circle distance in meters (haversine). */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when a geostamp is farther than `limitM` from the site (accuracy is credited). */
export function isFarFromSite(
  photo: { lat: number; lng: number; accuracyM?: number | null },
  site: { lat: number; lng: number },
  limitM: number,
): boolean {
  const slack = Math.min(Math.max(photo.accuracyM ?? 0, 0), 500);
  return distanceM(photo, site) > limitM + slack;
}
