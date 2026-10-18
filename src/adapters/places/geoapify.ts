import "server-only";
import {
  clampLimit,
  PlacesHttpError,
  toSuggestion,
  typedHouseNumber,
  uniqueSuggestions,
} from "./shared";
import type { AddressSuggestion, PlacesProvider } from "./types";

// Geoapify address autocomplete (optional; ADDRESS_AUTOCOMPLETE=geoapify with
// GEOAPIFY_API_KEY). Commercial OSM-based API with a free daily quota. The key rides
// in the URL, so neither the URL nor the query is ever logged.

interface GeoapifyResult {
  place_id?: string;
  result_type?: string; // building | street | amenity | postcode | city | …
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  suburb?: string;
  county?: string;
  state?: string;
  state_code?: string;
  postcode?: string;
  country_code?: string;
  lat?: number;
  lon?: number;
  formatted?: string;
}

export interface GeoapifyResponse {
  results?: GeoapifyResult[];
}

/** Geoapify `format=json` results → suggestions (US street results only, deduped). */
export function mapGeoapify(
  json: GeoapifyResponse,
  query: string,
  limit: number,
): AddressSuggestion[] {
  const typed = typedHouseNumber(query);
  const rows = (json.results ?? []).map((r, i) => {
    if (r.country_code && r.country_code.toLowerCase() !== "us") return null;
    return toSuggestion(
      {
        id: `geoapify:${r.place_id ?? i}`,
        housenumber: r.housenumber,
        street: r.street,
        city: r.city ?? r.town ?? r.village ?? r.hamlet ?? r.suburb ?? r.county,
        state: r.state_code || r.state,
        postcode: r.postcode,
        lat: r.lat,
        lng: r.lon,
      },
      typed,
    );
  });
  return uniqueSuggestions(rows, limit);
}

export const geoapifyPlaces: PlacesProvider = {
  id: "geoapify",
  async suggest({ query, limit, bias }) {
    const key = process.env.GEOAPIFY_API_KEY;
    if (!key) return [];
    const want = clampLimit(limit);
    const qs = new URLSearchParams({
      text: query,
      filter: "countrycode:us",
      format: "json",
      lang: "en",
      limit: String(Math.min(want * 2, 10)),
      apiKey: key,
    });
    if (bias)
      qs.set("bias", `proximity:${bias.lng.toFixed(5)},${bias.lat.toFixed(5)}`);
    const res = await fetch(
      `https://api.geoapify.com/v1/geocode/autocomplete?${qs}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new PlacesHttpError("Geoapify", res.status);
    }
    return mapGeoapify((await res.json()) as GeoapifyResponse, query, want);
  },
};
