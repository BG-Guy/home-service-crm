// Call-to-booking step 3: the confirmation line comes from the real message row.
import { describe, expect, it } from "vitest";
import { confirmationLabel } from "@/features/leads/booking-labels";
import type { BookingDone } from "@/features/leads/booking-queries";

const base: BookingDone = {
  jobId: "j",
  number: "J-1",
  leadId: "l",
  customerId: "c",
  customerName: "Dana",
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
  it("waits briefly, then says nothing was sent", () => {
    expect(confirmationLabel(base)).toMatchObject({ settled: false });
    expect(confirmationLabel({ ...base, ageSec: 60 }).text).toBe(
      "No confirmation sent",
    );
    expect(confirmationLabel({ ...base, techName: null }).text).toMatch(
      /no tech/,
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
