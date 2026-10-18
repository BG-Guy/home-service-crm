// npm run seed:demo [-- --reset] [-- --profile=<handyman|locksmith|chimney>]  (BUILD_PLAN §10.1)
// Migrates, runs the base seed, then every demo fragment in order. Refuses to run twice
// unless --reset (which empties every domain table first). --profile seeds a single-trade
// business (src/db/seed/profiles); without it the mixed "Acme Home Services" demo runs.
import { DEMO_PROFILE_KEYS } from "../src/db/seed/profiles";

function parseProfile(argv: string[]): string | null {
  for (const [i, a] of argv.entries()) {
    if (a.startsWith("--profile=")) return a.slice("--profile=".length).trim();
    if (a === "--profile") return (argv[i + 1] ?? "").trim();
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const reset = argv.includes("--reset");
  const profile = parseProfile(argv);
  if (profile !== null) {
    if (!profile || !DEMO_PROFILE_KEYS.includes(profile)) {
      console.error(
        `Unknown --profile "${profile}". Use one of: ${DEMO_PROFILE_KEYS.filter((k) => k !== "default").join(", ")} (or omit it for the mixed demo).`,
      );
      process.exitCode = 2;
      return;
    }
    // The plan is chosen when demo-plan is first evaluated: set it before the import.
    process.env.DEMO_PROFILE = profile;
  }
  const { closeDb, DemoAlreadySeededError, runDemoSeed } = await import(
    "../src/db/seed/demo"
  );
  const { DEMO, DEMO_PROFILE } = await import("../src/db/seed/demo-plan");
  try {
    console.log(`Seeding "${DEMO.company.name}" (profile ${DEMO_PROFILE.key})`);
    const res = await runDemoSeed({ reset });
    for (const f of res.fragments) {
      console.log(
        `  ${f.error ? "✗" : "✓"} ${f.name.padEnd(12)} ${String(f.ms).padStart(5)} ms${f.error ? `  ${f.error}` : ""}`,
      );
    }
    console.log("counts:", res.counts);
    console.log(`seed:demo finished in ${(res.ms / 1000).toFixed(1)} s`);
    console.log(`Sign in to ${DEMO.company.name} (password ${DEMO.password}):`);
    for (const u of DEMO.users)
      console.log(`  ${u.role.padEnd(6)} ${u.email.padEnd(26)} ${u.name}`);
    process.exitCode = res.fragments.some((f) => f.error) ? 1 : 0;
  } catch (err) {
    if (err instanceof DemoAlreadySeededError) {
      console.error(err.message);
      process.exitCode = 2;
    } else {
      console.error(err);
      process.exitCode = 1;
    }
  } finally {
    await closeDb();
  }
}

void main();
