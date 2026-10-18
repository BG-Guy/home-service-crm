// Anchor + delay math, the "already past" rules, dedupe keys (SPEC §7.2, M13).
import { describe, expect, it } from "vitest";
import {
  addMonthsInTz,
  computeSendAt,
  dedupeKeyFor,
  formatDelay,
  isWithinBusinessHours,
  parseAnchor,
  resolveSendTime,
} from "@/features/automations/schedule";
import { zonedParts } from "@/lib/time";

const CHI = "America/Chicago";
const windowStart = new Date("2026-10-20T15:00:00Z"); // Tue 10:00 CDT
const eventAt = new Date("2026-10-15T17:00:00Z"); // Thu 12:00 CDT

describe("computeSendAt", () => {
  it("negative delay from an anchor (24 h reminder)", () => {
    const r = computeSendAt({
      step: { anchor: "job.window_start", delay: { hours: -24 } },
      eventAt,
      anchors: { "job.window_start": windowStart },
      timeZone: CHI,
    });
    expect(r.sendAt?.toISOString()).toBe("2026-10-19T15:00:00.000Z");
  });

  it("day before at 09:00 local (unconfirmed flag)", () => {
    const r = computeSendAt({
      step: { anchor: "job.window_start", delay: { days: -1 }, at: "09:00" },
      eventAt,
      anchors: { "job.window_start": windowStart },
      timeZone: CHI,
    });
    const p = zonedParts(r.sendAt as Date, CHI);
    expect([p.month, p.day, p.hour, p.minute]).toEqual([10, 19, 9, 0]);
  });

  it("calendar days are DST-safe (+7 d across fall-back keeps 10:00)", () => {
    const done = new Date("2026-10-28T15:00:00Z"); // 10:00 CDT
    const r = computeSendAt({
      step: { anchor: "job.completed_at", delay: { days: 7 }, at: "10:00" },
      eventAt: done,
      anchors: { "job.completed_at": done },
      timeZone: CHI,
    });
    expect(r.sendAt?.toISOString()).toBe("2026-11-04T16:00:00.000Z"); // 10:00 CST
  });

  it("anchor fallback chain (invoice.due_at|event_time)", () => {
    const step = {
      anchor: "invoice.due_at|event_time",
      delay: { days: 3 },
      at: "10:00",
    };
    const withDue = computeSendAt({
      step,
      eventAt,
      anchors: { "invoice.due_at": new Date("2026-11-14T16:00:00Z") },
      timeZone: CHI,
    });
    expect(zonedParts(withDue.sendAt as Date, CHI).day).toBe(17);
    const noDue = computeSendAt({ step, eventAt, anchors: {}, timeZone: CHI });
    expect(zonedParts(noDue.sendAt as Date, CHI).day).toBe(18);
  });

  it("missing anchor → skip", () => {
    const r = computeSendAt({
      step: { anchor: "job.window_start", delay: { hours: -2 } },
      eventAt,
      anchors: {},
      timeZone: CHI,
    });
    expect(r).toEqual({ anchorAt: null, sendAt: null });
    expect(resolveSendTime(r, eventAt, 60)).toEqual({
      status: "skip",
      reason: "no_anchor",
    });
  });

  it("fixed_time_local: the next HH:MM after the event", () => {
    const r = computeSendAt({
      step: { anchor: "fixed_time_local 07:00" },
      eventAt, // 12:00 → tomorrow 07:00
      timeZone: CHI,
    });
    const p = zonedParts(r.sendAt as Date, CHI);
    expect([p.day, p.hour]).toEqual([16, 7]);
  });

  it("months (maintenance interval) clamp to month end", () => {
    const jan31 = new Date("2026-01-31T16:00:00Z");
    const p = zonedParts(addMonthsInTz(jan31, 1, CHI), CHI);
    expect([p.month, p.day]).toEqual([2, 28]);
    const r = computeSendAt({
      step: { at: "10:00" },
      months: 12,
      eventAt,
      timeZone: CHI,
    });
    const q = zonedParts(r.sendAt as Date, CHI);
    expect([q.year, q.month, q.day, q.hour]).toEqual([2027, 10, 15, 10]);
  });

  it("rejects unknown anchors", () => {
    expect(() => parseAnchor("job.whenever")).toThrow(RangeError);
  });
});

describe("resolveSendTime (§7.2 already-past rules)", () => {
  const anchorAt = new Date("2026-10-15T15:00:00Z");
  it("future → scheduled at send_at; expiry = send_at + expires_after", () => {
    const d = resolveSendTime(
      { anchorAt, sendAt: new Date("2026-10-15T13:00:00Z") },
      new Date("2026-10-15T12:00:00Z"),
      120,
    );
    expect(d).toMatchObject({ status: "scheduled" });
    if (d.status === "skip") return;
    expect(d.sendAt.toISOString()).toBe("2026-10-15T13:00:00.000Z");
    expect(d.expiresAt?.toISOString()).toBe("2026-10-15T15:00:00.000Z");
  });

  it("past, anchor passed less than expires_after ago → send now", () => {
    const now = new Date("2026-10-15T15:30:00Z");
    const d = resolveSendTime({ anchorAt, sendAt: anchorAt }, now, 60);
    expect(d.status).toBe("scheduled");
    if (d.status !== "skip") expect(d.sendAt).toEqual(now);
  });

  it("past anchor > expires_after → expired (never sent late)", () => {
    const now = new Date("2026-10-15T16:30:00Z");
    expect(
      resolveSendTime({ anchorAt, sendAt: anchorAt }, now, 60).status,
    ).toBe("expired");
  });

  it("no expiry → transactional sends go out immediately", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    expect(
      resolveSendTime({ anchorAt, sendAt: anchorAt }, now, null).status,
    ).toBe("scheduled");
  });
});

describe("dedupeKeyFor", () => {
  const base = {
    automationKey: "reminder_24h",
    entityId: "job-1",
    stepIndex: 0,
    recipient: "cust-1",
    channel: "sms",
    eventId: 41,
    now: new Date("2026-10-15T17:07:00Z"),
  };
  it("event-anchored steps: re-emitted events reuse the key", () => {
    const a = dedupeKeyFor({ ...base, step: {}, anchorAt: new Date(1) });
    const b = dedupeKeyFor({
      ...base,
      step: {},
      anchorAt: new Date(2),
      eventId: 99,
    });
    expect(a).toBe(b);
    expect(a).toBe("auto:reminder_24h:job-1:0:cust-1:sms");
  });
  it("field-anchored steps: a new anchor (reschedule) makes a new key", () => {
    const step = { anchor: "job.window_start" };
    const a = dedupeKeyFor({ ...base, step, anchorAt: windowStart });
    const b = dedupeKeyFor({
      ...base,
      step,
      anchorAt: new Date(windowStart.getTime() + 3600_000),
    });
    expect(a).not.toBe(b);
    expect(a).toMatch(/:a\d+$/);
  });
  it("event scope adds the event id; batch scope groups by window", () => {
    expect(
      dedupeKeyFor({ ...base, step: { dedupe: "event" }, anchorAt: null }),
    ).toMatch(/:e41$/);
    const k1 = dedupeKeyFor({
      ...base,
      step: { dedupe: "batch", batch_minutes: 15 },
      anchorAt: null,
    });
    const k2 = dedupeKeyFor({
      ...base,
      entityId: "job-2",
      step: { dedupe: "batch", batch_minutes: 15 },
      anchorAt: null,
      now: new Date("2026-10-15T17:14:00Z"),
    });
    expect(k1).toBe(k2);
  });
});

describe("misc", () => {
  it("formatDelay", () => {
    expect(formatDelay(undefined)).toBe("Immediately");
    expect(formatDelay({ hours: -24 })).toBe("−24 h");
    expect(formatDelay({ minutes: 90 })).toBe("+90 min");
    expect(formatDelay({ days: 2, hours: 3 })).toBe("+2 d 3 h");
  });
  it("business hours (lead ack after-hours switch)", () => {
    const hours = [1, 2, 3, 4, 5].map((day) => ({
      day,
      open: "08:00",
      close: "17:00",
    }));
    expect(
      isWithinBusinessHours(new Date("2026-10-15T17:00:00Z"), CHI, hours),
    ).toBe(true); // Thu 12:00
    expect(
      isWithinBusinessHours(new Date("2026-10-16T01:00:00Z"), CHI, hours),
    ).toBe(false); // Thu 20:00
    expect(
      isWithinBusinessHours(new Date("2026-10-17T17:00:00Z"), CHI, hours),
    ).toBe(false); // Sat
    expect(
      isWithinBusinessHours(new Date("2026-10-17T17:00:00Z"), CHI, []),
    ).toBe(true);
  });
});
