// Route map planning (schedule map layout, the tech's "Today's route" card): stop
// numbering per tech in visit order, pins/lines, unlocated stops, tech colors.
import { describe, expect, it } from "vitest";
import {
  byVisitOrder,
  isLocated,
  planRoutes,
  type RouteLayerJob,
  routeLayers,
  singleRoute,
  techColor,
  UNASSIGNED_COLOR,
  unlocatedStops,
} from "@/features/jobs/route-plan";
import { TONE_VAR, toneFor } from "@/ui/tone";

const at = (hhmm: string) => `2026-10-15T${hhmm}:00.000Z`;
let seq = 0;
function job(
  start: string | null,
  techIds: string[],
  geo: [number, number] | null = [30.26 + seq / 100, -97.74],
  extra: Partial<RouteLayerJob> = {},
): RouteLayerJob {
  seq += 1;
  return {
    id: `j${seq}`,
    number: `J-${1000 + seq}`,
    title: `Job ${seq}`,
    status: "scheduled",
    start,
    techIds,
    lat: geo ? geo[0] : null,
    lng: geo ? geo[1] : null,
    ...extra,
  };
}
const look = {
  color: (id: string) => `#${id === "tom" ? "ff0000" : "0000ff"}`,
  name: (id: string) => (id === "tom" ? "Tom Rivera" : "Maria Lopez"),
};

describe("techColor (same rule as the schedule board)", () => {
  it("keeps a hex color", () => {
    expect(techColor("#FF3B30", "u1")).toBe("#FF3B30");
  });
  it("maps a tone name to its system color", () => {
    expect(techColor("teal", "u1")).toBe(TONE_VAR.teal);
  });
  it("falls back to the id's stable tone", () => {
    expect(techColor(null, "u1")).toBe(TONE_VAR[toneFor("u1")]);
    expect(techColor("", "u1")).toBe(TONE_VAR[toneFor("u1")]);
  });
  it("never passes markup or prototype keys through (marker HTML is a string)", () => {
    expect(techColor('#fff" onclick="x', "u1")).toBe(TONE_VAR[toneFor("u1")]);
    expect(techColor("toString", "u1")).toBe(TONE_VAR[toneFor("u1")]);
  });
});

describe("isLocated", () => {
  it("needs finite, in-range coordinates that aren't 0,0", () => {
    expect(isLocated({ lat: 30.26, lng: -97.74 })).toBe(true);
    expect(isLocated({ lat: null, lng: -97.74 })).toBe(false);
    expect(isLocated({ lat: 30.26 })).toBe(false);
    expect(isLocated({ lat: 0, lng: 0 })).toBe(false);
    expect(isLocated({ lat: Number.NaN, lng: 1 })).toBe(false);
    expect(isLocated({ lat: 91, lng: 1 })).toBe(false);
    expect(isLocated({ lat: 1, lng: -181 })).toBe(false);
  });
});

describe("visit order", () => {
  it("sorts by window start, missing starts last, ties keep input order", () => {
    const a = job(at("15:00"), ["tom"]);
    const b = job(null, ["tom"]);
    const c = job(at("13:00"), ["tom"]);
    const d = job(at("15:00"), ["tom"]);
    expect(byVisitOrder([a, b, c, d]).map((j) => j.id)).toEqual([
      c.id,
      a.id,
      d.id,
      b.id,
    ]);
  });
});

describe("planRoutes", () => {
  it("numbers each tech's stops 1, 2, 3 by window start", () => {
    const late = job(at("18:00"), ["tom"]);
    const early = job(at("14:00"), ["tom"]);
    const mid = job(at("16:00"), ["tom"]);
    const plan = planRoutes([late, early, mid], ["tom"]);
    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0]?.stops.map((s) => [s.job.id, s.n])).toEqual([
      [early.id, 1],
      [mid.id, 2],
      [late.id, 3],
    ]);
  });

  it("makes a shared job a stop on both routes, with each tech's own number", () => {
    const tomFirst = job(at("14:00"), ["tom"]);
    const shared = job(at("16:00"), ["tom", "maria"]);
    const plan = planRoutes([shared, tomFirst], ["maria", "tom"]);
    expect(plan.routes.map((r) => r.techId)).toEqual(["maria", "tom"]);
    expect(plan.routes[0]?.stops.map((s) => s.n)).toEqual([1]);
    expect(plan.routes[1]?.stops.map((s) => [s.job.id, s.n])).toEqual([
      [tomFirst.id, 1],
      [shared.id, 2],
    ]);
  });

  it("dedupes repeated assignee ids and keeps unassigned jobs apart", () => {
    const twice = job(at("14:00"), ["tom", "tom"]);
    const nobody = job(at("15:00"), []);
    const plan = planRoutes([nobody, twice]);
    expect(plan.routes[0]?.stops).toHaveLength(1);
    expect(plan.unassigned.map((j) => j.id)).toEqual([nobody.id]);
  });

  it("orders routes by the roster, then by first appearance", () => {
    const a = job(at("14:00"), ["zed"]);
    const b = job(at("15:00"), ["amy"]);
    const c = job(at("16:00"), ["tom"]);
    const plan = planRoutes([a, b, c], ["tom"]);
    expect(plan.routes.map((r) => r.techId)).toEqual(["tom", "zed", "amy"]);
  });
});

describe("routeLayers", () => {
  it("pins located stops with their visit number and joins them in order", () => {
    const one = job(at("14:00"), ["tom"], [30.1, -97.1]);
    const two = job(at("15:00"), ["tom"], null);
    const three = job(at("16:00"), ["tom"], [30.3, -97.3]);
    const { pins, lines } = routeLayers(
      planRoutes([one, two, three], ["tom"]),
      look,
    );
    // The unlocated stop keeps its number: pins read 1 and 3.
    expect(pins.map((p) => p.label)).toEqual(["1", "3"]);
    expect(pins[0]).toMatchObject({
      key: `tom:${one.id}`,
      jobId: one.id,
      color: "#ff0000",
      done: false,
      dx: 0,
      title: `Stop 1, Tom Rivera: ${one.number} · ${one.title}`,
    });
    expect(lines).toEqual([
      {
        key: "tom",
        color: "#ff0000",
        points: [
          [30.1, -97.1],
          [30.3, -97.3],
        ],
      },
    ]);
  });

  it("draws no line for a single located stop", () => {
    const { pins, lines } = routeLayers(
      planRoutes([job(at("14:00"), ["tom"])]),
      look,
    );
    expect(pins).toHaveLength(1);
    expect(lines).toEqual([]);
  });

  it("gives unassigned jobs a grey '?' pin and fades done stops", () => {
    const open = job(at("14:00"), []);
    const done = job(at("13:00"), ["tom"], undefined, { status: "completed" });
    const { pins } = routeLayers(planRoutes([open, done]), look);
    const q = pins.find((p) => p.jobId === open.id);
    expect(q).toMatchObject({
      label: "?",
      color: UNASSIGNED_COLOR,
      title: `Unassigned: ${open.number} · ${open.title}`,
    });
    expect(pins.find((p) => p.jobId === done.id)?.done).toBe(true);
  });

  it("nudges pins at the same spot apart so both numbers show", () => {
    const shared = job(at("14:00"), ["tom", "maria"], [30.2, -97.2]);
    const { pins } = routeLayers(planRoutes([shared], ["tom", "maria"]), look);
    expect(pins.map((p) => p.dx)).toEqual([-9, 9]);
  });

  it("omits the name when the route is the viewer's own", () => {
    const j = job(at("14:00"), ["me"]);
    const { pins } = routeLayers(singleRoute("me", [j]), {
      color: () => "#000",
      name: () => "",
    });
    expect(pins[0]?.title).toBe(`Stop 1: ${j.number} · ${j.title}`);
  });
});

describe("singleRoute", () => {
  it("numbers the given order as is", () => {
    const a = job(at("16:00"), ["me"]);
    const b = job(at("14:00"), ["me"]);
    const plan = singleRoute("me", [a, b]);
    expect(plan.routes[0]?.stops.map((s) => [s.job.id, s.n])).toEqual([
      [a.id, 1],
      [b.id, 2],
    ]);
    expect(singleRoute("me", []).routes).toEqual([]);
  });
});

describe("unlocatedStops", () => {
  it("lists jobs without coordinates once, with each tech's stop number", () => {
    const placed = job(at("13:00"), ["tom"]);
    const lostShared = job(at("15:00"), ["tom", "maria"], null);
    const lostNobody = job(at("14:00"), [], null);
    const out = unlocatedStops(
      planRoutes([lostShared, placed, lostNobody], ["tom", "maria"]),
    );
    expect(out.map((u) => u.job.id)).toEqual([lostNobody.id, lostShared.id]);
    expect(out[0]?.stops).toEqual([]);
    expect(out[1]?.stops).toEqual([
      { techId: "tom", n: 2 },
      { techId: "maria", n: 1 },
    ]);
  });
});
