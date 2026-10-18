// Web Push subscription helper (SPEC §9.6, §8.1 POST/DELETE /api/push/subscribe).
// iOS only supports push for installed (Home Screen) PWAs, 16.4+.

import { isIos, isStandalone } from "./install-prompt";

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "needs-install" | "denied" };

export function pushSupport(): PushSupport {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return isIos() && !isStandalone()
      ? { ok: false, reason: "needs-install" }
      : { ok: false, reason: "unsupported" };
  }
  if (Notification.permission === "denied")
    return { ok: false, reason: "denied" };
  return { ok: true };
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** The current subscription (no prompt), or null. */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupport().ok) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Ask permission (call from a tap), subscribe with the VAPID public key and
 * register the subscription with the server.
 */
export async function subscribePush(
  vapidPublicKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const support = pushSupport();
  if (!support.ok) return { ok: false, error: support.reason };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, error: "denied" };
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }));
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        subscription: sub.toJSON(),
        userAgent: navigator.userAgent,
      }),
    });
    if (!res.ok) return { ok: false, error: `Server error (${res.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Subscribe failed" };
  }
}

/** Unsubscribe locally and on the server. */
export async function unsubscribePush(): Promise<void> {
  const sub = await getPushSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}
