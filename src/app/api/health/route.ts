import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { execRows } from "@/db";
import { appVersion, configProblems } from "@/lib/env";

// GET /api/health → { ok, db, config, version } (SPEC §8.1). `config` lists missing
// production env vars by name (never values); a fatal one (SESSION_SECRET) is a 503.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let dbOk = false;
  try {
    const rows = await execRows<{ ok: number }>(sql`select 1 as ok`);
    dbOk = Number(rows[0]?.ok) === 1;
  } catch {
    dbOk = false;
  }
  const config = configProblems();
  const ok = dbOk && config.fatal.length === 0;
  return NextResponse.json(
    {
      ok,
      db: dbOk,
      config: {
        ok: config.fatal.length === 0,
        missing: config.fatal,
        warnings: config.warnings,
      },
      version: appVersion(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
