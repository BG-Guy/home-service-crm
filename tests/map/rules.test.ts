// Live-map rules (SPEC M19): staleness classification, status ring, ETA, fix sanity.
import { describe, expect, it } from "vitest";
import {
  classifyStaleness,
  distanceM,
  isPlausibleFix,
  roughEtaMinutes,
  techMapStatus,
} from "@/features/map/rules";

const now = new Date("2026-10-15T15:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

describe("stale-marker classification", () => {
  it("live up to 15 min", () => {
    expect(classifyStaleness(ago(0), now)).toBe("live");
    expect(classifyStaleness(ago(15), now)).toBe("live");
  });
  it("grey after 15 min", () => {
    expect(classifyStaleness(ago(15.5), now)).toBe("stale");
    expect(classifyStaleness(ago(60), now)).toBe("stale");
  });
  it("hidden after 60 min", () => {
    expect(classifyStaleness(ago(61), now)).toBe("hidden");
  });
  it("custom thresholds and ISO input", () => {
    expect(classifyStaleness(ago(10).toISOString(), now, 5, 30)).toBe("stale");
    expect(classifyStaleness(ago(31).toISOString(), now, 5, 30)).toBe("hidden");
  });
});

describe("status ring", () => {
  it("clocked out wins", () => {
    expect(
      techMapStatus({ clockedIn: false, currentJobStatus: "in_progress" }),
    ).toBe("off");
  });
  it("en route / on job / idle", () => {
    expect(
      techMapStatus({ clockedIn: true, currentJobStatus: "en_route" }),
    ).toBe("en_route");
    expect(
      techMapStatus({ clockedIn: true, currentJobStatus: "arrived" }),
    ).toBe("on_job");
    expect(
      techMapStatus({ clockedIn: true, currentJobStatus: "in_progress" }),
    ).toBe("on_job");
    expect(techMapStatus({ clockedIn: true, currentJobStatus: null })).toBe(
      "idle",
    );
  });
});

describe("geometry", () => {
  it("haversine ≈ 1 km per 0.009° latitude", () => {
    const d = distanceM(
      { lat: 30.27, lng: -97.74 },
      { lat: 30.279, lng: -97.74 },
    );
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });
  it("rough ETA is at least a minute and grows with distance", () => {
    const a = { lat: 30.27, lng: -97.74 };
    expect(roughEtaMinutes(a, a)).toBe(1);
    const near = roughEtaMinutes(a, { lat: 30.28, lng: -97.74 });
    const far = roughEtaMinutes(a, { lat: 30.4, lng: -97.74 });
    expect(far).toBeGreaterThan(near);
    // ~14.5 km straight × 1.3 detour at 25 mph ≈ 28 min
    expect(far).toBeGreaterThanOrEqual(25);
    expect(far).toBeLessThanOrEqual(32);
  });
  it("rejects null island and out-of-range fixes", () => {
    expect(isPlausibleFix(0, 0)).toBe(false);
    expect(isPlausibleFix(91, 0)).toBe(false);
    expect(isPlausibleFix(30.2, -197)).toBe(false);
    expect(isPlausibleFix(Number.NaN, 1)).toBe(false);
    expect(isPlausibleFix(30.27, -97.74)).toBe(true);
  });
});
