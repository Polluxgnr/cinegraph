// CineGraph service worker: offline app shell + cached posters. API calls always go to the network.
const SHELL = "cinegraph-shell-v1";
const IMAGES = "cinegraph-posters-v1";
const SHELL_URLS = ["/", "/swipe", "/tonight", "/watchlist", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL, IMAGES].includes(k)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return; // live data only

  if (url.hostname === "image.tmdb.org") {
    event.respondWith(
      caches.open(IMAGES).then(async (c) => {
        const hit = await c.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok || res.type === "opaque") c.put(event.request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // network first, fall back to the cached shell when offline
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok && (event.request.mode === "navigate" || url.pathname.startsWith("/_next/static/"))) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match("/"))),
    );
  }
});
