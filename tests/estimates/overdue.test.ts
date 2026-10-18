import { describe, expect, it } from "vitest";
import { calendarDaysBetween } from "@/features/invoices/cron";

describe("calendar days in the company zone", () => {
  it("counts local calendar days, not 24 h blocks", () => {
    // 11 PM Chicago on Oct 14 → 1 AM Chicago on Oct 15 is one calendar day
    expect(
      calendarDaysBetween(
        new Date("2026-10-15T04:00:00Z"),
        new Date("2026-10-15T06:00:00Z"),
        "America/Chicago",
      ),
    ).toBe(1);
    expect(
      calendarDaysBetween(
        new Date("2026-10-01T15:00:00Z"),
        new Date("2026-10-31T15:00:00Z"),
        "America/Chicago",
      ),
    ).toBe(30);
  });
});
