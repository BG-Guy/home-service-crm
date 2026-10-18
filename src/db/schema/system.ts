// §6.13 Location, activity, audit, system (modules: map, notify, data, core infra)
// + cross-module queues from §6.11: approvals, ai_tasks, ai_usage.
import { sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
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

/** Last known tech location (upsert). */
export const techLocations = pgTable("tech_locations", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracyM: real("accuracy_m"),
  heading: real("heading"),
  speed: real("speed"),
  source: text("source").notNull(), // ping|status
  jobId: uuid("job_id"),
  recordedAt: tz("recorded_at").notNull(),
});

/** Optional, pruned daily. */
export const locationBreadcrumbs = pgTable(
  "location_breadcrumbs",
  {
    id: identityId(),
    userId: uuid("user_id").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: real("accuracy_m"),
    recordedAt: tz("recorded_at").notNull(),
  },
  (t) => [index("breadcrumbs_user_idx").on(t.userId, t.recordedAt)],
);

/** Human timeline. */
export const activity = pgTable(
  "activity",
  {
    id: identityId(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    customerId: uuid("customer_id"),
    jobId: uuid("job_id"),
    kind: text("kind").notNull(), // event type
    summary: text("summary").notNull(),
    data: jsonb("data"),
    actorUserId: uuid("actor_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("activity_customer_idx").on(
      t.customerId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("activity_job_idx").on(t.jobId, t.createdAt.desc().nullsFirst()),
    index("activity_entity_idx").on(
      t.entityType,
      t.entityId,
      t.createdAt.desc().nullsFirst(),
    ),
  ],
);

/** Append-only (trigger). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: identityId(),
    actorUserId: uuid("actor_user_id"),
    actorKind: text("actor_kind").notNull(), // user|system|api|webhook|public_token
    action: text("action").notNull(), // 'invoice.revised', 'customer.viewed', 'perm.changed', …
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_entity_idx").on(
      t.entityType,
      t.entityId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("audit_actor_idx").on(t.actorUserId, t.createdAt.desc().nullsFirst()),
  ],
);

/** Background tasks. Worker: SELECT … FOR UPDATE SKIP LOCKED LIMIT 10. */
export const jobQueue = pgTable(
  "job_queue",
  {
    id: identityId(),
    kind: text("kind").notNull(), // email|ai|pdf|evidence_pack|export|backup|geocode|vin|recalls|push
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key").unique(),
    runAt: tz("run_at").notNull().defaultNow(),
    status: text("status").notNull().default("queued"), // queued|running|done|failed|dead
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: tz("locked_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    finishedAt: tz("finished_at"),
  },
  (t) => [
    index("job_queue_due_idx").on(t.runAt).where(sql`${t.status} = 'queued'`),
  ],
);

export const schedulerState = pgTable("scheduler_state", {
  key: text("key").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
  data: jsonb("data"),
});

/** Shared to-do list (M22). */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    kind: text("kind").notNull(), // lead_retry|warranty_claim|restock|callback_customer|refund_due|follow_up|custom
    title: text("title").notNull(),
    body: text("body"),
    payload: jsonb("payload"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    customerId: uuid("customer_id"),
    jobId: uuid("job_id"),
    dueAt: tz("due_at"),
    status: text("status").notNull().default("open"), // open|done|dismissed
    doneAt: tz("done_at"),
    doneBy: uuid("done_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index("tasks_assignee_idx")
      .on(t.assigneeUserId, t.dueAt)
      .where(sql`${t.status} = 'open'`),
    index("tasks_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Idempotency for offline-replayed actions (pruned after 30 days). */
export const actionReceipts = pgTable("action_receipts", {
  clientId: uuid("client_id").primaryKey(),
  userId: uuid("user_id").notNull(),
  action: text("action").notNull(),
  result: jsonb("result").notNull(),
  createdAt: createdAt(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: tz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const exports = pgTable(
  "exports",
  {
    id: id(),
    kind: text("kind").notNull(), // full|csv|backup|nacha|report
    status: text("status").notNull().default("queued"),
    storageKey: text("storage_key"),
    requestedBy: uuid("requested_by").references(() => users.id),
    params: jsonb("params"),
    createdAt: createdAt(),
    completedAt: tz("completed_at"),
    expiresAt: tz("expires_at"),
  },
  (t) => [index("exports_kind_idx").on(t.kind, t.createdAt.desc())],
);

// ---- From §6.11 (cross-module) ----

/** Generic review queue (UI: /approvals). */
export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    entityType: text("entity_type").notNull(), // see APPROVAL_ENTITY_TYPES
    entityId: uuid("entity_id").notNull(),
    policy: text("policy").notNull(), // auto|auto_if_evidence|always_review
    status: text("status").notNull().default("pending"), // pending|approved|rejected
    requestedBy: uuid("requested_by").references(() => users.id),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    decidedAt: tz("decided_at"),
    reason: text("reason"),
    evidence: jsonb("evidence"), // extracted vs typed values
    createdAt: createdAt(),
  },
  (t) => [
    index("approvals_pending_idx")
      .on(t.entityType, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** AI queue + cache. */
export const aiTasks = pgTable(
  "ai_tasks",
  {
    id: id(),
    kind: text("kind").notNull(), // odometer|receipt|shop_invoice|tool_label|maintenance_suggest|explain_flags
    inputHash: text("input_hash").notNull(), // sha256(images+prompt version)
    mediaIds: uuidArray("media_ids"),
    status: text("status").notNull().default("queued"), // queued|running|done|failed|skipped_budget|skipped_policy
    model: text("model"),
    output: jsonb("output"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: tz("run_after").notNull().defaultNow(),
    createdAt: createdAt(),
    completedAt: tz("completed_at"),
  },
  (t) => [unique("ai_tasks_kind_input_uq").on(t.kind, t.inputHash)],
);

export const aiUsage = pgTable("ai_usage", {
  day: date("day", { mode: "string" }).primaryKey(),
  requests: integer("requests").notNull().default(0),
});
