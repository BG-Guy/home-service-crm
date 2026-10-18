// Address autocomplete adapter: driver selection, the cached lookup behind
// /api/places/autocomplete, and the pure helpers both drivers share.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLru } from "@/adapters/places/cache";
import {
  formatLabel,
  toSuggestion,
  typedHouseNumber,
  uniqueSuggestions,
  uspsStreetName,
  zip5,
} from "@/adapters/places/shared";

const photonBody = (street: string) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-97.74, 30.27] },
      properties: {
        osm_type: "N",
        osm_id: 1,
        type: "house",
        housenumber: "12",
        street,
        city: "Austin",
        state: "Texas",
        postcode: "78701",
        countrycode: "US",
      },
    },
  ],
});

function mockFetch(answer: () => Promise<Response> | Response) {
  const fn = vi.fn(async () => answer());
  vi.stubGlobal("fetch", fn);
  return fn;
}

const load = () => import("@/adapters/places");

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("driver selection", () => {
  it("Photon by default; Geoapify with a key; none or Geoapify without a key is off", async () => {
    const { getPlacesProvider, placesDriverName, placesAttribution } =
      await load();
    vi.stubEnv("ADDRESS_AUTOCOMPLETE", "");
    expect(placesDriverName()).toBe("photon");
    expect(getPlacesProvider().id).toBe("photon");
    expect(placesAttribution("photon")).toBe("© OpenStreetMap contributors");

    vi.stubEnv("ADDRESS_AUTOCOMPLETE", "geoapify");
    vi.stubEnv("GEOAPIFY_API_KEY", "k");
    expect(getPlacesProvider().id).toBe("geoapify");
    expect(placesAttribution("geoapify")).toBe(
      "Powered by Geoapify · © OpenStreetMap contributors",
    );

    vi.stubEnv("GEOAPIFY_API_KEY", "");
    expect(placesDriverName()).toBe("geoapify");
    expect(getPlacesProvider().id).toBe("none");

    for (const v of ["none", "off", " NONE "]) {
      vi.stubEnv("ADDRESS_AUTOCOMPLETE", v);
      expect(getPlacesProvider().id).toBe("none");
    }
    expect(placesAttribution("none")).toBeNull();
  });
});

describe("suggestAddresses", () => {
  it("off: no request, enabled false", async () => {
    vi.stubEnv("ADDRESS_AUTOCOMPLETE", "none");
    const fetch = mockFetch(() => new Response("{}"));
    const { suggestAddresses } = await load();
    expect(await suggestAddresses({ query: "12 Congress Ave" })).toEqual({
      suggestions: [],
      attribution: null,
      enabled: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caches per query (case and spacing don't matter) and shares in-flight requests", async () => {
    const fetch = mockFetch(
      () => new Response(JSON.stringify(photonBody("Congress Avenue"))),
    );
    const { suggestAddresses } = await load();
    const [a, b] = await Promise.all([
      suggestAddresses({ query: "12 Congress Ave" }),
      suggestAddresses({ query: "12 Congress Ave" }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).toEqual({
      suggestions: [
        expect.objectContaining({
          label: "12 Congress Ave, Austin, TX 78701",
        }),
      ],
      attribution: "© OpenStreetMap contributors",
      enabled: true,
    });
    await suggestAddresses({ query: "  12   congress AVE " });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Another bias or another query is another request.
    await suggestAddresses({
      query: "12 Congress Ave",
      bias: { lat: 30.27, lng: -97.74 },
    });
    await suggestAddresses({ query: "12 Congress Ave S" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("a provider failure degrades to no suggestions, isn't cached, and logs no address", async () => {
    let fail = true;
    const fetch = mockFetch(() =>
      fail
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify(photonBody("Elm Street"))),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { suggestAddresses } = await load();
    expect(await suggestAddresses({ query: "12 Elm St" })).toEqual({
      suggestions: [],
      attribution: "© OpenStreetMap contributors",
      enabled: true,
      unavailable: true,
    });
    expect(warn).toHaveBeenCalledWith(
      "[places] photon lookup failed: HTTP 503",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Elm");

    fail = false;
    const again = await suggestAddresses({ query: "12 Elm St" });
    expect(again.suggestions.map((s) => s.street)).toEqual(["12 Elm St"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a network error or timeout is logged by name only", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
      });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { suggestAddresses } = await load();
    const r = await suggestAddresses({ query: "12 Oak St" });
    expect(r.unavailable).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "[places] photon lookup failed: TypeError (ENOTFOUND)",
    );
  });
});

describe("createLru", () => {
  it("evicts the least recently used entry and expires after the TTL", () => {
    let now = 0;
    const lru = createLru<string>(2, 1000, () => now);
    lru.set("a", "A");
    lru.set("b", "B");
    expect(lru.get("a")).toBe("A"); // a is now the most recent
    lru.set("c", "C"); // evicts b
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBe("A");
    expect(lru.size).toBe(2);
    now = 1000;
    expect(lru.get("c")).toBeUndefined();
    expect(lru.size).toBe(1);
  });
});

describe("shared mapping helpers", () => {
  it("uspsStreetName abbreviates the suffix and directionals, not the name", () => {
    expect(uspsStreetName("Pennsylvania Avenue Northwest")).toBe(
      "Pennsylvania Ave NW",
    );
    expect(uspsStreetName("North Lamar Boulevard")).toBe("N Lamar Blvd");
    expect(uspsStreetName("East 7th Street")).toBe("E 7th St");
    expect(uspsStreetName("Park Avenue South")).toBe("Park Ave S");
    expect(uspsStreetName("North Street")).toBe("North St");
    expect(uspsStreetName("Southwest Parkway")).toBe("Southwest Pkwy");
    expect(uspsStreetName("Avenue of the Americas")).toBe(
      "Avenue of the Americas",
    );
    expect(uspsStreetName("Broadway")).toBe("Broadway");
    expect(uspsStreetName("County Road 12")).toBe("County Road 12");
    expect(uspsStreetName("  Oak   Lane ")).toBe("Oak Ln");
  });

  it("zip5 keeps the first five-digit ZIP", () => {
    expect(zip5("78701")).toBe("78701");
    expect(zip5("20500-0003")).toBe("20500");
    expect(zip5("78701;78702")).toBe("78701");
    expect(zip5("123456")).toBe("");
    expect(zip5(undefined)).toBe("");
  });

  it("typedHouseNumber reads a leading number followed by a street word", () => {
    expect(typedHouseNumber("123 Main")).toBe("123");
    expect(typedHouseNumber(" 12B Oak St")).toBe("12B");
    expect(typedHouseNumber("12-34 Jackson Ave")).toBe("12-34");
    expect(typedHouseNumber("5th Ave")).toBeNull();
    expect(typedHouseNumber("1600")).toBeNull();
    expect(typedHouseNumber("Main 123")).toBeNull();
  });

  it("formatLabel skips missing parts", () => {
    expect(
      formatLabel({
        street: "1 Main St",
        city: "Austin",
        state: "TX",
        zip: "",
      }),
    ).toBe("1 Main St, Austin, TX");
    expect(
      formatLabel({ street: "1 Main St", city: "", state: "", zip: "78701" }),
    ).toBe("1 Main St, 78701");
  });

  it("toSuggestion needs a street and finite coordinates; uniqueSuggestions dedupes", () => {
    const base = { id: "x", street: "Main Street", lat: 1, lng: 2 };
    expect(toSuggestion({ ...base, street: " " }, null)).toBeNull();
    expect(toSuggestion({ ...base, lat: Number.NaN }, null)).toBeNull();
    expect(toSuggestion({ ...base, lng: null }, null)).toBeNull();
    const a = toSuggestion({ ...base, housenumber: "5;7" }, "9");
    expect(a).toMatchObject({ id: "x", street: "5 Main St" });
    const b = toSuggestion({ ...base, id: "y", housenumber: "5" }, null);
    expect(uniqueSuggestions([a, null, b], 5).map((s) => s.id)).toEqual(["x"]);
    // Same id, different addresses (a provider without ids): ids made unique.
    const c = toSuggestion({ ...base, housenumber: "6" }, null);
    expect(uniqueSuggestions([a, c], 5).map((s) => [s.id, s.street])).toEqual([
      ["x", "5 Main St"],
      ["x~1", "6 Main St"],
    ]);
  });
});
