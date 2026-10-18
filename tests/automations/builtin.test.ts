// Built-in catalog coverage (BUILD_PLAN §12 step 4): every §7.3 automation and every
// Appendix B template exists; every step is valid; customer texts are GSM-7, link-safe
// and review texts pass the incentive linter.
import { describe, expect, it } from "vitest";
import {
  builtinAutomations,
  builtinTemplates,
} from "@/features/automations/builtin";
import { validateConditions } from "@/features/automations/conditions";
import { normalizeCancelOn } from "@/features/automations/engine-shared";
import {
  type EngineStep,
  parseAnchor,
  splitPlus,
  splitTriggers,
} from "@/features/automations/schedule";
import {
  AUDIENCE_OPTIONS,
  CHANNEL_OPTIONS,
} from "@/features/automations/variables";
import { lintLinks, smsSegments } from "@/features/messaging/lint";
import { lintReviewTemplate } from "@/features/reviews/lint";
import { EVENT_TYPES } from "@/lib/event-types";

const SPEC_73 = [
  "lead_ack",
  "lead_alert",
  "lead_escalate_5",
  "lead_escalate_15",
  "lead_not_reached",
  "booking_confirm",
  "tech_assigned",
  "deposit_request",
  "reminder_24h",
  "unconfirmed_flag",
  "reminder_2h",
  "on_my_way",
  "running_late",
  "late_prompt",
  "job_completed_invoice",
  "payment_receipt",
  "dunning",
  "estimate_followup",
  "estimate_closeout",
  "review_request",
  "review_reminder",
  "checkin_7d",
  "post_cancel_verify",
  "maintenance",
  "refund_due",
  "dispute_alert",
  "cash_over_limit",
  "settlement_ready",
  "vehicle_due",
  "doc_expiring",
  "tool_audit_due",
  "approval_needed",
  "start_approval",
  "start_decided",
  "reschedule_notice",
  "return_visit_notice",
  "cancel_notice",
  "reschedule_request_alert",
  "tech_job_changed",
  "tech_daily_agenda",
  "estimate_viewed_staff",
  "estimate_approved_staff",
  "invoice_sent",
  "deposit_paid_staff",
  "hold_expiring",
  "refund_notice",
  "efw_alert",
  "payment_failed_alert",
  "manual_unverified_alert",
  "receipt_flag_alert",
  "low_rating_alert",
  "message_failed_alert",
  "reimbursement_decided",
  "settlement_flagged",
  "payout_sent",
  "comp_agreement_required",
  "bank_changed_alert",
  "vehicle_issue_alert",
  "tool_incident_alert",
  "tool_maintenance_due",
  "cash_discrepancy",
  "task_due",
  "daily_digest",
];
const APPENDIX_B = [
  "lead.ack_after_hours",
  "lead.no_answer",
  "estimate.sent",
  "change_order.sent",
  "invoice.pay_link",
  "job.link",
  "user.invite",
  "user.password_reset",
  "staff.generic",
  "staff.lead_touched",
  "staff.remittance_request",
  "staff.optout_review",
  "staff.inspection_due",
];
const keys = new Set(builtinTemplates.map((t) => t.key));
const triggers = new Set<string>([...EVENT_TYPES, "schedule.daily"]);
const channels = new Set(CHANNEL_OPTIONS.map((c) => c.value));
const audiences = new Set(AUDIENCE_OPTIONS.map((a) => a.value));

describe("built-in automations", () => {
  it("cover every §7.3 row", () => {
    const have = new Set(builtinAutomations.map((a) => a.key));
    expect(SPEC_73.filter((k) => !have.has(k))).toEqual([]);
  });
  it("keys are unique", () => {
    expect(new Set(builtinAutomations.map((a) => a.key)).size).toBe(
      builtinAutomations.length,
    );
  });
  it.each(
    builtinAutomations.map((a) => [a.key, a] as const),
  )("%s is valid", (_k, a) => {
    for (const t of splitTriggers(a.triggerEvent))
      expect(triggers.has(t), t).toBe(true);
    expect(validateConditions(a.conditions ?? {})).toEqual([]);
    for (const r of normalizeCancelOn(a.cancelOn ?? []))
      expect(triggers.has(r.event), r.event).toBe(true);
    for (const s of a.steps as EngineStep[]) {
      for (const part of (s.anchor ?? "event_time").split("|"))
        expect(() => parseAnchor(part)).not.toThrow();
      for (const c of splitPlus(s.channel))
        expect(channels.has(c), c).toBe(true);
      for (const t of splitPlus(s.audience))
        expect(audiences.has(t) || /^(perm|role|user):/.test(t), t).toBe(true);
      expect(keys.has(s.template_key), s.template_key).toBe(true);
      if (s.template_key === "lead.ack")
        expect(keys.has("lead.ack_after_hours")).toBe(true);
    }
  });
});

describe("built-in templates", () => {
  it("include Appendix B", () => {
    expect(APPENDIX_B.filter((k) => !keys.has(k))).toEqual([]);
  });
  it("key + channel pairs are unique", () => {
    const pairs = builtinTemplates.map((t) => `${t.key}:${t.channel}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
  it.each(
    builtinTemplates
      .filter((t) => t.channel === "sms")
      .map((t) => [t.key, t] as const),
  )("%s (sms) is GSM-7 and uses own-domain links", (_k, t) => {
    expect(smsSegments(t.body.replace(/\{\{[^}]*\}\}/g, "x")).encoding).toBe(
      "GSM-7",
    );
    expect(
      lintLinks(t.body, "https://app.example.com").filter(
        (l) => l.reason === "shortener",
      ),
    ).toEqual([]);
  });
  it("review templates pass the incentive / gating / Yelp linter", () => {
    for (const t of builtinTemplates.filter((x) => x.purpose === "review"))
      expect(
        lintReviewTemplate(`${t.subject ?? ""} ${t.body}`, "review"),
        t.key,
      ).toEqual([]);
  });
});
