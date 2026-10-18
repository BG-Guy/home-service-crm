import { NextResponse } from "next/server";
import {
  PublicCompleteSchema,
  publicComplete,
} from "@/features/signatures/public-upload.server";
import { jsonError, readJson } from "@/lib/http";

// POST /api/uploads/public/complete (B3, companion of …/public/presign): records the
// uploaded file as a media row bound to the magic link's entity. Idempotent on clientId.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const input = await readJson(req, PublicCompleteSchema, 8 * 1024);
    const res = await publicComplete(input);
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(err);
  }
}
