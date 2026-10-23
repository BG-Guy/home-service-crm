import { describe, expect, it } from "vitest";
import {
  clockLabel,
  effectiveWorkHours,
  hhmmMinutes,
  hoursOn,
  isValidWorkDay,
  normalizeWorkHours,
  workHoursSummary,
} from "@/lib/work-hours";

// users.work_hours helpers (leads-flow redesign: booking availability).

const BUSINESS = [1, 2, 3, 4, 5].map((day) => ({
  day,
  open: "08:00",
  close: "17:00",
}));

describe("work hours", () => {
  it("parses HH:MM", () => {
    expect(hhmmMinutes("08:30")).toBe(510);
    expect(hhmmMinutes("24:00")).toBe(1440);
    expect(hhmmMinutes("8:30")).toBeNull();
    expect(hhmmMinutes("25:00")).toBeNull();
  });

  it("drops invalid rows and sorts", () => {
    expect(isValidWorkDay({ day: 7, start: "08:00", end: "17:00" })).toBe(
      false,
    );
    expect(isValidWorkDay({ day: 1, start: "17:00", end: "08:00" })).toBe(
      false,
    );
    expect(isValidWorkDay({ day: 6, start: "20:00", end: "24:00" })).toBe(true);
    expect(
      normalizeWorkHours([
        { day: 3, start: "09:00", end: "12:00" },
        { day: 1, start: "13:00", end: "17:00" },
        { day: 1, start: "08:00", end: "12:00" },
        { day: 2, start: "nope", end: "12:00" },
      ]),
    ).toEqual([
      { day: 1, start: "08:00", end: "12:00" },
      { day: 1, start: "13:00", end: "17:00" },
      { day: 3, start: "09:00", end: "12:00" },
    ]);
  });

  it("falls back to business hours only when the member has none", () => {
    const biz = effectiveWorkHours(null, BUSINESS);
    expect(biz).toHaveLength(5);
    expect(biz[0]).toEqual({ day: 1, start: "08:00", end: "17:00" });
    expect(effectiveWorkHours(undefined, BUSINESS)).toEqual(biz);
    // An empty list is "no regular days", not "business hours".
    expect(effectiveWorkHours([], BUSINESS)).toEqual([]);
    const own = effectiveWorkHours(
      [{ day: 6, start: "09:00", end: "13:00" }],
      BUSINESS,
    );
    expect(own).toEqual([{ day: 6, start: "09:00", end: "13:00" }]);
    expect(hoursOn(biz, 0)).toEqual([]);
    expect(hoursOn(biz, 2)).toEqual([{ day: 2, start: "08:00", end: "17:00" }]);
  });

  it("summarizes for lists", () => {
    expect(clockLabel("08:00")).toBe("8 AM");
    expect(clockLabel("17:30")).toBe("5:30 PM");
    expect(clockLabel("12:00")).toBe("12 PM");
    expect(clockLabel("24:00")).toBe("12 AM");
    expect(workHoursSummary(effectiveWorkHours(null, BUSINESS))).toBe(
      "Mon–Fri 8 AM–5 PM",
    );
    expect(
      workHoursSummary([
        ...effectiveWorkHours(null, BUSINESS),
        { day: 6, start: "09:00", end: "13:00" },
      ]),
    ).toBe("Mon–Fri 8 AM–5 PM · Sat 9 AM–1 PM");
    expect(
      workHoursSummary([
        { day: 1, start: "08:00", end: "17:00" },
        { day: 3, start: "08:00", end: "17:00" },
      ]),
    ).toBe("Mon 8 AM–5 PM · Wed 8 AM–5 PM");
    expect(workHoursSummary([])).toBe("No regular hours");
  });
});
