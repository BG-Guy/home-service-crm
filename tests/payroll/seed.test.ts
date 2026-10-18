// B6 seed fragments (parts #20, payroll #21) run on a fresh PGlite on top of the
// base seed + demo-core + price book, guard on missing rows, and rerun cleanly.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b6-seed-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";

import { sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import "@/db/seed/register";
import { makeDemoCtx } from "@/db/seed/demo";
import { seedDemo as core } from "@/db/seed/demo-core";
import { seedDemo as parts } from "@/features/parts/seed";
import { seedDemo as payroll } from "@/features/payroll/seed";
import { seedDemo as pricebook } from "@/features/pricebook/seed";

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
}, 120_000);
afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("B6 demo seed fragments", () => {
  it("run without events and rerun cleanly", async () => {
    const ctx = makeDemoCtx(new Date(), () => {});
    await core(db, ctx);
    await pricebook(db, ctx);
    const before = await count("events");
    await parts(db, ctx);
    await payroll(db, ctx);
    await parts(db, ctx);
    await payroll(db, ctx);
    expect(await count("tech_comp")).toBe(3);
    expect(await count("pay_periods")).toBeGreaterThanOrEqual(10);
    expect(await count("stock_locations")).toBeGreaterThanOrEqual(1);
    expect(await count("inventory_levels")).toBeGreaterThanOrEqual(15);
    expect(await count("part_purchases")).toBeGreaterThanOrEqual(7);
    // Only task.created from the restock request may be emitted (createTask is allowed).
    const evs = await execRows<{ type: string }>(sql`select type from events`);
    expect(evs.slice(before).every((e) => e.type === "task.created")).toBe(
      true,
    );
  });
});
