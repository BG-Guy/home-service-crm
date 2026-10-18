// Message text redaction outside the contact window (QA2 NEW-3). Pure.
import { describe, expect, it } from "vitest";
import { redactMessageText } from "@/lib/mask";

const STREETS = ["3943 Airport Blvd"];

describe("redactMessageText", () => {
  it("drops live links and the house number from a booking text", () => {
    const out = redactMessageText(
      "Booked: Installation on Oct 24 at 3943 Airport Blvd. Details/reschedule: https://crm.example.com/j/Y-98jAbcdefgh123",
      { streets: STREETS },
    );
    expect(out).toBe(
      "Booked: Installation on Oct 24 at ••• Airport Blvd. Details/reschedule: [link hidden]",
    );
    expect(out).not.toContain("3943");
    expect(out).not.toContain("/j/");
  });

  it("matches the customer's street whatever the case, and drops the unit", () => {
    expect(
      redactMessageText("I'm at 3943 airport blvd apt 4 now", {
        streets: STREETS,
      }),
    ).toBe("I'm at ••• Airport Blvd now");
  });

  it("masks other addresses by shape, keeping dates and amounts", () => {
    expect(redactMessageText("See you Oct 24 at 12 N Lamar St #5.")).toBe(
      "See you Oct 24 at ••• N Lamar St.",
    );
    expect(
      redactMessageText("Invoice INV-1047 for $1,250.00 is due 2026-11-01"),
    ).toBe("Invoice INV-1047 for $1,250.00 is due 2026-11-01");
    expect(redactMessageText("100 5th Ave, New York")).toBe(
      "••• 5th Ave, New York",
    );
  });

  it("masks phone numbers, emails and gate codes", () => {
    expect(
      redactMessageText(
        "Call (512) 555-2011 or write mason.nguyen11@example.com. Gate code is 4455.",
      ),
    ).toBe("Call •••• 2011 or write m•••@example.com. Gate code is •••.");
  });

  it("leaves ordinary text alone", () => {
    const s = "Your tech is on the way, ETA 15 min. Reply STOP to opt out.";
    expect(redactMessageText(s, { streets: STREETS })).toBe(s);
    expect(redactMessageText("")).toBe("");
  });
});
