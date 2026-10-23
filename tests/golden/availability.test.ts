// ★ Golden tests: booking availability (src/features/jobs/availability/engine.ts,
// leads-flow item 8). A 2-hour arrival window is open when at least one tech fits:
// works then (their hours, minus time off), has the skill, is under the daily cap,
// and the job's length plus the drive from the previous stop starts inside the
// window without bumping another job (the Assign hub's route math), within the
// far-job limit. Day status: open 2+ windows, limited 1, full 0; best = the top 3
// open days near the requested day (else the soonest), then the least driving.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeAvailability,
  type EngineBooking,
  type EngineInput,
  type EngineSettings,
  type EngineTech,
  type EngineTimeOff,
  rankHorizonEnd,
} from "@/features/jobs/availability/engine";
import type {
  DayAvailability,
  WindowSlot,
} from "@/features/jobs/availability/types";
import {
  afterHoursGrid,
  gridWindows,
  isAfterHoursWindow,
  windowLabel,
  windowsForDay,
} from "@/features/jobs/availability/windows";
import {
  milesBetween,
  type RecTech,
  recommendTechs,
} from "@/features/jobs/dispatch/recommend";

// Wednesday Oct 21, 2026 is "today".
const TODAY = "2026-10-21";
const THU = "2026-10-22";
const FRI = "2026-10-23";
const SAT = "2026-10-24";
const SUN = "2026-10-25";
const MON = "2026-10-26";
/** The default test day: after the 3 soonest open days (Wed–Fri, "best"), so an open day reads "open". */
const D = MON;

// Austin-ish points, ~0.69 mi per 0.01° of latitude.
const P = {
  home: { lat: 30.26, lng: -97.74 },
  a: { lat: 30.28, lng: -97.74 },
  job: { lat: 30.3, lng: -97.74 },
  /** ~14.5 mi north of the job (29 min at 30 mph). */
  north15: { lat: 30.51, lng: -97.74 },
  /** ~20 mi north of the job (40 min). */
  north20: { lat: 30.5894, lng: -97.74 },
  /** ~37 mi north of home. */
  farAway: { lat: 30.8, lng: -97.74 },
};
const h = (hh: number, mm = 0) => hh * 60 + mm;
const WEEKDAYS = [1, 2, 3, 4, 5];
const hours = (start = "08:00", end = "17:00", days = WEEKDAYS) =>
  days.map((day) => ({ day, start, end }));

const SETTINGS: EngineSettings = {
  dailyCap: 6,
  maxExtraMiles: 25,
  afterHoursBooking: false,
  serviceZips: [],
  businessHours: WEEKDAYS.map((day) => ({
    day,
    open: "08:00",
    close: "17:00",
  })),
  weekendsAfterHours: true,
  boardStartHour: 7,
  boardEndHour: 20,
};

const tech = (id: string, over: Partial<EngineTech> = {}): EngineTech => ({
  id,
  name: `Tech ${id}`,
  color: "#0a84ff",
  avatarUrl: null,
  hours: hours(),
  skills: [],
  start: P.home,
  clockedIn: true,
  ...over,
});

const booking = (
  id: string,
  date: string,
  start: number,
  end: number | null,
  over: Partial<EngineBooking> = {},
): EngineBooking => ({
  id,
  date,
  start,
  end,
  minutes: 60,
  lat: P.job.lat,
  lng: P.job.lng,
  serviceTypeId: null,
  techIds: ["t1"],
  ...over,
});

const off = (techId: string, date: string, start: number, end: number) =>
  ({ techId, date, start, end }) satisfies EngineTimeOff;

const input = (over: Partial<EngineInput> = {}): EngineInput => ({
  from: D,
  to: D,
  todayKey: TODAY,
  nowMin: h(7),
  withWindows: true,
  job: {
    lat: P.job.lat,
    lng: P.job.lng,
    zip: "78701",
    durationMin: 90,
    serviceTypeId: null,
  },
  techs: [tech("t1")],
  bookings: [],
  timeOff: [],
  settings: SETTINGS,
  ...over,
});

const run = (over: Partial<EngineInput> = {}) =>
  computeAvailability(input(over));
const day = (over: Partial<EngineInput> = {}): DayAvailability => {
  const [d] = run(over);
  if (!d) throw new Error("no day returned");
  return d;
};
const win = (d: DayAvailability, start: string): WindowSlot => {
  const w = d.windows.find((x) => x.start === start);
  if (!w) throw new Error(`no ${start} window on ${d.date}`);
  return w;
};
const spans = (d: DayAvailability) =>
  d.windows.map((w) => `${w.start}-${w.end}`);
const openStarts = (d: DayAvailability) =>
  d.windows.filter((w) => w.status === "open").map((w) => w.start);
const who = (w: WindowSlot) =>
  [w.suggested, ...w.alternatives].filter(Boolean).map((t) => t?.techId);

describe("arrival windows (the grid)", () => {
  it("splits working hours into 2-hour arrival windows, keeping a trailing hour", () => {
    const d = day();
    expect(spans(d)).toEqual([
      "08:00-10:00",
      "10:00-12:00",
      "12:00-14:00",
      "14:00-16:00",
      "16:00-17:00",
    ]);
    // A 90-minute job can't start 4–5 and finish by 5 PM.
    expect(openStarts(d)).toEqual(["08:00", "10:00", "12:00", "14:00"]);
    expect(win(d, "16:00")).toMatchObject({ status: "full", reason: "full" });
    expect(d).toMatchObject({ status: "open", openings: 4 });
    expect(d.reason).toBeUndefined();
    // A 45-minute estimate can.
    const short = day({ job: { ...input().job, durationMin: 45 } });
    expect(short.openings).toBe(5);
  });

  it("follows the team's hours: a tech working 10–7 opens the evening for them only", () => {
    const late = tech("late", { hours: hours("10:00", "19:00") });
    const d = day({
      techs: [tech("t1"), late],
      job: { ...input().job, durationMin: 45 },
    });
    expect(spans(d)).toEqual([
      "08:00-10:00",
      "10:00-12:00",
      "12:00-14:00",
      "14:00-16:00",
      "16:00-18:00",
      "18:00-19:00",
    ]);
    expect(who(win(d, "08:00"))).toEqual(["t1"]);
    expect(who(win(d, "18:00"))).toEqual(["late"]);
    // Evenings by company rules are after-hours (the after-hours price applies).
    expect(win(d, "18:00").afterHours).toBe(true);
    expect(win(d, "10:00").afterHours).toBeUndefined();
  });

  it("has open windows with a suggested tech and reasons, full ones without", () => {
    const d = day({ techs: [tech("t1"), tech("t2")] });
    for (const w of d.windows) {
      if (w.status === "full") {
        expect(w.suggested).toBeUndefined();
        expect(w.alternatives).toEqual([]);
        expect(w.reason).toBeDefined();
      } else {
        expect(w.suggested).toBeDefined();
        expect(w.reason).toBeUndefined();
        expect(w.alternatives.map((a) => a.techId)).not.toContain(
          w.suggested?.techId,
        );
      }
    }
    const first = win(d, "08:00");
    expect(first.suggested?.reasons).toEqual([
      `Adds ${Math.round(milesBetween(P.home, P.job) * 10) / 10} mi`,
      "Free at 8 AM",
      "Nothing booked yet",
    ]);
  });

  it("keeps the grid helpers' shapes", () => {
    const tenHours = [1, 2, 3, 4, 5].map((day) => ({
      day,
      open: "08:00",
      close: "18:00",
    }));
    expect(windowsForDay(THU, tenHours)).toHaveLength(5);
    expect(windowsForDay(SUN, tenHours)).toEqual([]);
    expect(windowLabel("12:00", "14:00")).toBe("12–2");
    expect(
      gridWindows([
        [h(8), h(12)],
        [h(10), h(17)],
      ]),
    ).toEqual([
      [h(8), h(10)],
      [h(10), h(12)],
      [h(12), h(14)],
      [h(14), h(16)],
      [h(16), h(17)],
    ]);
    // After-hours around an 8–5 day inside a 7 AM–8 PM board: 7–8, 5–7, 7–8.
    expect(
      afterHoursGrid(gridWindows([[h(8), h(17)]]), h(7), h(20), h(8)),
    ).toEqual([
      [h(7), h(8)],
      [h(17), h(19)],
      [h(19), h(20)],
    ]);
    // Nobody works: a grid through the usual opening time.
    expect(afterHoursGrid([], h(7), h(20), h(8)).map(([s]) => s / 60)).toEqual([
      7, 8, 10, 12, 14, 16, 18,
    ]);
    expect(
      isAfterHoursWindow(4, h(8), h(10), SETTINGS.businessHours, true),
    ).toBe(false);
    expect(
      isAfterHoursWindow(4, h(16), h(18), SETTINGS.businessHours, true),
    ).toBe(true);
    expect(isAfterHoursWindow(6, h(9), h(11), [], false)).toBe(true);
  });
});

describe("day status", () => {
  const fill = (starts: number[]) =>
    starts.map((s) => booking(`b${s}`, D, h(s), h(s + 2)));

  it("is open with 2+ windows, limited with 1, full with none", () => {
    expect(day({ bookings: fill([8, 10]) })).toMatchObject({
      status: "open",
      openings: 2,
    });
    expect(day({ bookings: fill([8, 10, 12]) })).toMatchObject({
      status: "limited",
      openings: 1,
    });
    const full = day({ bookings: fill([8, 10, 12, 14]) });
    expect(full).toMatchObject({ status: "full", openings: 0, reason: "full" });
  });

  it("omits windows unless asked, keeping the status", () => {
    const [d] = run({ withWindows: false, bookings: fill([8, 10, 12]) });
    expect(d).toMatchObject({ status: "limited", openings: 1, windows: [] });
  });
});

describe("rule: daily cap (one cap for everyone)", () => {
  it("closes a tech's day at the cap even when the route has room", () => {
    const two = [booking("b1", D, h(8), h(10)), booking("b2", D, h(10), h(12))];
    const capped = day({
      bookings: two,
      settings: { ...SETTINGS, dailyCap: 2 },
    });
    expect(capped).toMatchObject({ status: "full", reason: "full" });
    const under = day({
      bookings: two.slice(0, 1),
      settings: { ...SETTINGS, dailyCap: 2 },
    });
    expect(openStarts(under)).toEqual(["10:00", "12:00", "14:00"]);
  });

  it("counts every job that day against the default cap of 6", () => {
    const slots = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        booking(`s${i}`, D, h(8) + i * 30, h(8) + i * 30 + 30, {
          minutes: 30,
        }),
      );
    expect(openStarts(day({ bookings: slots(5) }))).toContain("12:00");
    expect(day({ bookings: slots(6) })).toMatchObject({ openings: 0 });
  });
});

describe("rule: time off", () => {
  it("closes the day when the only tech is off", () => {
    const d = day({ timeOff: [off("t1", D, 0, 1440)] });
    expect(d).toMatchObject({ status: "full", openings: 0, reason: "closed" });
    expect(d.windows.every((w) => w.reason === "closed")).toBe(true);
  });

  it("works around time off inside the day", () => {
    const d = day({ timeOff: [off("t1", D, h(9, 30), h(12, 30))] });
    expect(win(d, "08:00").status).toBe("open"); // 8:00–9:30 fits before it
    // Off for the whole window: nobody works then.
    expect(win(d, "10:00")).toMatchObject({ status: "full", reason: "closed" });
    expect(win(d, "12:00").suggested?.reasons).toContain("Free at 12:30 PM");
  });

  it("leaves the window to whoever is working", () => {
    const d = day({
      techs: [tech("t1"), tech("t2")],
      timeOff: [off("t1", D, 0, 1440)],
    });
    expect(d.openings).toBe(4);
    expect(new Set(d.windows.flatMap(who))).toEqual(new Set(["t2"]));
  });
});

describe("rule: skills", () => {
  const techs = [
    tech("a", { skills: ["rekey"] }),
    tech("b", { skills: ["garage"] }),
    tech("c", { skills: [] }),
  ];
  const job = (serviceTypeId: string | null) => ({
    ...input().job,
    serviceTypeId,
  });

  it("offers the job only to techs listed for it (an empty list takes anything)", () => {
    const d = day({ techs, job: job("rekey") });
    expect(new Set(who(win(d, "08:00")))).toEqual(new Set(["a", "c"]));
  });

  it("closes the window when the only listed tech is busy", () => {
    const d = day({
      techs: [
        tech("a", { skills: ["rekey"] }),
        tech("b", { skills: ["garage"] }),
      ],
      job: job("rekey"),
      bookings: [booking("x", D, h(8), h(10), { techIds: ["a"] })],
    });
    expect(win(d, "08:00")).toMatchObject({ status: "full", reason: "full" });
    expect(who(win(d, "10:00"))).toEqual(["a"]);
  });

  it("doesn't block when nobody is listed for the job, or nobody lists skills", () => {
    expect(
      new Set(who(win(day({ techs, job: job("safe") }), "08:00"))),
    ).toEqual(new Set(["a", "b", "c"]));
    const plain = [tech("x"), tech("y")];
    expect(
      who(win(day({ techs: plain, job: job("rekey") }), "08:00")),
    ).toHaveLength(2);
  });
});

describe("rule: no overlap with booked jobs", () => {
  it("never doubles a tech up in a booked window", () => {
    const d = day({ bookings: [booking("b", D, h(10), h(12))] });
    expect(win(d, "10:00")).toMatchObject({ status: "full", reason: "full" });
    expect(win(d, "12:00").status).toBe("open");
  });

  it("counts a long job's length past its window", () => {
    // A half-day project arriving 8–10 keeps the tech until ~12:00.
    const d = day({
      bookings: [
        booking("p", D, h(8), h(10), {
          minutes: 240,
          lat: P.a.lat,
          lng: P.a.lng,
        }),
      ],
    });
    expect(win(d, "10:00")).toMatchObject({ status: "full", reason: "full" });
    expect(win(d, "12:00").suggested?.reasons).toContain("Free at 12:05 PM");
  });

  it("won't push the next job past its own window", () => {
    const next = booking("n", D, h(10), h(10, 30), {
      lat: P.north20.lat,
      lng: P.north20.lng,
    });
    // 2 h on site from 8:00, then 40 min of driving: 10:40 > 10:30.
    const long = day({
      bookings: [next],
      job: { ...input().job, durationMin: 120 },
    });
    expect(win(long, "08:00")).toMatchObject({
      status: "full",
      reason: "full",
    });
    // 1 h on site: there by 9:40, waits for 10:00.
    const short = day({
      bookings: [next],
      job: { ...input().job, durationMin: 60 },
    });
    expect(win(short, "08:00").status).toBe("open");
  });
});

describe("rule: the drive from the previous stop", () => {
  const prev = (minutes: number) =>
    booking("prev", D, h(8), h(10), {
      minutes,
      lat: P.north15.lat,
      lng: P.north15.lng,
    });

  it("starts after the previous job plus the drive, inside the window", () => {
    // Done 9:50, 29 min of driving → arrives 10:19 (shown rounded up: 10:20).
    const d = day({ bookings: [prev(110)] });
    expect(win(d, "10:00").suggested?.reasons).toContain("Free at 10:20 AM");
    // Done 11:50 + 29 min → 12:19: too late for 10–12, fine for 12–2.
    const late = day({ bookings: [prev(230)] });
    expect(win(late, "10:00")).toMatchObject({
      status: "full",
      reason: "full",
    });
    expect(win(late, "12:00").suggested?.reasons).toContain("Free at 12:20 PM");
  });

  it("suggests the tech whose route passes the job", () => {
    const d = day({
      techs: [
        tech("detour", { start: P.farAway }),
        tech("onway", { start: P.home }),
      ],
      bookings: [
        booking("x", D, h(8), h(9), {
          techIds: ["onway"],
          lat: P.a.lat,
          lng: P.a.lng,
        }),
      ],
    });
    const w = win(d, "10:00");
    expect(w.suggested?.techId).toBe("onway");
    expect(w.suggested?.reasons[0]).toMatch(/^Adds \d+(\.\d)? mi$/);
    expect(w.suggested?.reasons).toContain("1 job that day");
  });
});

describe("rule: far jobs are hidden", () => {
  const farJob = { ...input().job, lat: P.farAway.lat, lng: P.farAway.lng };

  it("hides every window when the job is far for every tech (counts as full)", () => {
    const d = day({ job: farJob, techs: [tech("t1"), tech("t2")] });
    expect(d).toMatchObject({ status: "full", openings: 0, reason: "far" });
    // 4–5 PM is full anyway (90 minutes don't fit before 5).
    expect(d.windows.map((w) => [w.status, w.reason])).toEqual([
      ["full", "far"],
      ["full", "far"],
      ["full", "far"],
      ["full", "far"],
      ["full", "full"],
    ]);
  });

  it("keeps the window when one tech is near, and only offers that tech", () => {
    const d = day({
      job: farJob,
      techs: [
        tech("t1"),
        tech("north", { start: { lat: 30.75, lng: -97.74 } }),
      ],
    });
    expect(d.openings).toBe(4);
    expect(who(win(d, "08:00"))).toEqual(["north"]);
  });

  it("uses the limit inclusively", () => {
    const miles = Math.round(milesBetween(P.home, P.farAway) * 10) / 10;
    const d = day({
      job: farJob,
      settings: { ...SETTINGS, maxExtraMiles: Math.ceil(miles) },
    });
    expect(d.openings).toBe(4);
  });
});

describe("rule: service area", () => {
  const zips = { ...SETTINGS, serviceZips: ["78701", "78702"] };

  it("gives a ZIP outside the service ZIPs no windows on any day", () => {
    const days = run({
      from: THU,
      to: MON,
      settings: zips,
      job: { ...input().job, zip: "78750" },
    });
    expect(days).toHaveLength(5);
    for (const d of days)
      expect(d).toEqual({
        date: d.date,
        status: "full",
        openings: 0,
        windows: [],
        reason: "outside_area",
      });
  });

  it("books inside the area (ZIP+4 too), and anywhere when no ZIPs are set or the ZIP is unknown", () => {
    const at = (zip: string | null, settings: EngineSettings = zips) =>
      day({ settings, job: { ...input().job, zip } }).openings;
    expect(at("78701-0042")).toBe(4);
    expect(at(null)).toBe(4);
    expect(at("78750", SETTINGS)).toBe(4);
  });
});

describe("rule: weekends and evenings closed unless someone works them", () => {
  it("closes Saturday and Sunday when nobody works them", () => {
    const days = run({ from: FRI, to: MON });
    expect(days.map((d) => [d.date, d.status, d.reason ?? null])).toEqual([
      [FRI, "best", null],
      [SAT, "full", "closed"],
      [SUN, "full", "closed"],
      [MON, "open", null],
    ]);
    expect(days[1]?.windows).toEqual([]);
  });

  it("opens Saturday for a tech set to work it, at the after-hours price", () => {
    const sat = tech("sat", {
      hours: [...hours(), { day: 6, start: "09:00", end: "13:00" }],
    });
    const d = day({ from: SAT, to: SAT, techs: [tech("t1"), sat] });
    expect(spans(d)).toEqual(["09:00-11:00", "11:00-13:00"]);
    expect(d).toMatchObject({ status: "open", openings: 2 });
    expect(new Set(d.windows.flatMap(who))).toEqual(new Set(["sat"]));
    expect(d.windows.every((w) => w.afterHours)).toBe(true);
    // A company whose Saturdays are regular business hours.
    const regular = day({
      from: SAT,
      to: SAT,
      techs: [sat],
      settings: {
        ...SETTINGS,
        weekendsAfterHours: false,
        businessHours: [
          ...SETTINGS.businessHours,
          { day: 6, open: "09:00", close: "13:00" },
        ],
      },
    });
    expect(regular.windows.every((w) => w.afterHours === undefined)).toBe(true);
  });

  it("offers no evening window after 5 PM by default", () => {
    expect(spans(day()).at(-1)).toBe("16:00-17:00");
  });
});

describe("rule: after-hours booking", () => {
  const on = { ...SETTINGS, afterHoursBooking: true };

  it("is off by default and adds on-call windows around the day when on", () => {
    const d = day({ settings: on });
    expect(spans(d)).toEqual([
      "07:00-08:00",
      "08:00-10:00",
      "10:00-12:00",
      "12:00-14:00",
      "14:00-16:00",
      "16:00-17:00",
      "17:00-19:00",
      "19:00-20:00",
    ]);
    expect(win(d, "17:00")).toMatchObject({ status: "open", afterHours: true });
    expect(win(d, "07:00").afterHours).toBe(true);
    // 90 minutes from 7 PM would end past the board's 8 PM.
    expect(win(d, "19:00")).toMatchObject({ status: "full", reason: "full" });
    expect(win(d, "16:00").status).toBe("full"); // still inside working hours
  });

  it("opens weekends on call, unless the tech is off", () => {
    const sun = day({ from: SUN, to: SUN, settings: on });
    expect(spans(sun)[0]).toBe("07:00-08:00");
    expect(sun.status).toBe("open");
    expect(sun.windows.every((w) => w.afterHours)).toBe(true);
    const away = day({
      from: SUN,
      to: SUN,
      settings: on,
      timeOff: [off("t1", SUN, 0, 1440)],
    });
    expect(away).toMatchObject({ status: "full", reason: "closed" });
  });
});

describe("today", () => {
  it("closes windows that already started and leaves a little lead time", () => {
    const at9 = day({ from: TODAY, to: TODAY, nowMin: h(9) });
    expect(win(at9, "08:00")).toMatchObject({
      status: "full",
      reason: "closed",
    });
    expect(win(at9, "10:00").suggested?.reasons).toContain("Free at 10 AM");
    const late = day({ from: TODAY, to: TODAY, nowMin: h(11, 40) });
    expect(win(late, "10:00").status).toBe("full");
    expect(win(late, "12:00").suggested?.reasons).toContain("Free at 12:10 PM");
    const evening = day({ from: TODAY, to: TODAY, nowMin: h(18) });
    expect(evening).toMatchObject({ status: "full", reason: "closed" });
  });

  it("skips days before today", () => {
    const days = run({ from: "2026-10-19", to: THU });
    expect(days.map((d) => d.date)).toEqual([TODAY, THU]);
  });
});

describe("booked jobs that still need a tech take room", () => {
  const pending = booking("p", D, h(8), h(10), { techIds: [] });

  it("fills the window when nobody else can take it", () => {
    const d = day({ bookings: [pending] });
    expect(win(d, "08:00")).toMatchObject({ status: "full", reason: "full" });
  });

  it("leaves it to the other tech (the first-ranked one gets the booked job)", () => {
    const d = day({ bookings: [pending], techs: [tech("t1"), tech("t2")] });
    expect(who(win(d, "08:00"))).toEqual(["t2"]);
    expect(who(win(d, "10:00")).sort()).toEqual(["t1", "t2"]);
  });
});

describe("best days", () => {
  const range = { from: TODAY, to: "2026-11-03" };
  const bestOf = (days: DayAvailability[]) =>
    days.filter((d) => d.status === "best").map((d) => d.date);

  it("marks the 3 soonest open days without a requested day", () => {
    expect(bestOf(run(range))).toEqual([TODAY, THU, FRI]);
  });

  it("marks the open days closest to the requested day", () => {
    expect(bestOf(run({ ...range, requestedDate: MON }))).toEqual([
      MON,
      "2026-10-27",
      "2026-10-28",
    ]);
    // Asked for a Saturday: Friday, then Thursday and Monday (2 days away each).
    expect(bestOf(run({ ...range, requestedDate: SAT }))).toEqual([
      THU,
      FRI,
      MON,
    ]);
  });

  it("breaks ties on closeness by the least extra driving, then the earlier day", () => {
    // Wednesday the 28th asked for but fully booked: Tue 27 and Thu 29 are 1 day
    // away, Mon 26 and Fri 30 are 2: the one with a stop at the job's door wins.
    const wedOff = off("t1", "2026-10-28", 0, 1440);
    const atDoor = (date: string) => booking(`door-${date}`, date, h(8), h(10));
    const pick = (date: string) =>
      bestOf(
        run({
          ...range,
          requestedDate: "2026-10-28",
          timeOff: [wedOff],
          bookings: [atDoor(date)],
        }),
      );
    expect(pick("2026-10-30")).toEqual([
      "2026-10-27",
      "2026-10-29",
      "2026-10-30",
    ]);
    expect(pick(MON)).toEqual([MON, "2026-10-27", "2026-10-29"]);
    // Equal gap and driving: the earlier day.
    const tueThuOff = ["2026-10-27", "2026-10-28", "2026-10-29"].map((d) =>
      off("t1", d, 0, 1440),
    );
    const days = run({
      ...range,
      to: "2026-11-06",
      requestedDate: "2026-10-28",
      timeOff: tueThuOff,
    });
    // Mon 26 and Fri 30 (2 away), then Fri 23 and Mon Nov 2 (5 away): Fri 23.
    expect(bestOf(days)).toEqual([FRI, MON, "2026-10-30"]);
  });

  it("never marks a limited day best", () => {
    const busy = ["2026-10-21", THU, FRI].flatMap((date) =>
      [8, 10, 12].map((s) => booking(`${date}-${s}`, date, h(s), h(s + 2))),
    );
    const days = run({ from: TODAY, to: FRI, bookings: busy });
    expect(days.map((d) => d.status)).toEqual([
      "limited",
      "limited",
      "limited",
    ]);
    expect(bestOf(run({ ...range, bookings: busy }))).toEqual([
      MON,
      "2026-10-27",
      "2026-10-28",
    ]);
  });

  it("gives one day asked alone the same answer as in the range", () => {
    const opts = {
      requestedDate: FRI,
      techs: [tech("t1"), tech("t2", { start: P.a })],
      bookings: [booking("b", FRI, h(8), h(10))],
    };
    const all = run({ ...range, ...opts });
    for (const d of all) {
      const [alone] = run({ ...opts, from: d.date, to: d.date });
      expect(alone).toEqual(d);
    }
  });

  it("ranks over 60 days from today, the asked range and two weeks past the request", () => {
    expect(rankHorizonEnd(TODAY, THU)).toBe("2026-12-19");
    expect(rankHorizonEnd(TODAY, "2027-01-31")).toBe("2027-01-31");
    expect(rankHorizonEnd(TODAY, THU, "2027-01-10")).toBe("2027-01-24");
  });
});

describe("agrees with the Assign hub", () => {
  it("suggests the tech the hub ranks first for the same window", () => {
    const techs = [
      tech("t1", { start: P.home }),
      tech("t2", { start: P.a }),
      tech("t3", { start: P.north15 }),
    ];
    const bookings = [
      booking("x1", D, h(8), h(10), {
        techIds: ["t1"],
        lat: P.a.lat,
        lng: P.a.lng,
      }),
      booking("x2", D, h(14), h(16), {
        techIds: ["t2"],
        lat: P.north15.lat,
        lng: P.north15.lng,
      }),
    ];
    const d = day({ techs, bookings });
    const recTechs: RecTech[] = techs.map((t) => ({
      id: t.id,
      available: true,
      clockedIn: true,
      start: t.start,
      skills: [],
      stops: bookings
        .filter((b) => b.techIds.includes(t.id))
        .map((b) => ({
          id: b.id,
          lat: b.lat,
          lng: b.lng,
          start: (b.start as number) * 60_000,
          end: (b.end as number) * 60_000,
        })),
    }));
    for (const start of ["10:00", "12:00"]) {
      const w = win(d, start);
      const s = Number(start.slice(0, 2)) * 60;
      const recs = recommendTechs(
        {
          id: "new",
          ...P.job,
          start: s * 60_000,
          end: (s + 120) * 60_000,
          durationMin: 90,
        },
        recTechs,
        { isToday: false, dayStart: h(7) * 60_000, dayEnd: h(20) * 60_000 },
      ).filter((r) => r.fits);
      expect(w.suggested?.techId).toBe(recs[0]?.techId);
      expect(w.suggested?.extraMiles).toBe(recs[0]?.extraMiles);
    }
  });
});

describe("⚖️ age is never an input", () => {
  it("gives the same answer whatever the techs' ages or birth dates", () => {
    const techs = [tech("t1"), tech("t2", { start: P.a })];
    const aged = (ages: number[]) =>
      techs.map(
        (t, i) =>
          ({
            ...t,
            age: ages[i],
            birthDate: `${2026 - (ages[i] ?? 30)}-01-01`,
            dob: `${2026 - (ages[i] ?? 30)}-01-01`,
          }) as EngineTech,
      );
    const plain = run({ techs, from: TODAY, to: MON });
    expect(run({ techs: aged([19, 64]), from: TODAY, to: MON })).toEqual(plain);
    expect(run({ techs: aged([71, 22]), from: TODAY, to: MON })).toEqual(plain);
  });

  it("has no age or birth-date field in the engine or its loader", () => {
    for (const file of ["engine.ts", "index.ts", "windows.ts", "types.ts"]) {
      const src = readFileSync(
        join(process.cwd(), "src/features/jobs/availability", file),
        "utf8",
      )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(src, file).not.toMatch(/birth|\bage\b|\bages?[A-Z_]|\bdob\b/i);
    }
  });
});
