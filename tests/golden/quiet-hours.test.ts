// ★ Golden: recipient time zone + quiet-hours deferral with jitter (SPEC M12).
import { describe, expect, it } from "vitest";
import {
  applyQuietHours,
  recipientTimeZone,
} from "@/features/messaging/compliance";
import { zonedParts } from "@/lib/time";

const CHI = "America/Chicago";

describe("recipient time zone", () => {
  it("property zone → ZIP3 table → company zone", () => {
    expect(
      recipientTimeZone({
        propertyTz: "America/Denver",
        zip: "78701",
        companyTz: CHI,
      }),
    ).toBe("America/Denver");
    expect(recipientTimeZone({ zip: "90210", companyTz: CHI })).toBe(
      "America/Los_Angeles",
    );
    expect(recipientTimeZone({ zip: "10001", companyTz: CHI })).toBe(
      "America/New_York",
    );
    expect(
      recipientTimeZone({ zip: "78701", companyTz: "America/New_York" }),
    ).toBe(CHI);
    // invalid zone / unknown zip → company zone
    expect(
      recipientTimeZone({
        propertyTz: "Mars/Olympus",
        zip: null,
        companyTz: CHI,
      }),
    ).toBe(CHI);
  });
});

describe("applyQuietHours (08:00–20:00 recipient time)", () => {
  it("inside the window: unchanged", () => {
    const at = new Date("2026-10-15T17:00:00Z"); // 12:00 CDT
    expect(applyQuietHours(at, CHI)).toEqual({ sendAt: at, deferred: false });
  });

  it("after 20:00 → next day 08:00 + jitter in [0, 30) min", () => {
    const at = new Date("2026-10-16T02:30:00Z"); // 21:30 CDT Oct 15
    for (const r of [0, 0.5, 0.9999]) {
      const d = applyQuietHours(at, CHI, { random: () => r });
      expect(d.deferred).toBe(true);
      const p = zonedParts(d.sendAt, CHI);
      expect(p.day).toBe(16);
      expect(p.hour).toBe(8);
      expect(p.minute).toBeGreaterThanOrEqual(0);
      expect(p.minute).toBeLessThan(30);
    }
    const max = applyQuietHours(at, CHI, { random: () => 0.9999 });
    expect(zonedParts(max.sendAt, CHI).minute).toBe(29);
  });

  it("before 08:00 → same day 08:00 (no jitter when disabled)", () => {
    const at = new Date("2026-10-15T11:10:00Z"); // 06:10 CDT
    const d = applyQuietHours(at, CHI, { jitterMinutes: 0 });
    expect(d.sendAt.toISOString()).toBe("2026-10-15T13:00:00.000Z");
  });

  it("uses the recipient's zone, not the company's", () => {
    const at = new Date("2026-10-15T14:30:00Z"); // 09:30 CDT, 07:30 PDT
    expect(applyQuietHours(at, CHI).deferred).toBe(false);
    expect(applyQuietHours(at, "America/Los_Angeles").deferred).toBe(true);
  });

  it("bypass (lead ack within 5 min, on my way) sends anyway", () => {
    const at = new Date("2026-10-16T04:00:00Z"); // 23:00 CDT
    expect(applyQuietHours(at, CHI, { bypass: true })).toEqual({
      sendAt: at,
      deferred: false,
    });
  });

  it("custom window from settings", () => {
    const at = new Date("2026-10-15T13:30:00Z"); // 08:30 CDT
    const d = applyQuietHours(at, CHI, {
      window: { start: "09:00", end: "19:00" },
      jitterMinutes: 0,
    });
    expect(d.deferred).toBe(true);
    expect(zonedParts(d.sendAt, CHI).hour).toBe(9);
  });

  it("DST change: deferral still lands on local 08:00", () => {
    // Nov 1 2026 is the fall-back Sunday in the US.
    const at = new Date("2026-11-01T03:00:00Z"); // 22:00 CDT Oct 31
    const d = applyQuietHours(at, CHI, { jitterMinutes: 0 });
    const p = zonedParts(d.sendAt, CHI);
    expect([p.month, p.day, p.hour, p.minute]).toEqual([11, 1, 8, 0]);
  });
});
