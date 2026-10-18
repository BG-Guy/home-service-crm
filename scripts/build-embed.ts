// Builds public/embed.js (SPEC M04) from src/features/leads/embed/embed.src.js:
// minified ES2017, no dependencies, and fails the build above 3 KB gzipped (SPEC §14).
// Uses esbuild's transform API (esbuild ships with tsx; no new dependency).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { transform } from "esbuild";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src/features/leads/embed/embed.src.js");
const OUT = path.join(ROOT, "public/embed.js");
const BUDGET = 3 * 1024;

async function main() {
  const src = readFileSync(SRC, "utf8");
  const { code } = await transform(src, {
    minify: true,
    target: "es2017",
    loader: "js",
    legalComments: "none",
  });
  const banner = "/* CRM lead embed · npm run build:embed */\n";
  const out = banner + code;
  const gz = gzipSync(out, { level: 9 }).length;
  if (gz > BUDGET) {
    console.error(`embed.js is ${gz} B gzipped — over the ${BUDGET} B budget.`);
    process.exit(1);
  }
  writeFileSync(OUT, out);
  console.log(
    `public/embed.js: ${out.length} B, ${gz} B gzipped (budget ${BUDGET} B).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
