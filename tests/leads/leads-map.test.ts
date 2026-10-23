// Lead map (leads-flow item 10): the drawer's detents and snapping, the pins
// (priority, timer ring, pulses, fan-out, decluttering, name tags, HTML), the
// coverage note, the map-queries shaping (pins, coverage by reason, job markers
// with the contact window) and the demo walk-ins' map spots. Pure; no database.
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Nothing here opens the database; keep any accidental use off ./.data.
process.env.PGLITE_DIR = path.join(os.tmpdir(), "crm-leads-map-unit");

import {
  cycleDetent,
  detentTops,
  dragTop,
  releaseVelocity,
  snapDrawer,
  stepDetent,
} from "@/features/leads/components/map/drawer";
import {
  coverageNote,
  fanOut,
  jobHtml,
  layoutPins,
  pinHtml,
  pinLabel,
  pinPriority,
  pinRing,
  pulseIds,
  tagSide,
} from "@/features/leads/components/map/pins";
import type { LeadsMapPoint } from "@/features/leads/components/map/types";
import type { LeadBoxData } from "@/features/leads/contracts";
import {
  type JobMapRow,
  type LeadMapRow,
  missingReason,
  shapeJobMarkers,
  shapeLeadPins,
} from "@/features/leads/map-queries";
import { initialsOf, toMapPoint } from "@/features/leads/rules";
import { walkInSpot } from "@/features/leads/seed";

const T0 = Date.parse("2026-10-22T16:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

const point = (o: Partial<LeadsMapPoint> = {}): LeadsMapPoint => ({
  id: "l1",
  lat: 39.74,
  lng: -104.98,
  initials: "JW",
  status: "new",
  slaStart: iso(T0),
  respondedAt: null,
  name: "Jacob W.",
  seed: "c1",
  service: "Lockout",
  ...o,
});

describe("drawer detents", () => {
  const tops = detentTops(700, 90);

  it("keeps full ≤ half ≤ peek < away, with the peek above the tab bar", () => {
    expect(tops).toEqual({ full: 0, half: 315, peek: 460, away: 724 });
    // A short region (landscape phone): half folds onto peek, never below it.
    expect(detentTops(300, 90)).toEqual({
      full: 0,
      half: 60,
      peek: 60,
      away: 324,
    });
    expect(detentTops(0)).toEqual({ full: 0, half: 0, peek: 0, away: 24 });
  });

  it("settles on the nearest detent where the flick would carry it", () => {
    expect(snapDrawer(320, 0, tops)).toBe("half");
    expect(snapDrawer(100, -1, tops)).toBe("full");
    expect(snapDrawer(300, 1, tops)).toBe("peek");
    expect(snapDrawer(540, 0, tops)).toBe("peek");
  });

  it("puts the drawer away (full-screen map) past the peek line", () => {
    expect(snapDrawer(560, 0, tops)).toBe("away");
    expect(snapDrawer(300, 2, tops)).toBe("away");
  });

  it("steps, cycles and rubber-bands", () => {
    expect(stepDetent("peek", 1)).toBe("half");
    expect(stepDetent("full", 1)).toBe("full");
    expect(stepDetent("half", -1)).toBe("peek");
    expect(stepDetent("peek", -1)).toBe("away");
    expect(cycleDetent("peek")).toBe("half");
    expect(cycleDetent("half")).toBe("full");
    expect(cycleDetent("full")).toBe("peek");
    expect(dragTop(400, tops)).toBe(400);
    expect(dragTop(-30, tops)).toBe(-10);
    expect(dragTop(900, tops)).toBe(724);
  });

  it("measures the release speed over the last 100 ms", () => {
    expect(
      releaseVelocity([
        { t: 0, y: 0 },
        { t: 50, y: 50 },
        { t: 100, y: 150 },
      ]),
    ).toBe(1.5);
    expect(
      releaseVelocity([
        { t: 0, y: 0 },
        { t: 200, y: 10 },
        { t: 250, y: 60 },
      ]),
    ).toBe(1);
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ t: 5, y: 5 }])).toBe(0);
  });
});

describe("pins", () => {
  it("puts the longest unanswered wait first, then answered, contacted, qualified", () => {
    const order = [
      point({ id: "q", status: "qualified" }),
      point({ id: "c", status: "contacted" }),
      point({ id: "a", respondedAt: iso(T0 + MIN) }),
      point({ id: "n2", slaStart: iso(T0 - 2 * MIN) }),
      point({ id: "n20", slaStart: iso(T0 - 20 * MIN) }),
    ]
      .sort((a, b) => pinPriority(a) - pinPriority(b))
      .map((p) => p.id);
    expect(order).toEqual(["n20", "n2", "a", "c", "q"]);
  });

  it("draws the timer ring like the box avatar", () => {
    expect(pinRing(point(), null)).toEqual({ progress: 0, tone: "green" });
    expect(pinRing(point(), T0 + 3 * MIN)).toEqual({
      progress: 0.2,
      tone: "green",
    });
    const mid = pinRing(point(), T0 + 10 * MIN);
    expect(mid.tone).toBe("orange");
    expect(mid.progress).toBeCloseTo(2 / 3, 5);
    expect(pinRing(point(), T0 + 20 * MIN)).toEqual({
      progress: 1,
      tone: "red",
    });
    // Frozen at the first response.
    const answered = pinRing(
      point({ respondedAt: iso(T0 + 4 * MIN) }),
      T0 + 60 * MIN,
    );
    expect(answered.tone).toBe("green");
    expect(answered.progress).toBeCloseTo(4 / 15, 5);
    expect(pinRing(point({ respondedAt: iso(T0 + 16 * MIN) }), null)).toEqual({
      progress: 1,
      tone: "red",
    });
  });

  it("pulses at most the two newest unanswered leads inside the red line", () => {
    const pts = [
      point({ id: "p1", slaStart: iso(T0 - 2 * MIN) }),
      point({ id: "p2", slaStart: iso(T0 - 5 * MIN) }),
      point({ id: "p3", slaStart: iso(T0 - 10 * MIN) }),
      point({ id: "late", slaStart: iso(T0 - 20 * MIN) }),
      point({ id: "answered", slaStart: iso(T0 - MIN), respondedAt: iso(T0) }),
      point({ id: "contacted", status: "contacted" }),
    ];
    expect([...pulseIds(pts, T0)].sort()).toEqual(["p1", "p2"]);
    expect(pulseIds(pts, null).size).toBe(0);
  });

  it("fans out leads at one spot side by side", () => {
    const at = fanOut([
      { id: "a", lat: 39.7, lng: -104.9 },
      { id: "b", lat: 39.7, lng: -104.9 },
      { id: "c", lat: 39.7, lng: -104.9 },
      { id: "d", lat: 39.8, lng: -104.9 },
    ]);
    expect(Object.fromEntries(at)).toEqual({ a: 0, b: 44, c: -44, d: 0 });
  });

  it("folds overlapping pins to dots (the shared declutter rule)", () => {
    const spot = (id: string, x: number, priority: number) => ({
      id,
      x,
      y: 100,
      priority,
    });
    const far = [spot("a", 100, 1), spot("b", 200, 2)];
    expect([...layoutPins(far, { zoom: 12 })].sort()).toEqual(["a", "b"]);
    // 35 px apart: the more urgent one keeps its pin, the other is a dot beside it.
    expect([
      ...layoutPins([spot("a", 100, 1), spot("b", 135, 2)], { zoom: 12 }),
    ]).toEqual(["a"]);
    // 20 px apart: each would cover the other's dot, so both fold…
    const close = [spot("a", 100, 1), spot("b", 120, 2)];
    expect(layoutPins(close, { zoom: 12 }).size).toBe(0);
    // …except the selected one, which always shows.
    expect([...layoutPins(close, { zoom: 12, selected: "b" })]).toEqual(["b"]);
    // Zoomed out to the metro: dots only, the selected pin still full size.
    expect(layoutPins(far, { zoom: 8 }).size).toBe(0);
    expect([...layoutPins(far, { zoom: 8, selected: "a" })]).toEqual(["a"]);
  });

  it("puts the name tag on the first free side", () => {
    const pin = { id: "a", x: 100, y: 100, full: true };
    const tag = { w: 60, h: 20 };
    const bounds = { w: 400, h: 400 };
    expect(tagSide(pin, tag, [], bounds)).toBe("below");
    expect(tagSide(pin, tag, [{ l: 60, r: 140, t: 120, b: 160 }], bounds)).toBe(
      "right",
    );
    expect(tagSide({ ...pin, y: 390 }, tag, [], bounds)).toBe("right");
    expect(
      tagSide(
        pin,
        tag,
        [{ l: 0, r: 400, t: 0, b: 400 }], // nothing is free
        bounds,
      ),
    ).toBeNull();
  });

  it("builds the pin and job HTML safely", () => {
    const html = pinHtml(point({ initials: "<b>", name: 'Jo "Bo" & co' }), 44);
    expect(html).toContain("left:44px");
    expect(html).toContain('data-ring="0"');
    expect(html).toContain("&#60;b&#62;");
    expect(html).toContain("Jo &#34;Bo&#34; &#38; co");
    expect(html).toMatch(/--c:var\(--sys-[a-z]+\)/);
    expect(jobHtml({})).toContain('data-st="planned"');
    expect(jobHtml({ state: "done" })).toContain('data-st="done"');
  });

  it("names a pin for screen readers", () => {
    expect(pinLabel(point(), T0 + 4 * MIN)).toBe(
      "Jacob W., lockout, new, waiting 4 min. Open the lead card.",
    );
    expect(pinLabel(point(), T0 + 75 * MIN)).toContain("waiting 1 h 15 min");
    expect(pinLabel(point({ status: "qualified", service: null }), T0)).toBe(
      "Jacob W., qualified. Open the lead card.",
    );
  });
});

describe("coverage note", () => {
  it("says nothing when every open lead is on the map", () => {
    expect(coverageNote(undefined)).toBeNull();
    const none = { no_address: 0, no_property: 0, pending: 0, failed: 0 };
    expect(coverageNote({ total: 0, placed: 0, missing: none })).toBeNull();
    expect(coverageNote({ total: 3, placed: 3, missing: none })).toBeNull();
  });

  it("counts what's missing and why, in plain words", () => {
    expect(
      coverageNote({
        total: 6,
        placed: 4,
        missing: { no_address: 1, no_property: 0, pending: 1, failed: 0 },
      }),
    ).toEqual({
      title: "4 of 6 leads on the map",
      lines: ["1 has no address yet", "1 is still being placed on the map"],
    });
    // The fresh locksmith demo before the seed fix: 1 of 11.
    expect(
      coverageNote({
        total: 11,
        placed: 1,
        missing: { no_address: 0, no_property: 10, pending: 0, failed: 0 },
      }),
    ).toEqual({
      title: "1 of 11 leads on the map",
      lines: ["10 addresses aren't saved to a customer yet"],
    });
    expect(
      coverageNote({
        total: 2,
        placed: 0,
        missing: { no_address: 0, no_property: 0, pending: 0, failed: 2 },
      })?.lines,
    ).toEqual(["2 addresses weren't found on the map"]);
  });
});

describe("map-queries shaping", () => {
  const row = (o: Partial<LeadMapRow> = {}): LeadMapRow => ({
    id: "l1",
    status: "new",
    name: "Jacob Wilson",
    phone: "+15125550128",
    email: null,
    customer_id: "c1",
    property_id: "p1",
    created_at: new Date(T0),
    first_response_at: null,
    service_name: "Lockout",
    service_text: null,
    lat: 39.74,
    lng: -104.98,
    geocode_status: "ok",
    has_address: true,
    ...o,
  });
  const nowhere = { lat: null, lng: null };

  it("keeps the leads with a position and says why the others have none", () => {
    expect(missingReason(row())).toBeNull();
    expect(
      missingReason(row({ ...nowhere, property_id: null, customer_id: null })),
    ).toBe("no_property");
    expect(
      missingReason(row({ ...nowhere, property_id: null, has_address: false })),
    ).toBe("no_address");
    expect(missingReason(row({ ...nowhere, geocode_status: "pending" }))).toBe(
      "pending",
    );
    expect(missingReason(row({ ...nowhere, geocode_status: "failed" }))).toBe(
      "failed",
    );
    const { points, coverage } = shapeLeadPins([
      row(),
      row({ id: "l2", ...nowhere, property_id: null, customer_id: null }),
      row({ id: "l3", ...nowhere, property_id: null, has_address: false }),
      row({ id: "l4", ...nowhere, geocode_status: "pending" }),
      row({ id: "l5", ...nowhere, geocode_status: "failed" }),
      row({
        id: "l6",
        name: null,
        phone: "+15125550199",
        customer_id: null,
        lat: "39.70",
        lng: "-104.95",
        service_name: null,
        service_text: "Rekey 3 locks",
        status: "contacted",
        first_response_at: new Date(T0 + 3 * MIN),
      }),
    ]);
    expect(coverage).toEqual({
      total: 6,
      placed: 2,
      missing: { no_address: 1, no_property: 1, pending: 1, failed: 1 },
    });
    expect(points[0]).toEqual({
      id: "l1",
      lat: 39.74,
      lng: -104.98,
      initials: "JW",
      status: "new",
      slaStart: iso(T0),
      respondedAt: null,
      name: "Jacob W.",
      seed: "c1",
      service: "Lockout",
    });
    // No name: the phone stands in (the box's rule); the color seed is the lead.
    expect(points[1]).toMatchObject({
      id: "l6",
      lat: 39.7,
      lng: -104.95,
      initials: "#",
      seed: "l6",
      service: "Rekey 3 locks",
      status: "contacted",
      respondedAt: iso(T0 + 3 * MIN),
    });
    expect(points[1]?.name).toMatch(/555-0199/);
  });

  const job = (o: Partial<JobMapRow> = {}): JobMapRow => ({
    id: "j1",
    number: "J-1042",
    title: "Front door",
    status: "scheduled",
    service_name: "Lockout",
    // 9–11 AM in Denver (MDT, UTC−6).
    window_start: new Date("2026-10-22T15:00:00Z"),
    window_end: new Date("2026-10-22T17:00:00Z"),
    scheduled_start: null,
    scheduled_end: null,
    en_route_at: null,
    completed_at: null,
    lat: 39.7,
    lng: -104.9,
    assignees: "tech-1,tech-2",
    ...o,
  });
  const office = {
    id: "office-1",
    perms: new Set(["leads.view", "jobs.view_all", "customers.contact_view"]),
  };
  const tz = "America/Denver";
  const flat = (s: string) => s.replace(/\s+/g, " ");

  it("labels today's jobs and marks their state", () => {
    const out = shapeJobMarkers(
      [
        job(),
        job({
          id: "j2",
          number: "J-1043",
          status: "in_progress",
          service_name: null,
          window_start: null,
          window_end: null,
          scheduled_start: new Date("2026-10-22T19:30:00Z"),
          scheduled_end: new Date("2026-10-22T21:00:00Z"),
        }),
        job({ id: "j3", status: "completed" }),
        job({ id: "j4", lat: null as never }),
      ],
      office,
      tz,
      new Date("2026-10-22T14:00:00Z"),
    );
    expect(out.map((j) => j.id)).toEqual(["j1", "j2", "j3"]);
    expect(flat(out[0]?.label ?? "")).toBe("J-1042 · Lockout · 9 – 11 AM");
    expect(out[0]?.state).toBe("planned");
    expect(flat(out[1]?.label ?? "")).toBe("J-1043 · Front door · 1:30 – 3 PM");
    expect(out[1]?.state).toBe("live");
    expect(out[2]?.state).toBe("done");
  });

  it("leaves out jobs whose exact place the viewer may not see yet", () => {
    const tech = { id: "tech-1", perms: new Set(["leads.view"]) };
    const other = { id: "tech-9", perms: new Set(["leads.view"]) };
    // An hour before the window: inside the assignee's contact window.
    const soon = new Date("2026-10-22T14:00:00Z");
    // Five hours before: outside it.
    const early = new Date("2026-10-22T10:00:00Z");
    expect(shapeJobMarkers([job()], tech, tz, soon)).toHaveLength(1);
    expect(shapeJobMarkers([job()], tech, tz, early)).toHaveLength(0);
    expect(shapeJobMarkers([job()], other, tz, soon)).toHaveLength(0);
    expect(shapeJobMarkers([job()], office, tz, early)).toHaveLength(1);
  });
});

describe("shared lead helpers", () => {
  it("makes the box's initials", () => {
    expect(initialsOf("Jacob Wilson")).toBe("JW");
    expect(initialsOf("ana maría lópez")).toBe("AL");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("(512) 555-0128")).toBe("#");
    expect(initialsOf("")).toBe("?");
  });

  it("gives a box's pin the avatar's color seed", () => {
    const box = {
      id: "l1",
      lat: 39.7,
      lng: -104.9,
      initials: "JW",
      status: "new",
      slaStart: iso(T0),
      respondedAt: null,
      shortName: "Jacob W.",
      customerId: "c1",
    } as unknown as LeadBoxData;
    expect(toMapPoint(box)?.seed).toBe("c1");
    expect(toMapPoint({ ...box, customerId: null })?.seed).toBe("l1");
  });
});

describe("demo walk-ins on the map", () => {
  const metro = {
    zips: [{ zip: "80205", lat: 39.7589, lng: -104.9665 }, { zip: "80207" }],
    box: { lat: 39.6, lng: -105.1, span: 0.3 },
  };

  it("sits near its ZIP area's center, a little apart per lead", () => {
    const a = walkInSpot(metro, "80205", 9);
    const b = walkInSpot(metro, "80205", 10);
    expect(walkInSpot(metro, "80205", 9)).toEqual(a);
    expect(a).not.toEqual(b);
    for (const p of [a, b]) {
      expect(Math.abs(p.lat - 39.7589)).toBeLessThanOrEqual(0.0121);
      expect(Math.abs(p.lng - -104.9665)).toBeLessThanOrEqual(0.016);
      expect(Math.hypot(p.lat - 39.7589, p.lng + 104.9665)).toBeGreaterThan(
        0.003,
      );
    }
  });

  it("falls back to a fixed spot inside the metro box", () => {
    for (const zip of ["80207", "99999"]) {
      const p = walkInSpot(metro, zip, 12);
      expect(p.lat).toBeGreaterThanOrEqual(39.6 + 0.15 * 0.3 - 1e-9);
      expect(p.lat).toBeLessThanOrEqual(39.6 + 0.85 * 0.3 + 1e-9);
      expect(p.lng).toBeGreaterThanOrEqual(-105.1 + 0.15 * 0.3 - 1e-9);
      expect(p.lng).toBeLessThanOrEqual(-105.1 + 0.85 * 0.3 + 1e-9);
    }
  });
});
