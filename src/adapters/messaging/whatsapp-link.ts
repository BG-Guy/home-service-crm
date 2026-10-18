import "server-only";
import { buildWhatsAppHref } from "./href";
import type { MessagingDriver } from "./types";

/** Free WhatsApp driver: wa.me deep link tapped from the outbox. */
export const whatsappLinkDriver: MessagingDriver = {
  name: "whatsapp_link",
  channel: "whatsapp",
  caps: { autoSend: false, inbound: false, mms: false, receipts: false },
  async send(m) {
    return { status: "needs_human", href: buildWhatsAppHref(m.to, m.body) };
  },
};
