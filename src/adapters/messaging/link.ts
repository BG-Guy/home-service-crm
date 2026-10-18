import "server-only";
import { buildSmsHref } from "./href";
import type { SmsProvider } from "./types";

/** Default free SMS driver: a human taps an `sms:` link from the outbox (pending_tap). */
export const linkDriver: SmsProvider = {
  name: "link",
  channel: "sms",
  caps: { autoSend: false, inbound: false, mms: false, receipts: false },
  async send(m) {
    return { status: "needs_human", href: buildSmsHref(m.to, m.body) };
  },
};
