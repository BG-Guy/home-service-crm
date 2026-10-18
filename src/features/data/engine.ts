import "server-only";
import { eq, sql } from "drizzle-orm";
import { getStorage } from "@/adapters/storage";
import { db, execRows } from "@/db";
import { exports } from "@/db/schema";
import { domainTableNames } from "@/db/seed/helpers";
import { formatDateTime } from "@/lib/time";
import { toCsv } from "./csv";
import { createZip, type ZipEntry } from "./zip";

// Export + backup engine (SPEC M24). Full export: one zip with JSON per table
// (secrets, sessions and token hashes excluded), CSVs for the main entities and the
// media manifest + files. Nightly backup: JSON per table under backups/YYYY-MM-DD/.

/** Never exported (sessions, one-time tokens, throttling, queues). */
export const EXPORT_SKIP_TABLES = new Set([
  "sessions",
  "password_resets",
  "login_attempts",
  "rate_limits",
  "action_receipts",
  "job_queue",
  "scheduler_state",
  "push_subscriptions",
  "secrets",
]);

/**
 * Columns blanked in a customer-facing export (hashes and encrypted values). On top of
 * this list, any column or nested JSON key ending in `_enc` (e.g. the company's
 * `settings.payroll.nacha.company_account_enc`) is redacted too (T3-20).
 */
export const EXPORT_REDACT: Record<string, readonly string[]> = {
  users: ["password_hash", "bank_routing_enc", "bank_account_enc"],
  invites: ["token_hash"],
  api_keys: ["key_hash"],
  lead_sources: ["secret_hash", "hook_secret_hash", "google_key_hash"],
  public_tokens: ["token_hash"],
  properties: ["gate_code_enc"],
};

/** Backups keep what a restore needs (hashes and encrypted values stay encrypted). */
export const BACKUP_SKIP_TABLES = new Set([
  "sessions",
  "login_attempts",
  "rate_limits",
  "action_receipts",
  "job_queue",
  "scheduler_state",
]);

const MAIN_CSVS: Record<string, string> = {
  customers: `select c.id, c.type, c.display_name, c.first_name, c.last_name, c.company_name,
      c.phone, c.phone_alt, c.email, c.preferred_channel, c.sms_status, c.vip, c.do_not_service,
      c.prepay_required, c.tax_exempt, c.do_not_text, c.source, c.notes, c.created_at
    from customers c where c.deleted_at is null and c.merged_into_id is null order by c.created_at`,
  properties: `select p.id, p.customer_id, p.label, p.street, p.unit, p.city, p.state, p.zip,
      p.lat, p.lng, p.access_notes, p.pets, p.site_contact_name, p.site_contact_phone, p.created_at
    from properties p where p.deleted_at is null order by p.created_at`,
  jobs: `select j.id, j.number, j.status, j.payment_status, j.customer_id, j.property_id, j.title,
      j.scheduled_start, j.scheduled_end, j.completed_at, j.created_at from jobs j order by j.created_at`,
  invoices: `select i.id, i.number, i.status, i.customer_id, i.job_id, i.total_cents, i.issued_at,
      i.due_at, i.created_at from invoices i order by i.created_at`,
  payments: `select p.id, p.invoice_id, p.job_id, p.customer_id, p.method, p.status, p.amount_cents,
      p.tip_cents, p.created_at from payments p order by p.created_at`,
  leads: `select l.id, l.status, l.name, l.phone, l.email, l.service_text, l.quoted_price_cents,
      s.name as source, l.lost_reason, l.created_at, l.first_response_at
    from leads l left join lead_sources s on s.id = l.lead_source_id order by l.created_at`,
};

const MEDIA_BYTES_CAP = 400 * 1024 * 1024;

async function tableRows(name: string): Promise<Record<string, unknown>[]> {
  return execRows<Record<string, unknown>>(
    sql.raw(`select * from "${name.replace(/"/g, "")}"`),
  );
}

const SECRET_KEY = /_enc$/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Deep-redact `*_enc` keys inside JSON values (settings, params). */
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v))
    out[k] = SECRET_KEY.test(k) && x != null ? "[redacted]" : scrub(x);
  return out;
}

export function redact(name: string, rows: Record<string, unknown>[]) {
  const cols = new Set(EXPORT_REDACT[name] ?? []);
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r))
      o[k] =
        (cols.has(k) || SECRET_KEY.test(k)) && v != null
          ? "[redacted]"
          : scrub(v);
    return o;
  });
}

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x), 2);

/** Build the full-export zip in memory (one business's data fits comfortably). */
export async function buildFullExport(opts: {
  includeMedia?: boolean;
  log?: (m: string) => void;
}): Promise<{
  zip: Uint8Array;
  tables: number;
  rows: number;
  mediaFiles: number;
}> {
  const entries: ZipEntry[] = [];
  let rows = 0;
  const names = domainTableNames()
    .filter((n) => !EXPORT_SKIP_TABLES.has(n))
    .sort();
  for (const n of names) {
    const r = redact(n, await tableRows(n).catch(() => []));
    rows += r.length;
    entries.push({ name: `tables/${n}.json`, data: json(r) });
  }
  for (const [name, q] of Object.entries(MAIN_CSVS)) {
    const r = await execRows<Record<string, unknown>>(sql.raw(q)).catch(
      () => [],
    );
    entries.push({ name: `csv/${name}.csv`, data: toCsv(r) });
  }
  // Media manifest + files (originals when kept, else the full-size variant).
  const media = await execRows<{
    id: string;
    kind: string;
    tag: string | null;
    storage_key: string | null;
    mime: string | null;
    job_id: string | null;
    customer_id: string | null;
    created_at: string;
  }>(
    sql`select id, kind, tag, storage_key, mime, job_id, customer_id, created_at
        from media where deleted_at is null order by created_at`,
  ).catch(() => []);
  let mediaBytes = 0;
  let mediaFiles = 0;
  const manifest: Record<string, unknown>[] = [];
  const storage = getStorage();
  for (const m of media) {
    let file: string | null = null;
    if (
      opts.includeMedia !== false &&
      m.storage_key &&
      mediaBytes < MEDIA_BYTES_CAP
    ) {
      try {
        const bytes = await storage.get(m.storage_key);
        mediaBytes += bytes.length;
        file = `media/${m.storage_key.split("/").pop() ?? m.id}`;
        entries.push({ name: file, data: bytes });
        mediaFiles++;
      } catch {
        file = null;
      }
    }
    manifest.push({ ...m, file });
  }
  entries.push({ name: "media/manifest.json", data: json(manifest) });
  const { getCompanyTimezone } = await import("@/lib/settings");
  const tz = await getCompanyTimezone().catch(() => "UTC");
  const now = new Date();
  entries.push({
    name: "README.txt",
    data: [
      "CRM data export",
      `Created: ${formatDateTime(now, tz)} (${tz}) · ${now.toISOString()}`,
      "",
      "tables/*.json  every table as JSON (passwords, keys, token hashes and gate codes redacted)",
      "csv/*.csv      spreadsheets of the main records",
      "media/         photos and documents, plus manifest.json linking them to jobs and customers",
      mediaBytes >= MEDIA_BYTES_CAP
        ? "NOTE: media over 400 MB was listed in the manifest but not included."
        : "",
    ].join("\n"),
  });
  opts.log?.(`${names.length} tables, ${rows} rows, ${mediaFiles} media files`);
  return { zip: createZip(entries), tables: names.length, rows, mediaFiles };
}

/** Worker: build the export for an `exports` row, store it, set the 24 h link expiry. */
export async function runExportJob(exportId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(exports)
    .where(eq(exports.id, exportId))
    .limit(1);
  if (!row || row.status === "ready") return;
  await db
    .update(exports)
    .set({ status: "running" })
    .where(eq(exports.id, exportId));
  try {
    const { zip, tables, rows, mediaFiles } = await buildFullExport({});
    const key = `exports/${exportId}.zip`;
    await getStorage().put(key, zip, "application/zip");
    const { getSettings } = await import("@/lib/settings");
    const hours = (await getSettings()).data.export_link_hours;
    await db
      .update(exports)
      .set({
        status: "ready",
        storageKey: key,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + hours * 3600_000),
        params: {
          ...((row.params as Record<string, unknown>) ?? {}),
          bytes: zip.length,
          tables,
          rows,
          media_files: mediaFiles,
        },
      })
      .where(eq(exports.id, exportId));
  } catch (err) {
    await db
      .update(exports)
      .set({ status: "failed", params: { error: String(err).slice(0, 300) } })
      .where(eq(exports.id, exportId));
    throw err;
  }
}

/** Nightly JSON backup of every table under backups/YYYY-MM-DD/ (+ manifest). */
export async function runBackup(
  date: string,
): Promise<{ tables: number; rows: number }> {
  const storage = getStorage();
  const prefix = `backups/${date}`;
  const names = domainTableNames()
    .filter((n) => !BACKUP_SKIP_TABLES.has(n))
    .sort();
  let rows = 0;
  const files: string[] = [];
  for (const n of names) {
    const r = await tableRows(n).catch(() => null);
    if (!r) continue;
    rows += r.length;
    const key = `${prefix}/${n}.json`;
    await storage.put(
      key,
      new TextEncoder().encode(json(r)),
      "application/json",
    );
    files.push(key);
  }
  const migrations = await execRows<{ hash: string; created_at: string }>(
    sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`,
  ).catch(() => []);
  await storage.put(
    `${prefix}/manifest.json`,
    new TextEncoder().encode(
      json({
        created_at: new Date().toISOString(),
        date,
        tables: names,
        rows,
        migrations,
      }),
    ),
    "application/json",
  );
  files.push(`${prefix}/manifest.json`);
  const weekly = new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
  await db.insert(exports).values({
    kind: "backup",
    status: "ready",
    storageKey: `${prefix}/manifest.json`,
    params: { date, files, rows, tables: names.length, weekly },
    completedAt: new Date(),
  });
  await pruneBackups();
  return { tables: names.length, rows };
}

/** Keep the newest 14 daily + 8 weekly (Sunday) backups; delete the rest's files. */
export async function pruneBackups(): Promise<number> {
  const { getSettings } = await import("@/lib/settings");
  const s = (await getSettings()).data;
  const rows = await db
    .select()
    .from(exports)
    .where(sql`${exports.kind} = 'backup' and ${exports.status} = 'ready'`)
    .orderBy(sql`${exports.createdAt} desc`);
  const keep = new Set<string>();
  let daily = 0;
  let weekly = 0;
  for (const r of rows) {
    const p = (r.params ?? {}) as { weekly?: boolean };
    if (daily < s.backup_keep_daily) {
      keep.add(r.id);
      daily++;
    }
    if (p.weekly && weekly < s.backup_keep_weekly) {
      keep.add(r.id);
      weekly++;
    }
  }
  const storage = getStorage();
  let removed = 0;
  for (const r of rows) {
    if (keep.has(r.id)) continue;
    const files = ((r.params ?? {}) as { files?: string[] }).files ?? [];
    for (const f of files) await storage.delete(f).catch(() => undefined);
    await db
      .update(exports)
      .set({ status: "expired" })
      .where(eq(exports.id, r.id));
    removed++;
  }
  return removed;
}

/** Expire export downloads past their link lifetime (and delete the zip). */
export async function pruneExports(now = new Date()): Promise<number> {
  const rows = await db
    .select()
    .from(exports)
    .where(
      sql`${exports.kind} <> 'backup' and ${exports.status} = 'ready' and ${exports.expiresAt} < ${now}`,
    );
  const storage = getStorage();
  for (const r of rows) {
    if (r.storageKey) await storage.delete(r.storageKey).catch(() => undefined);
    await db
      .update(exports)
      .set({ status: "expired" })
      .where(eq(exports.id, r.id));
  }
  return rows.length;
}
