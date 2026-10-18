// B2 status machine, guards and scheduling helpers (BUILD_PLAN §9 B2 tests):
// transition table (allowed + forbidden), guard outcomes, override, contact window,
// recurrence, cancellation fee, windows, splits.
import { describe, expect, it } from "vitest";
import { splitFor } from "@/features/jobs/components/split";
import type { JobStatus } from "@/features/jobs/contracts";
import {
  buildWindow,
  cancellationFee,
  canTransition,
  contactWindow,
  distanceMeters,
  evaluateTransition,
  type GuardInput,
  isAfterArrival,
  isAnswered,
  JOB_STATUS_ORDER,
  nextRecurrenceDate,
  openChecklist,
  rangesOverlap,
  TRANSITIONS,
  travelMinutes,
} from "@/features/jobs/machine";

const tech = {
  isAssignee: true,
  statusOwn: true,
  statusAny: false,
  cancel: false,
  cancelAfterArrival: true,
  reopen: false,
  override: false,
};
const office = {
  isAssignee: false,
  statusOwn: true,
  statusAny: true,
  cancel: true,
  cancelAfterArrival: false,
  reopen: false,
  override: false,
};
const admin = {
  ...office,
  cancelAfterArrival: true,
  reopen: true,
  override: true,
};
const job = { hasWindow: true, assigneeCount: 1, arrivedAt: null };

function g(
  over: Partial<GuardInput> & Pick<GuardInput, "from" | "to">,
): GuardInput {
  return { actor: tech, job, settings: { arrivalRadiusM: 300 }, ...over };
}

describe("transition table", () => {
  const allowed: [JobStatus, JobStatus][] = [
    ["unscheduled", "scheduled"],
    ["scheduled", "confirmed"],
    ["scheduled", "en_route"],
    ["scheduled", "arrived"],
    ["confirmed", "en_route"],
    ["en_route", "arrived"],
    ["arrived", "in_progress"],
    ["arrived", "on_hold"],
    ["in_progress", "completed"],
    ["in_progress", "on_hold"],
    ["on_hold", "in_progress"],
    ["on_hold", "scheduled"],
    ["completed", "closed"],
    ["completed", "in_progress"],
    ["closed", "in_progress"],
    ["scheduled", "cancelled"],
    ["in_progress", "cancelled"],
  ];
  const forbidden: [JobStatus, JobStatus][] = [
    ["unscheduled", "en_route"],
    ["unscheduled", "completed"],
    ["scheduled", "completed"],
    ["en_route", "completed"],
    ["en_route", "scheduled"],
    ["arrived", "completed"],
    ["completed", "cancelled"],
    ["closed", "cancelled"],
    ["cancelled", "scheduled"],
    ["cancelled", "in_progress"],
  ];
  it.each(allowed)("%s → %s is allowed", (a, b) =>
    expect(canTransition(a, b)).toBe(true));
  it.each(forbidden)("%s → %s is forbidden", (a, b) =>
    expect(canTransition(a, b)).toBe(false));
  it("covers every status and cancelled is terminal", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(
      [...JOB_STATUS_ORDER].sort(),
    );
    expect(TRANSITIONS.cancelled).toEqual([]);
  });
  it("invalid edges fail with invalid_transition", () => {
    const r = evaluateTransition(g({ from: "scheduled", to: "completed" }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.key).toBe("invalid_transition");
  });
});

describe("guards", () => {
  it("only an assignee (or status_any) can head out", () => {
    expect(
      evaluateTransition(g({ from: "scheduled", to: "en_route" })).ok,
    ).toBe(true);
    const notMine = evaluateTransition(
      g({
        from: "scheduled",
        to: "en_route",
        actor: { ...tech, isAssignee: false },
      }),
    );
    expect(notMine.errors[0]?.key).toBe("assignee_only");
    expect(
      evaluateTransition(
        g({ from: "scheduled", to: "en_route", actor: office }),
      ).ok,
    ).toBe(true);
  });

  it("arrival never blocks: no geo and far away are flags + warnings", () => {
    const noGeo = evaluateTransition(g({ from: "en_route", to: "arrived" }));
    expect(noGeo.ok).toBe(true);
    expect(noGeo.flags).toContain("no_geo");
    const far = evaluateTransition(
      g({
        from: "en_route",
        to: "arrived",
        input: { hasGeo: true, distanceM: 1200 },
      }),
    );
    expect(far.ok).toBe(true);
    expect(far.flags).toContain("far_from_property");
    expect(far.warnings[0]).toMatch(/from the property/);
    const near = evaluateTransition(
      g({
        from: "en_route",
        to: "arrived",
        input: { hasGeo: true, distanceM: 80 },
      }),
    );
    expect(near.flags).toEqual([]);
  });

  it("scheduling needs a window and an assignee", () => {
    const r = evaluateTransition(
      g({
        from: "unscheduled",
        to: "scheduled",
        actor: office,
        job: { ...job, hasWindow: false, assigneeCount: 0 },
      }),
    );
    expect(r.errors.map((e) => e.key).sort()).toEqual([
      "assignee_required",
      "window_required",
    ]);
  });

  it("a return visit (on_hold → scheduled) needs a new window", () => {
    expect(
      evaluateTransition(g({ from: "on_hold", to: "scheduled" })).errors[0]
        ?.key,
    ).toBe("window_required");
    expect(
      evaluateTransition(
        g({ from: "on_hold", to: "scheduled", input: { hasNewWindow: true } }),
      ).ok,
    ).toBe(true);
  });

  it("start is blocked by ownership-check items and B4 controls", () => {
    const r = evaluateTransition(
      g({
        from: "arrived",
        to: "in_progress",
        ownershipOpen: ["Photo of customer ID"],
        controls: [
          {
            key: "signed_estimate",
            label: "Signed estimate",
            overridable: true,
            action: "sign_estimate",
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.missing.map((m) => m.key)).toEqual([
      "ownership_check",
      "signed_estimate",
    ]);
  });

  it("resuming from hold skips start requirements", () => {
    const r = evaluateTransition(
      g({
        from: "on_hold",
        to: "in_progress",
        ownershipOpen: ["ID"],
        controls: [{ key: "x", label: "x", overridable: true }],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("complete is blocked by required checklist items", () => {
    const r = evaluateTransition(
      g({
        from: "in_progress",
        to: "completed",
        checklistOpen: ["Test the lock"],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toMatchObject({ key: "checklist", overridable: true });
  });

  it("override needs the permission and a reason; non-overridable misses still block", () => {
    const base = {
      from: "in_progress" as const,
      to: "completed" as const,
      checklistOpen: ["Test the lock"],
    };
    const noPerm = evaluateTransition(
      g({ ...base, input: { overrideReason: "Customer left" } }),
    );
    expect(noPerm.errors[0]?.key).toBe("forbidden");
    const ok = evaluateTransition(
      g({
        ...base,
        actor: { ...admin, isAssignee: true },
        input: { overrideReason: "Customer left" },
      }),
    );
    expect(ok.ok).toBe(true);
    expect(ok.flags).toContain("override");
    const noReason = evaluateTransition(
      g({ ...base, actor: admin, input: { overrideReason: "  " } }),
    );
    expect(noReason.ok).toBe(false);
    const hardMiss = evaluateTransition(
      g({
        ...base,
        actor: admin,
        controls: [{ key: "prepay", label: "Prepay", overridable: false }],
        input: { overrideReason: "x" },
      }),
    );
    expect(hardMiss.ok).toBe(false);
  });

  it("hold needs a reason", () => {
    expect(
      evaluateTransition(g({ from: "in_progress", to: "on_hold" })).errors[0]
        ?.key,
    ).toBe("reason_required");
    expect(
      evaluateTransition(
        g({
          from: "in_progress",
          to: "on_hold",
          input: { reason: "waiting_parts" },
        }),
      ).ok,
    ).toBe(true);
  });

  it("cancel before arrival needs jobs.cancel + reason", () => {
    expect(
      evaluateTransition(
        g({ from: "scheduled", to: "cancelled", input: { reason: "price" } }),
      ).errors[0]?.key,
    ).toBe("forbidden");
    expect(
      evaluateTransition(
        g({
          from: "scheduled",
          to: "cancelled",
          actor: office,
          input: { reason: "price" },
        }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateTransition(
        g({ from: "scheduled", to: "cancelled", actor: office }),
      ).errors[0]?.key,
    ).toBe("reason_required");
  });

  it("cancel after arrival needs the perm, a note and a photo", () => {
    const after = {
      from: "arrived" as const,
      to: "cancelled" as const,
      job: { ...job, arrivedAt: new Date() },
    };
    const missing = evaluateTransition(
      g({ ...after, input: { reason: "no_access" } }),
    );
    expect(missing.errors.map((e) => e.key).sort()).toEqual([
      "note_required",
      "photo_required",
    ]);
    expect(
      evaluateTransition(
        g({
          ...after,
          input: { reason: "no_access", note: "Gate locked", photoCount: 1 },
        }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateTransition(
        g({
          ...after,
          actor: office,
          input: { reason: "no_access", note: "x", photoCount: 1 },
        }),
      ).errors[0]?.key,
    ).toBe("forbidden");
  });

  it("reopen needs jobs.reopen and a reason", () => {
    expect(
      evaluateTransition(
        g({
          from: "completed",
          to: "in_progress",
          actor: office,
          input: { reason: "x" },
        }),
      ).errors[0]?.key,
    ).toBe("forbidden");
    expect(
      evaluateTransition(g({ from: "closed", to: "in_progress", actor: admin }))
        .errors[0]?.key,
    ).toBe("reason_required");
    expect(
      evaluateTransition(
        g({
          from: "closed",
          to: "in_progress",
          actor: admin,
          input: { reason: "Wrong part" },
        }),
      ).ok,
    ).toBe(true);
  });

  it("isAfterArrival covers arrived, in progress and holds after arrival", () => {
    expect(isAfterArrival({ status: "arrived", arrivedAt: null })).toBe(true);
    expect(isAfterArrival({ status: "on_hold", arrivedAt: new Date() })).toBe(
      true,
    );
    expect(isAfterArrival({ status: "on_hold", arrivedAt: null })).toBe(false);
    expect(isAfterArrival({ status: "en_route", arrivedAt: null })).toBe(false);
  });
});

describe("checklist", () => {
  it("answers and open required/ownership items", () => {
    expect(
      isAnswered({ id: "a", label: "A", type: "check", answer: false }),
    ).toBe(false);
    expect(
      isAnswered({ id: "a", label: "A", type: "check", answer: true }),
    ).toBe(true);
    expect(
      isAnswered({ id: "a", label: "A", type: "text", answer: "  " }),
    ).toBe(false);
    expect(isAnswered({ id: "a", label: "A", type: "number", answer: 0 })).toBe(
      true,
    );
    const r = openChecklist([
      { id: "own:id", label: "ID photo", type: "photo", required: false },
      { id: "t1", label: "Test", type: "check", required: true },
      { id: "t2", label: "Optional", type: "check", required: false },
      { id: "t3", label: "Done", type: "check", required: true, answer: true },
    ]);
    expect(r).toEqual({ required: ["Test"], ownership: ["ID photo"] });
  });
});

describe("contact window (SPEC §4.2)", () => {
  const start = new Date("2026-10-15T15:00:00Z");
  it("opens 2 h before the start and closes 24 h after completion", () => {
    const w = contactWindow({
      status: "completed",
      scheduledStart: start,
      windowStart: start,
      enRouteAt: null,
      completedAt: new Date("2026-10-15T17:00:00Z"),
    });
    expect(w?.from.toISOString()).toBe("2026-10-15T13:00:00.000Z");
    expect(w?.until.toISOString()).toBe("2026-10-16T17:00:00.000Z");
  });
  it("opens at en route when that is earlier", () => {
    const w = contactWindow({
      status: "en_route",
      scheduledStart: start,
      windowStart: start,
      enRouteAt: new Date("2026-10-15T12:00:00Z"),
      completedAt: null,
    });
    expect(w?.from.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(w && w.until.getTime() > Date.now()).toBe(true);
  });
  it("is closed for cancelled or unscheduled jobs", () => {
    expect(
      contactWindow({
        status: "cancelled",
        scheduledStart: start,
        windowStart: start,
        enRouteAt: null,
        completedAt: null,
      }),
    ).toBeNull();
    expect(
      contactWindow({
        status: "unscheduled",
        scheduledStart: null,
        windowStart: null,
        enRouteAt: null,
        completedAt: null,
      }),
    ).toBeNull();
  });
});

describe("recurrence next date", () => {
  it("adds weeks", () =>
    expect(nextRecurrenceDate("2026-10-15", { every: "weeks", n: 2 })).toBe(
      "2026-10-29",
    ));
  it("adds months and clamps to month end", () => {
    expect(nextRecurrenceDate("2026-01-31", { every: "months", n: 1 })).toBe(
      "2026-02-28",
    );
    expect(nextRecurrenceDate("2028-01-31", { every: "months", n: 1 })).toBe(
      "2028-02-29",
    );
    expect(nextRecurrenceDate("2026-10-15", { every: "months", n: 6 })).toBe(
      "2027-04-15",
    );
    expect(nextRecurrenceDate("2026-11-30", { every: "months", n: 3 })).toBe(
      "2027-02-28",
    );
  });
  it("stops after until and rejects bad input", () => {
    expect(
      nextRecurrenceDate("2026-10-15", {
        every: "months",
        n: 1,
        until: "2026-11-01",
      }),
    ).toBeNull();
    expect(
      nextRecurrenceDate("2026-10-15", {
        every: "months",
        n: 1,
        until: "2026-11-15",
      }),
    ).toBe("2026-11-15");
    expect(nextRecurrenceDate("nope", { every: "weeks", n: 1 })).toBeNull();
    expect(
      nextRecurrenceDate("2026-10-15", { every: "weeks", n: 0 }),
    ).toBeNull();
  });
});

describe("cancellation fee", () => {
  const policy = {
    late_cancel_hours: 24,
    late_cancel_fee_cents: 4900,
    no_show_fee_cents: 7500,
  };
  const ws = new Date("2026-10-16T15:00:00Z");
  it("charges a no-show", () =>
    expect(
      cancellationFee({
        reason: "customer_no_show",
        windowStart: ws,
        at: ws,
        policy,
      }),
    ).toEqual({ kind: "no_show", cents: 7500 }));
  it("charges a late customer cancellation only inside the window", () => {
    expect(
      cancellationFee({
        reason: "customer_cancelled",
        windowStart: ws,
        at: new Date("2026-10-16T01:00:00Z"),
        policy,
      }),
    ).toEqual({ kind: "late_cancel", cents: 4900 });
    expect(
      cancellationFee({
        reason: "customer_cancelled",
        windowStart: ws,
        at: new Date("2026-10-14T15:00:00Z"),
        policy,
      }),
    ).toBeNull();
  });
  it("never charges for other reasons or a zero policy", () => {
    expect(
      cancellationFee({ reason: "weather", windowStart: ws, at: ws, policy }),
    ).toBeNull();
    expect(
      cancellationFee({
        reason: "customer_no_show",
        windowStart: ws,
        at: ws,
        policy: { ...policy, no_show_fee_cents: 0 },
      }),
    ).toBeNull();
  });
});

describe("windows, distance, splits", () => {
  it("builds a window in the company zone (DST-aware)", () => {
    const w = buildWindow("2026-10-15", "09:00", 120, "America/Chicago");
    expect(w.start.toISOString()).toBe("2026-10-15T14:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-15T16:00:00.000Z");
    expect(
      buildWindow(
        "2026-12-15",
        "09:00",
        60,
        "America/Chicago",
      ).start.toISOString(),
    ).toBe("2026-12-15T15:00:00.000Z");
    expect(() =>
      buildWindow("2026-10-15", "9am", 60, "America/Chicago"),
    ).toThrow();
  });
  it("overlap and travel estimates", () => {
    const a = { start: new Date(0), end: new Date(3600_000) };
    expect(
      rangesOverlap(a, { start: new Date(1800_000), end: new Date(5400_000) }),
    ).toBe(true);
    expect(
      rangesOverlap(a, { start: new Date(3600_000), end: new Date(7200_000) }),
    ).toBe(false);
    const austin = { lat: 30.2672, lng: -97.7431 };
    const roundRock = { lat: 30.5083, lng: -97.6789 };
    expect(Math.round(distanceMeters(austin, roundRock) / 1000)).toBe(28);
    expect(travelMinutes(austin, roundRock)).toBe(34);
  });
  it("splits commission: primary share, helpers share the rest", () => {
    expect(splitFor([], 50)).toEqual([]);
    expect(splitFor([{ userId: "a", role: "helper" }], 30)).toEqual([
      { userId: "a", role: "primary", splitBps: 10000 },
    ]);
    const three = splitFor(
      [
        { userId: "a", role: "helper" },
        { userId: "b", role: "primary" },
        { userId: "c", role: "helper" },
      ],
      55,
    );
    expect(three[0]).toEqual({ userId: "b", role: "primary", splitBps: 5500 });
    expect(three.reduce((s, x) => s + x.splitBps, 0)).toBe(10000);
    expect(three.map((x) => x.splitBps)).toEqual([5500, 2250, 2250]);
  });
});
