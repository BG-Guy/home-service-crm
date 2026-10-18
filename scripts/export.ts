// npm run export -- [out.zip] [--no-media]   (SPEC M24, owner B1)
// Writes the same zip as Settings → Data → "Export everything" to a local file:
// JSON per table (secrets, sessions and token hashes excluded), CSVs of the main
// records and the media manifest + files.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb } from "../src/db";
import { buildFullExport } from "../src/features/data/engine";

async function main() {
  const args = process.argv.slice(2);
  const out = path.resolve(
    args.find((a) => !a.startsWith("--")) ??
      `export-${new Date().toISOString().slice(0, 10)}.zip`,
  );
  const started = Date.now();
  const { zip, tables, rows, mediaFiles } = await buildFullExport({
    includeMedia: !args.includes("--no-media"),
    log: (m) => console.log(m),
  });
  writeFileSync(out, zip);
  console.log(
    `Wrote ${out} (${(zip.length / 1_048_576).toFixed(1)} MB: ${tables} tables, ${rows} rows, ${mediaFiles} media files) in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
