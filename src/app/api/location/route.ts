import { NextResponse } from "next/server";
import { z } from "zod";
import { recordPing, shareState } from "@/features/map/engine";
import { requireApiUser } from "@/lib/auth/current";
import { jsonError, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

// /api/location (SPEC M19, BUILD_PLAN §9 B7): location pings from the tech app.
// GET → whether this user should share right now; POST → store one fix.
// Session + `location.share` + map flag + monitoring notice acked + clocked in
// (B2 getClockStatuses); at most one stored ping per 30 s per user.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const Ping = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).nullish(),
  heading: z.number().min(0).max(360).nullish(),
  speed: z.number().min(0).max(200).nullish(),
  at: z.union([z.number(), z.string().max(40)]).nullish(),
});

export async function GET(): Promise<Response> {
  try {
    const user = await requireApiUser();
    return NextResponse.json(await shareState(user), { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireApiUser("location.share");
    const input = await readJson(req, Ping, 2048);
    const state = await shareState(user);
    // Off shift / no notice / flag off: tell the client to stop watching.
    if (!state.share) return NextResponse.json(state, { headers: NO_STORE });
    const limit = await rateLimit({
      key: `loc:${user.id}`,
      limit: 1,
      windowSec: 30,
      store: "memory",
    });
    if (!limit.ok)
      return NextResponse.json(
        { ...state, stored: false, throttled: true },
        { headers: NO_STORE },
      );
    const { stored } = await recordPing(user, input);
    return NextResponse.json({ ...state, stored }, { headers: NO_STORE });
  } catch (err) {
    return jsonError(err);
  }
}
