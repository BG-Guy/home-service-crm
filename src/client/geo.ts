// Geolocation helpers (SPEC §M06/§M11 geostamps, §M19 live map). Promise-based,
// never reject: evidence capture must continue without location ("no_geo").

/** Matches `Geo` in src/lib/types.ts (BUILD_PLAN §2). */
export interface Geo {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  /** Device ISO timestamp of the fix. */
  at?: string;
  heading?: number | null;
  speed?: number | null;
}

export type GeoPermission = "granted" | "denied" | "prompt" | "unsupported";

export interface GeoOptions {
  /** Give up after this many ms (default 8000). */
  timeoutMs?: number;
  /** Accept a cached fix this old (default 60 s). */
  maxAgeMs?: number;
  highAccuracy?: boolean;
}

export function geoSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

function toGeo(p: GeolocationPosition): Geo {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracyM: Number.isFinite(p.coords.accuracy)
      ? Math.round(p.coords.accuracy)
      : null,
    at: new Date(p.timestamp).toISOString(),
    heading: p.coords.heading ?? null,
    speed: p.coords.speed ?? null,
  };
}

/** One fix, or null when unsupported / denied / timed out. */
export function getPosition({
  timeoutMs = 8000,
  maxAgeMs = 60_000,
  highAccuracy = true,
}: GeoOptions = {}): Promise<Geo | null> {
  if (!geoSupported()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (g: Geo | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(g);
    };
    // Hard timeout: some browsers never call back while the prompt is open.
    const t = setTimeout(() => finish(null), timeoutMs + 1000);
    navigator.geolocation.getCurrentPosition(
      (p) => finish(toGeo(p)),
      () => finish(null),
      {
        enableHighAccuracy: highAccuracy,
        timeout: timeoutMs,
        maximumAge: maxAgeMs,
      },
    );
  });
}

/** Continuous updates; returns a stop function. */
export function watchPosition(
  onFix: (g: Geo) => void,
  onError?: (e: GeolocationPositionError) => void,
  {
    highAccuracy = true,
    maxAgeMs = 10_000,
    timeoutMs = 20_000,
  }: GeoOptions = {},
): () => void {
  if (!geoSupported()) return () => {};
  const id = navigator.geolocation.watchPosition(
    (p) => onFix(toGeo(p)),
    (e) => onError?.(e),
    {
      enableHighAccuracy: highAccuracy,
      maximumAge: maxAgeMs,
      timeout: timeoutMs,
    },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Current permission state without prompting (Permissions API where available). */
export async function geoPermission(): Promise<GeoPermission> {
  if (!geoSupported()) return "unsupported";
  try {
    const s = await navigator.permissions?.query({ name: "geolocation" });
    return (s?.state as GeoPermission | undefined) ?? "prompt";
  } catch {
    return "prompt";
  }
}

/** Subscribe to permission changes (no-op where unsupported). */
export async function onGeoPermissionChange(
  cb: (p: GeoPermission) => void,
): Promise<() => void> {
  try {
    const s = await navigator.permissions?.query({ name: "geolocation" });
    if (!s) return () => {};
    const h = () => cb(s.state as GeoPermission);
    s.addEventListener("change", h);
    return () => s.removeEventListener("change", h);
  } catch {
    return () => {};
  }
}

/** Haversine distance in meters. */
export function distanceM(
  a: Pick<Geo, "lat" | "lng">,
  b: Pick<Geo, "lat" | "lng">,
): number {
  const R = 6371e3;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
