// Web Push endpoints we accept (QA T5-20): the server later POSTs to the stored
// URL, so only the browser vendors' push services qualify, never an arbitrary
// https host. PUSH_ENDPOINT_HOSTS (comma-separated host suffixes) adds more,
// e.g. for a self-hosted push service. Pure; tested in tests/lib.

const VENDOR_HOST_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Edge (Chromium), Android
  "android.googleapis.com", // legacy GCM endpoints
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // legacy Edge / Windows
  "push.apple.com", // Safari, iOS home-screen apps
];

function suffixes(): string[] {
  const extra = (process.env.PUSH_ENDPOINT_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...VENDOR_HOST_SUFFIXES, ...extra];
}

/** https, default port, and a host equal to or under a known push service. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password)
    return false;
  const host = u.hostname.toLowerCase();
  return suffixes().some((s) => host === s || host.endsWith(`.${s}`));
}
