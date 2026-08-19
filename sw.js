// Ledger AI service worker — app-shell cache, network-first for documents and assets.
const CACHE = "ledger-ai-v6";
const SHELL = ["./app.html", "./app.js", "./index.html", "./manifest.webmanifest", "./icon.svg",
               "./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never cache Supabase — auth, books and AI are always live.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./app.html")))
    );
    return;
  }

  // Network-first for same-origin assets too. app.js is part of the shell, so a
  // cache-first rule here served a stale bundle against fresh HTML after every
  // deploy until the cache name changed. Cache stays populated for offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
