// §6.12 Tools (module: tools; flag `tools`).
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import {
  createdAt,
  custom,
  day,
  id,
  money,
  softDelete,
  timestamps,
  tz,
  uuidArray,
} from "../columns";
import { users } from "./company";

export const tools = pgTable(
  "tools",
  {
    id: id(),
    name: text("name").notNull(),
    category: text("category"),
    brand: text("brand"),
    model: text("model"),
    serial: text("serial"),
    assetTag: text("asset_tag").unique(),
    purchaseDate: day("purchase_date"),
    purchaseCostCents: money("purchase_cost_cents"),
    replacementCostCents: money("replacement_cost_cents"),
    owner: text("owner").notNull().default("company"), // company|tech_owned
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    status: text("status").notNull().default("available"), // available|assigned|in_repair|lost|stolen|retired
    condition: text("condition").notNull().default("good"), // new|good|fair|poor
    calibrationDueOn: day("calibration_due_on"),
    maintenanceIntervalDays: integer("maintenance_interval_days"),
    maintenanceTask: text("maintenance_task"),
    lastMaintainedOn: day("last_maintained_on"),
    nextMaintenanceOn: day("next_maintenance_on"), // derived on log
    kitId: uuid("kit_id"),
    currentUserId: uuid("current_user_id").references(() => users.id),
    currentVehicleId: uuid("current_vehicle_id"),
    notes: text("notes"),
    custom: custom(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("tools_current_user_idx").on(t.currentUserId),
    index("tools_status_idx").on(t.status),
  ],
);

export const toolKits = pgTable("tool_kits", {
  id: id(),
  name: text("name").notNull(),
  vehicleId: uuid("vehicle_id"),
  userId: uuid("user_id"),
  ...timestamps(),
});

export const toolAssignments = pgTable(
  "tool_assignments",
  {
    id: id(),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id),
    userId: uuid("user_id").references(() => users.id),
    vehicleId: uuid("vehicle_id"),
    checkedOutAt: tz("checked_out_at").notNull().defaultNow(),
    checkedInAt: tz("checked_in_at"),
    outCondition: text("out_condition"),
    inCondition: text("in_condition"),
    outMediaId: uuid("out_media_id"),
    inMediaId: uuid("in_media_id"),
    acknowledgedAt: tz("acknowledged_at"),
    byUserId: uuid("by_user_id").references(() => users.id),
  },
  (t) => [
    index("tool_assign_tool_idx").on(
      t.toolId,
      t.checkedOutAt.desc().nullsFirst(),
    ),
  ],
);

export const toolAudits = pgTable(
  "tool_audits",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    dueOn: day("due_on").notNull(),
    status: text("status").notNull().default("scheduled"), // scheduled|in_progress|submitted|reviewed
    submittedAt: tz("submitted_at"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: tz("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("tool_audits_user_idx").on(t.userId, t.status)],
);

export const toolAuditItems = pgTable("tool_audit_items", {
  id: id(),
  auditId: uuid("audit_id")
    .notNull()
    .references(() => toolAudits.id, { onDelete: "cascade" }),
  toolId: uuid("tool_id")
    .notNull()
    .references(() => tools.id),
  present: boolean("present"),
  condition: text("condition"),
  mediaId: uuid("media_id"),
  note: text("note"),
});

export const toolIncidents = pgTable("tool_incidents", {
  id: id(),
  toolId: uuid("tool_id")
    .notNull()
    .references(() => tools.id),
  userId: uuid("user_id").references(() => users.id),
  kind: text("kind").notNull(), // lost|stolen|damaged
  description: text("description"),
  mediaIds: uuidArray("media_ids"),
  policeReportNo: text("police_report_no"),
  decision: text("decision"), // write_off|repair|tech_responsibility
  decidedBy: uuid("decided_by"),
  decidedAt: tz("decided_at"),
  deductionLedgerEntryId: uuid("deduction_ledger_entry_id"),
  createdAt: createdAt(),
});

export const toolMaintenanceLogs = pgTable(
  "tool_maintenance_logs",
  {
    id: id(),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id),
    task: text("task").notNull(),
    performedOn: day("performed_on").notNull(),
    performedByUserId: uuid("performed_by_user_id").references(() => users.id),
    vendor: text("vendor"),
    costCents: money("cost_cents"),
    paidBy: text("paid_by").notNull().default("company"), // company|tech
    partPurchaseId: uuid("part_purchase_id"),
    mediaId: uuid("media_id"),
    notes: text("notes"),
    clientId: uuid("client_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("tool_maint_tool_idx").on(
      t.toolId,
      t.performedOn.desc().nullsFirst(),
    ),
  ],
);
