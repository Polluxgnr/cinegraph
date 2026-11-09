// CineGraph service worker. Works under any base path (GitHub Pages serves /<repo>/).
// - app shell: network first, cached copy offline
// - catalogue (/data/*): stale-while-revalidate, so the app opens instantly and offline
// - images (TMDB, Wikimedia, YouTube, TheMealDB, Deezer): cache first
const VERSION = "v2";
const SHELL = `cg-shell-${VERSION}`;
const DATA = `cg-data-${VERSION}`;
const IMAGES = `cg-img-${VERSION}`;
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const IMAGE_HOSTS = ["image.tmdb.org", "upload.wikimedia.org", "commons.wikimedia.org", "i.ytimg.com", "www.themealdb.com", "e-cdns-images.dzcdn.net", "cdn-images.dzcdn.net"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll([`${BASE}/`, `${BASE}/manifest.webmanifest`])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, IMAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const net = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(IMAGES).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(`${BASE}/data/`)) {
    event.respondWith(staleWhileRevalidate(DATA, req));
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === "navigate" || url.pathname.includes("/_next/static/"))) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match(`${BASE}/`))),
  );
});
