import "server-only";
import { and, eq } from "drizzle-orm";
import { parseStripeEvent, verifyStripeSignature } from "@/adapters/payments";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { getSecret } from "@/lib/secrets";
import { processWebhookEvent } from "./provider-events";

// Stripe webhook ingestion (SPEC §8.4): verify HMAC (5-min tolerance) → store the raw
// event in webhook_events (unique provider+event_id = idempotent; unknown types are
// stored too) → process in its own transaction → always 200 for a verified event
// (failures are retried by the `payments.webhook_retry` cron).

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function ingestStripeWebhook(
  rawBody: string,
  signature: string | null,
  opts: { secret?: string | null; nowSec?: number } = {},
): Promise<WebhookOutcome> {
  const secret =
    opts.secret !== undefined
      ? opts.secret
      : await getSecret("STRIPE_WEBHOOK_SECRET");
  if (!secret)
    return { status: 503, body: { error: "webhook_secret_not_configured" } };
  if (!verifyStripeSignature(rawBody, signature, secret, opts.nowSec))
    return { status: 400, body: { error: "bad_signature" } };
  let evt: ReturnType<typeof parseStripeEvent>;
  try {
    evt = parseStripeEvent(rawBody);
  } catch {
    return { status: 400, body: { error: "bad_json" } };
  }
  if (!evt?.id || !evt.type)
    return { status: 400, body: { error: "bad_event" } };
  const [ins] = await db
    .insert(webhookEvents)
    .values({
      provider: "stripe",
      eventId: evt.id,
      type: evt.type,
      payload: evt as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  let rowId = ins?.id ?? null;
  if (!rowId) {
    // Duplicate delivery: reprocess only if the first attempt hasn't succeeded yet.
    const [prev] = await db
      .select({ id: webhookEvents.id, done: webhookEvents.processedAt })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, "stripe"),
          eq(webhookEvents.eventId, evt.id),
        ),
      )
      .limit(1);
    if (!prev || prev.done)
      return { status: 200, body: { received: true, duplicate: true } };
    rowId = prev.id;
  }
  const result = await processWebhookEvent(rowId);
  return { status: 200, body: { received: true, result } };
}
