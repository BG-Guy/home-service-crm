// Mock booking availability (src/features/jobs/availability/mock.ts): shape,
// determinism and the weekday/weekend pattern the calendar relies on.
import { describe, expect, it } from "vitest";
import {
  type MockInput,
  mockAvailability,
} from "@/features/jobs/availability/mock";
import {
  windowLabel,
  windowsForDay,
} from "@/features/jobs/availability/windows";

const WEEKDAYS = [1, 2, 3, 4, 5].map((day) => ({
  day,
  open: "08:00",
  close: "18:00",
}));
const base: MockInput = {
  from: "2026-10-21",
  to: "2026-12-19",
  addressKey: "12 oak st|78701",
  techs: [
    { id: "t1", name: "Ben Carter", color: "#0a84ff", avatarUrl: null },
    { id: "t2", name: "Maria Lopez", color: "#34c759", avatarUrl: null },
    { id: "t3", name: "Sam Reed", color: "#ff9500", avatarUrl: null },
  ],
  hours: WEEKDAYS,
  todayKey: "2026-10-21",
  nowMin: 9 * 60,
  withWindows: true,
};

describe("availability mock", () => {
  it("returns one entry per day from today, with valid statuses", () => {
    const days = mockAvailability(base);
    expect(days).toHaveLength(60);
    expect(days[0]?.date).toBe("2026-10-21");
    for (const d of days) {
      expect(["best", "open", "limited", "full"]).toContain(d.status);
      expect(d.openings).toBe(
        d.windows.filter((w) => w.status === "open").length,
      );
      if (d.status === "full") expect(d.openings).toBe(0);
      for (const w of d.windows) {
        expect(w.start).toMatch(/^\d{2}:\d{2}$/);
        expect(w.end > w.start).toBe(true);
        if (w.status === "full") expect(w.suggested).toBeUndefined();
        if (w.suggested) {
          expect(base.techs.map((t) => t.name)).toContain(w.suggested.name);
          expect(w.alternatives.map((a) => a.techId)).not.toContain(
            w.suggested.techId,
          );
          expect(w.suggested.reasons.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is deterministic and depends on the address", () => {
    expect(mockAvailability(base)).toEqual(mockAvailability(base));
    const other = mockAvailability({ ...base, addressKey: "9 elm rd|78702" });
    expect(other).not.toEqual(mockAvailability(base));
  });

  it("marks exactly three best days and gives one day the same status alone", () => {
    const days = mockAvailability(base);
    expect(days.filter((d) => d.status === "best")).toHaveLength(3);
    const pick = days[10] as (typeof days)[number];
    const [alone] = mockAvailability({
      ...base,
      from: pick.date,
      to: pick.date,
    });
    expect(alone).toEqual(pick);
  });

  it("keeps weekends mostly limited or full, and skips past windows today", () => {
    const days = mockAvailability(base);
    const weekend = days.filter((d) => {
      const wd = new Date(`${d.date}T12:00:00Z`).getUTCDay();
      return wd === 0 || wd === 6;
    });
    const tight = weekend.filter(
      (d) => d.status === "limited" || d.status === "full",
    );
    expect(tight.length / weekend.length).toBeGreaterThan(0.7);
    const today = days[0];
    for (const w of today?.windows ?? [])
      if (w.start <= "10:00") expect(w.status).toBe("full");
  });

  it("omits windows unless asked", () => {
    const days = mockAvailability({ ...base, withWindows: false });
    expect(days.every((d) => d.windows.length === 0)).toBe(true);
  });
});

describe("arrival windows", () => {
  it("splits business hours into 2-hour windows", () => {
    expect(windowsForDay("2026-10-21", WEEKDAYS)).toEqual([
      ["08:00", "10:00"],
      ["10:00", "12:00"],
      ["12:00", "14:00"],
      ["14:00", "16:00"],
      ["16:00", "18:00"],
    ]);
    // 8–5 keeps a trailing 1-hour window; Sunday is closed.
    const nineToFive = [{ day: 3, open: "08:00", close: "17:00" }];
    expect(windowsForDay("2026-10-21", nineToFive).at(-1)).toEqual([
      "16:00",
      "17:00",
    ]);
    expect(windowsForDay("2026-10-25", WEEKDAYS)).toEqual([]);
    expect(windowLabel("12:00", "14:00")).toBe("12–2");
  });
});
