// Built-in message templates (SPEC §7.3 default texts + BUILD_PLAN Appendix B).
// Customer texts are short and GSM-7 only (no emoji, curly quotes or long dashes).
// Staff templates: `subject` is the notification title, `body` the text; seeded on
// the `push` channel (in-app falls back to it) plus `email` where an email copy is
// expected. Every template is editable in Settings → Templates ("reset to default").
import type { TemplateSeed } from "@/features/registry";

type T = TemplateSeed;

const sms = (key: string, body: string, o: Partial<T> = {}): T => ({
  key,
  channel: "sms",
  purpose: "transactional",
  body,
  ...o,
});
const email = (
  key: string,
  subject: string,
  body: string,
  o: Partial<T> = {},
): T => ({
  key,
  channel: "email",
  purpose: "transactional",
  subject,
  body,
  ...o,
});
const push = (
  key: string,
  title: string,
  body: string,
  o: Partial<T> = {},
): T => ({
  key,
  channel: "push",
  purpose: "internal",
  subject: title,
  body,
  ...o,
});
const staffEmail = (key: string, title: string, body: string): T => ({
  key,
  channel: "email",
  purpose: "internal",
  subject: title,
  body: `${body}\n\nOpen: {{entity.url}}`,
});

/** Common email sign-off. */
const SIGN = "\n\n{{company.name}}\n{{company.phone}}";

export const customerTemplates: T[] = [
  // ---- leads
  sms(
    "lead.ack",
    "Hi {{customer.first_name|there}}, it's {{company.name}}. We got your {{lead.service|service}} request and will call you within {{company.lead_response_minutes}} min from {{company.phone}}. Reply STOP to opt out.",
    { allowOutsideQuietHours: true, expiresAfterMinutes: 60 },
  ),
  email(
    "lead.ack",
    "We got your request - {{company.name}}",
    "Hi {{customer.first_name|there}},\n\nThanks for reaching out about {{lead.service|your project}}. We'll call you within {{company.lead_response_minutes}} minutes from {{company.phone}}.",
    { allowOutsideQuietHours: true },
  ),
  sms(
    "lead.ack_after_hours",
    "Hi {{customer.first_name|there}}, it's {{company.name}}. We got your {{lead.service|service}} request after hours and will call you first thing tomorrow.{{company.emergency_line}} Reply STOP to opt out.",
    { allowOutsideQuietHours: true, expiresAfterMinutes: 60 },
  ),
  email(
    "lead.ack_after_hours",
    "We got your request - {{company.name}}",
    "Hi {{customer.first_name|there}},\n\nThanks for reaching out about {{lead.service|your project}}. Our office is closed right now; we'll call you first thing tomorrow.{{company.emergency_line}}",
    { allowOutsideQuietHours: true },
  ),
  sms(
    "lead.not_reached",
    "Hi {{customer.first_name|there}}, {{company.name}} tried to reach you about {{lead.service|your request}}. Call or text us at {{company.phone}} or book online: {{booking.link}}",
  ),
  sms(
    "lead.no_answer",
    "Hi {{customer.first_name|there}}, {{company.name}} just called about {{lead.service|your request}}. Call us back at {{company.phone}} whenever works.",
  ),
  // ---- booking & reminders
  // Booking/reschedule notices expire after 12 h (never sent late; the sender also
  // drops them once the visit is over or the job moved on, QA T6-10).
  sms(
    "job.booked",
    "Booked: {{job.service}} on {{job.date_short}}, {{job.window}} at {{job.address_short}}. {{job.service_fee_line}} Details/reschedule: {{job.link}}",
    { expiresAfterMinutes: 720 },
  ),
  email(
    "job.booked",
    "You're booked: {{job.service}} on {{job.date_short}}",
    // The fee line shares the paragraph: when it's empty, no blank lines (QA T6-13).
    "Hi {{customer.first_name|there}},\n\nYou're booked for {{job.service}} on {{job.date_long}}, {{job.window}} at {{job.address_full}}. {{job.service_fee_line}}\n\nView details, confirm or reschedule: {{job.link}}",
  ),
  sms(
    "job.reminder_24h",
    "Reminder: {{company.name}} tomorrow {{job.window}}. Reply C to confirm or R to reschedule, or tap {{job.link}}",
    { expiresAfterMinutes: 1200 },
  ),
  email(
    "job.reminder_24h",
    "Reminder: your appointment tomorrow",
    "Hi {{customer.first_name|there}},\n\nThis is a reminder that {{company.name}} will see you tomorrow, {{job.date_long}}, {{job.window}} at {{job.address_short}}.\n\nConfirm or reschedule: {{job.link}}",
  ),
  sms(
    "job.reminder_2h",
    "{{tech.first_name|Your technician}} arrives {{job.window}} today. Please have an adult home and pets secured.",
    { expiresAfterMinutes: 120 },
  ),
  sms(
    "job.on_my_way",
    "{{tech.first_name|Your technician}} from {{company.name}} is on the way, about {{eta_minutes|30}} min. Track: {{tracking.link}}",
    { allowOutsideQuietHours: true, expiresAfterMinutes: 30 },
  ),
  sms(
    "job.running_late",
    "Sorry - {{tech.first_name|your technician}} from {{company.name}} is running late. New arrival in about {{eta_minutes|30}} min. Thanks for your patience!",
    { allowOutsideQuietHours: true, expiresAfterMinutes: 30 },
  ),
  sms(
    "job.rescheduled",
    "{{company.name}}: your appointment moved to {{job.date_short}}, {{job.window}}. Details: {{job.link}}",
    { expiresAfterMinutes: 720 },
  ),
  email(
    "job.rescheduled",
    "Your appointment was rescheduled",
    "Hi {{customer.first_name|there}},\n\nYour {{job.service}} appointment is now {{job.date_long}}, {{job.window}}.\n\nDetails: {{job.link}}",
  ),
  sms(
    "job.return_visit",
    "{{company.name}}: we'll be back to finish your {{job.service}} on {{job.date_short}}, {{job.window}}. Details: {{job.link}}",
    { expiresAfterMinutes: 720 },
  ),
  email(
    "job.return_visit",
    "Return visit scheduled",
    "Hi {{customer.first_name|there}},\n\nWe'll be back to finish your {{job.service}} on {{job.date_long}}, {{job.window}}.\n\nDetails: {{job.link}}",
  ),
  sms(
    "job.cancelled",
    "{{company.name}}: your {{job.service}} appointment on {{job.date_short}} is cancelled.{{job.cancel_fee_line}} Questions? Call {{company.phone}}.",
  ),
  email(
    "job.cancelled",
    "Your appointment was cancelled",
    "Hi {{customer.first_name|there}},\n\nYour {{job.service}} appointment on {{job.date_long}} is cancelled.{{job.cancel_fee_line}}\n\nQuestions? Call {{company.phone}}.",
  ),
  sms(
    "job.cancel_verify",
    "{{company.name}}: was your service completed today? Reply 1 for yes or 2 for no. Thank you!",
  ),
  sms(
    "job.link",
    "{{company.name}}: here are the details for your {{job.service}} appointment: {{job.link}}",
  ),
  email(
    "job.link",
    "Your appointment details",
    "Hi {{customer.first_name|there}},\n\nHere are the details for your {{job.service}} appointment: {{job.link}}",
  ),
  // ---- invoices, payments, deposits, refunds
  sms(
    "job.completed",
    "Thanks {{customer.first_name|}}! Your invoice for {{invoice.total}} with photos: {{invoice.link}}",
  ),
  email(
    "job.completed",
    "Your invoice from {{company.name}}",
    "Hi {{customer.first_name|there}},\n\nThanks for choosing {{company.name}}. Your invoice {{invoice.number}} for {{invoice.total}} (with photos of the work) is here: {{invoice.link}}",
  ),
  sms(
    "invoice.sent",
    "{{company.name}}: invoice {{invoice.number}} for {{invoice.total}}. View and pay: {{invoice.link}}",
  ),
  email(
    "invoice.sent",
    "Invoice {{invoice.number}} from {{company.name}}",
    "Hi {{customer.first_name|there}},\n\nYour invoice {{invoice.number}} for {{invoice.total}} is ready. Due {{invoice.due_date}}.\n\nView and pay: {{invoice.link}}",
  ),
  sms(
    "invoice.pay_link",
    "{{company.name}}: pay {{invoice.balance}} securely here: {{invoice.pay_link}}",
  ),
  email(
    "invoice.pay_link",
    "Pay invoice {{invoice.number}}",
    "Hi {{customer.first_name|there}},\n\nYou can pay {{invoice.balance}} for invoice {{invoice.number}} securely here: {{invoice.pay_link}}",
  ),
  sms(
    "invoice.reminder_1",
    "Friendly reminder: {{invoice.balance}} is due for {{job.service|your service}}. Pay: {{invoice.pay_link}}",
  ),
  email(
    "invoice.reminder_1",
    "Friendly reminder: invoice {{invoice.number}}",
    "Hi {{customer.first_name|there}},\n\nA friendly reminder that {{invoice.balance}} is due on invoice {{invoice.number}}.\n\nPay securely: {{invoice.pay_link}}",
  ),
  sms(
    "invoice.reminder_2",
    "{{company.name}}: invoice {{invoice.number}} has {{invoice.balance}} outstanding. Pay here: {{invoice.pay_link}} or call {{company.phone}} with questions.",
  ),
  email(
    "invoice.reminder_2",
    "Invoice {{invoice.number}} is past due",
    "Hi {{customer.first_name|there}},\n\nInvoice {{invoice.number}} still has {{invoice.balance}} outstanding.\n\nPay securely: {{invoice.pay_link}}\n\nQuestions? Call {{company.phone}}.",
  ),
  sms(
    "invoice.reminder_3",
    "{{company.name}}: final reminder, {{invoice.balance}} is past due on invoice {{invoice.number}}. Pay: {{invoice.pay_link}} or call {{company.phone}}.",
  ),
  email(
    "invoice.reminder_3",
    "Final reminder: invoice {{invoice.number}}",
    "Hi {{customer.first_name|there}},\n\nThis is a final reminder that {{invoice.balance}} is past due on invoice {{invoice.number}}.\n\nPay securely: {{invoice.pay_link}}\n\nIf something is wrong with this invoice, call us at {{company.phone}}.",
  ),
  sms(
    "payment.receipt",
    "{{company.name}}: received {{payment.amount}} by {{payment.method}} for job {{job.number}}{{payment.collected_by_line}}. Wrong amount? Reply or tap {{receipt.link}}",
  ),
  email(
    "payment.receipt",
    "Receipt: {{payment.amount}} paid to {{company.name}}",
    "Hi {{customer.first_name|there}},\n\nWe received {{payment.amount}} by {{payment.method}} on {{payment.date}} for job {{job.number}}{{payment.collected_by_line}}.\n\nReceipt: {{receipt.link}}\n\nWrong amount? Reply to this email or tap the link above.",
  ),
  sms(
    "deposit.request",
    "{{company.name}}: a {{deposit.amount}} deposit secures your {{job.service|appointment}}. {{deposit.policy_short}} Pay: {{deposit.link}}",
  ),
  email(
    "deposit.request",
    "Deposit to secure your appointment",
    "Hi {{customer.first_name|there}},\n\nA {{deposit.amount}} deposit secures your {{job.service|appointment}}.\n\n{{deposit.policy_short}}\n\nPay securely: {{deposit.link}}",
  ),
  sms(
    "refund.issued",
    "{{company.name}}: we refunded {{refund.amount}} to your {{payment.method}}. Banks take 5-10 business days to post it.",
  ),
  email(
    "refund.issued",
    "Your refund of {{refund.amount}}",
    "Hi {{customer.first_name|there}},\n\nWe refunded {{refund.amount}} to your {{payment.method}} on {{refund.date}}. Banks usually take 5-10 business days to post refunds to your statement.",
  ),
  // ---- estimates & change orders
  sms(
    "estimate.sent",
    "{{company.name}}: your estimate {{estimate.number}} for {{estimate.total}} is ready. Review and approve: {{estimate.link}}",
  ),
  email(
    "estimate.sent",
    "Your estimate from {{company.name}}",
    "Hi {{customer.first_name|there}},\n\nYour estimate {{estimate.number}} for {{estimate.total}} is ready. It's valid until {{estimate.expires_date}}.\n\nReview and approve online: {{estimate.link}}",
  ),
  sms(
    "change_order.sent",
    "{{company.name}}: a change to your job {{job.number}} needs your approval. Review: {{change_order.link}}",
  ),
  email(
    "change_order.sent",
    "Please review a change to your job",
    "Hi {{customer.first_name|there}},\n\nA change to job {{job.number}} needs your approval before we continue.\n\nReview and sign: {{change_order.link}}",
  ),
  sms(
    "estimate.followup_1",
    "Any questions on your {{estimate.total}} estimate? Approve or ask here: {{estimate.link}}",
  ),
  email(
    "estimate.followup_1",
    "Questions about your estimate?",
    "Hi {{customer.first_name|there}},\n\nAny questions about your {{estimate.total}} estimate? You can approve it or ask us anything here: {{estimate.link}}",
  ),
  sms(
    "estimate.followup_2",
    "Hi {{customer.first_name|there}}, just checking in on your estimate from {{company.name}}. Happy to answer questions: {{estimate.link}}",
  ),
  email(
    "estimate.followup_2",
    "Checking in on your estimate",
    "Hi {{customer.first_name|there}},\n\nJust checking in on your estimate {{estimate.number}}. Happy to answer any questions.\n\n{{estimate.link}}",
  ),
  sms(
    "estimate.followup_3",
    "{{company.name}}: your estimate {{estimate.number}} is still open. Want to get on the schedule? {{estimate.link}}",
  ),
  email(
    "estimate.followup_3",
    "Ready to get on the schedule?",
    "Hi {{customer.first_name|there}},\n\nYour estimate {{estimate.number}} is still open. Approve it online and we'll get you on the schedule: {{estimate.link}}",
  ),
  sms(
    "estimate.followup_4",
    "{{company.name}}: last check-in on estimate {{estimate.number}}. It expires {{estimate.expires_date}}. {{estimate.link}}",
  ),
  email(
    "estimate.followup_4",
    "Your estimate expires soon",
    "Hi {{customer.first_name|there}},\n\nYour estimate {{estimate.number}} expires on {{estimate.expires_date}}.\n\n{{estimate.link}}",
  ),
  sms(
    "estimate.closeout",
    "{{company.name}}: we'll close estimate {{estimate.number}} for now. If you'd still like the work done, just reply or call {{company.phone}}.",
  ),
  email(
    "estimate.closeout",
    "Closing your estimate",
    "Hi {{customer.first_name|there}},\n\nWe'll close estimate {{estimate.number}} for now. If you'd still like the work done, just reply or call {{company.phone}}.",
  ),
  // ---- reviews (purpose review; sentiment-neutral; no incentives)
  sms(
    "review.request",
    "Thanks for choosing {{company.name}} today. Would you share your experience? {{review.link}}",
    { purpose: "review", expiresAfterMinutes: 2880 },
  ),
  email(
    "review.request",
    "How did we do?",
    "Hi {{customer.first_name|there}},\n\nThanks for choosing {{company.name}}. Would you take a minute to share your experience?\n\n{{review.link}}",
    { purpose: "review", expiresAfterMinutes: 2880 },
  ),
  sms(
    "review.reminder",
    "Hi {{customer.first_name|there}}, if you have a minute, we'd appreciate hearing about your experience with {{company.name}}: {{review.link}}",
    { purpose: "review", expiresAfterMinutes: 2880 },
  ),
  email(
    "review.reminder",
    "A minute to share your experience?",
    "Hi {{customer.first_name|there}},\n\nIf you have a minute, we'd appreciate hearing about your experience with {{company.name}}.\n\n{{review.link}}",
    { purpose: "review", expiresAfterMinutes: 2880 },
  ),
  // ---- after the job
  sms(
    "job.checkin",
    "Hi {{customer.first_name|there}}, it's {{company.name}}. Is everything still working well after last week's {{job.service|visit}}? Reply anytime.",
  ),
  email(
    "job.checkin",
    "How is everything working?",
    "Hi {{customer.first_name|there}},\n\nIs everything still working well after last week's {{job.service|visit}}? Just reply if anything needs a look.",
  ),
  sms(
    "marketing.maintenance",
    "Hi {{customer.first_name|there}}, it's been {{months_since_last_job}} months since your {{last_job.service}} with {{company.name}}. Time for a check-up? Book: {{booking.link}} Reply STOP to opt out.",
    { purpose: "marketing" },
  ),
  email(
    "marketing.maintenance",
    "Time for your {{last_job.service}} check-up",
    "Hi {{customer.first_name|there}},\n\nIt's been {{months_since_last_job}} months since your {{last_job.service}} on {{last_job.date_short}}. Regular maintenance prevents bigger repairs.\n\nBook online: {{booking.link}}\n\nTo stop these reminders, reply STOP or call {{company.phone}}.",
    { purpose: "marketing" },
  ),
  // ---- compliance replies (paid/gateway drivers only)
  sms(
    "messaging.stop_confirm",
    "{{company.name}}: you're unsubscribed and won't get more texts. Reply START to resubscribe.",
    { allowOutsideQuietHours: true },
  ),
  sms(
    "messaging.start_confirm",
    "{{company.name}}: you're subscribed to appointment texts again. Reply STOP to opt out.",
    { allowOutsideQuietHours: true },
  ),
  sms(
    "messaging.help",
    "{{company.name}}: for help call {{company.phone}}. Msg & data rates may apply. Reply STOP to opt out.",
    { allowOutsideQuietHours: true },
  ),
];

/** Staff notifications (titles are short; bodies one line). */
export const staffTemplates: T[] = [
  push("staff.generic", "{{title|Notification}}", "{{body|}}"),
  push(
    "staff.new_lead",
    "New lead: {{lead.service|service request}}",
    "{{lead.name|New customer}} from {{lead.source|the website}}. Respond within {{company.lead_response_minutes}} min.",
  ),
  staffEmail(
    "staff.new_lead",
    "New lead: {{lead.service|service request}}",
    "{{lead.name|New customer}} from {{lead.source|the website}}. Respond within {{company.lead_response_minutes}} min.",
  ),
  push(
    "staff.lead_sla",
    "Lead waiting {{lead.sla_minutes}} min",
    "{{lead.name|A lead}} ({{lead.service|service}}) hasn't been contacted yet.",
  ),
  push(
    "staff.lead_touched",
    "Lead came back",
    "{{lead.name|A lead}} submitted again ({{lead.service|service}}).",
  ),
  push(
    "staff.job_assigned",
    "New job {{job.number}}",
    "{{job.service}} - {{job.date_short}} {{job.window}} at {{job.address_short}}.",
  ),
  push(
    "staff.unconfirmed",
    "Unconfirmed tomorrow: {{job.number}}",
    "{{customer.display_name}} hasn't confirmed {{job.window}}. Call to confirm.",
  ),
  push(
    "staff.late_prompt",
    "Running late for {{job.number}}?",
    "The window ends at {{job.window_end_time}}. Tap to send a running-late text.",
  ),
  push(
    "staff.job_changed",
    "Job {{job.number}} changed",
    "{{job.status_label}}: {{job.service}} {{job.date_short}} {{job.window}}.",
  ),
  push(
    "staff.daily_agenda",
    "Today: {{count}} job(s)",
    "First stop {{agenda.first_time}} at {{agenda.first_address}}.",
  ),
  push(
    "staff.reschedule_requested",
    "Reschedule request: {{job.number}}",
    "{{customer.display_name}} asked to reschedule {{job.date_short}} {{job.window}}.",
  ),
  push(
    "staff.start_approval",
    "Approval needed to start {{job.number}}",
    "Critical-risk job: review before work starts.",
  ),
  push(
    "staff.start_decided",
    "Start {{decision}} for {{job.number}}",
    "{{job.service}} at {{job.address_short}}.",
  ),
  push(
    "staff.approval_needed",
    "{{count}} item(s) need approval",
    "Receipts, logs or cancellations are waiting for review.",
  ),
  push(
    "staff.estimate_viewed",
    "Estimate {{estimate.number}} viewed",
    "{{customer.display_name}} opened the {{estimate.total}} estimate.",
  ),
  push(
    "staff.estimate_approved",
    "Estimate {{estimate.number}} approved",
    "{{customer.display_name}} approved {{estimate.total}}.",
  ),
  push(
    "staff.deposit_paid",
    "Deposit paid: {{deposit.amount}}",
    "{{customer.display_name}} paid the deposit for {{job.number}}.",
  ),
  push(
    "staff.hold_expiring",
    "Card hold expires soon",
    "The {{deposit.amount}} hold for {{job.number}} expires {{deposit.capture_before}}. Capture or release it.",
  ),
  push(
    "staff.refund_due",
    "Refund due: {{refund.amount}}",
    "A promised refund for {{job.number|a job}} is due today.",
  ),
  push(
    "staff.dispute",
    "Chargeback: {{dispute.amount}}",
    "{{customer.display_name}} disputed a payment. Respond by {{dispute.due_date}}.",
  ),
  staffEmail(
    "staff.dispute",
    "Chargeback: {{dispute.amount}}",
    "{{customer.display_name}} disputed a payment. Respond by {{dispute.due_date}}.",
  ),
  push(
    "staff.efw",
    "Fraud warning on a payment",
    "Early fraud warning for {{amount}}. Consider refunding to avoid a chargeback.",
  ),
  staffEmail(
    "staff.efw",
    "Fraud warning on a payment",
    "Early fraud warning for {{amount}}. Consider refunding to avoid a chargeback.",
  ),
  push(
    "staff.payment_failed",
    "Payment failed",
    "A payment for {{job.number|a job}} failed: {{error|declined}}.",
  ),
  push(
    "staff.manual_unverified",
    "{{count}} manual payment(s) to verify",
    "Cash, check or app payments older than 3 days are not verified yet.",
    { channel: "push" },
  ),
  push(
    "staff.receipt_flagged",
    "Customer flagged a receipt",
    "{{customer.display_name}} says the receipt for {{payment.amount}} is wrong.",
  ),
  staffEmail(
    "staff.receipt_flagged",
    "Customer flagged a receipt",
    "{{customer.display_name}} says the receipt for {{payment.amount}} is wrong. A callback task was created.",
  ),
  push(
    "staff.low_rating",
    "Low rating: {{rating}} stars",
    "{{customer.display_name}} rated job {{job.number}} {{rating}}/5.{{review.callback_line}}",
  ),
  push(
    "staff.message_failed",
    "Message not delivered",
    "A text or email to {{customer.display_name|a customer}} failed: {{error|unknown error}}.",
  ),
  push(
    "staff.optout_review",
    "Possible opt-out",
    '{{customer.display_name}} replied "{{reply}}". Tap to review and stop texting if needed.',
  ),
  // {{amount}} is what must be handed in: cash and checks, or only checks for a tech
  // whose cash nets against pay (B6, QA T6-12). The wording fits both.
  push(
    "staff.cash_over_limit",
    "Cash over limit",
    "{{user.name|A tech}} holds {{amount}} in cash and checks to hand in ({{days}} days). Arrange a drop-off.",
  ),
  staffEmail(
    "staff.cash_over_limit",
    "Cash over limit",
    "{{user.name|A tech}} holds {{amount}} in cash and checks to hand in ({{days}} days). Arrange a drop-off.",
  ),
  push(
    "staff.cash_discrepancy",
    "Cash count mismatch",
    "{{user.name|A tech}} declared {{amount}} vs {{system_amount}} on record.",
  ),
  push(
    "staff.remittance_request",
    "Please remit cash",
    "Your balance is negative. Please drop off {{amount}}.",
  ),
  push(
    "staff.settlement_ready",
    "Your pay statement is ready",
    "Review your statement for {{period}} and flag anything that looks off.",
  ),
  staffEmail(
    "staff.settlement_ready",
    "Your pay statement is ready",
    "Review your statement for {{period}} and flag anything that looks off.",
  ),
  push(
    "staff.settlement_flagged",
    "Statement flagged",
    "{{user.name|A tech}} flagged an item on their statement.",
  ),
  push("staff.payout_sent", "Payout sent", "{{amount}} is on its way."),
  staffEmail("staff.payout_sent", "Payout sent", "{{amount}} is on its way."),
  push(
    "staff.comp_agreement",
    "Please sign your pay agreement",
    "Your commission plan changed. Review and sign it in Pay.",
  ),
  push(
    "staff.bank_changed",
    "Bank details changed",
    "{{user.name|A user}} changed their bank account (ending {{last4}}). Payouts are on hold until verified.",
  ),
  staffEmail(
    "staff.bank_changed",
    "Bank details changed",
    "{{user.name|A user}} changed their bank account (ending {{last4}}). Payouts are on hold until verified. If this wasn't expected, contact them by phone.",
  ),
  push(
    "staff.reimbursement_decided",
    "Receipt {{decision}}",
    "Your {{amount}} purchase was {{decision}}.",
  ),
  push(
    "staff.vehicle_due",
    "{{vehicle.nickname}}: {{task}} due",
    "Schedule it soon to avoid problems on the road.",
  ),
  push(
    "staff.doc_expiring",
    "{{vehicle.nickname}}: document expires in {{days}} days",
    "Renew the {{document}} before it lapses.",
  ),
  staffEmail(
    "staff.doc_expiring",
    "{{vehicle.nickname}}: document expires in {{days}} days",
    "Renew the {{document}} before it lapses.",
  ),
  push(
    "staff.vehicle_issue",
    "{{vehicle.nickname}}: issue reported",
    "{{severity}} issue: {{issue}}",
  ),
  staffEmail(
    "staff.vehicle_issue",
    "{{vehicle.nickname}}: unsafe issue reported",
    "{{severity}} issue: {{issue}}. Take the vehicle off the road until it's checked.",
  ),
  push(
    "staff.inspection_due",
    "Vehicle inspection due",
    "Do the walk-around for {{vehicle.nickname}} before your first job.",
  ),
  push(
    "staff.tool_audit_due",
    "Tool check due",
    "Confirm the tools in your custody today.",
  ),
  push(
    "staff.tool_incident",
    "Tool incident reported",
    "{{tool.name|A tool}} was reported {{kind}}.",
  ),
  push(
    "staff.tool_maintenance_due",
    "{{tool.name|Tool}} maintenance due",
    "{{task}} is due {{due_date}}.",
  ),
  push(
    "staff.task_due",
    "Task due: {{task}}",
    "{{task_body|Open your tasks.}}",
  ),
  push(
    "staff.daily_digest",
    "Today at {{company.name}}",
    "{{digest.jobs_today}} jobs, {{digest.unconfirmed}} unconfirmed, {{digest.overdue_invoices}} overdue invoices, {{digest.pending_approvals}} approvals.",
  ),
  staffEmail(
    "staff.daily_digest",
    "Daily ops digest - {{digest.date}}",
    "Good morning.\n\nJobs today: {{digest.jobs_today}}\nUnconfirmed (today and tomorrow): {{digest.unconfirmed}}\nOverdue invoices: {{digest.overdue_invoices}} ({{digest.overdue_amount}})\nPending approvals: {{digest.pending_approvals}}\nOpen disputes: {{digest.open_disputes}}\nOutbox texts waiting: {{digest.outbox}}",
  ),
  push(
    "staff.outbox_ready",
    "{{count}} customer text(s) ready",
    "Open the outbox and tap Send for each one.",
  ),
  push("staff.reminder", "{{title|Reminder}}", "{{body|}}"),
  // ---- account emails (audience address)
  {
    key: "user.invite",
    channel: "email",
    purpose: "internal",
    subject: "You're invited to {{company.name}}",
    body: "Hi {{invite.name|there}},\n\n{{invite.by|Your team}} invited you to join {{company.name}}. Set up your account here (the link expires in 7 days):\n\n{{invite.url}}",
  },
  {
    key: "user.invite",
    channel: "sms",
    purpose: "internal",
    body: "{{company.name}}: you're invited to join the team app. Set up your account: {{invite.url}}",
  },
  {
    key: "user.password_reset",
    channel: "email",
    purpose: "internal",
    subject: "Reset your {{company.name}} password",
    body: "Someone asked to reset your password. If it was you, use this link within 30 minutes:\n\n{{reset.url}}\n\nIf it wasn't you, ignore this email - your password stays the same.",
  },
];

/** Email sign-off appended to customer emails by the sender (kept out of each body). */
export const EMAIL_SIGNATURE = SIGN;

export const builtinTemplateList: T[] = [
  ...customerTemplates,
  ...staffTemplates,
];
