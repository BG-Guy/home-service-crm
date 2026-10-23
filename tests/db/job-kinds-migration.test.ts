// Leads-flow redesign, item 6: drizzle/0006_job_kinds_data.sql on a database seeded
// before it. A throwaway PGlite is migrated to 0004, given the old generic service
// types (plus trade and admin rows), then migrated to the latest; the mapping is
// checked row by row. No app modules: PGlite + the drizzle migrator only.
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-kinds-mig-"),
);
const DRIZZLE = path.join(process.cwd(), "drizzle");

/** A copy of drizzle/ that stops after migration `lastIdx` (journal trimmed). */
function migrationsUpTo(lastIdx: number): string {
  const dir = path.join(root, `mig-${lastIdx}`);
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= lastIdx);
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify(journal),
  );
  for (const e of journal.entries)
    copyFileSync(
      path.join(DRIZZLE, `${e.tag}.sql`),
      path.join(dir, `${e.tag}.sql`),
    );
  return dir;
}

const ids = {
  serviceCall: "00000000-0000-4000-8000-000000000001",
  repair: "00000000-0000-4000-8000-000000000002",
  installation: "00000000-0000-4000-8000-000000000003",
  maintenance: "00000000-0000-4000-8000-000000000004",
  estimate: "00000000-0000-4000-8000-000000000005",
  lockout: "00000000-0000-4000-8000-000000000006",
  heater: "00000000-0000-4000-8000-000000000007",
  remodel: "00000000-0000-4000-8000-000000000008",
  reline: "00000000-0000-4000-8000-000000000009",
  assessment: "00000000-0000-4000-8000-00000000000a",
  sweep: "00000000-0000-4000-8000-00000000000b",
  deletedEstimate: "00000000-0000-4000-8000-00000000000c",
  tech: "00000000-0000-4000-8000-0000000000a1",
  helper: "00000000-0000-4000-8000-0000000000a2",
};

let pg: PGlite;

interface Row {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  contract_kind: string;
  icon: string | null;
  default_duration_min: number;
  maintenance_interval_months: number | null;
  requires_ownership_check: boolean;
}

async function rows(): Promise<Map<string, Row>> {
  const r = await pg.query<Row>(
    `select id, name, kind, active, contract_kind, icon, default_duration_min,
            maintenance_interval_months, requires_ownership_check
       from service_types`,
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}

beforeAll(async () => {
  pg = new PGlite(path.join(root, "pglite"));
  const db = drizzle(pg);
  await migrate(db, { migrationsFolder: migrationsUpTo(4) });
  // The pre-redesign base seed (generic types) plus trade and admin rows.
  await pg.exec(`
    insert into service_types (id, name, color, icon, default_duration_min, contract_kind,
        requires_ownership_check, maintenance_interval_months, sort, active, deleted_at)
    values
      ('${ids.serviceCall}', 'Service call / diagnostic', '#007AFF', 'clipboard', 60, 'repair', false, null, 1, true, null),
      ('${ids.repair}', 'Repair', '#FF9500', 'tools', 90, 'repair', false, null, 2, true, null),
      ('${ids.installation}', 'Installation', '#34C759', 'hammer', 180, 'repair', false, null, 3, true, null),
      ('${ids.maintenance}', 'Maintenance', '#5856D6', 'checklist', 60, 'repair', false, 12, 4, true, null),
      ('${ids.estimate}', 'Estimate visit', '#8E8E93', 'estimates', 45, 'repair', false, null, 5, true, null),
      ('${ids.lockout}', 'After-hours lockout', '#FF3B30', 'key', 45, 'repair', true, null, 15, true, null),
      ('${ids.heater}', 'Water heater installation', '#007AFF', 'tools', 120, 'repair', false, 24, 16, true, null),
      ('${ids.remodel}', 'Bathroom refresh', '#007AFF', 'tools', 120, 'improvement', false, null, 17, true, null),
      ('${ids.reline}', 'Chimney relining', '#007AFF', 'tools', 480, 'repair', false, null, 18, true, null),
      ('${ids.assessment}', 'Service call / assessment', '#007AFF', 'clipboard', 60, 'repair', false, null, 19, true, null),
      ('${ids.sweep}', 'Chimney sweep', '#007AFF', 'tools', 60, 'repair', false, 12, 20, true, null),
      ('${ids.deletedEstimate}', 'Estimate visit', '#8E8E93', 'estimates', 45, 'repair', false, null, 0, true, now());
    insert into roles (key, name, base_role, builtin) values ('tech', 'Technician', 'tech', true);
    insert into users (id, email, name, role, skills) values
      ('${ids.tech}', 'tech@x.test', 'Tech', 'tech', array['${ids.serviceCall}', '${ids.repair}']::uuid[]),
      ('${ids.helper}', 'helper@x.test', 'Helper', 'tech', array['${ids.maintenance}', '${ids.lockout}']::uuid[]);
  `);
  await migrate(db, { migrationsFolder: DRIZZLE });
}, 60_000);

afterAll(async () => {
  await pg?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("0006 job kinds data migration", () => {
  it("adds the new columns and table", async () => {
    const cols = await pg.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where (table_name = 'service_types' and column_name = 'kind')
           or (table_name = 'users' and column_name = 'work_hours')
           or table_name = 'time_off'`,
    );
    const names = cols.rows.map((c) => `${c.table_name}.${c.column_name}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "service_types.kind",
        "users.work_hours",
        "time_off.user_id",
        "time_off.starts_at",
        "time_off.ends_at",
        "time_off.note",
        "time_off.created_by",
      ]),
    );
    const wh = await pg.query<{ work_hours: unknown }>(
      `select work_hours from users where id = '${ids.tech}'`,
    );
    expect(wh.rows[0]?.work_hours).toBeNull(); // null = company business hours
  });

  it("renames the generic rows into the three job types", async () => {
    const r = await rows();
    expect(r.get(ids.estimate)).toMatchObject({
      name: "Free estimate",
      kind: "estimate",
      active: true,
      icon: "clipboard",
      default_duration_min: 45,
    });
    expect(r.get(ids.serviceCall)).toMatchObject({
      name: "Service call",
      kind: "service",
      active: true,
      icon: "tools",
      default_duration_min: 90,
    });
    expect(r.get(ids.installation)).toMatchObject({
      name: "Project",
      kind: "project",
      contract_kind: "improvement",
      active: true,
      icon: "hammer",
      default_duration_min: 240,
    });
  });

  it("retires Repair and Maintenance without deleting them", async () => {
    const r = await rows();
    expect(r.get(ids.repair)).toMatchObject({ name: "Repair", active: false });
    expect(r.get(ids.maintenance)).toMatchObject({
      name: "Maintenance",
      active: false,
    });
    expect(r.size).toBe(12); // nothing deleted
  });

  it("keeps trade rows (and the ownership check) as service calls", async () => {
    const r = await rows();
    expect(r.get(ids.lockout)).toMatchObject({
      name: "After-hours lockout",
      kind: "service",
      active: true,
      requires_ownership_check: true,
    });
    expect(r.get(ids.sweep)).toMatchObject({
      name: "Chimney sweep",
      kind: "service",
    });
  });

  it("makes clear installs and projects Projects", async () => {
    const r = await rows();
    expect(r.get(ids.heater)?.kind).toBe("project"); // "installation" in the name
    expect(r.get(ids.remodel)?.kind).toBe("project"); // home-improvement contract
    expect(r.get(ids.reline)?.kind).toBe("project"); // half a day or more
    // Names other than the generic ones are kept.
    expect(r.get(ids.heater)?.name).toBe("Water heater installation");
    expect(r.get(ids.heater)?.contract_kind).toBe("repair");
  });

  it("renames one row per mapping and never duplicates a name", async () => {
    const r = await rows();
    // A second "Service call / …" row keeps its name (already a service call).
    expect(r.get(ids.assessment)).toMatchObject({
      name: "Service call / assessment",
      kind: "service",
    });
    // The soft-deleted duplicate is not renamed, but gets the kind.
    expect(r.get(ids.deletedEstimate)).toMatchObject({
      name: "Estimate visit",
      kind: "estimate",
    });
    const live = await pg.query<{ name: string; n: number }>(
      `select name, count(*)::int as n from service_types
        where deleted_at is null group by name having count(*) > 1`,
    );
    expect(live.rows).toEqual([]);
  });

  it("drops every maintenance interval", async () => {
    const r = await rows();
    for (const row of r.values())
      expect(row.maintenance_interval_months).toBeNull();
  });

  it("gives techs who did Repair or Maintenance the Service call skill", async () => {
    const u = await pg.query<{ id: string; skills: string[] }>(
      `select id, skills from users order by email`,
    );
    const by = new Map(u.rows.map((x) => [x.id, x.skills]));
    // Already had it: unchanged (no duplicate).
    expect(by.get(ids.tech)).toEqual([ids.serviceCall, ids.repair]);
    expect(by.get(ids.helper)).toEqual([
      ids.maintenance,
      ids.lockout,
      ids.serviceCall,
    ]);
  });

  it("enforces a time-off range", async () => {
    await expect(
      pg.exec(
        `insert into time_off (user_id, starts_at, ends_at)
         values ('${ids.tech}', '2026-10-23T10:00Z', '2026-10-23T09:00Z')`,
      ),
    ).rejects.toThrow(/time_off_range_ck/);
    await pg.exec(
      `insert into time_off (user_id, starts_at, ends_at, note)
       values ('${ids.tech}', '2026-10-23T09:00Z', '2026-10-24T09:00Z', 'Dentist')`,
    );
    const t = await pg.query<{ n: number }>(
      `select count(*)::int as n from time_off`,
    );
    expect(t.rows[0]?.n).toBe(1);
  });
});
