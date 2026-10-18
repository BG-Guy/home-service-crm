// Golden: rules-first vehicle anomaly flags, reminder forecast, MPG, mileage (SPEC M17).
import { describe, expect, it } from "vitest";
import {
  computeMpg,
  detectAnomalies,
  documentWarningDay,
  documentWarningDue,
  forecastReminder,
  mileageReimbursementCents,
  taskFromInput,
  taskLabel,
  taskMatchKey,
  trailingAvgDailyMiles,
} from "@/features/vehicles/rules";

const TZ = "America/Chicago";
// Wednesday 2026-10-14 10:00 CDT
const WED = new Date("2026-10-14T15:00:00Z");
const DAY = 86_400_000;

const fuel = (
  over: Partial<
    NonNullable<Parameters<typeof detectAnomalies>[0]["fuel"]>
  > = {},
) => ({
  gallons: 18,
  tankGal: 25,
  prevFillOdometer: null,
  avgMpg: null,
  sameDayFills: 0,
  weekendCheck: true,
  mpgDropPct: 20,
  tz: TZ,
  ...over,
});

describe("odometer anomalies", () => {
  const prev = { value: 48_000, at: new Date(WED.getTime() - DAY) };
  it("backwards", () => {
    expect(
      detectAnomalies({ value: 47_900, at: WED, prev, maxDailyMiles: 600 }),
    ).toEqual(["odometer_backwards"]);
  });
  it("jump over max daily miles", () => {
    expect(
      detectAnomalies({ value: 48_700, at: WED, prev, maxDailyMiles: 600 }),
    ).toEqual(["odometer_jump"]);
    expect(
      detectAnomalies({ value: 48_550, at: WED, prev, maxDailyMiles: 600 }),
    ).toEqual([]);
  });
  it("jump uses at least one day (same-day readings)", () => {
    const p = { value: 48_000, at: new Date(WED.getTime() - 3600_000) };
    expect(
      detectAnomalies({ value: 48_500, at: WED, prev: p, maxDailyMiles: 600 }),
    ).toEqual([]);
  });
  it("multi-day gaps scale the allowance", () => {
    const p = { value: 48_000, at: new Date(WED.getTime() - 5 * DAY) };
    expect(
      detectAnomalies({ value: 50_500, at: WED, prev: p, maxDailyMiles: 600 }),
    ).toEqual([]);
  });
  it("no previous reading → no flags", () => {
    expect(detectAnomalies({ value: 10, at: WED, maxDailyMiles: 600 })).toEqual(
      [],
    );
  });
});

describe("fuel anomalies", () => {
  const prev = { value: 48_000, at: new Date(WED.getTime() - 2 * DAY) };
  it("gallons > tank", () => {
    expect(
      detectAnomalies({
        value: 48_200,
        at: WED,
        prev,
        maxDailyMiles: 600,
        fuel: fuel({ gallons: 27.5 }),
      }),
    ).toEqual(["gallons_over_tank"]);
  });
  it("two fuel buys the same day", () => {
    expect(
      detectAnomalies({
        value: 48_200,
        at: WED,
        prev,
        maxDailyMiles: 600,
        fuel: fuel({ sameDayFills: 1 }),
      }),
    ).toEqual(["duplicate_fuel_day"]);
  });
  it("fuel while odometer unchanged", () => {
    expect(
      detectAnomalies({
        value: 48_000,
        at: WED,
        prev,
        maxDailyMiles: 600,
        fuel: fuel(),
      }),
    ).toEqual(["odometer_unchanged"]);
  });
  it("weekend fuel (configurable)", () => {
    const sat = new Date("2026-10-17T15:00:00Z");
    const p = { value: 48_000, at: new Date(sat.getTime() - DAY) };
    expect(
      detectAnomalies({
        value: 48_100,
        at: sat,
        prev: p,
        maxDailyMiles: 600,
        fuel: fuel(),
      }),
    ).toEqual(["weekend_fuel"]);
    expect(
      detectAnomalies({
        value: 48_100,
        at: sat,
        prev: p,
        maxDailyMiles: 600,
        fuel: fuel({ weekendCheck: false }),
      }),
    ).toEqual([]);
  });
  it("weekend is judged in the company time zone", () => {
    // Saturday 03:00 UTC = Friday 22:00 in Chicago
    const friNight = new Date("2026-10-17T03:00:00Z");
    expect(
      detectAnomalies({
        value: 48_100,
        at: friNight,
        prev: { value: 48_000, at: new Date(friNight.getTime() - DAY) },
        maxDailyMiles: 600,
        fuel: fuel(),
      }),
    ).toEqual([]);
  });
  it("MPG drop > 20 %", () => {
    // 300 mi / 20 gal = 15 mpg vs avg 20 → 25 % drop
    expect(
      detectAnomalies({
        value: 48_300,
        at: WED,
        prev,
        maxDailyMiles: 600,
        fuel: fuel({ gallons: 20, prevFillOdometer: 48_000, avgMpg: 20 }),
      }),
    ).toEqual(["mpg_drop"]);
    // 340 / 20 = 17 mpg → 15 % drop: fine
    expect(
      detectAnomalies({
        value: 48_340,
        at: WED,
        prev,
        maxDailyMiles: 600,
        fuel: fuel({ gallons: 20, prevFillOdometer: 48_000, avgMpg: 20 }),
      }),
    ).toEqual([]);
  });
});

describe("MPG and mileage", () => {
  it("computeMpg", () => {
    expect(computeMpg(48_300, 48_000, 20)).toBe(15);
    expect(computeMpg(48_000, 48_000, 20)).toBeNull();
    expect(computeMpg(null, 48_000, 20)).toBeNull();
  });
  it("IRS rate 72.5¢ (millicents), half away", () => {
    expect(mileageReimbursementCents(41.3, 72_500)).toBe(2994); // 2994.25
    expect(mileageReimbursementCents(10, 72_500)).toBe(725);
    expect(mileageReimbursementCents(0.1, 72_500)).toBe(7); // 7.25
    expect(mileageReimbursementCents(1.3, 72_500)).toBe(94); // 94.25
    expect(mileageReimbursementCents(0.2, 72_500)).toBe(15); // 14.5 → 15
  });
});

describe("reminder forecast", () => {
  const oil = {
    task: "oil_change",
    intervalMiles: 5000,
    intervalDays: 182,
    dueSoonMiles: 500,
    dueSoonDays: 14,
    lastDoneOn: "2026-09-01",
    lastDoneOdometer: 45_000,
  };
  it("ok with miles forecast from avg daily miles", () => {
    const r = forecastReminder(oil, {
      odometer: 46_000,
      avgDailyMiles: 50,
      today: "2026-10-14",
    });
    // 4000 mi left / 50 = 80 days → 2027-01-02; time due 2027-03-02
    expect(r).toEqual({
      nextDueOn: "2027-01-02",
      nextDueMiles: 50_000,
      status: "ok",
    });
  });
  it("due soon by miles", () => {
    expect(
      forecastReminder(oil, {
        odometer: 49_600,
        avgDailyMiles: 10,
        today: "2026-10-14",
      }).status,
    ).toBe("due_soon");
  });
  it("due soon when the miles forecast lands inside the days window", () => {
    expect(
      forecastReminder(oil, {
        odometer: 49_000,
        avgDailyMiles: 100,
        today: "2026-10-14",
      }).status,
    ).toBe("due_soon");
  });
  it("overdue by miles", () => {
    expect(
      forecastReminder(oil, {
        odometer: 50_010,
        avgDailyMiles: 50,
        today: "2026-10-14",
      }).status,
    ).toBe("overdue");
  });
  it("overdue by time even when miles are fine", () => {
    expect(
      forecastReminder(
        { ...oil, lastDoneOn: "2026-03-01" },
        { odometer: 46_000, avgDailyMiles: 50, today: "2026-10-14" },
      ),
    ).toMatchObject({ status: "overdue", nextDueOn: "2026-08-30" });
  });
  it("document task follows expiry", () => {
    const ins = {
      task: "insurance",
      intervalMiles: null,
      intervalDays: null,
      dueSoonMiles: null,
      dueSoonDays: 30,
      lastDoneOn: null,
      lastDoneOdometer: null,
    };
    expect(
      forecastReminder(ins, {
        odometer: null,
        avgDailyMiles: null,
        today: "2026-10-14",
        documentExpiresOn: "2026-10-24",
      }),
    ).toEqual({
      nextDueOn: "2026-10-24",
      nextDueMiles: null,
      status: "due_soon",
    });
    expect(
      forecastReminder(ins, {
        odometer: null,
        avgDailyMiles: null,
        today: "2026-10-14",
        documentExpiresOn: "2026-10-01",
      }).status,
    ).toBe("overdue");
  });
  it("document warning days 30/14/3", () => {
    expect(documentWarningDay("2026-11-13", "2026-10-14")).toBe(30);
    expect(documentWarningDay("2026-10-17", "2026-10-14")).toBe(3);
    expect(documentWarningDay("2026-10-20", "2026-10-14")).toBeNull();
  });
});

describe("document expiry windows (QA T6-08)", () => {
  const T = [30, 14, 3];
  it("warns on the threshold day", () => {
    expect(documentWarningDue("2026-11-13", "2026-10-14", T)).toEqual({
      threshold: 30,
      daysLeft: 30,
    });
  });
  it("catches up after a missed day (29 left, never alerted)", () => {
    expect(documentWarningDue("2026-11-12", "2026-10-14", T)).toEqual({
      threshold: 30,
      daysLeft: 29,
    });
  });
  it("a document added inside a window warns right away", () => {
    // 10 days left → inside the 14-day window
    expect(documentWarningDue("2026-10-24", "2026-10-14", T)).toEqual({
      threshold: 14,
      daysLeft: 10,
    });
  });
  it("never repeats inside the same window", () => {
    expect(documentWarningDue("2026-11-12", "2026-10-14", T, 30)).toBeNull();
    expect(documentWarningDue("2026-10-20", "2026-10-14", T, 14)).toBeNull();
  });
  it("warns again when it enters a tighter window", () => {
    expect(documentWarningDue("2026-10-27", "2026-10-14", T, 30)).toEqual({
      threshold: 14,
      daysLeft: 13,
    });
    expect(documentWarningDue("2026-10-14", "2026-10-14", T, 14)).toEqual({
      threshold: 3,
      daysLeft: 0,
    });
  });
  it("skipping straight past a window alerts only the tightest one", () => {
    // Last alert at 30, now 2 days left: one warning for the 3-day window.
    expect(documentWarningDue("2026-10-16", "2026-10-14", T, 30)).toEqual({
      threshold: 3,
      daysLeft: 2,
    });
  });
  it("outside every window, or already expired → nothing", () => {
    expect(documentWarningDue("2026-12-31", "2026-10-14", T)).toBeNull();
    expect(documentWarningDue("2026-10-10", "2026-10-14", T)).toBeNull();
  });
  it("unsorted and duplicate thresholds behave the same", () => {
    expect(
      documentWarningDue("2026-10-24", "2026-10-14", [3, 30, 14, 14]),
    ).toEqual({ threshold: 14, daysLeft: 10 });
  });
});

describe("trailing average daily miles", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  it("uses the reading before the window as baseline", () => {
    const readings = [
      { value: 40_000, at: new Date(now.getTime() - 40 * DAY) },
      { value: 41_000, at: new Date(now.getTime() - 30.5 * DAY) },
      { value: 42_000, at: new Date(now.getTime() - 10 * DAY) },
      { value: 42_525, at: new Date(now.getTime() - 0.5 * DAY) },
    ];
    // baseline 41 000 at −30.5 d → 1525 mi / 30 d
    expect(trailingAvgDailyMiles(readings, now)).toBe(50.83);
  });
  it("null with one reading", () => {
    expect(trailingAvgDailyMiles([{ value: 1, at: now }], now)).toBeNull();
  });
});

describe("custom task names keep their casing (QA T3-23)", () => {
  it("known names map to task keys", () => {
    expect(taskFromInput("Oil change")).toBe("oil_change");
    expect(taskFromInput(" oil   CHANGE ")).toBe("oil_change");
    expect(taskFromInput("State inspection")).toBe("inspection");
    expect(taskFromInput("tire_rotation")).toBe("tire_rotation");
  });
  it("custom names are stored as typed and labelled as typed", () => {
    expect(taskFromInput("DPF  filter")).toBe("custom:DPF filter");
    expect(taskLabel("custom:DPF filter")).toBe("DPF filter");
    expect(taskLabel("custom:def fluid")).toBe("Def fluid");
  });
  it("matching ignores case, spacing and the custom: prefix", () => {
    expect(taskMatchKey("custom:DPF filter")).toBe("dpf_filter");
    expect(taskMatchKey("dpf_filter")).toBe("dpf_filter");
    expect(taskMatchKey("custom:dpf_filter")).toBe("dpf_filter");
  });
});
