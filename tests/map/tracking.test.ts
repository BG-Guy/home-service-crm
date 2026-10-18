// Public tracking page (/t, SPEC M19): ETA in the company time zone (QA T1-03) and the
// post-arrival phases (QA T1-12).
import { describe, expect, it } from "vitest";
import { trackingEta, trackingPhase } from "@/features/map/rules";

const now = new Date("2026-10-15T18:00:00Z"); // 2:00 PM in New York, 11:00 AM in LA

describe("trackingEta", () => {
  it("formats a stored eta_at in the company zone, not the server's", () => {
    const etaAt = new Date("2026-10-15T18:25:00Z");
    const ny = trackingEta({ etaAt, now, timeZone: "America/New_York" });
    expect(ny).toEqual({ minutes: 25, clock: "2:25 PM" });
    const la = trackingEta({ etaAt, now, timeZone: "America/Los_Angeles" });
    expect(la).toEqual({ minutes: 25, clock: "11:25 AM" });
  });

  it("falls back to a rough estimate from a fresh fix when eta_at has passed", () => {
    const r = trackingEta({
      etaAt: new Date("2026-10-15T17:50:00Z"),
      now,
      timeZone: "America/Chicago",
      fix: { lat: 41.88, lng: -87.63 },
      dest: { lat: 41.95, lng: -87.65 },
    });
    expect(r.minutes).toBeGreaterThan(0);
    // The clock is now + minutes in Chicago (1:xx PM), never the stale eta_at.
    expect(r.clock).toMatch(/^1:\d\d PM$/);
  });

  it("has no clock without an ETA", () => {
    expect(
      trackingEta({ etaAt: null, now, timeZone: "America/New_York" }),
    ).toEqual({ minutes: null, clock: null });
  });

  it("bad zones fall back safely", () => {
    const r = trackingEta({
      etaAt: new Date("2026-10-15T18:10:00Z"),
      now,
      timeZone: "Not/AZone",
    });
    expect(r.minutes).toBe(10);
    expect(r.clock).toMatch(/\d:\d\d [AP]M/);
  });
});

describe("trackingPhase", () => {
  it("live only en route", () => {
    expect(trackingPhase("en_route")).toBe("en_route");
  });
  it("arrived while on site", () => {
    for (const s of ["arrived", "in_progress", "on_hold"])
      expect(trackingPhase(s)).toBe("arrived");
  });
  it("finished after completion", () => {
    expect(trackingPhase("completed")).toBe("finished");
    expect(trackingPhase("closed")).toBe("finished");
  });
  it("inactive otherwise", () => {
    for (const s of ["scheduled", "confirmed", "cancelled", "unscheduled"])
      expect(trackingPhase(s)).toBe("inactive");
  });
});
