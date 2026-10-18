import { NextResponse } from "next/server";
import {
  getStorage,
  mimeFromKey,
  storageDriverName,
  verifyLocalUrl,
} from "@/adapters/storage";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

// Local-storage file route (SPEC §9.3, dev): signed, expiring GET (serve) and PUT
// (upload) for STORAGE_DRIVER=local. 404 when another driver is active.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string[] }> };

async function keyOf(ctx: Ctx): Promise<string> {
  const { key } = await ctx.params;
  return key.map((s) => decodeURIComponent(s)).join("/");
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  if (storageDriverName() !== "local")
    return new NextResponse(null, { status: 404 });
  const key = await keyOf(ctx);
  const check = verifyLocalUrl("GET", key, new URL(req.url).searchParams);
  if (!check.ok) return new NextResponse(null, { status: 403 });
  let body: Uint8Array;
  try {
    body = await getStorage().get(key);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": mimeFromKey(key),
    "Content-Length": String(body.byteLength),
    "Cache-Control": "private, max-age=600",
    "X-Content-Type-Options": "nosniff",
  };
  if (check.download)
    headers["Content-Disposition"] =
      `attachment; filename="${check.download.replace(/["\\]/g, "")}"`;
  return new NextResponse(new Uint8Array(body), { status: 200, headers });
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  if (storageDriverName() !== "local")
    return new NextResponse(null, { status: 404 });
  const key = await keyOf(ctx);
  const check = verifyLocalUrl("PUT", key, new URL(req.url).searchParams);
  if (!check.ok)
    return NextResponse.json({ error: check.reason }, { status: 403 });
  const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim();
  if (check.mime && type && type !== check.mime)
    return NextResponse.json(
      { error: "content-type mismatch" },
      { status: 400 },
    );
  const buf = new Uint8Array(await req.arrayBuffer());
  const limit = Math.min(MAX_UPLOAD_BYTES, check.bytes ?? MAX_UPLOAD_BYTES);
  if (buf.byteLength === 0 || buf.byteLength > limit)
    return NextResponse.json({ error: "size not allowed" }, { status: 413 });
  await getStorage().put(key, buf, check.mime ?? mimeFromKey(key));
  return new NextResponse(null, { status: 200 });
}
