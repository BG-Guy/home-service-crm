// PWA install helpers (SPEC §M01 "Install prompt", §12.3).
// - Chromium: capture `beforeinstallprompt` early and replay it on a tap.
// - iOS Safari (not standalone): show "Add to Home Screen" instructions after
//   the 2nd visit; remember dismissal for 30 days.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let initialized = false;

const VISITS = "crm.visits";
const DISMISSED = "crm.install-dismissed";

/** Attach the listeners. Call once, as early as possible (AppProviders does). */
export function initInstallPrompt(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    for (const l of listeners) l();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    for (const l of listeners) l();
  });
}

export function onInstallAvailabilityChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS reports as Mac; touch points give it away.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/** Chromium install prompt available right now. */
export function canPromptInstall(): boolean {
  return deferred != null;
}

/** Show the native Chromium prompt. Returns the outcome (or "unavailable"). */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const e = deferred;
  if (!e) return "unavailable";
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  for (const l of listeners) l();
  return outcome;
}

/** Count this visit once per session; returns the total. */
export function recordVisit(): number {
  try {
    if (sessionStorage.getItem(VISITS)) {
      return Number(localStorage.getItem(VISITS) ?? "1");
    }
    sessionStorage.setItem(VISITS, "1");
    const n = Number(localStorage.getItem(VISITS) ?? "0") + 1;
    localStorage.setItem(VISITS, String(n));
    return n;
  } catch {
    return 1;
  }
}

function dismissedRecently(days = 30): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED) ?? "0");
    return Date.now() - at < days * 86_400_000;
  } catch {
    return false;
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(DISMISSED, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * Which install UI to show automatically: "ios" instructions (2nd+ visit,
 * Safari, not installed), "prompt" (Chromium event captured), or null.
 */
export function installHint(): "ios" | "prompt" | null {
  if (isStandalone() || dismissedRecently()) return null;
  if (deferred) return "prompt";
  if (isIos() && recordVisit() >= 2) return "ios";
  return null;
}
