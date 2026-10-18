// §6.8 Messaging, automations, notifications, portal
// (modules: messaging, automations, notify, reviews, portal).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  createdAt,
  id,
  identityId,
  timestamps,
  tz,
  uuidArray,
} from "../columns";
import { users } from "./company";
import { customers } from "./customers";
import { jobs } from "./jobs";

export const messageTemplates = pgTable(
  "message_templates",
  {
    id: id(),
    key: text("key").notNull(), // e.g. 'job.on_my_way'
    channel: text("channel").notNull(), // sms|email|push|in_app
    locale: text("locale").notNull().default("en"),
    purpose: text("purpose").notNull(), // transactional|marketing|review|internal
    subject: text("subject"),
    body: text("body").notNull(),
    defaultBody: text("default_body").notNull(),
    expiresAfterMinutes: integer("expires_after_minutes"), // outbox expiry
    allowOutsideQuietHours: boolean("allow_outside_quiet_hours")
      .notNull()
      .default(false),
    builtin: boolean("builtin").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    unique("message_templates_key_channel_locale_uq").on(
      t.key,
      t.channel,
      t.locale,
    ),
  ],
);

export interface AutomationStep {
  delay?: { minutes?: number; hours?: number; days?: number };
  anchor?: string;
  channel: string;
  audience: string;
  template_key: string;
}

export const automations = pgTable("automations", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  triggerEvent: text("trigger_event").notNull(), // see §7.1
  conditions: jsonb("conditions")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  steps: jsonb("steps").$type<AutomationStep[]>().notNull(),
  cancelOn: jsonb("cancel_on").$type<unknown[]>().notNull().default([]),
  featureFlag: text("feature_flag"), // suppressed when flag off
  enabled: boolean("enabled").notNull().default(true),
  builtin: boolean("builtin").notNull().default(true),
  updatedBy: uuid("updated_by").references(() => users.id),
  ...timestamps(),
});

/**
 * Transactional outbox. Append-only (trigger) except processed_at/attempts/error,
 * which the event processor updates.
 */
export const events = pgTable(
  "events",
  {
    id: identityId(),
    type: text("type").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    actorUserId: uuid("actor_user_id"),
    createdAt: createdAt(),
    processedAt: tz("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
  },
  (t) => [
    index("events_unprocessed_idx")
      .on(t.id)
      .where(sql`${t.processedAt} is null`),
  ],
);

export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: id(),
    automationId: uuid("automation_id").references(() => automations.id),
    stepIndex: integer("step_index"),
    dedupeKey: text("dedupe_key").notNull().unique(), // automation:entity:step (or manual:<uuid>)
    eventId: bigint("event_id", { mode: "number" }),
    templateKey: text("template_key").notNull(),
    channel: text("channel").notNull(),
    purpose: text("purpose").notNull(),
    audienceType: text("audience_type").notNull(), // customer|user
    recipientCustomerId: uuid("recipient_customer_id"),
    recipientUserId: uuid("recipient_user_id"),
    toAddress: text("to_address"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    jobId: uuid("job_id"),
    sendAt: tz("send_at").notNull(),
    expiresAt: tz("expires_at"),
    status: text("status").notNull().default("scheduled"), // see SCHEDULED_MESSAGE_STATUSES
    driver: text("driver"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    renderedSubject: text("rendered_subject"),
    renderedBody: text("rendered_body"),
    messageId: uuid("message_id"),
    providerId: text("provider_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Caller variables (eta_minutes, invite URLs…) rendered at send time. */
    vars: jsonb("vars").$type<Record<string, string>>(),
    /** Send flags, e.g. `{ manual_override: true }`. */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    index("sched_due_idx")
      .on(t.sendAt)
      .where(sql`${t.status} in ('scheduled','deferred_quiet')`),
    index("sched_outbox_idx")
      .on(t.assignedUserId, t.status)
      .where(sql`${t.status} = 'pending_tap'`),
    index("sched_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    customerId: uuid("customer_id").references(() => customers.id),
    leadId: uuid("lead_id"),
    jobId: uuid("job_id"),
    userId: uuid("user_id").references(() => users.id), // staff counterpart
    direction: text("direction").notNull(), // out|in
    channel: text("channel").notNull(),
    driver: text("driver").notNull(),
    purpose: text("purpose").notNull(),
    toAddress: text("to_address"),
    fromAddress: text("from_address"),
    subject: text("subject"),
    body: text("body").notNull(),
    mediaIds: uuidArray("media_ids"),
    status: text("status").notNull(), // queued|sent|sent_manual|delivered|failed|received|logged
    providerId: text("provider_id"),
    error: text("error"),
    scheduledMessageId: uuid("scheduled_message_id"),
    templateKey: text("template_key"),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id),
    sentAt: tz("sent_at"),
    deliveredAt: tz("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_customer_idx").on(
      t.customerId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("messages_provider_idx").on(t.providerId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    priority: text("priority").notNull().default("normal"),
    readAt: tz("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx")
      .on(t.userId, t.createdAt.desc().nullsFirst())
      .where(sql`${t.readAt} is null`),
  ],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  failedCount: integer("failed_count").notNull().default(0),
  lastSuccessAt: tz("last_success_at"),
  createdAt: createdAt(),
});

/** Custom reminders (admin). */
export const reminders = pgTable(
  "reminders",
  {
    id: id(),
    title: text("title").notNull(),
    body: text("body"),
    templateKey: text("template_key"),
    audience: jsonb("audience")
      .$type<{
        type: "user" | "role" | "customer";
        id?: string;
        role?: string;
        /** Customer reminders default to marketing (consent + caps) ⚖️. */
        purpose?: "marketing" | "transactional";
      }>()
      .notNull(),
    channel: text("channel").notNull(), // push|email|sms|in_app
    recurrence: jsonb("recurrence")
      .$type<{ type: string; [k: string]: unknown }>()
      .notNull(),
    nextAt: tz("next_at"),
    lastAt: tz("last_at"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [index("reminders_due_idx").on(t.nextAt).where(sql`${t.active}`)],
);

export const reviewRequests = pgTable("review_requests", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => jobs.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  techUserId: uuid("tech_user_id").references(() => users.id),
  tokenId: uuid("token_id"),
  sentCount: integer("sent_count").notNull().default(0),
  firstSentAt: tz("first_sent_at"),
  lastSentAt: tz("last_sent_at"),
  clickedAt: tz("clicked_at"),
  clickCount: integer("click_count").notNull().default(0),
  rating: integer("rating"),
  feedback: text("feedback"),
  wantsCallback: boolean("wants_callback"),
  reviewReceivedAt: tz("review_received_at"), // manual log for bonuses
  createdAt: createdAt(),
});

export const publicTokens = pgTable("public_tokens", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  kind: text("kind").notNull(), // job|estimate|invoice|pay|review|tracking|sub_job
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  customerId: uuid("customer_id"),
  jobId: uuid("job_id"),
  expiresAt: tz("expires_at").notNull(),
  revokedAt: tz("revoked_at"),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: tz("last_used_at"),
  createdAt: createdAt(),
});

/** Append-only (trigger). */
export const portalAccessLog = pgTable(
  "portal_access_log",
  {
    id: identityId(),
    tokenId: uuid("token_id").notNull(),
    path: text("path").notNull(),
    action: text("action").notNull(), // see PORTAL_ACTIONS
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("portal_log_token_idx").on(t.tokenId, t.createdAt)],
);
