// Map tile config (SPEC §9.5) — client-safe (NEXT_PUBLIC_* env is inlined at build).
export interface MapProvider {
  tileUrl: string;
  attribution: string;
  maxZoom: number;
}

/** The "OpenStreetMap (free)" preset (Settings → Map). Attribution always shows. */
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_TILE_ATTRIBUTION = "© OpenStreetMap contributors";
const OSM_ATTRIBUTION = "&copy; OpenStreetMap contributors";

/** Street-map choice saved in Settings → Map (`settings.map`). */
export interface SavedTiles {
  tile_url?: string | null;
  tile_attribution?: string | null;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A saved tile URL is used only when it is an https template with {z}/{x}/{y}. */
export function validTileUrl(url: string | null | undefined): string | null {
  const u = url?.trim() ?? "";
  const ok =
    u.startsWith("https://") &&
    u.includes("{z}") &&
    u.includes("{x}") &&
    u.includes("{y}");
  return ok ? u : null;
}

/**
 * Leaflet tile layer config. The environment always wins (`NEXT_PUBLIC_TILE_URL`,
 * like every other integration), then the street map saved in Settings → Map (the
 * free OpenStreetMap preset), then OSM in development only. In production with
 * neither, the tile URL is empty: maps draw without streets and offer "Set it up".
 * The saved attribution is plain text (escaped here: Leaflet renders it as HTML).
 */
export function getMapConfig(saved?: SavedTiles | null): MapProvider {
  const url = process.env.NEXT_PUBLIC_TILE_URL;
  if (url) {
    return {
      tileUrl: url,
      attribution: process.env.NEXT_PUBLIC_TILE_ATTRIBUTION || OSM_ATTRIBUTION,
      maxZoom: 19,
    };
  }
  const own = validTileUrl(saved?.tile_url);
  if (own) {
    return {
      tileUrl: own,
      attribution: esc(saved?.tile_attribution?.trim() || OSM_TILE_ATTRIBUTION),
      maxZoom: 19,
    };
  }
  return {
    tileUrl:
      process.env.NODE_ENV === "production"
        ? ""
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  };
}

/** Which street map is in effect, for Settings → Map and Integrations. */
export function tileSource(
  saved?: SavedTiles | null,
): "env" | "osm" | "custom" | "dev" | "off" {
  if (process.env.NEXT_PUBLIC_TILE_URL) return "env";
  const own = validTileUrl(saved?.tile_url);
  if (own) return own === OSM_TILE_URL ? "osm" : "custom";
  return process.env.NODE_ENV === "production" ? "off" : "dev";
}
