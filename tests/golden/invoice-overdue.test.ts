// ★ Golden tests: when an invoice is overdue (QA round 2, money fixer).
// One rule everywhere (detail, portal, list, badge, statement, insights, dunning): an
// invoice is due on its due date's calendar day in the COMPANY time zone ("Due
// today") and overdue only from the next local day. A "Due on receipt" invoice (due =
// issue time, the default terms) is never "PAST DUE" the moment it's issued.
import { describe, expect, it } from "vitest";
import {
  agingBucket,
  calendarDaysBetween,
  daysPastDue,
  dueDateFor,
  isDueToday,
  isOverdue,
  overdueCutoff,
} from "@/features/invoices/math";
import { zonedTimeToUtc } from "@/lib/time";

const TZ = "America/Chicago";
const local = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  zonedTimeToUtc({ year: y, month: mo, day: d, hour: h, minute: mi }, TZ);

describe("due on receipt (issued Sat Oct 17 2026, 3:12 PM Chicago)", () => {
  const issued = local(2026, 10, 17, 15, 12);
  const due = dueDateFor("due_on_receipt", issued);

  it("is due the moment it's issued, but not overdue", () => {
    expect(due.getTime()).toBe(issued.getTime());
    expect(isOverdue(due, issued, TZ)).toBe(false);
    expect(isDueToday(due, issued, TZ)).toBe(true);
    expect(daysPastDue(due, issued, TZ)).toBe(0);
  });

  it("is still not overdue at 11:59 PM the same local day (05:59 UTC next day)", () => {
    const late = local(2026, 10, 17, 23, 59);
    expect(late.toISOString()).toBe("2026-10-18T04:59:00.000Z");
    expect(isOverdue(due, late, TZ)).toBe(false);
    expect(isDueToday(due, late, TZ)).toBe(true);
  });

  it("is overdue from local midnight: 1 day past due on Oct 18, 3 on Oct 20", () => {
    const midnight = local(2026, 10, 18, 0, 0);
    expect(isOverdue(due, midnight, TZ)).toBe(true);
    expect(isDueToday(due, midnight, TZ)).toBe(false);
    expect(daysPastDue(due, midnight, TZ)).toBe(1);
    expect(daysPastDue(due, local(2026, 10, 20, 9), TZ)).toBe(3);
  });

  it("the SQL cutoff is local midnight today (due_at < cutoff ⇔ overdue)", () => {
    const now = local(2026, 10, 18, 8, 30);
    expect(overdueCutoff(now, TZ).getTime()).toBe(
      local(2026, 10, 18).getTime(),
    );
    expect(due < overdueCutoff(now, TZ)).toBe(isOverdue(due, now, TZ));
    expect(due < overdueCutoff(issued, TZ)).toBe(false);
  });
});

describe("net terms and edge cases", () => {
  it("net 15 issued Oct 1 → due Oct 16: due today on the 16th, overdue on the 17th", () => {
    const due = dueDateFor("net_15", local(2026, 10, 1, 10));
    expect(isOverdue(due, local(2026, 10, 16, 22), TZ)).toBe(false);
    expect(isDueToday(due, local(2026, 10, 16, 22), TZ)).toBe(true);
    expect(isOverdue(due, local(2026, 10, 17, 0, 1), TZ)).toBe(true);
  });

  it("uses the company's local date, not UTC (a UTC-evening due date)", () => {
    // 7 PM Chicago Oct 17 = 00:00 UTC Oct 18: still due on the 17th locally.
    const due = local(2026, 10, 17, 19);
    expect(due.toISOString()).toBe("2026-10-18T00:00:00.000Z");
    expect(isOverdue(due, local(2026, 10, 17, 23), TZ)).toBe(false);
    expect(daysPastDue(due, local(2026, 10, 18, 1), TZ)).toBe(1);
  });

  it("across the DST change (Nov 1 2026): calendar days, not 24 h blocks", () => {
    const due = local(2026, 10, 31, 23, 30);
    expect(calendarDaysBetween(due, local(2026, 11, 1, 23, 30), TZ)).toBe(1);
    expect(daysPastDue(due, local(2026, 11, 2, 0, 15), TZ)).toBe(2);
  });

  it("no due date → never overdue; aging by calendar days with a time zone", () => {
    expect(isOverdue(null, new Date(), TZ)).toBe(false);
    expect(daysPastDue(undefined, new Date(), TZ)).toBe(0);
    const due = local(2026, 9, 1, 18);
    expect(agingBucket(due, local(2026, 10, 1, 1), TZ)).toBe("0-30");
    expect(agingBucket(due, local(2026, 10, 2, 1), TZ)).toBe("31-60");
  });
});
