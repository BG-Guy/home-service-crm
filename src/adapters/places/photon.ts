import "server-only";
import { appUrl } from "@/lib/env";
import {
  clampLimit,
  PlacesHttpError,
  toSuggestion,
  typedHouseNumber,
  uniqueSuggestions,
} from "./shared";
import type { AddressSuggestion, PlacesProvider } from "./types";

// Photon by komoot (default; https://photon.komoot.io): OpenStreetMap data, built for
// search-as-you-type, no key. The public server is free for reasonable use and
// throttles heavy use, so the route debounces and caches; PHOTON_URL points at a
// self-hosted Photon instead. Data credit: "© OpenStreetMap contributors".

interface PhotonProperties {
  osm_type?: string;
  osm_id?: number;
  type?: string; // house | street | locality | district | city | county | state | country | other
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  locality?: string;
  district?: string;
  county?: string;
  state?: string;
  countrycode?: string;
}

export interface PhotonResponse {
  features?: {
    geometry?: { coordinates?: number[] };
    properties?: PhotonProperties;
  }[];
}

export function photonBaseUrl(): string {
  return (process.env.PHOTON_URL || "https://photon.komoot.io").replace(
    /\/+$/,
    "",
  );
}

// Filters an older or differently built Photon may not know: it answers 400 to an
// unknown parameter or language. On a 400 the next group is dropped for the rest of
// this process; mapPhoton() re-applies the same rules (US only, street required).
const OPTIONAL: ((qs: URLSearchParams) => void)[] = [
  (qs) => qs.set("countrycode", "us"),
  (qs) => {
    qs.append("layer", "house");
    qs.append("layer", "street");
  },
  (qs) => qs.set("lang", "en"),
];
let dropped = 0;

/** Photon GeoJSON → suggestions (US street results only, deduped). */
export function mapPhoton(
  json: PhotonResponse,
  query: string,
  limit: number,
): AddressSuggestion[] {
  const typed = typedHouseNumber(query);
  const rows = (json.features ?? []).map((f) => {
    const p = f.properties ?? {};
    if (p.countrycode && p.countrycode.toUpperCase() !== "US") return null;
    const [lng, lat] = f.geometry?.coordinates ?? [];
    return toSuggestion(
      {
        id: `photon:${p.osm_type ?? ""}${p.osm_id ?? ""}`,
        housenumber: p.housenumber,
        // A street feature carries its own name; a house carries `street`.
        street: p.street ?? (p.type === "street" ? p.name : undefined),
        city:
          p.city ?? p.town ?? p.village ?? p.locality ?? p.district ?? p.county,
        state: p.state,
        postcode: p.postcode,
        lat,
        lng,
      },
      typed,
    );
  });
  return uniqueSuggestions(rows, limit);
}

export const photonPlaces: PlacesProvider = {
  id: "photon",
  async suggest({ query, limit, bias }) {
    const want = clampLimit(limit);
    for (;;) {
      // Ask for extra: results without a street are dropped and repeats merged.
      const qs = new URLSearchParams({
        q: query,
        limit: String(Math.min(want * 2, 10)),
      });
      for (const add of OPTIONAL.slice(dropped)) add(qs);
      if (bias) {
        qs.set("lat", bias.lat.toFixed(5));
        qs.set("lon", bias.lng.toFixed(5));
      }
      const res = await fetch(`${photonBaseUrl()}/api/?${qs}`, {
        headers: {
          "User-Agent": `home-service-crm (${appUrl()})`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) await res.body?.cancel().catch(() => undefined);
      if (res.status === 400 && dropped < OPTIONAL.length) {
        dropped++;
        console.warn(
          "[places] Photon refused a search filter; retrying without it",
        );
        continue;
      }
      if (!res.ok) throw new PlacesHttpError("Photon", res.status);
      return mapPhoton((await res.json()) as PhotonResponse, query, want);
    }
  },
};
