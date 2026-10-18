import "server-only";
import { createThrottle } from "./throttle";
import type { GeocodeProvider } from "./types";

// US Census geocoder (free, US only; SPEC §9.5). 1 req/s.
const throttle = createThrottle(1000);

export const censusGeocoder: GeocodeProvider = {
  id: "census",
  async geocode(a) {
    const qs = new URLSearchParams({
      street: a.street,
      city: a.city,
      state: a.state,
      zip: a.zip,
      benchmark: "Public_AR_Current",
      format: "json",
    });
    return throttle(async () => {
      const res = await fetch(
        `https://geocoding.geo.census.gov/geocoder/locations/address?${qs}`,
        {
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
      const json = (await res.json()) as {
        result?: {
          addressMatches?: {
            matchedAddress?: string;
            coordinates?: { x: number; y: number };
          }[];
        };
      };
      const m = json.result?.addressMatches?.[0];
      if (!m?.coordinates) return null;
      return {
        lat: m.coordinates.y,
        lng: m.coordinates.x,
        matched: m.matchedAddress ?? "",
      };
    });
  },
};
