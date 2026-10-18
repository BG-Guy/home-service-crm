import "server-only";
import { appUrl } from "@/lib/env";
import { createThrottle } from "./throttle";
import type { GeocodeProvider } from "./types";

// OpenStreetMap Nominatim (SPEC §9.5). Usage policy: ≤ 1 req/s and an identifying User-Agent.
const throttle = createThrottle(1100);

export const nominatimGeocoder: GeocodeProvider = {
  id: "nominatim",
  async geocode(a) {
    const qs = new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      street: a.street,
      city: a.city,
      state: a.state,
      postalcode: a.zip,
      countrycodes: "us",
    });
    return throttle(async () => {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${qs}`,
        {
          headers: {
            "User-Agent": `home-service-crm (${appUrl()})`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      const rows = (await res.json()) as {
        lat: string;
        lon: string;
        display_name?: string;
      }[];
      const r = rows[0];
      if (!r) return null;
      return {
        lat: Number(r.lat),
        lng: Number(r.lon),
        matched: r.display_name ?? "",
      };
    });
  },
};
