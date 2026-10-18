import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { customers, leads, scheduledMessages, users } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import type { Actor, EntityRef } from "@/lib/types";
import type {
  EnqueueMessageInput,
  Purpose,
  ScheduledStatus,
} from "./contracts";
import { prepareScheduled, templateMeta } from "./sender";

// The one insert path into scheduled_messages (BUILD_PLAN §6.5 enqueueMessage).
// Rows due now are prepared in the caller's transaction (no provider call): link-mode
// texts become outbox cards immediately, staff notifications are written, and every
// compliance outcome (opted out, no consent, quiet hours…) is known right away.
// Email / auto-send SMS stay `scheduled` and go out from the sender (after() + cron).

export interface EnqueueInternal extends EnqueueMessageInput {
  automationId?: string | null;
  stepIndex?: number | null;
  eventId?: number | null;
  expiresAt?: Date | null;
  /** Insert with this status (e.g. `expired` for a send that was already too late). */
  initialStatus?: ScheduledStatus;
}

export async function enqueueCore(
  tx: Tx,
  input: EnqueueInternal,
  _actor: Actor,
  now = new Date(),
): Promise<{ scheduledMessageId: string; status: ScheduledStatus }> {
  const dedupeKey = input.dedupeKey ?? `manual:${newId()}`;
  const [existing] = await tx
    .select({ id: scheduledMessages.id, status: scheduledMessages.status })
    .from(scheduledMessages)
    .where(eq(scheduledMessages.dedupeKey, dedupeKey))
    .limit(1);
  if (existing)
    return {
      scheduledMessageId: existing.id,
      status: existing.status as ScheduledStatus,
    };

  if (!input.templateKey && !input.body?.trim())
    throw new ValidationError({
      body: ["Write a message or pick a template."],
    });

  const meta = input.templateKey
    ? await templateMeta(tx, input.templateKey)
    : null;
  if (input.templateKey && !meta && !input.body)
    throw new NotFoundError(`Template ${input.templateKey}`);
  const purpose: Purpose = (input.purpose ??
    meta?.purpose ??
    "transactional") as Purpose;
  if (input.manualOverride && purpose !== "transactional")
    throw new ValidationError({
      _: ["Only transactional messages can override consent."],
    });

  // Recipient
  let recipientCustomerId: string | null = null;
  let recipientUserId: string | null = null;
  let toAddress: string | null = null;
  let audienceType: "customer" | "user" | "address" = "customer";
  if (input.audience.type === "customer") {
    const [c] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, input.audience.customerId))
      .limit(1);
    if (!c) throw new NotFoundError("Customer");
    recipientCustomerId = c.id;
    toAddress = input.audience.to ?? null;
  } else if (input.audience.type === "user") {
    const [u] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.audience.userId))
      .limit(1);
    if (!u) throw new NotFoundError("User");
    recipientUserId = u.id;
    audienceType = "user";
  } else {
    toAddress = input.audience.to;
    audienceType = "address";
  }

  // Lead with no customer yet: text the lead's own number.
  const leadId =
    input.leadId ?? (input.entity?.type === "lead" ? input.entity.id : null);
  if (
    !recipientCustomerId &&
    !toAddress &&
    leadId &&
    audienceType === "customer"
  ) {
    const [l] = await tx
      .select({
        phone: leads.phone,
        email: leads.email,
        customerId: leads.customerId,
      })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    recipientCustomerId = l?.customerId ?? null;
    toAddress = l?.phone ?? l?.email ?? null;
  }

  const entity: EntityRef | null =
    input.entity ??
    (leadId
      ? { type: "lead", id: leadId }
      : input.jobId
        ? { type: "job", id: input.jobId }
        : null);

  // Free text (and templates with caller vars) are rendered now; templates otherwise
  // render at send time with fresh data and per-send links.
  let renderedBody: string | null = null;
  let renderedSubject: string | null = null;
  if (input.body?.trim()) {
    renderedBody = input.body.trim();
    renderedSubject = input.subject?.trim() || null;
  }

  const [row] = await tx
    .insert(scheduledMessages)
    .values({
      automationId: input.automationId ?? null,
      stepIndex: input.stepIndex ?? null,
      dedupeKey,
      eventId: input.eventId ?? null,
      templateKey: input.templateKey ?? "manual",
      channel: input.channel,
      purpose,
      audienceType,
      recipientCustomerId,
      recipientUserId,
      toAddress,
      entityType: entity?.type ?? null,
      entityId: entity?.id ?? null,
      jobId: input.jobId ?? (entity?.type === "job" ? entity.id : null),
      sendAt: input.sendAt ?? now,
      expiresAt: input.expiresAt ?? null,
      status: input.initialStatus ?? "scheduled",
      assignedUserId: input.outboxAssigneeUserId ?? null,
      renderedBody,
      renderedSubject,
      vars: input.vars && Object.keys(input.vars).length ? input.vars : null,
      meta: input.manualOverride ? { manual_override: true } : null,
    })
    .returning({ id: scheduledMessages.id, sendAt: scheduledMessages.sendAt });
  if (!row) throw new Error("scheduled_messages insert failed");
  if (input.initialStatus && input.initialStatus !== "scheduled")
    return { scheduledMessageId: row.id, status: input.initialStatus };

  const due = row.sendAt.getTime() <= now.getTime() + 5_000;
  // Caller vars (eta_minutes, invite URLs …) are stored on the row and merged at send time.
  if (!due) return { scheduledMessageId: row.id, status: "scheduled" };
  const o = await prepareScheduled(tx, row.id, now, input.vars ?? undefined);
  return {
    scheduledMessageId: row.id,
    status: o.kind === "final" ? o.status : "scheduled",
  };
}
