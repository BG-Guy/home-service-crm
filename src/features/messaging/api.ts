import "server-only";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  consentEvents,
  customers,
  messages,
  scheduledMessages,
} from "@/db/schema";
import { setCustomerSmsStatus } from "@/features/customers/api";
import type { SmsStatus } from "@/features/customers/contracts";
import { writeActivity } from "@/lib/activity";
import { NotFoundError } from "@/lib/errors";
import { emit } from "@/lib/events";
import type { Perm } from "@/lib/permissions";
import { listUsersWithPerm } from "@/lib/permissions-db";
import type { Actor, EntityRef } from "@/lib/types";
import type {
  ConsentStatus,
  EnqueueMessageInput,
  RecordConsentInput,
  ScheduledStatus,
} from "./contracts";
import { enqueueCore } from "./enqueue";
import { kickSender } from "./sender";

// B5 messaging API (BUILD_PLAN §6.5) — THE ONLY way to message a customer, tech or
// admin. Every send is a scheduled_messages row; the sender re-checks consent, quiet
// hours, caps and entity state at send time (SPEC M12/M13).

export type * from "./contracts";

const OPEN_STATUSES = ["scheduled", "deferred_quiet", "pending_tap"] as const;

/**
 * Insert a scheduled_messages row (idempotent on dedupeKey). Rows due now are decided
 * in the caller's transaction (link-mode texts become outbox cards, staff notifications
 * are written, compliance outcomes are final); email / auto-send SMS go out right after
 * the response (after()) or on the next cron minute. Returns the terminal status when
 * already known, else `scheduled`.
 */
export async function enqueueMessage(
  tx: Tx,
  input: EnqueueMessageInput,
  actor: Actor,
): Promise<{ scheduledMessageId: string; status: ScheduledStatus }> {
  const res = await enqueueCore(tx, input, actor);
  if (res.status === "scheduled") kickSender();
  return res;
}

/** Cancel queued / outbox sends matching the filter (refuses an empty filter). */
export async function cancelScheduledMessages(
  tx: Tx,
  q: {
    entity?: EntityRef;
    jobId?: string;
    templateKeys?: string[];
    dedupePrefix?: string;
  },
  reason: string,
): Promise<number> {
  const conds = [inArray(scheduledMessages.status, [...OPEN_STATUSES])];
  if (q.entity)
    conds.push(
      eq(scheduledMessages.entityType, q.entity.type),
      eq(scheduledMessages.entityId, q.entity.id),
    );
  if (q.jobId) conds.push(eq(scheduledMessages.jobId, q.jobId));
  if (q.templateKeys?.length)
    conds.push(inArray(scheduledMessages.templateKey, q.templateKeys));
  if (q.dedupePrefix)
    conds.push(
      like(
        scheduledMessages.dedupeKey,
        `${q.dedupePrefix.replace(/[\\%_]/g, "\\$&")}%`,
      ),
    );
  if (conds.length === 1) return 0; // refuse to cancel everything
  const rows = await tx
    .update(scheduledMessages)
    .set({
      status: "canceled",
      lastError: reason.slice(0, 200),
      updatedAt: new Date(),
    })
    .where(and(...conds))
    .returning({ id: scheduledMessages.id });
  return rows.length;
}

/**
 * Outbox cards waiting for a tap. `mine` = assigned to the user, plus the unassigned
 * office pool for people with `messages.outbox_all`; `all` = every card (callers
 * decide who may ask for `all`).
 */
export async function getOutboxCount(
  userId: string,
  scope: "mine" | "all" = "mine",
): Promise<number> {
  const conds = [eq(scheduledMessages.status, "pending_tap")];
  if (scope === "mine") {
    // The unassigned (office) pool counts only for people who work the shared outbox.
    const pool = (
      await listUsersWithPerm("messages.outbox_all" as Perm)
    ).includes(userId);
    const mine = pool
      ? or(
          eq(scheduledMessages.assignedUserId, userId),
          isNull(scheduledMessages.assignedUserId),
        )
      : eq(scheduledMessages.assignedUserId, userId);
    if (mine) conds.push(mine);
  }
  const [r] = await db
    .select({ n: count() })
    .from(scheduledMessages)
    .where(and(...conds));
  return Number(r?.n ?? 0);
}

/** Derived consent flags (cached customer columns; sms_status is ledger-derived). */
export async function getConsentStatus(
  customerId: string,
): Promise<ConsentStatus> {
  const [c] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!c) throw new NotFoundError("Customer");
  const sms = c.smsStatus as SmsStatus;
  const blocked = c.doNotText || c.doNotContact || sms === "opted_out";
  return {
    smsStatus: sms,
    doNotText: c.doNotText,
    doNotContact: c.doNotContact,
    canSmsTransactional: !blocked && !!c.phone,
    canSmsMarketing: !blocked && !!c.phone && sms === "marketing",
    canEmail: !c.doNotContact && !!c.email,
  };
}

/**
 * sms_status from the SMS consent ledger (newest first): a transactional revoke opts
 * out of everything; a marketing grant (unless revoked later) is `marketing`; a
 * transactional grant is `transactional`; nothing is `unknown`. Pure.
 */
export function deriveSmsStatus(
  ledgerNewestFirst: { purpose: string; action: string }[],
): SmsStatus {
  const latest = (p: string) =>
    ledgerNewestFirst.find((e) => e.purpose === p)?.action;
  const t = latest("transactional");
  const m = latest("marketing");
  if (t === "revoke") return "opted_out";
  if (m === "grant") return "marketing";
  if (t === "grant") return "transactional";
  // A marketing revoke alone leaves transactional texting (express consent unknown).
  return "unknown";
}

/** Recompute + store sms_status from the ledger (also used after a customer merge). */
export async function recomputeSmsStatus(
  tx: Tx,
  customerId: string,
): Promise<SmsStatus> {
  const ledger = await tx
    .select({ purpose: consentEvents.purpose, action: consentEvents.action })
    .from(consentEvents)
    .where(
      and(
        eq(consentEvents.customerId, customerId),
        inArray(consentEvents.channel, ["sms", "whatsapp"]),
      ),
    )
    .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id));
  const status = deriveSmsStatus(ledger);
  await setCustomerSmsStatus(tx, customerId, status);
  return status;
}

/**
 * Append a consent event (append-only ledger), recompute sms_status (B1 setter),
 * emit consent.changed + activity, and on revoke suppress queued sends it covers:
 * SMS transactional revoke → every queued text; SMS marketing revoke → marketing and
 * review texts; email revoke → marketing emails. `customer_preferred` rows are
 * re-resolved at send time (they may still go by email).
 */
export async function recordConsent(
  tx: Tx,
  input: RecordConsentInput,
  actor: Actor,
): Promise<{ consentEventId: string; smsStatus: SmsStatus }> {
  const [row] = await tx
    .insert(consentEvents)
    .values({
      customerId: input.customerId,
      address: input.address,
      channel: input.channel,
      purpose: input.purpose,
      action: input.action,
      source: input.source,
      textShown: input.textShown ?? null,
      pageUrl: input.pageUrl ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      actorUserId: input.actorUserId ?? actor.userId,
      messageId: input.messageId ?? null,
    })
    .returning({ id: consentEvents.id });
  if (!row) throw new Error("consent insert failed");

  let smsStatus: SmsStatus;
  if (input.channel === "email") {
    const [c] = await tx
      .select({ s: customers.smsStatus })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    smsStatus = (c?.s ?? "unknown") as SmsStatus;
  } else smsStatus = await recomputeSmsStatus(tx, input.customerId);

  const entity = { type: "customer", id: input.customerId } as const;
  await emit(
    tx,
    "consent.changed",
    entity,
    {
      customer_id: input.customerId,
      channel: input.channel,
      purpose: input.purpose,
      action: input.action,
      source: input.source,
    },
    { actor },
  );
  const label = input.channel === "email" ? "Email" : "Text";
  await writeActivity(tx, {
    entity,
    kind: "consent.changed",
    summary: `${label} ${input.purpose} consent ${input.action === "grant" ? "granted" : "revoked"} (${input.source.replace(/_/g, " ")})`,
    data: {
      channel: input.channel,
      purpose: input.purpose,
      source: input.source,
    },
    actorUserId: actor.userId,
  });

  if (input.action === "revoke") {
    const isText = input.channel !== "email";
    const channels = isText ? ["sms", "whatsapp"] : ["email"];
    const purposes =
      isText && input.purpose === "transactional"
        ? null
        : ["marketing", "review"];
    await tx
      .update(scheduledMessages)
      .set({
        status: "suppressed_optout",
        lastError: `consent_revoked:${input.channel}:${input.purpose}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMessages.recipientCustomerId, input.customerId),
          inArray(scheduledMessages.status, [...OPEN_STATUSES]),
          inArray(scheduledMessages.channel, channels),
          purposes ? inArray(scheduledMessages.purpose, purposes) : sql`true`,
        ),
      );
  }
  return { consentEventId: row.id, smsStatus };
}

/** Scrub message bodies and addresses for an anonymized customer (B1 anonymize). */
export async function anonymizeCustomerMessages(
  tx: Tx,
  customerId: string,
  _actor: Actor,
): Promise<void> {
  await tx
    .update(messages)
    .set({
      body: "[removed]",
      toAddress: null,
      fromAddress: null,
      subject: null,
    })
    .where(eq(messages.customerId, customerId));
  await tx
    .update(scheduledMessages)
    .set({
      status: sql`case when ${scheduledMessages.status} in ('scheduled','deferred_quiet','pending_tap') then 'canceled' else ${scheduledMessages.status} end`,
      renderedBody: null,
      renderedSubject: null,
      toAddress: null,
      updatedAt: new Date(),
    })
    .where(eq(scheduledMessages.recipientCustomerId, customerId));
}
