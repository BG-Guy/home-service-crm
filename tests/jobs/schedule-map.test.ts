// Schedule map view (/schedule?view=map): route order and miles, no-location and
// unassigned handling, job phase, labels, keyboard stepping and decluttering.
// Pure helpers in src/features/jobs/schedule-map/route.ts.
import { describe, expect, it } from "vitest";
import { milesBetween } from "@/features/jobs/dispatch/recommend";
import {
  buildTechDays,
  clock,
  compactRange,
  compactWindow,
  compareStops,
  hourTick,
  jobPhase,
  lanes,
  longWindow,
  neighborStop,
  routeMiles,
  routePoints,
  shortName,
  stopIndex,
  timelineSpan,
} from "@/features/jobs/schedule-map/route";
import { declutter } from "@/lib/declutter";

// Austin-ish points, ~0.69 mi per 0.01° of latitude.
const HOME = { lat: 30.26, lng: -97.74 };
const A = { lat: 30.28, lng: -97.74 };
const B = { lat: 30.32, lng: -97.74 };
const C = { lat: 30.3, lng: -97.7 };

type J = {
  id: string;
  startMin: number;
  endMin: number;
  createdAt: string;
  lat: number | null;
  lng: number | null;
  techIds: string[];
};
const job = (
  id: string,
  h: number,
  p: { lat: number; lng: number } | null,
  techIds: string[],
  createdAt = "2026-10-01T00:00:00.000Z",
  len = 120,
): J => ({
  id,
  startMin: h * 60,
  endMin: h * 60 + len,
  createdAt,
  lat: p?.lat ?? null,
  lng: p?.lng ?? null,
  techIds,
});

describe("route order", () => {
  it("orders stops by window start, then created time, then id", () => {
    const list = [
      job("c", 10, A, ["t1"], "2026-10-02T00:00:00.000Z"),
      job("b", 8, B, ["t1"]),
      job("a", 10, C, ["t1"], "2026-10-01T09:00:00.000Z"),
      job("d", 10, C, ["t1"], "2026-10-01T09:00:00.000Z"),
    ];
    expect([...list].sort(compareStops).map((j) => j.id)).toEqual([
      "b",
      "a",
      "d",
      "c",
    ]);
  });

  it("builds each tech's day: their jobs in order, first and last window", () => {
    const jobs = [
      job("late", 14, C, ["t1"]),
      job("early", 8, A, ["t1"]),
      job("helper", 11, B, ["t2", "t1"]),
      job("other", 9, B, ["t2"]),
    ];
    const days = buildTechDays(
      [
        { id: "t1", start: HOME },
        { id: "t2", start: null },
        { id: "t3", start: HOME },
      ],
      jobs,
    );
    expect(days.get("t1")?.jobIds).toEqual(["early", "helper", "late"]);
    expect(days.get("t1")?.firstMin).toBe(8 * 60);
    expect(days.get("t1")?.lastMin).toBe(16 * 60);
    expect(days.get("t2")?.jobIds).toEqual(["other", "helper"]);
    expect(days.get("t3")).toEqual({
      jobIds: [],
      miles: 0,
      firstMin: null,
      lastMin: null,
    });
  });
});

describe("route miles", () => {
  it("sums straight-line legs from the home base, rounded to 0.1 mi", () => {
    const pts = routePoints(HOME, [A, B, C]);
    const expected =
      milesBetween(HOME, A) + milesBetween(A, B) + milesBetween(B, C);
    expect(routeMiles(pts)).toBe(Math.round(expected * 10) / 10);
    expect(routeMiles(pts)).toBeGreaterThan(4);
  });

  it("starts at the first stop when there is no home base", () => {
    expect(routePoints(null, [A, B])).toEqual([A, B]);
    expect(routeMiles(routePoints(null, [A, B]))).toBe(
      Math.round(milesBetween(A, B) * 10) / 10,
    );
    expect(routeMiles(routePoints(null, [A]))).toBe(0);
    expect(routeMiles([])).toBe(0);
  });

  it("skips stops without a location (no guessed legs)", () => {
    const noLoc = { lat: null, lng: null };
    const half = { lat: 30.3, lng: null };
    expect(routePoints(HOME, [A, noLoc, half, B])).toEqual([HOME, A, B]);
    const days = buildTechDays(
      [{ id: "t1", start: HOME }],
      [
        job("1", 8, A, ["t1"]),
        job("2", 10, null, ["t1"]),
        job("3", 12, B, ["t1"]),
      ],
    );
    // The stop without a location keeps its place in the day (stop 2)…
    expect(days.get("t1")?.jobIds).toEqual(["1", "2", "3"]);
    // …but the miles only count the located legs: home → 1 → 3.
    expect(days.get("t1")?.miles).toBe(
      Math.round((milesBetween(HOME, A) + milesBetween(A, B)) * 10) / 10,
    );
  });
});

describe("stop index and unassigned jobs", () => {
  it("numbers a job on its primary tech's route; unassigned jobs have no stop", () => {
    const jobs = [
      job("x", 8, A, ["t1"]),
      job("y", 10, B, ["t2", "t1"]),
      job("u", 9, C, []),
    ];
    const days = buildTechDays(
      [
        { id: "t1", start: HOME },
        { id: "t2", start: null },
      ],
      jobs,
    );
    const techs = [...days].map(([id, d]) => ({ id, jobIds: d.jobIds }));
    const idx = stopIndex(techs, jobs);
    expect(idx.get("x")).toEqual({ techId: "t1", seq: 1, of: 2 });
    // Primary first: y is t2's only stop even though it is also on t1's route.
    expect(idx.get("y")).toEqual({ techId: "t2", seq: 1, of: 1 });
    expect(days.get("t1")?.jobIds).toEqual(["x", "y"]);
    expect(idx.has("u")).toBe(false);
    expect(techs.some((t) => t.jobIds.includes("u"))).toBe(false);
    expect(
      jobPhase({ status: "scheduled", endMin: 600, techIds: [] }, 0, "future")
        .unassigned,
    ).toBe(true);
  });

  it("steps through a route with the arrow keys (clamped)", () => {
    const order = ["a", "b", "c"];
    expect(neighborStop(order, null, 1)).toBe("a");
    expect(neighborStop(order, null, -1)).toBe("c");
    expect(neighborStop(order, "a", 1)).toBe("b");
    expect(neighborStop(order, "c", 1)).toBe("c");
    expect(neighborStop(order, "a", -1)).toBe("a");
    expect(neighborStop(order, "zzz", 1)).toBe("a");
    expect(neighborStop([], "a", 1)).toBeNull();
  });
});

describe("job phase", () => {
  const j = (
    status: Parameters<typeof jobPhase>[0]["status"],
    endMin = 600,
  ) => ({
    status,
    endMin,
    techIds: ["t1"],
  });
  it("done, live, late", () => {
    expect(jobPhase(j("completed"), 0, "today").done).toBe(true);
    expect(jobPhase(j("closed"), 0, "today").done).toBe(true);
    expect(jobPhase(j("en_route"), 0, "today").live).toBe(true);
    expect(jobPhase(j("in_progress"), 0, "today").live).toBe(true);
    expect(jobPhase(j("arrived"), 0, "today").live).toBe(true);
    // Late: the window passed and nobody arrived.
    expect(jobPhase(j("scheduled"), 601, "today").late).toBe(true);
    expect(jobPhase(j("confirmed"), 599, "today").late).toBe(false);
    expect(jobPhase(j("en_route"), 700, "today")).toMatchObject({
      live: true,
      late: true,
    });
    expect(jobPhase(j("in_progress"), 700, "today").late).toBe(false);
    expect(jobPhase(j("completed"), 700, "today").late).toBe(false);
    expect(jobPhase(j("scheduled"), 0, "past").late).toBe(true);
    expect(jobPhase(j("scheduled"), 2000, "future").late).toBe(false);
  });
});

describe("labels", () => {
  it("compact and long windows", () => {
    expect(compactWindow(8 * 60, 10 * 60)).toBe("8–10");
    expect(compactWindow(8 * 60 + 30, 10 * 60)).toBe("8:30–10");
    expect(compactWindow(11 * 60, 13 * 60)).toBe("11–1");
    expect(compactRange(8 * 60, 17 * 60)).toBe("8a–5p");
    expect(compactRange(12 * 60, 12 * 60 + 45)).toBe("12p–12:45p");
    expect(longWindow(8 * 60, 10 * 60)).toBe("8:00 – 10:00 AM");
    expect(longWindow(11 * 60, 13 * 60)).toBe("11:00 AM – 1:00 PM");
    expect(longWindow(13 * 60 + 30, 15 * 60)).toBe("1:30 – 3:00 PM");
    expect(clock(0, true)).toBe("12a");
    expect(clock(24 * 60 + 60)).toBe("1");
    expect(hourTick(12 * 60 + 59)).toBe("12p");
  });

  it("timeline span: earliest to latest window ± 1 h (business hours when empty)", () => {
    expect(timelineSpan([], 8, 18)).toEqual({ startMin: 480, endMin: 1080 });
    const day = [
      { startMin: 8 * 60, endMin: 10 * 60 },
      { startMin: 14 * 60, endMin: 16 * 60 + 30 },
    ];
    // 7a–6p: an hour of air on each side, whole hours.
    expect(timelineSpan(day, 7, 19)).toEqual({ startMin: 420, endMin: 1080 });
    // Today: the now-line stays on the axis.
    expect(timelineSpan(day, 7, 19, 18 * 60 + 10)).toEqual({
      startMin: 420,
      endMin: 1200,
    });
    // At least three hours wide.
    expect(timelineSpan([{ startMin: 600, endMin: 630 }], 8, 18)).toEqual({
      startMin: 540,
      endMin: 720,
    });
  });

  it("short customer names", () => {
    expect(shortName("Dana Whitfield")).toBe("Dana W.");
    expect(shortName("Mary Jo smith", "residential")).toBe("Mary S.");
    expect(shortName("Cher")).toBe("Cher");
    expect(shortName("Oak Ridge Realty LLC")).toBe("Oak Ridge");
    expect(shortName("Northwind Property Management", "property_manager")).toBe(
      "Northwind",
    );
    expect(shortName("Mary Church", "residential")).toBe("Mary C.");
  });
});

describe("timeline lanes", () => {
  it("stacks overlapping windows, reuses a lane once it is free", () => {
    const { lane, count } = lanes([
      { id: "a", startMin: 480, endMin: 600 },
      { id: "b", startMin: 540, endMin: 660 }, // overlaps a
      { id: "c", startMin: 600, endMin: 720 }, // a has ended: lane 0 again
      { id: "d", startMin: 610, endMin: 650 }, // overlaps b and c
    ]);
    expect(lane.get("a")).toBe(0);
    expect(lane.get("b")).toBe(1);
    expect(lane.get("c")).toBe(0);
    expect(lane.get("d")).toBe(2);
    expect(count).toBe(3);
    expect(lanes([]).count).toBe(1);
  });
});

describe("declutter", () => {
  const base = { boxH: 34, tail: 6, dot: 22 };
  it("expands boxes that fit and collapses overlapping ones to dots", () => {
    const items = [
      { id: "a", x: 100, y: 100, w: 90, priority: 1 },
      { id: "b", x: 130, y: 105, w: 90, priority: 2 }, // overlaps a's box
      { id: "c", x: 400, y: 100, w: 90, priority: 3 },
    ];
    expect([...declutter(items, base)].sort()).toEqual(["a", "c"]);
  });

  it("a box never covers another marker's dot", () => {
    const items = [
      { id: "a", x: 100, y: 100, w: 90, priority: 1 },
      // Sits right under a's box area: a's box would cover b's dot.
      { id: "b", x: 100, y: 75, w: 90, priority: 2 },
    ];
    const out = declutter(items, base);
    expect(out.has("a")).toBe(false);
    expect(out.has("b")).toBe(true);
  });

  it("keeps a gap between boxes, uses measured heights and avoids home pins", () => {
    // 100 px wide boxes, 104 px apart: they fit side by side…
    const pair = [
      { id: "a", x: 100, y: 100, w: 100, priority: 1 },
      { id: "b", x: 204, y: 100, w: 100, priority: 2 },
    ];
    expect(declutter(pair, base).size).toBe(2);
    // …but not with an 8 px gap.
    expect([...declutter(pair, { ...base, gap: 8 })]).toEqual(["a"]);
    // A tall measured box reaches a marker above it; the default height doesn't.
    const low = { id: "low", x: 100, y: 200, w: 80, priority: 1 };
    const high = { id: "high", x: 100, y: 140, w: 80, priority: 2 };
    expect(declutter([low, high], base).has("low")).toBe(true);
    expect(declutter([{ ...low, h: 60 }, high], base).has("low")).toBe(false);
    // A home pin under the box keeps it a dot.
    expect(
      declutter([{ id: "a", x: 100, y: 100, w: 100, priority: 1 }], {
        ...base,
        obstacles: [{ x: 100, y: 70, d: 24 }],
      }).size,
    ).toBe(0);
  });

  it("a box the map edge would cut stays a dot", () => {
    const edge = [
      { id: "left", x: 20, y: 100, w: 80, priority: 1 },
      { id: "top", x: 200, y: 30, w: 80, priority: 2 },
      { id: "ok", x: 400, y: 100, w: 80, priority: 3 },
    ];
    expect([
      ...declutter(edge, { ...base, bounds: { w: 600, h: 300 } }),
    ]).toEqual(["ok"]);
  });

  it("forced ids always expand; dotsOnly keeps everything else a dot", () => {
    const items = [
      { id: "a", x: 100, y: 100, w: 90, priority: 1 },
      { id: "b", x: 120, y: 100, w: 90, priority: 2 },
      { id: "c", x: 600, y: 100, w: 90, priority: 3 },
    ];
    const forced = declutter(items, { ...base, force: new Set(["b"]) });
    expect(forced.has("b")).toBe(true);
    expect(forced.has("a")).toBe(false);
    expect(forced.has("c")).toBe(true);
    const dots = declutter(items, {
      ...base,
      dotsOnly: true,
      force: new Set(["c"]),
    });
    expect([...dots]).toEqual(["c"]);
  });
});
