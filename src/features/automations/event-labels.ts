// Plain-words names for domain events (automation triggers and cancel rules), so the
// settings screens never show raw keys like `job.return_visit_scheduled` (QA T4-26).
// Pure and client-safe; unknown keys fall back to a humanized form of the key.

const LABELS: Record<string, string> = {
  "schedule.daily": "Every morning",
  "lead.created": "New lead",
  "lead.touched": "Lead asked again",
  "lead.responded": "Someone answered the lead",
  "lead.sla_breached": "Lead waiting too long",
  "lead.status_changed": "Lead status changes",
  "lead.converted": "Lead booked",
  "customer.created": "New customer",
  "customer.merged": "Customers merged",
  "consent.changed": "Texting consent changes",
  "job.created": "Job created",
  "job.scheduled": "Job booked",
  "job.rescheduled": "Job rescheduled",
  "job.assigned": "Tech assigned",
  "job.confirmed": "Customer confirms",
  "job.reschedule_requested": "Customer asks to reschedule",
  "job.en_route": "Tech on the way",
  "job.running_late": "Tech running late",
  "job.arrived": "Tech arrived",
  "job.started": "Work started",
  "job.on_hold": "Job on hold",
  "job.return_visit_scheduled": "Return visit booked",
  "job.completed": "Job completed",
  "job.closed": "Job closed",
  "job.cancelled": "Job cancelled",
  "job.callback_created": "Callback visit created",
  "job.start_approval_requested": "Tech asks to start",
  "job.start_approved": "Start approved",
  "job.start_denied": "Start denied",
  "job.cancel_review_requested": "Cancellation needs review",
  "estimate.sent": "Estimate sent",
  "estimate.viewed": "Estimate opened",
  "estimate.approved": "Estimate approved",
  "estimate.declined": "Estimate declined",
  "estimate.expired": "Estimate expired",
  "change_order.approved": "Change order approved",
  "invoice.issued": "Invoice sent",
  "invoice.lines_changed": "Draft invoice items changed",
  "invoice.overdue": "Invoice overdue",
  "invoice.paid": "Invoice paid",
  "invoice.voided": "Invoice voided",
  "invoice.viewed": "Invoice opened",
  "signature.captured": "Signature captured",
  "deposit.required": "Deposit needed",
  "deposit.paid": "Deposit paid",
  "deposit.hold_expiring": "Card hold expiring",
  "payment.succeeded": "Payment received",
  "payment.failed": "Payment failed",
  "payment.fee_updated": "Card fee confirmed",
  "payment.manual_unverified": "Cash or check not verified",
  "payment.customer_flagged": "Customer flags a receipt",
  "refund.due": "Refund promised",
  "refund.succeeded": "Refund issued",
  "dispute.created": "Chargeback opened",
  "dispute.closed": "Chargeback closed",
  "dispute.evidence_submitted": "Chargeback evidence sent",
  "efw.created": "Fraud warning",
  "message.received": "Customer replies",
  "message.failed": "Message failed",
  "review.requested": "Review asked",
  "review.clicked": "Review link opened",
  "review.rated": "Customer rates the visit",
  "reminder.due": "Custom reminder due",
  "digest.daily": "Daily summary",
  "part_purchase.submitted": "Receipt submitted",
  "part_purchase.approved": "Receipt approved",
  "part_purchase.rejected": "Receipt rejected",
  "cash.over_limit": "Cash on hand over limit",
  "cash.received": "Cash handed in",
  "cash.discrepancy_declared": "Cash count doesn't match",
  "pay_period.closed": "Pay period closed",
  "settlement.ready_for_review": "Pay statement ready",
  "settlement.flagged": "Pay statement flagged",
  "settlement.paid": "Payout sent",
  "comp_agreement.required": "Pay agreement to sign",
  "user.bank_changed": "Bank details changed",
  "vehicle.log_submitted": "Vehicle log submitted",
  "vehicle.reminder_due": "Vehicle service due",
  "vehicle.document_expiring": "Vehicle document expiring",
  "vehicle.issue_reported": "Vehicle problem reported",
  "tool.audit_due": "Tool check due",
  "tool.audit_submitted": "Tool check done",
  "tool.incident": "Tool lost or damaged",
  "tool.maintenance_due": "Tool maintenance due",
  "task.created": "Task created",
  "task.due": "Task due",
};

/** "job.return_visit_scheduled" → "Return visit booked" (or a humanized key). */
export function eventLabel(type: string): string {
  const known = LABELS[type];
  if (known) return known;
  const words = type.replace(/[._]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}

/** Multi-trigger "a|b" → "Job booked or return visit booked". */
export function triggerLabel(triggerEvent: string): string {
  return triggerEvent
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => {
      const l = eventLabel(t);
      return i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1);
    })
    .join(" or ");
}
