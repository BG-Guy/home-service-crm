// Human labels for template keys and channels (outbox cards, threads, editor).
// Client-safe data.

export const TEMPLATE_LABELS: Record<string, string> = {
  manual: "Message",
  "lead.ack": "Lead auto-reply",
  "lead.ack_after_hours": "After-hours auto-reply",
  "lead.not_reached": "Couldn't reach you",
  "lead.no_answer": "Missed call follow-up",
  "job.booked": "Booking confirmation",
  "job.reminder_24h": "24-hour reminder",
  "job.reminder_2h": "2-hour heads-up",
  "job.on_my_way": "On my way",
  "job.running_late": "Running late",
  "job.rescheduled": "Reschedule notice",
  "job.return_visit": "Return visit",
  "job.cancelled": "Cancellation notice",
  "job.cancel_verify": "Was the service completed?",
  "job.link": "Job details link",
  "job.completed": "Invoice after the job",
  "job.checkin": "7-day check-in",
  "invoice.sent": "Invoice",
  "invoice.pay_link": "Pay link",
  "invoice.reminder_1": "Payment reminder 1",
  "invoice.reminder_2": "Payment reminder 2",
  "invoice.reminder_3": "Final payment reminder",
  "payment.receipt": "Payment receipt",
  "deposit.request": "Deposit request",
  "refund.issued": "Refund notice",
  "estimate.sent": "Estimate",
  "change_order.sent": "Change order",
  "estimate.followup_1": "Estimate follow-up 1",
  "estimate.followup_2": "Estimate follow-up 2",
  "estimate.followup_3": "Estimate follow-up 3",
  "estimate.followup_4": "Estimate follow-up 4",
  "estimate.closeout": "Estimate close-out",
  "review.request": "Review request",
  "review.reminder": "Review reminder",
  "marketing.maintenance": "Maintenance reminder",
  "messaging.stop_confirm": "Opt-out confirmation",
  "messaging.start_confirm": "Opt-in confirmation",
  "messaging.help": "Help reply",
  "user.invite": "Team invite",
  "user.password_reset": "Password reset",
};

export function templateLabel(key: string | null | undefined): string {
  if (!key) return "Message";
  if (TEMPLATE_LABELS[key]) return TEMPLATE_LABELS[key];
  const tail = key.replace(/^staff\./, "").replace(/[._]+/g, " ");
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

export const CHANNEL_LABELS: Record<string, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
  push: "Push",
  in_app: "In-app",
  customer_preferred: "Customer's preferred",
};

export function channelLabel(c: string | null | undefined): string {
  return CHANNEL_LABELS[c ?? ""] ?? c ?? "";
}

/** Customer-facing template keys offered in the composer (in this order). */
export const COMPOSER_TEMPLATE_KEYS = [
  "job.link",
  "job.booked",
  "job.reminder_24h",
  "job.running_late",
  "invoice.pay_link",
  "invoice.sent",
  "estimate.sent",
  "lead.no_answer",
  "job.checkin",
] as const;

/** Why a send didn't go out (scheduled_messages.last_error codes) → plain words. */
export const REASON_LABELS: Record<string, string> = {
  opted_out: "The customer opted out of texts.",
  opted_out_no_email: "The customer opted out of texts and has no email.",
  do_not_text: "The customer is marked do-not-text.",
  do_not_contact: "The customer is marked do-not-contact.",
  no_phone: "No mobile number on file.",
  no_email: "No email address on file.",
  no_contact: "No phone or email on file.",
  no_consent_marketing: "No marketing consent.",
  no_consent_review: "No consent for review requests.",
  no_consent_transactional: "No consent to text.",
  test_customer: "Test customer.",
  quiet_hours: "Held for quiet hours.",
  cap_24h: "Daily message limit reached; moved to tomorrow.",
  cap_marketing_7d: "Weekly marketing limit reached.",
  expired_before_send: "Expired before it could be sent.",
  expired_in_outbox: "Expired in the outbox.",
  automation_disabled: "The automation was turned off.",
  feature_off: "The feature is turned off.",
  conditions_changed: "Conditions no longer match.",
  job_cancelled: "The job was cancelled.",
  job_progressed: "The job moved on.",
  job_confirmed: "The customer already confirmed.",
  invoice_paid: "The invoice is paid.",
  estimate_closed: "The estimate is closed.",
  lead_progressed: "The lead moved on.",
  deposit_settled: "The deposit is settled.",
  deposit_not_needed: "The deposit is no longer needed.",
  template_missing: "The template is missing.",
  rescheduled: "Replaced after a reschedule.",
  awaiting_payment: "Waits until the invoice is paid.",
  max_asks: "Already asked twice for this job.",
  asked_recently: "This customer was asked recently.",
  user_inactive: "The team member is inactive.",
};

export function reasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = code.split(":")[0] ?? code;
  if (REASON_LABELS[base]) return REASON_LABELS[base];
  if (base === "cancel_on") return "Canceled by a later event.";
  if (base.startsWith("canceled_by") || base.startsWith("skipped_by"))
    return "Canceled by a team member.";
  if (base.startsWith("consent_revoked")) return "Consent was withdrawn.";
  return base.replace(/_/g, " ");
}
