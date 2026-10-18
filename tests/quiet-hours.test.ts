import { describe, expect, it } from "vitest";
import {
  isInsideSendWindow,
  isQuietHours,
  nextAllowedSendTime,
} from "@/lib/quiet-hours";

const NY = "America/New_York";
const LA = "America/Los_Angeles";
const noJitter = { jitterMinutes: 0 };

describe("quiet hours (default 08:00–20:00 recipient time)", () => {
  it("detects inside/outside the window", () => {
    // 2026-10-15 12:00 UTC = 08:00 EDT
    expect(isQuietHours(new Date("2026-10-15T12:00:00Z"), NY)).toBe(false);
    // 11:59 UTC = 07:59 EDT
    expect(isQuietHours(new Date("2026-10-15T11:59:00Z"), NY)).toBe(true);
    // 23:59 UTC = 19:59 EDT
    expect(isQuietHours(new Date("2026-10-15T23:59:00Z"), NY)).toBe(false);
    // 00:00 UTC next day = 20:00 EDT (end exclusive)
    expect(isQuietHours(new Date("2026-10-16T00:00:00Z"), NY)).toBe(true);
  });

  it("uses the recipient's zone", () => {
    const at = new Date("2026-10-15T13:00:00Z"); // 09:00 NY, 06:00 LA
    expect(isQuietHours(at, NY)).toBe(false);
    expect(isQuietHours(at, LA)).toBe(true);
  });

  it("returns the same instant when sending is allowed", () => {
    const at = new Date("2026-10-15T15:00:00Z");
    expect(nextAllowedSendTime(at, NY, noJitter)).toBe(at);
  });

  it("defers early-morning sends to 08:00 the same day", () => {
    const at = new Date("2026-10-15T09:30:00Z"); // 05:30 EDT
    expect(nextAllowedSendTime(at, NY, noJitter).toISOString()).toBe(
      "2026-10-15T12:00:00.000Z",
    );
  });

  it("defers evening sends to 08:00 the next day", () => {
    const at = new Date("2026-10-16T01:30:00Z"); // 21:30 EDT on Oct 15
    expect(nextAllowedSendTime(at, NY, noJitter).toISOString()).toBe(
      "2026-10-16T12:00:00.000Z",
    );
  });

  it("handles the DST change (fall back on 2026-11-01)", () => {
    const at = new Date("2026-11-01T02:00:00Z"); // 22:00 EDT Oct 31
    // 08:00 EST on Nov 1 = 13:00 UTC
    expect(nextAllowedSendTime(at, NY, noJitter).toISOString()).toBe(
      "2026-11-01T13:00:00.000Z",
    );
  });

  it("handles the DST change (spring forward on 2026-03-08)", () => {
    const at = new Date("2026-03-08T06:00:00Z"); // 01:00 EST Mar 8
    // 08:00 EDT = 12:00 UTC
    expect(nextAllowedSendTime(at, NY, noJitter).toISOString()).toBe(
      "2026-03-08T12:00:00.000Z",
    );
  });

  it("adds 0–30 min jitter", () => {
    const at = new Date("2026-10-15T09:30:00Z");
    const max = nextAllowedSendTime(at, NY, { random: () => 0.999999 });
    expect(max.toISOString()).toBe("2026-10-15T12:29:59.000Z");
    const min = nextAllowedSendTime(at, NY, { random: () => 0 });
    expect(min.toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });

  it("supports custom and midnight-wrapping windows", () => {
    const window = { start: "22:00", end: "06:00" };
    expect(
      isInsideSendWindow(new Date("2026-10-16T03:00:00Z"), NY, window),
    ).toBe(true); // 23:00
    expect(
      isInsideSendWindow(new Date("2026-10-15T16:00:00Z"), NY, window),
    ).toBe(false); // 12:00
    const next = nextAllowedSendTime(new Date("2026-10-15T16:00:00Z"), NY, {
      window,
      jitterMinutes: 0,
    });
    expect(next.toISOString()).toBe("2026-10-16T02:00:00.000Z"); // 22:00 EDT
  });

  it("rejects malformed windows", () => {
    expect(() =>
      isQuietHours(new Date(), NY, { start: "8am", end: "20:00" }),
    ).toThrow();
  });
});
