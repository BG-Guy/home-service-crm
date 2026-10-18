import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedPushEndpoint } from "@/adapters/push/endpoints";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { requireApiUser } from "@/lib/auth/current";
import { ConflictError } from "@/lib/errors";
import { jsonError, readJson } from "@/lib/http";

// Web Push subscription store (SPEC §8.1, M22). Owner B5. POST registers this device
// (upsert by endpoint), DELETE removes it; dead endpoints are pruned by the push worker.
export const dynamic = "force-dynamic";

// Accepts the PushSubscription JSON directly or wrapped as { subscription }
// (what src/client/push.ts sends).
const SubscribeSchema = z.preprocess(
  (v) =>
    v && typeof v === "object" && "subscription" in v
      ? (v as { subscription: unknown }).subscription
      : v,
  z.object({
    // A browser push service only: the server later POSTs to this URL (no SSRF
    // to internal or arbitrary hosts, QA T5-20).
    endpoint: z
      .url({ protocol: /^https$/ })
      .max(2000)
      .refine(isAllowedPushEndpoint, "Not a browser push service."),
    keys: z.object({
      p256dh: z.string().min(10).max(200),
      auth: z.string().min(4).max(100),
    }),
  }),
);

export async function POST(req: Request): Promise<Response> {
  try {
    const user = await requireApiUser();
    const body = await readJson(req, SubscribeSchema, 8 * 1024);
    const values = {
      userId: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
      failedCount: 0,
    };
    // Same endpoint already stored: refresh it for this user. Moving it from
    // another user (someone else signed in on this browser) needs the same
    // subscription keys, so a leaked endpoint URL alone can't redirect another
    // user's notifications (QA T5-20).
    const [existing] = await db
      .select({
        userId: pushSubscriptions.userId,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, body.endpoint))
      .limit(1);
    if (
      existing &&
      existing.userId !== user.id &&
      (existing.p256dh !== body.keys.p256dh || existing.auth !== body.keys.auth)
    )
      throw new ConflictError(
        "push_endpoint_taken",
        "This device is registered to another account. Turn notifications off there first.",
      );
    await db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const user = await requireApiUser();
    const body = await readJson(
      req,
      z.object({ endpoint: z.url().max(2000) }),
      8 * 1024,
    );
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, body.endpoint),
          eq(pushSubscriptions.userId, user.id),
        ),
      );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
