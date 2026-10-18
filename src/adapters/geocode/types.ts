// Geocoding adapter interface (SPEC §9.5) — FROZEN.
export interface GeocodeProvider {
  id: "census" | "nominatim" | "none";
  geocode(a: {
    street: string;
    city: string;
    state: string;
    zip: string;
  }): Promise<{ lat: number; lng: number; matched: string } | null>;
}
