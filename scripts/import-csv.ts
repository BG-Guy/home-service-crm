// npm run import:csv -- <customers|pricebook|jobs> <file.csv> [--dry-run]   (SPEC M24, owner B1)
// Same planner as the Settings → Data wizard: columns are auto-mapped from the header
// row, every row is validated, existing customers (phone/email) are updated, not duplicated.
import { readFileSync } from "node:fs";
import { closeDb, db } from "../src/db";
import { parseCsvObjects } from "../src/features/data/csv";
import {
  guessMapping,
  type ImportKind,
  importCustomers,
  importJobs,
  importPricebook,
  planCustomerImport,
  planJobImport,
  planPricebookImport,
} from "../src/features/data/import";
import { SYSTEM_ACTOR } from "../src/lib/types";

const KINDS = ["customers", "pricebook", "jobs"] as const;

async function main() {
  const [kindArg, file] = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"));
  const dry = process.argv.includes("--dry-run");
  if (!kindArg || !file || !KINDS.includes(kindArg as ImportKind)) {
    console.error(
      "Usage: npm run import:csv -- <customers|pricebook|jobs> <file.csv> [--dry-run]",
    );
    process.exitCode = 2;
    return;
  }
  const kind = kindArg as ImportKind;
  const { headers, rows } = parseCsvObjects(readFileSync(file, "utf8"));
  const mapping = guessMapping(headers, kind);
  console.log("Column mapping:");
  for (const [k, v] of Object.entries(mapping))
    console.log(`  ${k.padEnd(14)} ← ${v ?? "(skipped)"}`);
  const plan =
    kind === "customers"
      ? await planCustomerImport(rows, mapping)
      : kind === "pricebook"
        ? planPricebookImport(rows, mapping)
        : await planJobImport(rows, mapping);
  console.log(
    `${plan.valid.length}/${plan.total} rows valid, ${plan.duplicates} match existing records, ${plan.errors.length} skipped`,
  );
  for (const e of plan.errors.slice(0, 20))
    console.log(`  row ${e.row}: ${e.error}`);
  if (dry) return;
  const actor = { ...SYSTEM_ACTOR };
  const result = await db.transaction(async (tx) => {
    if (kind === "customers")
      return importCustomers(tx, plan.valid as never, actor);
    if (kind === "pricebook")
      return importPricebook(tx, plan.valid as never, actor);
    return importJobs(tx, plan.valid as never, actor);
  });
  console.log("Imported:", result);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
