// Geoapify places driver: request shape and `format=json` → suggestion mapping.
// Fixtures follow Geoapify's documented autocomplete response (no network in tests).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeoapifyResponse } from "@/adapters/places/geoapify";

type Result = NonNullable<GeoapifyResponse["results"]>[number];
const result = (r: Result): Result => ({
  country_code: "us",
  lat: 30.27,
  lon: -97.74,
  ...r,
});

const WHITE_HOUSE = result({
  place_id: "51a1b2",
  result_type: "building",
  name: "White House",
  housenumber: "1600",
  street: "Pennsylvania Avenue Northwest",
  city: "Washington",
  state: "District of Columbia",
  state_code: "DC",
  postcode: "20500",
  lat: 38.8977,
  lon: -77.0365,
  formatted:
    "White House, 1600 Pennsylvania Avenue Northwest, Washington, DC 20500, United States of America",
});

const LAMAR = result({
  place_id: "51c3d4",
  result_type: "street",
  street: "North Lamar Boulevard",
  city: "Austin",
  state: "Texas",
  postcode: "78756",
});

function mockFetch(answer: () => { status?: number; body?: unknown }) {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      calls.push(new URL(input));
      const a = answer();
      return new Response(JSON.stringify(a.body ?? {}), {
        status: a.status ?? 200,
      });
    }),
  );
  return calls;
}

const load = () => import("@/adapters/places/geoapify");

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("GEOAPIFY_API_KEY", "test-key-1234");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mapGeoapify", () => {
  it("maps a building: USPS street, state_code, ZIP, coordinates", async () => {
    const { mapGeoapify } = await load();
    expect(
      mapGeoapify({ results: [WHITE_HOUSE] }, "1600 pennsylvania", 5),
    ).toEqual([
      {
        id: "geoapify:51a1b2",
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

  it("maps a state name without state_code, and gives a street the typed number", async () => {
    const { mapGeoapify } = await load();
    const [s] = mapGeoapify({ results: [LAMAR] }, "4501 n lamar", 5);
    expect(s).toMatchObject({
      id: "geoapify:51c3d4#4501",
      street: "4501 N Lamar Blvd",
      state: "TX",
      label: "4501 N Lamar Blvd, Austin, TX 78756",
    });
  });

  it("falls back from a missing city; drops non-US, streetless and placeless results; dedupes", async () => {
    const { mapGeoapify } = await load();
    const out = mapGeoapify(
      {
        results: [
          result({
            ...LAMAR,
            place_id: "a",
            city: undefined,
            suburb: "Crestview",
          }),
          result({
            ...LAMAR,
            place_id: "b",
            city: undefined,
            county: "Travis County",
          }),
          result({ ...LAMAR, place_id: "c" }),
          result({ ...LAMAR, place_id: "d" }), // same label as "c"
          result({ ...LAMAR, place_id: "e", country_code: "ca" }),
          result({ place_id: "f", result_type: "city", city: "Austin" }),
          result({ ...LAMAR, place_id: "g", lat: undefined }),
        ],
      },
      "lamar",
      10,
    );
    expect(out.map((s) => [s.id, s.city])).toEqual([
      ["geoapify:a", "Crestview"],
      ["geoapify:b", "Travis County"],
      ["geoapify:c", "Austin"],
    ]);
  });

  it("empty payloads map to no suggestions", async () => {
    const { mapGeoapify } = await load();
    expect(mapGeoapify({}, "lamar", 5)).toEqual([]);
    expect(mapGeoapify({ results: [] }, "lamar", 5)).toEqual([]);
  });
});

describe("geoapifyPlaces.suggest", () => {
  it("asks for US results with the key, limit and proximity bias", async () => {
    const calls = mockFetch(() => ({ body: { results: [WHITE_HOUSE] } }));
    const { geoapifyPlaces } = await load();
    const out = await geoapifyPlaces.suggest({
      query: "1600 Pennsylvania Ave",
      limit: 3,
      bias: { lat: 30.2672, lng: -97.7431 },
    });
    expect(out).toHaveLength(1);
    const url = calls[0];
    expect(`${url?.origin}${url?.pathname}`).toBe(
      "https://api.geoapify.com/v1/geocode/autocomplete",
    );
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      text: "1600 Pennsylvania Ave",
      filter: "countrycode:us",
      format: "json",
      lang: "en",
      limit: "6",
      apiKey: "test-key-1234",
      bias: "proximity:-97.74310,30.26720",
    });
  });

  it("without GEOAPIFY_API_KEY it returns nothing and calls nobody", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    const calls = mockFetch(() => ({ body: { results: [WHITE_HOUSE] } }));
    const { geoapifyPlaces } = await load();
    expect(await geoapifyPlaces.suggest({ query: "1600 penn" })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("non-2xx throws with the status; the message never holds the key or query", async () => {
    mockFetch(() => ({ status: 401, body: { message: "Invalid apiKey" } }));
    const { geoapifyPlaces } = await load();
    const err = await geoapifyPlaces
      .suggest({ query: "742 Evergreen Terrace" })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "PlacesHttpError", status: 401 });
    const message = String((err as Error).message);
    expect(message).not.toContain("test-key");
    expect(message).not.toContain("Evergreen");
  });
});
