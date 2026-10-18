import { after, NextResponse } from "next/server";
import { ingestStripeWebhook } from "@/features/payments/webhook";
import { processEvents } from "@/lib/events";

// Stripe webhook (SPEC §8.4, BUILD_PLAN §3.3 B4). Raw body → HMAC verify → stored in
// webhook_events (idempotent) → processed; domain events drain in after().
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  try {
    const out = await ingestStripeWebhook(
      raw,
      req.headers.get("stripe-signature"),
    );
    if (out.status === 200)
      after(async () => {
        try {
          await processEvents();
        } catch (e) {
          console.error("[stripe webhook] processEvents failed:", e);
        }
      });
    return NextResponse.json(out.body, {
      status: out.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    // Storage failed: let Stripe retry.
    console.error("[stripe webhook] ingest failed:", e);
    return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
  }
}
