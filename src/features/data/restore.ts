import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { execRows } from "@/db";
import { truncateDomainTables } from "@/db/seed/helpers";

// Restore from a nightly backup (SPEC M24). Replaces ALL data: every domain table is
// truncated, then each table is reloaded with json_populate_recordset (Postgres casts
// the JSON back to the column types) in foreign-key order, then sequences are reset.

export interface BackupSet {
  tables: string[];
  read(table: string): Promise<unknown[] | null>;
}

/** Order tables so referenced tables load first (self-references are fine in one INSERT). */
export async function fkOrder(tx: Tx, tables: string[]): Promise<string[]> {
  const deps = await execRows<{ child: string; parent: string }>(
    sql`select distinct tc.table_name as child, ccu.table_name as parent
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
    tx,
  );
  const want = new Set(tables);
  const parents = new Map<string, Set<string>>();
  for (const t of tables) parents.set(t, new Set());
  for (const d of deps)
    if (want.has(d.child) && want.has(d.parent) && d.child !== d.parent)
      parents.get(d.child)?.add(d.parent);
  const out: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (t: string) => {
    if (done.has(t) || visiting.has(t)) return; // cycles: best effort (FK check at statement end)
    visiting.add(t);
    for (const p of parents.get(t) ?? []) visit(p);
    visiting.delete(t);
    done.add(t);
    out.push(t);
  };
  for (const t of [...tables].sort()) visit(t);
  return out;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function restoreBackup(
  tx: Tx,
  set: BackupSet,
  log: (m: string) => void = () => undefined,
): Promise<{ tables: number; rows: number }> {
  await truncateDomainTables(tx as never);
  const order = await fkOrder(tx, set.tables);
  let rows = 0;
  let tables = 0;
  for (const t of order) {
    const data = await set.read(t);
    if (!data || data.length === 0) continue;
    // Chunks keep each statement's JSON parameter modest.
    for (let i = 0; i < data.length; i += 500) {
      const chunk = JSON.stringify(data.slice(i, i + 500));
      await execRows(
        sql`insert into ${sql.raw(ident(t))} overriding system value select * from json_populate_recordset(null::${sql.raw(ident(t))}, ${chunk}::json)`,
        tx,
      );
    }
    rows += data.length;
    tables++;
    log(`  ${t.padEnd(28)} ${data.length}`);
  }
  // Serial / identity columns continue after the restored max.
  const seqs = await execRows<{ table_name: string; column_name: string }>(
    sql`select table_name, column_name from information_schema.columns
        where table_schema = 'public' and (column_default like 'nextval(%' or is_identity = 'YES')`,
    tx,
  );
  for (const s of seqs) {
    if (!set.tables.includes(s.table_name)) continue;
    await execRows(
      sql.raw(
        `select setval(pg_get_serial_sequence('${ident(s.table_name)}', '${s.column_name}'), coalesce((select max(${ident(s.column_name)}) from ${ident(s.table_name)}), 0) + 1, false)`,
      ),
      tx,
    );
  }
  return { tables, rows };
}
