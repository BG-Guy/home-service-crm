// Built-in automations (SPEC §7.3, all editable). Seeded by F's base seed with
// ON CONFLICT DO NOTHING, so admin edits survive re-seeding.
//
// Step grammar (src/features/automations/schedule.ts EngineStep):
//   delay {minutes|hours|days} (negative allowed) · anchor (event_time | job.window_start
//   | … | "a|b" fallback | "fixed_time_local HH:MM") · at "HH:MM" · channel (+ joins) ·
//   audience (+ joins) · template_key · dedupe entity|event|batch · only_on · when.
// trigger_event: one event or "a|b" (multi-trigger). cancel_on: event names or
//   { event, when?, scope?: 'entity'|'customer'|'subject_user'|'actor_user' }.
// Audiences: customer, assigned_tech, assigned_techs, added_techs, removed_techs,
//   event_techs, subject_user, creator, vehicle_assignee, office, admins,
//   perm:<key>, role:<key>, user:<id>.
import type { AutomationStep } from "@/db/schema/messaging";
import type { AutomationSeed } from "@/features/registry";
import type { EngineStep } from "../schedule";

const step = (s: EngineStep): AutomationStep => s;
const steps = (...s: EngineStep[]): AutomationStep[] => s.map(step);

const C = "customer";
const PREF = "customer_preferred";
const JOB_SCHED = "job.scheduled|job.return_visit_scheduled|job.rescheduled";

export const builtinAutomationList: AutomationSeed[] = [
  // ------------------------------------------------------------ leads
  {
    key: "lead_ack",
    name: "Lead auto-reply",
    description:
      "Texts new leads right away (after-hours text outside business hours). Not leads typed in during a call.",
    triggerEvent: "lead.created",
    // Phone-entered leads are answered at once (status contacted, leads-flow fix
    // "phone leads count as answered"): the missed-lead automations skip them.
    conditions: { field: "lead.status", op: "eq", value: "new" },
    steps: steps({ channel: PREF, audience: C, template_key: "lead.ack" }),
    // Any human handling makes the auto-reply moot (an outbox card left waiting after
    // the lead was booked, QA T2-16). The sender also re-checks the lead is still new.
    cancelOn: ["lead.responded", "lead.converted", "lead.status_changed"],
    featureFlag: "leads",
  },
  {
    key: "lead_alert",
    name: "New lead alert",
    triggerEvent: "lead.created",
    steps: steps({
      channel: "push",
      audience: "perm:leads.receive_alerts",
      template_key: "staff.new_lead",
    }),
    featureFlag: "leads",
  },
  {
    key: "lead_escalate_5",
    name: "Lead not answered in 5 min",
    triggerEvent: "lead.created",
    conditions: { field: "lead.status", op: "eq", value: "new" },
    steps: steps({
      delay: { minutes: 5 },
      channel: "push",
      audience: "admins",
      template_key: "staff.lead_sla",
    }),
    cancelOn: ["lead.responded", "lead.converted"],
    featureFlag: "leads",
  },
  {
    key: "lead_escalate_15",
    name: "Lead not answered in 15 min",
    triggerEvent: "lead.created",
    conditions: { field: "lead.status", op: "eq", value: "new" },
    steps: steps({
      delay: { minutes: 15 },
      channel: "push",
      audience: "perm:leads.receive_alerts",
      template_key: "staff.lead_sla",
    }),
    cancelOn: ["lead.responded", "lead.converted"],
    featureFlag: "leads",
  },
  {
    key: "lead_not_reached",
    name: "Couldn't reach a lead",
    description:
      "Texts the lead after 1 h, next morning 9:00 and after 3 days. Not leads typed in during a call; a wrong number stops it.",
    triggerEvent: "lead.created",
    conditions: { field: "lead.status", op: "eq", value: "new" },
    steps: steps(
      {
        delay: { hours: 1 },
        channel: "sms",
        audience: C,
        template_key: "lead.not_reached",
      },
      {
        delay: { days: 1 },
        at: "09:00",
        channel: "sms",
        audience: C,
        template_key: "lead.not_reached",
      },
      {
        delay: { days: 3 },
        channel: "sms",
        audience: C,
        template_key: "lead.not_reached",
      },
    ),
    // A connected call means we reached them (QA T6-04). Any call attempt moves the
    // lead to `contacted`, so "reached" is a connected call, not the status; the sender
    // re-checks it before every send (`lead.reached`).
    cancelOn: [
      "lead.converted",
      "message.received",
      {
        event: "lead.status_changed",
        when: {
          field: "event.to",
          op: "in",
          value: ["booked", "lost", "spam", "qualified"],
        },
      },
      {
        event: "lead.responded",
        when: { field: "lead.reached", op: "eq", value: true },
      },
      {
        event: "lead.status_changed",
        when: { field: "lead.reached", op: "eq", value: true },
      },
    ],
    featureFlag: "leads",
  },
  // ------------------------------------------------------------ booking & reminders
  {
    key: "booking_confirm",
    name: "Booking confirmation",
    description:
      "Includes the service-call fee and the cancellation policy summary.",
    triggerEvent: "job.scheduled|job.return_visit_scheduled",
    steps: steps({
      channel: PREF,
      audience: C,
      template_key: "job.booked",
      dedupe: "event",
    }),
  },
  {
    key: "tech_assigned",
    name: "Tech assigned",
    triggerEvent: "job.assigned",
    steps: steps({
      channel: "push",
      audience: "added_techs",
      template_key: "staff.job_assigned",
      dedupe: "event",
    }),
  },
  {
    key: "deposit_request",
    name: "Deposit request",
    description:
      "Texts deposits the rules ask for (now and 24 h later). A deposit the office asks for is sent by the office.",
    triggerEvent: "deposit.required",
    // QA2: one text per request. Office requests (requestDeposit) send their own
    // link ("Send the link now" / "Send link") and carry office_request: true.
    conditions: {
      all: [{ field: "event.office_request", op: "neq", value: true }],
    },
    steps: steps(
      { channel: PREF, audience: C, template_key: "deposit.request" },
      {
        delay: { hours: 24 },
        channel: PREF,
        audience: C,
        template_key: "deposit.request",
      },
    ),
    cancelOn: ["deposit.paid", "job.cancelled"],
    featureFlag: "deposits",
  },
  {
    key: "reminder_24h",
    name: "24-hour reminder",
    description:
      "Reply C to confirm or R to reschedule. Re-created when the job moves.",
    triggerEvent: JOB_SCHED,
    conditions: {
      all: [
        { field: "job.status", op: "in", value: ["scheduled", "confirmed"] },
      ],
    },
    steps: steps({
      anchor: "job.window_start",
      delay: { hours: -24 },
      channel: PREF,
      audience: C,
      template_key: "job.reminder_24h",
    }),
    cancelOn: ["job.cancelled"],
  },
  {
    key: "unconfirmed_flag",
    name: "Unconfirmed tomorrow",
    description:
      "Tells the office at 9:00 the day before when a customer hasn't confirmed.",
    triggerEvent: JOB_SCHED,
    conditions: {
      all: [{ field: "job.status", op: "eq", value: "scheduled" }],
    },
    steps: steps({
      anchor: "job.window_start",
      delay: { days: -1 },
      at: "09:00",
      channel: "push+in_app",
      audience: "office",
      template_key: "staff.unconfirmed",
    }),
    cancelOn: ["job.confirmed", "job.cancelled"],
  },
  {
    key: "reminder_2h",
    name: "2-hour heads-up",
    triggerEvent: JOB_SCHED,
    conditions: {
      all: [
        { field: "job.status", op: "in", value: ["scheduled", "confirmed"] },
      ],
    },
    steps: steps({
      anchor: "job.window_start",
      delay: { hours: -2 },
      channel: "sms",
      audience: C,
      template_key: "job.reminder_2h",
    }),
    cancelOn: ["job.cancelled", "job.en_route"],
  },
  {
    key: "on_my_way",
    name: "On my way",
    description: "Sent from the tech's outbox; allowed outside quiet hours.",
    triggerEvent: "job.en_route",
    steps: steps({
      channel: "sms",
      audience: C,
      template_key: "job.on_my_way",
      dedupe: "event",
    }),
    cancelOn: ["job.arrived", "job.cancelled"],
  },
  {
    key: "running_late",
    name: "Running late",
    triggerEvent: "job.running_late",
    steps: steps({
      channel: "sms",
      audience: C,
      template_key: "job.running_late",
      dedupe: "event",
    }),
    cancelOn: ["job.arrived", "job.cancelled"],
  },
  {
    key: "late_prompt",
    name: "Late prompt for the tech",
    triggerEvent: JOB_SCHED,
    conditions: {
      all: [
        { field: "job.status", op: "in", value: ["scheduled", "confirmed"] },
      ],
    },
    steps: steps({
      anchor: "job.window_end",
      delay: { minutes: -15 },
      channel: "push",
      audience: "assigned_tech",
      template_key: "staff.late_prompt",
    }),
    cancelOn: ["job.en_route", "job.arrived", "job.cancelled"],
  },
  {
    key: "reschedule_notice",
    name: "Reschedule notice",
    triggerEvent: "job.rescheduled",
    steps: steps({
      channel: PREF,
      audience: C,
      template_key: "job.rescheduled",
      dedupe: "event",
    }),
    cancelOn: ["job.cancelled"],
  },
  {
    key: "return_visit_notice",
    name: "Return visit notice",
    triggerEvent: "job.return_visit_scheduled",
    steps: steps({
      channel: PREF,
      audience: C,
      template_key: "job.return_visit",
      dedupe: "event",
    }),
    cancelOn: ["job.cancelled"],
  },
  {
    key: "cancel_notice",
    name: "Cancellation notice",
    triggerEvent: "job.cancelled",
    conditions: {
      all: [{ field: "event.after_arrival", op: "neq", value: true }],
    },
    steps: steps({ channel: PREF, audience: C, template_key: "job.cancelled" }),
  },
  {
    key: "post_cancel_verify",
    name: "Post-cancel verification",
    description:
      "Asks the customer whether the work was done (cancel after arrival).",
    triggerEvent: "job.cancelled",
    conditions: {
      all: [{ field: "event.after_arrival", op: "eq", value: true }],
    },
    steps: steps({
      delay: { hours: 2 },
      channel: "sms",
      audience: C,
      template_key: "job.cancel_verify",
    }),
  },
  {
    key: "reschedule_request_alert",
    name: "Reschedule request alert",
    triggerEvent: "job.reschedule_requested",
    steps: steps({
      channel: "push+in_app",
      audience: "office",
      template_key: "staff.reschedule_requested",
      dedupe: "event",
    }),
    cancelOn: ["job.rescheduled"],
  },
  {
    key: "tech_job_changed",
    name: "Job changed (tech)",
    triggerEvent: "job.rescheduled|job.cancelled|job.assigned",
    steps: steps(
      {
        only_on: ["job.rescheduled", "job.cancelled"],
        channel: "push",
        audience: "event_techs",
        template_key: "staff.job_changed",
        dedupe: "event",
      },
      {
        only_on: ["job.assigned"],
        channel: "push",
        audience: "removed_techs",
        template_key: "staff.job_changed",
        dedupe: "event",
      },
    ),
  },
  {
    key: "tech_daily_agenda",
    name: "Tech daily agenda",
    description: "07:00 push to techs with at least one job today.",
    triggerEvent: "schedule.daily",
    steps: steps({
      anchor: "fixed_time_local 07:00",
      channel: "push",
      audience: "role:tech",
      template_key: "staff.daily_agenda",
    }),
  },
  {
    key: "start_approval",
    name: "Start approval needed",
    triggerEvent: "job.start_approval_requested",
    steps: steps({
      channel: "push",
      audience: "perm:jobs.approve_start",
      template_key: "staff.start_approval",
      dedupe: "event",
    }),
    cancelOn: ["job.start_approved", "job.start_denied"],
  },
  {
    key: "start_decided",
    name: "Start approval decided",
    triggerEvent: "job.start_approved|job.start_denied",
    steps: steps({
      channel: "push",
      audience: "assigned_tech",
      template_key: "staff.start_decided",
      dedupe: "event",
    }),
  },
  // ------------------------------------------------------------ completion & money
  {
    key: "job_completed_invoice",
    name: "Invoice after the job",
    description: "Invoice link with photos when the job is completed.",
    triggerEvent: "job.completed",
    conditions: { all: [{ field: "event.invoice_id", op: "exists" }] },
    steps: steps({ channel: PREF, audience: C, template_key: "job.completed" }),
    cancelOn: ["invoice.paid"],
  },
  {
    key: "payment_receipt",
    name: "Payment receipt",
    description: "Every payment method gets a receipt (plus an email copy).",
    triggerEvent: "payment.succeeded",
    steps: steps({
      channel: `${PREF}+email`,
      audience: C,
      template_key: "payment.receipt",
    }),
  },
  {
    key: "invoice_sent",
    name: "Invoice sent",
    description:
      "Only for invoices issued by hand (completion already sends one).",
    triggerEvent: "invoice.issued",
    conditions: { all: [{ field: "event.via", op: "eq", value: "manual" }] },
    steps: steps({ channel: PREF, audience: C, template_key: "invoice.sent" }),
    cancelOn: ["invoice.paid", "invoice.voided"],
  },
  {
    key: "dunning",
    name: "Payment reminders",
    description: "3, 7 and 14 days after the due date while a balance remains.",
    triggerEvent: "invoice.issued",
    steps: steps(
      {
        anchor: "invoice.due_at|event_time",
        delay: { days: 3 },
        at: "10:00",
        channel: PREF,
        audience: C,
        template_key: "invoice.reminder_1",
      },
      {
        anchor: "invoice.due_at|event_time",
        delay: { days: 7 },
        at: "10:00",
        channel: PREF,
        audience: C,
        template_key: "invoice.reminder_2",
      },
      {
        anchor: "invoice.due_at|event_time",
        delay: { days: 14 },
        at: "10:00",
        channel: PREF,
        audience: C,
        template_key: "invoice.reminder_3",
      },
    ),
    cancelOn: ["invoice.paid", "invoice.voided", "dispute.created"],
  },
  {
    key: "deposit_paid_staff",
    name: "Deposit paid",
    triggerEvent: "deposit.paid",
    steps: steps({
      channel: "push",
      audience: "office+assigned_tech",
      template_key: "staff.deposit_paid",
    }),
    featureFlag: "deposits",
  },
  {
    key: "hold_expiring",
    name: "Card hold expiring",
    triggerEvent: "deposit.hold_expiring",
    steps: steps({
      channel: "push",
      audience: "admins",
      template_key: "staff.hold_expiring",
    }),
    cancelOn: ["deposit.paid"],
    featureFlag: "deposits",
  },
  {
    key: "refund_notice",
    name: "Refund notice",
    description:
      "Tells the customer the refund amount and the 5-10 day bank delay.",
    triggerEvent: "refund.succeeded",
    steps: steps({ channel: PREF, audience: C, template_key: "refund.issued" }),
  },
  {
    key: "refund_due",
    name: "Promised refund due",
    triggerEvent: "refund.due",
    steps: steps({
      channel: "push",
      audience: "admins",
      template_key: "staff.refund_due",
    }),
    cancelOn: ["refund.succeeded"],
  },
  {
    key: "payment_failed_alert",
    name: "Payment failed",
    triggerEvent: "payment.failed",
    steps: steps({
      channel: "push",
      audience: "office",
      template_key: "staff.payment_failed",
    }),
    cancelOn: ["payment.succeeded"],
  },
  {
    key: "manual_unverified_alert",
    name: "Unverified manual payments",
    triggerEvent: "payment.manual_unverified",
    steps: steps({
      channel: "in_app",
      audience: "perm:payments.verify_manual",
      template_key: "staff.manual_unverified",
      dedupe: "batch",
      batch_minutes: 60,
    }),
  },
  {
    key: "receipt_flag_alert",
    name: "Receipt flagged by customer",
    triggerEvent: "payment.customer_flagged",
    steps: steps({
      channel: "push+email",
      audience: "admins",
      template_key: "staff.receipt_flagged",
      dedupe: "event",
    }),
  },
  {
    key: "dispute_alert",
    name: "Chargeback alert",
    description:
      "On arrival, then 3 days and 1 day before the response deadline.",
    triggerEvent: "dispute.created",
    steps: steps(
      {
        channel: "push+email",
        audience: "admins",
        template_key: "staff.dispute",
      },
      {
        anchor: "dispute.due_by",
        delay: { days: -3 },
        channel: "push",
        audience: "admins",
        template_key: "staff.dispute",
      },
      {
        anchor: "dispute.due_by",
        delay: { days: -1 },
        channel: "push+email",
        audience: "admins",
        template_key: "staff.dispute",
      },
    ),
    cancelOn: ["dispute.closed", "dispute.evidence_submitted"],
  },
  {
    key: "efw_alert",
    name: "Early fraud warning",
    triggerEvent: "efw.created",
    steps: steps({
      channel: "push+email",
      audience: "admins",
      template_key: "staff.efw",
    }),
  },
  // ------------------------------------------------------------ estimates
  {
    key: "estimate_followup",
    name: "Estimate follow-ups",
    description:
      "2 hours, 2, 5 and 10 days after sending, until approved or declined.",
    triggerEvent: "estimate.sent",
    conditions: {
      all: [{ field: "estimate.status", op: "in", value: ["sent", "viewed"] }],
    },
    steps: steps(
      {
        delay: { hours: 2 },
        channel: PREF,
        audience: C,
        template_key: "estimate.followup_1",
      },
      {
        delay: { days: 2 },
        at: "10:00",
        channel: PREF,
        audience: C,
        template_key: "estimate.followup_2",
      },
      {
        delay: { days: 5 },
        at: "10:00",
        channel: PREF,
        audience: C,
        template_key: "estimate.followup_3",
      },
      {
        delay: { days: 10 },
        at: "10:00",
        channel: PREF,
        audience: C,
        template_key: "estimate.followup_4",
      },
    ),
    cancelOn: [
      "estimate.approved",
      "estimate.declined",
      "estimate.expired",
      { event: "message.received", scope: "customer" },
    ],
    featureFlag: "estimates",
  },
  {
    key: "estimate_closeout",
    name: "Estimate close-out",
    triggerEvent: "estimate.sent",
    conditions: {
      all: [
        {
          field: "estimate.status",
          op: "in",
          value: ["sent", "viewed", "expired"],
        },
      ],
    },
    steps: steps({
      delay: { days: 30 },
      at: "10:00",
      channel: PREF,
      audience: C,
      template_key: "estimate.closeout",
    }),
    cancelOn: [
      "estimate.approved",
      "estimate.declined",
      { event: "message.received", scope: "customer" },
    ],
    featureFlag: "estimates",
  },
  {
    key: "estimate_viewed_staff",
    name: "Estimate viewed",
    description: "First view only.",
    triggerEvent: "estimate.viewed",
    steps: steps({
      channel: "push",
      audience: "creator",
      template_key: "staff.estimate_viewed",
    }),
    featureFlag: "estimates",
  },
  {
    key: "estimate_approved_staff",
    name: "Estimate approved",
    triggerEvent: "estimate.approved",
    steps: steps({
      channel: "push",
      audience: "creator+office",
      template_key: "staff.estimate_approved",
    }),
    featureFlag: "estimates",
  },
  // ------------------------------------------------------------ reviews & after-care
  {
    key: "review_request",
    name: "Review request",
    description:
      "After a paid job (or once it's paid). Sentiment-neutral; max two asks per job.",
    triggerEvent: "job.completed",
    steps: steps({
      delay: { minutes: 90 },
      channel: PREF,
      audience: C,
      template_key: "review.request",
    }),
    cancelOn: ["review.clicked", "job.cancelled", "dispute.created"],
    featureFlag: "reviews",
  },
  {
    key: "review_reminder",
    name: "Review reminder",
    triggerEvent: "review.requested",
    steps: steps({
      delay: { days: 3 },
      at: "11:00",
      channel: PREF,
      audience: C,
      template_key: "review.reminder",
    }),
    cancelOn: ["review.clicked", "review.rated", "dispute.created"],
    featureFlag: "reviews",
  },
  {
    key: "low_rating_alert",
    name: "Low rating alert",
    triggerEvent: "review.rated",
    conditions: { all: [{ field: "event.rating", op: "lte", value: 3 }] },
    steps: steps({
      channel: "push",
      audience: "admins",
      template_key: "staff.low_rating",
    }),
    featureFlag: "reviews",
  },
  {
    key: "checkin_7d",
    name: "7-day check-in",
    triggerEvent: "job.completed",
    steps: steps({
      delay: { days: 7 },
      at: "10:00",
      channel: PREF,
      audience: C,
      template_key: "job.checkin",
    }),
    cancelOn: [
      "job.cancelled",
      { event: "message.received", scope: "customer" },
    ],
  },
  {
    key: "maintenance",
    name: "Maintenance reminder",
    description:
      "Marketing consent only. Sent N months after the job, per the service type's maintenance interval.",
    triggerEvent: "job.completed",
    conditions: {
      all: [
        {
          field: "service_type.maintenance_interval_months",
          op: "gt",
          value: 0,
        },
      ],
    },
    steps: steps(
      {
        delay_months_field: "service_type.maintenance_interval_months",
        at: "10:00",
        channel: "sms",
        audience: C,
        template_key: "marketing.maintenance",
      },
      {
        delay_months_field: "service_type.maintenance_interval_months",
        at: "10:00",
        channel: "email",
        audience: C,
        template_key: "marketing.maintenance",
      },
    ),
    cancelOn: [{ event: "job.created", scope: "customer" }],
  },
  // ------------------------------------------------------------ team, pay, fleet, tools
  {
    key: "approval_needed",
    name: "Approval needed",
    description: "Batched every 15 minutes per approver.",
    triggerEvent:
      "vehicle.log_submitted|part_purchase.submitted|job.cancel_review_requested",
    steps: steps(
      {
        only_on: ["vehicle.log_submitted"],
        channel: "push",
        audience: "perm:vehicles.log_approve",
        template_key: "staff.approval_needed",
        dedupe: "batch",
        batch_minutes: 15,
      },
      {
        only_on: ["part_purchase.submitted"],
        channel: "push",
        audience: "perm:parts.approve_reimbursement",
        template_key: "staff.approval_needed",
        dedupe: "batch",
        batch_minutes: 15,
      },
      {
        only_on: ["job.cancel_review_requested"],
        channel: "push",
        audience: "perm:jobs.review_cancellations",
        template_key: "staff.approval_needed",
        dedupe: "batch",
        batch_minutes: 15,
      },
    ),
  },
  {
    key: "reimbursement_decided",
    name: "Receipt decided",
    triggerEvent: "part_purchase.approved|part_purchase.rejected",
    steps: steps({
      channel: "push",
      audience: "subject_user",
      template_key: "staff.reimbursement_decided",
      dedupe: "event",
    }),
  },
  {
    key: "cash_over_limit",
    name: "Cash over limit",
    triggerEvent: "cash.over_limit",
    steps: steps({
      channel: "push",
      audience: "admins+subject_user",
      template_key: "staff.cash_over_limit",
      dedupe: "event",
    }),
    cancelOn: [{ event: "cash.received", scope: "subject_user" }],
    featureFlag: "payroll",
  },
  {
    key: "cash_discrepancy",
    name: "Cash count mismatch",
    triggerEvent: "cash.discrepancy_declared",
    steps: steps({
      channel: "push",
      audience: "perm:cash.receive",
      template_key: "staff.cash_discrepancy",
      dedupe: "event",
    }),
    featureFlag: "payroll",
  },
  {
    key: "settlement_ready",
    name: "Pay statement ready",
    triggerEvent: "settlement.ready_for_review",
    steps: steps({
      channel: "push",
      audience: "subject_user",
      template_key: "staff.settlement_ready",
    }),
    featureFlag: "payroll",
  },
  {
    key: "settlement_flagged",
    name: "Statement flagged",
    triggerEvent: "settlement.flagged",
    steps: steps({
      channel: "push",
      audience: "perm:payroll.manage",
      template_key: "staff.settlement_flagged",
      dedupe: "event",
    }),
    featureFlag: "payroll",
  },
  {
    key: "payout_sent",
    name: "Payout sent",
    triggerEvent: "settlement.paid",
    steps: steps({
      channel: "push+email",
      audience: "subject_user",
      template_key: "staff.payout_sent",
    }),
    featureFlag: "payroll",
  },
  {
    key: "comp_agreement_required",
    name: "Pay agreement to sign",
    triggerEvent: "comp_agreement.required",
    steps: steps(
      {
        channel: "push",
        audience: "subject_user",
        template_key: "staff.comp_agreement",
        dedupe: "event",
      },
      {
        delay: { days: 2 },
        at: "09:00",
        channel: "push",
        audience: "subject_user",
        template_key: "staff.comp_agreement",
        dedupe: "event",
      },
    ),
    cancelOn: [
      {
        event: "signature.captured",
        when: { field: "event.doc_type", op: "eq", value: "comp_agreement" },
        scope: "actor_user",
      },
    ],
    featureFlag: "payroll",
  },
  {
    key: "bank_changed_alert",
    name: "Bank details changed",
    triggerEvent: "user.bank_changed",
    steps: steps({
      channel: "push+email",
      audience: "perm:payroll.payout+subject_user",
      template_key: "staff.bank_changed",
      dedupe: "event",
    }),
    featureFlag: "payroll",
  },
  {
    key: "vehicle_due",
    name: "Vehicle service due",
    triggerEvent: "vehicle.reminder_due",
    steps: steps({
      channel: "push",
      audience: "vehicle_assignee+admins",
      template_key: "staff.vehicle_due",
      dedupe: "event",
    }),
    featureFlag: "vehicles",
  },
  {
    key: "doc_expiring",
    name: "Vehicle document expiring",
    triggerEvent: "vehicle.document_expiring",
    steps: steps({
      channel: "push+email",
      audience: "admins",
      template_key: "staff.doc_expiring",
      dedupe: "event",
    }),
    featureFlag: "vehicles",
  },
  {
    key: "vehicle_issue_alert",
    name: "Vehicle issue reported",
    triggerEvent: "vehicle.issue_reported",
    steps: steps(
      {
        channel: "push",
        audience: "admins",
        template_key: "staff.vehicle_issue",
      },
      {
        channel: "email",
        audience: "admins",
        template_key: "staff.vehicle_issue",
        when: { field: "event.severity", op: "eq", value: "unsafe" },
      },
    ),
    featureFlag: "vehicles",
  },
  {
    key: "tool_audit_due",
    name: "Tool check due",
    triggerEvent: "tool.audit_due",
    steps: steps(
      {
        channel: "push",
        audience: "subject_user",
        template_key: "staff.tool_audit_due",
      },
      {
        delay: { days: 2 },
        at: "08:00",
        channel: "push",
        audience: "subject_user",
        template_key: "staff.tool_audit_due",
      },
    ),
    cancelOn: ["tool.audit_submitted"],
    featureFlag: "tools",
  },
  {
    key: "tool_incident_alert",
    name: "Tool incident",
    triggerEvent: "tool.incident",
    steps: steps({
      channel: "push",
      audience: "perm:tools.audit_review",
      template_key: "staff.tool_incident",
    }),
    featureFlag: "tools",
  },
  {
    key: "tool_maintenance_due",
    name: "Tool maintenance due",
    triggerEvent: "tool.maintenance_due",
    steps: steps({
      channel: "push",
      audience: "subject_user",
      template_key: "staff.tool_maintenance_due",
      dedupe: "event",
    }),
    featureFlag: "tools",
  },
  {
    key: "task_due",
    name: "Task due",
    triggerEvent: "task.due",
    steps: steps({
      channel: "push",
      audience: "subject_user",
      template_key: "staff.task_due",
      dedupe: "event",
    }),
  },
  {
    key: "message_failed_alert",
    name: "Message failed",
    triggerEvent: "message.failed",
    steps: steps({
      channel: "in_app",
      audience: "office",
      template_key: "staff.message_failed",
    }),
  },
  {
    key: "daily_digest",
    name: "Daily ops digest",
    description:
      "07:30: today's jobs, unconfirmed, overdue invoices, approvals.",
    triggerEvent: "digest.daily",
    steps: steps({
      channel: "push+email",
      audience: "admins+office",
      template_key: "staff.daily_digest",
      dedupe: "event",
    }),
  },
];
