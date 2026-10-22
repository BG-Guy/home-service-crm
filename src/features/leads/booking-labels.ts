import type { Tone } from "@/ui/tone";
import type { BookingDone } from "./booking-queries";

// Plain-language state of the booking confirmation (call-to-booking step 3), from
// the real scheduled_messages row the booking_confirm automation wrote.

export interface ConfirmationLabel {
  text: string;
  tone: Tone;
  /** Final for this screen (stop polling). */
  settled: boolean;
}

export function confirmationLabel(b: BookingDone): ConfirmationLabel {
  const c = b.confirmation;
  if (!c) {
    if (!b.techName)
      return {
        text: "Not sent: the job has no tech yet",
        tone: "gray",
        settled: true,
      };
    return b.ageSec < 15
      ? { text: "Sending confirmation…", tone: "gray", settled: false }
      : { text: "No confirmation sent", tone: "gray", settled: true };
  }
  const what = c.channel === "email" ? "email" : "text";
  const reason = c.reason ?? "";
  switch (c.status) {
    case "scheduled":
      return {
        text: `Confirmation ${what} queued`,
        tone: "blue",
        settled: false,
      };
    case "deferred_quiet":
      return {
        text: `Confirmation ${what} queued for after quiet hours`,
        tone: "blue",
        settled: true,
      };
    case "pending_tap":
      return {
        text: "Confirmation text queued in the outbox",
        tone: "blue",
        settled: true,
      };
    case "sent":
    case "sent_manual":
    case "delivered":
      return {
        text: `Confirmation ${what} sent`,
        tone: "green",
        settled: true,
      };
    case "suppressed_optout":
      return {
        text:
          reason === "do_not_contact"
            ? "Not sent: marked do not contact"
            : "Not sent: they opted out of texts",
        tone: "orange",
        settled: true,
      };
    case "skipped":
      return {
        text: reason.startsWith("no_consent")
          ? "Not sent: no SMS consent"
          : reason === "no_phone" || reason === "no_contact"
            ? "Not sent: no phone number"
            : reason === "test_customer"
              ? "Not sent: test customer"
              : "Not sent",
        tone: "orange",
        settled: true,
      };
    case "failed":
      return {
        text: `Confirmation ${what} failed`,
        tone: "red",
        settled: true,
      };
    default:
      return { text: "Confirmation canceled", tone: "gray", settled: true };
  }
}
