import "server-only";
import type { EmailProvider } from "../messaging/types";

/** Development email driver: prints the message (links included) to the server log. */
export const consoleEmailDriver: EmailProvider = {
  name: "smtp",
  channel: "email",
  caps: { autoSend: true, inbound: false, mms: false, receipts: false },
  async send(m) {
    console.info(
      `[email:console] to=${m.to} subject=${JSON.stringify(m.subject ?? "")}\n${m.body}`,
    );
    return { status: "sent", providerId: `console-${m.id}` };
  },
};
