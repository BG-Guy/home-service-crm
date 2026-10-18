// Messaging adapter interface (SPEC §9.1) — FROZEN. SMS / WhatsApp / email / push share one shape.
export type Channel = "sms" | "whatsapp" | "email" | "push";
export type Purpose = "transactional" | "marketing" | "review" | "internal";
export interface OutboundMessage {
  id: string; // scheduled_messages.id or messages.id
  to: string; // E.164 | email | user id (push)
  channel: Channel;
  purpose: Purpose;
  body: string;
  subject?: string;
  html?: string;
  mediaUrls?: string[];
  expiresAt?: Date;
  meta?: Record<string, string>; // job_id, customer_id for provider tagging
}
export type SendResult =
  | { status: "sent"; providerId?: string }
  | { status: "needs_human"; href: string } // link drivers → outbox pending_tap
  | { status: "failed"; error: string; retryable: boolean };
export interface InboundMessage {
  from: string;
  to?: string;
  body: string;
  media?: string[];
  providerId?: string;
  receivedAt: Date;
}
export interface StatusUpdate {
  providerId: string;
  status: "sent" | "delivered" | "failed" | "undelivered";
  error?: string;
}
export interface MessagingDriver {
  name:
    | "link"
    | "whatsapp_link"
    | "console"
    | "android_gateway"
    | "twilio"
    | "telnyx"
    | "resend"
    | "smtp"
    | "webpush";
  channel: Channel;
  caps: {
    autoSend: boolean;
    inbound: boolean;
    mms: boolean;
    receipts: boolean;
  };
  send(m: OutboundMessage): Promise<SendResult>;
  parseInbound?(req: Request): Promise<InboundMessage | null>;
  parseStatus?(req: Request): Promise<StatusUpdate | null>;
  verifyWebhook?(req: Request, rawBody: string): Promise<boolean>;
}
export type SmsProvider = MessagingDriver & { channel: "sms" };
export type EmailProvider = MessagingDriver & { channel: "email" };
