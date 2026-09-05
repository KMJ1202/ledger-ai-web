// Ledger AI service worker — app-shell cache, network-first for documents and assets.
const CACHE = "ledger-ai-v96";
const SHELL = ["./app.html", "./app.js?v=60", "./index.html", "./manifest.webmanifest", "./icon.svg",
               "./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png",
               "./assets/styles.css?v=47", "./assets/herodemo.js?v=2", "./assets/support-widget.css?v=2", "./assets/support-widget.js?v=1", "./assets/logo-mark-96.png", "./assets/logo-full-640.png", "./assets/icons/quickbooks.svg", "./assets/icons/gmail.svg", "./assets/icons/googlecalendar.svg", "./assets/icons/googlebusiness.svg",
               "./integrations/quickbooks.html", "./integrations/gmail.html",
               "./integrations/google-calendar.html", "./integrations/google-business.html"];

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
  // app.js also carries a ?v= stamp from app.html: a device still running an
  // older cache-first worker never sees a network-first rule, and only a new
  // URL forces it to refetch. Bump the stamp and CACHE together on any deploy
  // that changes app.js.
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

// Web Push (2026-09-02, web parity with the iPhone app). The server encrypts
// {title, body, tag, data} per subscription; a tap opens (or focuses) the app.
self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { body: event.data ? event.data.text() : "" }; }
  const title = p.title || "Ledger";
  const opts = { body: p.body || "", tag: p.tag || undefined, data: p.data || {}, icon: "icon-192.png", badge: "icon-192.png", renotify: !!p.tag };
  event.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const go = (event.notification.data && event.notification.data.go) || "";
  const url = new URL("app.html" + (go ? "?go=" + encodeURIComponent(go) : ""), self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { open.focus(); if (go) open.navigate(url).catch(() => {}); return; }
    return self.clients.openWindow(url);
  }));
});
