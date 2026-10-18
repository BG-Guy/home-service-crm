import "server-only";
import { getEmail } from "../email";
import { androidGatewayDriver } from "./android-gateway";
import { consoleSmsDriver } from "./console";
import { linkDriver } from "./link";
import type { Channel, MessagingDriver, SmsProvider } from "./types";
import { whatsappLinkDriver } from "./whatsapp-link";

// Messaging adapter registry (SPEC §9.1, §9.7). Drivers self-register by name; the
// SMS driver is chosen by MESSAGING_SMS_DRIVER (default `link`). Only B5's sender
// (and F's auth emails) call drivers; features go through enqueueMessage().

export { buildSmsHref, buildWhatsAppHref } from "./href";
export type {
  Channel,
  InboundMessage,
  MessagingDriver,
  OutboundMessage,
  Purpose,
  SendResult,
  SmsProvider,
  StatusUpdate,
} from "./types";

type Loader = () => SmsProvider | Promise<SmsProvider>;

/** Placeholder for a provider that isn't built yet: fails loudly with guidance. */
function laterDriver(name: string): SmsProvider {
  throw new Error(
    `The "${name}" SMS driver isn't built yet. Set MESSAGING_SMS_DRIVER=link (free, tap-to-send) or add src/adapters/messaging/${name}.ts (SPEC §9.7).`,
  );
}
const smsDrivers = new Map<string, Loader>([
  ["link", () => linkDriver],
  ["console", () => consoleSmsDriver],
  ["android_gateway", () => androidGatewayDriver],
  // Paid drivers are Later (SPEC M12): the interface is ready (send/parseInbound/
  // parseStatus/verifyWebhook) — add src/adapters/messaging/<name>.ts and register it.
  ["twilio", () => laterDriver("twilio")],
  ["telnyx", () => laterDriver("telnyx")],
]);

/** Register (or replace) an SMS driver: registerSmsDriver('telnyx', () => import('./telnyx').then(m => m.driver)). */
export function registerSmsDriver(name: string, loader: Loader): void {
  smsDrivers.set(name, loader);
}

export function smsDriverName(): string {
  return process.env.MESSAGING_SMS_DRIVER || "link";
}

export async function getSmsDriver(
  name = smsDriverName(),
): Promise<SmsProvider> {
  const loader = smsDrivers.get(name);
  if (!loader)
    throw new Error(`Unknown SMS driver "${name}" (MESSAGING_SMS_DRIVER)`);
  return loader();
}

/** Driver for a channel (sms → configured SMS driver; whatsapp → wa.me link; email → email adapter). */
export async function getMessaging(channel: Channel): Promise<MessagingDriver> {
  switch (channel) {
    case "sms":
      return getSmsDriver();
    case "whatsapp":
      return whatsappLinkDriver;
    case "email":
      return getEmail();
    case "push":
      throw new Error(
        "Push is delivered via getPush() (src/adapters/push) per subscription",
      );
  }
}
