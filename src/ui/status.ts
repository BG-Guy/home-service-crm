// Status → label + tone for every status enum in SPEC §6, used by <StatusPill>.
// Type-only imports from the enum module: nothing from zod reaches the client.
// Color is never the only signal: pills always render the label text (SPEC §12.6).
import type {
  APPROVAL_STATUSES,
  CHANGE_ORDER_STATUSES,
  DEPOSIT_STATUSES,
  DISPUTE_STATUSES,
  ESTIMATE_STATUSES,
  INVOICE_STATUSES,
  JOB_PAYMENT_STATUSES,
  JOB_STATUSES,
  LEAD_STATUSES,
  MESSAGE_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  RISK_BANDS,
  SCHEDULED_MESSAGE_STATUSES,
  SETTLEMENT_FLAG_STATUSES,
  SETTLEMENT_STATUSES,
  TASK_STATUSES,
  TOOL_AUDIT_STATUSES,
  TOOL_STATUSES,
  USER_STATUSES,
  VEHICLE_ISSUE_STATUSES,
  VEHICLE_REMINDER_STATUSES,
  VEHICLE_STATUSES,
} from "@/db/enums";
import type { Tone } from "./tone";

export interface StatusDef {
  label: string;
  tone: Tone;
  /** A live, real-time state: the pill's dot pulses (M12). Keep it to field states. */
  live?: boolean;
}

type StatusMap<T extends readonly string[]> = Record<T[number], StatusDef>;
const s = (label: string, tone: Tone): StatusDef => ({ label, tone });
const live = (label: string, tone: Tone): StatusDef => ({
  label,
  tone,
  live: true,
});

export const STATUS = {
  job: {
    unscheduled: s("Unscheduled", "gray"),
    scheduled: s("Scheduled", "blue"),
    confirmed: s("Confirmed", "indigo"),
    en_route: live("On the way", "teal"),
    arrived: s("Arrived", "purple"),
    in_progress: live("In progress", "orange"),
    on_hold: s("On hold", "yellow"),
    completed: s("Completed", "green"),
    closed: s("Closed", "gray"),
    cancelled: s("Cancelled", "red"),
  } satisfies StatusMap<typeof JOB_STATUSES>,
  jobPayment: {
    none: s("Unpaid", "gray"),
    deposit_paid: s("Deposit paid", "teal"),
    partial: s("Partially paid", "orange"),
    paid: s("Paid", "green"),
    refunded: s("Refunded", "gray"),
    disputed: s("Disputed", "red"),
  } satisfies StatusMap<typeof JOB_PAYMENT_STATUSES>,
  lead: {
    new: s("New", "blue"),
    contacted: s("Contacted", "indigo"),
    qualified: s("Qualified", "purple"),
    booked: s("Booked", "green"),
    lost: s("Lost", "gray"),
    spam: s("Spam", "gray"),
  } satisfies StatusMap<typeof LEAD_STATUSES>,
  estimate: {
    draft: s("Draft", "gray"),
    sent: s("Sent", "blue"),
    viewed: s("Viewed", "indigo"),
    approved: s("Approved", "green"),
    declined: s("Declined", "red"),
    expired: s("Expired", "gray"),
  } satisfies StatusMap<typeof ESTIMATE_STATUSES>,
  changeOrder: {
    draft: s("Draft", "gray"),
    sent: s("Sent", "blue"),
    approved: s("Approved", "green"),
    declined: s("Declined", "red"),
  } satisfies StatusMap<typeof CHANGE_ORDER_STATUSES>,
  invoice: {
    draft: s("Draft", "gray"),
    issued: s("Issued", "blue"),
    partially_paid: s("Partially paid", "orange"),
    paid: s("Paid", "green"),
    void: s("Void", "gray"),
    uncollectible: s("Uncollectible", "red"),
    // Derived (not stored): issued + past due.
    overdue: s("Overdue", "red"),
  } satisfies StatusMap<typeof INVOICE_STATUSES> & Record<string, StatusDef>,
  payment: {
    pending: s("Pending", "gray"),
    authorized: s("Authorized", "indigo"),
    succeeded: s("Succeeded", "green"),
    failed: s("Failed", "red"),
    canceled: s("Canceled", "gray"),
    refunded: s("Refunded", "gray"),
    partially_refunded: s("Partially refunded", "orange"),
    disputed: s("Disputed", "red"),
    // Derived: manual payment awaiting office verification.
    unverified: s("Unverified", "orange"),
  } satisfies StatusMap<typeof PAYMENT_STATUSES> & Record<string, StatusDef>,
  refund: {
    scheduled: s("Scheduled", "gray"),
    pending: s("Pending", "orange"),
    succeeded: s("Refunded", "green"),
    failed: s("Failed", "red"),
  } satisfies StatusMap<typeof REFUND_STATUSES>,
  deposit: {
    required: s("Required", "orange"),
    requested: s("Requested", "blue"),
    paid: s("Paid", "green"),
    held: s("Held", "teal"),
    applied: s("Applied", "green"),
    refunded: s("Refunded", "gray"),
    forfeited: s("Forfeited", "red"),
    waived: s("Waived", "gray"),
    expired: s("Expired", "gray"),
  } satisfies StatusMap<typeof DEPOSIT_STATUSES>,
  dispute: {
    inquiry: s("Inquiry", "yellow"),
    needs_response: s("Needs response", "red"),
    under_review: s("Under review", "orange"),
    won: s("Won", "green"),
    lost: s("Lost", "red"),
    accepted: s("Accepted", "gray"),
    warning_closed: s("Closed (warning)", "gray"),
  } satisfies StatusMap<typeof DISPUTE_STATUSES>,
  settlement: {
    draft: s("Draft", "gray"),
    tech_review: s("Tech review", "orange"),
    approved: s("Approved", "blue"),
    paid: s("Paid", "green"),
    locked: s("Locked", "indigo"),
  } satisfies StatusMap<typeof SETTLEMENT_STATUSES>,
  settlementFlag: {
    open: s("Open", "orange"),
    resolved: s("Resolved", "green"),
    rejected: s("Rejected", "gray"),
  } satisfies StatusMap<typeof SETTLEMENT_FLAG_STATUSES>,
  /** Approval status of vehicle logs, receipts and other reviewed items. */
  approval: {
    pending: s("Pending", "orange"),
    approved: s("Approved", "green"),
    rejected: s("Rejected", "red"),
  } satisfies StatusMap<typeof APPROVAL_STATUSES>,
  vehicle: {
    active: s("Active", "green"),
    in_shop: s("In shop", "orange"),
    retired: s("Retired", "gray"),
  } satisfies StatusMap<typeof VEHICLE_STATUSES>,
  vehicleReminder: {
    ok: s("OK", "green"),
    due_soon: s("Due soon", "orange"),
    overdue: s("Overdue", "red"),
  } satisfies StatusMap<typeof VEHICLE_REMINDER_STATUSES>,
  vehicleIssue: {
    open: s("Open", "red"),
    acknowledged: s("Acknowledged", "orange"),
    in_repair: s("In repair", "yellow"),
    resolved: s("Resolved", "green"),
  } satisfies StatusMap<typeof VEHICLE_ISSUE_STATUSES>,
  tool: {
    available: s("Available", "green"),
    assigned: s("Assigned", "blue"),
    in_repair: s("In repair", "orange"),
    lost: s("Lost", "red"),
    stolen: s("Stolen", "red"),
    retired: s("Retired", "gray"),
  } satisfies StatusMap<typeof TOOL_STATUSES>,
  toolAudit: {
    scheduled: s("Scheduled", "gray"),
    in_progress: s("In progress", "orange"),
    submitted: s("Submitted", "blue"),
    reviewed: s("Reviewed", "green"),
  } satisfies StatusMap<typeof TOOL_AUDIT_STATUSES>,
  task: {
    open: s("Open", "blue"),
    done: s("Done", "green"),
    dismissed: s("Dismissed", "gray"),
  } satisfies StatusMap<typeof TASK_STATUSES>,
  user: {
    invited: s("Invited", "blue"),
    pending: s("Pending", "orange"),
    active: s("Active", "green"),
    deactivated: s("Deactivated", "gray"),
  } satisfies StatusMap<typeof USER_STATUSES>,
  risk: {
    low: s("Low risk", "green"),
    medium: s("Medium risk", "yellow"),
    high: s("High risk", "orange"),
    critical: s("Critical risk", "red"),
  } satisfies StatusMap<typeof RISK_BANDS>,
  scheduledMessage: {
    scheduled: s("Scheduled", "blue"),
    deferred_quiet: s("Quiet hours", "indigo"),
    pending_tap: s("Tap to send", "orange"),
    sent: s("Sent", "green"),
    sent_manual: s("Sent manually", "green"),
    skipped: s("Skipped", "gray"),
    delivered: s("Delivered", "green"),
    failed: s("Failed", "red"),
    canceled: s("Canceled", "gray"),
    suppressed_optout: s("Opted out", "gray"),
    expired: s("Expired", "gray"),
  } satisfies StatusMap<typeof SCHEDULED_MESSAGE_STATUSES>,
  message: {
    queued: s("Queued", "gray"),
    sent: s("Sent", "blue"),
    sent_manual: s("Sent manually", "blue"),
    delivered: s("Delivered", "green"),
    failed: s("Failed", "red"),
    received: s("Received", "indigo"),
    logged: s("Logged", "gray"),
  } satisfies StatusMap<typeof MESSAGE_STATUSES>,
} as const;

export type StatusKind = keyof typeof STATUS;

/** "needs_response" → "Needs response" (fallback for unknown values). */
export function humanize(value: string): string {
  const t = value.replace(/[_-]+/g, " ").trim();
  return t ? t[0]?.toUpperCase() + t.slice(1) : value;
}

/** Look up a status; unknown values degrade to a gray, humanized label. */
export function statusDef(kind: StatusKind, status: string): StatusDef {
  const map = STATUS[kind] as Record<string, StatusDef>;
  return map[status] ?? { label: humanize(status), tone: "gray" };
}

/** True for live, real-time states (job on the way / in progress): pulse the dot. */
export function isLiveStatus(kind: StatusKind, status: string): boolean {
  return statusDef(kind, status).live === true;
}
