// §6.7 Media (module: media).
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  real,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, textArray, tz } from "../columns";
import { users } from "./company";

export const media = pgTable(
  "media",
  {
    id: id(),
    kind: text("kind").notNull(), // photo|document|signature|receipt|avatar|logo|export|backup
    tag: text("tag"), // before|during|after|problem|receipt|odometer|document|tool|signature|id_check|other
    storageKey: text("storage_key").notNull(), // derived 1600px (or file itself for docs)
    thumbKey: text("thumb_key"),
    originalKey: text("original_key"),
    mime: text("mime").notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes"),
    sha256Original: text("sha256_original"),
    sha256Stored: text("sha256_stored"),
    caption: text("caption"),
    jobId: uuid("job_id"),
    customerId: uuid("customer_id"),
    entityType: text("entity_type"), // vehicle|tool|part_purchase|payment|odometer|…
    entityId: uuid("entity_id"),
    uploaderId: uuid("uploader_id").references(() => users.id),
    fileLastModified: tz("file_last_modified"), // File.lastModified
    clientCapturedAt: tz("client_captured_at"),
    serverReceivedAt: tz("server_received_at").notNull().defaultNow(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: real("accuracy_m"),
    flags: textArray("flags"), // possibly_from_library|no_geo|far_from_site
    includeInInvoice: boolean("include_in_invoice").notNull().default(false),
    evidenceLocked: boolean("evidence_locked").notNull().default(false),
    clientId: uuid("client_id").unique(),
    deletedAt: tz("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => users.id),
    deleteReason: text("delete_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("media_job_idx").on(t.jobId, t.createdAt),
    index("media_entity_idx").on(t.entityType, t.entityId),
  ],
);
