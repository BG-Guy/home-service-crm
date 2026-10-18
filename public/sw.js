/* Service worker (SPEC §12.3). Hand-written, no Workbox.
 * - Precaches the offline page and the PWA icons.
 * - Navigations: network-first; offline → the cached /offline page. Authenticated
 *   HTML is never cached (no stale private data after sign-out).
 * - Hashed build assets (/_next/static/*): cache-first (they are immutable).
 * - Web Push: `push` shows the notification; `notificationclick` focuses or opens the app.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL && k !== STATIC)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cached = await caches.match(OFFLINE_URL, { ignoreSearch: true });
        return (
          cached ||
          new Response("You're offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }
  const title = data.title || "New notification";
  const tasks = [
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/notifications" },
    }),
  ];
  if (typeof data.badge === "number" && "setAppBadge" in self.navigator) {
    tasks.push(self.navigator.setAppBadge(data.badge).catch(() => undefined));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  );
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (
            new URL(client.url).origin === target.origin &&
            "focus" in client
          ) {
            return client
              .focus()
              .then((c) =>
                c && "navigate" in c ? c.navigate(target.href) : c,
              );
          }
        }
        return self.clients.openWindow(target.href);
      }),
  );
});
