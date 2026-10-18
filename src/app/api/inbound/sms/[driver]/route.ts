import { NextResponse } from "next/server";
import { z } from "zod";
import { getSmsDriver } from "@/adapters/messaging";
import { db } from "@/db";
import { findCustomerMatch } from "@/features/customers/api";
import { recordInbound } from "@/features/messaging/inbound";
import { processEventsSoon } from "@/lib/events";
import { clientIp, jsonError, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

// Inbound SMS webhook (SPEC M12, BUILD_PLAN §3.3 — Later for paid drivers).
// - `console` (development only): POST {"from":"+15125550123","body":"C"} to simulate a
//   customer reply; keywords (STOP/START/HELP, C/R) run through the normal handler.
// - Drivers with inbound support (Twilio/Telnyx/Android gateway, Later) must implement
//   verifyWebhook + parseInbound; until then this returns 501.
export const dynamic = "force-dynamic";

const ConsoleBody = z.object({
  from: z.string().min(7).max(20),
  body: z.string().min(1).max(1600),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ driver: string }> },
): Promise<Response> {
  try {
    const { driver } = await params;
    const rl = await rateLimit({
      key: `inbound:${clientIp(req) ?? "unknown"}`,
      limit: 120,
      windowSec: 60,
    });
    if (!rl.ok)
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });

    let from: string;
    let body: string;
    let providerId: string | null = null;
    if (driver === "console") {
      if (process.env.NODE_ENV === "production")
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      const b = await readJson(req, ConsoleBody, 8 * 1024);
      from = b.from;
      body = b.body;
    } else {
      const d = await getSmsDriver(driver).catch(() => null);
      if (!d?.caps.inbound || !d.parseInbound || !d.verifyWebhook)
        return NextResponse.json({ error: "not_implemented" }, { status: 501 });
      const raw = await req.clone().text();
      if (!(await d.verifyWebhook(req.clone(), raw)))
        return NextResponse.json({ error: "bad_signature" }, { status: 401 });
      const m = await d.parseInbound(req);
      if (!m) return NextResponse.json({ ok: true, ignored: true });
      from = m.from;
      body = m.body;
      providerId = m.providerId ?? null;
    }

    const match = await findCustomerMatch({ phone: from });
    const res = await db.transaction((tx) =>
      recordInbound(tx, {
        customerId: match?.customerId ?? null,
        from,
        body,
        channel: "sms",
        driver,
        status: "received",
        providerId,
      }),
    );
    await processEventsSoon();
    return NextResponse.json({
      ok: true,
      messageId: res.messageId,
      customerId: match?.customerId ?? null,
    });
  } catch (err) {
    return jsonError(err);
  }
}
