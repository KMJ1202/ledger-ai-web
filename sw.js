// Ledger AI service worker — app-shell cache, network-first for documents and assets.
const CACHE = "ledger-ai-v226";
const SHELL = ["./login-offers.js?v=1", "./account-boundary.js?v=3", "./app.html", "./public-recovery.js?v=2", "./security.js?v=7", "./assets/vendor/xlsx-0.20.3.mjs", "./app.js?v=186", "./index.html", "./manifest.webmanifest", "./icon.svg",
               "./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png",
               "./assets/styles.css?v=54", "./assets/herodemo.js?v=2", "./assets/support-widget.css?v=2", "./assets/support-widget.js?v=1", "./assets/logo-mark-96.png", "./assets/logo-full-640.png", "./assets/icons/quickbooks.svg", "./assets/icons/gmail.svg", "./assets/icons/googlecalendar.svg", "./assets/icons/googlebusiness.svg",
               "./integrations/quickbooks.html", "./integrations/gmail.html",
               "./integrations/google-calendar.html", "./integrations/google-business.html"];
// The offline launch is only honest when the app document and the modules it
// imports are all in the new cache. A worker whose precache lost any of these
// (a flaky connection during the update) used to activate anyway and then
// delete the good old cache, leaving the browser's own "no internet" page
// behind (audit 11.4). Now: each shell URL is fetched on its own, a missing
// marketing asset is tolerated, a missing critical file fails the install and
// the previous worker and cache stay in service until the next attempt.
// Derived from SHELL so a deploy that bumps a ?v= stamp cannot leave this list behind.
const CRITICAL = SHELL.filter((url) => /^\.\/(app\.html|app\.js|login-offers\.js|account-boundary\.js|security\.js)(\?|$)/.test(url));

async function precache() {
  const cache = await caches.open(CACHE);
  const results = await Promise.allSettled(SHELL.map((url) => cache.add(url)));
  const missing = SHELL.filter((_, i) => results[i].status === "rejected");
  if (missing.some((url) => CRITICAL.includes(url))) {
    throw new Error("shell precache incomplete: " + missing.filter((url) => CRITICAL.includes(url)).join(", "));
  }
}
async function shellReady() {
  const cache = await caches.open(CACHE);
  const hits = await Promise.all(CRITICAL.map((url) => cache.match(url)));
  return hits.every(Boolean);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Belt and braces: never delete the older caches unless this one can
    // serve the shell on its own.
    if (await shellReady()) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never cache Supabase — auth, books and AI are always live.
  if (url.origin !== self.location.origin) return;

  // Capability links and OAuth/payment returns must never enter an offline cache.
  const privateNavigation = ["t", "token", "token_hash", "code", "session_id"].some(k => url.searchParams.has(k)) || /\/(crew|client|invoice|estimate|track)\.html$/.test(url.pathname) || url.pathname.startsWith("/oauth/");
  if (request.mode === "navigate" && privateNavigation) {
    event.respondWith(fetch(new Request(request, {cache:"no-store"})).catch(() => new Response("This private link needs an internet connection.", {status:503,headers:{"content-type":"text/plain","cache-control":"no-store"}})));
    return;
  }
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

  // Versioned assets are cache-first (Kyle 2026-09-08). A deploy changes the
  // ?v= stamp, so the URL itself is the cache key and a stale copy can never
  // win. This is what makes the second launch instant instead of pulling the
  // whole 600 KB bundle down again before anything paints.
  if (url.searchParams.has("v")) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return response;
      }))
    );
    return;
  }

  // Network-first for everything else same-origin. app.js is part of the shell, so a
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
