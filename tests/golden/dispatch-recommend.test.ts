// ★ Golden tests: Assign hub recommendation (src/features/jobs/dispatch/recommend.ts).
// Score = extra straight-line miles at the cheapest feasible slot + penalties for an
// overlap, the daily cap, not being clocked in today, a missing skill and a tight
// drive, plus LOAD_PER_JOB per job already booked. Age is never an input.
// `arrivalFit` (the booking calendar's timing check for an arrival window) is
// pinned at the bottom.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ArrivalJob,
  type ArrivalTech,
  arrivalFit,
  LOAD_PER_JOB,
  milesBetween,
  NOT_CLOCKED_PENALTY,
  OVERLAP_PENALTY,
  type RecContext,
  type RecJob,
  type RecTech,
  recommendTechs,
} from "@/features/jobs/dispatch/recommend";

const DAY = Date.UTC(2026, 9, 21);
const at = (h: number, m = 0) => DAY + (h * 60 + m) * 60_000;
const ctx: RecContext = {
  isToday: false,
  dayStart: at(8),
  dayEnd: at(18),
};

// Austin-ish points, ~0.69 mi per 0.01° of latitude.
const P = {
  home1: { lat: 30.26, lng: -97.74 },
  a: { lat: 30.28, lng: -97.74 },
  b: { lat: 30.32, lng: -97.74 },
  job: { lat: 30.3, lng: -97.74 },
  far: { lat: 30.45, lng: -97.8 },
  far2: { lat: 30.47, lng: -97.8 },
};
const stop = (
  id: string,
  p: { lat: number; lng: number } | null,
  h: number,
  len = 60,
) => ({
  id,
  lat: p?.lat ?? null,
  lng: p?.lng ?? null,
  start: at(h),
  end: at(h) + len * 60_000,
});
const tech = (id: string, over: Partial<RecTech> = {}): RecTech => ({
  id,
  available: true,
  clockedIn: true,
  start: null,
  stops: [],
  ...over,
});
const timedJob: RecJob = {
  id: "job",
  ...P.job,
  start: at(12),
  end: at(13),
  durationMin: 60,
};

describe("milesBetween (haversine)", () => {
  it("one degree of latitude is ~69.1 miles", () => {
    expect(milesBetween({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
      69.09,
      1,
    );
  });
  it("is zero for the same point and symmetric", () => {
    expect(milesBetween(P.a, P.a)).toBe(0);
    expect(milesBetween(P.a, P.far)).toBeCloseTo(milesBetween(P.far, P.a), 9);
  });
});

describe("recommendTechs: route fit", () => {
  const near = tech("near", {
    stops: [stop("n1", P.a, 9), stop("n2", P.b, 15)],
  });
  const far = tech("far", {
    stops: [stop("f1", P.far, 9), stop("f2", P.far2, 15)],
  });

  it("ranks the tech whose route passes the job first, with the insertion slot", () => {
    const [first, second] = recommendTechs(timedJob, [far, near], ctx);
    expect(first?.techId).toBe("near");
    expect(first?.rank).toBe(1);
    expect(first?.fits).toBe(true);
    // a → job → b is on a straight line: no detour.
    expect(first?.extraMiles).toBe(0);
    expect(first?.insertAfter).toBe("n1");
    expect(first?.insertBefore).toBe("n2");
    expect(first?.reasons).toContain("On the way");
    expect(first?.reasons).toContain("Free at 12:00");
    // 2 jobs booked → 2 × LOAD_PER_JOB.
    expect(first?.score).toBe(2 * LOAD_PER_JOB);
    expect(second?.techId).toBe("far");
    expect(second?.extraMiles).toBeGreaterThan(15);
    expect(second?.reasons[0]).toMatch(/^Adds \d+(\.\d)? mi$/);
  });

  it("measures the detour exactly: d(prev,job)+d(job,next)-d(prev,next)", () => {
    const side = tech("side", {
      stops: [stop("s1", P.a, 9), stop("s2", { lat: 30.28, lng: -97.7 }, 15)],
    });
    const [r] = recommendTechs(timedJob, [side], ctx);
    const expected =
      milesBetween(P.a, P.job) +
      milesBetween(P.job, { lat: 30.28, lng: -97.7 }) -
      milesBetween(P.a, { lat: 30.28, lng: -97.7 });
    expect(r?.extraMiles).toBe(Math.round(expected * 10) / 10);
  });

  it("starts the route at the home base when there is one", () => {
    const fromHome = tech("home", { start: P.home1 });
    const [r] = recommendTechs(timedJob, [fromHome], ctx);
    expect(r?.insertAfter).toBe("start");
    expect(r?.insertBefore).toBeNull();
    expect(r?.extraMiles).toBe(
      Math.round(milesBetween(P.home1, P.job) * 10) / 10,
    );
    expect(r?.reasons).toContain("Nothing booked yet");
  });
});

describe("recommendTechs: penalties", () => {
  it("penalises an overlap with a scheduled window and marks it as not fitting", () => {
    const busy = tech("busy", { stops: [stop("b1", P.job, 12)] });
    const free = tech("free", { stops: [stop("x1", P.far, 9)] });
    const recs = recommendTechs(timedJob, [busy, free], ctx);
    const b = recs.find((r) => r.techId === "busy");
    expect(b?.fits).toBe(false);
    expect(b?.reasons).toContain("Overlaps a scheduled job");
    expect(b?.score).toBeGreaterThanOrEqual(OVERLAP_PENALTY);
    expect(recs[0]?.techId).toBe("free");
  });

  it("caps the day at maxJobsPerDay", () => {
    const full = tech("full", {
      stops: [6, 7, 8, 9, 10, 11].map((h) => stop(`s${h}`, P.job, h, 30)),
    });
    const [r] = recommendTechs(
      { ...timedJob, start: at(16), end: at(17) },
      [full],
      { ...ctx, maxJobsPerDay: 6 },
    );
    expect(r?.fits).toBe(false);
    expect(r?.reasons).toContain("Already 6 jobs");
  });

  it("penalises not being clocked in only when the day is today", () => {
    const on = tech("b-on", { start: P.a, clockedIn: true });
    const off = tech("a-off", { start: P.a, clockedIn: false });
    const today = recommendTechs(timedJob, [off, on], {
      ...ctx,
      isToday: true,
    });
    expect(today.map((r) => r.techId)).toEqual(["b-on", "a-off"]);
    expect((today[1]?.score ?? 0) - (today[0]?.score ?? 0)).toBe(
      NOT_CLOCKED_PENALTY,
    );
    expect(today[1]?.reasons).toContain("Not clocked in");
    // Another day: equal scores, tie broken by id.
    const later = recommendTechs(timedJob, [on, off], ctx);
    expect(later.map((r) => r.techId)).toEqual(["a-off", "b-on"]);
    expect(later[0]?.reasons).not.toContain("Not clocked in");
  });

  it("flags a missing skill when the tech has a skill list", () => {
    const skilled = tech("s", { start: P.a, skills: ["rekey"] });
    const other = tech("o", { start: P.a, skills: ["garage"] });
    const anyone = tech("n", { start: P.a, skills: [] });
    const recs = recommendTechs(
      { ...timedJob, serviceTypeId: "rekey", serviceName: "Rekey" },
      [other, skilled, anyone],
      ctx,
    );
    expect(recs.at(-1)?.techId).toBe("o");
    expect(recs.at(-1)?.reasons).toContain("Not listed for Rekey");
  });

  it("leaves out technicians who aren't available", () => {
    const recs = recommendTechs(
      timedJob,
      [tech("in"), tech("out", { available: false })],
      ctx,
    );
    expect(recs.map((r) => r.techId)).toEqual(["in"]);
  });
});

describe("recommendTechs: untimed jobs", () => {
  it("finds the cheapest free gap and proposes a start after the drive", () => {
    const t = tech("t", {
      start: P.home1,
      stops: [stop("m", P.a, 9), stop("e", P.far, 14)],
    });
    const [r] = recommendTechs(
      { ...timedJob, start: null, end: null, durationMin: 90 },
      [t],
      ctx,
    );
    // Between the morning stop (a, ends 10:00) and the 14:00 far stop.
    expect(r?.insertAfter).toBe("m");
    expect(r?.insertBefore).toBe("e");
    expect(r?.fits).toBe(true);
    // 10:00 + ~3 min drive (1.4 mi at 30 mph), rounded up to 10:15.
    expect(r?.suggestedStart).toBe(at(10, 15));
    expect(r?.reasons).toContain("Free 10:15–14:00");
  });

  it("says when there's no free time left", () => {
    const t = tech("t", { stops: [stop("all", P.a, 8, 600)] });
    const [r] = recommendTechs(
      { ...timedJob, start: null, end: null, durationMin: 60 },
      [t],
      ctx,
    );
    expect(r?.fits).toBe(false);
    expect(r?.reasons).toContain("No free time that day");
  });
});

describe("recommendTechs: jobs without coordinates", () => {
  it("ranks by load and says so", () => {
    const busy = tech("busy", {
      stops: [stop("1", P.a, 8), stop("2", P.a, 10), stop("3", P.a, 15)],
    });
    const light = tech("light", { stops: [stop("4", P.far, 9)] });
    const recs = recommendTechs(
      { ...timedJob, lat: null, lng: null },
      [busy, light],
      ctx,
    );
    expect(recs.map((r) => r.techId)).toEqual(["light", "busy"]);
    for (const r of recs) {
      expect(r.extraMiles).toBeNull();
      expect(r.reasons).toContain("No location, ranked by load");
    }
  });
});

describe("recommendTechs: age is never an input (age-discrimination guard)", () => {
  const base = [
    tech("t1", { start: P.a, stops: [stop("x", P.b, 9)] }),
    tech("t2", { start: P.far, stops: [stop("y", P.far2, 15)] }),
    tech("t3", { start: P.home1, clockedIn: false }),
  ];
  const withAges = (ages: number[]) =>
    base.map(
      (t, i) =>
        ({
          ...t,
          age: ages[i],
          birthDate: `${2026 - (ages[i] ?? 30)}-01-01`,
          dob: `${2026 - (ages[i] ?? 30)}-01-01`,
        }) as RecTech,
    );

  it("gives identical rankings whatever the techs' ages are", () => {
    const plain = recommendTechs(timedJob, base, { ...ctx, isToday: true });
    const young = recommendTechs(timedJob, withAges([19, 22, 25]), {
      ...ctx,
      isToday: true,
    });
    const old = recommendTechs(timedJob, withAges([64, 58, 71]), {
      ...ctx,
      isToday: true,
    });
    expect(young).toEqual(plain);
    expect(old).toEqual(plain);
  });

  it("has no age or birth-date field anywhere in the engine source", () => {
    const src = readFileSync(
      join(process.cwd(), "src/features/jobs/dispatch/recommend.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/birth|\bage\b|\bages?[A-Z_]|\bdob\b/i);
  });
});

describe("arrivalFit: can the job start inside the arrival window?", () => {
  const MIN = 60_000;
  const shift = (from: number, to: number) => [
    { start: at(from), end: at(to) },
  ];
  const day = { dayStart: at(7), dayEnd: at(20) };
  const job = (from: number, to: number, durationMin = 90): ArrivalJob => ({
    ...P.job,
    from: at(from),
    to: at(to),
    durationMin,
  });
  const t = (over: Partial<ArrivalTech> = {}): ArrivalTech => ({
    shifts: shift(8, 17),
    stops: [],
    ...over,
  });
  // ~1.4 mi from a to the job: 2.76 min at 30 mph.
  const aToJob = (milesBetween(P.a, P.job) / 30) * 60 * MIN;

  it("starts at the window when the day is free", () => {
    expect(arrivalFit(job(10, 12), t(), day)).toEqual({
      fits: true,
      arrival: at(10),
      miss: null,
    });
  });

  it("starts after the previous stop's time on site plus the drive", () => {
    const prev = { ...stop("p", P.a, 9), minutes: 75 };
    const r = arrivalFit(job(10, 12), t({ stops: [prev] }), day);
    expect(r.fits).toBe(true);
    expect(r.arrival).toBeCloseTo(at(10, 15) + aToJob, -1);
  });

  it("waits for the shift and must finish inside it", () => {
    expect(
      arrivalFit(job(8, 10), t({ shifts: shift(9, 17) }), day).arrival,
    ).toBe(at(9));
    // Starting at 10 isn't inside an 8–10 window.
    expect(arrivalFit(job(8, 10), t({ shifts: shift(10, 17) }), day)).toEqual({
      fits: false,
      arrival: null,
      miss: "off",
    });
    // 90 minutes from 4 PM ends after a 5 PM close.
    expect(arrivalFit(job(16, 18), t(), day).miss).toBe("no_time");
    expect(arrivalFit(job(16, 18, 45), t(), day).fits).toBe(true);
  });

  it("works around time off, and says so when it fills the window", () => {
    const blocks = [{ start: at(9), end: at(10, 30) }];
    expect(arrivalFit(job(10, 12), t({ blocks }), day).arrival).toBe(
      at(10, 30),
    );
    const allDay = [{ start: at(0), end: at(24) }];
    expect(arrivalFit(job(10, 12), t({ blocks: allDay }), day).miss).toBe(
      "time_off",
    );
  });

  it("won't push a later job past its own window", () => {
    // ~11 mi away (22 min): 2 h from 8:00 reaches it at 10:22, after 10:15.
    const later = { ...stop("n", P.far, 10), end: at(10, 15), minutes: 60 };
    expect(arrivalFit(job(8, 10, 120), t({ stops: [later] }), day).miss).toBe(
      "bumps",
    );
    expect(arrivalFit(job(8, 10, 60), t({ stops: [later] }), day).fits).toBe(
      true,
    );
  });

  it("lets an on-call tech take the window inside the day's bounds", () => {
    expect(arrivalFit(job(17, 19), t({ shifts: null }), day).arrival).toBe(
      at(17),
    );
    expect(arrivalFit(job(19, 21), t({ shifts: null }), day).miss).toBe(
      "no_time",
    );
  });

  it("starts no sooner than allowed, and takes a fixed time exactly", () => {
    expect(
      arrivalFit(job(10, 12), t(), { ...day, notBefore: at(10, 40) }).arrival,
    ).toBe(at(10, 40));
    expect(arrivalFit(job(13, 13, 60), t(), day).arrival).toBe(at(13));
  });
});
