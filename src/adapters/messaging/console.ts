import "server-only";
import type { SmsProvider } from "./types";

/** Development driver: logs the message and reports it sent. */
export const consoleSmsDriver: SmsProvider = {
  name: "console",
  channel: "sms",
  caps: { autoSend: true, inbound: false, mms: false, receipts: false },
  async send(m) {
    console.info(`[sms:console] to=${m.to} purpose=${m.purpose}\n${m.body}`);
    return { status: "sent", providerId: `console-${m.id}` };
  },
};
