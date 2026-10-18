import { describe, expect, it } from "vitest";
import {
  addMonths,
  addMonthsToKey,
  clampKey,
  formatFieldDate,
  formatHm,
  formatTime12,
  inRange,
  localTodayKey,
  minuteOptions,
  monthDiff,
  monthGrid,
  nearestMinute,
  parseHm,
  to12,
  to24,
  weekEdge,
  weekdayOf,
} from "@/ui/components/picker-math";

describe("calendar grid", () => {
  it("always has 6 weeks starting on the week start", () => {
    const oct = monthGrid({ y: 2026, m: 10 });
    expect(oct).toHaveLength(42);
    // Oct 1, 2026 is a Thursday: Sunday-first grid starts on Sep 27.
    expect(oct[0]?.key).toBe("2026-09-27");
    expect(oct[0]?.inMonth).toBe(false);
    expect(oct[4]).toEqual({ key: "2026-10-01", day: 1, inMonth: true });
    expect(oct.filter((d) => d.inMonth)).toHaveLength(31);
    const monday = monthGrid({ y: 2026, m: 10 }, 1);
    expect(monday[0]?.key).toBe("2026-09-28");
    expect(weekdayOf(monday[0]?.key ?? "")).toBe(1);
  });

  it("handles February in leap and common years", () => {
    expect(monthGrid({ y: 2028, m: 2 }).filter((d) => d.inMonth)).toHaveLength(
      29,
    );
    expect(monthGrid({ y: 2026, m: 2 }).filter((d) => d.inMonth)).toHaveLength(
      28,
    );
  });

  it("moves months across years", () => {
    expect(addMonths({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonths({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(addMonths({ y: 2026, m: 5 }, -17)).toEqual({ y: 2024, m: 12 });
    expect(monthDiff({ y: 2026, m: 11 }, { y: 2027, m: 2 })).toBe(3);
  });

  it("keeps the day when paging months, clamped to the month's end", () => {
    expect(addMonthsToKey("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToKey("2028-03-31", -1)).toBe("2028-02-29");
    expect(addMonthsToKey("2026-10-18", 12)).toBe("2027-10-18");
  });

  it("finds week edges for Home / End", () => {
    expect(weekEdge("2026-10-21", "start")).toBe("2026-10-18");
    expect(weekEdge("2026-10-21", "end")).toBe("2026-10-24");
    expect(weekEdge("2026-10-21", "start", 1)).toBe("2026-10-19");
  });

  it("checks and clamps min / max", () => {
    expect(inRange("2026-10-18", "2026-10-01", "2026-10-31")).toBe(true);
    expect(inRange("2026-09-30", "2026-10-01")).toBe(false);
    expect(inRange("2026-11-01", null, "2026-10-31")).toBe(false);
    expect(inRange("2026-11-01", "", "")).toBe(true);
    expect(clampKey("2026-09-01", "2026-10-01", "2026-10-31")).toBe(
      "2026-10-01",
    );
  });

  it("labels field values shortly", () => {
    expect(formatFieldDate("2026-10-18", "2026-01-05")).toBe("Sun, Oct 18");
    expect(formatFieldDate("2027-02-03", "2026-10-18")).toBe("Feb 3, 2027");
    expect(localTodayKey(new Date(2026, 9, 18, 23, 59))).toBe("2026-10-18");
  });
});

describe("time math", () => {
  it("parses and formats HH:MM", () => {
    expect(parseHm("09:05")).toEqual({ h: 9, m: 5 });
    expect(parseHm("23:59:00")).toEqual({ h: 23, m: 59 });
    expect(parseHm("24:00")).toBeNull();
    expect(parseHm("")).toBeNull();
    expect(formatHm({ h: 7, m: 0 })).toBe("07:00");
  });

  it("converts between 12 h and 24 h", () => {
    expect(to12(0)).toEqual({ h12: 12, pm: false });
    expect(to12(12)).toEqual({ h12: 12, pm: true });
    expect(to12(13)).toEqual({ h12: 1, pm: true });
    expect(to24(12, false)).toBe(0);
    expect(to24(12, true)).toBe(12);
    expect(to24(9, true)).toBe(21);
    expect(formatTime12("14:30")).toBe("2:30 PM");
    expect(formatTime12("00:05")).toBe("12:05 AM");
    expect(formatTime12("nope")).toBe("");
  });

  it("offers minutes by the input's step", () => {
    expect(minuteOptions(900)).toEqual([0, 15, 30, 45]);
    expect(minuteOptions("300")).toHaveLength(12);
    expect(minuteOptions(undefined)).toHaveLength(60);
    expect(minuteOptions(7200)).toHaveLength(60); // > 30 min falls back to 1-minute steps
    expect(nearestMinute(52, [0, 15, 30, 45])).toBe(45);
    expect(nearestMinute(8, [0, 15, 30, 45])).toBe(15);
  });
});
