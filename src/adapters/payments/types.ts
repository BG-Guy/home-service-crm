// Payments adapter interface (SPEC §9.2) — FROZEN.
export type EntryMode =
  | "tap"
  | "chip"
  | "swipe"
  | "keyed"
  | "online"
  | "wallet"
  | "cash"
  | "check"
  | "p2p";
export interface PayLine {
  name: string;
  description?: string;
  amountCents: number;
  qty: number;
}
export interface PaymentSnapshot {
  ref: string;
  status: "authorized" | "succeeded" | "failed" | "canceled";
  amountCents: number;
  tipCents?: number;
  feeCents?: number;
  entryMode: EntryMode;
  brand?: string;
  funding?: string;
  last4?: string;
  fingerprint?: string;
  avs?: string;
  cvc?: string;
  threeDS?: string;
  wallet?: string;
  ip?: string;
  captureBefore?: Date;
  capturedAt?: Date;
  raw?: unknown;
}
export interface RefundSnapshot {
  ref: string;
  status: "pending" | "succeeded" | "failed";
  amountCents: number;
}
export type NormalizedEvent =
  | {
      type:
        | "payment.succeeded"
        | "payment.authorized"
        | "payment.failed"
        | "payment.canceled";
      payment: PaymentSnapshot;
      invoiceId?: string;
      depositRequestId?: string;
    }
  | { type: "refund.updated"; refund: RefundSnapshot; paymentRef: string }
  | {
      type:
        | "dispute.created"
        | "dispute.updated"
        | "dispute.closed"
        | "dispute.funds_withdrawn"
        | "dispute.funds_reinstated";
      dispute: {
        ref: string;
        paymentRef: string;
        category: string;
        networkCode?: string;
        amountCents: number;
        status: string;
        dueBy?: Date;
        outcome?: string;
      };
    }
  | {
      type: "efw.created";
      paymentRef: string;
      amountCents: number;
      fraudType?: string;
    };
export interface NormalizedEvidence {
  // Stripe field names are canonical
  customer_name?: string;
  customer_email_address?: string;
  customer_purchase_ip?: string;
  billing_address?: string;
  product_description?: string;
  service_date?: string;
  cancellation_policy_disclosure?: string;
  cancellation_rebuttal?: string;
  refund_policy_disclosure?: string;
  refund_refusal_explanation?: string;
  duplicate_charge_id?: string;
  duplicate_charge_explanation?: string;
  uncategorized_text?: string;
  files?: Partial<
    Record<
      | "customer_signature"
      | "service_documentation"
      | "customer_communication"
      | "receipt"
      | "refund_policy"
      | "cancellation_policy"
      | "duplicate_charge_documentation"
      | "access_activity_log"
      | "uncategorized_file",
      {
        bytes: Uint8Array;
        filename: string;
        mime: "application/pdf" | "image/jpeg" | "image/png";
      }
    >
  >;
}
export interface PaymentProvider {
  id: "stripe" | "square" | "manual";
  caps: {
    links: boolean;
    authHold: boolean;
    cardPresent: "none" | "reader" | "app-switch";
    savedCards: boolean;
    ach: boolean;
    disputesApi: boolean;
    tips: boolean;
  };
  createPayLink?(i: {
    invoiceId?: string;
    depositRequestId?: string;
    lines: PayLine[];
    amountCents: number;
    customer: { name: string; email?: string; phone?: string };
    serviceAddress: {
      line1: string;
      city: string;
      state: string;
      postal_code: string;
    };
    descriptorSuffix: string;
    mode: "capture" | "hold" | "save";
    require3DS?: boolean;
    allowTip?: boolean;
    successUrl: string;
    cancelUrl: string;
    expiresInMinutes: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ url: string; ref: string; expiresAt: Date }>;
  startCardPresent?(i: {
    amountCents: number;
    invoiceId: string;
  }): Promise<{ launchUrl?: string; ref: string }>;
  capture?(ref: string, amountCents?: number): Promise<PaymentSnapshot>;
  cancelHold?(ref: string): Promise<void>;
  chargeSaved?(
    customerRef: string,
    amountCents: number,
    idem: string,
  ): Promise<PaymentSnapshot>;
  refund(
    ref: string,
    amountCents: number,
    reason: string,
    idem: string,
  ): Promise<RefundSnapshot>;
  fetchFee?(ref: string): Promise<number>;
  /**
   * The payment as the processor has it now, charge expanded (QA2 addition, optional):
   * the actual fee (`feeCents`, undefined while the processor hasn't settled it) and the
   * card snapshot that webhook payloads don't carry (their charge is only an id).
   */
  retrievePayment?(ref: string): Promise<PaymentSnapshot>;
  verifyWebhook?(rawBody: string, headers: Headers): Promise<NormalizedEvent[]>;
  disputes?: {
    stage(disputeRef: string, ev: NormalizedEvidence): Promise<void>;
    submit(disputeRef: string): Promise<void>;
    accept(disputeRef: string): Promise<void>;
  };
}
