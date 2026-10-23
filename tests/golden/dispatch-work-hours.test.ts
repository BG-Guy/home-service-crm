// Golden: the Assign hub's ranking respects working hours and time off the way
// the booking calendar does (src/features/jobs/dispatch/work-fit.ts on top of
// recommendTechs + arrivalFit). Off or on time off in the window → listed last,
// not fitting, with why; everyone else keeps the route ranking.
import { describe, expect, it } from "vitest";
import {
  type Recommendation,
  recommendTechs,
} from "@/features/jobs/dispatch/recommend";
import {
  type OffReason,
  offReason,
  rankByWorkHours,
} from "@/features/jobs/dispatch/work-fit";

const H = 3_600_000;
const DAY = Date.UTC(2026, 9, 26); // a Monday, 00:00 UTC (the "company zone" here)
const at = (h: number) => DAY + h * H;
const ctx = { dayStart: at(7), dayEnd: at(19) };
// A booked job: arrival window 10–12, an hour on site.
const job = {
  lat: 39.74,
  lng: -104.99,
  from: at(10),
  to: at(12),
  durationMin: 60,
};
const nineToFive = { shifts: [{ start: at(8), end: at(17) }], blocks: [] };

describe("hub ranking: working hours and time off", () => {
  it("says why a tech can't take the window", () => {
    expect(offReason(job, nineToFive, [], ctx)).toBeNull();
    expect(offReason(job, undefined, [], ctx)).toBeNull(); // unknown hours: no claim
    expect(offReason(job, { shifts: [], blocks: [] }, [], ctx)).toBe(
      "Off that day",
    );
    expect(
      offReason(
        job,
        { shifts: [{ start: at(13), end: at(17) }], blocks: [] },
        [],
        ctx,
      ),
    ).toBe("Off then");
    expect(
      offReason(
        job,
        { shifts: nineToFive.shifts, blocks: [{ start: at(9), end: at(13) }] },
        [],
        ctx,
      ),
    ).toBe("Time off");
    // Time off that leaves room inside the window is fine (arrive at 11).
    expect(
      offReason(
        job,
        { shifts: nineToFive.shifts, blocks: [{ start: at(9), end: at(11) }] },
        [],
        ctx,
      ),
    ).toBeNull();
  });

  it("moves those techs last, not fitting, reason first; keeps the rest in order", () => {
    const recs = recommendTechs(
      {
        id: "j",
        lat: job.lat,
        lng: job.lng,
        start: job.from,
        end: job.to,
        durationMin: 60,
      },
      ["a", "b", "c"].map((id, i) => ({
        id,
        available: true,
        clockedIn: true,
        // a is closest, then b, then c.
        start: { lat: 39.74 + i * 0.05, lng: -104.99 },
        stops: [],
      })),
      { isToday: false, dayStart: ctx.dayStart, dayEnd: ctx.dayEnd },
    );
    expect(recs.map((r) => r.techId)).toEqual(["a", "b", "c"]);

    const off = new Map<string, OffReason>([["a", "Time off"]]);
    const out = rankByWorkHours(recs, off);
    expect(out.map((r) => [r.techId, r.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
    const a = out.find((r) => r.techId === "a") as Recommendation;
    expect(a.fits).toBe(false);
    expect(a.reasons[0]).toBe("Time off");
    // Nobody off: the route ranking stands, untouched.
    expect(rankByWorkHours(recs, new Map())).toEqual(recs);
    // The input isn't changed.
    expect(recs[0]?.fits).toBe(true);
    expect(recs[0]?.rank).toBe(1);
  });
});
