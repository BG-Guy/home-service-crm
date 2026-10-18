import "server-only";
import webpush from "web-push";
import { appUrl } from "@/lib/env";
import { isAllowedPushEndpoint } from "./endpoints";
import type { PushProvider } from "./types";

// Web Push via VAPID (SPEC §9.6, M22). No-op when VAPID keys are absent (dev).
// Dead subscriptions (404/410) return 'gone' so the caller prunes them.

export type { PushPayload, PushProvider, PushSubscriptionRow } from "./types";

let configured: boolean | null = null;

export function vapidPublicKey(): string | null {
  return (
    process.env.VAPID_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    null
  );
}

function configure(): boolean {
  if (configured !== null) return configured;
  const pub = vapidPublicKey();
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || appUrl(), pub, priv);
  configured = true;
  return true;
}

const webPushProvider: PushProvider = {
  async send(sub, payload) {
    // Rows stored before the endpoint allowlist: never POST to a non-push host.
    if (!isAllowedPushEndpoint(sub.endpoint)) return "gone";
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "normal" },
      );
      return "ok";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 0;
      if (status === 404 || status === 410) return "gone";
      return "retry";
    }
  },
};

const noopProvider: PushProvider = {
  async send(sub, payload) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[push:noop] user=${sub.userId} ${payload.title}${payload.body ? ` — ${payload.body}` : ""}`,
      );
    }
    return "ok";
  },
};

export function pushEnabled(): boolean {
  return configure();
}

export function getPush(): PushProvider {
  return configure() ? webPushProvider : noopProvider;
}
