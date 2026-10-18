import "server-only";
import { getSecret } from "@/lib/secrets";
import type { EmailProvider } from "../messaging/types";

// Resend driver: plain fetch to https://api.resend.com/emails (no SDK).

export function emailFrom(): string {
  return process.env.EMAIL_FROM || "CRM <onboarding@resend.dev>";
}

export const resendDriver: EmailProvider = {
  name: "resend",
  channel: "email",
  caps: { autoSend: true, inbound: false, mms: false, receipts: false },
  async send(m) {
    const key = await getSecret("RESEND_API_KEY");
    if (!key)
      return {
        status: "failed",
        error: "RESEND_API_KEY not set",
        retryable: false,
      };
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": m.id,
        },
        body: JSON.stringify({
          from: m.meta?.from ?? emailFrom(),
          to: [m.to],
          subject: m.subject ?? "",
          text: m.body,
          ...(m.html ? { html: m.html } : {}),
          ...(m.meta?.reply_to ? { reply_to: m.meta.reply_to } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      return { status: "failed", error: String(err), retryable: true };
    }
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (res.ok) return { status: "sent", providerId: json.id };
    return {
      status: "failed",
      error: json.message ?? `HTTP ${res.status}`,
      retryable: res.status === 429 || res.status >= 500,
    };
  },
};
