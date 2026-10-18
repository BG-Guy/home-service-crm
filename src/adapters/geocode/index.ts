import "server-only";
import { censusGeocoder } from "./census";
import { nominatimGeocoder } from "./nominatim";
import type { GeocodeProvider } from "./types";

// Geocoding adapter (SPEC §9.5). GEOCODER = census (default) | nominatim | none.
// Calls run through job_queue (kind `geocode`) on property save.

export type { GeocodeProvider } from "./types";

const noneGeocoder: GeocodeProvider = { id: "none", geocode: async () => null };

export function getGeocoder(): GeocodeProvider {
  switch (process.env.GEOCODER) {
    case "none":
      return noneGeocoder;
    case "nominatim":
      return nominatimGeocoder;
    default:
      return censusGeocoder;
  }
}
