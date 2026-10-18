// Deep links for link-mode drivers. The client helper (src/client/sms-href.ts, B5)
// picks the separator from the user agent; the server uses the universal `?&` form
// that iOS and Android both accept. Bodies are always encodeURIComponent'd.
export type SmsSeparator = "?" | "&" | "?&";

export function buildSmsHref(
  e164: string,
  body: string,
  sep: SmsSeparator = "?&",
): string {
  return `sms:${e164}${sep}body=${encodeURIComponent(body)}`;
}

export function buildWhatsAppHref(e164: string, body: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(body)}`;
}
