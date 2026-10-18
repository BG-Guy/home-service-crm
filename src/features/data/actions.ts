"use server";

import { z } from "zod";
import { exports } from "@/db/schema";
import { action } from "@/lib/action";
import { requireUser } from "@/lib/auth/current";
import { isProd } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { enqueueJob } from "@/lib/queue";
import { parseCsvObjects } from "./csv";
import {
  guessMapping,
  IMPORT_FIELDS,
  type ImportKind,
  type ImportMapping,
  importCustomers,
  importJobs,
  importPricebook,
  MAX_IMPORT_ROWS,
  planCustomerImport,
  planJobImport,
  planPricebookImport,
} from "./import";

// Data actions (SPEC M24): export everything, CSV import (dry run → import), demo reset.

const MAX_CSV_CHARS = 1_900_000; // server actions accept 2 MB bodies

/** Queue a full export (zip). The worker stores it and the link lives 24 h. */
export const requestExport = action({
  name: "data.export_request",
  perm: "data.export",
  input: z.object({}),
  audit: "data.export_requested",
  async run({ tx, user }) {
    const [row] = await tx
      .insert(exports)
      .values({
        kind: "full",
        status: "queued",
        requestedBy: user.id,
        params: {},
      })
      .returning({ id: exports.id });
    if (!row) throw new Error("insert failed");
    await enqueueJob(
      tx,
      "export",
      { exportId: row.id },
      { dedupeKey: `export:${row.id}`, maxAttempts: 3 },
    );
    return { exportId: row.id };
  },
  revalidate: () => ["/settings/data"],
});

const KIND = z.enum(["customers", "pricebook", "jobs"]);

export interface ImportPreview {
  headers: string[];
  mapping: ImportMapping;
  fields: { key: string; label: string; required?: boolean }[];
  total: number;
  validCount: number;
  duplicates: number;
  errors: { row: number; error: string }[];
  sample: Record<string, string>[];
}

async function plan(
  kind: ImportKind,
  rows: Record<string, string>[],
  m: ImportMapping,
) {
  if (kind === "customers") return planCustomerImport(rows, m);
  if (kind === "pricebook") return planPricebookImport(rows, m);
  return planJobImport(rows, m);
}

function checkSize(csv: string) {
  if (csv.length > MAX_CSV_CHARS)
    throw new ValidationError({
      csv: ["That file is over 2 MB. Split it into smaller files."],
    });
}

/** Dry run: parse, auto-map (or use the given mapping), validate and count duplicates. */
export async function previewImport(input: {
  kind: ImportKind;
  csv: string;
  mapping?: ImportMapping;
}): Promise<{ ok: true; data: ImportPreview } | { ok: false; error: string }> {
  await requireUser("data.import");
  const kind = KIND.safeParse(input.kind);
  if (!kind.success) return { ok: false, error: "Pick what you're importing." };
  try {
    checkSize(input.csv);
  } catch {
    return {
      ok: false,
      error: "That file is over 2 MB. Split it into smaller files.",
    };
  }
  const { headers, rows } = parseCsvObjects(input.csv);
  if (headers.length === 0 || rows.length === 0)
    return {
      ok: false,
      error: "The file has no rows (the first row must be column names).",
    };
  const mapping = input.mapping ?? guessMapping(headers, kind.data);
  const p = await plan(kind.data, rows, mapping);
  return {
    ok: true,
    data: {
      headers,
      mapping,
      fields: IMPORT_FIELDS[kind.data].map(({ key, label, required }) => ({
        key,
        label,
        required,
      })),
      total: p.total,
      validCount: p.valid.length,
      duplicates: p.duplicates,
      errors: p.errors.slice(0, 50),
      sample: p.sample,
    },
  };
}

export const runImport = action({
  name: "data.import",
  perm: "data.import",
  input: z.object({
    kind: KIND,
    csv: z.string().min(1).max(MAX_CSV_CHARS),
    mapping: z.record(z.string(), z.string().nullable()),
  }),
  audit: "data.imported",
  async run({ input, tx, actor, audit }) {
    const { rows } = parseCsvObjects(input.csv);
    const p = await plan(
      input.kind,
      rows.slice(0, MAX_IMPORT_ROWS),
      input.mapping,
    );
    let result: Record<string, number>;
    if (input.kind === "customers")
      result = await importCustomers(tx, p.valid as never, actor);
    else if (input.kind === "pricebook")
      result = await importPricebook(tx, p.valid as never, actor);
    else {
      const r = await importJobs(tx, p.valid as never, actor);
      result = { created: r.created, skipped: r.skipped };
    }
    await audit({
      after: {
        kind: input.kind,
        rows: rows.length,
        valid: p.valid.length,
        errors: p.errors.length,
        ...result,
      },
    });
    return { ...result, errors: p.errors.length, total: rows.length };
  },
  revalidate: ({ input }) => [
    "/settings/data",
    input.kind === "pricebook" ? "/settings/pricebook" : "/customers",
  ],
});

/** Demo reset is allowed only outside production, or with DEMO_MODE=1. */
export async function demoResetAllowed(): Promise<boolean> {
  return !isProd || process.env.DEMO_MODE === "1";
}

/**
 * Danger zone: wipe every table and reseed the demo (BUILD_PLAN §11.2: uses F's
 * truncate helper via the demo runner). Not wrapped in action(): the reseed runs many
 * transactions of its own and truncates the audit log it would write to.
 */
export async function resetDemoData(input: {
  phrase: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser(["data.export", "data.import"]);
  if (user.baseRole !== "admin") return { ok: false, error: "Admins only." };
  if (!(await demoResetAllowed()))
    return { ok: false, error: "Demo reset is disabled in production." };
  if (input.phrase.trim().toUpperCase() !== "RESET")
    return { ok: false, error: "Type RESET to confirm." };
  const { runDemoSeed } = await import("@/db/seed/demo");
  await runDemoSeed({ reset: true });
  return { ok: true };
}
