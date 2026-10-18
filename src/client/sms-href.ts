// `sms:` deep links for the free "link" SMS driver (SPEC §M12, §9.1).
// Apple devices use `&body=`, others `?body=`. A per-device override
// ("?", "&", "?&") is stored in localStorage and set from Settings, with a
// "send test to myself" button there. Bodies are always URI-encoded. Never
// multi-recipient links. Safe to import on the server (no top-level DOM access).

export type SmsSeparator = "?" | "&" | "?&";

const KEY = "crm.sms-separator";

export function getSmsSeparatorOverride(): SmsSeparator | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "?" || v === "&" || v === "?&" ? v : null;
  } catch {
    return null;
  }
}

/** Persist (or clear with null) this device's separator override. */
export function setSmsSeparatorOverride(sep: SmsSeparator | null): void {
  try {
    if (sep) localStorage.setItem(KEY, sep);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

export function isAppleUA(ua: string): boolean {
  return /iPhone|iPad|iPod|Macintosh/.test(ua);
}

/**
 * Build an `sms:` link with a prefilled body.
 * @param e164 one recipient in E.164 ("+15551234567").
 * @param override separator; defaults to this device's stored override, then UA detection.
 */
export function smsHref(
  e164: string,
  body: string,
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
  override?: SmsSeparator,
): string {
  const to = e164.replace(/[^\d+]/g, "");
  if (!body) return `sms:${to}`;
  const sep =
    override ??
    (typeof window !== "undefined" ? getSmsSeparatorOverride() : null) ??
    (isAppleUA(ua) ? "&" : "?");
  return `sms:${to}${sep}body=${encodeURIComponent(body)}`;
}

/** WhatsApp click-to-chat link. */
export const waHref = (e164: string, body: string) =>
  `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(body)}`;

/** `tel:` link. */
export const telHref = (e164: string) => `tel:${e164.replace(/[^\d+]/g, "")}`;
