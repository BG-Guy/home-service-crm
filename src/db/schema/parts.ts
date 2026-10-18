// §6.9 Parts & inventory (module: parts).
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, day, id, money, qty, timestamps, tz } from "../columns";
import { pricebookItems, users } from "./company";
import { jobs } from "./jobs";

export const partPurchases = pgTable(
  "part_purchases",
  {
    id: id(),
    paidBy: text("paid_by").notNull(), // company|tech
    instrument: text("instrument"), // personal|company_card|company_account|po
    purchaserUserId: uuid("purchaser_user_id").references(() => users.id),
    category: text("category").notNull().default("part"), // part|fuel|vehicle|tool|supplies|other
    jobId: uuid("job_id").references(() => jobs.id),
    vehicleId: uuid("vehicle_id"),
    toolId: uuid("tool_id"),
    vendor: text("vendor"),
    purchasedOn: day("purchased_on"),
    subtotalCents: money("subtotal_cents"),
    taxCents: money("tax_cents"),
    totalCents: money("total_cents").notNull(),
    receiptMediaId: uuid("receipt_media_id"),
    aiExtract: jsonb("ai_extract"),
    aiStatus: text("ai_status"), // null|queued|done|failed|skipped
    status: text("status").notNull().default("pending"), // pending|approved|rejected
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: tz("decided_at"),
    rejectReason: text("reject_reason"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    ledgerEntryId: uuid("ledger_entry_id"), // reimbursement line
    notes: text("notes"),
    clientId: uuid("client_id").unique(),
    ...timestamps(),
  },
  (t) => [
    index("part_purchases_status_idx").on(t.status, t.createdAt),
    index("part_purchases_job_idx").on(t.jobId),
    index("part_purchases_purchaser_idx").on(t.purchaserUserId, t.status),
  ],
);

export const stockLocations = pgTable("stock_locations", {
  id: id(),
  kind: text("kind").notNull(), // warehouse|vehicle
  name: text("name").notNull(),
  vehicleId: uuid("vehicle_id"),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});

export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    locationId: uuid("location_id")
      .notNull()
      .references(() => stockLocations.id),
    pricebookItemId: uuid("pricebook_item_id")
      .notNull()
      .references(() => pricebookItems.id),
    onHand: qty("on_hand").notNull().default(0),
    minQty: qty("min_qty"),
    maxQty: qty("max_qty"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.locationId, t.pricebookItemId] })],
);

export const stockMoves = pgTable(
  "stock_moves",
  {
    id: id(),
    pricebookItemId: uuid("pricebook_item_id")
      .notNull()
      .references(() => pricebookItems.id),
    fromLocationId: uuid("from_location_id").references(
      () => stockLocations.id,
    ),
    toLocationId: uuid("to_location_id").references(() => stockLocations.id),
    qty: qty("qty").notNull(),
    unitCostCents: money("unit_cost_cents"),
    kind: text("kind").notNull(), // receive|transfer|use_on_job|adjust|return|count
    jobId: uuid("job_id"),
    lineItemId: uuid("line_item_id"),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_moves_from_idx").on(t.fromLocationId),
    index("stock_moves_to_idx").on(t.toLocationId),
    index("stock_moves_line_idx").on(t.lineItemId),
  ],
);
