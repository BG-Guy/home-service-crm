// Custom reminder recurrence (SPEC M13): next occurrence per type, DST-safe.
import { describe, expect, it } from "vitest";
import {
  describeRecurrence,
  milesDue,
  nextOccurrence,
  RecurrenceSchema,
} from "@/features/automations/recurrence";
import { zonedParts } from "@/lib/time";

const CHI = "America/Chicago";
const thuNoon = new Date("2026-10-15T17:00:00Z"); // Thu Oct 15 12:00 CDT
const local = (d: Date | null) => {
  if (!d) return null;
  const p = zonedParts(d, CHI);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

describe("nextOccurrence", () => {
  it("once", () => {
    expect(
      nextOccurrence(
        { type: "once", at: "2026-10-20T15:00:00Z" },
        thuNoon,
        CHI,
      )?.toISOString(),
    ).toBe("2026-10-20T15:00:00.000Z");
    expect(
      nextOccurrence(
        { type: "once", at: "2026-10-01T15:00:00Z" },
        thuNoon,
        CHI,
      ),
    ).toBeNull();
  });
  it("daily: later today, else tomorrow", () => {
    expect(
      local(nextOccurrence({ type: "daily", time: "15:00" }, thuNoon, CHI)),
    ).toBe("2026-10-15 15:00");
    expect(
      local(nextOccurrence({ type: "daily", time: "08:00" }, thuNoon, CHI)),
    ).toBe("2026-10-16 08:00");
  });
  it("weekly: Monday 8:00 fuel receipts", () => {
    expect(
      local(
        nextOccurrence(
          { type: "weekly", days: [1], time: "08:00" },
          thuNoon,
          CHI,
        ),
      ),
    ).toBe("2026-10-19 08:00");
    expect(
      local(
        nextOccurrence(
          { type: "weekly", days: [4], time: "13:00" },
          thuNoon,
          CHI,
        ),
      ),
    ).toBe("2026-10-15 13:00");
    expect(
      local(
        nextOccurrence(
          { type: "weekly", days: [4], time: "11:00" },
          thuNoon,
          CHI,
        ),
      ),
    ).toBe("2026-10-22 11:00");
  });
  it("monthly clamps short months", () => {
    expect(
      local(
        nextOccurrence(
          { type: "monthly", day: 31, time: "09:00" },
          thuNoon,
          CHI,
        ),
      ),
    ).toBe("2026-10-31 09:00");
    const nov1 = new Date("2026-11-01T18:00:00Z");
    expect(
      local(
        nextOccurrence({ type: "monthly", day: 31, time: "09:00" }, nov1, CHI),
      ),
    ).toBe("2026-11-30 09:00");
  });
  it("every N days from a start date", () => {
    expect(
      local(
        nextOccurrence(
          { type: "every_n_days", n: 10, time: "09:00", start: "2026-10-01" },
          thuNoon,
          CHI,
        ),
      ),
    ).toBe("2026-10-21 09:00");
  });
  it("every 12 months (yearly dryer vent)", () => {
    expect(
      local(
        nextOccurrence(
          { type: "every_n_months", n: 12, time: "10:00", start: "2025-11-20" },
          thuNoon,
          CHI,
        ),
      ),
    ).toBe("2026-11-20 10:00");
  });
  it("DST: daily 08:00 stays 08:00 local across fall-back", () => {
    const sat = new Date("2026-10-31T18:00:00Z");
    const next = nextOccurrence({ type: "daily", time: "08:00" }, sat, CHI);
    expect(local(next)).toBe("2026-11-01 08:00");
    expect(next?.toISOString()).toBe("2026-11-01T14:00:00.000Z"); // CST
  });
  it("mileage reminders are odometer-driven", () => {
    const r = {
      type: "every_n_miles" as const,
      miles: 5000,
      vehicle_id: "00000000-0000-4000-8000-000000000001",
      base_odometer: 40_000,
    };
    expect(nextOccurrence(r, thuNoon, CHI)).toBeNull();
    expect(milesDue(r, 44_999)).toBe(false);
    expect(milesDue(r, 45_000)).toBe(true);
    expect(milesDue({ ...r, base_odometer: null }, 99_999)).toBe(false);
  });
  it("schema + labels", () => {
    expect(
      RecurrenceSchema.safeParse({ type: "weekly", days: [], time: "08:00" })
        .success,
    ).toBe(false);
    expect(
      describeRecurrence({ type: "weekly", days: [1, 3], time: "08:00" }),
    ).toBe("Every Mon, Wed at 8 AM");
    expect(
      describeRecurrence({
        type: "every_n_months",
        n: 12,
        time: "10:30",
        start: "2026-01-01",
      }),
    ).toBe("Every year at 10:30 AM");
  });
});
