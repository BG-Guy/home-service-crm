import "server-only";
import { createLru } from "./cache";
import { geoapifyPlaces } from "./geoapify";
import { photonPlaces } from "./photon";
import { clampLimit, PlacesHttpError } from "./shared";
import type { AddressLookup, AddressSuggestion, PlacesProvider } from "./types";

// Address autocomplete adapter. ADDRESS_AUTOCOMPLETE = photon (default, free, no key)
// | geoapify (GEOAPIFY_API_KEY) | none. GET /api/places/autocomplete calls
// suggestAddresses(): an in-memory LRU (500 queries, 10 min) plus in-flight dedupe in
// front of the provider, and provider failures degrade to "no suggestions".

export type { AddressLookup, AddressSuggestion, PlacesProvider } from "./types";

const OSM = "© OpenStreetMap contributors";

const nonePlaces: PlacesProvider = { id: "none", suggest: async () => [] };

/** The driver chosen by env (Settings → Integrations shows it). */
export function placesDriverName(): PlacesProvider["id"] {
  const v = process.env.ADDRESS_AUTOCOMPLETE?.trim().toLowerCase();
  if (v === "none" || v === "off") return "none";
  return v === "geoapify" ? "geoapify" : "photon";
}

let warnedKey = false;

/** Active provider; Geoapify without GEOAPIFY_API_KEY counts as off. */
export function getPlacesProvider(): PlacesProvider {
  switch (placesDriverName()) {
    case "none":
      return nonePlaces;
    case "geoapify":
      if (process.env.GEOAPIFY_API_KEY) return geoapifyPlaces;
      if (!warnedKey) {
        warnedKey = true;
        console.warn(
          "[places] ADDRESS_AUTOCOMPLETE=geoapify needs GEOAPIFY_API_KEY; address autocomplete is off",
        );
      }
      return nonePlaces;
    default:
      return photonPlaces;
  }
}

/** Data credit the provider's terms ask for (OpenStreetMap ODbL); null when off. */
export function placesAttribution(id: PlacesProvider["id"]): string | null {
  if (id === "photon") return OSM;
  if (id === "geoapify") return `Powered by Geoapify · ${OSM}`;
  return null;
}

type Bias = { lat: number; lng: number } | null | undefined;

const cache = createLru<AddressSuggestion[]>(500, 10 * 60_000);
const inflight = new Map<string, Promise<AddressSuggestion[]>>();

/** Provider + limit + bias (~1 km) + the query, case- and spacing-insensitive. */
export function placesCacheKey(
  provider: PlacesProvider["id"],
  query: string,
  limit: number,
  bias: Bias,
): string {
  const near = bias ? `${bias.lat.toFixed(2)},${bias.lng.toFixed(2)}` : "-";
  return `${provider}|${limit}|${near}|${query.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/** Short, PII-free reason for the log (never the query, the URL or a key). */
function reason(err: unknown): string {
  if (err instanceof PlacesHttpError) return `HTTP ${err.status}`;
  if (err instanceof Error) {
    const code = (err.cause as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? `${err.name} (${code})` : err.name;
  }
  return "unknown error";
}

/**
 * Suggestions for a partial street address. Cached per query; a provider error or
 * timeout returns no suggestions (logged without the typed text).
 */
export async function suggestAddresses(i: {
  query: string;
  limit?: number;
  bias?: Bias;
}): Promise<AddressLookup> {
  const provider = getPlacesProvider();
  if (provider.id === "none")
    return { suggestions: [], attribution: null, enabled: false };
  const attribution = placesAttribution(provider.id);
  const query = i.query.replace(/\s+/g, " ").trim();
  const limit = clampLimit(i.limit);
  const bias = i.bias ?? null;
  const key = placesCacheKey(provider.id, query, limit, bias);
  const hit = cache.get(key);
  if (hit) return { suggestions: hit, attribution, enabled: true };
  let pending = inflight.get(key);
  if (!pending) {
    pending = provider
      .suggest({ query, limit, bias })
      .then((list) => {
        cache.set(key, list);
        return list;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    return { suggestions: await pending, attribution, enabled: true };
  } catch (err) {
    console.warn(`[places] ${provider.id} lookup failed: ${reason(err)}`);
    return { suggestions: [], attribution, enabled: true, unavailable: true };
  }
}
