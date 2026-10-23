// Contact links for a lead (pure, client-safe): call, text, email, directions.
import { useSyncExternalStore } from "react";

/** `/messages/<customer>` when the lead has a customer, else the phone's sms: link. */
export function textHref(l: {
  customerId: string | null;
  phoneE164: string | null;
}): string | null {
  if (l.customerId) return `/messages/${l.customerId}`;
  return l.phoneE164 ? `sms:${l.phoneE164}` : null;
}

/** Navigate deep link: Apple Maps on Apple devices, Google Maps otherwise. */
export function directionsHref(
  l: {
    street: string | null;
    city: string | null;
    zip: string | null;
    lat: number | null;
    lng: number | null;
  },
  apple: boolean,
): string | null {
  const text = [l.street, l.city, l.zip].filter(Boolean).join(", ");
  if (!text && (l.lat == null || l.lng == null)) return null;
  const q = encodeURIComponent(text);
  const at = l.lat != null && l.lng != null ? `${l.lat},${l.lng}` : null;
  if (apple)
    return at
      ? `https://maps.apple.com/?daddr=${at}${text ? `&q=${q}` : ""}`
      : `https://maps.apple.com/?daddr=${q}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${at ?? q}`;
}

const noop = () => () => {};

/** Apple device (Apple Maps links). False on the server and the first render. */
export function useIsApple(): boolean {
  return useSyncExternalStore(
    noop,
    () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent),
    () => false,
  );
}

// One shared clock for every live wait in the inbox (boxes, rings, the card):
// a single 15 s interval, started by the first subscriber. Null on the server
// and during hydration, so server and client render the same text.
let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const f of subs) f();
    }, 15_000);
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!now) now = Date.now();
      return now;
    },
    () => null,
  );
}

/** "4 min", "1 h 20 min", "2 d". */
export function waitLabel(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Copy to the clipboard; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A CSS media query (false on the server and during hydration). */
const mqSubs = new Map<string, (cb: () => void) => () => void>();
function mqSubscribe(query: string) {
  let f = mqSubs.get(query);
  if (!f) {
    f = (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    };
    mqSubs.set(query, f);
  }
  return f;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    mqSubscribe(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}
