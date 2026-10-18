// Map tile config (SPEC §9.5) — client-safe (NEXT_PUBLIC_* env is inlined at build).
export interface MapProvider {
  tileUrl: string;
  attribution: string;
  maxZoom: number;
}

const OSM_DEV_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = "&copy; OpenStreetMap contributors";

/** Leaflet tile layer config. OSM tiles are for development only (usage policy). */
export function getMapConfig(): MapProvider {
  const url = process.env.NEXT_PUBLIC_TILE_URL;
  if (url) {
    return {
      tileUrl: url,
      attribution: process.env.NEXT_PUBLIC_TILE_ATTRIBUTION || OSM_ATTRIBUTION,
      maxZoom: 19,
    };
  }
  return {
    tileUrl: process.env.NODE_ENV === "production" ? "" : OSM_DEV_URL,
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  };
}
