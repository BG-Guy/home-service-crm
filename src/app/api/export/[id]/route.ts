import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getStorage } from "@/adapters/storage";
import { db } from "@/db";
import { exports } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey } from "@/lib/time";

// GET /api/export/[id] (SPEC §8.1): session + data.export → 302 to a signed download
// URL valid until the export's 24 h expiry.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.perms.has("data.export"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [row] = await db
    .select()
    .from(exports)
    .where(eq(exports.id, id))
    .limit(1);
  if (!row || row.kind === "backup" || !row.storageKey)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.status !== "ready" || (row.expiresAt && row.expiresAt < new Date()))
    return NextResponse.json({ error: "expired" }, { status: 410 });
  const secs = row.expiresAt
    ? Math.max(60, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000))
    : 3600;
  const url = await getStorage().signedGetUrl(
    row.storageKey,
    Math.min(secs, 24 * 3600),
    `export-${dateKey(row.createdAt, await getCompanyTimezone())}.zip`,
  );
  // The local driver returns a relative URL; resolve it against this request.
  return NextResponse.redirect(new URL(url, req.url), 302);
}
