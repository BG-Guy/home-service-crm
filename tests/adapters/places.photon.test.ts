// Photon places driver: request shape and GeoJSON → suggestion mapping. Fixtures
// follow Photon's documented response format (no network in tests).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotonResponse } from "@/adapters/places/photon";

type Props = NonNullable<
  NonNullable<PhotonResponse["features"]>[number]["properties"]
>;
const feature = (p: Props, lng = -97.74, lat = 30.27) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { countrycode: "US", ...p },
});

const WHITE_HOUSE = feature(
  {
    osm_type: "W",
    osm_id: 238241022,
    osm_key: "building",
    type: "house",
    name: "White House",
    housenumber: "1600",
    street: "Pennsylvania Avenue Northwest",
    postcode: "20500",
    city: "Washington",
    state: "District of Columbia",
    country: "United States",
  } as Props,
  -77.0365,
  38.8977,
);

const MAIN_ST = feature({
  osm_type: "W",
  osm_id: 1001,
  type: "street",
  name: "Main Street",
  postcode: "78701",
  city: "Austin",
  state: "Texas",
});

function mockFetch(
  answer: (url: URL) => { status?: number; body?: unknown } = () => ({
    body: { type: "FeatureCollection", features: [] },
  }),
) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, init });
      const a = answer(url);
      return new Response(JSON.stringify(a.body ?? {}), {
        status: a.status ?? 200,
      });
    }),
  );
  return calls;
}

// Fresh module per test: the driver remembers refused filters per process.
const load = () => import("@/adapters/places/photon");

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("APP_URL", "https://crm.example.com");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mapPhoton", () => {
  it("maps a house result: USPS street, state code, ZIP, coordinates", async () => {
    const { mapPhoton } = await load();
    expect(
      mapPhoton({ features: [WHITE_HOUSE] }, "1600 pennsylvania", 5),
    ).toEqual([
      {
        id: "photon:W238241022",
        label: "1600 Pennsylvania Ave NW, Washington, DC 20500",
        street: "1600 Pennsylvania Ave NW",
        city: "Washington",
        state: "DC",
        zip: "20500",
        lat: 38.8977,
        lng: -77.0365,
      },
    ]);
  });

  it("a street result takes the house number the user typed", async () => {
    const { mapPhoton } = await load();
    const [withNumber] = mapPhoton({ features: [MAIN_ST] }, "123 main st", 5);
    expect(withNumber).toMatchObject({
      id: "photon:W1001#123",
      street: "123 Main St",
      label: "123 Main St, Austin, TX 78701",
    });
    const [plain] = mapPhoton({ features: [MAIN_ST] }, "main st aus", 5);
    expect(plain).toMatchObject({
      id: "photon:W1001",
      street: "Main St",
      label: "Main St, Austin, TX 78701",
    });
  });

  it("falls back from a missing city to town, village, locality, district, county", async () => {
    const { mapPhoton } = await load();
    const house = (extra: Partial<Props>, id: number) =>
      feature({
        osm_type: "N",
        osm_id: id,
        type: "house",
        housenumber: "7",
        street: "Ranch Road",
        state: "Texas",
        postcode: "78676",
        ...extra,
      });
    const cities = mapPhoton(
      {
        features: [
          house({ town: "Dripping Springs", county: "Hays County" }, 1),
          house({ village: "Wimberley", district: "Woodcreek" }, 2),
          house({ locality: "Hamlet", district: "North" }, 3),
          house({ district: "Lakeway" }, 4),
          house({ county: "Hays County" }, 5),
          house({}, 6),
        ],
      },
      "7 ranch",
      10,
    ).map((s) => s.city);
    expect(cities).toEqual([
      "Dripping Springs",
      "Wimberley",
      "Hamlet",
      "Lakeway",
      "Hays County",
      "",
    ]);
  });

  it("dedupes by label, drops non-US and streetless results, honors the limit", async () => {
    const { mapPhoton } = await load();
    const segment = (id: number) =>
      feature({ ...MAIN_ST.properties, osm_id: id } as Props);
    const out = mapPhoton(
      {
        features: [
          segment(1),
          segment(2), // same street, another OSM way
          feature({
            osm_type: "W",
            osm_id: 9,
            type: "street",
            name: "Main Street",
            city: "Toronto",
            state: "Ontario",
            countrycode: "CA",
          }),
          feature({ osm_type: "R", osm_id: 3, type: "city", name: "Austin" }),
          { properties: { type: "house", housenumber: "1", street: "Elm" } }, // no geometry
        ],
      },
      "main st",
      5,
    );
    expect(out.map((s) => s.label)).toEqual(["Main St, Austin, TX 78701"]);

    const many = Array.from({ length: 12 }, (_, i) =>
      feature({
        osm_type: "N",
        osm_id: i,
        type: "house",
        housenumber: String(100 + i),
        street: "Oak Lane",
        city: "Austin",
        state: "TX",
        postcode: "78704",
      }),
    );
    const five = mapPhoton({ features: many }, "oak lane", 5);
    expect(five).toHaveLength(5);
    expect(five[0]?.street).toBe("100 Oak Ln");
  });

  it("keeps the first ZIP of a ZIP+4 or a list, and empty when there is none", async () => {
    const { mapPhoton } = await load();
    const zips = mapPhoton(
      {
        features: [
          feature({ ...MAIN_ST.properties, postcode: "78701-1234" } as Props),
          feature({
            ...MAIN_ST.properties,
            osm_id: 2,
            city: "Round Rock",
            postcode: "78664;78665",
          } as Props),
          feature({
            ...MAIN_ST.properties,
            osm_id: 3,
            city: "Pflugerville",
            postcode: undefined,
          } as Props),
        ],
      },
      "main",
      5,
    ).map((s) => [s.zip, s.label]);
    expect(zips).toEqual([
      ["78701", "Main St, Austin, TX 78701"],
      ["78664", "Main St, Round Rock, TX 78664"],
      ["", "Main St, Pflugerville, TX"],
    ]);
  });

  it("empty or odd payloads map to no suggestions", async () => {
    const { mapPhoton } = await load();
    expect(mapPhoton({}, "1600 penn", 5)).toEqual([]);
    expect(mapPhoton({ features: [] }, "1600 penn", 5)).toEqual([]);
    expect(mapPhoton({ features: [{}] }, "1600 penn", 5)).toEqual([]);
  });
});

describe("photonPlaces.suggest", () => {
  it("asks for US houses and streets near the bias, with an identifying User-Agent", async () => {
    const calls = mockFetch(() => ({ body: { features: [WHITE_HOUSE] } }));
    const { photonPlaces } = await load();
    const out = await photonPlaces.suggest({
      query: "1600 Pennsylvania Ave",
      limit: 5,
      bias: { lat: 30.2672, lng: -97.7431 },
    });
    expect(out.map((s) => s.label)).toEqual([
      "1600 Pennsylvania Ave NW, Washington, DC 20500",
    ]);
    expect(calls).toHaveLength(1);
    const url = calls[0]?.url;
    const init = calls[0]?.init;
    expect(`${url?.origin}${url?.pathname}`).toBe(
      "https://photon.komoot.io/api/",
    );
    const qs = url?.searchParams;
    expect(qs?.get("q")).toBe("1600 Pennsylvania Ave");
    expect(qs?.get("limit")).toBe("10");
    expect(qs?.get("countrycode")).toBe("us");
    expect(qs?.getAll("layer")).toEqual(["house", "street"]);
    expect(qs?.get("lang")).toBe("en");
    expect(qs?.get("lat")).toBe("30.26720");
    expect(qs?.get("lon")).toBe("-97.74310");
    expect(new Headers(init?.headers).get("User-Agent")).toBe(
      "home-service-crm (https://crm.example.com)",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("PHOTON_URL points at a self-hosted server; no bias, no lat/lon", async () => {
    vi.stubEnv("PHOTON_URL", "http://photon.internal:2322/");
    const calls = mockFetch();
    const { photonPlaces } = await load();
    await photonPlaces.suggest({ query: "main st" });
    const url = calls[0]?.url;
    expect(`${url?.origin}${url?.pathname}`).toBe(
      "http://photon.internal:2322/api/",
    );
    expect(url?.searchParams.has("lat")).toBe(false);
  });

  it("a 400 (filter unknown to an older Photon) retries without it, once per process", async () => {
    const calls = mockFetch((url) =>
      url.searchParams.has("countrycode")
        ? { status: 400, body: { message: "unknown query parameter" } }
        : { body: { features: [MAIN_ST] } },
    );
    const { photonPlaces } = await load();
    const first = await photonPlaces.suggest({ query: "123 main" });
    expect(first.map((s) => s.street)).toEqual(["123 Main St"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url.searchParams.getAll("layer")).toEqual([
      "house",
      "street",
    ]);
    await photonPlaces.suggest({ query: "456 main" });
    expect(calls).toHaveLength(3);
    expect(calls[2]?.url.searchParams.has("countrycode")).toBe(false);
  });

  it("non-2xx throws an error that carries the status, never the query", async () => {
    mockFetch(() => ({ status: 503 }));
    const { photonPlaces } = await load();
    const err = await photonPlaces
      .suggest({ query: "742 Evergreen Terrace" })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "PlacesHttpError", status: 503 });
    expect(String((err as Error).message)).not.toContain("Evergreen");
  });
});
