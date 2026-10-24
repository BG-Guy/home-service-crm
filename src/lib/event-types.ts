// Domain event catalog (SPEC §7.1 + BUILD_PLAN §7.1 amendments). Type-only, isomorphic.
// Every payload ALSO carries the base fields { id, at, actor_user_id }, filled by emit().
// Timestamps in payloads are ISO strings. Adding an event here is a contract change.
import type { EntityRef } from "./types";

type Id = string;
type Iso = string;
type Nullable<T> = T | null;

type ContactChannel = "call" | "sms" | "whatsapp" | "email";
type Via = "portal" | "reply" | "manual";

interface RefundPayload {
  refund_id: Id;
  payment_id: Id;
  amount_cents: number;
  invoice_id: Nullable<Id>;
  job_id: Nullable<Id>;
}

interface DisputeChangePayload {
  dispute_id: Id;
  status: string;
  outcome: Nullable<string>;
  job_id: Nullable<Id>;
  amount_cents: number;
  customer_id: Id;
}

interface PartPurchasePayload {
  part_purchase_id: Id;
  paid_by: "company" | "tech";
  total_cents: number;
  purchaser_user_id: Id;
  job_id: Nullable<Id>;
  category: string;
  approval_id: Nullable<Id>;
}

interface SettlementPayload {
  settlement_id: Id;
  user_id: Id;
}

interface TaskPayload {
  task_id: Id;
  assignee_user_id: Nullable<Id>;
  kind: string;
  title: string;
  entity_type: Nullable<string>;
  entity_id: Nullable<Id>;
}

interface TimeClockPayload {
  time_entry_id: Id;
  user_id: Id;
  vehicle_id: Nullable<Id>;
  odometer_reading_id: Nullable<Id>;
  /** YYYY-MM-DD in the company time zone. */
  date: string;
}

interface JobApprovalPayload {
  job_id: Id;
  approval_id: Id;
}

/** Event type → payload (beyond the base fields). */
export interface EventMap {
  // ---- leads (B1)
  "lead.created": {
    lead_id: Id;
    source_id: Nullable<Id>;
    customer_id: Nullable<Id>;
    service: Nullable<string>;
    is_returning: boolean;
    sms_consent: boolean;
  };
  "lead.touched": { lead_id: Id; raw_event_id: Nullable<Id> };
  "lead.responded": {
    lead_id: Id;
    user_id: Id;
    channel: ContactChannel;
    response_seconds: number;
  };
  "lead.sla_breached": { lead_id: Id; minutes: number };
  "lead.status_changed": {
    lead_id: Id;
    from: string;
    to: string;
    lost_reason?: Nullable<string>;
  };
  "lead.converted": {
    lead_id: Id;
    job_id?: Nullable<Id>;
    estimate_id?: Nullable<Id>;
  };
  // ---- customers (B1) / consent (B5)
  "customer.created": { customer_id: Id };
  "customer.updated": { customer_id: Id; fields?: string[] };
  "customer.merged": { customer_id: Id; merged_from: Id[] };
  "consent.changed": {
    customer_id: Id;
    channel: "sms" | "whatsapp" | "email";
    purpose: "transactional" | "marketing";
    action: "grant" | "revoke";
    source: string;
  };
  // ---- jobs (B2)
  "job.created": {
    job_id: Id;
    customer_id: Id;
    service_type_id: Nullable<Id>;
    priority: string;
  };
  "job.scheduled": {
    job_id: Id;
    scheduled_start: Nullable<Iso>;
    window_start: Nullable<Iso>;
    window_end: Nullable<Iso>;
    assignees: Id[];
  };
  "job.rescheduled": {
    job_id: Id;
    old_start: Nullable<Iso>;
    new_start: Nullable<Iso>;
    tech_ids: Id[];
  };
  "job.assigned": {
    job_id: Id;
    user_ids_added: Id[];
    user_ids_removed: Id[];
    tech_ids: Id[];
  };
  "job.confirmed": { job_id: Id; via: Via };
  "job.reschedule_requested": { job_id: Id; via: Via; note: Nullable<string> };
  "job.en_route": { job_id: Id; tech_id: Id; eta_minutes: number };
  "job.running_late": { job_id: Id; tech_id: Id; new_eta_minutes: number };
  "job.arrived": { job_id: Id; tech_id: Id; distance_m: Nullable<number> };
  "job.status_changed": {
    job_id: Id;
    from: string;
    to: string;
    tech_id: Nullable<Id>;
    lat: Nullable<number>;
    lng: Nullable<number>;
  };
  "job.started": { job_id: Id };
  "job.on_hold": { job_id: Id; reason: Nullable<string> };
  "job.return_visit_scheduled": {
    job_id: Id;
    visit_count: number;
    window: { start: Nullable<Iso>; end: Nullable<Iso> };
  };
  "job.completed": {
    job_id: Id;
    tech_ids: Id[];
    invoice_id: Nullable<Id>;
    completed_at: Iso;
  };
  "job.closed": { job_id: Id };
  "job.cancelled": {
    job_id: Id;
    reason: string;
    after_arrival: boolean;
    tech_ids: Id[];
  };
  "job.callback_created": { job_id: Id; original_job_id: Id; reason: string };
  "job.start_approval_requested": JobApprovalPayload;
  "job.start_approved": JobApprovalPayload;
  "job.start_denied": JobApprovalPayload;
  "job.cancel_review_requested": JobApprovalPayload;
  // ---- estimates / invoices (B3)
  "estimate.sent": { estimate_id: Id; channel: string };
  "estimate.viewed": { estimate_id: Id; token_id: Id };
  "estimate.approved": {
    estimate_id: Id;
    option_id: Id;
    signature_id: Nullable<Id>;
    channel: string;
  };
  "estimate.declined": { estimate_id: Id; reason: Nullable<string> };
  "estimate.expired": { estimate_id: Id };
  "change_order.approved": {
    change_order_id: Id;
    job_id: Id;
    delta_cents: number;
  };
  "invoice.issued": {
    invoice_id: Id;
    total_cents: number;
    due_at: Nullable<Iso>;
    /**
     * `manual`: Issue invoice (the `invoice_sent` automation texts it). `collect`:
     * "Get paid" on a draft; `send`: Send on a draft (it's texted or emailed right
     * there). Neither of those two triggers `invoice_sent`.
     */
    via: "job_completed" | "manual" | "collect" | "send";
  };
  "invoice.revised": { invoice_id: Id; version: number; reason: string };
  /** A DRAFT invoice's lines changed (added, edited or removed); deposits re-check (T6-09). */
  "invoice.lines_changed": { invoice_id: Id; job_id: Nullable<Id> };
  "invoice.overdue": { invoice_id: Id; days_overdue: number };
  "invoice.paid": { invoice_id: Id };
  "invoice.voided": { invoice_id: Id; reason: string };
  /** The customer opened an issued invoice's link for the first time (staff previews excluded). */
  "invoice.viewed": { invoice_id: Id; token_id: Id };
  "signature.captured": {
    signature_id: Id;
    doc_type: string;
    doc_id: Id;
    job_id: Nullable<Id>;
    customer_id: Nullable<Id>;
    signer_kind: "customer" | "user";
  };
  // ---- payments / disputes / media (B4)
  "deposit.required": {
    deposit_request_id: Id;
    job_id: Nullable<Id>;
    amount_cents: number;
    /**
     * Asked for by the office (payments `requestDeposit`), which sends the link itself:
     * the built-in `deposit_request` automation skips it (QA2: one text per request).
     */
    office_request?: boolean;
  };
  "deposit.paid": { deposit_request_id: Id; payment_id: Id };
  "deposit.hold_expiring": { deposit_request_id: Id; capture_before: Iso };
  "payment.succeeded": {
    payment_id: Id;
    invoice_id: Nullable<Id>;
    method: string;
    amount_cents: number;
    collected_by: Nullable<Id>;
    job_id: Nullable<Id>;
    customer_id: Id;
    kind: "deposit" | "payment" | "tip_only";
    tip_cents: number;
    deposit_request_id: Nullable<Id>;
    provider: string;
    entry_mode: Nullable<string>;
  };
  "payment.failed": { payment_id: Id; error: string };
  /**
   * A card payment's processor fee changed (QA2: the configured estimate was replaced
   * by the actual fee). Payroll recomputes the job's commission.
   */
  "payment.fee_updated": {
    payment_id: Id;
    job_id: Nullable<Id>;
    invoice_id: Nullable<Id>;
    fee_cents: number;
    previous_fee_cents: number;
  };
  "payment.manual_unverified": { payment_id: Id; age_days: number };
  "payment.customer_flagged": {
    payment_id: Id;
    customer_id: Id;
    note?: Nullable<string>;
  };
  "refund.created": RefundPayload;
  "refund.succeeded": RefundPayload;
  "refund.due": RefundPayload;
  "dispute.created": {
    dispute_id: Id;
    payment_id: Id;
    category: string;
    due_by: Nullable<Iso>;
    job_id: Nullable<Id>;
    amount_cents: number;
    customer_id: Id;
  };
  "dispute.updated": DisputeChangePayload;
  "dispute.closed": DisputeChangePayload;
  "dispute.evidence_submitted": { dispute_id: Id };
  "efw.created": { payment_id: Id; amount_cents: number };
  "photo.uploaded": { media_id: Id; job_id: Id; tag: Nullable<string> };
  // ---- messaging / reviews / notify (B5)
  "message.sent": {
    message_id: Id;
    scheduled_message_id: Nullable<Id>;
    customer_id: Nullable<Id>;
    lead_id: Nullable<Id>;
    job_id: Nullable<Id>;
    channel: string;
    template_key: Nullable<string>;
    user_id: Nullable<Id>;
    status: "sent" | "sent_manual" | "delivered";
  };
  "message.received": {
    message_id: Id;
    customer_id: Nullable<Id>;
    body: string;
  };
  "message.failed": { message_id: Id; error: string };
  "message.optout_detected": {
    message_id: Id;
    customer_id: Id;
    confidence: number;
  };
  "review.requested": { review_request_id: Id };
  "review.clicked": { review_request_id: Id };
  "review.rated": { review_request_id: Id; rating: number };
  "review.received_logged": {
    review_request_id: Id;
    job_id: Id;
    tech_user_id: Id;
  };
  "reminder.due": { reminder_id: Id };
  "digest.daily": { date: string };
  // ---- parts / payroll (B6)
  "part_purchase.submitted": PartPurchasePayload;
  "part_purchase.approved": PartPurchasePayload;
  "part_purchase.rejected": PartPurchasePayload;
  "cash.over_limit": { user_id: Id; held_cents: number; oldest_days: number };
  "cash.remitted": { remittance_id: Id; user_id?: Id };
  "cash.received": { remittance_id: Id; user_id?: Id };
  "cash.discrepancy_declared": {
    user_id: Id;
    system_cents: number;
    declared_cents: number;
  };
  "pay_period.closed": { pay_period_id: Id };
  "settlement.ready_for_review": SettlementPayload;
  "settlement.flagged": SettlementPayload;
  "settlement.approved": SettlementPayload;
  "settlement.paid": SettlementPayload;
  "comp_agreement.required": { user_id: Id; plan_key: string; version: number };
  "user.bank_changed": { user_id: Id; last4: string };
  // ---- vehicles / tools (B7)
  "vehicle.log_submitted": {
    entity_type: string;
    entity_id: Id;
    vehicle_id: Id;
    approval_id: Nullable<Id>;
  };
  "vehicle.reminder_due": { vehicle_id: Id; task: string; status: string };
  "vehicle.document_expiring": { vehicle_document_id: Id; days: number };
  "vehicle.issue_reported": { issue_id: Id; severity: string };
  "vehicle.anomaly": { vehicle_id: Id; flags: string[] };
  "tool.audit_due": { audit_id: Id; user_id: Id };
  "tool.audit_submitted": { audit_id: Id; user_id: Id };
  "tool.incident": {
    incident_id: Id;
    tool_id: Id;
    user_id: Nullable<Id>;
    kind: string;
  };
  "tool.maintenance_due": { tool_id: Id; task: string; due_on: string };
  // ---- team / auth / tasks / time
  "user.invited": { invite_id: Id; role: string };
  "user.deactivated": { user_id: Id };
  "permission.changed": {
    role?: Nullable<string>;
    user_id?: Nullable<Id>;
    perm: string;
  };
  "task.created": TaskPayload;
  "task.due": TaskPayload;
  "time.clocked_in": TimeClockPayload;
  "time.clocked_out": TimeClockPayload;
}

export type EventType = keyof EventMap;

/** Fields emit() adds to every payload. */
export interface EventBase {
  /** Event uuid (also usable as an idempotency key by handlers). */
  id: string;
  /** ISO timestamp of emission. */
  at: string;
  actor_user_id: string | null;
}

export type EventPayload<E extends EventType> = EventMap[E] & EventBase;

/** A stored event as handlers see it. */
export interface DomainEvent<E extends EventType = EventType> {
  id: number;
  type: E;
  entity: EntityRef | null;
  payload: EventPayload<E>;
  actorUserId: string | null;
  createdAt: Date;
}

/** Every event type, for coverage checks and editors (keep in sync with EventMap). */
export const EVENT_TYPES = [
  "lead.created",
  "lead.touched",
  "lead.responded",
  "lead.sla_breached",
  "lead.status_changed",
  "lead.converted",
  "customer.created",
  "customer.updated",
  "customer.merged",
  "consent.changed",
  "job.created",
  "job.scheduled",
  "job.rescheduled",
  "job.assigned",
  "job.confirmed",
  "job.reschedule_requested",
  "job.en_route",
  "job.running_late",
  "job.arrived",
  "job.status_changed",
  "job.started",
  "job.on_hold",
  "job.return_visit_scheduled",
  "job.completed",
  "job.closed",
  "job.cancelled",
  "job.callback_created",
  "job.start_approval_requested",
  "job.start_approved",
  "job.start_denied",
  "job.cancel_review_requested",
  "estimate.sent",
  "estimate.viewed",
  "estimate.approved",
  "estimate.declined",
  "estimate.expired",
  "change_order.approved",
  "invoice.issued",
  "invoice.revised",
  "invoice.lines_changed",
  "invoice.overdue",
  "invoice.paid",
  "invoice.voided",
  "invoice.viewed",
  "signature.captured",
  "deposit.required",
  "deposit.paid",
  "deposit.hold_expiring",
  "payment.succeeded",
  "payment.failed",
  "payment.fee_updated",
  "payment.manual_unverified",
  "payment.customer_flagged",
  "refund.created",
  "refund.succeeded",
  "refund.due",
  "dispute.created",
  "dispute.updated",
  "dispute.closed",
  "dispute.evidence_submitted",
  "efw.created",
  "photo.uploaded",
  "message.sent",
  "message.received",
  "message.failed",
  "message.optout_detected",
  "review.requested",
  "review.clicked",
  "review.rated",
  "review.received_logged",
  "reminder.due",
  "digest.daily",
  "part_purchase.submitted",
  "part_purchase.approved",
  "part_purchase.rejected",
  "cash.over_limit",
  "cash.remitted",
  "cash.received",
  "cash.discrepancy_declared",
  "pay_period.closed",
  "settlement.ready_for_review",
  "settlement.flagged",
  "settlement.approved",
  "settlement.paid",
  "comp_agreement.required",
  "user.bank_changed",
  "vehicle.log_submitted",
  "vehicle.reminder_due",
  "vehicle.document_expiring",
  "vehicle.issue_reported",
  "vehicle.anomaly",
  "tool.audit_due",
  "tool.audit_submitted",
  "tool.incident",
  "tool.maintenance_due",
  "user.invited",
  "user.deactivated",
  "permission.changed",
  "task.created",
  "task.due",
  "time.clocked_in",
  "time.clocked_out",
] as const satisfies readonly EventType[];

// Compile-time check: EVENT_TYPES lists every key of EventMap.
type _Missing = Exclude<EventType, (typeof EVENT_TYPES)[number]>;
const _allListed: [_Missing] extends [never] ? true : _Missing = true;
void _allListed;
