import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { getEmail } from "@/adapters/email";
import { getSmsDriver } from "@/adapters/messaging";
import { db, type Tx, withAdvisoryLock } from "@/db";
import {
  approvals,
  automations,
  consentEvents,
  disputes,
  events,
  invoices,
  jobs,
  messages,
  messageTemplates,
  payments,
  scheduledMessages,
  users,
} from "@/db/schema";
import { evaluateConditions } from "@/features/automations/conditions";
import {
  buildTemplateContext,
  conditionContext,
  entityUrl,
  type Facts,
  loadFacts,
  partPurchaseAmount,
  settlementPeriodLabel,
  techAgenda,
  toolForIncident,
} from "@/features/automations/context";
import type { EngineStep } from "@/features/automations/schedule";
import { deliverToUsers, prefFor } from "@/features/notify/deliver";
import { checkReviewEligibility } from "@/features/reviews/eligibility";
import { writeActivity } from "@/lib/activity";
import { appUrl } from "@/lib/env";
import { emit } from "@/lib/events";
import type { FeatureFlag } from "@/lib/flags";
import { formatMoney } from "@/lib/money";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { enqueueJob } from "@/lib/queue";
import { getCompany, getSettings, isEnabled } from "@/lib/settings";
import { extractVariables, render, toGsmSafe } from "@/lib/template";
import { addDaysToKey, dateKey } from "@/lib/time";
import type { EntityRef } from "@/lib/types";
import {
  applyQuietHours,
  type ConsentFacts,
  checkFrequencyCaps,
  consentDecision,
  recipientTimeZone,
  resolveCustomerChannel,
} from "./compliance";
import type { MsgChannel, Purpose, ScheduledStatus } from "./contracts";
import { emailHtml, emailText, tidyEmailText } from "./email";
import { templateLabel } from "./labels";
import { withStopFooter } from "./lint";

// The sender (SPEC M12/M13, BUILD_PLAN §8.1 messaging.send_due): every due
// scheduled_messages row is re-checked at send time — automation enabled + flag,
// cancel conditions, entity still valid, consent / do-not-text, quiet hours in the
// recipient's zone, frequency caps, expiry — then rendered (tokens minted per send)
// and delivered:
//   - link drivers (free SMS, WhatsApp) → `pending_tap` outbox card for a person;
//   - staff push/in-app → notifications row + push job (no provider call here);
//   - email / auto-send SMS → provider call OUTSIDE any transaction, then recorded.
// One sender at a time (advisory lock). Messages + activity + message.sent/failed are
// written in the same transaction as the status change.

export type SchedRow = typeof scheduledMessages.$inferSelect;
const OPEN: ScheduledStatus[] = ["scheduled", "deferred_quiet"];
const SENDER_LOCK = 4_242_105;
const MAX_ATTEMPTS = 5;
/** Marker stored in last_error by enqueueMessage for manual overrides (SHIM: schema TODO `meta jsonb`). */
export const OVERRIDE_MARK = "manual_override";

export type PrepareOutcome =
  | { kind: "final"; status: ScheduledStatus; reason?: string | null }
  | {
      kind: "send";
      rowId: string;
      channel: "email" | "sms";
      to: string;
      subject: string | null;
      body: string;
      html: string | null;
      purpose: Purpose;
    };

// ------------------------------------------------------------------ templates

type TemplateRow = typeof messageTemplates.$inferSelect;

const CHANNEL_FALLBACK: Record<string, string[]> = {
  sms: ["sms", "email", "push"],
  whatsapp: ["sms", "email", "push"],
  email: ["email", "sms", "push"],
  push: ["push", "in_app", "sms", "email"],
  in_app: ["in_app", "push", "sms", "email"],
};

/** Template for key + channel with sensible fallbacks (whatsapp→sms, in_app→push …). */
export async function findTemplate(
  exec: Tx,
  key: string,
  channel: string,
): Promise<TemplateRow | null> {
  const rows = await exec
    .select()
    .from(messageTemplates)
    .where(
      and(eq(messageTemplates.key, key), eq(messageTemplates.locale, "en")),
    );
  for (const c of CHANNEL_FALLBACK[channel] ?? [channel]) {
    const t = rows.find((r) => r.channel === c);
    if (t) return t;
  }
  return rows[0] ?? null;
}

/**
 * Key-level flags (purpose / quiet hours / expiry). Purpose and quiet hours come from
 * the first channel row; the expiry is the shortest one set on ANY channel — the editor
 * only offers it on text channels, and a `customer_preferred` send must not lose it
 * because the email row sorts first (QA T2-16: lead.ack never expired).
 */
export async function templateMeta(exec: Tx, key: string) {
  const rows = await exec
    .select({
      purpose: messageTemplates.purpose,
      allowOutsideQuietHours: messageTemplates.allowOutsideQuietHours,
      expiresAfterMinutes: messageTemplates.expiresAfterMinutes,
    })
    .from(messageTemplates)
    .where(eq(messageTemplates.key, key))
    .orderBy(asc(messageTemplates.channel));
  const t = rows[0];
  if (!t) return null;
  const exp = rows
    .map((r) => r.expiresAfterMinutes)
    .filter((m): m is number => typeof m === "number" && m > 0);
  return {
    ...t,
    expiresAfterMinutes: exp.length ? Math.min(...exp) : null,
  };
}

// ------------------------------------------------------------------ entity validity

const JOB_PRE_ARRIVAL = ["scheduled", "confirmed"];

/** Window start (or scheduled start) of the job's appointment. */
function apptStart(job: Facts["job"]): Date | null {
  return job?.windowStart ?? job?.scheduledStart ?? null;
}
/** Window end (or scheduled end, else start) of the job's appointment. */
function apptEnd(job: Facts["job"]): Date | null {
  return job?.windowEnd ?? job?.scheduledEnd ?? apptStart(job);
}

/**
 * Templates that only make sense while the entity is still in a given state. Checked at
 * send time (and by the composer before it offers a template). `now` = the send clock.
 * Returns the cancel reason, or null when the send is still valid.
 */
export function entityStillValid(
  key: string,
  f: Facts,
  now: Date = new Date(),
): string | null {
  const job = f.job;
  const cancelledOk = [
    "job.cancelled",
    "job.cancel_verify",
    "staff.job_changed",
    "refund.issued",
    "payment.receipt",
    "staff.refund_due",
  ];
  if (
    job?.status === "cancelled" &&
    !cancelledOk.includes(key) &&
    key.startsWith("job.")
  )
    return "job_cancelled";
  if (
    job?.status === "cancelled" &&
    (key === "staff.late_prompt" ||
      key === "staff.unconfirmed" ||
      key.startsWith("review."))
  )
    return "job_cancelled";
  switch (key) {
    // Booking / reschedule / return-visit notices: only before the visit is over and
    // while the job is still booked (never after completion, QA T6-10).
    case "job.booked":
    case "job.rescheduled":
    case "job.return_visit": {
      if (!job) return null;
      if (!JOB_PRE_ARRIVAL.includes(job.status)) return "job_progressed";
      const end = apptEnd(job);
      return end && end.getTime() <= now.getTime()
        ? "appointment_passed"
        : null;
    }
    // Reminders: before arrival, and only while the appointment is still ahead.
    case "job.reminder_24h":
    case "job.reminder_2h": {
      if (!job || !JOB_PRE_ARRIVAL.includes(job.status))
        return "job_progressed";
      const start = apptStart(job);
      return start && start.getTime() <= now.getTime()
        ? "appointment_passed"
        : null;
    }
    case "staff.late_prompt":
      return job && JOB_PRE_ARRIVAL.includes(job.status)
        ? null
        : "job_progressed";
    case "staff.unconfirmed":
      return job && job.status === "scheduled" ? null : "job_confirmed";
    case "job.on_my_way":
    case "job.running_late":
      return job && job.status === "en_route" ? null : "job_progressed";
    case "invoice.reminder_1":
    case "invoice.reminder_2":
    case "invoice.reminder_3":
    case "invoice.sent":
    case "invoice.pay_link":
      if (!f.invoice) return "no_invoice";
      if (["void", "paid", "uncollectible", "draft"].includes(f.invoice.status))
        return `invoice_${f.invoice.status}`;
      return f.invoice.balanceCents > 0 ? null : "invoice_paid";
    case "job.completed":
      return f.invoice && f.invoice.status !== "void" ? null : "no_invoice";
    case "estimate.followup_1":
    case "estimate.followup_2":
    case "estimate.followup_3":
    case "estimate.followup_4":
      return f.estimate && ["sent", "viewed"].includes(f.estimate.status)
        ? null
        : "estimate_closed";
    case "estimate.closeout":
      return f.estimate &&
        ["sent", "viewed", "expired"].includes(f.estimate.status)
        ? null
        : "estimate_closed";
    // "We tried to reach you": not once a call connected (QA T6-04). Any call attempt
    // sets `contacted`, so a connected call — not the status — means reached.
    case "lead.not_reached":
      if (!f.lead || !["new", "contacted"].includes(f.lead.status))
        return "lead_progressed";
      return f.lead.reached ? "lead_reached" : null;
    // The auto-reply is for a lead nobody has handled yet (QA T2-16).
    case "lead.ack":
    case "lead.ack_after_hours":
      if (!f.lead) return null;
      return f.lead.status === "new" && !f.lead.firstResponseAt
        ? null
        : "lead_progressed";
    case "deposit.request":
      return f.deposit && ["required", "requested"].includes(f.deposit.status)
        ? null
        : "deposit_settled";
    default:
      return null;
  }
}

// ------------------------------------------------------------------ special variables

async function specialVars(
  exec: Tx,
  key: string,
  f: Facts,
  row: SchedRow,
  now: Date,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const p = (f.event?.payload ?? {}) as Record<string, unknown>;
  switch (key) {
    case "staff.approval_needed": {
      const [r] = await exec
        .select({ n: count() })
        .from(approvals)
        .where(eq(approvals.status, "pending"));
      out.count = String(Number(r?.n ?? 0) || 1);
      break;
    }
    case "staff.manual_unverified": {
      const [r] = await exec
        .select({ n: count() })
        .from(payments)
        .where(
          and(
            eq(payments.provider, "manual"),
            eq(payments.status, "succeeded"),
            isNull(payments.verifiedAt),
            lte(payments.createdAt, new Date(now.getTime() - 3 * 86_400_000)),
          ),
        );
      out.count = String(Number(r?.n ?? 0) || 1);
      break;
    }
    case "staff.daily_agenda": {
      if (row.recipientUserId) {
        const a = await techAgenda(row.recipientUserId, now, f.tz);
        out.count = String(a.count);
        out["agenda.first_time"] = a.firstTime;
        out["agenda.first_address"] = a.firstAddress;
      }
      break;
    }
    case "staff.daily_digest":
      Object.assign(out, await digestVars(exec, now, f.tz));
      break;
    case "staff.outbox_ready":
      if (row.recipientUserId)
        out.count = String(await outboxCountFor(exec, row.recipientUserId));
      break;
    case "staff.settlement_ready":
      if (typeof p.settlement_id === "string")
        out.period =
          (await settlementPeriodLabel(p.settlement_id)) ?? "this period";
      break;
    case "staff.reimbursement_decided":
      if (typeof p.part_purchase_id === "string") {
        const c = await partPurchaseAmount(p.part_purchase_id);
        if (c != null) out.amount = formatMoney(c, {});
      }
      break;
    case "staff.tool_incident":
      if (typeof p.incident_id === "string")
        out["tool.name"] = (await toolForIncident(p.incident_id)) ?? "A tool";
      break;
    case "staff.payout_sent":
      out.amount = out.amount ?? "Your payout";
      break;
    case "staff.doc_expiring":
      out.document = "document";
      break;
  }
  return out;
}

async function outboxCountFor(exec: Tx, userId: string): Promise<number> {
  const [r] = await exec
    .select({ n: count() })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.status, "pending_tap"),
        eq(scheduledMessages.assignedUserId, userId),
      ),
    );
  return Number(r?.n ?? 0);
}

/** Daily digest numbers (SPEC M22). */
export async function digestVars(
  exec: Tx,
  now: Date,
  tz: string,
): Promise<Record<string, string>> {
  const today = dateKey(now, tz);
  const tomorrow2 = addDaysToKey(today, 2);
  const next = addDaysToKey(today, 1);
  const startT = sql`(${today}::date::timestamp at time zone ${tz})`;
  const endT = sql`(${next}::date::timestamp at time zone ${tz})`;
  const end2 = sql`(${tomorrow2}::date::timestamp at time zone ${tz})`;
  const [jobsToday, unconfirmed, overdue, pending, open, outbox] =
    await Promise.all([
      exec
        .select({ n: count() })
        .from(jobs)
        .where(
          and(
            sql`${jobs.windowStart} >= ${startT}`,
            sql`${jobs.windowStart} < ${endT}`,
            ne(jobs.status, "cancelled"),
          ),
        ),
      exec
        .select({ n: count() })
        .from(jobs)
        .where(
          and(
            sql`${jobs.windowStart} >= ${startT}`,
            sql`${jobs.windowStart} < ${end2}`,
            eq(jobs.status, "scheduled"),
          ),
        ),
      exec
        .select({
          n: count(),
          amt: sql<number>`coalesce(sum(${invoices.totalCents}),0)::bigint`,
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.status, ["issued", "partially_paid"]),
            // Overdue from the local day after the due date (invoices/math, QA2).
            sql`${invoices.dueAt} < ${startT}`,
          ),
        ),
      exec
        .select({ n: count() })
        .from(approvals)
        .where(eq(approvals.status, "pending")),
      exec
        .select({ n: count() })
        .from(disputes)
        .where(eq(disputes.status, "needs_response")),
      exec
        .select({ n: count() })
        .from(scheduledMessages)
        .where(eq(scheduledMessages.status, "pending_tap")),
    ]);
  return {
    "digest.date": today,
    "digest.jobs_today": String(Number(jobsToday[0]?.n ?? 0)),
    "digest.unconfirmed": String(Number(unconfirmed[0]?.n ?? 0)),
    "digest.overdue_invoices": String(Number(overdue[0]?.n ?? 0)),
    "digest.overdue_amount": formatMoney(Number(overdue[0]?.amt ?? 0), {}),
    "digest.pending_approvals": String(Number(pending[0]?.n ?? 0)),
    "digest.open_disputes": String(Number(open[0]?.n ?? 0)),
    "digest.outbox": String(Number(outbox[0]?.n ?? 0)),
  };
}

// ------------------------------------------------------------------ prepare

async function setStatus(
  tx: Tx,
  row: SchedRow,
  status: ScheduledStatus,
  reason: string | null,
  extra: Partial<SchedRow> = {},
): Promise<PrepareOutcome> {
  await tx
    .update(scheduledMessages)
    .set({
      status,
      lastError: reason?.slice(0, 200) ?? null,
      updatedAt: new Date(),
      ...extra,
    })
    .where(eq(scheduledMessages.id, row.id));
  return { kind: "final", status, reason };
}

async function loadEvent(exec: Tx, id: number | null) {
  if (!id) return null;
  const [e] = await exec
    .select()
    .from(events)
    .where(eq(events.id, id))
    .limit(1);
  return e
    ? {
        type: e.type,
        payload: e.payload as Record<string, unknown>,
        at: e.createdAt,
      }
    : null;
}

function entityOf(row: SchedRow): EntityRef | null {
  return row.entityType && row.entityId
    ? ({ type: row.entityType, id: row.entityId } as EntityRef)
    : null;
}

async function consentFactsFor(exec: Tx, f: Facts): Promise<ConsentFacts> {
  const c = f.customer;
  if (!c)
    return {
      smsStatus: "unknown",
      doNotText: false,
      doNotContact: false,
      hasPhone: false,
      hasEmail: false,
    };
  const [emailMkt] = await exec
    .select({ action: consentEvents.action })
    .from(consentEvents)
    .where(
      and(
        eq(consentEvents.customerId, c.id),
        eq(consentEvents.channel, "email"),
        eq(consentEvents.purpose, "marketing"),
      ),
    )
    .orderBy(desc(consentEvents.createdAt))
    .limit(1);
  return {
    smsStatus: c.smsStatus as ConsentFacts["smsStatus"],
    doNotText: c.doNotText,
    doNotContact: c.doNotContact,
    hasPhone: !!c.phone,
    hasEmail: !!c.email,
    preferred: c.preferredChannel as ConsentFacts["preferred"],
    emailMarketing: emailMkt?.action === "grant",
    isTest: c.isTest,
  };
}

/** Recent customer sends for the caps (automated non-live in 24 h, marketing in 7 d). */
async function recentSends(exec: Tx, customerId: string, now: Date) {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const rows = await exec
    .select({
      sendAt: scheduledMessages.sendAt,
      updatedAt: scheduledMessages.updatedAt,
      purpose: scheduledMessages.purpose,
      automationId: scheduledMessages.automationId,
      templateKey: scheduledMessages.templateKey,
      allow: messageTemplates.allowOutsideQuietHours,
    })
    .from(scheduledMessages)
    .leftJoin(
      messageTemplates,
      and(
        eq(messageTemplates.key, scheduledMessages.templateKey),
        eq(messageTemplates.channel, "sms"),
      ),
    )
    .where(
      and(
        eq(scheduledMessages.recipientCustomerId, customerId),
        inArray(scheduledMessages.status, [
          "sent",
          "sent_manual",
          "delivered",
          "pending_tap",
        ]),
        gte(scheduledMessages.updatedAt, since),
      ),
    );
  const at = (r: (typeof rows)[number]) => r.updatedAt ?? r.sendAt;
  return {
    automated: rows
      .filter((r) => r.automationId && r.purpose !== "internal" && !r.allow)
      .map(at),
    marketing: rows.filter((r) => r.purpose === "marketing").map(at),
  };
}

async function hasPriorText(exec: Tx, customerId: string): Promise<boolean> {
  const [m] = await exec
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.customerId, customerId),
        eq(messages.direction, "out"),
        inArray(messages.channel, ["sms", "whatsapp"]),
        inArray(messages.status, ["sent", "sent_manual", "delivered"]),
      ),
    )
    .limit(1);
  return !!m;
}

function rateRandom(): number {
  return Math.random();
}

/**
 * Re-check, render and decide one row inside `tx`. Terminal decisions are written;
 * `send` outcomes leave the row `scheduled` (rendered) for a provider call outside
 * the transaction. Safe to call from enqueueMessage (immediate sends) and the sender.
 */
export async function prepareScheduled(
  tx: Tx,
  rowId: string,
  now: Date = new Date(),
  extraVars?: Record<string, string>,
): Promise<PrepareOutcome> {
  const [row] = await tx
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.id, rowId))
    .for("update")
    .limit(1);
  if (!row) return { kind: "final", status: "canceled", reason: "missing" };
  if (!OPEN.includes(row.status as ScheduledStatus))
    return { kind: "final", status: row.status as ScheduledStatus };
  const settings = await getSettings();
  const override =
    (row.meta as { manual_override?: boolean } | null)?.manual_override ===
      true || row.lastError === OVERRIDE_MARK;
  if (row.vars) extraVars = { ...row.vars, ...extraVars };
  // Automated = automations, bulk sends and custom reminders (quiet hours + caps apply);
  // a person replying by hand is never deferred or capped.
  const automated =
    !!row.automationId ||
    row.dedupeKey.startsWith("bulk:") ||
    row.dedupeKey.startsWith("reminder:");

  // 1. automation still enabled, flag on, step condition
  let step: EngineStep | null = null;
  let autoConditions: unknown = null;
  if (row.automationId) {
    const [a] = await tx
      .select()
      .from(automations)
      .where(eq(automations.id, row.automationId))
      .limit(1);
    if (!a || !a.enabled)
      return setStatus(tx, row, "canceled", "automation_disabled");
    if (a.featureFlag && !(await isEnabled(a.featureFlag as FeatureFlag)))
      return setStatus(tx, row, "canceled", "feature_off");
    step = (a.steps as EngineStep[])[row.stepIndex ?? 0] ?? null;
    autoConditions = a.conditions;
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime())
    return setStatus(tx, row, "expired", "expired_before_send");

  // 2. facts + send-time validity
  const event = await loadEvent(tx, row.eventId);
  const facts = await loadFacts(
    {
      customerId: row.recipientCustomerId,
      jobId: row.jobId,
      entity: entityOf(row),
      userId: row.recipientUserId,
      event,
    },
    tx,
  );
  const invalid = entityStillValid(row.templateKey, facts, now);
  if (invalid) return setStatus(tx, row, "canceled", invalid);
  if (row.automationId) {
    const cctx = conditionContext(facts);
    if (!evaluateConditions(autoConditions, cctx))
      return setStatus(tx, row, "canceled", "conditions_changed");
    if (step?.when && !evaluateConditions(step.when, cctx))
      return setStatus(tx, row, "canceled", "step_condition");
  }
  const meta = await templateMeta(tx, row.templateKey);

  // 3. staff / address audiences
  if (row.audienceType === "user")
    return prepareStaff(tx, row, facts, now, extraVars);
  if (row.audienceType === "address")
    return prepareAddress(tx, row, facts, now, extraVars);

  // 4. customer audience
  const customer = facts.customer;
  if (!customer && !row.toAddress)
    return setStatus(tx, row, "skipped", "no_recipient");
  const purpose = row.purpose as Purpose;
  const cfacts = await consentFactsFor(tx, facts);
  if (!customer && row.toAddress) {
    // A lead without a customer record: phone/email straight from the lead.
    const isEmail = row.toAddress.includes("@");
    cfacts.hasPhone = !isEmail;
    cfacts.hasEmail = isEmail;
  }
  const cctx = {
    purpose,
    whatsappEnabled: settings.messaging.whatsapp_enabled,
    reviewConsentBasis: settings.reviews.consent_basis,
  };
  let channel: MsgChannel;
  if (row.channel === "customer_preferred") {
    const r = resolveCustomerChannel(cfacts, cctx);
    if (!r.ok)
      return setStatus(
        tx,
        row,
        r.reason.startsWith("opted_out") || r.reason === "do_not_contact"
          ? "suppressed_optout"
          : "skipped",
        r.reason,
      );
    channel = r.channel;
    // An explicit email copy exists for this step (payment receipts): don't email twice.
    if (channel === "email") {
      const sibling = row.dedupeKey.replace(
        /:customer_preferred(?=:|$)/,
        ":email",
      );
      if (sibling !== row.dedupeKey) {
        const [dup] = await tx
          .select({ id: scheduledMessages.id })
          .from(scheduledMessages)
          .where(eq(scheduledMessages.dedupeKey, sibling))
          .limit(1);
        if (dup) return setStatus(tx, row, "skipped", "duplicate_email_copy");
      }
    }
  } else channel = row.channel as MsgChannel;

  const gate = consentDecision(channel, cfacts, cctx, override);
  if (!gate.ok) return setStatus(tx, row, gate.status, gate.reason);

  // review requests: eligibility gate (paid/closed, ≤ 2 asks, min days, callbacks…)
  if (purpose === "review" && row.jobId) {
    const elig = await checkReviewEligibility(tx, row.jobId, {
      now,
      channel,
      templateKey: row.templateKey,
      manual: !row.automationId,
    });
    if (!elig.ok)
      return setStatus(
        tx,
        row,
        elig.wait ? "canceled" : "skipped",
        elig.reason,
      );
  }

  // quiet hours (texts only; automated only — a person replying by hand is not deferred)
  const isText = channel === "sms" || channel === "whatsapp";
  const tz = recipientTimeZone({
    propertyTz: facts.property?.timezone,
    zip: facts.property?.zip,
    companyTz: facts.tz,
  });
  if (isText && automated) {
    const liveWindowOk =
      !!meta?.allowOutsideQuietHours &&
      (row.templateKey.startsWith("lead.ack")
        ? now.getTime() - row.createdAt.getTime() <= 5 * 60_000
        : true);
    const q = applyQuietHours(now, tz, {
      window: settings.compliance.quiet_hours,
      bypass: liveWindowOk,
      random: rateRandom,
    });
    if (q.deferred)
      return setStatus(tx, row, "deferred_quiet", "quiet_hours", {
        sendAt: q.sendAt,
      });
  }

  // frequency caps (automated only)
  if (customer && automated) {
    const recent = await recentSends(tx, customer.id, now);
    const cap = checkFrequencyCaps({
      now,
      purpose,
      automated: true,
      templateKey: row.templateKey,
      live: !!meta?.allowOutsideQuietHours,
      recentAutomated: recent.automated,
      recentMarketing: recent.marketing,
      caps: settings.compliance.frequency_caps,
      timeZone: tz,
      window: settings.compliance.quiet_hours,
      random: rateRandom,
    });
    if (!cap.ok)
      return setStatus(tx, row, "scheduled", cap.reason, {
        sendAt: cap.deferTo,
      });
  }

  // render
  const to =
    channel === "email"
      ? ((row.channel === "email" && row.toAddress?.includes("@")
          ? row.toAddress
          : customer?.email) ?? row.toAddress)
      : ((row.toAddress && !row.toAddress.includes("@")
          ? row.toAddress
          : customer?.phone) ?? null);
  if (!to)
    return setStatus(
      tx,
      row,
      "skipped",
      channel === "email" ? "no_email" : "no_phone",
    );
  let subject = row.renderedSubject;
  let body = row.renderedBody;
  const reuse =
    !!body && (row.channel === channel || row.templateKey === "manual");
  if (!reuse) {
    const tpl = await findTemplate(tx, row.templateKey, channel);
    if (!tpl) return setStatus(tx, row, "failed", "template_missing");
    const vars = await specialVars(tx, row.templateKey, facts, row, now);
    const needed = new Set([
      ...extractVariables(tpl.body),
      ...extractVariables(tpl.subject ?? ""),
    ]);
    const ctx = await buildTemplateContext(tx, facts, {
      variables: needed,
      mint: true,
      timeZone: tz,
      vars: { ...extraVars, ...vars },
    });
    body = render(tpl.body, ctx);
    subject = tpl.subject ? render(tpl.subject, ctx) : null;
  }
  body = (body ?? "").trim();
  if (!body) return setStatus(tx, row, "failed", "empty_body");
  if (!isText) body = tidyEmailText(body);
  if (isText) {
    body = toGsmSafe(body)
      .replace(/[   ]/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +\n/g, "\n");
    const smsDriver = await getSmsDriver();
    const auto = channel === "sms" && smsDriver.caps.autoSend;
    const first = customer ? !(await hasPriorText(tx, customer.id)) : true;
    if (purpose === "marketing" || (first && (auto || automated)))
      body = withStopFooter(body);
    if (!auto) {
      // link mode → outbox card for a person
      const owner =
        settings.messaging.outbox_owner_by_template[row.templateKey] ??
        "office";
      const assigned =
        row.assignedUserId ??
        (owner === "tech" && settings.messaging.tech_texts_from === "tech_phone"
          ? (facts.tech?.id ?? null)
          : null);
      return setStatus(tx, row, "pending_tap", null, {
        channel,
        toAddress: to,
        renderedBody: body,
        renderedSubject: null,
        driver: channel === "whatsapp" ? "whatsapp_link" : "link",
        assignedUserId: assigned,
      });
    }
    await tx
      .update(scheduledMessages)
      .set({
        channel,
        toAddress: to,
        renderedBody: body,
        driver: smsDriver.name,
        attempts: row.attempts + 1,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(scheduledMessages.id, row.id));
    return {
      kind: "send",
      rowId: row.id,
      channel: "sms",
      to,
      subject: null,
      body,
      html: null,
      purpose,
    };
  }
  if (channel === "email") {
    const company = await getCompany();
    const subj = subject || `${facts.company.name}`;
    const layout = {
      subject: subj,
      text: body,
      companyName: facts.company.name,
      companyPhone: formatPhoneDisplay(company.phone),
      companyAddress: facts.company.address,
      accent: settings.branding.accent_color,
      footer:
        purpose === "marketing"
          ? `You're receiving this because you're a ${facts.company.name} customer. Reply STOP to stop these emails.`
          : null,
    };
    await tx
      .update(scheduledMessages)
      .set({
        channel,
        toAddress: to,
        renderedBody: body,
        renderedSubject: subj,
        driver: "email",
        attempts: row.attempts + 1,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(scheduledMessages.id, row.id));
    return {
      kind: "send",
      rowId: row.id,
      channel: "email",
      to,
      subject: subj,
      body: emailText(layout),
      html: emailHtml(layout),
      purpose,
    };
  }
  return setStatus(tx, row, "skipped", `unsupported_channel_${channel}`);
}

async function prepareStaff(
  tx: Tx,
  row: SchedRow,
  facts: Facts,
  now: Date,
  extraVars?: Record<string, string>,
): Promise<PrepareOutcome> {
  if (!row.recipientUserId)
    return setStatus(tx, row, "skipped", "no_recipient");
  const [u] = await tx
    .select({
      id: users.id,
      status: users.status,
      email: users.email,
      phone: users.phone,
      prefs: users.notificationPrefs,
    })
    .from(users)
    .where(eq(users.id, row.recipientUserId))
    .limit(1);
  if (!u || u.status !== "active")
    return setStatus(tx, row, "canceled", "user_inactive");
  const channel = row.channel as MsgChannel;
  let title = row.renderedSubject;
  let body = row.renderedBody;
  if (!body) {
    const tpl = await findTemplate(tx, row.templateKey, channel);
    if (!tpl) return setStatus(tx, row, "failed", "template_missing");
    const vars = await specialVars(tx, row.templateKey, facts, row, now);
    const needed = new Set([
      ...extractVariables(tpl.body),
      ...extractVariables(tpl.subject ?? ""),
    ]);
    const ctx = await buildTemplateContext(tx, facts, {
      variables: needed,
      mint: false,
      vars: { ...extraVars, ...vars },
    });
    body = render(tpl.body, ctx).trim();
    title = tpl.subject
      ? render(tpl.subject, ctx).trim()
      : templateLabel(row.templateKey);
  }
  const url = entityUrl(facts.entity, facts);
  const pref = prefFor(
    u.prefs as Record<string, "push" | "email" | "off">,
    row.templateKey,
  );
  if (channel === "push" || channel === "in_app") {
    // A sibling explicit email row (push+email steps) already covers email.
    const siblingEmail = await tx
      .select({ id: scheduledMessages.id })
      .from(scheduledMessages)
      .where(
        eq(
          scheduledMessages.dedupeKey,
          row.dedupeKey.replace(/:(push|in_app)(?=:|$)/, ":email"),
        ),
      )
      .limit(1);
    const channels: ("in_app" | "push" | "email")[] =
      channel === "in_app"
        ? ["in_app"]
        : pref === "push"
          ? ["push"]
          : pref === "email" && siblingEmail.length === 0
            ? ["email"]
            : [];
    // A push+in_app step creates two rows: only the first one writes the bell row.
    const siblingPush =
      channel === "in_app"
        ? await tx
            .select({ id: scheduledMessages.id })
            .from(scheduledMessages)
            .where(
              eq(
                scheduledMessages.dedupeKey,
                row.dedupeKey.replace(/:in_app(?=:|$)/, ":push"),
              ),
            )
            .limit(1)
        : [];
    if (siblingPush.length === 0)
      await deliverToUsers(tx, {
        userIds: [u.id],
        type: row.templateKey,
        title: title || templateLabel(row.templateKey),
        body,
        url,
        entity: facts.entity,
        channels,
      });
    return setStatus(tx, row, "sent", null, {
      renderedBody: body,
      renderedSubject: title,
      driver: channel,
    });
  }
  if (channel === "email") {
    if (pref === "off") return setStatus(tx, row, "skipped", "pref_off");
    if (!u.email) return setStatus(tx, row, "skipped", "no_email");
    await enqueueJob(
      tx,
      "email",
      {
        to: u.email,
        subject: title || templateLabel(row.templateKey),
        text: `${body}${body.includes("http") ? "" : `\n\nOpen: ${appUrl(url)}`}`,
        kind: "staff",
      },
      { dedupeKey: `email:sched:${row.id}` },
    );
    return setStatus(tx, row, "sent", null, {
      renderedBody: body,
      renderedSubject: title,
      driver: "email",
      toAddress: u.email,
    });
  }
  if (channel === "sms") {
    if (!u.phone) return setStatus(tx, row, "skipped", "no_phone");
    return setStatus(tx, row, "pending_tap", null, {
      toAddress: u.phone,
      renderedBody: toGsmSafe(body),
      driver: "link",
    });
  }
  return setStatus(tx, row, "skipped", `unsupported_channel_${channel}`);
}

async function prepareAddress(
  tx: Tx,
  row: SchedRow,
  facts: Facts,
  now: Date,
  extraVars?: Record<string, string>,
): Promise<PrepareOutcome> {
  const to = row.toAddress;
  if (!to) return setStatus(tx, row, "skipped", "no_recipient");
  let body = row.renderedBody;
  let subject = row.renderedSubject;
  if (!body) {
    const tpl = await findTemplate(tx, row.templateKey, row.channel);
    if (!tpl) return setStatus(tx, row, "failed", "template_missing");
    const ctx = await buildTemplateContext(tx, facts, {
      mint: false,
      vars: {
        ...extraVars,
        ...(await specialVars(tx, row.templateKey, facts, row, now)),
      },
    });
    body = render(tpl.body, ctx);
    subject = tpl.subject ? render(tpl.subject, ctx) : null;
  }
  if (row.channel === "email") {
    const settings = await getSettings();
    const layout = {
      subject: subject || facts.company.name,
      text: tidyEmailText(body),
      companyName: facts.company.name,
      companyPhone: formatPhoneDisplay(facts.company.phone),
      accent: settings.branding.accent_color,
    };
    await tx
      .update(scheduledMessages)
      .set({
        renderedBody: body,
        renderedSubject: layout.subject,
        driver: "email",
        attempts: row.attempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(scheduledMessages.id, row.id));
    return {
      kind: "send",
      rowId: row.id,
      channel: "email",
      to,
      subject: layout.subject,
      body: emailText(layout),
      html: emailHtml(layout),
      purpose: row.purpose as Purpose,
    };
  }
  return setStatus(tx, row, "pending_tap", null, {
    renderedBody: toGsmSafe(body),
    driver: "link",
  });
}

// ------------------------------------------------------------------ record

/**
 * Write the outbound `messages` row, mark the scheduled row, add the timeline entry and
 * emit `message.sent`. Used by the sender, outbox "Sent? Yes" and seeds-free paths.
 */
export async function recordOutbound(
  tx: Tx,
  row: SchedRow,
  r: {
    status: "sent" | "sent_manual" | "delivered";
    body: string;
    subject?: string | null;
    providerId?: string | null;
    driver?: string | null;
    sentByUserId?: string | null;
    at?: Date;
  },
): Promise<string> {
  const at = r.at ?? new Date();
  const [m] = await tx
    .insert(messages)
    .values({
      customerId: row.recipientCustomerId,
      leadId: row.entityType === "lead" ? row.entityId : null,
      jobId: row.jobId,
      userId: r.sentByUserId ?? null,
      direction: "out",
      channel: row.channel,
      driver: r.driver ?? row.driver ?? "link",
      purpose: row.purpose,
      toAddress: row.toAddress,
      subject: r.subject ?? row.renderedSubject,
      body: r.body,
      status: r.status,
      providerId: r.providerId ?? null,
      scheduledMessageId: row.id,
      templateKey: row.templateKey === "manual" ? null : row.templateKey,
      sentByUserId: r.sentByUserId ?? null,
      sentAt: at,
    })
    .returning({ id: messages.id });
  if (!m) throw new Error("messages insert failed");
  await tx
    .update(scheduledMessages)
    .set({
      status: r.status,
      messageId: m.id,
      providerId: r.providerId ?? null,
      renderedBody: r.body,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(scheduledMessages.id, row.id));
  const entity: EntityRef | null = row.jobId
    ? { type: "job", id: row.jobId }
    : row.recipientCustomerId
      ? { type: "customer", id: row.recipientCustomerId }
      : null;
  if (entity && row.audienceType === "customer") {
    await writeActivity(tx, {
      entity,
      customerId: row.recipientCustomerId,
      jobId: row.jobId,
      kind: "message.sent",
      summary: `${row.channel === "email" ? "Email" : row.channel === "whatsapp" ? "WhatsApp" : "Text"} sent: ${templateLabel(row.templateKey)}`,
      data: {
        message_id: m.id,
        channel: row.channel,
        template_key: row.templateKey,
        status: r.status,
      },
      actorUserId: r.sentByUserId ?? null,
    });
  }
  if (row.audienceType !== "user") {
    await emit(
      tx,
      "message.sent",
      { type: "message", id: m.id },
      {
        message_id: m.id,
        scheduled_message_id: row.id,
        customer_id: row.recipientCustomerId,
        lead_id: row.entityType === "lead" ? row.entityId : null,
        job_id: row.jobId,
        channel: row.channel,
        template_key: row.templateKey === "manual" ? null : row.templateKey,
        user_id: r.sentByUserId ?? null,
        status: r.status,
        actor_user_id: r.sentByUserId ?? null,
      },
    );
  }
  if (row.purpose === "review" && row.jobId)
    await markReviewSent(tx, row.jobId, row.templateKey, at);
  return m.id;
}

/** review_requests bookkeeping + review.requested on the first ask. */
async function markReviewSent(
  tx: Tx,
  jobId: string,
  templateKey: string,
  at: Date,
) {
  const { reviewRequests } = await import("@/db/schema");
  const [rr] = await tx
    .update(reviewRequests)
    .set({
      sentCount: sql`${reviewRequests.sentCount} + 1`,
      firstSentAt: sql`coalesce(${reviewRequests.firstSentAt}, ${at.toISOString()}::timestamptz)`,
      lastSentAt: at,
    })
    .where(eq(reviewRequests.jobId, jobId))
    .returning({
      id: reviewRequests.id,
      sentCount: reviewRequests.sentCount,
      customerId: reviewRequests.customerId,
    });
  if (rr && templateKey === "review.request" && rr.sentCount === 1) {
    await emit(
      tx,
      "review.requested",
      { type: "review_request", id: rr.id },
      { review_request_id: rr.id },
    );
    await writeActivity(tx, {
      entity: { type: "job", id: jobId },
      customerId: rr.customerId,
      jobId,
      kind: "review.requested",
      summary: "Review requested",
    });
  }
}

/** Provider failure: retry with backoff, then `failed` + message row + message.failed. */
export async function recordFailure(
  tx: Tx,
  row: SchedRow,
  error: string,
  retryable: boolean,
): Promise<void> {
  if (retryable && row.attempts < MAX_ATTEMPTS) {
    const backoff = Math.min(60, 2 ** row.attempts) * 60_000;
    await tx
      .update(scheduledMessages)
      .set({
        status: "scheduled",
        sendAt: new Date(Date.now() + backoff),
        lastError: error.slice(0, 200),
        updatedAt: new Date(),
      })
      .where(eq(scheduledMessages.id, row.id));
    return;
  }
  const [m] = await tx
    .insert(messages)
    .values({
      customerId: row.recipientCustomerId,
      jobId: row.jobId,
      direction: "out",
      channel: row.channel,
      driver: row.driver ?? "unknown",
      purpose: row.purpose,
      toAddress: row.toAddress,
      subject: row.renderedSubject,
      body: row.renderedBody ?? "",
      status: "failed",
      error: error.slice(0, 500),
      scheduledMessageId: row.id,
      templateKey: row.templateKey === "manual" ? null : row.templateKey,
    })
    .returning({ id: messages.id });
  await tx
    .update(scheduledMessages)
    .set({
      status: "failed",
      messageId: m?.id ?? null,
      lastError: error.slice(0, 200),
      updatedAt: new Date(),
    })
    .where(eq(scheduledMessages.id, row.id));
  if (m && row.audienceType === "customer") {
    if (row.recipientCustomerId)
      await writeActivity(tx, {
        entity: row.jobId
          ? { type: "job", id: row.jobId }
          : { type: "customer", id: row.recipientCustomerId },
        customerId: row.recipientCustomerId,
        jobId: row.jobId,
        kind: "message.failed",
        summary: `${templateLabel(row.templateKey)} not delivered`,
        data: { message_id: m.id, error: error.slice(0, 120) },
      });
    await emit(
      tx,
      "message.failed",
      { type: "message", id: m.id },
      { message_id: m.id, error: error.slice(0, 200) },
    );
  }
}

// ------------------------------------------------------------------ provider

async function callProvider(o: Extract<PrepareOutcome, { kind: "send" }>) {
  if (o.channel === "email") {
    return getEmail().send({
      id: o.rowId,
      to: o.to,
      channel: "email",
      purpose: o.purpose,
      subject: o.subject ?? undefined,
      body: o.body,
      html: o.html ?? undefined,
    });
  }
  const driver = await getSmsDriver();
  return driver.send({
    id: o.rowId,
    to: o.to,
    channel: "sms",
    purpose: o.purpose,
    body: o.body,
  });
}

/** Provider call (outside any transaction) + record. */
export async function sendPrepared(
  o: Extract<PrepareOutcome, { kind: "send" }>,
): Promise<"sent" | "failed" | "retry" | "outbox"> {
  let result: Awaited<ReturnType<typeof callProvider>>;
  try {
    result = await callProvider(o);
  } catch (err) {
    result = {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, o.rowId))
      .limit(1);
    if (!row) return "failed" as const;
    if (result.status === "sent") {
      await recordOutbound(tx, row, {
        status: "sent",
        body: o.channel === "email" ? (row.renderedBody ?? o.body) : o.body,
        subject: o.subject,
        providerId: result.providerId ?? null,
        driver: row.driver,
      });
      return "sent" as const;
    }
    if (result.status === "needs_human") {
      await tx
        .update(scheduledMessages)
        .set({ status: "pending_tap", updatedAt: new Date() })
        .where(eq(scheduledMessages.id, row.id));
      return "outbox" as const;
    }
    await recordFailure(tx, row, result.error, result.retryable);
    return result.retryable && row.attempts < MAX_ATTEMPTS
      ? ("retry" as const)
      : ("failed" as const);
  });
}

// ------------------------------------------------------------------ loop

export interface DeliverResult {
  processed: number;
  sent: number;
  outbox: number;
  failed: number;
  other: number;
  skipped: boolean;
}

/**
 * Process due rows (send_at ≤ now) until the queue or the time budget runs out.
 * Single-flight via an advisory lock (a concurrent call returns `skipped`).
 */
export async function deliverDueMessages(
  opts: { now?: Date; limit?: number; timeBudgetMs?: number } = {},
): Promise<DeliverResult> {
  const out: DeliverResult = {
    processed: 0,
    sent: 0,
    outbox: 0,
    failed: 0,
    other: 0,
    skipped: false,
  };
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 20_000;
  const limit = opts.limit ?? 200;
  const res = await withAdvisoryLock(SENDER_LOCK, async () => {
    const seen = new Set<string>();
    while (out.processed < limit && Date.now() - started < budget) {
      const now = opts.now ?? new Date();
      const due = await db
        .select({ id: scheduledMessages.id })
        .from(scheduledMessages)
        .where(
          and(
            inArray(scheduledMessages.status, OPEN),
            lte(scheduledMessages.sendAt, now),
          ),
        )
        .orderBy(asc(scheduledMessages.sendAt))
        .limit(25);
      const batch = due.filter((d) => !seen.has(d.id));
      if (batch.length === 0) break;
      for (const { id } of batch) {
        seen.add(id);
        out.processed++;
        try {
          const o = await db.transaction((tx) => prepareScheduled(tx, id, now));
          if (o.kind === "final") {
            if (o.status === "pending_tap") out.outbox++;
            else if (o.status === "sent") out.sent++;
            else out.other++;
            continue;
          }
          const r = await sendPrepared(o);
          if (r === "sent") out.sent++;
          else if (r === "outbox") out.outbox++;
          else out.failed++;
        } catch (err) {
          out.failed++;
          console.error(`[messaging] send ${id} failed:`, err);
          await db
            .update(scheduledMessages)
            .set({
              attempts: sql`${scheduledMessages.attempts} + 1`,
              lastError: (err instanceof Error
                ? err.message
                : String(err)
              ).slice(0, 200),
              sendAt: new Date(Date.now() + 5 * 60_000),
              status: sql`case when ${scheduledMessages.attempts} + 1 >= ${MAX_ATTEMPTS} then 'failed' else ${scheduledMessages.status} end`,
              updatedAt: new Date(),
            })
            .where(eq(scheduledMessages.id, id));
        }
      }
    }
  });
  if (!res.acquired) out.skipped = true;
  return out;
}

/** Run the sender after the current response (actions, handlers). No-op outside a request. */
export function kickSender(): void {
  if (process.env.CRM_DISABLE_BACKGROUND === "1") return;
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(() =>
        deliverDueMessages({ timeBudgetMs: 8_000 }).catch((err) =>
          console.error("[messaging] deliverDueMessages failed:", err),
        ),
      );
    } catch {
      // outside a request scope: the cron tick sends within a minute
    }
  })();
}

/** Expire stale outbox cards (cron messaging.outbox). Returns how many expired. */
export async function expireOutbox(now = new Date()): Promise<number> {
  const rows = await db
    .update(scheduledMessages)
    .set({ status: "expired", lastError: "expired_in_outbox", updatedAt: now })
    .where(
      and(
        eq(scheduledMessages.status, "pending_tap"),
        isNotNull(scheduledMessages.expiresAt),
        lte(scheduledMessages.expiresAt, now),
      ),
    )
    .returning({ id: scheduledMessages.id });
  return rows.length;
}

/** Users with pending outbox cards created since `since` (batched "n texts ready" push). */
export async function newOutboxAssignees(
  since: Date,
): Promise<{ userId: string | null; n: number }[]> {
  const rows = await db
    .select({ userId: scheduledMessages.assignedUserId, n: count() })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.status, "pending_tap"),
        gte(scheduledMessages.updatedAt, since),
        // Manual sends are tapped right away by the person who wrote them.
        isNotNull(scheduledMessages.automationId),
      ),
    )
    .groupBy(scheduledMessages.assignedUserId);
  return rows.map((r) => ({ userId: r.userId, n: Number(r.n) }));
}
