// Staff notification types (SPEC M22 + §7.3 internal audience rows). Client-safe data:
// drives Settings → Profile → Notifications (S35) and the delivery defaults.
// Preferences per type: "push" (default; in-app always), "email" (in-app + email),
// "off" (in-app only — the bell still shows it).

export type NotificationPref = "push" | "email" | "off";

export interface NotificationTypeDef {
  key: string;
  label: string;
  group:
    | "Leads & jobs"
    | "Money"
    | "Approvals"
    | "Team & pay"
    | "Fleet & tools"
    | "Other";
  /** Falls back to email when the user has no working push subscription (SPEC M22). */
  critical?: boolean;
}

export const NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    key: "staff.new_lead",
    label: "New lead",
    group: "Leads & jobs",
    critical: true,
  },
  { key: "staff.lead_sla", label: "Lead waiting", group: "Leads & jobs" },
  { key: "staff.lead_touched", label: "Lead came back", group: "Leads & jobs" },
  {
    key: "staff.job_assigned",
    label: "Job assigned to me",
    group: "Leads & jobs",
  },
  { key: "staff.job_changed", label: "My job changed", group: "Leads & jobs" },
  { key: "staff.daily_agenda", label: "Morning agenda", group: "Leads & jobs" },
  {
    key: "staff.unconfirmed",
    label: "Unconfirmed tomorrow",
    group: "Leads & jobs",
  },
  {
    key: "staff.late_prompt",
    label: "Running late prompt",
    group: "Leads & jobs",
  },
  {
    key: "staff.reschedule_requested",
    label: "Reschedule requests",
    group: "Leads & jobs",
  },
  {
    key: "staff.estimate_viewed",
    label: "Estimate viewed",
    group: "Leads & jobs",
  },
  {
    key: "staff.estimate_approved",
    label: "Estimate approved",
    group: "Leads & jobs",
  },
  {
    key: "staff.message_received",
    label: "New text from a customer",
    group: "Leads & jobs",
  },
  {
    key: "staff.outbox_ready",
    label: "Customer texts ready",
    group: "Leads & jobs",
  },
  {
    key: "staff.optout_review",
    label: "Possible opt-outs",
    group: "Leads & jobs",
  },
  { key: "staff.low_rating", label: "Low ratings", group: "Leads & jobs" },
  {
    key: "staff.message_failed",
    label: "Failed messages",
    group: "Leads & jobs",
  },
  { key: "staff.invoice_viewed", label: "Invoice viewed", group: "Money" },
  { key: "staff.deposit_paid", label: "Deposit paid", group: "Money" },
  { key: "staff.payment_failed", label: "Payment failed", group: "Money" },
  {
    key: "staff.manual_unverified",
    label: "Unverified payments",
    group: "Money",
  },
  { key: "staff.receipt_flagged", label: "Flagged receipts", group: "Money" },
  { key: "staff.refund_due", label: "Refund due", group: "Money" },
  { key: "staff.hold_expiring", label: "Card hold expiring", group: "Money" },
  {
    key: "staff.dispute",
    label: "Chargebacks",
    group: "Money",
    critical: true,
  },
  { key: "staff.efw", label: "Fraud warnings", group: "Money" },
  {
    key: "staff.approval_needed",
    label: "Approvals waiting",
    group: "Approvals",
  },
  {
    key: "staff.start_approval",
    label: "Start approval needed",
    group: "Approvals",
  },
  {
    key: "staff.start_decided",
    label: "Start approval decided",
    group: "Approvals",
  },
  {
    key: "staff.reimbursement_decided",
    label: "Receipt decided",
    group: "Approvals",
  },
  {
    key: "staff.cash_over_limit",
    label: "Cash over limit",
    group: "Team & pay",
    critical: true,
  },
  {
    key: "staff.cash_discrepancy",
    label: "Cash count mismatch",
    group: "Team & pay",
  },
  {
    key: "staff.remittance_request",
    label: "Cash remittance request",
    group: "Team & pay",
  },
  {
    key: "staff.settlement_ready",
    label: "Pay statement ready",
    group: "Team & pay",
    critical: true,
  },
  {
    key: "staff.settlement_flagged",
    label: "Statement flagged",
    group: "Team & pay",
  },
  { key: "staff.payout_sent", label: "Payout sent", group: "Team & pay" },
  { key: "staff.comp_agreement", label: "Pay agreement", group: "Team & pay" },
  {
    key: "staff.bank_changed",
    label: "Bank details changed",
    group: "Team & pay",
  },
  { key: "staff.task_due", label: "Task due", group: "Other" },
  {
    key: "staff.vehicle_due",
    label: "Vehicle service due",
    group: "Fleet & tools",
  },
  {
    key: "staff.doc_expiring",
    label: "Vehicle documents",
    group: "Fleet & tools",
  },
  {
    key: "staff.vehicle_issue",
    label: "Vehicle issues",
    group: "Fleet & tools",
  },
  {
    key: "staff.inspection_due",
    label: "Inspection due",
    group: "Fleet & tools",
  },
  { key: "staff.tool_audit_due", label: "Tool checks", group: "Fleet & tools" },
  {
    key: "staff.tool_incident",
    label: "Tool incidents",
    group: "Fleet & tools",
  },
  {
    key: "staff.tool_maintenance_due",
    label: "Tool maintenance",
    group: "Fleet & tools",
  },
  { key: "staff.daily_digest", label: "Daily digest", group: "Other" },
  { key: "staff.reminder", label: "Custom reminders", group: "Other" },
  { key: "staff.generic", label: "Other alerts", group: "Other" },
];

export const CRITICAL_TYPES: readonly string[] = NOTIFICATION_TYPES.filter(
  (t) => t.critical,
).map((t) => t.key);

export const PREF_LABELS: Record<NotificationPref, string> = {
  push: "Push",
  email: "Email",
  off: "In-app only",
};
