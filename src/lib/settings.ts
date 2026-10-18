import "server-only";
import "@/db/seed/register";
import { eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db, type Tx } from "@/db";
import { company } from "@/db/schema";
import { type CompanySettings, settingsSchema } from "@/features/registry";
import { writeAudit } from "./audit";
import { NotFoundError } from "./errors";
import type { FeatureFlag, FeatureFlags } from "./flags";
import type { Actor, DeepPartial } from "./types";

// Company profile + settings (SPEC M21, §15.4; BUILD_PLAN §2). Settings live in
// company.settings (jsonb), validated by the zod schema merged from every module's
// settings.ts, with defaults merged on read. Per-request memoized with React cache().

export type { CompanySettings, SettingsNamespace } from "@/features/registry";
export type CompanyRow = typeof company.$inferSelect;

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return (
    !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
  );
}

/** Deep merge: objects merge recursively; arrays and scalars in `patch` replace. `undefined` is ignored. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || k === "__proto__" || k === "constructor") continue;
    out[k] =
      isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/**
 * Stored JSON → CompanySettings. Never throws: an invalid namespace keeps its valid
 * keys (offending top-level keys fall back to defaults) and logs a warning.
 */
export function parseSettings(raw: unknown): CompanySettings {
  const stored = isPlainObject(raw) ? raw : {};
  const full = settingsSchema.safeParse(stored);
  if (full.success) return full.data;
  const shape = settingsSchema.shape as Record<
    string,
    {
      safeParse(v: unknown): {
        success: boolean;
        data?: unknown;
        error?: { issues: { path: PropertyKey[] }[] };
      };
    }
  >;
  const out: Json = {};
  for (const [ns, schema] of Object.entries(shape)) {
    let value: unknown = stored[ns] ?? {};
    let res = schema.safeParse(value);
    if (!res.success && isPlainObject(value)) {
      const bad = new Set(
        (res.error?.issues ?? []).map((i) => String(i.path[0])),
      );
      value = Object.fromEntries(
        Object.entries(value).filter(([k]) => !bad.has(k)),
      );
      res = schema.safeParse(value);
      console.warn(
        `[settings] invalid keys in "${ns}" reset to defaults:`,
        [...bad].join(", "),
      );
    }
    out[ns] = res.success ? res.data : schema.safeParse({}).data;
  }
  return out as CompanySettings;
}

/** The company row or null before signup. Per-request memoized. */
export const findCompany = cache(async (): Promise<CompanyRow | null> => {
  const [row] = await db
    .select()
    .from(company)
    .where(eq(company.id, 1))
    .limit(1);
  return row ?? null;
});

/** The company row (throws NotFoundError before the first signup). */
export async function getCompany(): Promise<CompanyRow> {
  const row = await findCompany();
  if (!row) throw new NotFoundError("Company");
  return row;
}

export async function companyExists(): Promise<boolean> {
  return (await findCompany()) !== null;
}

/** Company time zone (falls back to the column default). */
export async function getCompanyTimezone(): Promise<string> {
  return (await findCompany())?.timezone ?? "America/New_York";
}

/** Merged, validated settings. Per-request memoized. Defaults when no company yet. */
export const getSettings = cache(async (): Promise<CompanySettings> => {
  const row = await findCompany();
  return parseSettings(row?.settings ?? {});
});

/** Is a module feature flag on? (SPEC §15.4) */
export async function isEnabled(flag: FeatureFlag): Promise<boolean> {
  const s = await getSettings();
  return (s.features as FeatureFlags)[flag] ?? false;
}

/** All flags (pass to the client via the root layout for FeatureGate). */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  return { ...((await getSettings()).features as FeatureFlags) };
}

/** Uncached read inside a transaction (row-locked), e.g. before a settings write. */
export async function readSettingsTx(tx: Tx): Promise<CompanySettings> {
  const rows = await tx
    .select({ settings: company.settings })
    .from(company)
    .where(eq(company.id, 1))
    .for("update");
  return parseSettings(rows[0]?.settings ?? {});
}

/**
 * Apply a deep-partial patch, validate the whole document, persist it and audit the
 * change (action 'settings.updated', before/after diff per namespace). Callers check
 * permissions (settings.manage / settings.features / page-specific perms).
 */
export async function updateSettings(
  tx: Tx,
  patch: DeepPartial<CompanySettings>,
  actor: Actor,
): Promise<CompanySettings> {
  const before = await readSettingsTx(tx);
  const merged = deepMerge(before, patch);
  const next = settingsSchema.parse(merged);
  const res = await tx
    .update(company)
    .set({
      settings: next as unknown as Json,
      settingsVersion: sql`${company.settingsVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(company.id, 1))
    .returning({ id: company.id });
  if (res.length === 0) throw new NotFoundError("Company");
  const changed = Object.keys(patch as Json);
  await writeAudit(tx, {
    actor,
    action: "settings.updated",
    entity: { type: "setting", id: "00000000-0000-0000-0000-000000000001" },
    before: Object.fromEntries(
      changed.map((k) => [k, (before as unknown as Json)[k]]),
    ),
    after: Object.fromEntries(
      changed.map((k) => [k, (next as unknown as Json)[k]]),
    ),
    full: true,
  });
  return next;
}
