import { describe, expect, it } from "vitest";
import { milesBetween as fromHub } from "@/features/jobs/dispatch/recommend";
import { formatMiles, legMiles, milesBetween } from "@/lib/geo";

describe("geo", () => {
  it("measures straight-line miles (Denver Union Station → Coors Field ≈ 0.4 mi)", () => {
    const mi = milesBetween(
      { lat: 39.7527, lng: -105.0001 },
      { lat: 39.7559, lng: -104.9942 },
    );
    expect(mi).toBeGreaterThan(0.3);
    expect(mi).toBeLessThan(0.5);
  });

  it("is the same function the Assign hub ranks with", () => {
    expect(fromHub).toBe(milesBetween);
  });

  it("formats leg labels", () => {
    expect(formatMiles(0.04)).toBe("< 0.1 mi");
    expect(formatMiles(0.44)).toBe("0.4 mi");
    expect(formatMiles(3.25)).toBe("3.3 mi");
    expect(formatMiles(9.94)).toBe("9.9 mi");
    expect(formatMiles(14.4)).toBe("14 mi");
    expect(formatMiles(Number.NaN)).toBe("");
  });

  it("gives each leg's miles, null where a stop has no position", () => {
    const a = { lat: 39.75, lng: -105 };
    const b = { lat: 39.76, lng: -105 };
    const legs = legMiles([a, b, null, a]);
    expect(legs).toHaveLength(3);
    expect(legs[0]).toBeCloseTo(0.69, 1);
    expect(legs[1]).toBeNull();
    expect(legs[2]).toBeNull();
    expect(legMiles([a])).toEqual([]);
  });
});
