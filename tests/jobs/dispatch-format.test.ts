// Assign hub queue labels (pure): "Fri 23 · 8–10 AM", windows like the booking flow.
import { describe, expect, it } from "vitest";
import {
  arrivalLabel,
  dayLabel,
  windowRange,
} from "@/features/jobs/dispatch/format";
import { hubHref, hubHrefForJob } from "@/features/jobs/dispatch/href";
import { zonedTimeToUtc } from "@/lib/time";

const TZ = "America/Chicago";
const t = (day: number, hour: number, minute = 0) =>
  zonedTimeToUtc({ year: 2026, month: 10, day, hour, minute }, TZ);

describe("assign hub labels", () => {
  it("writes arrival windows the way the booking flow does", () => {
    expect(windowRange(t(23, 8), t(23, 10), TZ)).toBe("8–10 AM");
    expect(windowRange(t(23, 14), t(23, 16), TZ)).toBe("2–4 PM");
    expect(windowRange(t(23, 10), t(23, 12), TZ)).toBe("10 AM–12 PM");
    expect(windowRange(t(23, 8, 30), t(23, 10, 30), TZ)).toBe("8:30–10:30 AM");
    expect(windowRange(t(23, 11, 30), t(23, 13), TZ)).toBe("11:30 AM–1 PM");
    expect(windowRange(t(23, 9), null, TZ)).toBe("9 AM");
  });

  it("names the day: today, tomorrow, the coming week, else the date", () => {
    expect(dayLabel("2026-10-22", "2026-10-22")).toBe("Today");
    expect(dayLabel("2026-10-23", "2026-10-22")).toBe("Tomorrow");
    expect(dayLabel("2026-10-26", "2026-10-22")).toBe("Mon 26");
    expect(dayLabel("2026-10-28", "2026-10-22")).toBe("Wed 28");
    expect(dayLabel("2026-11-02", "2026-10-30")).toBe("Mon 2");
    expect(dayLabel("2026-10-29", "2026-10-22")).toBe("Thu, Oct 29");
    expect(dayLabel("2027-01-04", "2026-10-22")).toBe("Mon, Jan 4, 2027");
  });

  it("puts the day in the company zone, not UTC", () => {
    // 8 PM in Chicago on the 23rd is already the 24th in UTC.
    expect(arrivalLabel(t(23, 20), t(23, 22), TZ, "2026-10-22")).toBe(
      "Tomorrow · 8–10 PM",
    );
    expect(
      arrivalLabel(
        t(23, 8).toISOString(),
        t(23, 10).toISOString(),
        TZ,
        "2026-10-20",
      ),
    ).toBe("Fri 23 · 8–10 AM");
    expect(arrivalLabel(t(23, 10), t(23, 12), TZ, "2026-10-10")).toBe(
      "Fri, Oct 23 · 10 AM–12 PM",
    );
  });

  it("links a queued job into the hub on its own day", () => {
    expect(hubHrefForJob("j1", "2026-10-23")).toBe(
      "/dispatch?date=2026-10-23&job=j1",
    );
    expect(hubHrefForJob("j1")).toBe("/dispatch?job=j1");
    expect(hubHref({ date: "2026-10-22", job: "j1" }, "t1")).toBe(
      "/dispatch?date=2026-10-22&job=j1&tech=t1",
    );
  });
});
