// CineGraph service worker. Works under any base path (GitHub Pages serves /<repo>/).
// - app shell: network first, cached copy offline
// - catalogue: manifest network first; other files are requested as <file>?v=<built_at>, cached first under that
//   exact URL (older versions of the same file are dropped), so a new export always arrives whole
// - images (TMDB, Wikimedia, YouTube, TheMealDB, Deezer): cache first
const VERSION = "v3";
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

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function versionedData(request) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    // one cached copy per file: forget the previous export's version, keep this one
    for (const old of await cache.keys(request, { ignoreSearch: true })) await cache.delete(old);
    await cache.put(request, res.clone());
  }
  return res;
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
    event.respondWith(url.searchParams.has("v") ? versionedData(req) : networkFirst(DATA, req));
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
