// §6.4 Jobs, scheduling, notes (modules: jobs, tech).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { bps, custom, id, softDelete, timestamps, tz } from "../columns";
import { policyVersions, serviceTypes, users } from "./company";
import { customers, leads, properties } from "./customers";

export interface JobChecklistItem {
  id: string;
  label: string;
  type: "check" | "text" | "number" | "photo" | "signature" | "select";
  required?: boolean;
  options?: string[];
  answer?: unknown;
  answered_at?: string;
  answered_by?: string;
}

export interface JobRecurrence {
  every: "weeks" | "months";
  n: number;
  until?: string;
}

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    number: text("number").notNull().unique(), // 'J-1042' via counters
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    serviceTypeId: uuid("service_type_id").references(() => serviceTypes.id),
    leadId: uuid("lead_id").references(() => leads.id),
    estimateId: uuid("estimate_id"), // approved estimate (if any)
    title: text("title").notNull(),
    description: text("description"),
    customerNotes: text("customer_notes"),
    priority: text("priority").notNull().default("normal"), // normal|urgent|emergency
    afterHours: boolean("after_hours").notNull().default(false),
    status: text("status").notNull().default("unscheduled"), // see JOB_STATUSES
    paymentStatus: text("payment_status").notNull().default("none"), // cache of ledger
    scheduledStart: tz("scheduled_start"),
    scheduledEnd: tz("scheduled_end"),
    windowStart: tz("window_start"),
    windowEnd: tz("window_end"),
    confirmedAt: tz("confirmed_at"),
    enRouteAt: tz("en_route_at"),
    etaAt: tz("eta_at"),
    arrivedAt: tz("arrived_at"),
    startedAt: tz("started_at"),
    completedAt: tz("completed_at"),
    closedAt: tz("closed_at"),
    cancelledAt: tz("cancelled_at"),
    cancelReason: text("cancel_reason"), // see JOB_CANCEL_REASONS
    cancelNote: text("cancel_note"),
    cancelReviewStatus: text("cancel_review_status"), // null|pending|ok|flagged
    isCallback: boolean("is_callback").notNull().default(false),
    callbackOfJobId: uuid("callback_of_job_id").references(
      (): AnyPgColumn => jobs.id,
    ),
    callbackReason: text("callback_reason"), // workmanship|part|customer|other
    warrantyExpiresAt: tz("warranty_expires_at"),
    recurrence: jsonb("recurrence").$type<JobRecurrence>(),
    visitCount: integer("visit_count").notNull().default(1),
    customRateBps: bps("custom_rate_bps"), // per-job commission override
    checklist: jsonb("checklist")
      .$type<JobChecklistItem[]>()
      .notNull()
      .default([]),
    custom: custom(),
    riskScore: integer("risk_score"),
    riskBand: text("risk_band"), // low|medium|high|critical
    readinessScore: integer("readiness_score"),
    cancellationPolicyVersionId: uuid(
      "cancellation_policy_version_id",
    ).references(() => policyVersions.id),
    serviceFeeDisclosure: text("service_fee_disclosure"),
    settlementLockedAt: tz("settlement_locked_at"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index("jobs_sched_idx")
      .on(t.scheduledStart)
      .where(sql`${t.status} not in ('cancelled','closed')`),
    index("jobs_status_idx").on(t.status, t.scheduledStart),
    index("jobs_customer_idx").on(
      t.customerId,
      t.createdAt.desc().nullsFirst(),
    ),
    index("jobs_completed_idx").on(t.completedAt),
    index("jobs_callback_idx").on(t.callbackOfJobId),
  ],
);

export const jobAssignments = pgTable(
  "job_assignments",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("primary"), // primary|helper
    splitBps: bps("split_bps").notNull().default(10000),
    assignedBy: uuid("assigned_by").references(() => users.id),
    assignedAt: tz("assigned_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.userId] }),
    index("job_assignments_user_idx").on(t.userId),
  ],
);

/** Append-only (trigger). */
export const jobStatusEvents = pgTable(
  "job_status_events",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    at: tz("at").notNull().defaultNow(),
    clientTs: tz("client_ts"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: real("accuracy_m"),
    distanceM: real("distance_m"), // to property lat/lng
    etaMinutes: integer("eta_minutes"),
    note: text("note"),
    clientId: uuid("client_id").unique(), // offline idempotency
  },
  (t) => [index("job_status_events_job_idx").on(t.jobId, t.at)],
);

export const notes = pgTable(
  "notes",
  {
    id: id(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    customerId: uuid("customer_id"),
    jobId: uuid("job_id"),
    body: text("body").notNull(),
    visibility: text("visibility").notNull().default("internal"), // internal|customer
    pinned: boolean("pinned").notNull().default(false),
    authorId: uuid("author_id").references(() => users.id),
    clientId: uuid("client_id").unique(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [index("notes_entity_idx").on(t.entityType, t.entityId)],
);
