// npm run restore -- <backups/YYYY-MM-DD | ./local-backup-dir> --yes   (SPEC M24, owner B1)
// Replaces ALL data with a nightly backup. Reads <prefix>/manifest.json and one JSON
// file per table, either from the storage adapter (S3/R2 or ./.data/uploads) or from a
// local directory you downloaded. Requires --yes.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getStorage } from "../src/adapters/storage";
import { closeDb, db } from "../src/db";
import { type BackupSet, restoreBackup } from "../src/features/data/restore";

async function main() {
  const src = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!src) {
    console.error("Usage: npm run restore -- backups/2026-10-14 --yes");
    process.exitCode = 2;
    return;
  }
  const local = existsSync(path.join(src, "manifest.json"));
  const read = async (name: string): Promise<string | null> => {
    try {
      if (local) return readFileSync(path.join(src, name), "utf8");
      const bytes = await getStorage().get(
        `${src.replace(/\/+$/, "")}/${name}`,
      );
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  };
  const manifestText = await read("manifest.json");
  if (!manifestText) {
    console.error(`No manifest.json found at ${src}`);
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(manifestText) as {
    tables: string[];
    rows: number;
    created_at: string;
  };
  console.log(
    `Backup from ${manifest.created_at}: ${manifest.tables.length} tables, ${manifest.rows} rows.`,
  );
  if (!process.argv.includes("--yes")) {
    console.error(
      "This REPLACES all current data. Re-run with --yes to continue.",
    );
    process.exitCode = 2;
    return;
  }
  const set: BackupSet = {
    tables: manifest.tables,
    read: async (t) => {
      const text = await read(`${t}.json`);
      return text ? (JSON.parse(text) as unknown[]) : null;
    },
  };
  const started = Date.now();
  const res = await db.transaction((tx) =>
    restoreBackup(tx, set, (m) => console.log(m)),
  );
  console.log(
    `Restored ${res.rows} rows into ${res.tables} tables in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
