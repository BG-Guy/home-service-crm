"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  activity as activityTable,
  leads,
  scheduledMessages,
} from "@/db/schema";
import {
  assertCustomerAccess,
  contactRevealedFor,
} from "@/features/customers/api";
import { assertJobAccess } from "@/features/jobs/api";
import { action } from "@/lib/action";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { normalizePhone } from "@/lib/phone";
import { updateSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { enqueueMessage, recordConsent } from "./api";
import type { ComposerSendResult, MsgChannel } from "./contracts";
import { recordInbound } from "./inbound";
import { rebaseAppLinks } from "./links";
import { bulkAudience, getComposerData } from "./queries";
import { composerRef, renderTemplateFor } from "./render";
import { recordOutbound, type SchedRow } from "./sender";

// Messaging mutations (SPEC M12). All customer sends go through enqueueMessage — the
// composer passes the edited text as free text; consent, quiet hours (automated only)
// and opt-outs are still enforced at send time.

const id = z.string().uuid();
// "" (an empty form field) means none.
const optId = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().uuid().optional(),
);

async function customerAccess(user: SessionUser, customerId: string) {
  if (!user.perms.has("messages.view_all"))
    await assertCustomerAccess(user, customerId, "read");
}

/**
 * Techs text customers only inside the active contact window (SPEC §4.2 masking): a
 * link-mode send hands them the number, so outside the window they can't send.
 */
async function assertCanContact(user: SessionUser, customerId: string) {
  if (user.perms.has("customers.contact_view")) return;
  const { revealed } = await contactRevealedFor(user, customerId);
  if (!revealed)
    throw new ValidationError({
      _: [
        "You can text this customer from 2 hours before your visit until a day after.",
      ],
    });
}

/**
 * A job or lead attached to a message must be one the sender can open AND belong to
 * the same customer (QA T5-06): otherwise a tech could mint working /j/ and /i/ portal
 * links for someone else's job, or file a text on another customer's job.
 */
async function assertRefs(
  tx: Tx,
  user: SessionUser,
  i: { customerId: string; jobId?: string | null; leadId?: string | null },
) {
  if (i.jobId) {
    let jobCustomerId: string;
    try {
      jobCustomerId = (await assertJobAccess(user, i.jobId, "read")).customerId;
    } catch {
      throw new NotFoundError("Job");
    }
    if (jobCustomerId !== i.customerId) throw new NotFoundError("Job");
  }
  if (i.leadId) {
    if (!user.perms.has("leads.view")) throw new NotFoundError("Lead");
    const [l] = await tx
      .select({ customerId: leads.customerId })
      .from(leads)
      .where(eq(leads.id, i.leadId))
      .limit(1);
    if (!l || l.customerId !== i.customerId) throw new NotFoundError("Lead");
  }
}

const threadPaths = (customerId: string, jobId?: string | null) => [
  "/messages",
  `/messages/${customerId}`,
  `/customers/${customerId}`,
  ...(jobId ? [`/jobs/${jobId}`] : []),
];

// ------------------------------------------------------------------ composer

/** Composer data for client slots mounted without server-provided `initial` data. */
export const loadComposer = action({
  name: "messages.load_composer",
  perm: "messages.send",
  input: z.object({
    customerId: id,
    jobId: optId,
    leadId: optId,
    templateKeys: z.array(z.string().max(80)).max(30).optional(),
  }),
  async run({ input, tx, user }) {
    await customerAccess(user, input.customerId);
    await assertRefs(tx, user, input);
    const data = await getComposerData(input.customerId, user, {
      templateKeys: input.templateKeys,
      jobId: input.jobId,
      leadId: input.leadId,
    });
    if (!data) throw new NotFoundError("Customer");
    return data;
  },
});

/** Template picked in the composer → real text with live links, ready to edit. */
export const prepareTemplate = action({
  name: "messages.prepare_template",
  perm: "messages.send",
  input: z.object({
    customerId: id,
    jobId: optId,
    leadId: optId,
    templateKey: z.string().min(1).max(80),
    channel: z.enum(["sms", "whatsapp", "email"]),
  }),
  async run({ input, tx, user }) {
    await customerAccess(user, input.customerId);
    // Minting real links: the job/lead must be the viewer's and this customer's.
    await assertRefs(tx, user, input);
    const ref = await composerRef(tx, input);
    const r = await renderTemplateFor(tx, {
      templateKey: input.templateKey,
      channel: input.channel === "whatsapp" ? "sms" : input.channel,
      customerId: input.customerId,
      jobId: input.jobId ?? null,
      leadId: input.leadId ?? null,
      entity: ref.entity,
      mint: true,
    });
    if (!r) throw new NotFoundError("Template");
    return { body: r.body, subject: r.subject };
  },
});

const SendInput = z.object({
  customerId: id,
  jobId: optId,
  leadId: optId,
  channel: z.enum(["sms", "whatsapp", "email"]),
  templateKey: z.string().max(80).optional(),
  body: z.string().trim().min(1, "Write a message.").max(1600),
  subject: z.string().trim().max(200).optional(),
  manualOverride: z.boolean().optional(),
  clientId: optId,
});

export const sendMessage = action({
  name: "messages.send",
  perm: "messages.send",
  input: SendInput,
  async run({ input, tx, user, actor }): Promise<ComposerSendResult> {
    await customerAccess(user, input.customerId);
    await assertRefs(tx, user, input);
    if (input.channel !== "email")
      await assertCanContact(user, input.customerId);
    const res = await enqueueMessage(
      tx,
      {
        templateKey: input.templateKey || undefined,
        body: input.body,
        subject: input.subject,
        channel: input.channel as MsgChannel,
        purpose: "transactional",
        audience: { type: "customer", customerId: input.customerId },
        entity: input.jobId
          ? { type: "job", id: input.jobId }
          : input.leadId
            ? { type: "lead", id: input.leadId }
            : { type: "customer", id: input.customerId },
        jobId: input.jobId ?? null,
        leadId: input.leadId ?? null,
        dedupeKey: `manual:${input.clientId ?? newId()}`,
        outboxAssigneeUserId: user.id,
        manualOverride: input.manualOverride ?? false,
      },
      actor,
    );
    const [row] = await tx
      .select({
        to: scheduledMessages.toAddress,
        body: scheduledMessages.renderedBody,
        channel: scheduledMessages.channel,
        reason: scheduledMessages.lastError,
      })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, res.scheduledMessageId))
      .limit(1);
    return {
      scheduledMessageId: res.scheduledMessageId,
      status: res.status,
      channel: (row?.channel ?? input.channel) as MsgChannel,
      to: row?.to ?? null,
      body: row?.body ?? input.body,
      reason: res.status === "pending_tap" ? null : (row?.reason ?? null),
    };
  },
  revalidate: ({ input }) => threadPaths(input.customerId, input.jobId),
});

// ------------------------------------------------------------------ outbox

async function loadCard(
  tx: Tx,
  user: SessionUser,
  cardId: string,
): Promise<SchedRow> {
  const [row] = await tx
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.id, cardId))
    .for("update")
    .limit(1);
  if (!row) throw new NotFoundError("Message");
  const mine =
    row.assignedUserId === user.id ||
    (row.assignedUserId === null && user.perms.has("messages.outbox_all"));
  if (!mine && !user.perms.has("messages.outbox_all"))
    throw new ForbiddenError(undefined, "messages.outbox_all");
  return row;
}

/** "Sent? Yes" — the person sent it from their phone. */
export const markOutboxSent = action({
  name: "messages.outbox_sent",
  perm: "messages.send",
  input: z.object({
    id,
    body: z.string().trim().min(1).max(1600).optional(),
  }),
  async run({ input, tx, user }) {
    const row = await loadCard(tx, user, input.id);
    if (row.status !== "pending_tap")
      return { status: row.status, already: true };
    await recordOutbound(tx, row, {
      status: "sent_manual",
      body: input.body ?? rebaseAppLinks(row.renderedBody ?? ""),
      driver: row.driver ?? "link",
      sentByUserId: user.id,
    });
    return { status: "sent_manual", already: false };
  },
  revalidate: () => ["/messages/outbox", "/messages", "/today"],
});

export const skipOutbox = action({
  name: "messages.outbox_skip",
  perm: "messages.send",
  input: z.object({ id }),
  async run({ input, tx, user }) {
    const row = await loadCard(tx, user, input.id);
    if (row.status !== "pending_tap") return { status: row.status };
    await tx
      .update(scheduledMessages)
      .set({
        status: "skipped",
        lastError: `skipped_by:${user.id}`,
        updatedAt: new Date(),
      })
      .where(eq(scheduledMessages.id, row.id));
    return { status: "skipped" };
  },
  revalidate: () => ["/messages/outbox", "/messages", "/today"],
});

export const editOutboxBody = action({
  name: "messages.outbox_edit",
  perm: "messages.send",
  input: z.object({ id, body: z.string().trim().min(1).max(1600) }),
  async run({ input, tx, user }) {
    const row = await loadCard(tx, user, input.id);
    if (row.status !== "pending_tap")
      throw new ValidationError({ _: ["This text was already handled."] });
    await tx
      .update(scheduledMessages)
      .set({ renderedBody: input.body, updatedAt: new Date() })
      .where(eq(scheduledMessages.id, row.id));
    return { ok: true };
  },
});

// ------------------------------------------------------------------ thread

export const logReply = action({
  name: "messages.log_reply",
  perm: "messages.send",
  input: z.object({
    customerId: id,
    body: z.string().trim().min(1, "What did they say?").max(1600),
    channel: z.enum(["sms", "whatsapp", "email"]).default("sms"),
    jobId: optId,
  }),
  async run({ input, tx, user }) {
    await customerAccess(user, input.customerId);
    await assertRefs(tx, user, input);
    const r = await recordInbound(tx, {
      customerId: input.customerId,
      from: null,
      body: input.body,
      channel: input.channel,
      driver: "manual",
      status: "logged",
      loggedByUserId: user.id,
      jobId: input.jobId ?? null,
    });
    return r;
  },
  revalidate: ({ input }) => threadPaths(input.customerId, input.jobId),
});

export const cancelScheduledSend = action({
  name: "messages.cancel_scheduled",
  perm: "messages.send",
  input: z.object({ id }),
  audit: "message.scheduled_canceled",
  async run({ input, tx, user }) {
    const [row] = await tx
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, input.id))
      .limit(1);
    if (!row) throw new NotFoundError("Message");
    const allowed =
      user.perms.has("messages.view_all") ||
      user.perms.has("messages.outbox_all") ||
      row.assignedUserId === user.id;
    if (!allowed) throw new ForbiddenError();
    await tx
      .update(scheduledMessages)
      .set({
        status: "canceled",
        lastError: `canceled_by:${user.id}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledMessages.id, row.id),
          inArray(scheduledMessages.status, [
            "scheduled",
            "deferred_quiet",
            "pending_tap",
          ]),
        ),
      );
    return {
      customerId: row.recipientCustomerId,
      jobId: row.jobId,
    };
  },
  auditEntity: ({ input }) => ({ type: "scheduled_message", id: input.id }),
  revalidate: ({ data }) => [
    "/messages/outbox",
    ...(data.customerId ? threadPaths(data.customerId, data.jobId) : []),
  ],
});

// ------------------------------------------------------------------ consent

/** One-tap "Customer asked us to stop texting" (S31, thread opt-out review). */
export const stopTexting = action({
  name: "consent.stop_texting",
  perm: "messages.send",
  input: z.object({
    customerId: id,
    note: z.string().trim().max(300).optional(),
  }),
  audit: "consent.revoked",
  async run({ input, tx, user, actor }) {
    await customerAccess(user, input.customerId);
    const { customers } = await import("@/db/schema");
    const [c] = await tx
      .select({ phone: customers.phone })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    return recordConsent(
      tx,
      {
        customerId: input.customerId,
        address: c?.phone ?? "unknown",
        channel: "sms",
        purpose: "transactional",
        action: "revoke",
        source: "admin",
        textShown: input.note ?? "Customer asked us to stop texting",
        actorUserId: user.id,
      },
      actor,
    );
  },
  auditEntity: ({ input }) => ({ type: "customer", id: input.customerId }),
  revalidate: ({ input }) => threadPaths(input.customerId),
});

/** Record consent the customer gave by phone / in person (S31). */
export const grantConsent = action({
  name: "consent.grant",
  perm: "customers.edit",
  input: z.object({
    customerId: id,
    channel: z.enum(["sms", "email"]).default("sms"),
    purpose: z.enum(["transactional", "marketing"]),
    source: z.enum(["verbal", "admin"]).default("verbal"),
    note: z.string().trim().max(300).optional(),
  }),
  audit: "consent.granted",
  async run({ input, tx, user, actor }) {
    const { customers } = await import("@/db/schema");
    const [c] = await tx
      .select({ phone: customers.phone, email: customers.email })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    const address = input.channel === "email" ? c?.email : c?.phone;
    if (!address)
      throw new ValidationError({
        _: [
          input.channel === "email"
            ? "Add an email address first."
            : "Add a phone number first.",
        ],
      });
    return recordConsent(
      tx,
      {
        customerId: input.customerId,
        address,
        channel: input.channel,
        purpose: input.purpose,
        action: "grant",
        source: input.source,
        textShown: input.note ?? null,
        actorUserId: user.id,
      },
      actor,
    );
  },
  auditEntity: ({ input }) => ({ type: "customer", id: input.customerId }),
  revalidate: ({ input }) => threadPaths(input.customerId),
});

/** The flagged reply wasn't an opt-out ("Keep texting"). */
export const dismissOptoutFlag = action({
  name: "consent.optout_dismissed",
  perm: "messages.send",
  input: z.object({ customerId: id }),
  async run({ input, tx, user }) {
    await customerAccess(user, input.customerId);
    await tx.insert(activityTable).values({
      entityType: "customer",
      entityId: input.customerId,
      customerId: input.customerId,
      kind: "message.optout_dismissed",
      summary: "Reviewed a possible opt-out: keep texting",
      actorUserId: user.id,
    });
    return { ok: true };
  },
  revalidate: ({ input }) => threadPaths(input.customerId),
});

// ------------------------------------------------------------------ bulk send

const BulkInput = z.object({
  audience: z.enum(["marketing", "all_textable", "recent_customers"]),
  months: z.coerce.number().int().min(1).max(60).optional(),
  purpose: z.enum(["marketing", "transactional"]),
  body: z.string().trim().min(1, "Write the message.").max(480),
  /** The person typed the recipient count to confirm. */
  confirmCount: z.coerce.number().int().min(1),
});

/** Bulk preview: recipient count + sample names (never from review screens). */
export const previewBulk = action({
  name: "messages.bulk_preview",
  perm: "messages.bulk_send",
  input: BulkInput.pick({ audience: true, months: true }),
  async run({ input }) {
    const a = await bulkAudience(input);
    return { count: a.ids.length, sample: a.sample };
  },
});

export const sendBulk = action({
  name: "messages.bulk_send",
  perm: "messages.bulk_send",
  input: BulkInput,
  audit: "messages.bulk_send",
  async run({ input, tx, actor, audit }) {
    if (input.purpose === "transactional" && input.audience === "marketing")
      throw new ValidationError({
        purpose: ["Marketing-only audiences get marketing messages."],
      });
    const a = await bulkAudience(input);
    if (a.ids.length !== input.confirmCount)
      throw new ValidationError({
        confirmCount: [
          `The audience is now ${a.ids.length} people. Type that number to confirm.`,
        ],
      });
    const batch = newId();
    let queued = 0;
    for (const customerId of a.ids) {
      await enqueueMessage(
        tx,
        {
          body: input.body,
          channel: "sms",
          purpose: input.purpose,
          audience: { type: "customer", customerId },
          entity: { type: "customer", id: customerId },
          dedupeKey: `bulk:${batch}:${customerId}`,
        },
        actor,
      );
      queued++;
    }
    await audit({
      entity: null,
      after: {
        batch,
        audience: input.audience,
        purpose: input.purpose,
        count: queued,
      },
    });
    return { batch, queued };
  },
  revalidate: () => ["/messages", "/messages/outbox"],
});

// ------------------------------------------------------------------ settings

export const saveMessagingSettings = action({
  name: "settings.messaging",
  perm: "settings.manage",
  input: z.object({
    tech_texts_from: z.enum(["tech_phone", "office_outbox"]),
    link_delimiter: z.enum(["auto", "?", "&", "?&"]),
    whatsapp_enabled: z.boolean(),
    email_from_name: z.string().trim().max(80).nullable(),
    reply_phone: z.string().trim().max(30).nullable(),
    outbox_owner_by_template: z.record(
      z.string().max(80),
      z.enum(["tech", "office"]),
    ),
    daily_digest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    approval_batch_minutes: z.coerce.number().int().min(5).max(120),
  }),
  audit: "settings.messaging",
  async run({ input, tx, actor }) {
    const { daily_digest_time, approval_batch_minutes, ...messaging } = input;
    // A number customers are told to call: a real phone, stored as E.164 (QA T3-13).
    let replyPhone: string | null = null;
    if (messaging.reply_phone) {
      replyPhone = normalizePhone(messaging.reply_phone);
      if (!replyPhone)
        throw new ValidationError({
          reply_phone: ["Enter a valid phone number, like (512) 555-0100."],
        });
    }
    await updateSettings(
      tx,
      {
        messaging: {
          ...messaging,
          email_from_name: messaging.email_from_name || null,
          reply_phone: replyPhone,
        },
        notify: { daily_digest_time, approval_batch_minutes },
      },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => ["/settings/messaging"],
});
