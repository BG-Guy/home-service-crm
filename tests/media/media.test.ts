import { describe, expect, it } from "vitest";
import { pickEmbedPhotos } from "@/features/media/api";
import { distanceM, isFarFromSite } from "@/features/media/geo";

const p = (id: string, tag: string, star = false) => ({
  id,
  tag,
  includeInInvoice: star,
});

describe("invoice photo embedding cascade (§M11)", () => {
  const all = [
    p("b1", "before"),
    p("b2", "before"),
    p("b3", "before"),
    p("d1", "during"),
    p("a1", "after"),
    p("a2", "after"),
    p("a3", "after"),
  ];

  it("no stars, no explicit list → latest 2 before + 2 after", () => {
    expect(pickEmbedPhotos(all, "invoice", null).map((x) => x.id)).toEqual([
      "b2",
      "b3",
      "a2",
      "a3",
    ]);
  });

  it("starred photos win over the default", () => {
    const s = all.map((x) =>
      x.id === "d1" || x.id === "a1" ? { ...x, includeInInvoice: true } : x,
    );
    expect(pickEmbedPhotos(s, "invoice", null).map((x) => x.id)).toEqual([
      "d1",
      "a1",
    ]);
  });

  it("the invoice's ordered photo list wins over stars (unknown ids skipped)", () => {
    const s = all.map((x) => ({ ...x, includeInInvoice: true }));
    expect(
      pickEmbedPhotos(s, "invoice", ["a3", "gone", "b1"]).map((x) => x.id),
    ).toEqual(["a3", "b1"]);
  });

  it("caps: invoice ≤ 8, receipt ≤ 4, portal = all starred", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      p(`s${i}`, "after", true),
    );
    expect(pickEmbedPhotos(many, "invoice", null)).toHaveLength(8);
    expect(pickEmbedPhotos(many, "receipt", null)).toHaveLength(4);
    expect(pickEmbedPhotos(many, "portal", null)).toHaveLength(12);
    expect(pickEmbedPhotos(all, "portal", null)).toHaveLength(0);
  });
});

describe("far_from_site flag", () => {
  const site = { lat: 30.2672, lng: -97.7431 }; // Austin
  it("haversine distance is about right", () => {
    const d = distanceM(site, { lat: 30.2762, lng: -97.7431 }); // ~1 km north
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });
  it("within the limit (plus GPS accuracy slack) is not flagged", () => {
    expect(isFarFromSite({ lat: 30.2699, lng: -97.7431 }, site, 500)).toBe(
      false,
    );
    expect(
      isFarFromSite({ lat: 30.2726, lng: -97.7431, accuracyM: 200 }, site, 500),
    ).toBe(false);
  });
  it("beyond the limit is flagged", () => {
    expect(isFarFromSite({ lat: 30.2762, lng: -97.7431 }, site, 500)).toBe(
      true,
    );
  });
});
