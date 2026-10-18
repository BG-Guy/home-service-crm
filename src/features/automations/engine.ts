import "server-only";
import {
  and,
  eq,
  inArray,
  like,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import { automations, scheduledMessages, users } from "@/db/schema";
import { enqueueCore } from "@/features/messaging/enqueue";
import { templateMeta } from "@/features/messaging/sender";
import type { DomainEvent } from "@/lib/events";
import type { FeatureFlag } from "@/lib/flags";
import type { Perm } from "@/lib/permissions";
import { listUsersWithPerm } from "@/lib/permissions-db";
import { isEnabled } from "@/lib/settings";
import { type EntityRef, SYSTEM_ACTOR } from "@/lib/types";
import { evaluateConditions, getField } from "./conditions";
import {
  conditionContext,
  type Facts,
  loadFacts,
  subjectUserIdOf,
} from "./context";
import {
  type CancelRule,
  type CancelScope,
  normalizeCancelOn,
} from "./engine-shared";
import {
  type AnchorKey,
  batchSendAt,
  computeSendAt,
  dedupeKeyFor,
  dedupePrefixFor,
  type EngineStep,
  isEventAnchored,
  isWithinBusinessHours,
  parseAnchor,
  resolveSendTime,
  splitPlus,
  splitTriggers,
} from "./schedule";

// The automation engine (SPEC M13, §7.2; BUILD_PLAN §7.0). Registered as the `'*'`
// event handler `automations.engine`, so EVERY domain event — built-in or custom
// automation — goes through here, in the handler's own transaction:
//   1. cancel_on: open sends of any automation whose cancel list names this event
//      (optionally with a `when` condition and a scope) are canceled;
//   2. triggers: enabled automations whose trigger_event matches (and whose flag is
//      on and conditions pass) schedule one scheduled_messages row per step ×
//      recipient × channel through enqueueCore, with a unique dedupe key, so a
//      re-emitted event never double-sends and a reschedule re-creates anchored sends.
// Idempotent by construction (dedupe keys + status-filtered cancels).

type AutomationRow = typeof automations.$inferSelect;

const OPEN = ["scheduled", "deferred_quiet", "pending_tap"] as const;

/** Templates still meaningful after a job is cancelled (everything else is dropped). */
const AFTER_CANCEL_OK = [
  "job.cancelled",
  "job.cancel_verify",
  "staff.job_changed",
  "refund.issued",
  "payment.receipt",
  "staff.refund_due",
  "staff.approval_needed",
];

export type { CancelRule, CancelScope } from "./engine-shared";
export { normalizeCancelOn };

/** Message events are about the customer, not one entity. */
function defaultScope(eventType: string): CancelScope {
  return eventType.startsWith("message.") ? "customer" : "entity";
}

/** Event payload as plain data (never undefined). */
function payloadOf(e: DomainEvent): Record<string, unknown> {
  return (e.payload ?? {}) as unknown as Record<string, unknown>;
}

const s = (p: Record<string, unknown>, k: string) =>
  typeof p[k] === "string" ? (p[k] as string) : null;
const arr = (p: Record<string, unknown>, k: string): string[] =>
  Array.isArray(p[k])
    ? (p[k] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

const ID_KEYS = [
  "job_id",
  "invoice_id",
  "estimate_id",
  "lead_id",
  "deposit_request_id",
  "dispute_id",
  "review_request_id",
  "payment_id",
  "refund_id",
  "task_id",
  "vehicle_id",
  "tool_id",
];

/** Ids an event is "about" (cancel scope `entity`). */
function relatedIds(
  e: DomainEvent,
  f: Facts | null,
): { ids: string[]; jobIds: string[] } {
  const p = payloadOf(e);
  const ids = new Set<string>();
  if (e.entity) ids.add(e.entity.id);
  for (const k of ID_KEYS) {
    const v = s(p, k);
    if (v) ids.add(v);
  }
  const jobIds = new Set<string>();
  const pj = s(p, "job_id");
  if (pj) jobIds.add(pj);
  if (e.entity?.type === "job") jobIds.add(e.entity.id);
  // Invoice / estimate / review / deposit events reach their job through the facts.
  if (f?.job && e.type.split(".")[0] !== "lead") jobIds.add(f.job.id);
  return { ids: [...ids], jobIds: [...jobIds] };
}

async function cancelForRule(
  tx: Tx,
  a: AutomationRow,
  rule: CancelRule,
  e: DomainEvent,
  f: Facts | null,
): Promise<number> {
  const p = payloadOf(e);
  const scope = rule.scope ?? defaultScope(e.type);
  let target: SQL | undefined;
  if (scope === "customer") {
    const cid = f?.customer?.id ?? s(p, "customer_id");
    if (!cid) return 0;
    target = eq(scheduledMessages.recipientCustomerId, cid);
  } else if (scope === "subject_user") {
    const uid = subjectUserIdOf(e.type, p);
    if (!uid) return 0;
    target = eq(scheduledMessages.recipientUserId, uid);
  } else if (scope === "actor_user") {
    if (!e.actorUserId) return 0;
    target = eq(scheduledMessages.recipientUserId, e.actorUserId);
  } else {
    const { ids, jobIds } = relatedIds(e, f);
    const parts = [];
    if (ids.length) parts.push(inArray(scheduledMessages.entityId, ids));
    if (jobIds.length) parts.push(inArray(scheduledMessages.jobId, jobIds));
    if (parts.length === 0) return 0;
    target = parts.length === 1 ? parts[0] : or(...parts);
  }
  const rows = await tx
    .update(scheduledMessages)
    .set({
      status: "canceled",
      lastError: `cancel_on:${e.type}`.slice(0, 200),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledMessages.automationId, a.id),
        inArray(scheduledMessages.status, [...OPEN]),
        target,
      ),
    )
    .returning({ id: scheduledMessages.id });
  return rows.length;
}

/** job.cancelled drops every pending job send except the cancellation follow-ups. */
async function cancelJobSends(tx: Tx, jobId: string): Promise<number> {
  const rows = await tx
    .update(scheduledMessages)
    .set({
      status: "canceled",
      lastError: "job_cancelled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledMessages.jobId, jobId),
        inArray(scheduledMessages.status, [...OPEN]),
        notInArray(scheduledMessages.templateKey, AFTER_CANCEL_OK),
      ),
    )
    .returning({ id: scheduledMessages.id });
  return rows.length;
}

// ------------------------------------------------------------------ audiences

export type Recipient =
  | { type: "customer"; customerId: string }
  | { type: "user"; userId: string };

async function activeUsersByRole(tx: Tx, role: string): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, role), eq(users.status, "active")));
  return rows.map((r) => r.id);
}

async function activeOnly(tx: Tx, ids: string[]): Promise<string[]> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return [];
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, uniq), eq(users.status, "active")));
  const ok = new Set(rows.map((r) => r.id));
  return uniq.filter((id) => ok.has(id));
}

/**
 * Resolve one audience token to recipients (SPEC M13 audience list + the engine's
 * extras: added_techs / removed_techs / event_techs from job.assigned/cancelled).
 */
export async function resolveAudience(
  tx: Tx,
  token: string,
  e: DomainEvent,
  f: Facts,
): Promise<Recipient[]> {
  const p = payloadOf(e);
  const users$ = (ids: (string | null | undefined)[]) =>
    activeOnly(
      tx,
      ids.filter((x): x is string => !!x),
    ).then((r) => r.map((userId) => ({ type: "user", userId }) as Recipient));
  if (token === "customer") {
    const cid = f.customer?.id ?? null;
    return cid ? [{ type: "customer", customerId: cid }] : [];
  }
  if (token === "assigned_tech") return users$([f.tech?.id]);
  if (token === "assigned_techs")
    return users$(f.assignees.map((a) => a.userId));
  if (token === "added_techs") return users$(arr(p, "user_ids_added"));
  if (token === "removed_techs") return users$(arr(p, "user_ids_removed"));
  if (token === "event_techs") {
    const ids = arr(p, "tech_ids");
    return users$(ids.length ? ids : f.assignees.map((a) => a.userId));
  }
  if (token === "subject_user") return users$([f.subjectUser?.id]);
  if (token === "creator") {
    const est = f.estimate as { createdBy?: string | null } | null;
    const lead = f.lead as { assignedUserId?: string | null } | null;
    return users$([est?.createdBy ?? lead?.assignedUserId ?? null]);
  }
  if (token === "vehicle_assignee")
    return users$([
      (f.vehicle as { assignedUserId?: string | null } | null)
        ?.assignedUserId ?? null,
    ]);
  if (token === "office") {
    // Leads go to whoever receives lead alerts; everything else to the office role.
    if (e.type.startsWith("lead."))
      return users$(await listUsersWithPerm("leads.receive_alerts" as Perm));
    return users$(await activeUsersByRole(tx, "office"));
  }
  if (token === "admins") return users$(await activeUsersByRole(tx, "admin"));
  if (token.startsWith("perm:"))
    return users$(await listUsersWithPerm(token.slice(5) as Perm));
  if (token.startsWith("role:"))
    return users$(await activeUsersByRole(tx, token.slice(5)));
  if (token.startsWith("user:")) return users$([token.slice(5)]);
  return [];
}

// ------------------------------------------------------------------ anchors

function anchorValues(
  f: Facts,
): Partial<Record<AnchorKey, Date | string | null | undefined>> {
  const est = f.estimate as { expiresAt?: Date | null } | null;
  const dep = f.deposit as { captureBefore?: Date | null } | null;
  return {
    "job.scheduled_start": f.job?.scheduledStart ?? null,
    "job.window_start": f.job?.windowStart ?? f.job?.scheduledStart ?? null,
    "job.window_end": f.job?.windowEnd ?? f.job?.scheduledEnd ?? null,
    "job.completed_at": f.job?.completedAt ?? null,
    "invoice.due_at": f.invoice?.dueAt ?? null,
    "dispute.due_by": (f.dispute as { dueBy?: Date | null } | null)?.dueBy,
    "deposit.capture_before": dep?.captureBefore ?? null,
    "entity.expires_on": est?.expiresAt ?? null,
  };
}

// ------------------------------------------------------------------ scheduling

export interface ScheduleResult {
  created: number;
  skipped: number;
}

/** Schedule every step of one automation for one event. */
export async function scheduleAutomation(
  tx: Tx,
  a: AutomationRow,
  e: DomainEvent,
  f: Facts,
  now: Date,
): Promise<ScheduleResult> {
  const out: ScheduleResult = { created: 0, skipped: 0 };
  const p = payloadOf(e);
  const cctx = conditionContext(f);
  const steps = (a.steps ?? []) as EngineStep[];
  const entityId =
    e.entity?.id ?? s(p, "date") ?? s(p, "user_id") ?? `ev${e.id}`;
  const entity: EntityRef | null = e.entity ?? null;
  const eventAt = e.createdAt ?? now;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step?.template_key) continue;
    if (step.only_on?.length && !step.only_on.includes(e.type)) continue;
    if (step.when && !evaluateConditions(step.when, cctx)) {
      out.skipped++;
      continue;
    }
    let templateKey = step.template_key;
    if (
      templateKey === "lead.ack" &&
      !isWithinBusinessHours(now, f.tz, f.settings.company.business_hours)
    )
      templateKey = "lead.ack_after_hours";

    let months = 0;
    if (step.delay_months_field) {
      months = Number(getField(cctx, step.delay_months_field)) || 0;
      if (months <= 0) {
        out.skipped++;
        continue;
      }
    }
    let computed: ReturnType<typeof computeSendAt>;
    try {
      computed = computeSendAt({
        step,
        months,
        eventAt,
        anchors: anchorValues(f),
        timeZone: f.tz,
      });
    } catch (err) {
      console.warn(`[automations] ${a.key} step ${i}:`, err);
      out.skipped++;
      continue;
    }
    if (step.dedupe === "batch") {
      const at = batchSendAt(
        now,
        step.batch_minutes ?? f.settings.notify.approval_batch_minutes,
      );
      computed = { anchorAt: now, sendAt: at };
    }
    const meta = await templateMeta(tx, templateKey);
    const decision = resolveSendTime(
      computed,
      now,
      meta?.expiresAfterMinutes ?? null,
    );
    if (decision.status === "skip") {
      out.skipped++;
      continue;
    }

    // Nobody needs a push about the action they just took (subject_user excepted) —
    // but only for event-time notices. A later reminder (unconfirmed tomorrow, late
    // prompt) is still news to the person who booked the job (QA T6-05).
    const skipActor = isImmediateStep(step, months);
    const recipients: Recipient[] = [];
    for (const token of splitPlus(step.audience)) {
      const list = await resolveAudience(tx, token, e, f);
      for (const r of list) {
        if (
          skipActor &&
          r.type === "user" &&
          token !== "subject_user" &&
          e.actorUserId &&
          r.userId === e.actorUserId
        )
          continue;
        const k = r.type === "user" ? `u${r.userId}` : `c${r.customerId}`;
        if (
          !recipients.some(
            (x) =>
              (x.type === "user" ? `u${x.userId}` : `c${x.customerId}`) === k,
          )
        )
          recipients.push(r);
      }
    }
    if (recipients.length === 0) {
      out.skipped++;
      continue;
    }

    for (const r of recipients) {
      const recipientKey = r.type === "user" ? r.userId : r.customerId;
      for (const channel of splitPlus(step.channel)) {
        const dedupeKey = dedupeKeyFor({
          automationKey: a.key,
          entityId,
          stepIndex: i,
          recipient: recipientKey,
          channel,
          step,
          anchorAt: computed.anchorAt,
          eventId: e.id,
          now,
        });
        // Rescheduled anchor → the old anchored send for this step is replaced.
        if (!isEventAnchored(step) && step.dedupe !== "batch")
          await tx
            .update(scheduledMessages)
            .set({
              status: "canceled",
              lastError: "rescheduled",
              updatedAt: new Date(),
            })
            .where(
              and(
                like(
                  scheduledMessages.dedupeKey,
                  `${escapeLike(dedupePrefixFor(a.key, entityId))}${i}:${escapeLike(recipientKey)}:${escapeLike(channel)}:%`,
                ),
                ne(scheduledMessages.dedupeKey, dedupeKey),
                inArray(scheduledMessages.status, [...OPEN]),
              ),
            );
        try {
          await enqueueCore(
            tx,
            {
              templateKey,
              channel: channel as never,
              audience:
                r.type === "user"
                  ? { type: "user", userId: r.userId }
                  : { type: "customer", customerId: r.customerId },
              entity: entity ?? undefined,
              jobId: f.job?.id ?? null,
              leadId: f.lead?.id ?? null,
              sendAt: decision.sendAt,
              dedupeKey,
              automationId: a.id,
              stepIndex: i,
              eventId: e.id,
              expiresAt: decision.expiresAt,
              initialStatus:
                decision.status === "expired" ? "expired" : undefined,
            },
            SYSTEM_ACTOR,
            now,
          );
          out.created++;
        } catch (err) {
          // One bad recipient (deleted customer…) must not block the event forever.
          console.warn(
            `[automations] ${a.key} step ${i} → ${recipientKey}: ${(err as Error).message}`,
          );
          out.skipped++;
        }
      }
    }
  }
  return out;
}

/**
 * True when the step fires at the event itself: event-time anchor, no delay, no pinned
 * clock time (batched approval pushes count: they summarize this very event).
 */
export function isImmediateStep(
  step: Pick<EngineStep, "anchor" | "delay" | "at">,
  months = 0,
): boolean {
  if (months) return false;
  if (step.at) return false;
  const d = step.delay;
  if ((d?.days ?? 0) !== 0 || (d?.hours ?? 0) !== 0 || (d?.minutes ?? 0) !== 0)
    return false;
  return (step.anchor ?? "event_time")
    .split("|")
    .every((a) => parseAnchor(a).kind === "event_time");
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Does any automation care about this event (trigger or cancel)? */
function relevant(all: AutomationRow[], type: string): boolean {
  return all.some(
    (a) =>
      (a.enabled && splitTriggers(a.triggerEvent).includes(type)) ||
      normalizeCancelOn(a.cancelOn).some((c) => c.event === type),
  );
}

export interface EngineResult {
  canceled: number;
  created: number;
  skipped: number;
  matched: string[];
}

/** The `'*'` handler body. Pure DB work inside the caller's (handler) transaction. */
export async function runAutomationEngine(
  tx: Tx,
  e: DomainEvent,
  now: Date = new Date(),
): Promise<EngineResult> {
  const res: EngineResult = {
    canceled: 0,
    created: 0,
    skipped: 0,
    matched: [],
  };
  if (e.type.startsWith("schedule.")) return res;
  const all = await tx.select().from(automations);
  const jobCancelled = e.type === "job.cancelled";
  if (!jobCancelled && !relevant(all, e.type)) return res;

  const p = payloadOf(e);
  const facts = await loadFacts(
    {
      entity: e.entity,
      event: { type: e.type, payload: p, at: e.createdAt },
    },
    tx,
  );
  const cctx = conditionContext(facts);

  // 1. cancellations (every automation, enabled or not: disabling never strands sends)
  for (const a of all) {
    for (const rule of normalizeCancelOn(a.cancelOn)) {
      if (rule.event !== e.type) continue;
      if (rule.when && !evaluateConditions(rule.when, cctx)) continue;
      res.canceled += await cancelForRule(tx, a, rule, e, facts);
    }
  }
  if (jobCancelled) {
    const jobId =
      s(p, "job_id") ?? (e.entity?.type === "job" ? e.entity.id : null);
    if (jobId) res.canceled += await cancelJobSends(tx, jobId);
  }

  // 2. triggers
  for (const a of all) {
    if (!a.enabled) continue;
    if (!splitTriggers(a.triggerEvent).includes(e.type)) continue;
    if (a.featureFlag && !(await isEnabled(a.featureFlag as FeatureFlag)))
      continue;
    if (!evaluateConditions(a.conditions, cctx)) continue;
    res.matched.push(a.key);
    const r = await scheduleAutomation(tx, a, e, facts, now);
    res.created += r.created;
    res.skipped += r.skipped;
  }
  return res;
}

/** Open sends for an entity (job/customer screens): used by queries and tests. */
export async function countOpenSends(tx: Tx, jobId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.jobId, jobId),
        inArray(scheduledMessages.status, [...OPEN]),
      ),
    );
  return Number(r?.n ?? 0);
}
