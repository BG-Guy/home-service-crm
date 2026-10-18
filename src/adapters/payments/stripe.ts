import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSecret } from "@/lib/secrets";
import type {
  EntryMode,
  NormalizedEvent,
  NormalizedEvidence,
  PaymentProvider,
  PaymentSnapshot,
  RefundSnapshot,
} from "./types";

// Stripe over plain REST (SPEC §9.2, M09): application/x-www-form-urlencoded via
// toForm(), pinned Stripe-Version, Idempotency-Key header. No SDK.

const API = "https://api.stripe.com/v1";
const FILES_API = "https://files.stripe.com/v1/files";
export const STRIPE_API_VERSION =
  process.env.STRIPE_API_VERSION || "2025-09-30.clover";
export const WEBHOOK_TOLERANCE_SEC = 300;

type FormValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | FormValue[]
  | { [k: string]: FormValue };

/** Nested object → Stripe form encoding: a[b][0][c]=1. */
export function toForm(
  obj: Record<string, FormValue>,
  prefix = "",
): URLSearchParams {
  const out = new URLSearchParams();
  const walk = (value: FormValue, key: string) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const [i, v] of value.entries()) walk(v, `${key}[${i}]`);
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value))
        walk(v, key ? `${key}[${k}]` : k);
    } else {
      out.append(key, String(value));
    }
  };
  for (const [k, v] of Object.entries(obj))
    walk(v, prefix ? `${prefix}[${k}]` : k);
  return out;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

async function stripe<T = Record<string, unknown>>(
  path: string,
  init: {
    method?: "GET" | "POST" | "DELETE";
    form?: Record<string, FormValue>;
    idem?: string;
  } = {},
): Promise<T> {
  const key = await getSecret("STRIPE_SECRET_KEY");
  if (!key)
    throw new StripeError(
      "STRIPE_SECRET_KEY is not configured",
      500,
      "not_configured",
    );
  const method = init.method ?? (init.form ? "POST" : "GET");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (init.idem) headers["Idempotency-Key"] = init.idem;
  let body: string | undefined;
  if (init.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = toForm(init.form).toString();
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string };
  } & T;
  if (!res.ok)
    throw new StripeError(
      json.error?.message ?? `Stripe HTTP ${res.status}`,
      res.status,
      json.error?.code,
    );
  return json;
}

// ------------------------------------------------------------------ snapshots

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function entryModeOf(pmd: Obj): EntryMode {
  const card = obj(pmd.card);
  const present = obj(pmd.card_present);
  if (pmd.type === "card_present" || pmd.card_present) {
    return str(present.read_method)?.includes("contactless") ? "tap" : "chip";
  }
  if (card.wallet) return "wallet";
  if (pmd.type === "us_bank_account") return "online";
  return "online";
}

/**
 * PaymentIntent (with latest_charge expanded or not) → PaymentSnapshot. Real webhook
 * payloads carry `latest_charge` as an id string: the card fields and fee are then
 * undefined and the `stripe_fee` worker fills them from retrievePayment().
 */
export function snapshotFromPaymentIntent(pi: Obj): PaymentSnapshot {
  const charge =
    typeof pi.latest_charge === "string" ? {} : obj(pi.latest_charge);
  const pmd = obj(charge.payment_method_details);
  const card = obj(pmd.card ?? pmd.card_present);
  const checks = obj(card.checks);
  const status = str(pi.status);
  const mapped: PaymentSnapshot["status"] =
    status === "succeeded"
      ? "succeeded"
      : status === "requires_capture"
        ? "authorized"
        : status === "canceled"
          ? "canceled"
          : "failed";
  const captureBefore = num(card.capture_before);
  const bt = obj(charge.balance_transaction);
  return {
    ref: str(pi.id) ?? "",
    status: mapped,
    amountCents: num(pi.amount_received) || num(pi.amount),
    feeCents: typeof bt.fee === "number" ? bt.fee : undefined,
    entryMode: entryModeOf(pmd),
    brand: str(card.brand),
    funding: str(card.funding),
    last4: str(card.last4),
    fingerprint: str(card.fingerprint),
    avs: str(checks.address_postal_code_check),
    cvc: str(checks.cvc_check),
    threeDS: str(obj(card.three_d_secure).result),
    wallet: str(obj(card.wallet).type),
    captureBefore: captureBefore ? new Date(captureBefore * 1000) : undefined,
    capturedAt:
      mapped === "succeeded" && charge.created
        ? new Date(num(charge.created) * 1000)
        : undefined,
    raw: pi,
  };
}

function refundSnapshot(r: Obj): RefundSnapshot {
  const s = str(r.status);
  return {
    ref: str(r.id) ?? "",
    status:
      s === "succeeded"
        ? "succeeded"
        : s === "failed" || s === "canceled"
          ? "failed"
          : "pending",
    amountCents: num(r.amount),
  };
}

// ------------------------------------------------------------------ webhooks

/** Verify a `Stripe-Signature` header (HMAC-SHA256 over `${t}.${body}`, 5-min tolerance). */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = WEBHOOK_TOLERANCE_SEC,
): boolean {
  if (!header) return false;
  let t = 0;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t" && v) t = Number(v);
    if (k === "v1" && v) v1.push(v);
  }
  if (!t || v1.length === 0 || Math.abs(nowSec - t) > toleranceSec)
    return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"),
  );
  return v1.some((sig) => {
    const b = Buffer.from(sig);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

/** Parse a verified webhook body (for the event id → webhook_events idempotency). */
export function parseStripeEvent(rawBody: string): {
  id: string;
  type: string;
  data: { object: Obj };
} {
  return JSON.parse(rawBody) as {
    id: string;
    type: string;
    data: { object: Obj };
  };
}

/** Stripe event → normalized events (unknown types → []). */
export function normalizeStripeEvent(evt: {
  type: string;
  data: { object: Obj };
}): NormalizedEvent[] {
  const o = evt.data.object;
  const md = obj(o.metadata);
  const ids = {
    invoiceId: str(md.invoice_id),
    depositRequestId: str(md.deposit_request_id),
  };
  switch (evt.type) {
    case "checkout.session.completed": {
      if (o.payment_status !== "paid" || !o.payment_intent) return [];
      const pi =
        typeof o.payment_intent === "object"
          ? obj(o.payment_intent)
          : { id: o.payment_intent };
      const snap = snapshotFromPaymentIntent({
        status: "succeeded",
        amount: o.amount_total,
        ...pi,
      });
      return [{ type: "payment.succeeded", payment: snap, ...ids }];
    }
    case "payment_intent.succeeded":
      return [
        {
          type: "payment.succeeded",
          payment: snapshotFromPaymentIntent(o),
          ...ids,
        },
      ];
    case "payment_intent.amount_capturable_updated":
      return [
        {
          type: "payment.authorized",
          payment: snapshotFromPaymentIntent(o),
          ...ids,
        },
      ];
    case "payment_intent.payment_failed":
      return [
        {
          type: "payment.failed",
          payment: { ...snapshotFromPaymentIntent(o), status: "failed" },
          ...ids,
        },
      ];
    case "payment_intent.canceled":
      return [
        {
          type: "payment.canceled",
          payment: { ...snapshotFromPaymentIntent(o), status: "canceled" },
          ...ids,
        },
      ];
    case "charge.refunded":
    case "charge.refund.updated": {
      const paymentRef =
        str(o.payment_intent) ?? str(o.charge) ?? str(o.id) ?? "";
      if (evt.type === "charge.refund.updated") {
        return [
          { type: "refund.updated", refund: refundSnapshot(o), paymentRef },
        ];
      }
      const list = (obj(o.refunds).data as Obj[] | undefined) ?? [];
      if (list.length === 0) {
        return [
          {
            type: "refund.updated",
            refund: {
              ref: `${str(o.id)}:refund`,
              status: "succeeded",
              amountCents: num(o.amount_refunded),
            },
            paymentRef,
          },
        ];
      }
      return list.map((r) => ({
        type: "refund.updated" as const,
        refund: refundSnapshot(r),
        paymentRef,
      }));
    }
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated": {
      const type = evt.type.replace("charge.", "") as
        | "dispute.created"
        | "dispute.updated"
        | "dispute.closed"
        | "dispute.funds_withdrawn"
        | "dispute.funds_reinstated";
      const dueBy = num(obj(o.evidence_details).due_by);
      const status = str(o.status) ?? "";
      return [
        {
          type,
          dispute: {
            ref: str(o.id) ?? "",
            paymentRef: str(o.payment_intent) ?? str(o.charge) ?? "",
            category: str(o.reason) ?? "general",
            networkCode: str(
              obj(o.payment_method_details).card
                ? obj(obj(o.payment_method_details).card).network_reason_code
                : undefined,
            ),
            amountCents: num(o.amount),
            status,
            dueBy: dueBy ? new Date(dueBy * 1000) : undefined,
            outcome: status === "won" || status === "lost" ? status : undefined,
          },
        },
      ];
    }
    case "radar.early_fraud_warning.created":
      return [
        {
          type: "efw.created",
          paymentRef: str(o.payment_intent) ?? str(o.charge) ?? "",
          amountCents: num(o.amount),
          fraudType: str(o.fraud_type),
        },
      ];
    default:
      return [];
  }
}

// ------------------------------------------------------------------ provider

async function uploadEvidenceFile(f: {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}): Promise<string> {
  const key = await getSecret("STRIPE_SECRET_KEY");
  if (!key)
    throw new StripeError(
      "STRIPE_SECRET_KEY is not configured",
      500,
      "not_configured",
    );
  const fd = new FormData();
  fd.append("purpose", "dispute_evidence");
  fd.append(
    "file",
    new Blob([new Uint8Array(f.bytes)], { type: f.mime }),
    f.filename,
  );
  const res = await fetch(FILES_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": STRIPE_API_VERSION,
    },
    body: fd,
  });
  const json = (await res.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.id)
    throw new StripeError(
      json.error?.message ?? "file upload failed",
      res.status,
    );
  return json.id;
}

/** GET the PaymentIntent with its charge and balance transaction expanded. */
async function retrievePaymentIntent(ref: string): Promise<PaymentSnapshot> {
  const pi = await stripe<Obj>(
    `/payment_intents/${encodeURIComponent(ref)}?expand[]=latest_charge.balance_transaction`,
  );
  return snapshotFromPaymentIntent(pi);
}

export const stripeProvider: PaymentProvider = {
  id: "stripe",
  caps: {
    links: true,
    authHold: true,
    cardPresent: "none",
    savedCards: false,
    ach: false,
    disputesApi: true,
    tips: true,
  },

  async createPayLink(i) {
    const linesTotal = i.lines.reduce((s, l) => s + l.amountCents * l.qty, 0);
    const lines =
      linesTotal === i.amountCents && i.lines.length > 0
        ? i.lines
        : [
            {
              name: i.lines[0]?.name ?? "Payment",
              amountCents: i.amountCents,
              qty: 1,
            },
          ];
    const expiresAt = new Date(
      Date.now() + Math.max(30, i.expiresInMinutes) * 60_000,
    );
    const metadata = {
      ...i.metadata,
      ...(i.invoiceId ? { invoice_id: i.invoiceId } : {}),
      ...(i.depositRequestId ? { deposit_request_id: i.depositRequestId } : {}),
    };
    const form: Record<string, FormValue> = {
      mode: i.mode === "save" ? "setup" : "payment",
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      customer_email: i.customer.email,
      metadata,
      payment_method_types: ["card"],
      payment_method_options: i.require3DS
        ? { card: { request_three_d_secure: "any" } }
        : undefined,
    };
    if (i.mode !== "save") {
      form.line_items = lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: "usd",
          unit_amount: l.amountCents,
          product_data: {
            name: l.name.slice(0, 250),
            description: l.description?.slice(0, 500),
          },
        },
      }));
      form.payment_intent_data = {
        capture_method: i.mode === "hold" ? "manual" : "automatic",
        statement_descriptor_suffix: i.descriptorSuffix.slice(0, 22),
        metadata,
        shipping: {
          name: i.customer.name,
          phone: i.customer.phone,
          address: { ...i.serviceAddress, country: "US" },
        },
      };
    } else {
      form.currency = "usd";
      form.setup_intent_data = { metadata };
    }
    const session = await stripe<{
      id: string;
      url: string;
      expires_at: number;
    }>("/checkout/sessions", {
      form,
      idem: i.idempotencyKey,
    });
    return {
      url: session.url,
      ref: session.id,
      expiresAt: new Date(session.expires_at * 1000),
    };
  },

  async capture(ref, amountCents) {
    const pi = await stripe<Obj>(`/payment_intents/${ref}/capture`, {
      form: { amount_to_capture: amountCents, expand: ["latest_charge"] },
      idem: `capture:${ref}:${amountCents ?? "full"}`,
    });
    return snapshotFromPaymentIntent(pi);
  },

  async cancelHold(ref) {
    await stripe(`/payment_intents/${ref}/cancel`, {
      form: {},
      idem: `cancel:${ref}`,
    });
  },

  async refund(ref, amountCents, reason, idem) {
    const field = ref.startsWith("ch_") ? "charge" : "payment_intent";
    const r = await stripe<Obj>("/refunds", {
      form: {
        [field]: ref,
        amount: amountCents,
        reason: "requested_by_customer",
        metadata: { reason: reason.slice(0, 450) },
      },
      idem,
    });
    return refundSnapshot(r);
  },

  async fetchFee(ref) {
    return (await retrievePaymentIntent(ref)).feeCents ?? 0;
  },

  async retrievePayment(ref) {
    return retrievePaymentIntent(ref);
  },

  async verifyWebhook(rawBody, headers) {
    const secret = await getSecret("STRIPE_WEBHOOK_SECRET");
    if (!secret)
      throw new StripeError(
        "STRIPE_WEBHOOK_SECRET is not configured",
        500,
        "not_configured",
      );
    if (
      !verifyStripeSignature(rawBody, headers.get("stripe-signature"), secret)
    ) {
      throw new StripeError("Invalid Stripe signature", 400, "bad_signature");
    }
    return normalizeStripeEvent(parseStripeEvent(rawBody));
  },

  disputes: {
    async stage(disputeRef: string, ev: NormalizedEvidence) {
      const { files, ...text } = ev;
      const evidence: Record<string, FormValue> = { ...text };
      for (const [field, f] of Object.entries(files ?? {})) {
        if (f) evidence[field] = await uploadEvidenceFile(f);
      }
      await stripe(`/disputes/${disputeRef}`, {
        form: { evidence, submit: false },
      });
    },
    async submit(disputeRef: string) {
      await stripe(`/disputes/${disputeRef}`, { form: { submit: true } });
    },
    async accept(disputeRef: string) {
      await stripe(`/disputes/${disputeRef}/close`, { form: {} });
    },
  },
};
