import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeStripeEvent,
  parseStripeEvent,
  verifyStripeSignature,
} from "@/adapters/payments/stripe";

// Recorded-shape Stripe fixtures (trimmed) + HMAC verification (SPEC §8.4).

const SECRET = "whsec_test_fixture_secret";
const T = 1_760_000_000;

const PI_SUCCEEDED = {
  id: "evt_fixture_pi_ok",
  type: "payment_intent.succeeded",
  data: {
    object: {
      id: "pi_fixture_1",
      object: "payment_intent",
      amount: 32500,
      amount_received: 32500,
      status: "succeeded",
      metadata: {
        invoice_id: "11111111-1111-4111-8111-111111111111",
        job_id: "22222222-2222-4222-8222-222222222222",
        tip_cents: "2500",
      },
      latest_charge: {
        id: "ch_fixture_1",
        billing_details: { name: "Pat Doe" },
        payment_method_details: {
          type: "card",
          card: {
            brand: "visa",
            last4: "4242",
            funding: "credit",
            fingerprint: "fp_fixture",
            country: "US",
            checks: { address_postal_code_check: "pass", cvc_check: "pass" },
            three_d_secure: { result: "authenticated" },
          },
        },
      },
    },
  },
};

const DISPUTE_CREATED = {
  id: "evt_fixture_dp",
  type: "charge.dispute.created",
  data: {
    object: {
      id: "dp_fixture_1",
      object: "dispute",
      amount: 60000,
      charge: "ch_fixture_1",
      payment_intent: "pi_fixture_1",
      reason: "product_unacceptable",
      status: "needs_response",
      network_reason_code: "13.3",
      evidence_details: { due_by: T + 7 * 86400 },
    },
  },
};

function sign(body: string, t = T, secret = SECRET) {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

describe("Stripe webhook signature (HMAC, 5-min tolerance)", () => {
  const body = JSON.stringify(PI_SUCCEEDED);

  it("accepts a valid signature", () => {
    expect(verifyStripeSignature(body, sign(body), SECRET, T + 10)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const h = sign(body);
    expect(
      verifyStripeSignature(body.replace("32500", "1"), h, SECRET, T),
    ).toBe(false);
  });

  it("rejects the wrong secret and a missing header", () => {
    expect(
      verifyStripeSignature(body, sign(body, T, "whsec_other"), SECRET, T),
    ).toBe(false);
    expect(verifyStripeSignature(body, null, SECRET, T)).toBe(false);
  });

  it("rejects a replay outside the 5-minute window", () => {
    expect(verifyStripeSignature(body, sign(body), SECRET, T + 301)).toBe(
      false,
    );
    expect(verifyStripeSignature(body, sign(body), SECRET, T + 299)).toBe(true);
  });

  it("accepts any matching v1 among several (secret rotation)", () => {
    const good = sign(body).split(",")[1];
    const h = `t=${T},v1=${"0".repeat(64)},${good}`;
    expect(verifyStripeSignature(body, h, SECRET, T)).toBe(true);
  });
});

describe("Stripe events → normalized events", () => {
  it("payment_intent.succeeded carries the card snapshot and invoice", () => {
    const [ev] = normalizeStripeEvent(
      parseStripeEvent(JSON.stringify(PI_SUCCEEDED)),
    );
    expect(ev?.type).toBe("payment.succeeded");
    if (ev?.type !== "payment.succeeded") return;
    expect(ev.invoiceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(ev.payment.ref).toBe("pi_fixture_1");
    expect(ev.payment.amountCents).toBe(32500);
    expect(ev.payment.last4).toBe("4242");
    expect(ev.payment.fingerprint).toBe("fp_fixture");
  });

  it("charge.dispute.created → dispute.created with due date and reason", () => {
    const [ev] = normalizeStripeEvent(DISPUTE_CREATED);
    expect(ev?.type).toBe("dispute.created");
    if (ev?.type !== "dispute.created") return;
    expect(ev.dispute.ref).toBe("dp_fixture_1");
    expect(ev.dispute.amountCents).toBe(60000);
    expect(ev.dispute.category).toBe("product_unacceptable");
    expect(ev.dispute.dueBy?.getTime()).toBe((T + 7 * 86400) * 1000);
  });

  it("unknown event types normalize to nothing (stored, ignored)", () => {
    expect(
      normalizeStripeEvent({ type: "customer.created", data: { object: {} } }),
    ).toEqual([]);
  });
});
