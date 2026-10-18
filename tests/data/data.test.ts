// B1 data module: zip writer round-trip, CSV, import planner + import, export zip,
// nightly backup → restore round-trip on a throwaway PGlite.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b1-data-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";
process.env.GEOCODER = "none";

const auth = vi.hoisted(() => ({
  user: null as null | import("@/lib/types").SessionUser,
}));
vi.mock("@/lib/auth/current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current")>();
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: async () => {
      if (!auth.user) throw new Error("NEXT_REDIRECT /login");
      return auth.user;
    },
  };
});

import { sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import "@/db/seed/register";
import { getStorage } from "@/adapters/storage";
import { previewImport, runImport } from "@/features/data/actions";
import { parseCsv, parseCsvObjects, toCsv } from "@/features/data/csv";
import { buildFullExport, redact, runBackup } from "@/features/data/engine";
import { guessMapping } from "@/features/data/import-fields";
import { restoreBackup } from "@/features/data/restore";
import { crc32, createZip, readZip } from "@/features/data/zip";
import { loadSessionUser } from "@/lib/auth/current";
import { signup } from "@/lib/auth/flows";
import type { SessionUser } from "@/lib/types";

const count = async (t: string) =>
  Number(
    (
      await execRows<{ n: number }>(
        sql.raw(`select count(*)::int as n from "${t}"`),
      )
    )[0]?.n ?? 0,
  );

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Data Co",
    name: "Dee Admin",
    email: "dee@example.com",
    password: "tangerine-kayak-41",
    timezone: "America/Chicago",
  });
  auth.user = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("zip writer", () => {
  it("crc32 matches the reference value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips through our reader", () => {
    const bin = new Uint8Array([0, 1, 2, 255, 128]);
    const zip = createZip([
      { name: "a.txt", data: "hello ✓" },
      { name: "dir/b.bin", data: bin },
      { name: "a.txt", data: "duplicate ignored" },
    ]);
    const files = readZip(zip);
    expect(files.size).toBe(2);
    expect(new TextDecoder().decode(files.get("a.txt"))).toBe("hello ✓");
    expect([...(files.get("dir/b.bin") ?? [])]).toEqual([...bin]);
  });

  it("is a valid zip for standard tools (local header signature + EOCD)", () => {
    const zip = createZip([{ name: "x.json", data: "{}" }]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    // Not gzip: make sure nothing accidentally compressed it.
    expect(() => unzipSync(Buffer.from(zip))).toThrow();
  });
});

describe("csv", () => {
  it("parses quotes, escaped quotes, CRLF and a BOM", () => {
    const rows = parseCsv('﻿name,notes\r\n"Lee, Dana","said ""hi"""\r\nBo,\n');
    expect(rows).toEqual([
      ["name", "notes"],
      ["Lee, Dana", 'said "hi"'],
      ["Bo", ""],
    ]);
  });

  it("guards against formula injection but keeps phone numbers", () => {
    const out = toCsv([{ a: "=SUM(A1)", b: "+1 512 555 0100", c: "-5" }]);
    expect(out).toContain("'=SUM(A1)");
    expect(out).toContain("+1 512 555 0100");
    expect(out).toContain("-5");
  });

  it("auto-maps common headers", () => {
    const m = guessMapping(
      ["Customer Name", "Mobile", "E-mail", "Zip Code", "Address 1"],
      "customers",
    );
    expect(m).toMatchObject({
      name: "Customer Name",
      phone: "Mobile",
      email: "E-mail",
      zip: "Zip Code",
      street: "Address 1",
    });
  });
});

describe("import", () => {
  const csv = [
    "Name,Phone,Email,Street,City,State,Zip,SMS consent",
    "Dana Lee,(512) 555-7788,dana@example.com,12 Oak St,Austin,TX,78701,yes",
    "Bo Rao,512-555-0100,,9 Elm Ave,Austin,TX,78702,",
    "Dana Lee,5125557788,,12 Oak St,Austin,TX,78701,",
    ",,,,,,,",
    "Nobody,not-a-phone,bad-email,,,,,",
  ].join("\n");

  it("dry run reports valid rows, in-file duplicates and errors", async () => {
    const r = await previewImport({ kind: "customers", csv });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.total).toBe(4); // the all-empty row is ignored
    expect(r.data.validCount).toBe(3);
    expect(r.data.errors).toHaveLength(1);
    expect(r.data.duplicates).toBe(1);
    expect(await count("customers")).toBe(0);
  });

  it("imports customers once (dedupe by phone), with properties and consent", async () => {
    const { headers } = parseCsvObjects(csv);
    const r = await runImport({
      kind: "customers",
      csv,
      mapping: guessMapping(headers, "customers"),
    });
    expect(r.ok).toBe(true);
    expect(await count("customers")).toBe(2);
    expect(await count("properties")).toBe(2);
    expect(await count("consent_events")).toBe(1);
    const again = await runImport({
      kind: "customers",
      csv,
      mapping: guessMapping(headers, "customers"),
    });
    expect(again.ok).toBe(true);
    expect(await count("customers")).toBe(2);
  });
});

describe("export + backup + restore", () => {
  it("full export zip has tables, CSVs and a manifest; secrets are excluded", async () => {
    const { zip, tables } = await buildFullExport({});
    const files = readZip(zip);
    expect(tables).toBeGreaterThan(50);
    expect(files.has("tables/customers.json")).toBe(true);
    expect(files.has("tables/sessions.json")).toBe(false);
    expect(files.has("tables/secrets.json")).toBe(false);
    expect(files.has("csv/customers.csv")).toBe(true);
    expect(files.has("media/manifest.json")).toBe(true);
    const users = JSON.parse(
      new TextDecoder().decode(files.get("tables/users.json")),
    ) as {
      password_hash: string;
    }[];
    expect(users[0]?.password_hash).toBe("[redacted]");
    const readme = new TextDecoder().decode(files.get("README.txt"));
    expect(readme).toContain("(America/Chicago)");
  });

  it("redacts encrypted values nested in JSON (company NACHA account, T3-20)", async () => {
    await db.execute(
      sql`update company set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{payroll}',
        '{"nacha": {"company_account_enc": "v1:secret", "company_name": "Data Co"}}'::jsonb)`,
    );
    const { zip } = await buildFullExport({});
    const company = JSON.parse(
      new TextDecoder().decode(readZip(zip).get("tables/company.json")),
    ) as { settings: { payroll: { nacha: Record<string, unknown> } } }[];
    const nacha = company[0]?.settings.payroll.nacha;
    expect(nacha?.company_account_enc).toBe("[redacted]");
    expect(nacha?.company_name).toBe("Data Co");
    expect(
      redact("x", [
        { a_enc: "s", n: { b_enc: "t", ok: 1 }, list: [{ c_enc: 1 }] },
      ]),
    ).toEqual([
      {
        a_enc: "[redacted]",
        n: { b_enc: "[redacted]", ok: 1 },
        list: [{ c_enc: "[redacted]" }],
      },
    ]);
  });

  it("nightly backup → restore brings the data back", async () => {
    const before = await count("customers");
    await runBackup("2026-10-14");
    const manifest = JSON.parse(
      new TextDecoder().decode(
        await getStorage().get("backups/2026-10-14/manifest.json"),
      ),
    ) as { tables: string[] };
    await db.execute(sql`update customers set display_name = 'CHANGED'`);
    await db.execute(
      sql`insert into customers (display_name) values ('After backup')`,
    );
    expect(await count("customers")).toBe(before + 1);
    const res = await db.transaction((tx) =>
      restoreBackup(tx, {
        tables: manifest.tables,
        read: async (t) => {
          try {
            return JSON.parse(
              new TextDecoder().decode(
                await getStorage().get(`backups/2026-10-14/${t}.json`),
              ),
            ) as unknown[];
          } catch {
            return null;
          }
        },
      }),
    );
    expect(res.rows).toBeGreaterThan(0);
    expect(await count("customers")).toBe(before);
    const changed = await execRows<{ n: number }>(
      sql`select count(*)::int as n from customers where display_name = 'CHANGED'`,
    );
    expect(Number(changed[0]?.n)).toBe(0);
    expect(await count("users")).toBe(1);
  });
});
