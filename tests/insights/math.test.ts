// Pure Insights helpers (B8): period resolution, KPI math, AR aging, cash-share
// outliers and business-hours speed-to-lead.
import { describe, expect, it } from "vitest";
import {
  agingBucket,
  businessMinutesBetween,
  change,
  isCashShareOutlier,
  median,
  pointChange,
  ratio,
} from "@/features/insights/math";
import {
  dayCount,
  periodQuery,
  rangeText,
  resolvePeriod,
} from "@/features/insights/period";

const TZ = "America/Chicago";
// Thursday 2026-10-15 10:00 in Chicago (CDT, UTC−5).
const NOW = new Date("2026-10-15T15:00:00Z");

describe("resolvePeriod", () => {
  it("today vs yesterday, local midnight bounds", () => {
    const p = resolvePeriod({ period: "today" }, NOW, TZ);
    expect(p).toMatchObject({
      key: "today",
      fromKey: "2026-10-15",
      toKey: "2026-10-15",
      days: 1,
    });
    expect(p.from.toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-10-16T05:00:00.000Z");
    expect(p.prev).toMatchObject({
      fromKey: "2026-10-14",
      toKey: "2026-10-14",
    });
  });

  it("week to date starts Monday by default (Sunday when configured)", () => {
    const mon = resolvePeriod({ period: "week" }, NOW, TZ);
    expect([mon.fromKey, mon.toKey, mon.days]).toEqual([
      "2026-10-12",
      "2026-10-15",
      4,
    ]);
    expect([mon.prev.fromKey, mon.prev.toKey]).toEqual([
      "2026-10-05",
      "2026-10-08",
    ]);
    const sun = resolvePeriod({ period: "week" }, NOW, TZ, { weekStartsOn: 0 });
    expect(sun.fromKey).toBe("2026-10-11");
  });

  it("month to date compares with the same days of last month (clamped)", () => {
    const p = resolvePeriod({ period: "month" }, NOW, TZ);
    expect([p.fromKey, p.toKey]).toEqual(["2026-10-01", "2026-10-15"]);
    expect([p.prev.fromKey, p.prev.toKey]).toEqual([
      "2026-09-01",
      "2026-09-15",
    ]);
    const mar31 = resolvePeriod(
      { period: "month" },
      new Date("2026-03-31T18:00:00Z"),
      TZ,
    );
    expect([mar31.prev.fromKey, mar31.prev.toKey]).toEqual([
      "2026-02-01",
      "2026-02-28",
    ]);
  });

  it("last 30 days and the 30 before", () => {
    const p = resolvePeriod({ period: "last30" }, NOW, TZ);
    expect([p.fromKey, p.toKey, p.days]).toEqual([
      "2026-09-16",
      "2026-10-15",
      30,
    ]);
    expect([p.prev.fromKey, p.prev.toKey, p.prev.days]).toEqual([
      "2026-08-17",
      "2026-09-15",
      30,
    ]);
  });

  it("custom: swaps reversed dates, never ends after today, same-length previous", () => {
    const p = resolvePeriod(
      { period: "custom", from: "2026-10-20", to: "2026-10-01" },
      NOW,
      TZ,
    );
    expect([p.fromKey, p.toKey]).toEqual(["2026-10-01", "2026-10-15"]);
    expect([p.prev.fromKey, p.prev.toKey]).toEqual([
      "2026-09-16",
      "2026-09-30",
    ]);
    expect(periodQuery(p)).toBe("period=custom&from=2026-10-01&to=2026-10-15");
  });

  it("labels periods in words, never ISO keys (QA2 T4-19/T4-30)", () => {
    expect(resolvePeriod({ period: "week" }, NOW, TZ).label).toBe("This week");
    expect(resolvePeriod({ period: "last30" }, NOW, TZ).label).toBe(
      "Last 30 days",
    );
    expect(
      resolvePeriod(
        { period: "custom", from: "2026-09-01", to: "2026-09-30" },
        NOW,
        TZ,
      ).label,
    ).toBe("Sep 1 – 30, 2026");
    expect(rangeText("2026-10-15", "2026-10-15")).toBe("Oct 15, 2026");
    expect(rangeText("2026-09-28", "2026-10-04")).toBe("Sep 28 – Oct 4, 2026");
    expect(rangeText("2025-12-29", "2026-01-04")).toBe(
      "Dec 29, 2025 – Jan 4, 2026",
    );
  });

  it("falls back to week on junk input", () => {
    expect(resolvePeriod({ period: "decade" }, NOW, TZ).key).toBe("week");
    expect(resolvePeriod({ period: "custom", from: "nope" }, NOW, TZ).key).toBe(
      "week",
    );
  });

  it("handles the DST change (day of 25 hours)", () => {
    // 2026-11-01 is the US fall-back day.
    const p = resolvePeriod(
      { period: "today" },
      new Date("2026-11-01T18:00:00Z"),
      TZ,
    );
    expect(p.to.getTime() - p.from.getTime()).toBe(25 * 3_600_000);
    expect(dayCount("2026-10-01", "2026-10-31")).toBe(31);
  });
});

describe("KPI math", () => {
  it("ratio/change never produce NaN or Infinity", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(3, 4)).toBe(0.75);
    expect(change(120, 100)).toBeCloseTo(0.2);
    expect(change(5, 0)).toBeNull();
    expect(change(0, 0)).toBe(0);
    expect(pointChange(0.3, 0.25)).toBeCloseTo(0.05);
  });

  it("median of odd, even and empty sets", () => {
    expect(median([7, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 10])).toBe(3.5);
    expect(median([])).toBeNull();
  });

  it("AR aging buckets by whole days since issue", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
    expect(agingBucket(ago(0), now)).toBe("0-30");
    expect(agingBucket(ago(30), now)).toBe("0-30");
    expect(agingBucket(ago(31), now)).toBe("31-60");
    expect(agingBucket(ago(60.5), now)).toBe("31-60");
    expect(agingBucket(ago(61), now)).toBe("61-90");
    expect(agingBucket(ago(91), now)).toBe("90+");
  });

  it("cash-share outlier: 1.5× mean under 10 techs, mean + 2σ otherwise", () => {
    expect(isCashShareOutlier(0.5, [0.1, 0.2, 0.5])).toBe(true); // mean .267 → 1.5× = .4
    expect(isCashShareOutlier(0.3, [0.1, 0.2, 0.3])).toBe(false);
    const big = [0.1, 0.12, 0.11, 0.1, 0.09, 0.13, 0.1, 0.11, 0.12, 0.1, 0.6];
    expect(isCashShareOutlier(0.6, big)).toBe(true);
    expect(isCashShareOutlier(0.13, big)).toBe(false);
    expect(isCashShareOutlier(0.5, [0, 0])).toBe(false);
  });
});

describe("businessMinutesBetween (speed to lead in business hours)", () => {
  const hours = [1, 2, 3, 4, 5].map((day) => ({
    day,
    open: "08:00",
    close: "17:00",
  }));
  const at = (iso: string) => new Date(iso);

  it("counts plain minutes inside opening hours", () => {
    // Thu 10:00 → 10:07 CDT
    expect(
      businessMinutesBetween(
        at("2026-10-15T15:00:00Z"),
        at("2026-10-15T15:07:00Z"),
        hours,
        TZ,
      ),
    ).toBe(7);
  });

  it("an evening lead starts counting at the next opening", () => {
    // Thu 20:00 CDT → Fri 08:05 CDT = 5 business minutes
    expect(
      businessMinutesBetween(
        at("2026-10-16T01:00:00Z"),
        at("2026-10-16T13:05:00Z"),
        hours,
        TZ,
      ),
    ).toBe(5);
  });

  it("skips the weekend", () => {
    // Fri 16:50 CDT → Mon 08:10 CDT = 10 + 10 minutes
    expect(
      businessMinutesBetween(
        at("2026-10-16T21:50:00Z"),
        at("2026-10-19T13:10:00Z"),
        hours,
        TZ,
      ),
    ).toBe(20);
  });

  it("no hours configured = wall clock; reversed = 0", () => {
    expect(
      businessMinutesBetween(
        at("2026-10-16T01:00:00Z"),
        at("2026-10-16T02:00:00Z"),
        [],
        TZ,
      ),
    ).toBe(60);
    expect(
      businessMinutesBetween(
        at("2026-10-16T02:00:00Z"),
        at("2026-10-16T01:00:00Z"),
        hours,
        TZ,
      ),
    ).toBe(0);
  });
});
