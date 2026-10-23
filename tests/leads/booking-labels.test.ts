// The booking flow's words and picks (Who → What → When → Done): arrival windows,
// day labels, day reasons, the preselected day and window, the Done screen's
// confirmation line, and the job type choice behind the cards and chips.
import { describe, expect, it } from "vitest";
import type {
  DayAvailability,
  WindowSlot,
} from "@/features/jobs/availability/types";
import {
  choiceLabel,
  type JobTypeRow,
  kindDuration,
  kindPrice,
  OTHER_JOB,
  serviceTypeFor,
  typeFor,
  valueFromType,
  visitLength,
} from "@/features/jobs/components/job-type-choice";
import { KIND_LABEL } from "@/features/jobs/kinds";
import {
  arrivalLabel,
  barWhen,
  bestWindowStart,
  bookedTitle,
  confirmationLabel,
  dayLabel,
  dayReason,
  nextOpenDay,
  pickInitialDay,
  reasonText,
  requestedDay,
  requestedLabel,
  stripDay,
  windowNote,
} from "@/features/leads/booking-labels";
import type { BookingDone } from "@/features/leads/booking-queries";

const TODAY = "2026-10-22"; // a Thursday

describe("arrival windows", () => {
  it("reads like 'Arrives 8–10 AM': one AM/PM when both ends share it", () => {
    expect(arrivalLabel("08:00", "10:00")).toBe("8–10 AM");
    expect(arrivalLabel("10:00", "12:00")).toBe("10 AM–12 PM");
    expect(arrivalLabel("12:00", "14:00")).toBe("12–2 PM");
    expect(arrivalLabel("11:00", "13:00")).toBe("11 AM–1 PM");
    expect(arrivalLabel("16:30", "18:00")).toBe("4:30–6 PM");
  });
  it("titles the Done screen", () => {
    expect(bookedTitle("2026-10-23", "08:00", "10:00")).toBe(
      "Booked: arrives Fri, Oct 23 · 8–10 AM",
    );
    expect(dayLabel("2026-10-26")).toBe("Mon, Oct 26");
  });
  it("names the day in the booking bar", () => {
    const w = { start: "08:00", end: "10:00" };
    expect(barWhen(TODAY, TODAY, w)).toBe("Today · arrives 8–10 AM");
    expect(barWhen("2026-10-23", TODAY, w)).toBe("Tomorrow · arrives 8–10 AM");
    expect(barWhen("2026-10-26", TODAY, w)).toBe("Mon · arrives 8–10 AM");
    expect(barWhen("2026-10-26", TODAY)).toBe("Mon");
  });
  it("labels the week strip", () => {
    expect(stripDay(TODAY, TODAY)).toMatchObject({ weekday: "Today", day: 22 });
    expect(stripDay("2026-10-23", TODAY)).toMatchObject({
      weekday: "Fri",
      day: 23,
      spoken: "Friday, October 23",
    });
  });
});

describe("the day they asked for", () => {
  it("says today, tomorrow, a weekday within the week, else the date", () => {
    expect(requestedLabel(TODAY, null, TODAY)).toBe("asked for today");
    expect(requestedLabel("2026-10-23", null, TODAY)).toBe(
      "asked for tomorrow",
    );
    expect(requestedLabel("2026-10-27", "Morning", TODAY)).toBe(
      "asked for Tuesday · Morning",
    );
    expect(requestedDay("2026-11-06", null, TODAY)).toBe("Fri, Nov 6");
    expect(requestedLabel(null, " ", TODAY)).toBeNull();
    expect(requestedLabel(null, "Evenings", TODAY)).toBe("asked for Evenings");
  });
});

const slot = (
  start: string,
  end: string,
  open: boolean,
  miles?: number,
): WindowSlot => ({
  start,
  end,
  status: open ? "open" : "full",
  ...(open
    ? {
        suggested: {
          techId: "t",
          name: "Derek Novak",
          color: "#0a84ff",
          avatarUrl: null,
          extraMiles: miles ?? null,
          reasons: [],
        },
      }
    : {}),
  alternatives: [],
});
const dayOf = (
  date: string,
  status: DayAvailability["status"],
  openings: number,
  reason?: string,
): DayAvailability =>
  ({
    date,
    status,
    openings,
    windows: [],
    ...(reason ? { reason } : {}),
  }) as DayAvailability;

describe("windows and days", () => {
  it("calls the open window with the least extra driving Best", () => {
    const ws = [
      slot("08:00", "10:00", true, 4.2),
      slot("10:00", "12:00", true, 1.6),
      slot("12:00", "14:00", false),
      slot("14:00", "16:00", true),
    ];
    expect(bestWindowStart(ws)).toBe("10:00");
    expect(windowNote(ws[1] as WindowSlot, "10:00")).toBe("Best · adds 2 mi");
    expect(windowNote(ws[0] as WindowSlot, "10:00")).toBe("Open");
    expect(windowNote(ws[2] as WindowSlot, "10:00")).toBe("Full");
    expect(bestWindowStart([slot("08:00", "10:00", false)])).toBeNull();
    expect(windowNote(slot("08:00", "10:00", true, 0.4), "08:00")).toBe(
      "Best · adds <1 mi",
    );
  });
  it("says why a window is out, and when the after-hours price applies", () => {
    const far: WindowSlot = { ...slot("08:00", "10:00", false), reason: "far" };
    const closed: WindowSlot = {
      ...slot("08:00", "10:00", false),
      reason: "closed",
    };
    expect(windowNote(far, null)).toBe("Too far");
    expect(windowNote(closed, null)).toBe("Closed");
    const evening: WindowSlot = {
      ...slot("18:00", "20:00", true, 3),
      afterHours: true,
    };
    expect(windowNote(evening, "18:00")).toBe("Best · adds 3 mi · after hours");
    expect(windowNote(evening, null)).toBe("Open · after hours");
  });
  it("preselects the asked-for day, else the best, else the first open day", () => {
    const days = [
      dayOf("2026-10-22", "limited", 1),
      dayOf("2026-10-23", "full", 0, "full"),
      dayOf("2026-10-26", "best", 3),
      dayOf("2026-10-27", "open", 4),
    ];
    expect(pickInitialDay(days, "2026-10-23")).toBe("2026-10-23");
    expect(pickInitialDay(days, "2026-12-01")).toBe("2026-10-26");
    expect(pickInitialDay(days, null)).toBe("2026-10-26");
    expect(
      pickInitialDay(
        [dayOf("2026-10-22", "full", 0), dayOf("2026-10-23", "open", 2)],
        null,
      ),
    ).toBe("2026-10-23");
    expect(nextOpenDay(days, "2026-10-23")).toBe("2026-10-26");
    expect(nextOpenDay(days, "2026-10-27")).toBeNull();
  });
  it("reads the engine's day reason and says it plainly", () => {
    expect(dayReason(dayOf("2026-10-25", "full", 0, "closed"))).toBe("closed");
    expect(dayReason(dayOf("2026-10-25", "full", 0))).toBeNull();
    expect(reasonText("closed").title).toBe("Closed this day");
    expect(reasonText("outside_area", { zip: "80301" }).body).toContain(
      "ZIP 80301",
    );
    expect(reasonText("far", { maxMiles: 25 }).body).toContain(
      "more than 25 extra miles",
    );
    expect(reasonText("full").title).toBe("Fully booked");
  });
});

const base: BookingDone = {
  jobId: "j",
  number: "J-1",
  leadId: "l",
  customerId: "c",
  customerName: "Dana",
  serviceName: "Rekey",
  date: "2026-10-22",
  start: "10:00",
  end: "12:00",
  techName: "Ben Carter",
  confirmation: null,
  ageSec: 2,
};
const withMsg = (
  status: string,
  reason: string | null = null,
  channel = "sms",
) =>
  confirmationLabel({ ...base, confirmation: { status, channel, reason } })
    .text;

describe("confirmationLabel", () => {
  it("a booking has no tech yet: the confirmation waits for one, plainly", () => {
    expect(confirmationLabel({ ...base, techName: null })).toEqual({
      text: "Confirmation goes out when a tech is assigned",
      tone: "yellow",
      settled: true,
    });
  });
  it("with a tech it waits briefly, then says nothing was sent", () => {
    expect(confirmationLabel(base)).toMatchObject({ settled: false });
    expect(confirmationLabel({ ...base, ageSec: 60 }).text).toBe(
      "No confirmation sent",
    );
  });
  it("maps the scheduled_messages outcome", () => {
    expect(withMsg("pending_tap")).toBe(
      "Confirmation text queued in the outbox",
    );
    expect(withMsg("sent", null, "email")).toBe("Confirmation email sent");
    expect(withMsg("skipped", "no_consent_transactional")).toBe(
      "Not sent: no SMS consent",
    );
    expect(withMsg("suppressed_optout", "opted_out")).toMatch(/opted out/);
    expect(withMsg("deferred_quiet", "quiet_hours")).toMatch(/quiet hours/);
  });
});

const row = (
  id: string,
  name: string,
  kind: JobTypeRow["kind"],
  extra: Partial<JobTypeRow> = {},
): JobTypeRow => ({
  id,
  name,
  kind,
  defaultDurationMin: 60,
  defaultPriceCents: null,
  requiresOwnershipCheck: false,
  ...extra,
});
const TYPES: JobTypeRow[] = [
  row("est", "Free estimate", "estimate", { defaultDurationMin: 45 }),
  row("svc", "Service call", "service", { defaultDurationMin: 90 }),
  row("prj", "Project", "project", { defaultDurationMin: 240 }),
  row("lock", "Lockout", "service", {
    defaultDurationMin: 45,
    defaultPriceCents: 12_500,
    requiresOwnershipCheck: true,
  }),
  row("rekey", "Rekey", "service"),
  row("safe", "Safe opening", "service", { defaultPriceCents: 27_500 }),
  row("mks", "Master key system", "project", { defaultDurationMin: 480 }),
];

describe("job type choice (cards + What's the job? chips)", () => {
  it("books the chip, else the card's own row", () => {
    expect(serviceTypeFor(TYPES, { kind: "service", job: "rekey" })).toBe(
      "rekey",
    );
    expect(serviceTypeFor(TYPES, { kind: "service", job: null })).toBe("svc");
    expect(serviceTypeFor(TYPES, { kind: "service", job: OTHER_JOB })).toBe(
      "svc",
    );
    expect(serviceTypeFor(TYPES, { kind: "project", job: "gone" })).toBe("prj");
    expect(serviceTypeFor(TYPES, { kind: null, job: null })).toBeNull();
    expect(typeFor(TYPES, { kind: "service", job: "lock" })).toMatchObject({
      requiresOwnershipCheck: true,
    });
  });
  it("reopens a saved type on its card and chip", () => {
    expect(valueFromType(TYPES, "lock")).toEqual({
      kind: "service",
      job: "lock",
    });
    expect(valueFromType(TYPES, "est")).toEqual({
      kind: "estimate",
      job: null,
    });
    expect(
      valueFromType(TYPES, "svc", null, "Garage door won't close"),
    ).toEqual({ kind: "service", job: OTHER_JOB });
    expect(valueFromType(TYPES, null, "project")).toEqual({
      kind: "project",
      job: null,
    });
    expect(valueFromType(TYPES, null)).toEqual({ kind: null, job: null });
  });
  it("prices and times the cards", () => {
    expect(kindPrice("estimate", TYPES)).toBe("Free");
    expect(kindPrice("service", TYPES)).toBe("From $125");
    expect(kindPrice("project", TYPES)).toBe("Quote");
    expect(kindPrice("service", [row("svc", "Service call", "service")])).toBe(
      null,
    );
    expect(kindDuration(TYPES, "estimate")).toBe(45);
    expect(kindDuration(TYPES, "project", "mks")).toBe(480);
    expect(kindDuration(TYPES, "service", "lock")).toBe(45);
    expect(kindDuration([], "project")).toBe(240);
    expect(visitLength(45)).toBe("45 min");
    expect(visitLength(90)).toBe("90 min");
    expect(visitLength(240)).toBe("4 h");
    expect(visitLength(150)).toBe("2 h 30 min");
  });
  it("names the choice for the booking bar", () => {
    const label = (k: keyof typeof KIND_LABEL) => KIND_LABEL[k];
    expect(choiceLabel(TYPES, { kind: "service", job: "rekey" }, label)).toBe(
      "Service call · Rekey",
    );
    expect(choiceLabel(TYPES, { kind: "estimate", job: null }, label)).toBe(
      "Free estimate",
    );
    expect(choiceLabel(TYPES, { kind: null, job: null }, label)).toBe(
      "Pick a job type",
    );
  });
});
