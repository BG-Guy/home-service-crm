import "server-only";
import { sql } from "drizzle-orm";
import { execRows, type Tx } from "@/db";
import type { CounterKey } from "@/db/enums";
import { formatDocNumber } from "./ids";

// Gapless human numbers (SPEC §6.2 counters): the row lock of the UPDATE … RETURNING
// in the caller's transaction makes numbers gapless (a rolled-back tx frees its number).

export const DEFAULT_PREFIXES: Record<CounterKey, string> = {
  job: "J-",
  invoice: "INV-",
  estimate: "EST-",
  change_order: "CO-",
  credit_note: "CN-",
};

/** Next number for `key` (e.g. 'J-1042'). Must run inside the inserting transaction. */
export async function nextNumber(
  tx: Tx,
  key: CounterKey | (string & {}),
): Promise<string> {
  let rows = await execRows<{ prefix: string; value: string | number }>(
    sql`update counters set next_value = next_value + 1 where key = ${key} returning prefix, (next_value - 1)::text as value`,
    tx,
  );
  if (rows.length === 0) {
    const prefix =
      DEFAULT_PREFIXES[key as CounterKey] ?? `${key.toUpperCase()}-`;
    await execRows(
      sql`insert into counters (key, prefix, next_value) values (${key}, ${prefix}, 1001) on conflict (key) do nothing`,
      tx,
    );
    rows = await execRows(
      sql`update counters set next_value = next_value + 1 where key = ${key} returning prefix, (next_value - 1)::text as value`,
      tx,
    );
  }
  const r = rows[0];
  if (!r) throw new Error(`counter ${key} unavailable`);
  return formatDocNumber(r.prefix, r.value);
}
