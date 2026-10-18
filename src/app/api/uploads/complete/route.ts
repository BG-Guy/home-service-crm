import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/current";
import { jsonError, readJson } from "@/lib/http";
import { CompleteSchema, completeUpload } from "@/lib/uploads";

// POST /api/uploads/complete (SPEC §8.1, M11): records the media row (idempotent on
// clientId) and emits photo.uploaded for job photos.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireApiUser();
    const input = await readJson(req, CompleteSchema);
    const res = await completeUpload(user, input);
    return NextResponse.json(res, {
      status: res.created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return jsonError(err);
  }
}
