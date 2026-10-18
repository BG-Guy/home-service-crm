import { NextResponse } from "next/server";
import { runTick } from "@/lib/cron";
import { isProd } from "@/lib/env";
import { safeEqual } from "@/lib/hash";

// Scheduler entry point (SPEC §3.1, §8.1): `Authorization: Bearer ${CRON_SECRET}`.
// Open in development when CRON_SECRET is unset. Idempotent; guarded by advisory lock 42.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean | "unconfigured" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return isProd ? "unconfigured" : true;
  const header = req.headers.get("authorization") ?? "";
  return safeEqual(header, `Bearer ${secret}`);
}

async function handle(req: Request): Promise<Response> {
  const auth = authorized(req);
  if (auth === "unconfigured")
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runTick({ source: "cron" });
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[cron] tick failed:", err);
    return NextResponse.json({ error: "tick_failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
