import { NextResponse } from "next/server";
import {
  PublicPresignSchema,
  publicPresign,
} from "@/features/signatures/public-upload.server";
import { clientIp, jsonError, readJson } from "@/lib/http";

// POST /api/uploads/public/presign (BUILD_PLAN §3.3, B3): remote signing on /e/[token]
// uploads the drawn signature PNG (and an optional ID photo) without a session. The
// estimate/job magic link authorizes it; the response carries an HMAC upload token.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const input = await readJson(req, PublicPresignSchema, 8 * 1024);
    const file = await publicPresign(input, clientIp(req));
    return NextResponse.json(file, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return jsonError(err);
  }
}
