import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/current";
import { jsonError, readJson } from "@/lib/http";
import { PresignSchema, presignUploads } from "@/lib/uploads";

// POST /api/uploads/presign (SPEC §8.1): session + per-kind permission; content-type
// allowlist; ≤ 15 MB. Returns { files: PresignedFile[] } (src/features/media/contracts.ts).
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireApiUser();
    const input = await readJson(req, PresignSchema);
    const files = await presignUploads(user, input);
    return NextResponse.json(
      { files },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return jsonError(err);
  }
}
