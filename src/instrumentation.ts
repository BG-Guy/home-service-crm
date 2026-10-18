// Next.js instrumentation hook: registers the DB boot hooks (base seed) on server start
// so a fresh PGlite/Postgres is ready on the first request (F1 note; SPEC §2 "auto-migrates
// and seeds on boot"). Node runtime only.
// In production a missing SESSION_SECRET stops the boot (QA T1-01): otherwise the
// server looks healthy while every signed URL and session fails.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { configProblems } = await import("@/lib/env");
    const { fatal, warnings } = configProblems();
    if (warnings.length)
      console.warn(`[env] production settings missing: ${warnings.join(", ")}`);
    if (fatal.length)
      throw new Error(
        `Refusing to start: set ${fatal.join(", ")} (≥ 16 chars). See docs/DEPLOY.md.`,
      );
    await import("@/db/seed/register");
  }
}
