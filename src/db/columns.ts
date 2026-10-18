// Shared column helpers for Drizzle schema files (docs/SPEC.md §6.1).
// NOTE: schema files are also loaded by drizzle-kit (esbuild), so this file and
// everything under src/db/schema/ must use RELATIVE imports only and must not
// import 'server-only'.
import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** `id uuid primary key default gen_random_uuid()` */
export const id = () => uuid("id").primaryKey().defaultRandom();

/** `id bigint generated always as identity primary key` (high-volume append-only logs) */
export const identityId = () =>
  bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

/** timestamptz (UTC), JS Date */
export const tz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** `created_at timestamptz not null default now()` */
export const createdAt = () => tz("created_at").notNull().defaultNow();

/** `updated_at timestamptz not null default now()` — set in the DAL on update, no triggers. */
export const updatedAt = () => tz("updated_at").notNull().defaultNow();

/** `…ts` in the spec: created_at + updated_at */
export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** `deleted_at timestamptz null` (DAL filters `deleted_at is null` by default) */
export const softDelete = () => ({ deletedAt: tz("deleted_at") });

/** Integer cents stored as bigint, surfaced as JS number. */
export const money = (name: string) => bigint(name, { mode: "number" });

/** Basis points (2500 = 25.00%). */
export const bps = (name: string) => integer(name);

/** Quantities: numeric(12,3), surfaced as JS number. */
export const qty = (name: string) =>
  numeric(name, { precision: 12, scale: 3, mode: "number" });

/** Calendar date (no time zone) as 'YYYY-MM-DD' string. */
export const day = (name: string) => date(name, { mode: "string" });

/** `custom jsonb not null default '{}'` keyed by custom_field_defs.key */
export const custom = () =>
  jsonb("custom").$type<Record<string, unknown>>().notNull().default({});

/** text[] not null default '{}' */
export const textArray = (name: string) =>
  text(name).array().notNull().default(sql`'{}'::text[]`);

/** uuid[] not null default '{}' */
export const uuidArray = (name: string) =>
  uuid(name).array().notNull().default(sql`'{}'::uuid[]`);

/** Postal address JSON shape used by company/users/leads. */
export interface AddressJson {
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
}
