// §6.11 Vehicles (module: vehicles).
// approvals / ai_tasks / ai_usage (also listed in §6.11) are cross-module and live in ./system.ts.
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  createdAt,
  custom,
  day,
  id,
  money,
  softDelete,
  textArray,
  timestamps,
  tz,
  uuidArray,
} from "../columns";
import { users } from "./company";

export const vehicles = pgTable("vehicles", {
  id: id(),
  nickname: text("nickname").notNull(),
  vin: text("vin"),
  year: integer("year"),
  make: text("make"),
  model: text("model"),
  trim: text("trim"),
  engine: text("engine"),
  fuelType: text("fuel_type"),
  gvwrLbs: integer("gvwr_lbs"),
  usdotNumber: text("usdot_number"),
  plate: text("plate"),
  plateState: char("plate_state", { length: 2 }),
  ownership: text("ownership").notNull().default("company_owned"), // company_owned|leased|tech_owned
  assignedUserId: uuid("assigned_user_id").references(() => users.id),
  tankGal: numeric("tank_gal", { precision: 6, scale: 2, mode: "number" }),
  status: text("status").notNull().default("active"), // active|in_shop|retired
  decoded: jsonb("decoded"), // vPIC response subset
  odometerCached: integer("odometer_cached"),
  avgDailyMiles: numeric("avg_daily_miles", {
    precision: 8,
    scale: 2,
    mode: "number",
  }),
  openRecalls: jsonb("open_recalls").$type<unknown[]>().notNull().default([]),
  custom: custom(),
  ...timestamps(),
  ...softDelete(),
});

export const odometerReadings = pgTable(
  "odometer_readings",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    value: integer("value").notNull(),
    unit: text("unit").notNull().default("mi"),
    source: text("source").notNull(), // manual|photo|service|fuel|clock
    photoMediaId: uuid("photo_media_id"),
    aiValue: integer("ai_value"),
    aiConfidence: real("ai_confidence"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    recordedAt: tz("recorded_at").notNull(),
    approvalStatus: text("approval_status").notNull().default("pending"), // pending|approved|rejected
    flags: textArray("flags"),
    clientId: uuid("client_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("odometer_vehicle_idx").on(
      t.vehicleId,
      t.recordedAt.desc().nullsFirst(),
    ),
  ],
);

export const fuelLogs = pgTable(
  "fuel_logs",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    userId: uuid("user_id").references(() => users.id),
    gallons: numeric("gallons", {
      precision: 8,
      scale: 3,
      mode: "number",
    }).notNull(),
    totalCents: money("total_cents").notNull(),
    odometerReadingId: uuid("odometer_reading_id"),
    receiptMediaId: uuid("receipt_media_id"),
    partPurchaseId: uuid("part_purchase_id"),
    filledAt: tz("filled_at").notNull(),
    approvalStatus: text("approval_status").notNull().default("pending"),
    flags: textArray("flags"),
    clientId: uuid("client_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("fuel_logs_vehicle_idx").on(t.vehicleId, t.filledAt.desc())],
);

export const serviceRecords = pgTable("service_records", {
  id: id(),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehicles.id),
  tasks: text("tasks").array().notNull(), // oil_change|tire_rotation|brakes|inspection|custom:<x>
  performedOn: day("performed_on").notNull(),
  odometer: integer("odometer"),
  odometerReadingId: uuid("odometer_reading_id"), // the reading logged with this record
  vendor: text("vendor"),
  costCents: money("cost_cents"),
  paidBy: text("paid_by").notNull().default("company"), // company|tech
  receiptMediaId: uuid("receipt_media_id"),
  partPurchaseId: uuid("part_purchase_id"),
  aiExtract: jsonb("ai_extract"),
  notes: text("notes"),
  approvalStatus: text("approval_status").notNull().default("pending"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const vehicleReminderRules = pgTable(
  "vehicle_reminder_rules",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    task: text("task").notNull(), // matches service_records.tasks / document kinds
    intervalMiles: integer("interval_miles"),
    intervalDays: integer("interval_days"),
    dueSoonMiles: integer("due_soon_miles"),
    dueSoonDays: integer("due_soon_days"),
    lastDoneOn: day("last_done_on"),
    lastDoneOdometer: integer("last_done_odometer"),
    nextDueOn: day("next_due_on"), // forecast
    nextDueMiles: integer("next_due_miles"),
    status: text("status").notNull().default("ok"), // ok|due_soon|overdue
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique("vehicle_reminder_rules_vehicle_task_uq").on(t.vehicleId, t.task),
  ],
);

export const vehicleDocuments = pgTable("vehicle_documents", {
  id: id(),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehicles.id),
  kind: text("kind").notNull(), // registration|insurance|inspection|lease|title|other
  mediaId: uuid("media_id").notNull(),
  expiresOn: day("expires_on"),
  approvalStatus: text("approval_status").notNull().default("pending"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const inspections = pgTable("inspections", {
  id: id(),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehicles.id),
  userId: uuid("user_id").references(() => users.id),
  results: jsonb("results").notNull(),
  passed: boolean("passed").notNull(),
  mediaIds: uuidArray("media_ids"),
  approvalStatus: text("approval_status").notNull().default("pending"), // policies.inspection (seed: auto)
  clientId: uuid("client_id").unique(),
  createdAt: createdAt(),
});

export const vehicleIssues = pgTable(
  "vehicle_issues",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    reportedBy: uuid("reported_by").references(() => users.id),
    description: text("description").notNull(),
    severity: text("severity").notNull(), // low|medium|high|unsafe
    canDrive: boolean("can_drive").notNull(),
    mediaIds: uuidArray("media_ids"),
    status: text("status").notNull().default("open"), // open|acknowledged|in_repair|resolved
    acknowledgedAt: tz("acknowledged_at"),
    acknowledgedBy: uuid("acknowledged_by"),
    resolvedAt: tz("resolved_at"),
    resolution: text("resolution"),
    createdAt: createdAt(),
  },
  (t) => [index("vehicle_issues_vehicle_idx").on(t.vehicleId, t.status)],
);

/** IRS-style daily mileage log. */
export const trips = pgTable(
  "trips",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    tripDate: day("trip_date").notNull(),
    startOdometer: integer("start_odometer"),
    endOdometer: integer("end_odometer"),
    miles: numeric("miles", {
      precision: 8,
      scale: 1,
      mode: "number",
    }).notNull(),
    destinations: jsonb("destinations")
      .$type<{ job_id?: string; address_short?: string }[]>()
      .notNull()
      .default([]),
    purpose: text("purpose"),
    classification: text("classification").notNull().default("business"), // business|commute|personal
    reimbursable: boolean("reimbursable").notNull().default(false),
    ledgerEntryId: uuid("ledger_entry_id"),
    approvalStatus: text("approval_status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("trips_user_date_vehicle_uq").on(t.userId, t.tripDate, t.vehicleId),
    index("trips_vehicle_idx").on(t.vehicleId, t.tripDate.desc()),
  ],
);
