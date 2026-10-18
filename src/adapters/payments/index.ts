import "server-only";
import { getSecret } from "@/lib/secrets";
import { manualProvider } from "./manual";
import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

// Payments adapter (SPEC §9.2). PAYMENTS_DRIVER = manual (default) | stripe.
// Manual is always available alongside the card processor.

export {
  normalizeStripeEvent,
  parseStripeEvent,
  toForm,
  verifyStripeSignature,
} from "./stripe";
export type * from "./types";

export function paymentsDriverName(): "manual" | "stripe" {
  return process.env.PAYMENTS_DRIVER === "stripe" ? "stripe" : "manual";
}

/** The card processor (or the manual driver when none is configured). */
export function getPayments(): PaymentProvider {
  return paymentsDriverName() === "stripe" ? stripeProvider : manualProvider;
}

/** A specific provider by id (e.g. refunds go back through the payment's original provider). */
export function getPaymentProvider(
  id: "manual" | "stripe" | "square",
): PaymentProvider {
  if (id === "stripe") return stripeProvider;
  if (id === "square")
    throw new Error("Square payments are not available yet (Later)");
  return manualProvider;
}

/** Is a card processor configured? (deposit modes capture/hold/card_on_file fall back to manual otherwise) */
export function hasCardProcessor(): boolean {
  return paymentsDriverName() === "stripe";
}

/**
 * Can this provider's driver make calls right now (credentials present)? Manual always
 * can. A card payment taken through Stripe can only be refunded through Stripe while
 * its secret key is configured.
 */
export async function processorReady(
  id: "manual" | "stripe" | "square" | string,
): Promise<boolean> {
  if (id === "manual") return true;
  if (id === "stripe") return !!(await getSecret("STRIPE_SECRET_KEY"));
  return false;
}

/**
 * Plain-words message for a provider failure. A missing credential never surfaces its
 * env var name ("STRIPE_SECRET_KEY is not configured"); other processor messages
 * (declines, "already refunded") pass through.
 */
export function providerErrorMessage(e: unknown, fallback: string): string {
  const err = e as { code?: unknown; message?: unknown } | null;
  const msg = typeof err?.message === "string" ? err.message : "";
  if (
    err?.code === "not_configured" ||
    /not configured|_KEY\b|SECRET/.test(msg)
  )
    return "The payment processor isn't connected. Connect it in Settings, or refund another way and record it.";
  return msg.slice(0, 300) || fallback;
}
