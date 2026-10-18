// QA T6-03/T3-01: on a fresh full demo seed, the W-2 tech's approved/locked
// statements carry their own minimum-wage and overtime top-ups; none is rerouted
// "posted late" into the open week.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b6-topups-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

import { sql } from "drizzle-orm";
import { closeDb, execRows } from "@/db";
import { runDemoSeed } from "@/db/seed/demo";

beforeAll(async () => {
  await runDemoSeed({ log: () => {} });
}, 240_000);
afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("demo seed W-2 top-ups", () => {
  it("are never posted late", async () => {
    const late = await execRows<{ n: number }>(sql`
      select count(*)::int as n from ledger_entries
      where type in ('guarantee_topup', 'ot_topup') and memo like '%posted late%'`);
    expect(late[0]?.n).toBe(0);
  });

  it("land on the frozen statement of their own week", async () => {
    const rows = await execRows<{
      id: string;
      eff: string;
      in_own: boolean;
    }>(sql`
      select le.id, le.effective_date::text as eff,
        exists (
          select 1 from settlements s join pay_periods pp on pp.id = s.pay_period_id
          where s.user_id = le.user_id and s.status in ('approved','paid','locked')
            and le.effective_date between pp.starts_on and pp.ends_on
            and (s.totals->'entry_ids') @> jsonb_build_array(le.id::text)
        ) as in_own
      from ledger_entries le
      where le.type in ('guarantee_topup', 'ot_topup')`);
    // QA saw 7 guarantee and 6 OT top-ups on a fresh seed.
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows)
      expect({ id: r.id, inOwn: r.in_own }).toEqual({
        id: r.id,
        inOwn: true,
      });
  });
});
