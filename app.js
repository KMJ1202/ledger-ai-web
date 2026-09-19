import { pendingOffer, saveOffer, clearOffer, bindOffer } from "./login-offers.js?v=1";
import { createAccountBoundary } from "./account-boundary.js?v=3";
import { openSecurity, needsMfa } from "./security.js?v=4";
// Ledger AI — web/PWA client.
// audit-20260914 web: calendar guard, outage bubble, CSV screens, copy sweep (build 170)
// One file, no build step: GitHub Pages serves it straight. Every screen talks to the
// same Supabase edge functions the iOS app uses, so there is no second backend to keep in sync.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const SUPA_URL = "https://lbzkyyehmgudlxmfpzzh.supabase.co";
const SUPA_KEY = "sb_publishable_I0BQ5Rkc2GCxKOlobtzCNg_GxAtNuPu";
const supa = createClient(SUPA_URL, SUPA_KEY, {auth:{flowType:"pkce",detectSessionInUrl:false}});
const FN = SUPA_URL + "/functions/v1";
const root = document.getElementById("root");
const accountBoundary = createAccountBoundary({ storage: window.localStorage, onInvalidate: () => {
  clearOffer();
  // Synchronously remove all old-account pixels, including sheets outside root.
  document.documentElement.style.visibility = "hidden";
  root.replaceChildren();
  document.querySelectorAll("dialog, #sheetwrap, #stackwrap, #pickwrap, #ledger-security").forEach(node => node.remove());
  WAKE.ready = false; wakeStop();
  try { LIVE?.mic?.getTracks().forEach(track => track.stop()); LIVE?.dc?.close(); LIVE?.pc?.close(); LIVE?.audio?.pause(); } catch {}
  for (const key of Object.keys(S)) delete S[key];
  // A new document also destroys suspended timers, closures, media and requests.
  location.reload();
}});
const accountStorage = accountBoundary.accountStorage;
const authStorageKey = "sb-lbzkyyehmgudlxmfpzzh-auth-token";
window.addEventListener("storage", event => {
  if (event.key !== authStorageKey && event.key !== null) return;
  let session = null;
  try { session = JSON.parse(window.localStorage.getItem(authStorageKey) || "null"); } catch {}
  if (accountBoundary.identity && accountBoundary.sessionIdentity(session) !== accountBoundary.identity) accountBoundary.invalidate();
});
window.addEventListener("pagehide", () => { document.documentElement.style.visibility = "hidden"; });
window.addEventListener("pageshow", event => {
  if (event.persisted) {
    // Back from Stripe / Google restores this same document from the bfcache.
    // The account only has to be wiped when the stored session no longer
    // belongs to the person this page was built for; the same owner keeps
    // their review-asked marks, onboarding pin and conversation (audit 11.5).
    let session = null;
    try { session = JSON.parse(window.localStorage.getItem(authStorageKey) || "null"); } catch {}
    if (typeof accountBoundary.resume !== "function") { accountBoundary.invalidate(); return; }
    if (!accountBoundary.resume(session)) return;
  }
  if (!accountBoundary.stopped) document.documentElement.style.visibility = "";
});


const S = {
  tab: "home",
  advisor: accountStorage.getItem("ledger.advisor") === "1",
  conversationId: accountStorage.getItem("ledger.conv") || null,
  usage: null,
  profile: null,
  currency: "CAD",
  qbo: null, cal: null, receipts: null, emails: null, board: null, profit: null, team: null,
  qboStale: false, profitStale: false,
  lane: "directory",
  invoiceFilter: "all",
  profitRange: "daily",
  installPrompt: null,
  // Ledger Live (launch audit 16-04, 2026-09-17): voice is OFF until the server
  // says otherwise. Nothing draws a Live button, arms "Hey Ledger" or asks for
  // the mic on the strength of a default — the answer comes from /realtime/state.
  voice: { available: false, code: "voice_safety_pause", message: "Ledger Live is temporarily paused. Typed chat is still available." },
  // Which plan the website card pointed at (?plan=solo|pro). A hint, never a purchase.
  planHint: null,
};

// One probe per sign-in. Any failure — network, permission, an older server
// without the endpoint — leaves voice off; it is never switched on by accident.
async function loadVoiceState() {
  try {
    const v = await api("/realtime/state", {});
    S.voice = v && v.available === true
      ? { available: true, code: null, message: null }
      : { available: false, code: v?.code || "voice_safety_pause", message: v?.message || S.voice?.message || "Ledger Live is temporarily paused. Typed chat is still available." };
  } catch { S.voice = { ...S.voice, available: false }; }
  return S.voice;
}

// Keep the offline copy honest (Kyle 2026-09-07). A stale cached bundle is
// invisible: the app just quietly runs an older build, which is exactly what
// happened on Kyle's Mac. On every open: ask the worker to look for a newer
// build, and if the shell on the server points at a newer app.js than the one
// running, refresh once. APP_BUILD must match the ?v= stamp in app.html.
const APP_BUILD = 186;
// A deploy during business hours used to reload every open tab the moment the
// new worker took over — mid-invoice, mid-booking (audit 11.4). The reload now
// waits while a sheet, a picker, a dialog or a typed question is on screen and
// happens the moment that layer closes; a sticky toast offers it sooner.
const UPDATE = { pending: false };
function uiBusy() {
  return !!$("sheetwrap") || !!$("pickwrap") || !!$("stackwrap") || !!document.querySelector("dialog[open]")
    || (!!$("chatwrap")?.classList.contains("open") && !!$("box")?.value.trim());
}
function freshReload() {
  if (!uiBusy()) { location.reload(); return; }
  if (UPDATE.pending) return;
  UPDATE.pending = true;
  toast("Ledger has an update ready — it loads after you finish here.", undefined, { sticky: true, action: { label: "Reload now", run: () => location.reload() } });
}
function reloadIfUpdatePending() {
  if (!UPDATE.pending || uiBusy()) return;
  // A closing sheet is often followed by the next one opening on the same tick.
  setTimeout(() => { if (UPDATE.pending && !uiBusy()) location.reload(); }, 400);
}
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;   // first install is not an update
    refreshing = true;
    freshReload();
  });
  (async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
      const shell = await (await fetch("app.html", { cache: "reload" })).text();
      const stamp = shell.match(/app\.js\?v=(\d+)/);
      const latest = stamp ? Number(stamp[1]) : 0;
      // sessionStorage guard: one refresh per build per tab, never a loop.
      if (latest > APP_BUILD && sessionStorage.getItem("ledger.freshen") !== String(latest)) {
        sessionStorage.setItem("ledger.freshen", String(latest));
        freshReload();
      }
    } catch { /* offline or blocked: keep running what we have */ }
  })();
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installPrompt = e; });

/* ---------------- helpers ---------------- */
const esc = (s) => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const money = (n) => (Number(n) || 0).toLocaleString(undefined, { style: "currency", currency: S.currency }).replace(/^[A-Z]{2}\$/, "$");
const money0 = (n) => (Number(n) || 0).toLocaleString(undefined, { style: "currency", currency: S.currency, maximumFractionDigits: 0 }).replace(/^[A-Z]{2}\$/, "$");
const $ = (id) => document.getElementById(id);
const on = (sel, ev, fn, scope) => (scope || document).querySelectorAll(sel).forEach((n) => n.addEventListener(ev, fn));

// The business day the owner is standing in, not UTC's — every "today" fallback
// and date-only guard in this file should read off this, never toISOString().
function localDay(d) {
  const dt = d instanceof Date ? d : new Date();
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

// Business finance dates are civil dates, not the browser's travel location.
function businessDay(date = new Date(), offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: S.businessTimezone || "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name) => parts.find((p) => p.type === name).value;
  const civil = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day")) + offset));
  return civil.toISOString().slice(0, 10);
}

function dayLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t0) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
const timeLabel = (iso) => iso && iso.length > 10
  ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  : "All day";
const dateShort = (iso) => iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

async function token() {
  const expected = accountBoundary.identity;
  const { data } = await supa.auth.getSession();
  if (!accountBoundary.accept(data.session)) throw new DOMException("Account changed", "AbortError");
  accountBoundary.assertCurrent(expected);
  return data.session?.access_token ?? null;
}

// Which connector each data path needs. A shop that never connected
// QuickBooks, Google or reviews used to fire every one of these on every
// screen and collect a 409 each time (32 failed calls on first load — sim
// bug 11). Once the connection list says a connector is absent, the call is
// answered here with the same 409 the server would send, and no request goes
// out. OAuth start/disconnect/status paths always go through.
const CONNECTOR_PATHS = [
  ["/quickbooks-data", "quickbooks", "QuickBooks is not connected"],
  ["/quickbooks-invoice", "quickbooks", "QuickBooks is not connected"],
  ["/gmail/", "gmail", "Gmail is not connected"],
  ["/google-business-profile/", "google_business_profile", "Business Profile is not connected"],
];
const CONNECTOR_PASSTHROUGH = /\/(start|callback|confirm|disconnect|status|oauth)/;
function knownDisconnected(path) {
  if (!S.connMap || CONNECTOR_PASSTHROUGH.test(path) || /^\/gmail\/(photo-receipt|receipt-photo|receipts|categorize|set-amount|dismiss)(?:\?|$)/.test(path)) return null;
  const hit = CONNECTOR_PATHS.find(([prefix]) => path.startsWith(prefix));
  return hit && !S.connMap[hit[1]] ? hit[2] : null;
}

// `opts.silentUpgrade` is for calls a screen makes on its own — loading a
// card, filling a picker. Those must never throw the Ledger Pro door in a
// customer's face; the screen shows an inline "part of Pro" panel instead.
// The door is for something the customer actually asked for.
async function api(path, body, method = "POST", opts = {}) {
  const expected = accountBoundary.identity;
  const t = await token(); accountBoundary.assertCurrent(expected); if (!t) throw new Error("Signed out");
  const offline = knownDisconnected(path);
  if (offline) { const err = new Error(offline); err.status = 409; err.data = { error: offline }; throw err; }
  let r;
  try {
    r = await fetch(FN + path, {
      signal: accountBoundary.signal,
      method,
      headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    accountBoundary.assertCurrent(expected);
    // A dropped connection surfaces as a bare TypeError ("Failed to fetch",
    // "Load failed") that used to be printed as-is in chat and toasts. Say
    // what it means (audit 11.6); status 0 so no branch mistakes it for a reply.
    const err = new Error(offlineMessage());
    err.status = 0; err.data = {}; err.offline = true; err.cause = e;
    throw err;
  }
  const d = await r.json().catch(() => ({}));
  accountBoundary.assertCurrent(expected);
  if (!r.ok) {
    // Callers that need more than the message — a 409's match list, a 402's
    // billing state, an "already posted" doc_number — read it off the error.
    const err = new Error(d.message || d.error || ("Request failed (" + r.status + ")"));
    err.status = r.status; err.data = d;
    if (d.matches) err.matches = d.matches;
    if (["mfa_required", "mfa_enrollment_required"].includes(d.error)) void openSecurity(supa);
    // Real paywall (2026-09-05): the server refused a write because the
    // subscription is paused. One handler updates the banner so the customer
    // sees why, whatever screen they were on.
    if (r.status === 402 && d.code === "subscription_required") paywallHit(d);
    if (r.status === 402 && d.code === "upgrade_required" && !opts.silentUpgrade) upgradeHit(d);
    throw err;
  }
  if (d.timezone && (path === "/stripe-billing/status" || (path === "/books" && body?.action === "settings"))) S.businessTimezone = d.timezone;
  return d;
}
const get = (path) => api(path, null, "GET");
const offlineMessage = () => navigator.onLine === false
  ? "You're offline — check your connection."
  : "Can't reach Ledger right now — check your connection and try again.";

/* Google Play's Payments policy forbids an app it distributes from leading
   anyone to another way to pay — not by a button, a link, a webview or a
   sign-up flow. The Android app is this same website in a wrapper, so every
   Stripe entry point below would ship inside it. Until Google Play Billing is
   wired up, the Android build offers nothing for sale: it states what is
   needed and stops there, with no price, link or call to action. The browser
   and the iPhone app are untouched. The referrer is only set on the launch
   navigation, so the answer is remembered. */
const ANDROID_APP_KEY = "ledger.androidApp";
try {
  if (document.referrer.startsWith("android-app://ai.heyledger.app")) {
    sessionStorage.setItem(ANDROID_APP_KEY, "1");
    accountStorage.setItem(ANDROID_APP_KEY, "1");
  }
} catch {}
function inAndroidApp() {
  try {
    // The launch navigation carries the referrer; the rest of the session is
    // single-page, so the tab's own storage is the reliable answer.
    if (sessionStorage.getItem(ANDROID_APP_KEY) === "1") return true;
    // Belt: a standalone window on a device that has launched the Play build.
    // A normal Chrome tab is never standalone, so browsing heyledger.ai on the
    // same phone still works exactly as it always did.
    return window.matchMedia("(display-mode: standalone)").matches
      && accountStorage.getItem(ANDROID_APP_KEY) === "1";
  } catch { return false; }
}
const SUBSCRIPTION_REQUIRED = "An active Ledger AI subscription is required.";

/* ---------------- plans (2026-09-08) ---------------- */
// Copy lives here, prices come from the server so the website, the app and the
// gates can never disagree about what a plan costs.
const PLAN_BLURB = {
  solo: {
    tag: "One owner login · no crew tools",
    line: "The copilot on your live books, invoicing, estimates, payments, Receipt Radar, Client Hub, booking, leads, your business number and review replies.",
    extra: "$60/mo AI · $10/mo texting",
  },
  pro: {
    tag: "For a shop with staff",
    line: "Everything in Solo, plus crew dispatch and live job links, punch-clock time cards, selling off your own price list, Front Desk answering the phone, and teammate logins.",
    extra: "$150/mo AI · $25/mo texting",
  },
};

// Asks which plan to buy. Resolves to "solo" | "pro", or null if dismissed.
// Never a native confirm() — that wedges the in-app browser.
// `unavailable` (audit 16-06, 2026-09-17): plans the server cannot sell right
// now stay on the sheet, greyed and labelled, so a customer who came for Solo
// reads why they are looking at Pro instead of being handed a $699 checkout.
// `hint` is the plan the website card pointed at; it is highlighted, not chosen.
function choosePlanSheet(plans, unavailable = new Set(), hint = null) {
  return new Promise((resolve) => {
    let picked = null;
    const card = (p) => {
      const b = PLAN_BLURB[p.key] || { tag: "", line: "", extra: "" };
      const off = unavailable.has(p.key);
      return `<button type="button" class="planpick${off ? " off" : ""}${hint === p.key && !off ? " hint" : ""}" data-plan="${p.key}"${off ? ' disabled aria-disabled="true"' : ""}>
        <div class="planpick-top"><span class="planpick-name">${p.name}</span>
        <span class="planpick-price"><s>$${p.list_price}</s>$${p.price}<small>/mo</small></span></div>
        <div class="planpick-tag">${off ? `${esc(p.name)} isn't available for checkout yet` : b.tag}</div>
        <div class="planpick-line">${b.line}</div>
        <div class="planpick-extra">${b.extra}</div></button>`;
    };
    const wanted = hint && unavailable.has(hint) ? (plans.find((p) => p.key === hint)?.name || hint) : null;
    sheet(`<h3>Choose your plan</h3>
      <p class="muted" style="margin:0 0 14px">The difference is people. Solo is you and the truck. Pro is you and a crew — you can move up any time and nothing is rebuilt.</p>
      ${wanted ? `<p class="note" style="margin:0 0 12px;color:var(--gold)">${esc(wanted)} isn't available for checkout yet. Nothing is charged unless you pick a plan below.</p>` : ""}
      <div class="planpicks">${plans.map(card).join("")}</div>`, (pane) => {
      pane.querySelectorAll(".planpick").forEach((b) => {
        if (b.disabled) return;
        b.onclick = () => { picked = b.dataset.plan; closeSheet(); };
      });
    });
    // The sheet can close by tap, by the Close button or by the backdrop, and
    // `sheet()` hands the callback the pane rather than the wrapper — so the
    // one reliable signal that the customer is done is the wrapper going away.
    // Never hang the caller.
    const poll = setInterval(() => {
      if (!document.getElementById("sheetwrap")) { clearInterval(poll); resolve(picked); }
    }, 250);
  });
}

// A Solo customer touched a Pro feature. They are PAYING — this is a growth
// moment, not a failure, so it gets a real door with the price on it and one
// button that actually changes the plan. Never "your subscription ended", and
// never a red error toast for something the customer is allowed to buy.
let upgradeSheetOpen = false;
function upgradeHit(d) {
  // Google Play forbids an app it distributes from pointing anywhere else to
  // pay. Inside the Android wrapper we state the fact and stop there.
  if (inAndroidApp()) { toast(humanSentence(d.message) || humanSentence(d.error) || "That's part of Ledger Pro.", "err"); return; }
  if (upgradeSheetOpen) return;
  upgradeSheetOpen = true;
  const price = d.required_plan_price || 699;
  const title = d.feature_title || "Ledger Pro";
  const body = d.message || d.error || "That's part of Ledger Pro.";
  const html = `<h3>${esc(title)}</h3>
    <p class="muted" style="margin:0 0 14px">${esc(body)}</p>
    <div class="planpick" style="cursor:default;margin-bottom:14px">
      <div class="planpick-top"><span class="planpick-name">Ledger Pro</span>
      <span class="planpick-price">$${price}<small>/mo</small></span></div>
      <div class="planpick-tag">${PLAN_BLURB.pro.tag}</div>
      <div class="planpick-line">${PLAN_BLURB.pro.line}</div>
      <div class="planpick-extra">${PLAN_BLURB.pro.extra}</div>
    </div>
    <button class="btn em wide" id="upgo">Move up to Ledger Pro</button>
    <p class="note" style="margin-top:10px;text-align:center">Nothing is rebuilt and nothing is lost — everything you already have stays exactly where it is. You only pay the difference for the rest of this month.</p>`;
  const wire = (pane) => {
    const go = pane.querySelector("#upgo");
    go.onclick = async () => {
      go.disabled = true; go.textContent = "Switching…";
      const ok = await moveToPlan("pro");
      if (!ok) { go.disabled = false; go.textContent = "Move up to Ledger Pro"; }
    };
  };
  // A Solo owner who hits the door from inside a form keeps the form: the door
  // stacks over an open sheet instead of replacing it (audit 11.2d).
  const wrap = $("sheetwrap") ? stackSheet(html, wire) : sheet(html, wire);
  const poll = setInterval(() => {
    if (!wrap.isConnected) { clearInterval(poll); upgradeSheetOpen = false; }
  }, 250);
}

// The one place a plan actually changes. Handles all four real states: a live
// Stripe subscription (swap the price, prorated), no subscription yet (that is
// a checkout, not a change), an App Store subscription (only Apple can move
// it), and a downgrade blocked by teammates. Returns true when the plan moved.
async function moveToPlan(plan) {
  if (inAndroidApp()) { toast("Plan changes aren't available in the Android app yet.", "err"); return false; }
  try {
    const d = await api("/stripe-billing/change-plan", { plan });
    // `unchanged` after a retry means the earlier change landed while the
    // screen still showed the old plan — reload so it tells the truth (02-07).
    // `pending` means Stripe's own webhook is applying it within seconds.
    if (d.unchanged) { toast(humanSentence(d.message) || "Your plan is unchanged."); closeStack(); closeSheet(); setTimeout(() => location.reload(), 900); return true; }
    toast(d.pending ? `${d.message || `You're on ${d.plan_name}.`} Updating…` : (d.message || `You're on ${d.plan_name}.`));
    closeStack(); closeSheet();
    // Every gated screen has to redraw against the new plan, and the copilot's
    // tool list is built per request — a clean reload is the honest way to
    // show a customer that what they just paid for is on.
    setTimeout(() => location.reload(), 1400);
    return true;
  } catch (e) {
    const code = e.data?.code || e.data?.error;
    if (code === "no_subscription") {
      try { const c = await startCheckout(plan); location.href = c.url; return true; }
      catch (err) { if (!err.cancelled) toast(friendlyError(err, "Couldn't start checkout. Nothing was charged — try again."), "err"); return false; }
    }
    toast(friendlyError(e, "Couldn't change your plan. Nothing was charged — try again."), "err");
    return false;
  }
}

// Checkout is for a shop with no subscription. A shop that already has one
// (trial with a card, active, past due) is refused with already_subscribed —
// card changes go through the billing portal, never a second Checkout.
async function startCheckout(plan, promoCode = null) {
  // Safety net behind the hidden buttons: nothing inside the Android app may
  // reach a Stripe checkout, however it got called.
  if (inAndroidApp()) throw new Error(SUBSCRIPTION_REQUIRED);
  // 2026-09-08: this line read `await startCheckout()` — the wrapper called
  // itself and every Subscribe button on the site died in a recursion loop
  // from 2026-09-06 until today. It has always meant the checkout endpoint.
  let chosen = plan;
  if (!chosen) {
    // Audit 16-06 (2026-09-17): the plan is always the customer's own tap. When
    // Solo is on the website but not sellable here, the sheet still opens with
    // Solo greyed and labelled — a $699 Pro checkout is never the silent default.
    let status = null;
    try { status = await api("/stripe-billing/status", {}); }
    catch { throw new Error("Couldn't load the plans just now — check your connection and try again. Nothing was charged."); }
    const options = status?.plans || [];
    const unavailable = new Set(options.filter((p) => p.key === "solo" && !status?.solo_available).map((p) => p.key));
    if (!options.length) throw new Error("No plans are available right now. Please try again later. Nothing was charged.");
    {
      chosen = await choosePlanSheet(options, unavailable, S.planHint);
      if (!chosen) return Promise.reject(Object.assign(new Error("cancelled"), { cancelled: true }));
    }
  }
  const body = { plan: chosen, ...(promoCode ? {promo_code:promoCode} : {}) };
  try { return await api("/stripe-billing/checkout", body); }
  catch (e) {
    if (e.status === 409 && e.data?.error === "already_subscribed" && e.data?.portal_available) {
      toast("Your card is already on file — opening billing.");
      return api("/stripe-billing/portal", {});
    }
    // An App Store subscription ended within Apple's 60-day retry window: the
    // server asks once whether the Apple side is really cancelled (02-05).
    if (e.status === 409 && e.data?.code === "apple_subscription_recent") {
      if (!(await askConfirm(friendlyError(e, "Your App Store subscription may still be active."), { title: "Continue to web checkout?", ok: "Continue" }))) return Promise.reject(Object.assign(new Error("cancelled"), { cancelled: true }));
      return api("/stripe-billing/checkout", { ...body, acknowledge_apple: true });
    }
    throw e;
  }
}

function toast(text, kind, opts = {}) {
  const old = $("toast"); if (old) old.remove();
  // Screen readers only announce a live region that existed before its text
  // changed, so the two hosts are created once and stay in the page: errors
  // are alerts, everything else is polite status (audit 11.6).
  const hostId = kind === "err" ? "toasthost-err" : "toasthost";
  let host = $(hostId);
  if (!host) {
    host = document.createElement("div"); host.id = hostId;
    host.setAttribute("role", kind === "err" ? "alert" : "status");
    host.setAttribute("aria-live", kind === "err" ? "assertive" : "polite");
    document.body.appendChild(host);
  }
  const t = document.createElement("div"); t.id = "toast";
  t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom) + 88px);background:" +
    (kind === "err" ? "#7f1d1d" : "#134e4a") + ";color:#fff;padding:11px 16px;border-radius:13px;font-size:14px;z-index:60;max-width:88%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.5)";
  t.textContent = text;
  if (opts.action) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = opts.action.label;
    b.style.cssText = "margin-left:12px;border:1px solid rgba(255,255,255,.5);background:none;color:#fff;border-radius:999px;padding:5px 12px;font:inherit;font-weight:800;cursor:pointer";
    b.onclick = () => { t.remove(); opts.action.run(); };
    t.appendChild(b);
  }
  host.appendChild(t);
  if (!opts.sticky) setTimeout(() => t.remove(), 3600);
  return t;
}

/* ---------------- in-page dialogs (audit 11.3) ---------------- */
// One implementation for every question the app asks. Native confirm()/prompt()
// answer "no" without showing anything inside a WKWebView with no UI delegate
// and inside several in-app browsers, so a booking or a void silently did
// nothing there. A <dialog> is real DOM: styled, announced, and it never blocks
// the thread. Escape and the backdrop mean "cancel".
function askDialog({ title = "", body = "", buttons = [], input = null, cancelValue = null, danger = false }) {
  return new Promise((resolve) => {
    document.getElementById("ledger-ask")?.remove();
    const dlg = document.createElement("dialog"); dlg.id = "ledger-ask"; dlg.className = "ask";
    dlg.setAttribute("aria-labelledby", "ledger-ask-title");
    dlg.innerHTML = `<form><h2 id="ledger-ask-title">${esc(title)}</h2>
      ${body ? `<p class="ask-body" id="ledger-ask-body">${esc(body)}</p>` : ""}
      ${input ? `<input class="ask-input" name="value" autocomplete="off" aria-labelledby="ledger-ask-title" placeholder="${esc(input.placeholder || "")}" value="${esc(input.value || "")}"${input.inputmode ? ` inputmode="${esc(input.inputmode)}"` : ""}>` : ""}
      <div class="ask-row">${buttons.map((b, i) => `<button type="${b.primary ? "submit" : "button"}" class="btn ${b.kind === "danger" ? "danger" : b.kind === "primary" ? "primary" : "ghost"}" data-ask="${i}">${esc(b.label)}</button>`).join("")}</div></form>`;
    if (body) dlg.setAttribute("aria-describedby", "ledger-ask-body");
    document.body.appendChild(dlg);
    let done = false;
    const finish = (value) => {
      if (done) return; done = true;
      try { dlg.close(); } catch {}
      dlg.remove();
      resolve(value);
    };
    const field = dlg.querySelector(".ask-input");
    const valueOf = (b) => b.value === askDialog.INPUT ? (field ? field.value : "") : b.value;
    dlg.querySelectorAll("[data-ask]").forEach((el) => {
      const b = buttons[Number(el.dataset.ask)];
      el.onclick = (e) => { e.preventDefault(); finish(valueOf(b)); };
    });
    dlg.querySelector("form").onsubmit = (e) => { e.preventDefault(); const b = buttons.find((x) => x.primary); finish(b ? valueOf(b) : cancelValue); };
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(cancelValue); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) finish(cancelValue); });
    dlg.addEventListener("close", () => finish(cancelValue));
    try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
    // Destructive questions start on the safe button; a text prompt starts in its field.
    const focusTarget = field || dlg.querySelector(danger ? "[data-ask]:not([type=submit])" : "[type=submit]") || dlg.querySelector("[data-ask]");
    try { focusTarget?.focus(); if (field) field.select(); } catch {}
  });
}
askDialog.INPUT = Symbol("ask-input");
function askConfirm(message, { title = "", ok = "OK", cancel = "Cancel", danger = false } = {}) {
  return askDialog({ title: title || (danger ? "Are you sure?" : "Please confirm"), body: message, danger, cancelValue: false, buttons: [
    { label: cancel, value: false },
    { label: ok, value: true, primary: true, kind: danger ? "danger" : "primary" },
  ] });
}
function askPrompt(message, { title = "", value = "", placeholder = "", ok = "OK", cancel = "Cancel", inputmode = "" } = {}) {
  return askDialog({ title: title || message, body: title ? message : "", cancelValue: null, input: { value, placeholder, inputmode }, buttons: [
    { label: cancel, value: null },
    { label: ok, value: askDialog.INPUT, primary: true, kind: "primary" },
  ] });
}
// Copy fallback (audit 19.1). Some in-app browsers refuse clipboard writes;
// a native prompt() there shows nothing at all, so the link was simply lost.
// This is a real sheet: the link sits in a selectable field, Copy tries again
// in place (clipboard, then the old execCommand path), and says what happened.
function linkSheet(title, url) {
  return new Promise((resolve) => {
    document.getElementById("ledger-ask")?.remove();
    const dlg = document.createElement("dialog"); dlg.id = "ledger-ask"; dlg.className = "ask";
    dlg.setAttribute("aria-labelledby", "ledger-ask-title");
    dlg.setAttribute("aria-describedby", "ledger-ask-body");
    dlg.innerHTML = `<form><h2 id="ledger-ask-title">${esc(title)}</h2>
      <p class="ask-body" id="ledger-ask-body">This browser wouldn't copy it for us. Tap Copy, or select the link and copy it by hand.</p>
      <input class="ask-input" readonly autocomplete="off" aria-labelledby="ledger-ask-title" value="${esc(url || "")}">
      <div class="ask-row"><button type="button" class="btn ghost" data-ask-close>Done</button><button type="submit" class="btn primary" data-ask-copy>Copy</button></div></form>`;
    document.body.appendChild(dlg);
    let done = false;
    const finish = () => { if (done) return; done = true; try { dlg.close(); } catch {} dlg.remove(); resolve(); };
    const field = dlg.querySelector(".ask-input");
    const copy = async () => {
      try { field.focus(); field.select(); field.setSelectionRange(0, String(url || "").length); } catch {}
      let ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; } catch {}
      if (!ok) { try { ok = document.execCommand("copy"); } catch { ok = false; } }
      toast(ok ? "Link copied" : "Press and hold the link to copy it.");
    };
    dlg.querySelector("[data-ask-close]").onclick = (e) => { e.preventDefault(); finish(); };
    dlg.querySelector("form").onsubmit = (e) => { e.preventDefault(); void copy(); };
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) finish(); });
    dlg.addEventListener("close", () => finish());
    try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
    try { field.focus(); field.select(); } catch {}
  });
}

/* ---------------- plain-English failures (audit 19.2) ---------------- */
// An owner should never read "column phone_messages.sent_by does not exist",
// "PGRST204" or a bare "Failed to fetch". One funnel for every caught error:
// keep a sentence a human wrote on the server, map the cases we know, and
// otherwise show the caller's own short sentence about what just failed. The
// raw error always goes to the console so a bug report still has it.
const ERROR_JARGON = /[{}[\]<>]|"[a-z_]+"\s*:|\bcolumn\b|\bconstraint\b|\brelation\b|\bPGRST|\bnull value\b|\bviolates\b|\bsyntax error\b|\bundefined\b|\bNaN\b|\bstack\b|\bHTTP\s*\d{3}\b|\b[45]\d{2}\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Payload Too Large|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b|Request failed \(\d+\)/i;
// A sentence is something an owner could have been handed on paper: real
// words, a space in it, no code, no punctuation soup, short enough to read.
function humanSentence(text) {
  const t = String(text == null ? "" : text).trim();
  if (t.length < 8 || t.length > 240) return "";
  if (!/\s/.test(t)) return "";
  if (!/[a-z]/.test(t)) return "";
  if (/^[a-z][a-z0-9_]*$/i.test(t)) return "";
  if (ERROR_JARGON.test(t)) return "";
  return t;
}
function friendlyError(e, fallback) {
  const safe = fallback || "Something went wrong. Please try again.";
  try { console.warn("[ledger] " + safe, e); } catch {}
  if (e == null) return safe;
  const data = (e && e.data) || {};
  const status = Number(e && e.status);
  const raw = typeof e === "string" ? e : String((e && e.message) || "");
  // Nothing left the device.
  if (e.offline || status === 0 || /failed to fetch|load failed|network\s*error|networkerror|connection (?:lost|refused)/i.test(raw)) {
    return offlineMessage();
  }
  if (e.name === "AbortError" || /timed? ?out|timeout|took too long/i.test(raw)) {
    return "That took too long to answer. Check your connection and try again.";
  }
  // Signed out / expired token: one instruction, not a JWT dump.
  if (status === 401 || status === 403 || /^signed out$/i.test(raw) || /\bjwt\b|invalid token|token (?:is )?expired|not authenticated/i.test(raw)) {
    return "Your session has ended. Sign in again to continue.";
  }
  // The AI-health outage sentence (_shared/ai_health) is already plain English.
  if (data.code === "ai_unavailable" || status === 503) {
    return humanSentence(data.message || data.error || raw) || "Ledger's AI helper is unavailable right now — try again in a few minutes.";
  }
  // The server wrote something for a human: that beats anything we could guess.
  const written = humanSentence(data.message) || humanSentence(data.error) || humanSentence(raw);
  if (written) return written;
  if (status === 402) return "That needs an active plan or more AI allowance — check Billing under Business profile & settings.";
  if (status === 409) return "That clashed with something already saved. Reopen the screen and try again.";
  if (status === 413) return "That file is too large. Try a smaller one.";
  if (status === 429) return "That's a lot at once — wait a few seconds and try again.";
  if (status >= 500) return "Ledger's server had a problem. Nothing was lost — try again in a moment.";
  return safe;
}

/* ---------------- bottom sheet ---------------- */
// Sheets, the stacked picker and the chat pane are layers over one document.
// Each open layer owns one history entry, so the phone's Back button (and the
// Android app's) closes the layer instead of leaving the app; closing a layer
// from code pops that entry again, so history never piles up (audit 11.1).
const LAYER = { sheet: false, chat: false, stack: false, selfPops: 0 };
function layerPush(kind) {
  if (LAYER[kind]) return;
  try { history.pushState({ ledgerLayer: kind }, ""); LAYER[kind] = true; } catch {}
}
function layerPop(kind) {
  if (!LAYER[kind]) return;
  LAYER[kind] = false;
  if (history.state?.ledgerLayer !== kind) return;
  LAYER.selfPops++;
  try { history.back(); } catch { LAYER.selfPops--; return; }
  // A traversal that never reports back must not swallow the user's next Back.
  setTimeout(() => { if (LAYER.selfPops > 0) LAYER.selfPops--; }, 1500);
}
window.addEventListener("popstate", () => {
  if (LAYER.selfPops > 0) { LAYER.selfPops--; return; }
  // The browser has already dropped the entry: clear the flag first so the
  // close below does not try to pop it a second time.
  if (LAYER.stack && topStack()) { LAYER.stack = false; closeStack(); return; }
  if (LAYER.sheet && $("sheetwrap")) {
    LAYER.sheet = false;
    // A draft that asks first may keep the sheet: then it needs its entry back.
    requestCloseSheet().then((closed) => { if (!closed && $("sheetwrap")) layerPush("sheet"); });
    return;
  }
  if (LAYER.chat && $("chatwrap")?.classList.contains("open")) { LAYER.chat = false; closeChat(); }
});
// Escape closes the topmost layer, the way a dialog should. Native <dialog>s
// (security, questions) handle their own Escape.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
  if (topStack()) { e.preventDefault(); closeStack(); return; }
  if ($("sheetwrap")) { e.preventDefault(); void requestCloseSheet(); return; }
  if ($("chatwrap")?.classList.contains("open")) { e.preventDefault(); closeChat(); }
});

let sheetSeq = 0;
// Every sheet is a labelled modal dialog for assistive tech: the first heading
// names it, focus moves in on open and back to the opener on close.
function labelPane(pane) {
  pane.setAttribute("role", "dialog"); pane.setAttribute("aria-modal", "true"); pane.tabIndex = -1;
  const heading = pane.querySelector("h1,h2,h3");
  if (heading) { if (!heading.id) heading.id = "sheet-title-" + (++sheetSeq); pane.setAttribute("aria-labelledby", heading.id); }
}
function rememberOpener() {
  const el = document.activeElement;
  return el && el !== document.body && !isTextInput(el) ? el : null;
}
function restoreFocus(opener) {
  if (!opener || !opener.isConnected || $("sheetwrap") || topStack()) return;
  try { opener.focus({ preventScroll: true }); } catch {}
}
function sheet(html, wire) {
  const previous = $("sheetwrap");
  // A sheet replacing a sheet keeps the original opener and the history entry.
  const opener = previous ? previous._opener : rememberOpener();
  closeSheet({ keepLayer: true });
  const wrap = document.createElement("div"); wrap.id = "sheetwrap";
  wrap.innerHTML = `<div class="sheet-back"></div><div class="sheet"><div class="grab"></div>
    <div class="kbbar"><button class="kbdone" type="button">Done</button></div>${html}
    <button class="sheet-close">Close</button></div>`;
  wrap._opener = opener;
  document.body.appendChild(wrap);
  wrap.querySelector(".sheet-back").onclick = () => { void requestCloseSheet(); };
  wrap.querySelector(".sheet-close").onclick = () => { void requestCloseSheet(); };
  // Keyboard escape hatch (Kyle, 2026-08-24 — got trapped on the Phone tab).
  // The sheet's own Close button sits below the keyboard once it opens, so a
  // sticky Done bar rides the top of the sheet the whole time a field is
  // focused. A finger-scroll of the sheet also dismisses, matching iOS.
  const pane = wrap.querySelector(".sheet");
  labelPane(pane);
  wrap.querySelector(".kbdone").onclick = () => blurInput();
  pane.addEventListener("focusin", (e) => { if (isTextInput(e.target)) wrap.classList.add("kbon"); });
  pane.addEventListener("focusout", () => setTimeout(() => {
    if (!isTextInput(document.activeElement)) wrap.classList.remove("kbon");
  }, 60));
  // Only a real finger-drag dismisses. The old `scroll` listener also fired
  // when the browser scrolled a just-focused field into view or the keyboard
  // resized the viewport, which closed the keyboard the moment it opened on a
  // long form (audit 11.8).
  let touchY = null;
  pane.addEventListener("touchstart", (e) => { touchY = e.touches[0]?.clientY ?? null; }, { passive: true });
  pane.addEventListener("touchmove", (e) => {
    if (touchY === null || !isTextInput(document.activeElement)) return;
    if (e.target.closest && e.target.closest("input,textarea,select")) return;
    const y = e.touches[0]?.clientY ?? touchY;
    if (Math.abs(y - touchY) > 14) { touchY = null; blurInput(); }
  }, { passive: true });
  pane.addEventListener("touchend", () => { touchY = null; }, { passive: true });
  if (wire) wire(pane);
  layerPush("sheet");
  if (!wrap.contains(document.activeElement)) { try { pane.focus({ preventScroll: true }); } catch {} }
  return wrap;
}

const isTextInput = (el) => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
function blurInput() { if (isTextInput(document.activeElement)) document.activeElement.blur(); }

// Tap anywhere that is not itself a field and the keyboard closes. One global
// listener rather than per-form wiring, so a field added later can never ship
// without an escape hatch. It runs on `click`, after the tap has already been
// delivered to the control under the finger: blurring on `pointerdown` closed
// the keyboard first, the layout shifted, and the tap could land on a
// different button than the one pressed (audit 11.8).
document.addEventListener("click", (e) => {
  if (!isTextInput(document.activeElement)) return;
  if (e.target === document.activeElement) return;
  if (e.target.closest && e.target.closest("input,textarea,select,label")) return;
  blurInput();
}, true);
function closeSheet(opts = {}) {
  const w = $("sheetwrap"); if (!w) return;
  // Removing a sheet that still holds the focused field fires blur mid-removal
  // and Chrome throws NotFoundError; blur first, and never let a stale node throw.
  if (w.contains(document.activeElement)) { try { document.activeElement.blur(); } catch {} }
  try { w.remove(); } catch { if (w.parentNode) try { w.parentNode.removeChild(w); } catch {} }
  if (opts.keepLayer) return;
  layerPop("sheet");
  restoreFocus(w._opener);
  reloadIfUpdatePending();
}
// The customer's way out: backdrop, Close, Escape, Back. A sheet that holds a
// draft registers `_isDirty` (and `_discard`) on its wrapper, and is asked
// before anything typed is thrown away (audit 11.2a). Code that closes a sheet
// after a successful save still calls closeSheet() directly. Resolves true when
// the sheet is gone.
async function requestCloseSheet() {
  const w = $("sheetwrap"); if (!w) return true;
  // A save in flight owns the sheet: its Close button is disabled.
  if (w.querySelector(".sheet-close")?.disabled) return false;
  if (typeof w._isDirty === "function" && w._isDirty()) {
    const choice = await askDialog({ title: "Keep this draft?", body: "You have unsaved changes.", danger: true, cancelValue: "keep", buttons: [
      { label: "Keep editing", value: "keep" },
      { label: "Discard", value: "discard", kind: "danger" },
      { label: "Save for later", value: "save", primary: true, kind: "primary" },
    ] });
    if ($("sheetwrap") !== w) return true;
    if (choice === "keep") return false;
    if (choice === "discard" && typeof w._discard === "function") w._discard();
  }
  closeSheet();
  return true;
}

// A second layer over an open sheet (the billable-item picker, the Ledger Pro
// door) — never replaces the sheet beneath it.
const topStack = () => $("stackwrap") || $("pickwrap");
function stackSheet(html, wire) {
  closeStack();
  const wrap = document.createElement("div"); wrap.id = "stackwrap";
  wrap._opener = rememberOpener();
  wrap.innerHTML = `<div class="sheet-back"></div><div class="sheet"><div class="grab"></div>${html}
    <button class="sheet-close">Close</button></div>`;
  document.body.appendChild(wrap);
  const pane = wrap.querySelector(".sheet");
  labelPane(pane);
  wrap.querySelector(".sheet-back").onclick = () => closeStack();
  wrap.querySelector(".sheet-close").onclick = () => closeStack();
  if (wire) wire(pane);
  layerPush("stack");
  if (!wrap.contains(document.activeElement)) { try { pane.focus({ preventScroll: true }); } catch {} }
  return wrap;
}
function closeStack() {
  const s = topStack(); if (!s) return;
  if (s.contains(document.activeElement)) { try { document.activeElement.blur(); } catch {} }
  try { s.remove(); } catch {}
  layerPop("stack");
  const opener = s._opener;
  if (opener && opener.isConnected) { try { opener.focus({ preventScroll: true }); } catch {} }
  reloadIfUpdatePending();
}

/* ---------------- app shell ---------------- */
// Tab glyphs are inline SVG so the web bar reads like the iOS SF Symbols bar
// instead of a row of emoji.
// Mirror of SigilMark.read in CommandDashboardView.swift. Classify before
// initialing: a leading 5+ digit token is an Alberta numbered company, a record
// with no letters at all is a phone number filed as a name, and Ltd/Inc/Corp are
// noise that would otherwise eat the second real initial.
const SIGIL_GLYPH = {
  building: `<svg viewBox="0 0 24 24"><path d="M4 21V5.5A1.5 1.5 0 015.5 4H12a1.5 1.5 0 011.5 1.5V9H19a1.5 1.5 0 011.5 1.5V21H4zm2-2h2v-2.5H6V19zm0-4.5h2V12H6v2.5zm0-4.5h2V7.5H6V10zm4 9h2v-2.5h-2V19zm0-4.5h2V12h-2v2.5zm0-4.5h2V7.5h-2V10zm5.5 9h3v-2.5h-3V19zm0-4.5h3V12h-3v2.5z"/></svg>`,
  phone: `<svg viewBox="0 0 24 24"><path d="M6.6 3h2.9l1.6 4-2.1 1.5a12.4 12.4 0 006.5 6.5l1.5-2.1 4 1.6v2.9A2.6 2.6 0 0118.4 20 15.4 15.4 0 014 5.6 2.6 2.6 0 016.6 3z"/></svg>`,
  hash: `<svg viewBox="0 0 24 24"><path d="M9.3 3l-.8 5H4.4l-.3 2h4.1l-.6 4H3.5l-.3 2h4.1L6.5 21h2l.8-5h4l-.8 5h2l.8-5h4.1l.3-2h-4.1l.6-4h4.1l.3-2h-4.1l.8-5h-2l-.8 5h-4l.8-5h-2zm.9 7h4l-.6 4h-4l.6-4z"/></svg>`,
};
function sigilMark(raw) {
  const name = String(raw || "").trim();
  if (!/[A-Za-z]/.test(name)) {
    return SIGIL_GLYPH[(name.match(/\d/g) || []).length >= 7 ? "phone" : "hash"];
  }
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words[0] && words[0].length >= 5 && /^\d+$/.test(words[0])) return SIGIL_GLYPH.building;
  const filler = new Set(["ltd", "inc", "corp", "llc", "co", "the", "and", "of"]);
  const named = words.filter((w) => /[A-Za-z]/.test(w) && !filler.has(w.toLowerCase()));
  const letters = (named.length ? named : words).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return `<b>${esc(letters || name.charAt(0).toUpperCase())}</b>`;
}

const ICONS = {
  ledger: `<svg viewBox="0 0 24 24"><path d="M12 2.6l1.9 4.4 4.4 1.9-4.4 1.9L12 15.2l-1.9-4.4L5.7 8.9l4.4-1.9L12 2.6zm6.4 11.1l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1zm-12 1.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7L4 18l1.7-.7.7-1.7z"/></svg>`,
  finance: `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm.9 15.4v1.2h-1.6v-1.2c-1.6-.2-2.8-1.1-3-2.7h1.8c.1.8.8 1.3 2 1.3 1.1 0 1.8-.5 1.8-1.2 0-.7-.5-1-2-1.4-2.1-.5-3.3-1.2-3.3-2.9 0-1.5 1.1-2.5 2.7-2.7V6.6h1.6v1.2c1.6.3 2.6 1.3 2.7 2.7h-1.8c-.1-.8-.7-1.3-1.7-1.3-1 0-1.7.5-1.7 1.1 0 .7.6 1 2 1.3 2.2.5 3.3 1.3 3.3 3 0 1.5-1.1 2.6-2.8 2.8z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24"><path d="M7 2v2H5.5A2.5 2.5 0 003 6.5v13A2.5 2.5 0 005.5 22h13a2.5 2.5 0 002.5-2.5v-13A2.5 2.5 0 0018.5 4H17V2h-2v2H9V2H7zm12 8v9.2c0 .4-.3.8-.8.8H5.8a.8.8 0 01-.8-.8V10h14zM7.5 12a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2zm4.5 0a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2zm4.5 0a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2zM7.5 16a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2zm4.5 0a1.1 1.1 0 100 2.2 1.1 1.1 0 000-2.2z"/></svg>`,
  receipts: `<svg viewBox="0 0 24 24"><path d="M9.4 3l-1.2 2H5.5A2.5 2.5 0 003 7.5v11A2.5 2.5 0 005.5 21h13a2.5 2.5 0 002.5-2.5v-11A2.5 2.5 0 0018.5 5h-2.7l-1.2-2H9.4zM12 8.2a4.8 4.8 0 110 9.6 4.8 4.8 0 010-9.6zm0 2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z"/></svg>`,
  customers: `<svg viewBox="0 0 24 24"><path d="M9 4.5a3.4 3.4 0 110 6.8 3.4 3.4 0 010-6.8zm7.6 1a2.7 2.7 0 110 5.4 2.7 2.7 0 010-5.4zM9 13c3.1 0 6 1.5 6 3.4V19H3v-2.6C3 14.5 5.9 13 9 13zm7.6.6c2.6 0 4.4 1.2 4.4 2.7V19h-4.6v-2.6c0-1.1-.5-2-1.3-2.7h1.5z"/></svg>`,
  phone: `<svg viewBox="0 0 24 24"><path d="M6.6 2.6l3.6.6.9 4.2-2.3 1.8c.9 2.3 2.7 4.1 5 5l1.8-2.3 4.2.9.6 3.6c0 1.4-1.1 2.6-2.6 2.6C9.8 19 5 14.2 5 5.2c0-1.4 1.2-2.6 1.6-2.6z"/></svg>`,
};
const TABS = [
  { key: "home", icon: ICONS.ledger, label: "Ledger" },
  { key: "finance", icon: ICONS.finance, label: "Finance" },
  { key: "calendar", icon: ICONS.calendar, label: "Calendar" },
  { key: "phone", icon: ICONS.phone, label: "Phone" },
  { key: "customers", icon: ICONS.customers, label: "Customers" },
];

// Every screen opens with the same two-line masthead as iOS:
// a mono OS code strip, then a chrome-gradient screen title over a cyan rule.
const MAG = `<svg viewBox="0 0 24 24"><path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"/></svg>`;

// Tiny monochrome lane-pill icons — the web twins of the SF Symbols iOS uses
// on its segment bars (chart.bar.xaxis / chart.line.uptrend.xyaxis /
// doc.text.viewfinder / person.2 / star.bubble / checklist / tray / bolt /
// waveform). Stroke inherits the pill's text colour.
const SEG_ICONS = {
  overview: `<path d="M4 20h16M6 16v-5M11 16V7M16 16v-8"/>`,
  estimates: `<path d="M8 3h6l4 4v13a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v4h4M10 12h5M10 16h3"/>`,
  tray: `<path d="M4 14l2-8h12l2 8v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM4 14h4l1 2h6l1-2h4"/>`,
  profit: `<path d="M3 17l5-5 4 3 8-8M20 7h-5M20 7v5"/>`,
  receipts: `<path d="M7 3h10a1 1 0 011 1v16l-3-1.6L12 20l-3-1.6L6 20V4a1 1 0 011-1zM9 8h6M9 12h6"/>`,
  directory: `<circle cx="9" cy="8" r="3"/><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5M15 5a3 3 0 010 6M17 14c1.9.6 3 2.3 3 5"/>`,
  reviews: `<path d="M4 5h16v11H9l-5 4V5zM12 7.5l1 2.2 2.4.2-1.8 1.6.5 2.3-2.1-1.2-2.1 1.2.5-2.3-1.8-1.6 2.4-.2z"/>`,
  todos: `<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>`,
  posts: `<path d="M3 11v2a1 1 0 001 1h2l6 4V6L6 10H4a1 1 0 00-1 1zM16 9.5a3 3 0 010 5M18.5 7a6 6 0 010 10M7 14l1 5h2l-.5-5"/>`,
  inbox: `<path d="M4 4h16v16H4zM4 14h5c0 1.7 1.3 3 3 3s3-1.3 3-3h5"/>`,
  autopilot: `<path d="M13 2L5 13h5l-1 9 8-11h-5l1-9z"/>`,
  activity: `<path d="M3 12h2l2-6 3 12 3-9 2 3h6"/>`,
  card: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M6 15h4"/>`,
  phonearrow: `<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2zM14 4h6M20 4v6M20 4l-6 6"/>`,
  calclock: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4M12 13v3l2 1"/>`,
  camera: `<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>`,
  pulse: `<path d="M3 12h3l2-5 3 10 2-5h8"/>`,
  // Finance tiles: these four match the SF Symbols the iOS tiles use, so the
  // same number wears the same icon on both apps (Kyle 2026-09-07).
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>`,
  hourglass: `<path d="M8 3.6v2.9l4 5.5 4-5.5V3.6z" style="fill:currentColor;stroke:none"/><path d="M6 3h12M6 21h12M8 3v3.5l4 5.5 4-5.5V3M8 21v-3.5l4-5.5 4 5.5V21"/>`,
  sealcheck: `<path d="M12 2.6l2.2 1.7 2.8-.2.9 2.6 2.3 1.5-1 2.6 1 2.6-2.3 1.5-.9 2.6-2.8-.2L12 21.4 9.8 19.7l-2.8.2-.9-2.6-2.3-1.5 1-2.6-1-2.6 2.3-1.5.9-2.6 2.8.2z"/><path d="M8.6 12.2l2.3 2.3 4.4-4.6"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`,
  tag: `<path d="M3 12V4h8l9 9-8 8-9-9z"/><circle cx="7.5" cy="8.5" r="1.3"/>`,
  bubble: `<path d="M4 5h11v8H8l-4 3V5z"/><path d="M15 9h5v8l-3-2h-6v-3"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>`,
  warn: `<path d="M12 3l10 18H2L12 3zM12 10v5M12 18v.5"/>`,
  phone: `<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>`,
  dollar: `<circle cx="12" cy="12" r="9"/><path d="M12 7v10M14.5 9.5c0-1.1-1.1-1.8-2.5-1.8s-2.5.7-2.5 1.8 1.1 1.6 2.5 1.9 2.5.8 2.5 1.9-1.1 1.8-2.5 1.8-2.5-.7-2.5-1.8"/>`,
  people: `<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 010 5.8M18 13.5c2 .8 3 2.6 3 5.5"/>`,
  grid: `<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>`,
  spark: `<path d="M12 3l2 5.6 5.6 2-5.6 2L12 18l-2-5.4-5.6-2 5.6-2z"/>`,
  bell: `<path d="M12 3a6 6 0 016 6v4l2 3H4l2-3V9a6 6 0 016-6zM9.5 19a2.5 2.5 0 005 0"/>`,
  star: `<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>`,
  car: `<path d="M5 13l1.5-5h11L19 13M4 13h16v5H4zM7 18v2M17 18v2"/><circle cx="7.5" cy="15.5" r="1"/><circle cx="16.5" cy="15.5" r="1"/>`,
  gear: `<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>`,
};
const segIc = (k) => SEG_ICONS[k] ? `<svg class="sic" viewBox="0 0 24 24">${SEG_ICONS[k]}</svg>` : "";

function osHead(code, title) {
  return `<div>
    <div class="oshead"><span class="dash"></span>
      <span class="code">${esc(code)}</span>
      <span class="eq"><i></i><i></i><i></i></span></div>
    <h2 class="ostitle">${esc(title)}</h2>
    <div class="osrule"></div>
  </div>`;
}

// CommandPageHeader's "quiet" style (Kyle, 2026-09-01 design pass): sentence-case
// title, no machine rail, no gradient, plus the same Ledger-chat shortcut every
// iOS tab carries so the assistant stays one tap away everywhere.
const QUIET_TITLES = new Set(["phone", "finance", "profit", "receipts", "calendar", "customers", "reviews", "to-do"]);
function pageHead(title) {
  return `<div class="qhead">
    <button class="qsparkle" data-qledger title="Chat with Ledger" aria-label="Chat with Ledger">${segIc("spark")}</button>
    <h2 class="qtitle">${esc(title)}</h2>
  </div>`;
}
// Delegated once at load — the four quiet tabs re-render their whole view()
// innerHTML on every load/refresh, so a per-render wire-up would need to run
// after each one. A single document-level listener survives every re-render.
document.addEventListener("click", (e) => { if (e.target.closest("[data-qledger]")) openChat(); });

function appView() {
  WAKE.ready = true; setTimeout(wakeSync, 800);
  const logo = S.profile?.business?.logo_url;
  root.innerHTML = `
  <header>
    <div class="mark"><img src="assets/logo-mark-96.png" alt=""></div>
    <h1 class="brandttl chrome" id="bizname">Ledger AI</h1>
    <span id="usage"></span>
    <button class="hchat" id="hchat" title="Ask Ledger" aria-label="Ask Ledger">&#128172;</button>
    <button class="avatar" id="more" title="Your business" aria-label="Your business"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="3.6" fill="currentColor"/><path d="M5.5 19.4c.9-3.2 3.5-5 6.5-5s5.6 1.8 6.5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>
  </header>
  <div id="alertbar"></div>
  <main id="view"></main>
  <nav id="tabs" aria-label="Main">${TABS.map((t) => `<button data-tab="${t.key}" class="${S.tab === t.key ? "on" : ""}"${S.tab === t.key ? ' aria-current="page"' : ""}>
      ${t.icon}${t.label}</button>`).join("")}</nav>
  <div id="chatwrap" role="dialog" aria-modal="true" aria-labelledby="chattitle">
    <header>
      <button class="pill" id="chatback">‹ Back</button>
      <h1 id="chattitle">Ask Ledger</h1>
      <span class="pill${S.advisor ? " on" : ""}" id="advisor" role="button" tabindex="0" aria-pressed="${S.advisor ? "true" : "false"}">💡 Advisor</span>
      <button class="pill" id="newconv" title="New conversation" aria-label="New conversation">✚</button>
    </header>
    <div id="banner">💡 Advisor Mode — business guidance beyond your books, on your AI allowance</div>
    <main id="chat" class="chatpane"></main>
    <footer><textarea id="box" rows="1" placeholder="Ask about your business…" aria-label="Ask about your business"></textarea><button id="send" aria-label="Send">↑</button></footer>
  </div>`;

  on("#tabs button", "click", (e) => setTab(e.currentTarget.dataset.tab));
  $("more").onclick = businessSheet;
  $("hchat").onclick = () => openChat();
  $("chatback").onclick = () => closeChat();
  $("newconv").onclick = newConversation;
  $("advisor").onclick = toggleAdvisor;
  $("advisor").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAdvisor(); } };
  const box = $("box");
  // A question typed and not yet sent survives closing the pane and a reload
  // of this tab (audit 11.2c); it is cleared the moment it is sent.
  box.value = accountStorage.getItem(CHAT_DRAFT_KEY) || "";
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  box.addEventListener("input", () => {
    box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 120) + "px";
    try { if (box.value.trim()) accountStorage.setItem(CHAT_DRAFT_KEY, box.value); else accountStorage.removeItem(CHAT_DRAFT_KEY); } catch {}
  });
  $("send").onclick = () => send();
  banner();
  if (!$("chat").childElementCount) {
    sys("Hi — I'm Ledger. Ask me anything about your business: sales, who owes you, your week ahead.");
    // Say what is actually connected instead of promising live books on an empty workspace.
    connectionStates().then(async (map) => {
      if (S.connError || map.quickbooks || map.google_calendar) return;
      if (S.booksProvider === undefined) {
        try { S.booksProvider = (await booksApi({ action: "settings" })).provider; } catch { S.booksProvider = "quickbooks"; }
      }
      if ($("chat").childElementCount !== 1) return;
      sys(S.booksProvider === "native"
        ? "Your built-in books are on. Already use QuickBooks? Choose it on the Home tab and I'll work from your real numbers."
        : "One thing left: choose your books on the Home tab — built-in books or QuickBooks — and I'll work from your real numbers.");
    });
  }
  renderTab();
  refreshUsage();
  billingCheck();
  applyLaunchIntent();
}

function setTab(key) {
  if (S.tab === key) {
    if (key === "home" || key === "finance" || key === "customers") S.qboStale = true;
    if (key === "calendar") S.cal = null;
    if (key === "finance") S.profitStale = true;
    if (key === "phone") S.phone = null;
    if (key === "customers") S.board = null;
  }
  S.tab = key;
  document.querySelectorAll("#tabs button").forEach((b) => {
    const on = b.dataset.tab === key;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  renderTab();
}

function view() { return $("view"); }
function skeleton(n = 3) { view().innerHTML = Array.from({ length: n }, () => `<div class="skel"></div>`).join(""); }

function renderTab() {
  view().scrollTop = 0;
  if (S.tab === "home") return renderHome();
  if (S.tab === "finance") return renderFinance();
  if (S.tab === "calendar") return renderCalendar();
  if (S.tab === "phone") return renderPhone();
  if (S.tab === "customers") return renderCustomers();
}

// Back from a connect started on the web (audit 10.3 / 10.8): every connector
// has a name and a "what happens now" line, and a failed return says why
// instead of a bare "try again". QuickBooks and Business Profile used to be
// labelled "Google Calendar" here.
const CONNECT_RETURN = {
  "gmail": { name: "Gmail", path: "/gmail", done: "Receipt Radar will start reading supplier receipts out of your inbox." },
  "google-calendar": { name: "Google Calendar", path: "/google-calendar", done: "Your bookings now show on the Calendar tab, and every booking Ledger proposes still needs your tap." },
  "google-business-profile": { name: "Business Profile", path: "/google-business-profile", done: "Your Google reviews are on the Customers tab, and every reply Ledger drafts still needs your tap." },
  "quickbooks": { name: "QuickBooks", path: "/quickbooks-oauth", done: "Your invoices, customers and numbers are on the Finance tab, and every post Ledger proposes still needs your tap." },
};
const CONNECT_REASONS = {
  missing_callback: "the sign-in page came back without an authorization.",
  invalid_state: "that sign-in session is no longer valid. Start again from Connect.",
  expired_state: "the secure sign-in session expired. Start again from Connect.",
  obsolete_flow: "an old sign-in page was rejected. Start again from Connect.",
  token_exchange: "authorization completed, but the secure token exchange failed.",
  secure_storage: "authorization completed, but the encrypted connection could not be saved.",
  storage_failed: "authorization completed, but the encrypted connection could not be saved.",
  missing_scope: "the permission it runs on was left unticked. Connect again and leave every box ticked.",
  api_access: "Google authorized the account, but Business Profile access was denied.",
  no_location: "no managed Google Business location was found on that account.",
  session_mismatch: "it was started from a different account, so it was not saved.",
};
function applyLaunchIntent() {
  const q = new URLSearchParams(location.search);
  const connected = q.get("connected");
  if (connected) {
    history.replaceState({}, "", location.pathname);
    const c = CONNECT_RETURN[connected] || { name: "That connection", path: null, done: "" };
    const status = q.get("status"), reason = q.get("reason") || "";
    const done = () => { if (connected === "google-business-profile" && reason === "choose_location") { toast("Google Business Profile connected — choose which listing Ledger posts to"); S.connMap = null; S.lane = "posts"; setTab("customers"); return; } toast(`${c.name} connected`); openChat(); sys(`✅ ${c.name} is connected. ${c.done}`); S.connMap = null; };
    const failed = (why) => toast(`${c.name} didn't connect — ${CONNECT_REASONS[why] || "please try again."}`, "err");
    // Session-bound completion (audit 10.7): the callback parked the tokens
    // under a single-use token; the row is only written now, by this signed-in
    // session, and only if it is the one that started the connect.
    if (status === "pending" && q.get("confirm") && c.path) {
      api(c.path + "/confirm", { confirm: q.get("confirm") }).then(done).catch((err) => failed(err.data?.code || ""));
      return;
    }
    if (status === "success") done();
    else failed(reason);
    return;
  }
  // Back from Stripe: say plainly whether the card went through and when the trial ends.
  const state = q.get("state");
  if (state === "success") {
    history.replaceState({}, "", location.pathname);
    api("/stripe-billing/status", {}).then((s) => {
      const confirmed = s.billing_source === "stripe" && s.card_on_file && ["active", "trialing"].includes(s.subscription_status) && s.access !== "locked";
      if (!confirmed) { openChat(); sys("Checkout returned, but your subscription is not confirmed yet. Refresh billing in Settings; do not purchase again."); return; }
      const when = s.trial_ends_at ? dateShort(s.trial_ends_at) : null;
      const msg = s.subscription_status === "trialing" && when
        ? `Card added. Your free trial runs until ${when}.`
        : "You're subscribed. Manage it any time under Business profile & settings.";
      openChat(); sys(msg); toast("Subscription confirmed");
    }).catch(() => { openChat(); sys("Billing confirmation is temporarily unavailable. Refresh billing in Settings; do not purchase again."); });
    return;
  }
  if (state === "cancelled") {
    history.replaceState({}, "", location.pathname);
    toast("No charge made — you can add a card any time from the Home tab.");
    return;
  }
  // Clean the URL before any layer pushes its history entry, so Back from the
  // chat lands on the plain app, never on a ?go= entry that would re-fire.
  if (q.get("go") || q.get("ask")) history.replaceState({}, "", location.pathname);
  if (q.get("go") === "chat") openChat();
  if (q.get("go") === "google_posts") { S.lane = "posts"; setTab("customers"); }
  const ask = q.get("ask");
  if (ask) { openChat(); $("box").value = ask; send(); }
}

/* ---------------- connection prompt ---------------- */
function connectPanel(kind) {
  const copy = {
    qbo: ["QuickBooks isn't connected", "Bring your invoices, customers and numbers in. Read and write, with every post confirmed by you.", "Connect QuickBooks", "/quickbooks-oauth/start"],
    calendar: ["Google Calendar isn't connected", "See your week and let Ledger book jobs for you — every booking still needs your tap.", "Connect Google Calendar", "/google-calendar/start"],
    gmail: ["Gmail isn't connected", "Receipt Radar reads supplier receipts out of your inbox and turns them into expenses.", "Connect Gmail", "/gmail/start"],
  }[kind];
  return `<div class="panel"><h3>${copy[0]}</h3><p class="sub">${copy[1]}</p>
    <button class="btn primary wide" style="margin-top:13px" data-connect="${copy[3]}">${copy[2]}</button></div>`;
}
function wireConnect(scope) {
  on("[data-connect]", "click", async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const path = b.dataset.connect;
    // web=1: land back on app.html, QuickBooks included (audit 10.3 — it used to
    // land desktop users on the iOS scheme). confirm=1: the callback parks the
    // tokens and this signed-in session writes the row via /confirm (audit 10.7).
    const launch = async (extra) => { const d = await api(path + "?web=1&confirm=1" + extra, {}); location.href = d.authorization_url; };
    try { await launch(""); }
    catch (err) {
      // One set of books (2026-09-05): built-in invoices go out of sight while
      // QuickBooks is on. Nothing is deleted — say so, then let the owner decide.
      if (err.status === 409 && err.data?.code === "native_documents_exist") {
        if (await askConfirm(friendlyError(err, "Invoices made in Ledger go out of sight while QuickBooks is on. Nothing is deleted."), { title: "Connect QuickBooks anyway?", ok: "Connect" })) {
          try { await launch("&acknowledge=native_hidden"); return; } catch (e2) { toast(friendlyError(e2, "Couldn't start the QuickBooks connection. Try again."), "err"); }
        }
        b.disabled = false; return;
      }
      b.disabled = false; toast(friendlyError(err, "Couldn't start the QuickBooks connection. Try again."), "err");
    }
  }, scope);
}

// Disconnect QuickBooks (2026-09-05): tokens are revoked at Intuit and
// forgotten here; the workspace goes back to built-in books. QuickBooks itself
// keeps every invoice. A reload afterwards because every screen caches the
// provider for the session.
function wireDisconnectQuickBooks(scope) {
  on("[data-qbo-disconnect]", "click", async (e) => {
    const b = e.currentTarget;
    if (!(await askConfirm("Ledger stops reading and writing your QuickBooks company and switches to built-in books. Your QuickBooks data stays in QuickBooks — nothing is deleted. You can reconnect any time.", { title: "Disconnect QuickBooks?", ok: "Disconnect", danger: true }))) return;
    b.disabled = true;
    try {
      await api("/quickbooks-oauth/disconnect", {});
      toast("QuickBooks disconnected — you're on built-in books");
      setTimeout(() => location.reload(), 900);
    } catch (err) { b.disabled = false; toast(friendlyError(err, "Couldn't disconnect QuickBooks. Nothing changed — try again."), "err"); }
  }, scope);
}

// Disconnect Gmail / Google Calendar / Business Profile (audit 10.2): the
// server revokes the grant at Google and forgets the tokens here. Nothing the
// connection produced is deleted — receipts, appointments and reviews stay.
const DISCONNECT_COPY = {
  gmail: "Disconnect Gmail?\n\nLedger stops reading your inbox for receipts and can no longer send from this address. Receipts already captured stay. You can reconnect any time.",
  google_calendar: "Disconnect Google Calendar?\n\nLedger stops reading and booking on this calendar and switches to the built-in calendar. Appointments already saved stay. You can reconnect any time.",
  google_business_profile: "Disconnect Business Profile?\n\nLedger stops reading and answering your Google reviews and posting updates. Nothing on your listing is changed. You can reconnect any time.",
};
function wireDisconnectConnector(scope, rerender) {
  on("[data-disconnect]", "click", async (e) => {
    const b = e.currentTarget, key = b.dataset.disconnect, c = CONNECTORS.find((x) => x.key === key);
    if (!c) return;
    if (!(await askConfirm(DISCONNECT_COPY[key] || `${c.name} stops working here. You can reconnect any time.`, { title: `Disconnect ${c.name}?`, ok: "Disconnect", danger: true }))) return;
    b.disabled = true;
    try {
      await api(c.start.replace(/\/start$/, "/disconnect"), {});
      toast(`${c.name} disconnected`);
      const latest = await connectionStates();
      if (rerender) rerender(latest);
    } catch (err) { b.disabled = false; toast(friendlyError(err, "Couldn't disconnect that service. Nothing changed — try again."), "err"); }
  }, scope);
}

/* ---------------- HOME ---------------- */
// The fixed showcase six — mirrors iOS LedgerHomeView.suggestedPrompts exactly
// (Kyle 2026-08-29, build 41): every chip demos a different capability, review
// AI front and centre, and each one is a question the assistant genuinely
// answers from live data.
const ASK_CHIPS = [
  { ic: "profit", label: "Profit today", prompt: "How much profit did we make today?" },
  { ic: "reviews", label: "Reply to a review", prompt: "Draft a reply to my latest Google review." },
  { ic: "card", label: "Who owes me?", prompt: "Who owes me money right now, biggest balance first?" },
  { ic: "phonearrow", label: "Chase my missed calls", prompt: "Show me my missed calls and which ones look like new leads." },
  { ic: "calclock", label: "Tomorrow's day", prompt: "What's booked on the calendar tomorrow?" },
  { ic: "camera", label: "File this receipt", prompt: "I've got a receipt to file — walk me through it." },
];

// Rotating examples in the Ask box — same list as iOS consolePlaceholders.
// Every one is a question the assistant genuinely answers from live data.
const ASK_PLACEHOLDERS = [
  "Tell Ledger what to do…",
  "“How much profit did we make today?”",
  "“Who owes me money right now?”",
  "“What's booked tomorrow?”",
  "“Show me my best customers this month.”",
  "“How do sales compare with last month?”",
  "“What needs my attention today?”",
  "“Draft a reply to my latest Google review.”",
];


/* ---------------- iOS-parity building blocks ----------------
   The web twins of LedgerSectionRail, LedgerPulseTile and LedgerPreviewCard
   (CameraAccess/Views/LedgerHomeView.swift). Same anatomy, same order, same
   words — so a customer moving between the phone and the browser is looking
   at one product, not two. */

/** Gradient icon plate + rounded label + fading hairline. */
function srail(icon, title, tone = "sil", trailing = "") {
  return `<div class="srail ${tone}">
    <div class="rw"><span class="ic">${segIc(icon)}</span><b>${esc(title)}</b>
      ${trailing ? `<span class="tr">${trailing}</span>` : ""}</div>
    <div class="hr"></div></div>`;
}

/** Instrument tile: plate, label, gradient numeral, caption, base rail. */
function ptile({ label, value, detail, icon, tone, loading = false, unavailable = false }) {
  const body = loading
    ? `<div class="skel" style="width:62px;height:22px;margin:2px 0"></div>`
    : `<b>${esc(value)}</b>`;
  return `<div class="ptile ${tone}${unavailable ? " na" : ""}">
    <div class="h"><i>${segIc(icon)}</i><small>${esc(label)}</small></div>
    ${body}<em>${esc(detail)}</em><div class="rail"></div></div>`;
}

/** One row inside a preview card. */
function pvline(primary, secondary, badge, icon, badgeRgb) {
  return `<div class="pvline">
    ${icon ? `<span class="pic">${segIc(icon)}</span>` : ""}
    <span class="m"><b>${esc(primary)}</b>${secondary ? `<small>${esc(secondary)}</small>` : ""}</span>
    ${badge ? `<span class="bdg"${badgeRgb ? ` style="--gt:${badgeRgb}"` : ""}>${esc(badge)}</span>` : ""}</div>`;
}

/** Section rail + rows + full-width gradient CTA, exactly like LedgerPreviewCard. */
function pvcard(id, icon, title, tone, cta, inner) {
  return `<div class="panel pvcard ${tone}" id="${id}">
    ${srail(icon, title, tone)}
    <div class="pvbody">${inner}</div>
    <button class="pvcta" data-pv="${id}">${esc(cta)} <span>&#8594;</span></button></div>`;
}

/** Three small stats in a row — the web twin of iOS phoneStat(). */
function pvstats(items) {
  return `<div class="pvstats">${items.map(([v, l, c]) =>
    `<div class="pvstat"><b style="color:${c}">${esc(v)}</b><small>${esc(l)}</small></div>`).join("")}</div>`;
}

async function renderHome() {
  const logo = S.profile?.business?.logo_url;
  homeSrc = null; // one fetch per source per render, shared by every card below
  // Section order is the iPhone app's, line for line (LedgerHomeView.body):
  // banner → hero → profile & settings → Ask Ledger → Go to → Today → reviews →
  // needs your attention → Calendar → Phone → Finance → Customers → Inbox → safety.
  // Parity pass (Kyle 1202, 2026-09-06): "Get set up" stays and is ported to the
  // iPhone; "Ledger's next move", the VIN row and the ONLINE tag are gone because
  // the iPhone never had them. The camera glyph in the Ask box is decoration on
  // both platforms — the box opens chat, the Receipts tile files receipts.
  view().innerHTML = `
    <div class="sect">
      <div id="homebanner"></div>
      <div class="brandcard">
        <div class="tile">${logo ? `<img src="${esc(logo)}" alt="">` : '<img src="assets/logo-mark-96.png" alt="">'}</div>
        <div class="who"><b class="chrome" id="heroname">${esc(S.profile?.business?.name || "Ledger AI")}</b><span>Your business, answered.</span>
          <div class="status inline"><i></i>Ready</div></div>
      </div>

      <div id="hometrial"></div><div id="homesetup"></div>

      <button class="bizrow" id="bizsettings">
        <span class="ic">${segIc("gear")}</span>
        <span class="m"><b>Business profile &amp; settings</b><small>Connections · branding · team</small></span>
        <span class="go">&#8599;</span>
      </button>

      <div class="console">
        <div class="chead">
          <b>Ask Ledger</b>
          ${S.voice?.available
            ? `<button class="livepill" id="livebtn"><span class="wv"><i></i><i></i><i></i><i></i></span>Live</button>`
            : `<span class="livepill off" id="livebtn" role="status" title="${esc(S.voice?.message || "Ledger Live is paused.")}">Live · paused</span>`}
        </div>
        <div class="askfield">
          <span class="sparkicon">&#10022;</span>
          <input id="askbox" placeholder="Tell Ledger what to do…" autocomplete="off">
          <span class="camic" aria-hidden="true">${segIc("camera")}</span>
          <button class="gobtn" id="askgo" title="Send" aria-label="Send">&#8593;</button>
        </div>
        <div class="askgrid">${ASK_CHIPS.map((c, i) =>
          `<button class="askchip c${i}" data-ask="${esc(c.prompt)}"><em>${segIc(c.ic)}</em>${esc(c.label)}</button>`).join("")}</div>
      </div>

      ${srail("grid", "Go to", "sil")}
      <div class="gotogrid">
        ${[
          ["finance", "em", "dollar", "Finance", "Profit · jobs · inventory", "", false],
          ["calendar", "purple", "calendar", "Calendar", "Bookings", "gobdg-calendar", false],
          ["phone", "cyan", "phone", "Phone", "Calls · leads", "gobdg-phone", false],
          ["customers", "red", "people", "Customers", "Directory", "", true],
          ["receipts", "orange", "camera", "Receipts", "Snap · file", "", true],
          ["reviews", "gold", "star", "Reviews", "Win 5 stars", "", true],
        ].map(([k, tint, icon, label, sub, bdg, quiet]) => `<button class="gotile ${tint}${quiet ? " q" : ""}" data-goto="${k}">
          <span class="ictile">${segIc(icon)}</span>${bdg ? `<span class="bdg" id="${bdg}" hidden></span>` : ""}<span class="arrow">&#8599;</span>
          <b>${label}</b><small>${sub}</small></button>`).join("")}
      </div>

      ${srail("pulse", "Today", "cy", `<span id="homeupdated"></span>`)}
      <div id="homekpis"><div class="ptiles">
        <div class="skel" style="height:100px"></div><div class="skel" style="height:100px"></div>
        <div class="skel" style="height:100px"></div><div class="skel" style="height:100px"></div></div></div>
      <div id="homereviews"></div>
      <div id="homeattn"></div>
      <div id="homecal"></div>
      <div id="homephone"></div>
      <div id="homefin"></div>
      <div id="homecust"></div>
      <div id="homemail"></div>
      <div class="safety"><span class="ic">&#128737;</span>Ledger is available from every tab and still follows all confirmation and safety rules.</div>
    </div>`;
  const box = $("askbox");
  const fire = () => {
    const q = box.value.trim();
    openChat();
    if (q) { $("box").value = q; box.value = ""; send(); }
  };
  $("askgo").onclick = fire;
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fire(); } });
  // Rotate the example questions like iOS does. One timer app-wide; it stops
  // itself the moment the box leaves the DOM (tab switch re-renders the view).
  clearInterval(S.askRotTimer);
  let askRot = 0;
  S.askRotTimer = setInterval(() => {
    const el = $("askbox");
    if (!el) { clearInterval(S.askRotTimer); return; }
    askRot = (askRot + 1) % ASK_PLACEHOLDERS.length;
    el.placeholder = ASK_PLACEHOLDERS[askRot];
  }, 3500);
  // Ledger Live (realtime voice) — same OpenAI Realtime session the iPhone app
  // opens, over the browser's own WebRTC (Kyle 2026-09-02, web parity). While
  // voice is paused the pill is a label, not a door (audit 16-04).
  if (S.voice?.available) $("livebtn").onclick = () => liveSheet();
  else $("livebtn").onclick = () => toast(S.voice?.message || "Ledger Live is temporarily paused. Typed chat is still available.");
  $("bizsettings").onclick = () => businessSheet();
  on("[data-goto]", "click", (e) => {
    const k = e.currentTarget.dataset.goto;
    if (k === "receipts") { S.financeLane = "receipts"; setTab("finance"); }
    else if (k === "reviews") { S.lane = "reviews"; setTab("customers"); }
    else if (k === "finance") { S.financeLane = "invoices"; setTab("finance"); }
    else if (k === "customers") { S.lane = "directory"; setTab("customers"); }
    else setTab(k);
  });
  on("[data-ask]", "click", (e) => { openChat(); $("box").value = e.currentTarget.dataset.ask; send(); });
  loadHomeTrial(), loadHomeSetup();
  loadHomeKpis();
  loadHomeReviewsPulse();
  loadHomeAttention();
  loadHomeCalendar();
  loadHomePhone();
  loadHomeFinance();
  loadHomeCustomers();
  loadHomeMail();
}

/* ---------------- home data sources ----------------
   One fetch per source per render, shared by every card (KPIs, attention,
   previews). A failed fetch clears its memo so a Retry button re-runs it. */
let homeSrc = null;
function homeSources() {
  if (homeSrc) return homeSrc;
  const once = (fn) => { let p = null; return () => (p ||= fn().catch((e) => { p = null; throw e; })); };
  homeSrc = {
    books: once(() => homeBooksKpis()),
    cal: once(async () => { if (!S.cal) S.cal = await get("/google-calendar/events"); return S.cal; }),
    phone: once(async () => { if (!S.phone) S.phone = await api("/phone", { action: "board" }); return S.phone; }),
    review: once(async () => { if (!S.review) S.review = await get("/profit/review"); return S.review; }),
    profit: once(async () => {
      if (!S.profit || S.profitStale) { S.profit = (await get("/profit/board")).board || {}; S.profitStale = false; }
      return S.profit;
    }),
  };
  return homeSrc;
}

/** iOS loadingBanner / errorBanner: "Pulling your books…" on the first pull, Retry when it fails. */
function homeBanner(state, msg) {
  const el = $("homebanner"); if (!el) return;
  if (state === "loading") el.innerHTML = `<div class="hbanner"><span class="spin"></span><span>Pulling your books…</span></div>`;
  else if (state === "error") el.innerHTML = `<div class="hbanner err"><span class="ic">&#9888;</span>
      <span class="m"><b>Couldn't reach your books</b><small>${esc(msg || "")}</small></span>
      <button class="retry" id="homeretry">Retry</button></div>`;
  else el.innerHTML = "";
  const r = $("homeretry");
  if (r) r.onclick = () => { S.qboStale = true; S.nativeSummary = null; S.nativeInvoiceList = null; S.profitStale = true; renderHome(); };
}

/** Count badge on a Go-to tile (iOS LedgerShortcutTile.badge). */
function goBadge(id, n) { const el = $(id); if (!el) return; el.hidden = !(n > 0); el.textContent = n > 99 ? "99" : String(n); }

/** Count badge on a tab-bar button (iOS `.badge(phoneWaiting)` on the Phone tab). */
function tabBadge(key, n) {
  const b = document.querySelector(`#tabs button[data-tab="${key}"]`); if (!b) return;
  let el = b.querySelector(".cnt");
  if (!(n > 0)) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("span"); el.className = "cnt"; b.appendChild(el); }
  el.textContent = n > 99 ? "99+" : String(n);
}

/** iOS ledgerCompactMoney: "$12.5k" from ten thousand up, whole dollars below. */
function compactMoney(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 10000) return "$" + (n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "k";
  return money0(n);
}

/** iOS ledgerRelative (abbreviated): "5 min ago", "2 hr ago", "yesterday". */
function relTime(iso) {
  const t = Date.parse(iso || ""); if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** iOS StarMeter: five stars, lit to the rating. */
function starMeter(r) {
  const n = Math.max(0, Math.min(5, Math.round(Number(r) || 0)));
  return "&#9733;".repeat(n) + `<span style="opacity:.25">${"&#9733;".repeat(5 - n)}</span>`;
}

/** A card that couldn't load: the message plus Retry — the web's pull-to-refresh. */
function pvretry(msg) { return `<p class="pvempty err">${esc(msg)}</p><button class="retry" data-retry>Retry</button>`; }
function wireRetry(scope, fn) { const b = scope.querySelector("[data-retry]"); if (b) b.onclick = (e) => { e.stopPropagation(); fn(); }; }

/* ---------------- home preview cards ----------------
   One per tab, in the iPhone app's order. Each is allowed to fail on its own:
   a workspace with no calendar still gets a full Home. */

function wirePv(id, go) {
  const el = document.querySelector(`[data-pv="${id}"]`);
  if (el) el.onclick = go;
}

// Google reviews pulse — hidden entirely until Business Profile is connected,
// exactly like iOS. Home never nags about a connector nobody asked for.
async function loadHomeReviewsPulse() {
  const slot = $("homereviews"); if (!slot) return;
  // iOS reviewsPulseStrip: rail + "N to answer" tag, big rating, star meter,
  // review count, the latest comment. Hidden entirely until Google Business
  // Profile is connected — home never nags.
  try {
    const board = (await get("/google-business-profile/reviews?limit=10")).reviews;
    const unanswered = Number(board.unanswered_count) || 0;
    S.revUnanswered = unanswered;
    accountStorage.removeItem("kmj.gbpOff");
    const avg = Number(board.average_rating) || 0;
    const total = Number(board.total_review_count ?? board.total_count) || 0;
    const latest = (board.items || []).find((r) => r.comment);
    slot.innerHTML = `<button class="panel pvcard gd rvpulse" id="rvpulse">
      ${srail("star", "Google reviews", "gd", `<span class="bdg" style="--gt:${unanswered ? "251,146,60" : "26,230,148"}">${unanswered ? `${unanswered} to answer` : "All replied"}</span><span class="arrow">&#8599;</span>`)}
      <div class="rvrow">
        <b class="rvbig">${avg > 0 ? avg.toFixed(1) : "—"}</b>
        <span class="m"><span class="starrow sm">${starMeter(avg)}</span><small>${total} Google review${total === 1 ? "" : "s"}</small></span>
      </div>
      ${latest ? `<p class="rvquote">&ldquo;${esc(latest.comment)}&rdquo;</p>` : ""}
    </button>`;
    const pulse = slot.querySelector("#rvpulse");
    if (pulse) pulse.onclick = () => { S.lane = "reviews"; setTab("customers"); };
  } catch (e) {
    slot.innerHTML = "";
    S.revUnanswered = 0;
    if (e && (e.status === 409 || e.status === 403)) accountStorage.setItem("kmj.gbpOff", "1");
  }
}

async function loadHomeCalendar() {
  const slot = $("homecal"); if (!slot) return;
  let inner;
  try {
    const cal = await homeSources().cal();
    const up = cal?.calendar?.upcoming || [];
    const total = Number(cal?.calendar?.upcoming_count ?? up.length);
    // A real glimpse of the day: the next three, the first one badged "Next".
    inner = up.length
      ? up.slice(0, 3).map((e, i) => pvline(e.title || "Untitled appointment",
          [e.all_day ? dateShort(e.start) : `${dateShort(e.start)} · ${timeLabel(e.start)}`, e.location].filter(Boolean).join(" · "),
          i === 0 ? "Next" : null, i === 0 ? "calclock" : "calendar")).join("") +
        (total > 3 ? `<p class="pvempty">+ ${total - 3} more upcoming</p>` : "")
      : `<p class="pvempty">Nothing booked yet.</p>`;
  } catch (e) {
    inner = /not connected/i.test(e.message)
      ? `<p class="pvempty">Google Calendar isn't connected yet — connect it in Business profile &amp; settings and your week lands here.</p>`
      : pvretry("Couldn't load your calendar.");
  }
  slot.innerHTML = pvcard("pvcal", "calendar", "Calendar", "pu", "View Calendar", inner);
  wirePv("pvcal", () => setTab("calendar"));
  wireRetry(slot, () => { S.cal = null; homeSrc = null; loadHomeCalendar(); });
}

async function loadHomePhone() {
  const slot = $("homephone"); if (!slot) return;
  let inner;
  try {
    const d = await homeSources().phone();
    if (!d.hasNumber) {
      inner = `<p class="pvempty">No business number connected yet — set one up in Phone.</p>`;
    } else {
      const m = d.metrics || {};
      inner = pvstats([
        [String(m.missedToday ?? 0), "missed today", (m.missedToday ?? 0) > 0 ? "var(--orange)" : "var(--dim)"],
        [String(m.leads7d ?? 0), "leads · 7d", "var(--cyan)"],
        [String(m.awaitingReply ?? 0), "awaiting reply", (m.awaitingReply ?? 0) > 0 ? "var(--orange)" : "var(--dim)"],
      ]);
      // Newest call, like iOS: one date parse per event, newest wins.
      const newest = (d.events || [])
        .map((r) => ({ r, t: Date.parse(r.occurredAt || "") || 0 }))
        .sort((a, b) => b.t - a.t)[0]?.r;
      if (newest) {
        const status = newest.answered ? "Answered" : (newest.direction === "inbound" ? "Missed" : "Outgoing");
        inner += `<div class="pvdiv"></div>` + pvline(newest.callerName || newest.callerNumber || "Unknown caller",
          [status, relTime(newest.occurredAt)].filter(Boolean).join(" · "), "Newest",
          newest.answered ? "phone" : "phonearrow", newest.answered ? "26,230,148" : "251,146,60");
      }
    }
    tabBadge("phone", (d.needsYou || []).length);
  } catch { inner = pvretry("Couldn't load phone activity."); }
  slot.innerHTML = pvcard("pvphone", "phone", "Phone", "cy", "Open Phone", inner);
  wirePv("pvphone", () => setTab("phone"));
  wireRetry(slot, () => { S.phone = null; homeSrc = null; loadHomePhone(); });
}

async function loadHomeFinance() {
  const slot = $("homefin"); if (!slot) return;
  const current = nativeBooksViewRead(slot);
  let inner;
  try {
    const k = await homeSources().books();
    inner = pvstats([
      [compactMoney(k.today_sales), "sales today", "var(--emerald)"],
      [compactMoney(k.month_sales), "month to date", "var(--cyan)"],
      [compactMoney(k.outstanding), "outstanding", Number(k.outstanding) > 0 ? "var(--orange)" : "var(--dim)"],
    ]) + (Number(k.outstanding) > 0
      ? `<p class="pvempty">${k.open_count || 0} invoice${(k.open_count || 0) === 1 ? "" : "s"} still unpaid.</p>` : "");
  } catch { inner = pvretry(S.booksProvider === "native" ? "Couldn't reach your books." : "Couldn't reach QuickBooks."); }
  if (!current()) return;
  slot.innerHTML = pvcard("pvfin", "dollar", "Finance", "em", "Open Finance", inner);
  wirePv("pvfin", () => { S.financeLane = "invoices"; setTab("finance"); });
  wireRetry(slot, () => { S.qboStale = true; S.nativeSummary = null; S.nativeInvoiceList = null; homeSrc = null; loadHomeFinance(); });
}

async function loadHomeCustomers() {
  const slot = $("homecust"); if (!slot) return;
  let inner;
  try {
    const rows = await homeCustomers();
    if (!rows.length) {
      inner = `<p class="pvempty">${S.booksProvider === "native"
        ? "No customers yet — add one with your first invoice, or ask Ledger in chat."
        : "No customers in QuickBooks yet."}</p>`;
    } else {
      // iOS customersPreview: name, "Added · $ open" line, then View Customer
      // and Ask for Review on every row. Nothing sends on render — the review
      // sheet is the intentional act.
      const asked = reviewAsked();
      inner = rows.slice(0, 3).map((c, i) => {
        const parts = [];
        if (c.created_at) parts.push(`Added ${dateShort(c.created_at)}`);
        if (Number(c.balance) > 0) parts.push(`${money(c.balance)} open`);
        if (!parts.length && c.email) parts.push(c.email);
        const was = asked.has(String(c.id));
        return `${i ? `<div class="pvdiv"></div>` : ""}${pvline(c.name || "(no name)", parts.join(" · "), null, "people")}
          <div class="pvbtns">
            <button class="pvbtn cy" data-viewcust="${esc(c.id)}">&#8599;&nbsp; View Customer</button>
            <button class="pvbtn ${was ? "em" : "gd"}" data-askreview="${esc(c.id)}">${was ? "&#10003;&nbsp; Asked" : "&#9733;&nbsp; Ask for Review"}</button>
          </div>`;
      }).join("");
    }
  } catch { inner = pvretry(S.booksProvider === "native" ? "Couldn't load your customer list." : "Couldn't reach QuickBooks."); }
  slot.innerHTML = pvcard("pvcust", "people", "Recent customers", "pk", "View All Customers", inner);
  wirePv("pvcust", () => { S.lane = "directory"; setTab("customers"); });
  wireRetry(slot, () => { S.qboStale = true; S.nativeCustomers = null; S.nativeInvoiceList = null; homeSrc = null; loadHomeCustomers(); });
  on("[data-viewcust]", "click", () => { S.lane = "directory"; setTab("customers"); }, slot);
  on("[data-askreview]", "click", async (e) => {
    const id = e.currentTarget.dataset.askreview;
    const c = (await homeCustomers()).find((x) => String(x.id) === id);
    if (c) reviewSheet(c, reviewAsked().has(String(c.id)));
  }, slot);
}

/** Today's numbers from whichever book the workspace runs on. */
async function homeBooksKpis() {
  if (S.booksProvider === undefined) {
    S.booksProvider = (await booksApi({ action: "settings" })).provider;
  }
  if (S.booksProvider === "native") {
    // A fresh, complete server snapshot owns balances AND sales in the business
    // time zone. No retained invoice page can override half of this response.
    const revision=nativeBooksRevision;
    const n=await booksApi({action:"summary"});
    if (revision!==nativeBooksRevision) throw new Error("Your books changed. Please refresh.");
    if (![n.today_sales,n.month_sales,n.ytd_sales,n.open_balance,n.open_invoices].every(Number.isFinite)) throw new Error("Your complete financial summary is unavailable.");
    return {...n,outstanding:n.open_balance,open_count:n.open_invoices,today_profit:null,profit_margin:null};
  }
  if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
  return S.qbo?.qbo?.kpis || {};
}

/** Newest customers first, from whichever book is live. */
async function homeCustomers() {
  if (S.booksProvider === undefined) {
    S.booksProvider = (await booksApi({ action: "settings" })).provider;
  }
  if (S.booksProvider === "native") {
    if (!S.nativeCustomers) {
      const rows = (await booksApi({ action: "customers" })).customers;
      if(!Array.isArray(rows)) throw new Error("Your customer list could not be read. Try again.");
      S.nativeCustomers = rows.map((c) => ({
        ...c,
        name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "\u2014",
      }));
    }
    return S.nativeCustomers;
  }
  if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
  const all = [...(S.qbo?.qbo?.customers || [])];
  // Decorate once, then sort — the same fix build 74 shipped on iOS after date
  // parsing inside the comparator stalled the main thread on a 1,000-row book.
  return all
    .map((row) => ({ row, t: row.created_at ? Date.parse(row.created_at) : NaN, seq: Number(row.id) || -Infinity }))
    .sort((a, b) => {
      if (!Number.isNaN(a.t) && !Number.isNaN(b.t) && a.t !== b.t) return b.t - a.t;
      if (Number.isNaN(a.t) !== Number.isNaN(b.t)) return Number.isNaN(a.t) ? 1 : -1;
      return b.seq - a.seq;
    })
    .map((d) => d.row);
}

// ---------------- Business profile (#6B 2026-09-05; universal 2026-09-13, Kyle 1202) ----------------
// One screen that fits the app to the business and briefs the copilot and the
// Front Desk: what kind of business, one line in the owner's words, the
// services with price and time, the hours (the ONE hours setting the booking
// gate and the phone line read), the service area, and the province for tax.
// business_type is the one answer that changes screens: only "automotive"
// shows VIN scan, vehicle lookup, tire fitment and "vehicle" on bookings. A
// workspace that has not said yet is a generic service business — never auto.
// Only the first question is required; everything else saves when given.
const isAuto = () => S.shop?.business_type === "automotive";
const BUSINESS_TYPES = [
  ["automotive", "Auto & tire", "e.g. Mobile tire shop in south Calgary — passenger and light truck"],
  ["trades", "Trades", "e.g. Residential HVAC — furnaces, AC and hot water tanks, 24-hour service"],
  ["beauty", "Beauty & personal care", "e.g. Hair salon — colour, cuts and extensions, four stylists"],
  ["health", "Health & wellness", "e.g. Physiotherapy clinic — sports injuries and post-surgery rehab"],
  ["home", "Home & property", "e.g. Residential cleaning — weekly and move-out cleans, Calgary NW"],
  ["professional", "Professional services", "e.g. Bookkeeping for small trades businesses — monthly packages"],
  ["fitness", "Fitness & coaching", "e.g. Personal training studio — one-on-one and small group"],
  ["pets", "Pet care", "e.g. Dog grooming — full grooms, baths and nail trims, by appointment"],
  ["other", "Something else", "What you do, in one line"],
];
const TYPE_LABEL = Object.fromEntries(BUSINESS_TYPES.map(([v, l]) => [v, l]));
const SHOP_MORE = [
  { key: "pricing_model", q: "How do you charge?", opts: [["flat", "Flat price per job"], ["hourly", "Hourly + parts"], ["mix", "A mix"]] },
  { key: "customer_mix", q: "Who do you serve?", opts: [["individuals", "Mostly individuals"], ["businesses", "Mostly businesses"], ["both", "Both"]] },
  { key: "team_size", q: "How big is the team?", opts: [["solo", "Just me"], ["small", "2–5"], ["large", "6+"]] },
  { key: "intake_channels", q: "How does work come in?", multi: true, opts: [["phone", "Phone"], ["text", "Text"], ["online", "Online"], ["walkin", "Walk-in"]] },
];
const REGIONS = [["", "Choose…"], ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
  ["US", "United States"]];
function shopSummary(sp) {
  if (!sp?.completed) return "Tell Ledger what you do — two minutes";
  const n = (sp.services || []).length;
  return [TYPE_LABEL[sp.business_type] || "Business", sp.business_description ? sp.business_description.slice(0, 60) : "",
    n ? `${n} service${n === 1 ? "" : "s"}` : "", sp.hours_text || ""].filter(Boolean).join(" · ");
}
const blankService = () => ({ name: "", price: "", duration_minutes: "" });
// Audit 04-06: IANA zones for the business-profile picker. The browser's full
// list when it has one; otherwise the launch-geography zones. The saved zone
// and the device zone are always present so the current pick never vanishes.
const SHOP_TZ_FALLBACK = ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC"];
function shopTimezoneOptions(current) {
  let zones = [];
  try { zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []; } catch { zones = []; }
  if (!zones.length) zones = SHOP_TZ_FALLBACK;
  const device = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
  const all = [...new Set([current || "", device, ...zones].filter(Boolean))];
  const label = (z) => {
    let off = "";
    try { off = new Intl.DateTimeFormat("en-CA", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || ""; } catch {}
    return `${z.replace(/_/g, " ")}${off ? ` (${off})` : ""}${z === device ? " · this device" : ""}`;
  };
  return all.sort((a, b) => a.localeCompare(b)).map((z) => [z, label(z)]);
}
function shopProfileSheet(onDone, opts = {}) {
  const cur = { ...(S.shop || {}) };
  const picked = { intake_channels: [...(cur.intake_channels || [])] };
  for (const q of SHOP_MORE) if (!q.multi && cur[q.key]) picked[q.key] = cur[q.key];
  if (cur.business_type) picked.business_type = cur.business_type;
  const svc = (cur.services || []).map((s) => ({ id: s.id, name: s.name || "", price: s.price ?? "", duration_minutes: s.duration_minutes ?? "" }));
  while (svc.length < 3) svc.push(blankService());
  const removed = [];
  const hours = cur.business_hours && Object.values(cur.business_hours).some(Boolean) ? { ...cur.business_hours }
    : Object.fromEntries(HOUR_DAYS.map(([k]) => [k, k === "sat" || k === "sun" ? null : { open: "08:00", close: "17:00" }]));
  const placeholderFor = (t) => (BUSINESS_TYPES.find(([v]) => v === t) || BUSINESS_TYPES[BUSINESS_TYPES.length - 1])[2];
  const chips = (key, q) => `<div class="cmpsect" data-q="${key}">
      <label class="fld">${esc(q.q)}</label>
      <div class="chips" style="display:flex;flex-wrap:wrap;gap:8px">${q.opts.map(([v, l]) => {
        const on = q.multi ? picked.intake_channels.includes(v) : picked[key] === v;
        return `<button type="button" class="chip${on ? " on" : ""}" data-v="${v}">${esc(l)}</button>`; }).join("")}</div>
      ${q.hint ? `<p class="note" style="margin-top:6px">${esc(q.hint)}</p>` : ""}
    </div>`;
  const svcRow = (s, i) => `<div class="svcrow" data-i="${i}" style="display:grid;grid-template-columns:1.7fr .75fr .6fr 26px;gap:6px;align-items:center;margin-top:6px">
      <input class="cmpinput" data-sn placeholder="Service or product" maxlength="200" value="${esc(String(s.name ?? ""))}">
      <input class="cmpinput" data-sp type="number" min="0" step="0.01" inputmode="decimal" placeholder="Price" value="${esc(String(s.price ?? ""))}">
      <input class="cmpinput" data-sd type="number" min="5" max="1440" step="5" inputmode="numeric" placeholder="Minutes" value="${esc(String(s.duration_minutes ?? ""))}">
      <button type="button" class="linkbtn" data-sx title="Remove" aria-label="Remove this line" style="font-size:20px;line-height:1;padding:0">&times;</button></div>`;
  const first = !!opts.firstRun;
  sheet(`<h2>${first ? `Welcome — tell Ledger about ${esc(opts.bizName || "your business")}` : "Your business"}</h2>
    <p class="sh-sub">Tell Ledger what you do, then review your services, prices, taxes and hours before using them with customers. Phone features need a paid plan and activation; the trial includes a sample walkthrough.</p>
    ${chips("business_type", { q: "What kind of business?", opts: BUSINESS_TYPES.map(([v, l]) => [v, l]) })}
    <div class="cmpsect">
      <label class="fld">In one line, what do you do?</label>
      <input id="shopdesc" class="cmpinput" maxlength="240" value="${esc(cur.business_description || "")}" placeholder="${esc(placeholderFor(picked.business_type))}">
      <p class="note" style="margin-top:6px">Ledger describes you to customers from this, so say it the way you would.</p>
    </div>
    <div class="cmpsect">
      <label class="fld">Your services and prices</label>
      <div style="display:grid;grid-template-columns:1.7fr .75fr .6fr 26px;gap:6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);padding:0 4px"><span>Service</span><span>Price $</span><span>Minutes</span><span></span></div>
      <div id="svcbox">${svc.map(svcRow).join("")}</div>
      <button type="button" class="linkbtn" id="svcadd" style="margin-top:8px">+ Add another</button>
      <p class="note" style="margin-top:6px">Price before tax, and how many minutes each one takes. These become your price list — invoices, quotes and the Front Desk all use them. Long list? Use Bring your data → Service menu, then review the saved prices and durations.</p>
    </div>
    <div class="cmpsect">
      <label class="fld">When are you open?</label>
      ${HOUR_DAYS.map(([k, l]) => { const h = hours[k]; return `<div class="hourrow" data-hday="${k}">
        <label class="hourtoggle"><input type="checkbox" data-hon="${k}" ${h ? "checked" : ""}> <b>${l}</b></label>
        <span class="hourtimes" ${h ? "" : "hidden"}><input type="time" data-hopen="${k}" value="${esc(h?.open || "08:00")}"> <em>to</em> <input type="time" data-hclose="${k}" value="${esc(h?.close || "17:00")}"></span>
      </div>`; }).join("")}
      <p class="note" style="margin-top:6px">Bookings, your booking page and your phone line all follow these hours. Change them any time here or in Calendar.</p>
    </div>
    <div class="cmpsect">
      <label class="fld">Your time zone</label>
      <select id="shoptz" class="cmpinput">${cur.timezone ? "" : `<option value="" selected>Keep the current setting</option>`}${shopTimezoneOptions(cur.timezone).map(([v, l]) => `<option value="${esc(v)}"${v === (cur.timezone || "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <p class="note" style="margin-top:6px">Your hours, Front Desk appointment times and customer reminders are read in this zone. It was set from the device you signed up on${cur.timezone ? ` (currently ${esc(cur.timezone)})` : ""}.</p>
    </div>
    <div class="cmpsect">
      <label class="fld">Where do you work?</label>
      <input id="shoparea" class="cmpinput" maxlength="200" value="${esc(cur.service_area || "")}" placeholder="e.g. In our shop at 123 Main St · Calgary and Airdrie · we come to you">
    </div>
    <div class="cmpsect">
      <label class="fld">Where are you?</label>
      <select id="shopregion" class="cmpinput">${REGIONS.map(([v, l]) => `<option value="${v}"${(cur.region_code || "") === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <p class="note" style="margin-top:6px">Suggests a starting tax setup. Review your registration, tax rates and exemptions in Books settings before your first invoice.</p>
    </div>
    <details${SHOP_MORE.some((q) => (q.multi ? picked.intake_channels.length : picked[q.key])) ? " open" : ""}><summary class="eyebrow" style="cursor:pointer;margin:12px 0 4px">More about you (optional)</summary>
      ${SHOP_MORE.map((q) => chips(q.key, q)).join("")}
    </details>
    <button class="btn primary wide" style="margin-top:14px" id="shopsave">${first ? "Finish setup →" : "Save"}</button>
    ${first ? `<button class="btn ghost wide" style="margin-top:8px" id="shopskip">Skip for now</button>` : ""}
    <div class="note" id="shopnote" style="margin-top:9px"></div>`, (sh) => {
    const note = sh.querySelector("#shopnote"), btn = sh.querySelector("#shopsave"), box = sh.querySelector("#svcbox");
    const readSvc = () => [...box.querySelectorAll(".svcrow")].forEach((row) => {
      const s = svc[Number(row.dataset.i)]; if (!s) return;
      s.name = row.querySelector("[data-sn]").value; s.price = row.querySelector("[data-sp]").value; s.duration_minutes = row.querySelector("[data-sd]").value;
    });
    const wireSvc = () => box.querySelectorAll("[data-sx]").forEach((x) => x.onclick = () => {
      readSvc();
      const i = Number(x.closest(".svcrow").dataset.i);
      if (svc[i]?.id) removed.push(svc[i].id);
      svc.splice(i, 1); if (!svc.length) svc.push(blankService());
      box.innerHTML = svc.map(svcRow).join(""); wireSvc();
    });
    wireSvc();
    sh.querySelector("#svcadd").onclick = () => {
      readSvc(); svc.push(blankService()); box.innerHTML = svc.map(svcRow).join(""); wireSvc();
      box.querySelector(".svcrow:last-child [data-sn]")?.focus();
    };
    sh.querySelectorAll(".chip").forEach((c) => c.onclick = () => {
      const key = c.closest("[data-q]").dataset.q, v = c.dataset.v;
      note.textContent = "";
      if (key === "intake_channels") {
        c.classList.toggle("on");
        picked.intake_channels = [...c.parentElement.querySelectorAll(".chip.on")].map((x) => x.dataset.v);
      } else {
        c.parentElement.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on"); picked[key] = v;
        if (key === "business_type") { const d = sh.querySelector("#shopdesc"); if (d) d.placeholder = placeholderFor(v); }
      }
    });
    sh.querySelectorAll("[data-hon]").forEach((c) => c.onchange = () => {
      sh.querySelector(`.hourrow[data-hday="${c.dataset.hon}"] .hourtimes`).hidden = !c.checked;
    });
    const skip = sh.querySelector("#shopskip");
    if (skip) skip.onclick = () => { closeSheet(); if (onDone) onDone(false); };
    btn.onclick = async () => {
      if (!picked.business_type) { note.className = "note err"; note.textContent = "Pick what kind of business you run — the rest can wait."; return; }
      readSvc();
      const services = svc.filter((s) => String(s.name).trim()).map((s) => ({
        id: s.id, name: String(s.name).trim(), price: Number(s.price) || 0, duration_minutes: s.duration_minutes ? Number(s.duration_minutes) : null,
      }));
      const business_hours = {};
      for (const [k] of HOUR_DAYS) {
        const on = sh.querySelector(`[data-hon="${k}"]`).checked;
        business_hours[k] = on ? { open: sh.querySelector(`[data-hopen="${k}"]`).value || "08:00", close: sh.querySelector(`[data-hclose="${k}"]`).value || "17:00" } : null;
      }
      const region = sh.querySelector("#shopregion").value;
      // Audit 04-06: the zone is sent only when the owner changed it, so an
      // older server that ignores the field still saves everything else.
      const tzPick = sh.querySelector("#shoptz").value;
      const tzChanged = tzPick && tzPick !== (cur.timezone || "");
      btn.disabled = true; note.className = "note"; note.textContent = "Saving…";
      try {
        const r = await api("/workspace-profile", {
          action: "shop-profile-save", ...picked,
          business_description: sh.querySelector("#shopdesc").value.trim(),
          service_area: sh.querySelector("#shoparea").value.trim(),
          business_hours: Object.values(business_hours).some(Boolean) ? business_hours : null,
          services, remove_service_ids: removed, region_code: region,
          ...(tzChanged ? { timezone: tzPick } : {}),
        });
        S.shop = r.shop_profile;
        if (r.shop_profile?.timezone) S.businessTimezone = r.shop_profile.timezone;
        if (S.profile) S.profile.business = { ...(S.profile.business || {}), ...r };
        try { CAL.hours = null; } catch {}
        const tax = r.tax_set ? ` Suggested sales tax: ${r.tax_set.name} ${(r.tax_set.rate * 100).toFixed(r.tax_set.rate * 100 % 1 ? 3 : 0)}%.` : (r.us_region ? " Add your state's sales tax in Books settings." : "");
        closeSheet(); toast("Got it — Ledger knows your business now." + tax);
        if (onDone) onDone(true); else { S.cal = null; setTab("home"); }
      } catch (e) { btn.disabled = false; note.className = "note err"; note.textContent = e.message; }
    };
  });
}

// Three-step setup checklist at the top of Home for a workspace that is not
// fully set up: books, calendar, card. Every step deep-links to the action.
// Disappears on its own when all three are done, or when the owner hides it.
const SETUP_HIDE_KEY = "ledger.setupHidden";
async function loadHomeSetup() {
  const slot = $("homesetup"); if (!slot) return;
  if (accountStorage.getItem(SETUP_HIDE_KEY) === "1") return;
  // Instant open (Kyle 2026-09-08): the checklist used to appear only after
  // three round trips and then shove the page down when it landed. The last
  // known shape paints straight from storage; the network only corrects it.
  const SETUP_CACHE_KEY = "ledger.setup.v1";
  let cachedSetup = null;
  try { cachedSetup = JSON.parse(accountStorage.getItem(SETUP_CACHE_KEY) || "null"); } catch {}
  if (cachedSetup) paint(cachedSetup.shop, cachedSetup.books, cachedSetup.cal, cachedSetup.paid,
                         cachedSetup.trialLine, cachedSetup.stalled, cachedSetup.billingReady, cachedSetup.complimentary);
  let map = {}, bill = null, bs = null;
  try {
    [map, bill, bs] = await Promise.all([
      connectionStates(), api("/stripe-billing/status", {}).catch(() => null),
      booksApi({ action: "settings" }).catch(() => null),
    ]);
  } catch {}
  if (!$("homesetup")) return;
  if (S.connError || !bill || !bs) {
    slot.innerHTML = '<div class="panel"><p class="note">Setup status is temporarily unavailable. Your saved settings are unchanged.</p><button class="btn ghost" id="setupretry">Retry setup status</button></div>';
    slot.querySelector("#setupretry").onclick = loadHomeSetup; return;
  }
  // Step 1 is a CHOICE, not a QuickBooks nag (2026-09-05): QuickBooks connected
  // or built-in books picked on purpose both count as done.
  const books = !!map.quickbooks || !!bs?.chosen;
  const cal = !!map.google_calendar && map.google_calendar.last_error_code !== "needs_reconnect";
  // A card on file during the trial IS the card step done — offering "Add
  // card" again opened a second Checkout (sim bug 1, double-billing risk).
  const paid = !!bill && (["active", "past_due"].includes(bill.subscription_status) || !!bill.card_on_file);
  const shop = !!S.shop?.completed;
  const billingReady = !!bill?.billing_ready;
  const complimentary = bill?.complimentary_access === true;
  // Google Calendar is optional since the built-in calendar (2026-09-13): it never blocks "set up".
  if (shop && books && paid) { slot.innerHTML = ""; try { accountStorage.removeItem(SETUP_CACHE_KEY); } catch {} return; }
  // Stalled = still not set up a day after signing up. Only then offer the
  // founder's calendar — most shops never need the call (Kyle, 2026-09-05).
  const since = S.profile?.business?.member_since ? Date.parse(S.profile.business.member_since) : Date.now();
  const stalled = Date.now() - since > 24 * 3600 * 1000;
  const trialLine = complimentary ? "Complimentary test access — no card or automatic subscription charge." : bill?.subscription_status === "trialing" && bill.trial_ends_at
    ? `Free until ${dateShort(bill.trial_ends_at)} — add a card so nothing stops on day 15.` : "Keep Ledger running after your trial.";
  try { accountStorage.setItem(SETUP_CACHE_KEY, JSON.stringify({ shop, books, cal, paid, trialLine, stalled, billingReady, complimentary })); } catch {}
  paint(shop, books, cal, paid, trialLine, stalled, billingReady, complimentary);

  // Everything below only draws. It is a named function so the cached shape
  // above can paint the card before a single request has come back.
  function paint(shop, books, cal, paid, trialLine, stalled, billingReady, complimentary = false) {
    const step = (done, num, title, detail, action) => `<div class="setupstep${done ? " done" : ""}">
        <span class="num">${done ? "&#10003;" : num}</span>
        <span class="m"><b>${title}</b><small>${detail}</small></span>
        ${done ? "" : action}</div>`;
    slot.innerHTML = `<div class="setupcard">
      <div class="lanehead" style="margin-top:0"><span class="eyebrow">&#9889; Get set up</span><button class="pill" id="setuphide" title="Hide">Hide</button></div>
      ${step(shop, 1, "Tell Ledger about your business", shop ? "" : "Add your services, reviewed prices and hours. Check your first invoice and appointment before using Ledger with customers.",
        `<button class="btn primary" id="setupshop">Start</button>`)}
      ${step(books, 2, "Choose your books", books ? "" : `Already on QuickBooks? Connect it. Otherwise Ledger's built-in books handle invoices, estimates and payment links.
          <span style="display:flex;gap:8px;margin-top:9px"><button class="btn primary" data-connect="/quickbooks-oauth/start">QuickBooks</button><button class="btn ghost" id="setupnative">Built-in books</button></span>`, "")}
      ${step(cal, 3, "Google Calendar (optional)", "Ledger has its own calendar, so booking already works. Connect Google if you also want your appointments there.",
        `<button class="btn ghost" data-connect="/google-calendar/start">Connect</button>`)}
      ${step(paid, 4, complimentary ? "Complimentary Solo access" : "Add a card", trialLine,
        billingReady && !inAndroidApp() ? `<button class="btn ghost" id="setupcard">Add card</button>` : "")}
      ${stalled ? `<p class="note" style="margin-top:10px">Stuck? <a href="https://heyledger.ai/talk" target="_blank" rel="noopener">Book 15 minutes with the founder</a> and he'll walk you through it.</p>` : ""}
    </div>`;
    wireConnect(slot);
    const shopBtn = slot.querySelector("#setupshop");
    if (shopBtn) shopBtn.onclick = () => shopProfileSheet(() => { S.cal = null; setTab("home"); });
    const native = slot.querySelector("#setupnative");
    if (native) native.onclick = async () => {
      native.disabled = true;
      try {
        await booksApi({ action: "provider-choose", provider: "native" });
        S.booksProvider = "native";
        toast("Built-in books it is — invoices and estimates are ready in Finance");
        loadHomeSetup();
      } catch (e) { native.disabled = false; toast(friendlyError(e, "Couldn't switch to built-in books. Try again."), "err"); }
    };
    const hide = slot.querySelector("#setuphide");
    if (hide) hide.onclick = () => { accountStorage.setItem(SETUP_HIDE_KEY, "1"); slot.innerHTML = ""; };
    const card = slot.querySelector("#setupcard");
    if (card) card.onclick = async () => {
      card.disabled = true;
      try { const c = await startCheckout(); location.href = c.url; }
      catch (e) { card.disabled = false; if (!e.cancelled) toast(friendlyError(e, "Couldn't open checkout. Nothing was charged — try again."), "err"); }
    };
  }
}

// Business profile & settings hub — the web twin of the iOS settings row (build 41).
// Each row deep-links to the surface that already owns that setting.
// One settings surface (2026-09-02): the gear row and the avatar open the same
// sheet. "Connected services" used to bounce to the Reviews page — dead end.
async function bizSettingsSheet() { return businessSheet(); }

function kpiBlock(k) {
  // The four instrument tiles from the iPhone app's businessPulse, same order,
  // same labels, same captions.
  const pct = (v) => v == null ? null : `${Number(v).toFixed(1).replace(/\.0$/, "")}% margin`;
  const profit = k.today_profit;
  const down = !!k.booksDown;
  return `<div class="ptiles">
    ${ptile({ label: "Sales today", value: down ? "—" : compactMoney(k.today_sales),
              detail: down ? "Books unreachable" : `${compactMoney(k.month_sales)} this month`, icon: "dollar", tone: "em", unavailable: down })}
    ${ptile({ label: "Est. profit", value: profit == null ? "—" : compactMoney(profit),
              detail: profit == null ? "Capture costs in Finance → Profit" : (pct(k.profit_margin) || "sales minus captured costs"),
              icon: "profit", tone: "cy", unavailable: profit == null })}
    ${ptile({ label: "Appointments", value: k.appointments == null ? "—" : String(k.appointments),
              detail: k.appointments == null ? "Calendar unreachable" : (k.appointments === 0 ? "Nothing booked" : "Upcoming"),
              icon: "calendar", tone: "pu", unavailable: k.appointments == null })}
    ${ptile({ label: "Missed calls", value: k.missed == null ? "—" : String(k.missed),
              detail: k.missed == null ? "Phone unreachable" : `${k.leads7d || 0} leads in 7 days`,
              icon: "phonearrow", tone: "or", unavailable: k.missed == null })}
  </div>`;
}

async function loadHomeKpis() {
  const slot = $("homekpis"); if (!slot) return;
  const src = homeSources();
  // Books, calendar and phone each answer for their own tile. One dead
  // connector greys one number — it never blanks the row.
  const cached = S.booksProvider === "native" ? !!S.nativeSummary : (!!S.qbo && !S.qboStale);
  if (!cached) homeBanner("loading");
  let booksErr = null;
  const [books, cal, phone] = await Promise.all([
    src.books().catch((e) => { booksErr = e; return null; }),
    src.cal().catch(() => null),
    src.phone().catch(() => null),
  ]);
  if (!$("homekpis")) return;
  homeBanner(books ? "" : "error", booksErr?.message);
  const k = { ...(books || {}), booksDown: !books };
  // Est. profit on a QuickBooks shop comes from the profit board — the iPhone's
  // loadQboProfit. The QuickBooks snapshot carries a placeholder zero there,
  // which used to read as "$0 · 0% margin" on every web Home.
  // The profit board is books-aware server-side (invoices as income, captured
  // receipts as cost on a Ledger-books shop), so both providers get a real
  // "Est. profit" instead of a dash on one of them.
  if (books) {
    k.today_profit = null; k.profit_margin = null;
    try {
      const t = (await src.profit())?.today;
      if (t && t.net_profit != null) {
        k.today_profit = Number(t.net_profit);
        k.profit_margin = Number(t.total_income) > 0 ? Number(t.net_profit) / Number(t.total_income) * 100 : null;
      }
    } catch { /* unresolved reads "—", exactly like iOS */ }
  }
  k.appointments = cal ? Number(cal.calendar?.upcoming_count ?? (cal.calendar?.upcoming || []).length) : null;
  k.missed = phone?.hasNumber ? (phone.metrics?.missedToday ?? 0) : (phone ? 0 : null);
  k.leads7d = phone?.metrics?.leads7d ?? 0;
  if (!$("homekpis")) return;
  slot.innerHTML = kpiBlock(k);
  // "Updated" is when the books were pulled, not when the page drew.
  const gen = S.booksProvider === "native" ? null : S.qbo?.generated_at;
  const up = $("homeupdated");
  if (up) up.textContent = gen ? `Updated ${new Date(gen).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "";
  // Go-to badges (iOS LedgerShortcutTile): upcoming bookings, missed calls today.
  goBadge("gobdg-calendar", k.appointments || 0);
  goBadge("gobdg-phone", phone?.hasNumber ? (phone.metrics?.missedToday ?? 0) : 0);
  // Phone tab badge = the "needs you" count, the same number the iPhone tab wears.
  if (phone) tabBadge("phone", (phone.needsYou || []).length);
}

/* ---------------- cost review queue ----------------
   One question per VENDOR, asked once — never a nightly roll-call of the day's
   invoices. A vendor nobody has classified has its cost parked in 'other' and
   left off the board; unanswered, that exclusion is silent and the profit
   number reads high. Answering once reclassifies every invoice that supplier
   has ever sent, so this queue burns down to nothing after the first week. */
const COST_CLASS_LABELS = [
  ["tires_parts", "Goods I resell", "Stock, parts, materials that go out the door on a job"],
  ["shop_supplies", "Shop supplies", "Consumables used up doing the work"],
  ["software", "Software", "Subscriptions and tools"],
  ["advertising", "Advertising", "Marketing and job ads"],
  ["other", "Something else", "Captured, but kept off the cost board"],
];
const EXCEPTION_LABELS = {
  possible_duplicate: "May already be captured — choose the existing receipt before adding another cost",
  no_doc_number: "No invoice number found — can't be matched to the books",
  no_amount: "No total could be read off this document",
};

async function openCostReview() {
  let review = S.review;
  const render = () => {
    const vendor = (review.vendors || [])[0];
    const exceptions = review.exceptions || [];
    if (!vendor && !exceptions.length) {
      sheet(`<h2>Nothing to review</h2>
        <p class="sh-sub">Every supplier the app has seen is classified.</p>`);
      return;
    }

    if (vendor) {
      // Amount is shown but never pre-selects a class. A default here would be
      // a guess wearing the costume of an answer, which is the exact thing this
      // queue exists to remove.
      sheet(`<h2>${esc(vendor.vendor)}</h2>
        <p class="sh-sub">${vendor.invoice_count} invoice${vendor.invoice_count === 1 ? "" : "s"}
          · latest ${money(vendor.recent_amount)} · first seen ${esc(vendor.first_seen)}</p>
        <div class="note" style="margin-bottom:12px">${esc(vendor.sample_subject || vendor.sample_doc_number || "")}</div>
        <p style="font-weight:600;margin:0 0 8px">What do you buy here?</p>
        ${COST_CLASS_LABELS.map(([key, label, hint]) => `
          <button class="attnrow" data-cc="${key}" style="width:100%;margin-bottom:8px">
            <span class="m"><b>${esc(label)}</b><span>${esc(hint)}</span></span>
            <span class="chev">&#8250;</span>
          </button>`).join("")}
        <label class="note" style="display:flex;gap:9px;align-items:center;margin-top:6px">
          <input type="checkbox" id="onacct">
          <span>I pay this vendor later on a statement (not at the till)</span>
        </label>
        <p class="sh-sub" style="margin-top:12px">${review.vendor_count} vendor${review.vendor_count === 1 ? "" : "s"} left
          · answered once, applied to every invoice they've sent</p>`, (sh) => {
        on("[data-cc]", "click", async (e) => {
          const costClass = e.currentTarget.dataset.cc;
          const onAccount = Boolean(sh.querySelector("#onacct")?.checked);
          const group = sh.querySelectorAll("[data-cc]");
          group.forEach((b) => b.disabled = true);
          try {
            const d = await api("/profit/classify-vendor", {
              vendor_key: vendor.vendor_key, cost_class: costClass, on_account: onAccount,
            });
            review = d.review; S.review = d.review; S.profitStale = true;
            toast(`${vendor.vendor} classified — ${d.reclassified} invoice${d.reclassified === 1 ? "" : "s"} updated`);
            render(); loadHomeAttention();
          } catch (err) { toast(friendlyError(err, "Couldn't save that vendor rule. Try again."), "err"); group.forEach((b) => b.disabled = false); }
        }, sh);
      });
      return;
    }

    sheet(`<h2>Flagged invoices</h2>
      <p class="sh-sub">Costs the app could not file on its own. Dismiss what doesn't matter.</p>
      ${exceptions.map((x) => `<div class="note" style="margin-bottom:9px">
          <b>${esc(x.vendor || "(unknown vendor)")}</b> ${x.amount ? "· " + money(x.amount) : ""} ${x.date ? "· " + esc(x.date) : ""}
          <div style="margin:4px 0 8px">${esc(EXCEPTION_LABELS[x.reason] || x.reason)}</div>
          <div style="opacity:.7;font-size:12px">${esc(x.subject || "")}</div>
          <button class="btn ghost" data-dis="${x.id}" style="margin-top:9px">Dismiss</button>
        </div>`).join("")}`, (sh) => {
      on("[data-dis]", "click", async (e) => {
        e.currentTarget.disabled = true;
        try {
          const d = await api("/profit/dismiss-exception", { id: e.currentTarget.dataset.dis });
          review = d.review; S.review = d.review; render(); loadHomeAttention();
        } catch (err) { toast(friendlyError(err, "Couldn't dismiss that item. Try again."), "err"); e.currentTarget.disabled = false; }
      }, sh);
    });
  };

  try {
    if (!review) { review = await get("/profit/review"); S.review = review; }
    render();
  } catch (e) { toast(friendlyError(e, "Couldn't load the profit review. Pull down to refresh."), "err"); }
}

// Mirrors the iOS attention center: the list is built live from phone, books,
// cost review and calendar, with a count pill on the rail. An empty list is
// "all clear" only when every source actually answered.
async function loadHomeAttention() {
  const slot = $("homeattn"); if (!slot) return;
  const src = homeSources();
  let reviewFailed = false;
  const [books, phone, review, cal] = await Promise.all([
    src.books().catch(() => null),
    src.phone().catch(() => null),
    src.review().catch(() => { reviewFailed = true; return null; }),
    src.cal().catch(() => null),
  ]);
  if (!$("homeattn")) return;
  const n = (v, w) => `${v} ${w}${v === 1 ? "" : "s"}`;
  const items = [];
  const m = phone?.metrics || {};
  if (m.missedToday > 0) items.push({ tint: "orange", icon: "phonearrow", title: n(m.missedToday, "missed call"), detail: "Today — not yet returned", go: () => setTab("phone") });
  if (m.voicemailsUnheard > 0) items.push({ tint: "orange", icon: "mic", title: `${n(m.voicemailsUnheard, "voicemail")} unheard`, detail: "Waiting on you", go: () => setTab("phone") });
  if (m.awaitingReply > 0) items.push({ tint: "orange", icon: "bubble", title: `${n(m.awaitingReply, "conversation")} awaiting reply`, detail: "Customer is waiting", go: () => setTab("phone") });
  const openCount = Number(books?.open_count) || 0;
  if (openCount > 0) items.push({ tint: "yellow", icon: "card", title: n(openCount, "unpaid invoice"), detail: `${money(books.outstanding)} outstanding`, go: () => { S.financeLane = "invoices"; setTab("finance"); } });
  if (review?.open_count) {
    items.push({ tint: "yellow", icon: "tag", title: "Cost review",
      detail: `${n(review.vendor_count, "vendor")} to classify${review.exception_count ? ` · ${review.exception_count} flagged` : ""}`,
      go: () => openCostReview() });
  } else if (reviewFailed) {
    items.push({ tint: "orange", icon: "warn", title: "Cost review", detail: "Couldn't check — tap to retry",
      go: () => { S.review = null; homeSrc = null; loadHomeAttention(); } });
  }
  const missing = Number(books?.missing_cost_count) || 0;
  if (missing > 0) items.push({ tint: "yellow", icon: "search", title: `${n(missing, "cost")} to verify`, detail: "Profit can't be trusted until these are matched", go: () => { S.financeLane = "profit"; setTab("finance"); } });
  const next = (cal?.calendar?.upcoming || [])[0];
  if (next) {
    const dt = (Date.parse(next.start) - Date.now()) / 1000;
    if (dt < 3600 && dt > -900) items.push({ tint: "purple", icon: "calclock", title: "Appointment starting soon",
      detail: `${next.title || "Untitled appointment"} · ${timeLabel(next.start)}`, go: () => setTab("calendar") });
  }
  const sourcesDown = (!books && S.booksProvider !== "native") || !phone;
  const clear = !items.length && !sourcesDown;
  const tone = clear ? "em" : "or";
  let body;
  if (clear) {
    body = `<div class="attnclear"><span class="ok">&#10003;</span><span class="m"><b>You're all clear</b><small>Nothing is waiting on you right now.</small></span></div>`;
  } else if (!items.length) {
    body = `<div class="attnclear warn"><span class="ok">&#9888;</span><span class="m"><b>Can't confirm you're clear</b><small>One or more sources didn't answer.</small></span><button class="retry" data-retry>Retry</button></div>`;
  } else {
    body = `<div class="attnrows">${items.map((it, i) => `<button class="attnrow ${it.tint}" data-attn="${i}">
      <span class="ic">${segIc(it.icon)}</span>
      <span class="m"><b>${esc(it.title)}</b><span>${esc(it.detail)}</span></span>
      <span class="chev">&#8250;</span></button>`).join("")}</div>`;
  }
  slot.innerHTML = `<div class="panel pvcard ${tone}">
    ${srail("bell", "Needs your attention", tone, items.length ? `<span class="attncnt">${items.length}</span>` : "")}
    ${body}</div>`;
  on("[data-attn]", "click", (e) => items[Number(e.currentTarget.dataset.attn)].go(), slot);
  wireRetry(slot, () => { S.qboStale = true; S.phone = null; S.review = null; homeSrc = null; loadHomeAttention(); });
}

// iOS inboxPreview: the card is always there — a connect prompt when Gmail
// isn't linked, the newest three otherwise, unread tag + refresh on the rail.
async function loadHomeMail() {
  const slot = $("homemail"); if (!slot) return;
  const connectCopy = `<p class="pvempty">Connect Gmail and your latest emails appear here with Ask Ledger built in.</p>`;
  let body, unread = 0;
  try {
    const d = await get("/gmail/inbox?limit=10");
    S.emails = d.emails || [];
    unread = S.emails.filter((x) => x.unread).length;
    body = S.emails.length
      ? S.emails.slice(0, 3).map((x, i) => `<button class="mailrow" data-mail="${i}">
          <span class="dot ${x.unread ? "" : "read"}"></span>
          <span class="m"><b class="${x.unread ? "un" : ""}">${esc(x.from_name || x.from || x.from_email || "(unknown sender)")}</b><span>${esc(x.subject || "(no subject)")}</span></span>
          <span class="chev">&#8250;</span></button>`).join("")
      : connectCopy;
  } catch (e) {
    body = /not connected/i.test(e.message) ? connectCopy : pvretry("Couldn't load your latest emails.");
  }
  if (!slot.isConnected) return;
  slot.innerHTML = `<div class="panel pvcard rd inboxcard">
    ${srail("inbox", "Inbox", "rd", `<span class="bdg" style="--gt:${unread ? "255,107,107" : "194,209,230"}">${unread ? `${unread} unread` : "Clear"}</span><button class="rfbtn" id="mailrefresh" title="Refresh inbox">&#8635;</button>`)}
    <div class="pvbody">${body}</div></div>`;
  on("[data-mail]", "click", (e) => emailSheet(S.emails[Number(e.currentTarget.dataset.mail)]), slot);
  const mailRefresh = slot.querySelector("#mailrefresh");
  if (mailRefresh) mailRefresh.onclick = (e) => { e.stopPropagation(); loadHomeMail(); };
  wireRetry(slot, () => loadHomeMail());
}

async function emailSheet(m) {
  sheet(`<h2>${esc(m.subject || "(no subject)")}</h2>
    <p class="sh-sub">${esc(m.from_name || "")} ${esc(m.from || m.from_email || "")} · ${esc(dayLabel(m.date || m.received_at))}</p>
    <div id="mailbody" class="note" style="white-space:pre-wrap;max-height:40dvh;overflow:auto">Loading…</div>
    <div class="rowbtns" style="margin-top:14px">
      <button class="btn ghost" id="askmail">Ask Ledger</button>
      <button class="btn primary" id="replymail">Draft reply</button>
    </div>`, async (sh) => {
    sh.querySelector("#askmail").onclick = () => { closeSheet(); openChat(); $("box").value = `About the email "${m.subject}" (id ${m.id}) — what should I know?`; send(); };
    sh.querySelector("#replymail").onclick = () => { closeSheet(); openChat(); $("box").value = `Draft a reply to email id ${m.id}.`; send(); };
    try {
      const d = await get("/gmail/message?id=" + encodeURIComponent(m.id));
      const body = sh.querySelector("#mailbody");
      if (body) body.textContent = (d.email?.body || d.body || "").slice(0, 6000) || "(empty message)";
    } catch (e) { const body = sh.querySelector("#mailbody"); if (body) body.textContent = e.message; }
  });
}

/* ---------------- FINANCE ---------------- */
const FINANCE_CODE = { invoices: "INVOICES", profit: "PROFIT & LOSS", receipts: "RECEIPTS" };
/* ---------------- native books (built-in ledger, no QuickBooks) ---------------- */
// Workspaces with books_provider="native" run on the books edge fn instead of
// QBO. The Finance tab swaps its invoices lane for these screens; Profit (a QBO
// P&L board) is hidden, Receipts stays — the receipt pipeline is native already.

let nativeBooksRevision = 0;
const nativeBooksReads = new WeakMap();
// A response owns only the still-mounted view and request that started it.
// Mutations invalidate reads even when their reply is lost after a commit.
function nativeBooksViewRead(slot) {
  const request = {}, revision = nativeBooksRevision;
  nativeBooksReads.set(slot, request);
  return () => revision === nativeBooksRevision && nativeBooksReads.get(slot) === request
    && slot.isConnected && $(slot.id) === slot;
}
function invalidateNativeBooks() {
  nativeBooksRevision++;
  S.nativeSummary=null; S.nativeInvoiceList=null; S.nativeCustomers=null; homeSrc=null;
}
async function booksApi(body) {
  const mutates = /^(payment-(record|reverse)|invoice-(create|void)|estimate-(create|convert|void|status)|settings-save|customer-save|provider-choose)$/.test(body.action);
  if (mutates) invalidateNativeBooks();
  try {
    const result=await api("/books",body);
    if (!result || typeof result!=="object") throw new Error("Your books are unavailable. Please retry.");
    if(result.timezone) S.businessTimezone=result.timezone;
    return result;
  } finally {
    if (mutates) {
      invalidateNativeBooks();
      // Refresh even for an ambiguous write outcome; retry still uses the
      // same durable request, never another payment or document.
      if (S.tab === "finance" && S.booksProvider === "native") {
        if (S.financeLane === "estimates") void loadNativeEstimates();
        else if (!S.financeLane || S.financeLane === "invoices") void loadNativeInvoices();
      } else if (S.tab === "home") void loadHomeFinance();
    }
  }
}

// SALES INTELLIGENCE hero for native books — the web twin of iOS's Finance
// Overview card. Every figure comes from the live invoice rows (voids
// excluded): month-to-date total, a 14-day daily spark, MOM/YOY growth against
// the SAME elapsed span, the real average sale, and a straight run-rate
// forecast. "—" when there is no prior period to compare against.
// Built-in books store an issued invoice as "sent" (it is issued, not
// necessarily emailed). Owners read SENT as "emailed" — show OPEN instead.
// One word for both the list and the detail sheet: a created invoice is OPEN
// until an email or text has actually gone out, then SENT (sim bug 5).
function nativeStatusLabel(doc) {
  const status = typeof doc === "string" ? doc : (doc?.status || "");
  if (status !== "sent") return status;
  const went = typeof doc === "object" && doc && (doc.sent_at || doc.email_sent_at || doc.sms_sent_at);
  return went ? "sent" : "open";
}

function salesIntelNative(invoices) {
  const now = new Date(businessDay() + "T00:00:00Z");
  const sales = invoices.filter((i) => i.status !== "void");
  const dayTotal = (key) => sales.filter((i) => (i.issue_date || "").slice(0, 10) === key)
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  const rangeTotal = (from, to) => sales.filter((i) => {
    const d = (i.issue_date || "").slice(0, 10);
    return d >= from && d <= to;
  }).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  const ym = iso(now).slice(0, 7);
  const month = sales.filter((i) => (i.issue_date || "").slice(0, 7) === ym);
  const mtd = month.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const avg = month.length ? mtd / month.length : 0;
  const elapsed = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  // A run rate off one or two invoices in the first days of a month reads as
  // broken ("$24,727 from one sale"). Show it once there is a week of data or
  // five invoices — whichever comes first.
  const forecastReady = elapsed >= 7 || month.length >= 5;
  const forecast = elapsed ? mtd / elapsed * daysInMonth : 0;
  // Same elapsed span, one month back / one year back.
  const prevM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMEnd = new Date(Date.UTC(prevM.getUTCFullYear(), prevM.getUTCMonth(),
    Math.min(elapsed, new Date(Date.UTC(prevM.getUTCFullYear(), prevM.getUTCMonth() + 1, 0)).getUTCDate())));
  const momBase = rangeTotal(iso(prevM), iso(prevMEnd));
  const ytd = rangeTotal(now.getUTCFullYear() + "-01-01", iso(now));
  const prevY = new Date(now); prevY.setUTCFullYear(now.getUTCFullYear() - 1);
  const yoyBase = rangeTotal((now.getUTCFullYear() - 1) + "-01-01", iso(prevY));
  // Year over year on this card means the same month a year ago, so it can sit
  // beside "This month" honestly — same rule as the QuickBooks card.
  const lastYearMonthStart = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1));
  const yoyMonthBase = rangeTotal(iso(lastYearMonthStart), iso(prevY));
  const growth = (cur, base) => base > 0
    ? `${cur >= base ? "+" : "−"}${Math.abs(Math.round((cur - base) / base * 100))}%` : "—";
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const t = new Date(now); t.setUTCDate(now.getUTCDate() - d);
    days.push({ key: iso(t), total: dayTotal(iso(t)) });
  }
  const max = Math.max(1, ...days.map((d) => d.total));
  return `<div class="intel">
    <div class="ihead"><b>&#9651; Sales</b><span class="live"><i></i>Built-in books</span></div>
    <p class="cap">This month · incl. tax</p>
    <div class="big">${money(mtd)}</div>
    <div class="sub">Invoiced this month, sales tax included &mdash; the Profit board shows sales before tax</div>
    <div class="salespark">${days.map((d, i) =>
      `<div class="b ${i === days.length - 1 ? "hot" : ""}" style="height:${Math.max(Math.round(d.total / max * 100), 3)}%" title="${d.key}: ${money0(d.total)}"></div>`).join("")}</div>
    <div class="sparkends"><span>14 days ago</span><span>Today</span></div>
    <div class="kpis" style="margin-top:15px">
      <div class="kpi cyan"><small>Month over month</small><b>${growth(mtd, momBase)}</b><i>vs same point last month</i></div>
      <div class="kpi purple"><small>Year over year</small><b>${growth(mtd, yoyMonthBase)}</b><i>vs same point last year</i></div>
      <div class="kpi em"><small>Average sale</small><b>${money(avg)}</b><i>${month.length} invoice${month.length === 1 ? "" : "s"} this month</i></div>
      <div class="kpi orange"><small>Forecast</small><b>${forecastReady ? money(forecast) : "—"}</b><i>${forecastReady ? "month-end run rate" : "after a week of sales"}</i></div>
    </div>
    <p class="infoline"><em>&#9432;</em>Growth compares matching elapsed periods &mdash; not partial months against full months.</p>
  </div>`;
}

// The seam between "create" and "find" on the Finance screen (Kyle 1202,
// 2026-09-07, msg #11498). The divider IS the money: every dollar still owed,
// split into three mutually exclusive aging bands that add up to outstanding,
// each band and legend tapping through to the identical chip filter beneath it
// (they carry data-if, so the chip handler already wired below drives them).
// Under the plinth the floor drops, so the search and list read as a lower
// deck. iPhone twin: `FinanceMoneySeam` in CommandDashboardView.swift — same
// bands, same rules, same words.
function moneySeam(rows, issuedKey) {
  const today = businessDay();
  const cut = businessDay(new Date(), -30);
  let current = 0, late = 0, over30 = 0;
  for (const i of rows) {
    const bal = Number(i.balance) || 0;
    if (bal <= 0 || i.status === "void" || i.status === "paid") continue;
    const issued = String(i[issuedKey] || "");
    if (issued && issued < cut) over30 += bal;
    else if (i.due_date && i.due_date < today) late += bal;
    else current += bal;
  }
  const total = current + late + over30;
  const bands = [["open", "Current", current, "cur"], ["late", "Late", late, "lt"], ["over30", "Over 30", over30, "o30"]];
  const legend = bands.map(([k, label, amt, cls]) =>
    `<button class="sl ${amt > 0.005 ? "" : "off"}" data-if="${k}" aria-label="${label} ${money(amt)}, show these invoices">
      <small><i class="${cls}"></i>${label}</small><b>${money(amt)}</b></button>`).join("");
  let rail = "";
  const live = bands.filter((b) => b[2] > 0.005);
  if (live.length) {
    // A floor so a small band stays visible, with the surplus shaved off
    // whatever sits above it, so the widths always add up to the rail.
    const floorPct = 6;
    let w = live.map((b) => Math.max((b[2] / total) * 100, floorPct));
    for (let pass = 0; pass < 5; pass++) {
      const over = w.reduce((a, b2) => a + b2, 0) - 100;
      if (over <= 0.01) break;
      const slack = w.map((x) => Math.max(x - floorPct, 0));
      const pool = slack.reduce((a, b2) => a + b2, 0);
      if (pool <= 0.01) break;
      w = w.map((x, idx) => x - over * (slack[idx] / pool));
    }
    rail = `<div class="seamrail">${live.map((b, idx) =>
      `<button class="sb ${b[3]}" data-if="${b[0]}" style="width:calc(${w[idx].toFixed(2)}% - 2px)" aria-hidden="true" tabindex="-1"></button>`).join("")}</div>`;
  }
  return `<div class="seam">
      <div class="seamtop"><span>Outstanding</span><b>${money(total)}</b></div>
      ${live.length ? rail + `<div class="seamleg">${legend}</div>`
        : `<div class="seamclear"><b>&#10003;</b> Every invoice is settled.</div>`}
    </div><div class="seamstep"></div>`;
}

async function loadNativeInvoices() {
  if (S.tab !== "finance" || (S.financeLane && S.financeLane !== "invoices")) return;
  const slot = $("finbody"); if (!slot) return;
  const current = nativeBooksViewRead(slot);
  let data, summary, connect, settings;
  try {
    [summary, connect, settings] = await Promise.all([
      booksApi({ action: "summary" }),
      booksApi({ action: "connect-status" }),
      booksApi({ action: "settings" }),
    ]);
  } catch (e) {
    if (!current()) return;
    slot.innerHTML = `<div class="panel"><h3>Books unavailable</h3><p class="note">${esc(e.message)}</p><button class="pillbtn" id="booksretry">Retry</button></div>`;
    slot.querySelector("#booksretry").onclick=()=>loadNativeInvoices(); return;
  }
  if (!current()) return;
  data={invoices:summary.invoices};
  if(!Array.isArray(data.invoices)) { slot.innerHTML=`<div class="empty">Complete invoice history unavailable. Refresh your books.</div>`; return; }
  S.nativeSummary=summary; S.nativeInvoiceList=data.invoices;
  const invoices = data.invoices || [];
  const over30Cut = businessDay(new Date(), -30);
  const todayISO = businessDay();
  const filtered = invoices
    .filter((i) => S.invoiceFilter === "all" || !S.invoiceFilter ? true
      : S.invoiceFilter === "open" ? (i.status !== "void" && Number(i.balance) > 0)
      : S.invoiceFilter === "paid" ? (i.status !== "void" && Number(i.balance) <= 0)
      : S.invoiceFilter === "late" ? (Number(i.balance) > 0 && i.due_date && i.due_date < todayISO)
      : S.invoiceFilter === "over30" ? (Number(i.balance) > 0 && (i.issue_date || "") < over30Cut)
      : true)
    .filter((i) => !S.invoiceSearch ||
      (i.customer + " " + i.number).toLowerCase().includes(S.invoiceSearch));
  const chargesOn = connect?.charges_enabled === true;
  const live = invoices.filter((i) => i.status !== "void");
  const todayKey = businessDay();
  const todaySales = summary.today_sales ?? live.filter((i) => (i.issue_date || "").slice(0, 10) === todayKey)
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  const ytdSales = summary.ytd_sales ?? live.filter((i) => (i.issue_date || "").slice(0, 4) === todayKey.slice(0, 4))
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  const openCount = summary.open_invoices ?? live.filter((i) => Number(i.balance) > 0).length;
  // Kyle 2026-09-07: Outstanding and Overdue are two different questions.
  // Outstanding is everything still owing; Overdue is only the slice already
  // past its due date. Same rule as the iPhone tile and the Late chip.
  const overdueRows = live.filter((i) => Number(i.balance) > 0 && i.due_date && i.due_date < todayISO);
  const overdueAmt = overdueRows.reduce((sum, i) => sum + (Number(i.balance) || 0), 0);
  // iOS Overview parity: the 2x2 KPI tile grid renders every time — zeros on
  // a fresh workspace beat a blank screen. THIS MONTH / YTD come from the
  // summary's monthly income series (payments received).
  const nowKey = new Date().toISOString().slice(0, 7);
  const thisMonth = (summary.months || []).find((m) => m.month === nowKey)?.income || 0;
  const ytd = (summary.months || []).filter((m) => m.month.slice(0, 4) === nowKey.slice(0, 4))
    .reduce((s, m) => s + Number(m.income || 0), 0);
  // The next number is whatever the books will actually stamp — same source
  // as Books settings, so the tile and the first invoice agree.
  const seq = settings?.numbering;
  const nextNum = seq ? `${seq.prefix ?? ""}${seq.next_number ?? ""}` : "—";
  slot.innerHTML = `
    ${salesIntelNative(invoices)}
<div class="fintiles">
      <div class="fintile tn t-cyan"><span class="tic">${segIc("sun")}</span>
        <small>Today · incl. tax</small><b>${money(todaySales)}</b>
        <span class="fincap">Next ${esc(String(nextNum))}</span></div>
      <div class="fintile tn t-em"><span class="tic">${segIc("profit")}</span>
        <small>Year to date · incl. tax</small><b>${money(ytdSales)}</b>
        <span class="fincap">Since Jan 1</span></div>
      <div class="fintile tn t-orange"><span class="tic">${segIc("hourglass")}</span>
        <small>Outstanding</small><b>${money(summary.open_balance || 0)}</b>
        <span class="fincap">${openCount === 1 ? "1 open invoice" : openCount + " open invoices"}</span></div>
      <div class="fintile tn ${overdueRows.length ? "t-red loud" : "t-em"}"><span class="tic">${segIc(overdueRows.length ? "warn" : "sealcheck")}</span>
        <small>Overdue</small><b>${money(overdueAmt)}</b>
        <span class="fincap">${overdueRows.length === 0 ? "Nothing past due" : overdueRows.length === 1 ? "1 invoice past due" : overdueRows.length + " invoices past due"}</span></div>
    </div>
    <div class="actbars">
      <button class="actbar cy" id="newinv">
        <span class="tic">&#43;</span>
        <span class="m"><b>New invoice</b><span>Numbered, taxed, payment link</span></span>
        <span class="go">&#8250;</span></button>
      <button class="actbar em" id="newest">
        <span class="tic">&#9998;</span>
        <span class="m"><b>New estimate</b><span>Quote &mdash; posts nothing</span></span>
        <span class="go">&#8250;</span></button>
    </div>
    ${moneySeam(live, "issue_date")}
    <div class="searchwrap" style="margin-top:15px"><span class="mag">${MAG}</span>
      <input id="invsearch" placeholder="Customer or invoice number" value="${esc(S.invoiceSearch || "")}"></div>
    <div class="chips" style="margin:13px 0 4px">
      ${[["all", "All"], ["open", "Open"], ["late", "Late"], ["over30", "Over 30"], ["paid", "Paid"]].map(([k2, l]) =>
        `<button class="chip ${S.invoiceFilter === k2 ? "on" : ""}" data-if="${k2}">${l}</button>`).join("")}
    </div>
    <div class="lanehead" style="margin:16px 0 9px"><span class="eyebrow" style="color:var(--dim)">${S.invoiceSearch ? "Matching invoices" : "Recent invoices"}</span>
      <span class="note">${filtered.length}</span></div>
    ${filtered.length ? `<div class="list">${filtered.slice(0, S.invoiceVisible || 120).map((i) => `
      <button class="item" data-binv="${esc(i.id)}">
        <div class="main"><div class="ttl">${esc(i.customer || "—")}</div>
          <div class="sub">${esc(i.number)} · ${esc(dateShort(i.issue_date))}</div></div>
        <div class="amt">${money(i.total)}
          <small><span class="tag ${i.status === "paid" ? "paid" : i.status === "void" ? "" : "open"}">${esc(nativeStatusLabel(i))}</span></small></div>
      </button>`).join("")}</div>`
      : `<div class="empty">${S.invoiceSearch ? "No matches." : "No invoices yet — create your first, or ask Ledger in chat."}</div>`}
    ${filtered.length>(S.invoiceVisible||120) ? `<button class="pillbtn wide" id="invoiceMore">Show more invoices · ${Math.min(S.invoiceVisible||120,filtered.length)} of ${filtered.length}</button>` : ""}
    <div class="opsgrid">
      <button class="opcard ${chargesOn ? "em" : "purple"}" data-op="stripe"><span class="ic">&#128179;</span>
        <b>Card payments</b><span>${chargesOn ? "ON — customers can pay online" : "Set up Stripe to get paid online"}</span>
        <em>${chargesOn ? "MANAGE" : "SET UP"} &#8599;</em></button>
      <button class="opcard" data-op="bsettings"><span class="ic">&#9881;</span><b>Books settings</b>
        <span>Tax, invoice numbering, payment info</span><em>OPEN &#8599;</em></button>
      <button class="opcard" data-op="barchive"><span class="ic">&#128230;</span><b>Business records archive</b><span>Quotes, approvals, messages and accounting records</span><em>DOWNLOAD &#8599;</em></button>
      <button class="opcard" data-op="bexport"><span class="ic">&#128228;</span><b>Export CSV</b>
        <span>Invoices, payments, customers</span><em>EXPORT &#8599;</em></button>
    </div>`;
  $("newinv").onclick = () => nativeComposerSheet();
  $("newest").onclick = () => nativeComposerSheet("estimate");
  if($("invoiceMore")) $("invoiceMore").onclick=()=>{S.invoiceVisible=(S.invoiceVisible||120)+120;loadNativeInvoices();};
  const search = $("invsearch");
  if (search) search.oninput = () => { S.invoiceSearch = search.value.trim().toLowerCase(); loadNativeInvoices(); };
  on("[data-if]", "click", (e) => { S.invoiceFilter = e.currentTarget.dataset.if; loadNativeInvoices(); }, slot);
  on("[data-binv]", "click", (e) => nativeInvoiceSheet(e.currentTarget.dataset.binv), slot);
  on("[data-best]", "click", (e) => nativeEstimateSheet(e.currentTarget.dataset.best), slot);
  on("[data-op]", "click", async (e) => {
    const op = e.currentTarget.dataset.op;
    if (op === "receipts") { S.financeLane = "receipts"; renderFinance(); }
    else if (op === "bsettings") booksSettingsSheet();
    else if (op === "bexport" || op === "barchive") {
      try {
        const ex = await booksApi(op === "barchive" ? { action: "archive", include_receipt_links: true } : { action: "export" });
        downloadBooksExport(ex);
        toast("Export downloaded");
      } catch (err) { toast(friendlyError(err, "Couldn't build the export. Try again."), "err"); }
    } else if (op === "stripe") {
      try {
        const r = await booksApi({ action: "connect-onboard" });
        if (r.url) window.open(r.url, "_blank");
      } catch (err) { toast(friendlyError(err, "Couldn't open payouts. Try again."), "err"); }
    }
  }, slot);
}

function booksPaymentDate(payment,invoice) {
  if(payment.business_date)return payment.business_date;
  const date=new Date(payment.received_at);if(!Number.isFinite(date.getTime()))return "Date unavailable";
  return new Intl.DateTimeFormat("en-CA",{timeZone:invoice.timezone||S.businessTimezone||"America/Edmonton",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
function downloadBooksExport(ex) {
  if(ex.complete!==true||!ex.zip_base64)throw new Error("Your complete export is unavailable. Please retry.");
  const bytes=Uint8Array.from(atob(ex.zip_base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:"application/zip"}));
  const a=document.createElement("a");a.href=url;a.download=ex.filename||"ledger-books-export.zip";a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function sendNativeDocumentEmail(kind,id,to,force) {
  const key="ledger.pending-document-email."+kind+"."+id;
  let pending=JSON.parse(accountStorage.getItem(key)||"null");
  if(pending&&pending.to.toLowerCase()!==to.toLowerCase())throw new Error("Recover the interrupted email to "+pending.to+" before changing its recipient.");
  if(!pending){pending={action:kind+"-send",id,to,force,client_ref:crypto.randomUUID()};accountStorage.setItem(key,JSON.stringify(pending));}
  try{const result=await booksApi(pending);accountStorage.removeItem(key);return result;}
  catch(e){if(/already emailed|No valid email/i.test(e.message))accountStorage.removeItem(key);throw e;}
}
function booksEmailHistoryMarkup(doc) {
  const labels={pending:"Sending — retry to recover",unknown:"Delivery needs verification",accepted:"Accepted for delivery",delivered:"Delivered",failed:"Delivery failed"};
  return (doc.email_history||[]).map(m=>`<p class="note">${m.deliberate_resend?"Resend · ":""}${esc(labels[m.state]||"Delivery needs verification")} · ${esc(m.recipient)}</p>`).join("");
}
// Audit 14.1: the customer link has a lifetime. Say when it ends; when it has
// ended (or was revoked) say so and offer a replacement. Emailing the document
// replaces a dead link on its own; "Replace link" is for owners who share the
// link another way. Servers without link_active (older deploy) show nothing.
function booksLinkStatusMarkup(doc,id) {
  if(typeof doc.link_active!=="boolean")return "";
  if(doc.link_active)return `<p class="note" id="${id}">Link works until ${esc(doc.link_expires_at?new Date(doc.link_expires_at).toLocaleDateString(undefined,{timeZone:S.businessTimezone||"America/Edmonton"}):"further notice")}</p>`;
  return `<p class="note err" id="${id}">This link no longer works${doc.link_expires_at&&Date.parse(doc.link_expires_at)<=Date.now()?" (expired)":" (revoked)"} — emailing the document sends a new one.</p><button class="pillbtn" id="${id}replace">Replace link</button>`;
}
async function replaceDocumentLink(kind,id) {
  if(!(await askConfirm("The old link stops working immediately; the new one is not sent automatically.", { title: "Replace this link?", ok: "Replace", danger: true })))return null;
  const r=await api("/client-hub",{action:"private-links/renew",kind,id});
  if(!r||!r.url)throw new Error(r?.error||"The link could not be replaced.");
  return r;
}


async function booksHistorySheet(kind,id) {
  const wrap=sheet(`<h2>Complete history</h2><button class="linkbtn" id="hback">Back to document</button><div class="seg"><button id="hemail" class="on">Emails</button><button id="haudit">Approvals & activity</button></div><div id="hrows"></div><p class="note err" id="herror"></p><button class="pillbtn" id="hmore">Load history</button>`);
  let category="email",cursor=null,items=[],busy=false,hasMore=true;
  const paint=()=>{wrap.querySelector("#hrows").innerHTML=items.map(m=>`<div class="card"><b>${esc(m.action?m.action.replace(/^books\./,"").replaceAll("."," · "):({accepted:"Accepted for delivery",delivered:"Delivered",failed:"Delivery failed",pending:"Sending — retry to recover",unknown:"Delivery needs verification"}[m.state]||"Delivery needs verification"))}</b><p class="note">${esc(m.recipient||"")} · ${esc(new Date(m.created_at).toLocaleString(undefined,{timeZone:S.businessTimezone||"America/Edmonton"}))}</p>${m.metadata?`<p class="note">${esc(m.metadata.number||"")} ${m.metadata.total!=null?money(m.metadata.total):""}</p>`:""}</div>`).join("")||(!busy?'<p class="note">No history recorded.</p>':"");const more=wrap.querySelector("#hmore");more.hidden=!hasMore;more.disabled=busy;more.textContent=busy?"Loading…":items.length?"Load older history":"Load history";};
  const load=async()=>{if(busy)return;busy=true;wrap.querySelector("#herror").textContent="";paint();try{const r=await booksApi({action:"history",kind,id,category,cursor});if(!Array.isArray(r.items)||typeof r.has_more!=="boolean")throw Error("History is unavailable. Please retry.");items.push(...r.items);cursor=r.next_cursor;hasMore=r.has_more;}catch(e){wrap.querySelector("#herror").textContent=e.message;}finally{busy=false;paint();}};
  wrap.querySelector("#hmore").onclick=load;wrap.querySelector("#hback").onclick=()=>kind==="estimate"?nativeEstimateSheet(id):nativeInvoiceSheet(id);
  for(const [button,next] of [["hemail","email"],["haudit","audit"]])wrap.querySelector("#"+button).onclick=()=>{if(busy)return;category=next;cursor=null;items=[];hasMore=true;wrap.querySelector("#hemail").classList.toggle("on",category==="email");wrap.querySelector("#haudit").classList.toggle("on",category==="audit");load();};
  await load();
}

async function nativeInvoiceSheet(id) {
  const wrap = sheet(`<h2>Invoice</h2><div id="binvbody"><div class="skel"></div><div class="skel"></div></div>`);
  const body = () => wrap.querySelector("#binvbody");
  const paymentKey="ledger.pending-payment."+id;
  let pendingPayment=JSON.parse(accountStorage.getItem(paymentKey)||"null");
  let inv;
  try { inv = (await booksApi({ action: "invoice-get", id })).invoice; }
  catch (e) { body().innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
  const paint = () => {
    body().innerHTML = `
      <div class="lanehead"><span class="eyebrow">${esc(inv.number)}</span>
        <span class="tag ${inv.status === "paid" ? "paid" : "open"}">${esc(nativeStatusLabel(inv))}</span></div>
      <p class="note">${esc(inv.customer?.name || "")}${inv.customer?.email ? " · " + esc(inv.customer.email) : ""}<br>
        Issued ${esc(inv.issue_date)}${inv.due_date ? " · Due " + esc(inv.due_date) : ""}</p>
      <table class="dtable"><tbody>
        ${(inv.lines || []).map((l) => `<tr><td>${esc(l.name)} × ${l.quantity}</td><td style="text-align:right">${money(l.amount)}</td></tr>`).join("")}
        ${inv.discount_kind && inv.discount_kind!=="none"?`<tr><td>Before discount</td><td style="text-align:right">${money(inv.gross_subtotal)}</td></tr><tr><td>Discount${inv.discount_kind==="percent"?" ("+Number(inv.discount_value)+"%)":""}</td><td style="text-align:right">−${money(inv.discount_total)}</td></tr>`:""}
        <tr><td>Subtotal</td><td style="text-align:right">${money(inv.subtotal)}</td></tr>
        ${(Array.isArray(inv.taxes) && inv.taxes.length ? inv.taxes : (Number(inv.tax_total) > 0 ? [{ name: inv.tax_name, total: inv.tax_total }] : []))
          .filter((t) => Number(t.total) > 0).map((t) => `<tr><td>${esc(t.name || "Tax")}</td><td style="text-align:right">${money(t.total)}</td></tr>`).join("")}
        <tr><td><b>Total</b></td><td style="text-align:right"><b>${money(inv.total)}</b></td></tr>
        ${Number(inv.balance) > 0 && Number(inv.balance) < Number(inv.total)
          ? `<tr><td>Balance due</td><td style="text-align:right">${money(inv.balance)}</td></tr>` : ""}
      </tbody></table>
      ${(inv.payments || []).length ? `<p class="note">${inv.payments.map((p) => Number(p.amount) < 0
        ? `Reversed ${money(-Number(p.amount))} · ${esc(p.method)} · ${esc(booksPaymentDate(p,inv))}${p.reversal_reason ? " · " + esc(p.reversal_reason) : ""}`
        : `Paid ${money(p.amount)} · ${esc(p.method)} · ${esc(booksPaymentDate(p,inv))}${p.id && p.method !== "stripe" && !p.reversed_at ? ` <button class="linkbtn" data-reverse="${esc(p.id)}" style="display:inline;padding:0">Reverse</button>` : ""}`).join("<br>")}</p>` : ""}
      ${Number(inv.overpayment)>0 ? `<p class="note err">Overpayment ${money(inv.overpayment)} — review and arrange a refund with your payment provider. This is not extra sales.</p>` : ""}
      ${inv.email_enabled ? `<button class="pillbtn" id="bemail"><b>Email invoice</b></button>` : ""}
      ${booksEmailHistoryMarkup(inv)}<button class="pillbtn" id="invhistory">View complete history</button>
      ${!inv.email_history?.length && inv.email_sent_at ? `<p class="note">Emailed to ${esc(inv.email_sent_to)} · ${esc(String(inv.email_sent_at).slice(0, 10))}</p>` : ""}
      <button class="pillbtn" id="blink">Copy pay link</button>
      <button class="pillbtn" id="bopen">Open invoice page</button>
      ${booksLinkStatusMarkup(inv,"blinkstatus")}
      ${Number(inv.balance) > 0 || pendingPayment ? `
        <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Record a payment</span></div>
        <div class="f" style="display:flex;gap:8px">
          <input id="bamt" type="number" min="0.01" max="${inv.balance}" step="0.01" class="cmpinput" style="flex:1" value="${pendingPayment?.amount ?? inv.balance}" ${pendingPayment ? "disabled" : ""}>
          <select id="bmethod" class="pillbtn" ${pendingPayment ? "disabled" : ""}><option value="etransfer">E-transfer</option><option value="cash">Cash</option>
            <option value="cheque">Cheque</option><option value="other">Other</option></select>
        </div>
        <button class="pillbtn" id="bpay" style="margin-top:8px"><b>${pendingPayment ? "Recover payment" : "Record payment"}</b></button>${pendingPayment ? `<p class="note">A previous reply was interrupted. Recover the same payment before recording another.</p>` : ""}` : ""}
      ${inv.status === "sent" && !((inv.payments || []).reduce((s, p) => s + Number(p.amount), 0) > 0) ? `<button class="linkbtn" id="bvoid" style="color:var(--red);margin-top:10px">Void this invoice</button>` : ""}
      <p class="note err" id="berr"></p>`;
    wrap.querySelector("#invhistory").onclick=()=>booksHistorySheet("invoice",inv.id);
    // Reversal keeps the original row and adds a negative one; the balance
    // re-opens and the reason is audited. Card payments are refunded in Stripe.
    on("[data-reverse]", "click", async (e) => {
      const btn = e.currentTarget, payment = (inv.payments || []).find((p) => p.id === btn.dataset.reverse);
      if (!payment) return;
      const reason = (await askPrompt(`Reverse the ${money(payment.amount)} ${payment.method} payment on ${inv.number}? Say why — it is kept in the audit history.`, { title: "Reverse this payment?", ok: "Reverse", placeholder: "Reason" }) || "").trim();
      if (!reason) return;
      btn.disabled = true;
      try {
        const r = await booksApi({ action: "payment-reverse", payment_id: payment.id, reason, client_ref: crypto.randomUUID() });
        if (!r.invoice?.id) throw new Error("Reversal reply was incomplete. Reopen the invoice to check it.");
        inv = { ...inv, ...r.invoice, link };
        toast(r.reversed ? "Payment reversed" : "Payment was already reversed");
        paint(); loadNativeInvoices();
      } catch (e2) { btn.disabled = false; wrap.querySelector("#berr").textContent = e2.message; }
    }, body());
    const link = inv.link || "";
    wrap.querySelector("#blink").onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast("Payment link copied"); }
      catch { await linkSheet("Payment link", link); }
    };
    wrap.querySelector("#bopen").onclick = () => window.open(link, "_blank");
    const replaceLink = wrap.querySelector("#blinkstatusreplace");
    if (replaceLink) replaceLink.onclick = async () => {
      replaceLink.disabled = true;
      try { if (await replaceDocumentLink("invoice", inv.id)) { toast("New payment link ready"); inv = (await booksApi({action:"invoice-get",id:inv.id})).invoice; paint(); } else replaceLink.disabled = false; }
      catch (e) { wrap.querySelector("#berr").textContent = e.message; replaceLink.disabled = false; }
    };
    const emailBtn = wrap.querySelector("#bemail");
    if (emailBtn) emailBtn.onclick = async () => {
      const to = (await askPrompt("Email this invoice to:", { title: "Email this invoice", value: inv.customer?.email || "", placeholder: "name@business.com", ok: "Send" }) || "").trim();
      if (!to) return;
      emailBtn.disabled = true;
      const send = async (force) => {
        const r = await sendNativeDocumentEmail("invoice",inv.id,to,force);
        toast(`Invoice accepted for delivery to ${r.to}`);
        inv = (await booksApi({action:"invoice-get",id:inv.id})).invoice;
        paint();
      };
      try { await send(false); }
      catch (e) {
        if (/already emailed/i.test(e.message)) {
          if (await askConfirm(`${inv.number} was already emailed to ${to}.`, { title: "Send it again?", ok: "Send again" })) {
            try { await send(true); return; } catch (e2) { wrap.querySelector("#berr").textContent = e2.message; }
          }
        } else wrap.querySelector("#berr").textContent = e.message;
        emailBtn.disabled = false;
      }
    };
    const pay = wrap.querySelector("#bpay");
    if (pendingPayment && wrap.querySelector("#bmethod")) wrap.querySelector("#bmethod").value=pendingPayment.method;
    if (pay) pay.onclick = async () => {
      pay.disabled = true;
      try {
        const amount = pendingPayment?.amount ?? Number(wrap.querySelector("#bamt").value);
        if(!Number.isFinite(amount)||amount<=0) throw new Error("Enter a positive payment amount.");
        // The books refuse an over-payment too; catching it here saves a round trip.
        if (!pendingPayment && amount > Number(inv.balance) + 0.005) throw new Error(`That is more than the ${money(inv.balance)} still owing. Record up to ${money(inv.balance)}.`);
        if(!pendingPayment) {
          pendingPayment={action:"payment-record",invoice_id:inv.id,amount,method:wrap.querySelector("#bmethod").value,client_ref:crypto.randomUUID()};
          accountStorage.setItem(paymentKey,JSON.stringify(pendingPayment));
        }
        const r = await booksApi(pendingPayment);
        if(!r.invoice?.id) throw new Error("Payment reply was incomplete. Recover the same payment.");
        accountStorage.removeItem(paymentKey); pendingPayment=null;
        inv = { ...inv, ...r.invoice, link };
        toast(r.invoice.status === "paid" ? "Invoice paid in full" : "Payment recorded");
        paint(); loadNativeInvoices();
      } catch (e) {
        if ([400,404,409].includes(e.status) && !/different details/i.test(e.message)) { accountStorage.removeItem(paymentKey);pendingPayment=null; }
        paint(); wrap.querySelector("#berr").textContent=e.message;
      }
    };
    const voidBtn = wrap.querySelector("#bvoid");
    if (voidBtn) voidBtn.onclick = async () => {
      if (!(await askConfirm(`Void ${inv.number}? The number is never reused.`, { title: "Void this invoice?", ok: "Void", danger: true }))) return;
      try { await booksApi({ action: "invoice-void", id: inv.id }); toast(`${inv.number} voided`); closeSheet(); loadNativeInvoices(); }
      catch (e) { wrap.querySelector("#berr").textContent = e.message; }
    };
  };
  paint();
}

// Native estimate detail — the web twin of iOS NativeEstimateDetailSheet.
// An estimate becomes money only through Convert; everything else here is
// status housekeeping on the quote itself.
async function nativeEstimateSheet(id) {
  const wrap = sheet(`<h2>Estimate</h2><div id="bestbody"><div class="skel"></div><div class="skel"></div></div>`);
  const body = () => wrap.querySelector("#bestbody");
  let est;
  try { est = (await booksApi({ action: "estimate-get", id })).estimate; }
  catch (e) { body().innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
  const tagCls = (s) => s === "accepted" || s === "converted" ? "paid" : s === "declined" || s === "void" ? "" : "open";
  const paint = () => {
    const live = est.status === "open" || est.status === "accepted";
    body().innerHTML = `
      <div class="lanehead"><span class="eyebrow">${esc(est.number || "ESTIMATE")}</span>
        <span class="tag ${tagCls(est.status)}">${esc(est.status)}</span></div>
      <p class="note">${esc(est.customer?.name || "")}${est.customer?.email ? " · " + esc(est.customer.email) : ""}<br>
        Issued ${esc(est.issue_date)}${est.expiry_date ? " · Valid until " + esc(est.expiry_date) : " · No expiry"}</p>
      <table class="dtable"><tbody>
        ${(est.lines || []).map((l) => `<tr><td>${esc(l.name)} × ${l.quantity}</td><td style="text-align:right">${money(l.amount)}</td></tr>`).join("")}
        ${est.discount_kind && est.discount_kind!=="none"?`<tr><td>Before discount</td><td style="text-align:right">${money(est.gross_subtotal)}</td></tr><tr><td>Discount${est.discount_kind==="percent"?" ("+Number(est.discount_value)+"%)":""}</td><td style="text-align:right">−${money(est.discount_total)}</td></tr>`:""}
        <tr><td>Subtotal</td><td style="text-align:right">${money(est.subtotal)}</td></tr>
        ${(Array.isArray(est.taxes) && est.taxes.length ? est.taxes : (Number(est.tax_total) > 0 ? [{ name: est.tax_name, total: est.tax_total }] : [])).filter((t) => Number(t.total) > 0).map((t) => `<tr><td>${esc(t.name || "Tax")}</td><td style="text-align:right">${money(t.total)}</td></tr>`).join("")}
        <tr><td><b>Total</b></td><td style="text-align:right"><b>${money(est.total)}</b></td></tr>
      </tbody></table>
      ${est.converted_invoice_number ? `<p class="note ok">Converted to invoice ${esc(est.converted_invoice_number)}</p>` : ""}
      ${est.status === "converted" ? `<button class="pillbtn" id="estconverted">Open converted invoice</button>` : ""}
      ${est.email_enabled && live ? `<button class="pillbtn" id="estemail"><b>Email estimate</b></button>` : ""}
      ${booksEmailHistoryMarkup(est)}<button class="pillbtn" id="esthistory">View complete history</button>
      ${!est.email_history?.length && est.email_sent_at ? `<p class="note">Emailed to ${esc(est.email_sent_to)} · ${esc(String(est.email_sent_at).slice(0, 10))}</p>` : ""}
      ${est.link ? `<button class="pillbtn" id="estlink">Copy share link</button>
      <button class="pillbtn" id="estopen">Open estimate page</button>${booksLinkStatusMarkup(est,"estlinkstatus")}` : ""}
      ${est.status === "open" ? `
        <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Customer decision</span></div>
        <div class="f" style="display:flex;gap:8px">
          <button class="pillbtn" id="estaccept" style="flex:1"><b>Mark accepted</b></button>
          <button class="pillbtn" id="estdecline" style="flex:1">Mark declined</button>
        </div>` : ""}
      ${live ? `<button class="cta" id="estconvert" style="margin-top:12px">
        <span class="ic">&#8594;</span>
        <span><b>Convert to invoice</b><span>Review quoted total and payment terms</span></span></button>` : ""}
      ${live ? `<button class="linkbtn" id="estvoid" style="color:var(--red);margin-top:10px">Void this estimate</button>` : ""}
      <p class="note err" id="esterr"></p>`;
    wrap.querySelector("#esthistory").onclick=()=>booksHistorySheet("estimate",est.id);
    const err = (m) => { wrap.querySelector("#esterr").textContent = m; };
    const link = est.link || "";
    const lb = wrap.querySelector("#estlink");
    if (lb) lb.onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast("Share link copied"); }
      catch { await linkSheet("Estimate link", link); }
    };
    const ob = wrap.querySelector("#estopen");
    if (ob) ob.onclick = () => window.open(link, "_blank");
    const replaceLink = wrap.querySelector("#estlinkstatusreplace");
    if (replaceLink) replaceLink.onclick = async () => {
      replaceLink.disabled = true;
      try { if (await replaceDocumentLink("estimate", est.id)) { toast("New share link ready"); est = (await booksApi({action:"estimate-get",id:est.id})).estimate; paint(); } else replaceLink.disabled = false; }
      catch (e) { err(e.message); replaceLink.disabled = false; }
    };
    const emailBtn = wrap.querySelector("#estemail");
    if (emailBtn) emailBtn.onclick = async () => {
      const to = (await askPrompt("Email this estimate to:", { title: "Email this estimate", value: est.customer?.email || "", placeholder: "name@business.com", ok: "Send" }) || "").trim();
      if (!to) return;
      emailBtn.disabled = true;
      const doSend = async (force) => {
        const r = await sendNativeDocumentEmail("estimate",est.id,to,force);
        toast(`Estimate accepted for delivery to ${r.to}`);
        est = (await booksApi({action:"estimate-get",id:est.id})).estimate;
        paint();
      };
      try { await doSend(false); }
      catch (e) {
        if (/already emailed/i.test(e.message)) {
          if (await askConfirm(`${est.number} was already emailed to ${to}.`, { title: "Send it again?", ok: "Send again" })) {
            try { await doSend(true); return; } catch (e2) { err(e2.message); }
          }
        } else err(e.message);
        emailBtn.disabled = false;
      }
    };
    const setStatus = (status) => async (e) => {
      e.currentTarget.disabled = true;
      try {
        est = (await booksApi({ action: "estimate-status", id: est.id, status })).estimate;
        toast(`Marked ${status}`); paint(); loadNativeInvoices();
      } catch (e2) { err(e2.message); e.currentTarget.disabled = false; }
    };
    const acc = wrap.querySelector("#estaccept"); if (acc) acc.onclick = setStatus("accepted");
    const dec = wrap.querySelector("#estdecline"); if (dec) dec.onclick = setStatus("declined");
    const converted=wrap.querySelector("#estconverted");
    if(converted) converted.onclick=async()=>{converted.disabled=true;try{const r=await booksApi({action:"estimate-convert",id:est.id});closeSheet();nativeInvoiceSheet(r.invoice.id);}catch(e){err(e.message);converted.disabled=false;}};
    const conv = wrap.querySelector("#estconvert");
    if (conv) conv.onclick = async () => {
      conv.disabled = true;
      try {
        const preview=await booksApi({action:"estimate-convert-preview",id:est.id});
        const v=preview.review;
        if(!v || !Number.isFinite(v.total)) throw new Error("Conversion review is unavailable.");
        const taxes=[`${v.tax_name||"Tax"}: ${money(v.tax_total)}`,v.tax2_name ? `${v.tax2_name}: ${money(v.tax2_total)}` : ""].filter(Boolean).join("\n");
        // A quote past its "prices honoured until" date converts only once the
        // owner says the quoted prices still stand (server requires force).
        const expiredNote = preview.expired ? `THIS ESTIMATE EXPIRED ON ${preview.expiry_date}. Converting bills the customer at the quoted prices anyway.\n` : "";
        if(!(await askConfirm(`${expiredNote}Subtotal: ${money(v.subtotal)}\n${taxes}\nTotal: ${money(v.total)}\nTerms: ${v.terms} · Due ${v.due_date}\n${preview.tax_settings_changed ? "Tax settings changed. This invoice keeps the quoted taxes.\n" : ""}`, { title: `Review invoice from ${est.number}`, ok: "Create invoice" }))) { conv.disabled=false;return; }
        const r = await booksApi({ action: "estimate-convert", id: est.id, expected_review:v, ...(preview.expired ? { force: true } : {}) });
        toast(`Invoice ${r.invoice.number} created from ${est.number}`);
        closeSheet(); loadNativeInvoices(); nativeInvoiceSheet(r.invoice.id);
      } catch (e) { err(e.message); conv.disabled = false; }
    };
    const vb = wrap.querySelector("#estvoid");
    if (vb) vb.onclick = async () => {
      if (!(await askConfirm(`Void ${est.number}? The number is never reused.`, { title: "Void this estimate?", ok: "Void", danger: true }))) return;
      try { await booksApi({ action: "estimate-void", id: est.id }); toast(`${est.number} voided`); closeSheet(); loadNativeInvoices(); }
      catch (e) { err(e.message); }
    };
  };
  paint();
}

// Initials of the line name make the offered code: "Medium truck flat repair"
// suggests MTFR. Single-word names fall back to their first four letters.
function suggestShortcutCode(name, taken) {
  const words = String(name).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  let code = words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 8) : (words[0] || "").slice(0, 4);
  if (!code) return "";
  const exists = (c) => (taken || []).some((s) => s.code.toUpperCase() === c);
  for (let n = 2; exists(code) && n < 10; n++) code = code.replace(/\d+$/, "") + n;
  return code;
}

async function nativeComposerSheet(kind) {
  try { const setup=await booksApi({action:"settings"}); if(setup.tax?.requires_review) { toast("First, confirm whether you charge sales tax and review your rates."); await booksSettingsSheet(); return; } }
  catch(e) { toast(friendlyError(e, "Couldn't load your books settings. Try again."),"err"); return; }
  // kind "estimate": EST numbering, VALID FOR instead of payment terms, and the
  // create posts nothing to the books — money moves only on convert-to-invoice.
  const isEst = kind === "estimate";
  // clientRef is minted once per open form: the server treats a repeat of the
  // same ref as the same document, so a nervous double-tap can never bill twice.
  const C = { customer: null, customers: [], query: "", lines: [{ name: "", quantity: 1, rate: 0, taxable2: true }], memo: "", termsDays: 0, validDays: 14, newCust: false, busy: false, shortcuts: [],
    discountKind:"none", discountValue:"0", settings: null, setupError: "", termsTouched: false, attempted: false, error: "", tax: null, noWayToPay: false, noTaxNumber: false, clientRef: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`) };
  // The draft lives in account-scoped storage while it is being typed (audit
  // 11.2b): a backdrop tap, a deploy reload or a closed tab brings it back the
  // next time the composer opens. It is cleared on create, or when the owner
  // chooses Discard. Same clientRef, so a save interrupted by the reload still
  // recovers the same document rather than billing twice.
  const DRAFT_KEY = isEst ? "ledger.draft.estimate" : "ledger.draft.invoice";
  let restored = false;
  try {
    const saved = JSON.parse(accountStorage.getItem(DRAFT_KEY) || "null");
    if (saved && saved.v === 1 && Array.isArray(saved.lines)) {
      const lines = saved.lines.filter((l) => l && typeof l === "object").slice(0, 30).map((l) => ({
        name: String(l.name ?? ""), quantity: l.quantity ?? 1, rate: l.rate ?? 0,
        ...(l.description ? { description: String(l.description) } : {}), ...(l.code ? { code: String(l.code) } : {}),
        ...(l.taxable === false ? { taxable: false } : {}), taxable2: l.taxable2 !== false }));
      Object.assign(C, { customer: saved.customer && typeof saved.customer === "object" && saved.customer.id ? saved.customer : null, lines: lines.length ? lines : C.lines, memo: String(saved.memo || ""),
        termsDays: Number.isFinite(saved.termsDays) ? saved.termsDays : C.termsDays, validDays: Number.isFinite(saved.validDays) ? saved.validDays : C.validDays,
        discountKind: ["none","fixed","percent"].includes(saved.discountKind) ? saved.discountKind : "none", discountValue: String(saved.discountValue ?? "0"),
        termsTouched: !!saved.termsTouched, attempted: !!saved.attempted, clientRef: saved.clientRef || C.clientRef });
      restored = true;
    }
  } catch {}
  const blankLine = (l) => !String(l.name || "").trim() && !(Number(l.rate) > 0) && !l.description;
  const wrap = sheet(`<h2>${isEst ? "New Estimate" : "New Invoice"}</h2><div id="bcmp"><div class="skel"></div></div>`);
  const body = () => wrap.querySelector("#bcmp");
  const newCustTyped = () => ["#ncf", "#ncl", "#nce", "#ncp", "#ncc"].some((id) => (wrap.querySelector(id)?.value || "").trim());
  const dirty = () => !!C.customer || C.memo.trim() !== "" || C.discountKind !== "none" || C.lines.length > 1 || C.lines.some((l) => !blankLine(l)) || C.attempted || newCustTyped();
  const persist = () => {
    try {
      if (!dirty()) { accountStorage.removeItem(DRAFT_KEY); return; }
      const cu = C.customer;
      accountStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), clientRef: C.clientRef,
        customer: cu ? { id: cu.id, first_name: cu.first_name, last_name: cu.last_name, email: cu.email, company: cu.company, default_terms_days: cu.default_terms_days } : null,
        lines: C.lines, memo: C.memo, termsDays: C.termsDays, validDays: C.validDays, discountKind: C.discountKind, discountValue: C.discountValue,
        termsTouched: C.termsTouched, attempted: C.attempted }));
    } catch {}
  };
  wrap._isDirty = dirty;
  wrap._discard = () => { try { accountStorage.removeItem(DRAFT_KEY); } catch {} };
  const loadSetup = async () => {
    C.setupError = "";
    try {
      const [cust, sc, set] = await Promise.all([booksApi({action:"customers"}), booksApi({action:"shortcuts"}), booksApi({action:"settings"})]);
      if (!set?.tax || !set.business_date || !set.timezone || ![Number(set.tax.rate),Number(set.tax.second_rate ?? 0)].every(r=>Number.isFinite(r)&&r>=0&&r<=1)) throw new Error("Business settings are incomplete.");
      C.customers = cust.customers || []; C.shortcuts = sc.shortcuts || []; C.settings = set; C.tax = set.tax;
      // A restored draft names its customer by id; the fresh record wins.
      if (C.customer) { const fresh = C.customers.find((c) => c.id === C.customer.id); if (fresh) C.customer = fresh; }
      if (!C.termsTouched) C.termsDays = C.customer?.default_terms_days ?? set.default_terms_days ?? 0;
      C.noWayToPay = !isEst && !set.stripe_connected && !String(set.payment_instructions || "").trim();
      C.noTaxNumber = Number(set.tax.rate)>0 && !String(set.tax.registration_number || "").trim();
    } catch (e) { C.setupError = "Could not load business setup. " + e.message; }
  };
  await loadSetup();
  if (restored && wrap.isConnected) toast(`Restored your unsaved ${isEst ? "estimate" : "invoice"} draft.`);
  const rounded = n => Math.round(n * 100) / 100;
  const problem = l => {
    if (!l.name.trim() || l.name.trim().length>200) return "Enter a service or product name (up to 200 characters).";
    const q=Number(l.quantity), r=Number(l.rate);
    if (String(l.quantity).trim()==="" || !Number.isFinite(q) || q<=0 || q>9999 || Math.abs(q*100-Math.round(q*100))>.000001) return "Quantity must be greater than 0, at most 9999, with up to two decimals.";
    if (String(l.rate).trim()==="" || !Number.isFinite(r) || r<0 || r>1000000 || rounded(r)!==r) return "Enter a rate from 0 to 1,000,000 with up to two decimals.";
    if(String(l.description||"").length>5000) return "Descriptions can contain up to 5,000 characters. Your draft has not been shortened.";
    return "";
  };
  const valid = () => !discountProblem() && C.memo.length<=20000 && !C.setupError && !!C.settings && C.lines.length>0 && C.lines.length<=30 && C.lines.every(l=>!problem(l));
  const dayPlus = days => { if(!C.settings) return ""; const d=new Date(C.settings.business_date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); };
  const lineAmt = (l) => Math.round(Math.round(Number(l.quantity)*100) * Math.round(rounded(Number(l.rate))*100) / 100) / 100;
  const subtotal = () => rounded(C.lines.reduce((t, l) => t + lineAmt(l), 0));
  const hasTax2 = () => !!(C.tax && C.tax.second_name && Number(C.tax.second_rate) > 0);
  const pct = (r) => { const p = Math.round(Number(r) * 100000) / 1000; return p.toFixed(p % 1 === 0 ? 0 : (p * 100) % 1 === 0 ? 2 : 3) + "%"; };
  const discountProblem = () => {
    const value=Number(C.discountValue);
    if(C.discountKind==="none")return "";
    if(!String(C.discountValue).trim()||!Number.isFinite(value)||value<0||rounded(value)!==value)return "Enter a discount with up to two decimals.";
    if(C.discountKind==="percent" && value>100)return "A percentage discount cannot exceed 100%.";
    if(C.discountKind==="fixed" && value>subtotal())return "The discount cannot exceed the subtotal before tax.";
    return "";
  };
  const totals = () => {
    const gross=C.lines.map(l=>BigInt(Math.round(lineAmt(l)*100))),sum=gross.reduce((a,b)=>a+b,0n);
    const value=BigInt(Math.round(Number(C.discountValue||0)*100));
    const deduction=C.discountKind==="fixed"?value:C.discountKind==="percent"?(sum*value+5000n)/10000n:0n;
    const allocated=gross.map(g=>sum?deduction*g/sum:0n);
    let remaining=deduction-allocated.reduce((a,b)=>a+b,0n);
    const order=gross.map((g,i)=>({i,r:sum?deduction*g%sum:0n})).sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1);
    for(const row of order){if(!remaining)break;allocated[row.i]++;remaining--;}
    const cents=predicate=>gross.reduce((a,g,i)=>a+(predicate(C.lines[i])?g-allocated[i]:0n),0n);
    const tax=(base,r)=>Number((base*BigInt(Math.round(r*1000000))+500000n)/1000000n)/100;
    const sub=Number(sum-deduction)/100,t1=tax(cents(l=>l.taxable!==false),Number(C.tax?.rate||0));
    const t2=tax(cents(l=>l.taxable!==false && l.taxable2!==false),hasTax2()?Number(C.tax.second_rate):0);
    return {sub,t1,t2,gross:Number(sum)/100,discount:Number(deduction)/100,total:rounded(sub+t1+t2)};
  };
  const totalsHtml = () => {
    if(!valid()) return `<p class="note">${esc(discountProblem()||"Total available after setup and all lines are valid.")}</p>`;
    const t = totals();
    return `${C.discountKind!=="none"?`<div class="lanehead"><span>Before discount</span><b>${money(t.gross)}</b></div><div class="lanehead"><span>Discount${C.discountKind==="percent"?" ("+Number(C.discountValue)+"%)":""}</span><b>−${money(t.discount)}</b></div>`:""}<div class="lanehead" style="margin-top:10px"><span class="eyebrow">Subtotal before tax</span><b>${money(t.sub)}</b></div>
      ${C.tax && Number(C.tax.rate) > 0 ? `<div class="lanehead" style="margin-top:4px"><span class="eyebrow">${esc(C.tax.name || "Tax")} ${pct(C.tax.rate)}</span><b>${money(t.t1)}</b></div>` : ""}
      ${hasTax2() ? `<div class="lanehead" style="margin-top:4px"><span class="eyebrow">${esc(C.tax.second_name)} ${pct(C.tax.second_rate)}</span><b>${money(t.t2)}</b></div>` : ""}
      <div class="lanehead" style="margin-top:4px"><span class="eyebrow">Total</span><b>${money(t.total)}</b></div>
      ${C.tax && !(Number(C.tax.rate) > 0) && !hasTax2() ? `<p class="note">No sales tax is being added — this ${isEst ? "estimate" : "invoice"} goes out at 0%. If you charge tax, set the rate in Books settings.</p>` : ""}`;
  };
  const paintTotals = () => {
    const el=wrap.querySelector("#btotals");if(el)el.innerHTML=totalsHtml();
    C.lines.forEach((l,i)=>{const e=wrap.querySelector(`#blineerror${i}`);if(e){e.textContent=problem(l);e.hidden=!problem(l);}});
    const create=wrap.querySelector("#bcreate");if(create)create.disabled=C.busy||!C.customer||!valid();
    persist();
  };
  const paint = () => {
    const hits = C.query
      ? C.customers.filter((c) => (`${c.first_name} ${c.last_name} ${c.company || ""} ${c.email || ""}`).toLowerCase().includes(C.query.toLowerCase())).slice(0, 8)
      : C.customers.slice(0, 6);
    body().innerHTML = `
      ${C.setupError ? `<p class="note err">${esc(C.setupError)}</p><button class="pillbtn" id="bretrysetup">Retry setup</button>` : ""}
      ${C.attempted && !C.busy ? `<p class="note">The save was interrupted. Retry to recover this same document; its details are kept unchanged.</p>` : ""}
      <fieldset id="bedit" ${C.busy || C.attempted ? "disabled" : ""} style="border:0;padding:0;min-width:0">
      <div class="lanehead"><span class="eyebrow">Customer</span></div>
      ${C.customer ? `<div class="cmpsel"><span class="av">${esc((C.customer.first_name || "?").slice(0, 1).toUpperCase())}</span>
          <span class="m"><b>${esc(`${C.customer.first_name} ${C.customer.last_name}`.trim())}</b>${C.customer.email ? `<span>${esc(C.customer.email)}</span>` : ""}</span>
          <button class="x" id="bclear" aria-label="Clear customer">&#10005;</button></div>`
        : C.newCust ? `
          <div class="f" style="display:flex;gap:8px">
            <input id="ncf" class="cmpinput" placeholder="First name" aria-label="First name" style="flex:1">
            <input id="ncl" class="cmpinput" placeholder="Last name" aria-label="Last name" style="flex:1"></div>
          <input id="nce" class="cmpinput sm" placeholder="Email" aria-label="Email" inputmode="email">
          <input id="ncp" class="cmpinput sm" placeholder="Phone" aria-label="Phone" inputmode="tel">
          <input id="ncc" class="cmpinput sm" placeholder="Company (optional)" aria-label="Company (optional)">
          <button class="pillbtn" id="ncsave">Save customer</button>
          <button class="linkbtn" id="ncback">Back to search</button>`
        : `<input id="bq" class="cmpinput" placeholder="Search customers…" aria-label="Search customers" value="${esc(C.query)}" autocomplete="off">
          ${hits.map((c) => `<button class="cmprow" data-bpick="${esc(c.id)}">
            <span class="av sm">${esc((c.first_name || "?").slice(0, 1).toUpperCase())}</span>
            <span class="m"><b>${esc(`${c.first_name} ${c.last_name}`.trim() || c.company || "")}</b>${c.email ? `<span>${esc(c.email)}</span>` : ""}</span>
            <span class="plus">+</span></button>`).join("")}
          <button class="linkbtn" id="bnewc">+ New customer</button>`}
      <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Lines</span></div>
      ${C.lines.map((l, i) => `<div class="cmpline">
        <div class="t"><input class="cmpinput sm" data-bname="${i}" placeholder="Service or product — or a shortcut like MTFR" aria-label="Line ${i + 1} service or product" value="${esc(l.name)}" style="flex:1" autocomplete="off">
          <button class="del" data-bdel="${i}" aria-label="Remove line ${i + 1}">&#128465;</button></div>
        <div id="bsug${i}" class="scsug"></div>
        <div class="f"><label>Qty<input type="number" min="0.01" max="9999" step="0.01" data-bqty="${i}" value="${esc(String(l.quantity))}"></label>
          <label>Rate<input type="number" min="0" step="0.01" data-brate="${i}" value="${esc(String(l.rate))}"></label></div>
        <div class="f">
          <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-btax="${i}" ${l.taxable !== false ? "checked" : ""} style="width:auto">Tax applies</label>
          ${hasTax2() ? `<label style="flex-direction:row;align-items:center;gap:6px;white-space:nowrap"><input type="checkbox" data-btax2="${i}" ${l.taxable2 !== false ? "checked" : ""} style="width:auto;margin:0">${esc(C.tax.second_name)} applies</label>` : ""}</div>
        <p class="note err" id="blineerror${i}" ${problem(l) ? "" : "hidden"}>${esc(problem(l))}</p>
      </div>`).join("") || `<p class="note">Add what's being billed — free-form, priced by you.${C.shortcuts.length ? " Type a shortcut code to fill a line instantly." : ""}</p>`}
      ${hasTax2() && C.lines.length ? `<p class="note">${esc(C.tax.second_name)} usually applies to goods, not to most services — untick it on labour or service lines.</p>` : ""}
      <button class="pillbtn" id="baddline">+ Add line</button>
      <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Discount before tax</span></div>
      <div class="f"><select id="bdiscountkind" class="pillbtn" aria-label="Discount type">${[["none","No discount"],["fixed","Fixed amount"],["percent","Percentage"]].map(([k,label])=>`<option value="${k}" ${C.discountKind===k?"selected":""}>${label}</option>`).join("")}</select>
      ${C.discountKind!=="none"?`<label>${C.discountKind==="percent"?"Percent":"Amount"}<input id="bdiscountvalue" aria-label="Discount value" class="cmpinput" type="number" min="0" step="0.01" value="${esc(C.discountValue)}"></label>`:""}</div>
      <p class="note">Applies proportionally to all lines before tax. Original prices stay on the record.</p>
      ${isEst ? `
      <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Valid for</span></div>
      <div class="seg" id="bvalidseg">
        ${[[7, "7 days"], [14, "14 days"], [30, "30 days"], [0, "No expiry"]].map(([d, lbl]) =>
          `<button class="${C.validDays === d ? "on" : ""}" data-bvalid="${d}">${lbl}</button>`).join("")}
      </div>` : `
      <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Payment terms</span></div>
      <div class="seg" id="btermseg">
        ${[[0, "COD"], [15, "Net 15"], [30, "Net 30"], [60, "Net 60"]].map(([d, lbl]) =>
          `<button class="${C.termsDays === d ? "on" : ""}" data-bterm="${d}">${lbl}</button>`).join("")}
      </div>`}
      <input id="bmemo" class="cmpinput sm" placeholder="Note to customer (optional)" aria-label="Note to customer (optional)" value="${esc(C.memo)}">
      <p class="note">Issued ${esc(C.settings?.business_date || "—")} · ${isEst ? (C.validDays>0 ? "Expires "+dayPlus(C.validDays) : "No expiry selected") : "Due "+dayPlus(C.termsDays)}</p>
      </fieldset>
      <div id="btotals">${totalsHtml()}</div>
      ${C.noTaxNumber ? `<p class="note" style="color:#b45309"><b>Heads up:</b> you're charging ${esc(C.tax?.name || "tax")} with no registration number, so your customer can't claim it back. <button class="linkbtn" id="btaxreg" style="display:inline;padding:0">Add your tax number</button></p>` : ""}
      ${C.noWayToPay ? `<p class="note" style="color:#b45309"><b>Heads up:</b> customers have no way to pay this online yet — card payments aren't set up and there are no payment instructions. <button class="linkbtn" id="bpayhow" style="display:inline;padding:0">Add payment instructions</button></p>` : ""}
      <button class="cta" id="bcreate" ${C.busy || !C.customer || !valid() ? "disabled" : ""}>
        <span><b>${C.busy ? "Saving…" : C.attempted ? "Retry same save" : isEst ? "Create estimate" : "Create invoice"}</b>
          <span>${isEst ? "EST-numbered quote with a share page — posts nothing" : "Numbered + payment link, tax applied"}</span></span></button>
      <p class="note err" id="bcerr">${esc(C.error || (C.memo.length>20000 ? "Customer notes can contain up to 20,000 characters. Your draft has not been shortened." : ""))}</p>`;
    const close=wrap.querySelector(".sheet-close");if(close)close.disabled=C.busy||C.attempted;
    wrap.querySelector(".sheet-back").onclick=()=>{if(!C.busy&&!C.attempted)void requestCloseSheet();};
    persist();
    const retry=wrap.querySelector("#bretrysetup");if(retry)retry.onclick=async()=>{retry.disabled=true;await loadSetup();paint();};
    const q = wrap.querySelector("#bq");
    if (q) { q.oninput = () => { C.query = q.value; paint(); wrap.querySelector("#bq").focus(); const el = wrap.querySelector("#bq"); el.setSelectionRange(el.value.length, el.value.length); }; }
    on("[data-bpick]", "click", (e) => {
      C.customer = C.customers.find((c) => c.id === e.currentTarget.dataset.bpick);
      if (!C.termsTouched) C.termsDays = C.customer?.default_terms_days ?? C.settings?.default_terms_days ?? 0;
      paint();
    }, body());
    const clear = wrap.querySelector("#bclear"); if (clear) clear.onclick = () => { C.customer = null; paint(); };
    const newc = wrap.querySelector("#bnewc"); if (newc) newc.onclick = () => { C.newCust = true; paint(); };
    const back = wrap.querySelector("#ncback"); if (back) back.onclick = () => { C.newCust = false; paint(); };
    const save = wrap.querySelector("#ncsave");
    if (save) save.onclick = async () => {
      try {
        const r = await booksApi({ action: "customer-save", customer: {
          first_name: wrap.querySelector("#ncf").value.trim(), last_name: wrap.querySelector("#ncl").value.trim(),
          email: wrap.querySelector("#nce").value.trim(), phone: wrap.querySelector("#ncp").value.trim(),
          company: wrap.querySelector("#ncc").value.trim(),
        } });
        C.customers.unshift(r.customer); C.customer = r.customer; if(!C.termsTouched)C.termsDays=C.customer.default_terms_days ?? C.settings?.default_terms_days ?? 0; C.newCust = false; paint();
      } catch (e) { wrap.querySelector("#bcerr").textContent = e.message; }
    };
    wrap.querySelector("#bdiscountkind").onchange=e=>{C.discountKind=e.target.value;C.discountValue="0";paint();};
    const discountInput=wrap.querySelector("#bdiscountvalue");if(discountInput)discountInput.oninput=e=>{C.discountValue=e.target.value;paintTotals();};
    wrap.querySelector("#baddline").onclick = () => { C.lines.push({ name: "", quantity: 1, rate: 0 }); paint(); };
    on("[data-bdel]", "click", (e) => { C.lines.splice(Number(e.currentTarget.dataset.bdel), 1); paint(); }, body());
    // Shortcut chips paint under the line being typed in — no full repaint, so
    // the input never loses focus mid-word.
    const paintSuggestions = (i, value) => {
      const box = wrap.querySelector(`#bsug${i}`);
      if (!box) return;
      const q = value.trim().toUpperCase();
      const hits = q.length < 1 ? [] : C.shortcuts.filter((s) =>
        s.code.toUpperCase().startsWith(q) || s.name.toUpperCase().includes(q)).slice(0, 4);
      box.innerHTML = hits.map((s) =>
        `<button class="pillbtn sm" data-bsc="${esc(s.code)}" data-bscline="${i}"><b>${esc(s.code)}</b> ${esc(s.name)} · ${money(s.rate)}</button>`).join("");
      box.querySelectorAll("[data-bsc]").forEach((btn) => btn.onclick = () => {
        const s = C.shortcuts.find((x) => x.code === btn.dataset.bsc);
        if (!s) return;
        C.lines[i] = { name: s.name, description: s.description || "", quantity: C.lines[i].quantity, rate: s.rate, code: s.code, taxable: s.taxable !== false, taxable2: C.lines[i].taxable2 !== false };
        paint();
      });
    };
    on("[data-bname]", "input", (e) => {
      const i = Number(e.currentTarget.dataset.bname);
      C.lines[i].name = e.currentTarget.value;
      delete C.lines[i].code;
      paintSuggestions(i, e.currentTarget.value); paintTotals();
    }, body());
    // Totals repaint in place as the numbers are typed — no full repaint, so
    // the field keeps focus and the subtotal is never a line behind.
    on("[data-bqty]", "input", (e) => { C.lines[Number(e.currentTarget.dataset.bqty)].quantity = e.currentTarget.value; paintTotals(); }, body());
    on("[data-brate]", "input", (e) => { C.lines[Number(e.currentTarget.dataset.brate)].rate = e.currentTarget.value; paintTotals(); }, body());
    on("[data-btax]", "change", (e) => { C.lines[Number(e.currentTarget.dataset.btax)].taxable = e.currentTarget.checked; paintTotals(); }, body());
    on("[data-btax2]", "change", (e) => { C.lines[Number(e.currentTarget.dataset.btax2)].taxable2 = e.currentTarget.checked; paintTotals(); }, body());
    on("[data-bterm]", "click", (e) => { C.termsDays = Number(e.currentTarget.dataset.bterm); C.termsTouched = true; paint(); }, body());
    on("[data-bvalid]", "click", (e) => { C.validDays = Number(e.currentTarget.dataset.bvalid); paint(); }, body());
    wrap.querySelector("#bmemo").oninput = (e) => { C.memo = e.target.value; paintTotals(); wrap.querySelector("#bcerr").textContent=C.memo.length>20000 ? "Customer notes can contain up to 20,000 characters. Your draft has not been shortened." : C.error; };
    const payhow = wrap.querySelector("#bpayhow");
    if (payhow) payhow.onclick = () => { closeSheet(); booksSettingsSheet(); };
    const taxreg = wrap.querySelector("#btaxreg");
    if (taxreg) taxreg.onclick = () => { closeSheet(); booksSettingsSheet(); };
    const create = wrap.querySelector("#bcreate");
    if (create) create.onclick = async (e, force, allowZero) => {
      if (C.busy || !C.customer || !valid()) return;
      const kept = C.lines;
      // A $0 document is almost always a rate left blank. Ask once.
      if (!allowZero && kept.length && totals().sub <= 0) {
        if (!(await askConfirm(`This ${isEst ? "estimate" : "invoice"} is for $0.00. Create it anyway?`, { title: "$0.00 total", ok: "Create anyway" }))) return;
        allowZero = true;
      }
      C.busy = true; C.attempted = true; C.error = ""; paint();
      try {
        const mappedLines = kept.map((l) => ({ name: l.name.trim(), description: l.description || undefined, quantity: Number(l.quantity), rate: rounded(Number(l.rate)), taxable: l.taxable !== false, taxable2: l.taxable2 !== false }));
        const t=totals();const expected_review={subtotal:t.sub,tax_total:t.t1,tax2_total:t.t2,total:t.total,issue_date:C.settings.business_date,
          ...(isEst ? {expiry_date:C.validDays === 0 ? null : dayPlus(C.validDays)} : {due_date:dayPlus(C.termsDays)})};
        let r, docId, docNumber;
        if (isEst) {
          r = await booksApi({ action: "estimate-create", customer_id: C.customer.id, lines: mappedLines,
            memo: C.memo, discount:{kind:C.discountKind,value:C.discountKind==="none"?0:Number(C.discountValue)}, expected_review, client_ref: C.clientRef, allow_zero: allowZero === true, valid_for_days: C.validDays });
          docId = r.estimate.id; docNumber = r.estimate.number;
        } else {
          r = await booksApi({ action: "invoice-create", customer_id: C.customer.id, lines: mappedLines,
            memo: C.memo, discount:{kind:C.discountKind,value:C.discountKind==="none"?0:Number(C.discountValue)}, expected_review, terms_days: C.termsDays, client_ref: C.clientRef, allow_zero: allowZero === true,
            shortcut_codes: kept.map((l) => l.code).filter(Boolean), force: force === true });
          docId = r.invoice.id; docNumber = r.invoice.number;
        }
        toast(`${docNumber || (isEst ? "Estimate" : "Invoice")} created`);
        wrap._isDirty = null; wrap._discard();
        closeSheet(); loadNativeInvoices();
        const openDoc = () => isEst ? nativeEstimateSheet(docId) : nativeInvoiceSheet(docId);
        // First-use shortcut offer: hand-typed lines the owner might want as a
        // one-tap code next time. Lines filled from a shortcut are skipped.
        const offer = isEst ? [] : kept.filter((l) => !l.code && l.name.trim() && Number(l.rate) > 0 &&
          !C.shortcuts.some((s) => s.name.toLowerCase() === l.name.trim().toLowerCase()));
        if (offer.length) shortcutOfferSheet(offer, C.shortcuts, openDoc);
        else openDoc();
      } catch (err) {
        C.busy = false; if(err.status>=400 && err.status<500) C.attempted=false; C.error=err.message;
        if(err.data?.review_changed) C.setupError="Refresh setup and review the updated date and total.";
        paint();
        if (err.status === 409 && err.data?.duplicate_of) {
          if (await askConfirm(err.message, { title: "Possible duplicate", ok: "Create anyway" })) return create.onclick(null, true, allowZero);
        } else if (err.status === 409 && err.data?.zero_total) {
          if (await askConfirm(`This ${isEst ? "estimate" : "invoice"} is for $0.00. Create it anyway?`, { title: "$0.00 total", ok: "Create anyway" })) return create.onclick(null, force, true);
        } else wrap.querySelector("#bcerr").textContent = err.message;
      }
    };
  };
  paint();
}

// "Would you like a shortcut for that?" — shown once per new hand-typed line
// right after its first invoice. Yes = the code fills a line on every future
// invoice; the owner's item catalog builds itself while they work.
function shortcutOfferSheet(offerLines, knownShortcuts, done) {
  const taken = [...knownShortcuts];
  const wrap = sheet(`<h2>Save as shortcuts?</h2>
    <p class="note">Next time, type the code and the whole line fills in.</p>
    <div id="scoffer">${offerLines.map((l, i) => `
      <div class="cmpline" data-scrow="${i}">
        <div class="t"><span style="flex:1"><b>${esc(l.name)}</b> · ${money(Number(l.rate) || 0)}</span></div>
        <div class="f" style="display:flex;gap:8px;align-items:center">
          <input class="cmpinput sm" data-sccode="${i}" value="${esc(suggestShortcutCode(l.name, taken))}" style="max-width:120px;text-transform:uppercase" autocomplete="off">
          <button class="pillbtn sm" data-scyes="${i}"><b>Save</b></button>
          <button class="linkbtn" data-scno="${i}">No thanks</button>
        </div>
        <p class="note err" data-scerr="${i}"></p>
      </div>`).join("")}</div>
    <button class="cta" id="scdone"><span><b>Done</b></span></button>`);
  let open = offerLines.length;
  const finish = () => { closeSheet(); done && done(); };
  const resolveRow = (i) => {
    const row = wrap.querySelector(`[data-scrow="${i}"]`);
    if (row) row.remove();
    if (--open <= 0) finish();
  };
  offerLines.forEach((l, i) => {
    wrap.querySelector(`[data-scyes="${i}"]`).onclick = async (e) => {
      const code = wrap.querySelector(`[data-sccode="${i}"]`).value.trim().toUpperCase();
      e.currentTarget.disabled = true;
      try {
        await booksApi({ action: "shortcut-save", code, name: l.name.trim(), description: l.description || "", rate: Number(l.rate) || 0 });
        toast(`${code} saved`);
        resolveRow(i);
      } catch (err) {
        e.currentTarget.disabled = false;
        wrap.querySelector(`[data-scerr="${i}"]`).textContent = err.message;
      }
    };
    wrap.querySelector(`[data-scno="${i}"]`).onclick = () => resolveRow(i);
  });
  wrap.querySelector("#scdone").onclick = finish;
}

async function booksSettingsSheet() {
  const wrap = sheet(`<h2>Books settings</h2><div id="bset"><div class="skel"></div></div>`);
  const body = () => wrap.querySelector("#bset");
  let s;
  try { s = await booksApi({ action: "settings" }); }
  catch (e) { body().innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
  let shortcuts = [], shortcutError=null;
  const fetchShortcuts=async()=>{try{shortcuts=(await booksApi({action:"shortcuts"})).shortcuts;shortcutError=null;}catch(e){shortcutError=e.message;}};
  await fetchShortcuts();
  const br = s.branding || {};
  const template = { v: br.template || "classic" };
  const termsDefault = { v: Number(s.default_terms_days) || 0 };
  const paintShortcuts = () => {
    const box = wrap.querySelector("#sclist");
    if (!box) return;
    if(shortcutError) {
      box.innerHTML=`<p class="note err">Shortcuts unavailable: ${esc(shortcutError)}</p><button class="pillbtn" id="scretry">Retry</button>`;
      box.querySelector("#scretry").onclick=async()=>{await fetchShortcuts();paintShortcuts();};return;
    }
    box.innerHTML = shortcuts.length ? shortcuts.map((sc) => `
      <div class="cmpline"><div class="t">
        <span style="flex:1"><b>${esc(sc.code)}</b> ${esc(sc.name)} · ${money(sc.rate)}</span>
        <button class="del" data-scdel="${esc(sc.id)}">&#128465;</button></div></div>`).join("")
      : `<p class="note">No shortcuts yet — you'll be offered one after each invoice with a new line item.</p>`;
    box.querySelectorAll("[data-scdel]").forEach((btn) => btn.onclick = async () => {
      btn.disabled=true;
      try {
        const result=await booksApi({action:"shortcut-delete",id:btn.dataset.scdel});
        if(result.deleted!==true) throw new Error("Deletion could not be confirmed.");
        shortcuts=shortcuts.filter(x=>x.id!==btn.dataset.scdel);paintShortcuts();
      } catch(e) {btn.disabled=false;toast(friendlyError(e, "Couldn't remove that shortcut. Try again."),"err");}
    });
  };
  body().innerHTML = `
    <div class="lanehead"><span class="eyebrow">Your brand</span></div>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
      ${br.logo_url ? `<img src="${esc(br.logo_url)}" alt="" style="width:46px;height:46px;border-radius:11px;object-fit:cover" id="slogoimg">` : ""}
      <button class="pillbtn" id="slogo">${br.logo_url ? "Replace logo" : "Upload logo"}</button>
      <input type="file" id="slogofile" accept="image/jpeg,image/png,image/webp" hidden>
    </div>
    <label class="emailrow">Accent color (buttons and totals on your invoices)
      <input id="saccent" type="color" value="${/^#[0-9a-fA-F]{6}$/.test(br.accent_color || "") ? esc(br.accent_color) : "#22d3ee"}" style="width:64px;height:36px;border:0;background:none;padding:0"></label>
    <div class="lanehead"><span class="eyebrow">Invoice layout</span></div>
    <div class="seg" id="stmpl">
      ${["classic", "modern", "minimal"].map((t) => `<button class="${template.v === t ? "on" : ""}" data-stm="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
    </div>
    <label class="emailrow">Business phone (shown on invoices)<input id="sphone" class="cmpinput" value="${esc(br.phone || "")}"></label>
    <label class="emailrow">Invoice footer note (thank-you line, warranty, terms & conditions)
      <textarea id="sfoot" class="cmpinput" rows="2">${esc(br.footer_note || "")}</textarea></label>
    <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Default payment terms</span></div>
    <div class="seg" id="sterms">
      ${[[0, "COD"], [15, "Net 15"], [30, "Net 30"], [60, "Net 60"]].map(([d, lbl]) => `<button class="${termsDefault.v === d ? "on" : ""}" data-std="${d}">${lbl}</button>`).join("")}
    </div>
    <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Line-item shortcuts</span></div>
    <div id="sclist"></div>
    <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Tax &amp; numbering</span></div>
    <label class="emailrow">Sales-tax setup<select id="sregistration" class="cmpinput"><option value="unreviewed"${s.tax.requires_review ? " selected" : ""}>Choose your tax setup</option>${[["registered","Registered — charge the taxes below"],["not_registered","Not registered — do not charge sales tax"],["custom","I have reviewed these custom tax settings"]].map(([v,t])=>`<option value="${v}"${!s.tax.requires_review && (s.tax.registration_status === v || (s.tax.registration_status === "unreviewed" && v === "custom")) ? " selected" : ""}>${t}</option>`).join("")}</select></label>
    <p class="note">Your province suggests rates; it does not determine registration or service exemptions. Confirm your own setup. Mark exempt services separately. Existing choices will not change when your address changes.</p>
    <label class="emailrow">Tax name<input id="stax" class="cmpinput" value="${esc(s.tax.name)}"></label>
    <label class="emailrow">Tax rate %<input id="srate" type="number" min="0" max="100" step="0.001" class="cmpinput" value="${(Number(s.tax.rate) * 100).toFixed(3).replace(/\.?0+$/, "")}"></label>
    <label class="emailrow">Second tax name (PST / RST / QST — leave blank if none)<input id="stax2" class="cmpinput" value="${esc(s.tax.second_name || "")}" placeholder="e.g. PST"></label>
    <label class="emailrow">Second tax rate %<input id="srate2" type="number" min="0" max="100" step="0.001" class="cmpinput" value="${(Number(s.tax.second_rate || 0) * 100).toFixed(3).replace(/\.?0+$/, "")}"></label>
    <p class="note">${s.tax.second_name ? "Both taxes print as separate lines. The second tax can be switched off per line when you write an invoice — most services are exempt from it." : Number(s.tax.rate) > 0 ? "" : "Tax is 0% — nothing is added to your invoices. Set the rate your area requires, or leave it at 0 if you don't charge sales tax."}</p>
    <label class="emailrow">Tax registration # (shown on invoices)<input id="sreg" class="cmpinput" value="${esc(s.tax.registration_number || "")}"></label>
    ${Number(s.tax.rate) > 0 && !String(s.tax.registration_number || "").trim() ? `<p class="note err">You're charging ${esc(s.tax.name || "tax")} with no registration number. Add it if required for your business and verify your registration before invoicing.</p>` : ""}
    <label class="emailrow">Invoice prefix<input id="spre" class="cmpinput" value="${esc(s.numbering.prefix)}"></label>
    <p class="note">Next invoice: ${esc(s.numbering.prefix)}${s.numbering.next_number}</p>
    <label class="emailrow">How customers pay you (shown on unpaid invoices when card payments are off)
      <textarea id="spay" class="cmpinput" rows="3">${esc(s.payment_instructions || "")}</textarea></label>
    <button class="cta" id="ssave"><span><b>Save settings</b></span></button>
    <p class="note err" id="serr"></p>`;
  paintShortcuts();
  on("[data-stm]", "click", (e) => {
    template.v = e.currentTarget.dataset.stm;
    wrap.querySelectorAll("[data-stm]").forEach((b) => b.classList.toggle("on", b.dataset.stm === template.v));
  }, body());
  on("[data-std]", "click", (e) => {
    termsDefault.v = Number(e.currentTarget.dataset.std);
    wrap.querySelectorAll("[data-std]").forEach((b) => b.classList.toggle("on", Number(b.dataset.std) === termsDefault.v));
  }, body());
  wrap.querySelector("#slogo").onclick = () => wrap.querySelector("#slogofile").click();
  wrap.querySelector("#slogofile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const btn = wrap.querySelector("#slogo");
    btn.disabled = true; btn.textContent = "Uploading…";
    try {
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      const detail = await api("/workspace-profile", { action: "logo", image: { data: dataUrl, media_type: file.type } });
      if (S.profile?.business) S.profile.business.logo_url = detail?.business?.logo_url ?? S.profile.business.logo_url;
      btn.disabled = false; btn.textContent = "Replace logo"; toast("Logo updated");
    } catch (err) { btn.disabled = false; btn.textContent = "Upload logo"; wrap.querySelector("#serr").textContent = err.message; }
  };
  wrap.querySelector("#sregistration").onchange=e=>{if(e.target.value==="not_registered"){wrap.querySelector("#srate").value="0";wrap.querySelector("#srate2").value="0"}};
  wrap.querySelector("#ssave").onclick = async () => {
    try {
      await booksApi({ action: "settings-save",registration_status:wrap.querySelector("#sregistration").value,
        tax_name: wrap.querySelector("#stax").value, tax_rate: Number(wrap.querySelector("#srate").value) / 100,
        second_name: wrap.querySelector("#stax2").value.trim(),
        second_rate: Number(wrap.querySelector("#srate2").value) / 100,
        registration_number: wrap.querySelector("#sreg").value, prefix: wrap.querySelector("#spre").value,
        payment_instructions: wrap.querySelector("#spay").value,
        accent_color: wrap.querySelector("#saccent").value,
        template: template.v,
        business_phone: wrap.querySelector("#sphone").value,
        footer_note: wrap.querySelector("#sfoot").value,
        default_terms_days: termsDefault.v });
      toast("Settings saved"); closeSheet();
    } catch (e) { wrap.querySelector("#serr").textContent = e.message; }
  };
}

const FINANCE_TITLE = { invoices: "Finance", estimates: "Estimates", profit: "Profit", receipts: "Receipts" };

let financeRenderGeneration = 0;
async function renderFinance() {
  const generation=++financeRenderGeneration;
  // Which ledger this workspace runs on decides the whole tab: native books
  // hides the Profit lane (a QuickBooks P&L board) and swaps the invoice
  // screens. Cached for the session; a connect/disconnect reloads the app.
  if (S.booksProvider === undefined) {
    try { S.booksProvider = (await booksApi({ action: "settings" })).provider; }
    catch { S.booksProvider = "quickbooks"; }
  }
  if (generation!==financeRenderGeneration || S.tab!=="finance") return;
  const native = S.booksProvider === "native";
  const lane = ["profit", "receipts", "estimates"].includes(S.financeLane) ? S.financeLane : "invoices";
  view().innerHTML = `<div class="sect">
    ${pageHead(FINANCE_TITLE[lane])}
    <div class="seg four">
      <button class="${lane === "invoices" ? "on" : ""}" data-fl="invoices">${segIc("overview")}Overview</button>
      <button class="${lane === "estimates" ? "on" : ""}" data-fl="estimates">${segIc("estimates")}Estimates</button>
      <button class="${lane === "profit" ? "on" : ""}" data-fl="profit">${segIc("profit")}Profit</button>
      <button class="${lane === "receipts" ? "on" : ""}" data-fl="receipts">${segIc("receipts")}Receipts</button>
    </div>
    <div id="finbody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  on("[data-fl]", "click", (e) => { S.financeLane = e.currentTarget.dataset.fl; renderFinance(); });
  if (lane === "profit") { if (native) loadNativeProfit(); else loadProfit(); }
  else if (lane === "receipts") loadReceipts();
  else if (lane === "estimates") { if (native) loadNativeEstimates(); else loadQBOEstimates(); }
  else if (native) loadNativeInvoices();
  else loadInvoices();
}

// Kyle 2026-09-07: estimates are their own tab you tap into — never a pile
// stacked on top of the invoice list. One renderer, both books modes.
function estimatesLaneHTML(estimates, row) {
  const q = S.estSearch || "";
  const live = estimates.filter((x) => x.status === "open" || x.status === "accepted");
  const shown = !q ? estimates : estimates.filter((x) =>
    ((x.customer || "") + " " + (x.number || "") + " " + (x.status || "")).toLowerCase().includes(q));
  const sum = (rows) => rows.reduce((t, x) => t + Number(x.total || 0), 0);
  return `
    <div class="fintiles">
      <div class="fintile tn t-em"><span class="tic">${segIc("estimates")}</span>
        <small>Live quotes</small><b>${money(sum(live))}</b>
        <span class="fincap">${live.length === 1 ? "1 awaiting an answer" : live.length + " awaiting an answer"}</span></div>
      <div class="fintile tn t-cyan"><span class="tic">${segIc("tray")}</span>
        <small>All estimates</small><b>${money(sum(estimates))}</b>
        <span class="fincap">${estimates.length === 1 ? "1 estimate" : estimates.length + " estimates"}</span></div>
    </div>
    <div class="actbars">
      <button class="actbar em" id="newest">
        <span class="tic">&#9998;</span>
        <span class="m"><b>New estimate</b><span>Quote &mdash; posts nothing until you convert it</span></span>
        <span class="go">&#8250;</span></button>
    </div>
    <div class="searchwrap" style="margin-top:15px"><span class="mag">${MAG}</span>
      <input id="estsearch" placeholder="Customer, estimate number or status" value="${esc(q)}"></div>
    <div class="lanehead" style="margin:16px 0 9px"><span class="eyebrow" style="color:var(--dim)">Estimates</span>
      <span class="note">${shown.length}</span></div>
    ${shown.length ? `<div class="list">${shown.slice(0, S.estimateVisible || 120).map(row).join("")}</div>`
      : `<div class="empty">${q ? "No matches." : "No estimates yet — start one above, or ask Ledger in chat."}</div>`}
    ${shown.length>(S.estimateVisible||120) ? `<button class="pillbtn wide" id="estimateMore">Show more estimates · ${Math.min(S.estimateVisible||120,shown.length)} of ${shown.length}</button>` : ""}`;
}

// Live quotes first, settled ones after — the same order both apps use.
function sortEstimates(rows) {
  return rows.slice().sort((a, b) => {
    const live = (x) => (x.status === "open" || x.status === "accepted") ? 0 : 1;
    return live(a) - live(b) || String(b.issue_date || "").localeCompare(String(a.issue_date || ""));
  });
}

function wireEstimateSearch(reload) {
  if($("estimateMore")) $("estimateMore").onclick=()=>{S.estimateVisible=(S.estimateVisible||120)+120;reload();};
  const search = $("estsearch");
  if (!search) return;
  search.oninput = () => { S.estSearch = search.value.trim().toLowerCase(); reload(); };
}

async function loadNativeEstimates() {
  if (S.tab !== "finance" || S.financeLane !== "estimates") return;
  const slot = $("finbody"); if (!slot) return;
  const current = nativeBooksViewRead(slot);
  let estData;
  try { estData = await booksApi({ action: "estimates" }); }
  catch (e) { if (!current()) return; slot.innerHTML = `<div class="empty"><b>Estimates unavailable</b><p>${esc(e.message)}</p><button class="btn ghost" id="estimateRetry">Retry</button></div>`; $("estimateRetry").onclick = loadNativeEstimates; return; }
  if (!current()) return;
  const estimates = sortEstimates(estData.estimates || []);
  slot.innerHTML = estimatesLaneHTML(estimates, (x) => `
    <button class="item" data-best="${esc(x.id)}">
      <div class="main"><div class="ttl">${esc(x.customer || "—")}</div>
        <div class="sub">${esc(x.number || "EST")} · ${esc(dateShort(x.issue_date))}${x.expiry_date ? " · expires " + esc(dateShort(x.expiry_date)) : ""}</div></div>
      <div class="amt">${money(x.total)}
        <small><span class="tag ${x.status === "accepted" || x.status === "converted" ? "paid" : x.status === "declined" ? "grey" : "open"}">${esc(x.status)}</span></small></div>
    </button>`);
  $("newest").onclick = () => nativeComposerSheet("estimate");
  on("[data-best]", "click", (e) => nativeEstimateSheet(e.currentTarget.dataset.best), slot);
  wireEstimateSearch(loadNativeEstimates);
}

async function loadQBOEstimates() {
  const slot = $("finbody"); if (!slot) return;
  try {
    if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
  } catch (e) { slot.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const estimates = sortEstimates(S.qbo?.qbo?.estimate_rows || []);
  slot.innerHTML = estimatesLaneHTML(estimates, (e) => `
    <div class="item" style="cursor:default">
      <div class="main"><div class="ttl">${esc(e.customer || "—")}</div>
        <div class="sub">${esc(e.number ? "#" + e.number : "Estimate")} \u00b7 ${esc(dateShort(e.issue_date))}${e.expiry_date ? " \u00b7 expires " + esc(dateShort(e.expiry_date)) : ""}</div></div>
      <div class="amt">${money(e.total)}
        <small><span class="tag ${e.status === "accepted" || e.status === "converted" ? "paid" : e.status === "declined" ? "grey" : "open"}">${esc(e.status)}</span></small></div>
    </div>`);
  $("newest").onclick = () => composerSheet("estimate");
  wireEstimateSearch(loadQBOEstimates);
}

async function loadInvoices() {
  const slot = $("finbody"); if (!slot) return;
  let refreshError = null;
  try {
    if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
  } catch (e) {
    if (!S.qbo) {
      slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo") : `<div class="empty">${esc(e.message)}</div>`;
      wireConnect(slot);
      return;
    }
    refreshError = e.message; // keep showing the last invoices Ledger loaded
  }
  {
    const all = S.qbo?.qbo?.invoices || [];
    const k = S.qbo?.qbo?.kpis || {};
    const over30Cut = businessDay(new Date(), -30);
    const todayISO = businessDay();
    // Kyle 2026-09-07: Overdue is the slice of Outstanding already past its due
    // date. Counted off the full snapshot, never the filtered/searched list.
    const overdueRows = all.filter((i) => Number(i.balance) > 0 && i.status !== "paid" && i.status !== "void" && i.due_date && i.due_date < todayISO);
    const overdueAmt = overdueRows.reduce((sum, i) => sum + (Number(i.balance) || 0), 0);
    const filtered = all.filter((i) => S.invoiceFilter === "all" ? true
        : S.invoiceFilter === "late" ? (Number(i.balance) > 0 && i.due_date && i.due_date < todayISO)
        : S.invoiceFilter === "over30" ? (Number(i.balance) > 0 && (i.date || "") < over30Cut)
        : i.status === S.invoiceFilter)
      .filter((i) => !S.invoiceSearch || (i.customer + " " + i.doc + " " + (i.email || "")).toLowerCase().includes(S.invoiceSearch));
    // iOS searches customers alongside invoices and lists the matches above them.
    const custHits = !S.invoiceSearch ? [] : (S.qbo?.qbo?.customers || []).filter((c) =>
      (c.name + " " + (c.email || "") + " " + (c.phone || "") + " " + c.id).toLowerCase().includes(S.invoiceSearch)).slice(0, 20);
    slot.innerHTML = `
      ${refreshError ? `<p class="note err">Couldn't refresh — showing the last invoices Ledger loaded. ${esc(refreshError)}</p>` : ""}
      ${salesIntel(all, k)}
      <div class="fintiles">
        <div class="fintile tn t-cyan"><span class="tic">${segIc("sun")}</span>
          <small>Today</small><b>${money(k.today_sales || 0)}</b>
          <span class="fincap">Next #${esc(String(k.next_invoice ?? "—"))}</span></div>
        <div class="fintile tn t-em"><span class="tic">${segIc("profit")}</span>
          <small>Year to date</small><b>${money(k.ytd_sales || 0)}</b>
          <span class="fincap">Since Jan 1</span></div>
        <div class="fintile tn t-orange"><span class="tic">${segIc("hourglass")}</span>
          <small>Outstanding</small><b>${money(k.outstanding || 0)}</b>
          <span class="fincap">${(k.open_count ?? 0) === 1 ? "1 open invoice" : (k.open_count ?? 0) + " open invoices"}</span></div>
        <div class="fintile tn ${overdueRows.length ? "t-red loud" : "t-em"}"><span class="tic">${segIc(overdueRows.length ? "warn" : "sealcheck")}</span>
          <small>Overdue</small><b>${money(overdueAmt)}</b>
          <span class="fincap">${overdueRows.length === 0 ? "Nothing past due" : overdueRows.length === 1 ? "1 invoice past due" : overdueRows.length + " invoices past due"}</span></div>
      </div>
      <div class="actbars">
        <button class="actbar cy" id="newinv">
          <span class="tic">&#43;</span>
          <span class="m"><b>New invoice</b><span>Draft, review, post</span></span>
          <span class="go">&#8250;</span></button>
        <button class="actbar em" id="newest">
          <span class="tic">&#9998;</span>
          <span class="m"><b>New estimate</b><span>Quote &mdash; posts nothing</span></span>
          <span class="go">&#8250;</span></button>
      </div>
      ${moneySeam(all, "date")}
      <div class="searchwrap" style="margin-top:15px"><span class="mag">${MAG}</span>
        <input id="invsearch" placeholder="Customer, invoice, email or phone" value="${esc(S.invoiceSearch || "")}"></div>
      <div class="chips" style="margin:13px 0 4px">
        ${[["all", "All"], ["open", "Open"], ["late", "Late"], ["over30", "Over 30"], ["paid", "Paid"]].map(([k2, l]) =>
          `<button class="chip ${S.invoiceFilter === k2 ? "on" : ""}" data-if="${k2}">${l}</button>`).join("")}
      </div>
      ${S.invoiceSearch ? `<div class="lanehead"><span class="eyebrow">Search results</span>
        <button class="linkbtn" id="clrsearch">Clear</button></div>` : ""}
      ${custHits.length ? `<div class="lanehead"><span class="eyebrow" style="color:var(--dim)">Customers</span>
        <span class="note">${custHits.length} shown</span></div>
        <div class="list">${custHits.map((c) => `
        <button class="item" data-fcust="${esc(c.id)}">
          <div class="main"><div class="ttl">${esc(c.name)}</div>
            <div class="sub">${esc([c.email, c.phone].filter(Boolean).join(" · ") || ("QBO #" + c.id))}</div></div>
          <div class="amt">${Number(c.balance) > 0 ? `<span style="color:var(--orange)">${money(c.balance)}</span>` : ""}
            <small>QBO #${esc(c.id)}</small></div>
        </button>`).join("")}</div>` : ""}
      ${S.invoiceSearch && !custHits.length && !filtered.length
        ? `<div class="empty">No Finance matches.<br>Try a customer, invoice number, email or phone.</div>` : ""}
      <div class="lanehead" style="margin:16px 0 9px"><span class="eyebrow" style="color:var(--dim)">${S.invoiceSearch ? "Matching invoices" : "Recent invoices"}</span>
        <span class="note">${S.invoiceSearch ? filtered.length : Math.min(filtered.length, 120)}</span></div>
      ${filtered.length ? `<div class="list">${filtered.slice(0, 120).map((i, idx) => `
        <button class="item" data-inv="${esc(i.id)}">
          <div class="main">
            <div class="ttl">${esc(i.customer || "—")}</div>
            <div class="sub">#${esc(i.doc)} · ${esc(dateShort(i.date))}</div>
          </div>
          <div class="amt">${money(i.total)}
            <small><span class="tag ${i.status}">${i.status}</span></small></div>
        </button>`).join("")}</div>`
        : (S.invoiceSearch ? "" : `<div class="empty">No invoices yet.</div>`)}`;
    $("newinv").onclick = () => composerSheet();
    $("newest").onclick = () => composerSheet("estimate");
    if ($("clrsearch")) $("clrsearch").onclick = () => { S.invoiceSearch = ""; loadInvoices(); };
    on("[data-op]", "click", (e) => {
      const op = e.currentTarget.dataset.op;
      if (op === "profit") { S.financeLane = "profit"; renderFinance(); } else { S.financeLane = "receipts"; renderFinance(); }
    }, slot);
    on("[data-fcust]", "click", (e) => {
      const c = (S.qbo?.qbo?.customers || []).find((x) => x.id === e.currentTarget.dataset.fcust);
      if (c) customerSheet(c);
    }, slot);
    const search = $("invsearch");
    search.addEventListener("input", () => {
      S.invoiceSearch = search.value.trim().toLowerCase();
      clearTimeout(S._t); S._t = setTimeout(loadInvoices, 220);
    });
    on("[data-if]", "click", (e) => { S.invoiceFilter = e.currentTarget.dataset.if; loadInvoices(); }, slot);
    on("[data-inv]", "click", (e) => invoiceSheet(all.find((x) => x.id === e.currentTarget.dataset.inv)), slot);
  }
}

// SALES INTELLIGENCE panel. Every figure comes from the live QBO invoice rows:
// the month total, a 14-day daily spark, the real average sale, and a straight
// elapsed-days run rate. No modelled or back-filled numbers.
function salesIntel(invoices, k) {
  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const month = invoices.filter((i) => (i.date || "").slice(0, 7) === ym);
  const monthTotal = k.month_sales ?? month.reduce((t, i) => t + (Number(i.total) || 0), 0);
  const avg = month.length ? monthTotal / month.length : 0;
  const elapsed = now.getDate();
  const inMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const forecastReady = elapsed >= 7 || month.length >= 5;
  const forecast = elapsed ? monthTotal / elapsed * inMonth : 0;
  // Growth the way the iPhone's QBORevenueHero reads it: month-to-date against
  // the same number of elapsed days last month and in the same month last year.
  const dayOf = (i) => Number((i.date || "").slice(8, 10)) || 0;
  const sumRows = (rows) => rows.reduce((t, i) => t + (Number(i.total) || 0), 0);
  const throughToday = (y, m) => invoices.filter((i) =>
    (i.date || "").slice(0, 7) === `${y}-${String(m).padStart(2, "0")}` && dayOf(i) <= elapsed);
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mtd = sumRows(throughToday(now.getFullYear(), now.getMonth() + 1));
  const momBase = sumRows(throughToday(pm.getFullYear(), pm.getMonth() + 1));
  const yoyBase = sumRows(throughToday(now.getFullYear() - 1, now.getMonth() + 1));
  const growthPct = (cur, base) => base > 0 ? (cur - base) / base * 100 : null;
  const mom = growthPct(mtd, momBase), yoy = growthPct(mtd, yoyBase);
  const pctText = (v) => v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

  const days = [];
  for (let d = 13; d >= 0; d--) {
    const t = new Date(now); t.setDate(now.getDate() - d);
    const key = localDay(t);
    days.push({ key, total: invoices.filter((i) => (i.date || "").slice(0, 10) === key)
      .reduce((sum, i) => sum + (Number(i.total) || 0), 0) });
  }
  const max = Math.max(1, ...days.map((d) => d.total));

  return `<div class="intel">
    <div class="ihead"><b>&#9651; Sales</b><span class="live"><i></i>Live from QuickBooks</span></div>
    <p class="cap">This month</p>
    <div class="big">${money(monthTotal)}</div>
    <div class="sub">Live sales performance</div>
    <div class="salespark">${days.map((d, i) =>
      `<div class="b ${i === days.length - 1 ? "hot" : ""}" style="height:${Math.max(Math.round(d.total / max * 100), 3)}%" title="${d.key}: ${money0(d.total)}"></div>`).join("")}</div>
    <div class="sparkends"><span>14 days ago</span><span>Today</span></div>
    <div class="kpis" style="margin-top:15px">
      <div class="kpi cyan"><small>Month over month</small><b>${pctText(mom)}</b><i>vs same point last month</i></div>
      <div class="kpi purple"><small>Year over year</small><b>${pctText(yoy)}</b><i>vs same point last year</i></div>
      <div class="kpi em"><small>Average sale</small><b>${money(avg)}</b><i>${month.length} invoice${month.length === 1 ? "" : "s"} this month</i></div>
      <div class="kpi orange"><small>Forecast</small><b>${forecastReady ? money(forecast) : "—"}</b><i>${forecastReady ? "month-end run rate" : "after a week of sales"}</i></div>
    </div>
    <p class="infoline"><em>&#9432;</em>Growth compares the same number of days in each period, never a partial month against a full one.</p>
  </div>`;
}

// Manual invoice composer — the web twin of iOS InvoiceComposerSheet.
// Same single write path as chat: build → /quickbooks-invoice/draft → Confirm → /confirm.
// The AI has no posting tool here either; the Confirm tap is the only thing that posts.
async function composerSheet(kind) {
  // kind "estimate" rides the same composer down the estimate-draft route: QBO's
  // own EST numbering, no terms control (estimates expire, they don't come due),
  // and nothing posts to the books until the customer accepts.
  const isEst = kind === "estimate";
  const C = { customer: null, lines: [], memo: "", items: [], itemsError: "", query: "", draft: null, busy: false, error: "" };
  const wrap = sheet(`<h2>${isEst ? "New Estimate" : "New Invoice"}</h2><div id="cmpbody"><div class="skel"></div><div class="skel"></div></div>`);
  const body = () => wrap.querySelector("#cmpbody");
  const money2 = (n) => "$" + (Number(n) || 0).toFixed(2);
  const subtotal = () => C.lines.reduce((t, l) => t + Math.round(l.quantity * l.rate * 100) / 100, 0);

  try {
    if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
    C.items = (await get("/quickbooks-invoice/items")).items || [];
  } catch (e) { C.itemsError = e.message; }

  function customerBlock() {
    if (C.customer) {
      return `<div class="cmpsel"><span class="av">${esc(C.customer.name.slice(0, 1).toUpperCase())}</span>
        <span class="m"><b>${esc(C.customer.name)}</b>${C.customer.email ? `<span>${esc(C.customer.email)}</span>` : ""}</span>
        <button class="x" id="cmpclear">&#10005;</button></div>`;
    }
    const all = S.qbo?.qbo?.customers || [];
    const hits = C.query
      ? all.filter((c) => (c.name + " " + (c.email || "") + " " + (c.phone || "")).toLowerCase().includes(C.query.toLowerCase())).slice(0, 12)
      : all.slice(0, 8);
    return `<input id="cmpq" class="cmpinput" placeholder="Search customers…" value="${esc(C.query)}" autocomplete="off">
      ${hits.map((c) => `<button class="cmprow" data-pick="${esc(c.id)}">
        <span class="av sm">${esc(c.name.slice(0, 1).toUpperCase())}</span>
        <span class="m"><b>${esc(c.name)}</b>${c.email ? `<span>${esc(c.email)}</span>` : ""}</span>
        <span class="plus">+</span></button>`).join("") || `<p class="note">No customers match.</p>`}`;
  }

  function linesBlock() {
    if (C.itemsError) return `<p class="note err">${esc(C.itemsError)}</p>`;
    if (!C.items.length) return `<p class="note">Loading QuickBooks items…</p>`;
    if (!C.lines.length) return `<p class="note">Add the products or services being billed.</p>`;
    return C.lines.map((l, i) => `<div class="cmpline">
      <div class="t"><b>${esc(l.name)}</b><span class="amt">${money2(l.quantity * l.rate)}</span>
        <button class="del" data-del="${i}">&#128465;</button></div>
      <div class="f"><label>Qty<input type="number" min="0.01" max="999" step="0.01" data-qty="${i}" value="${l.quantity}"></label>
        <label>Rate<input type="number" min="0" step="0.01" data-rate="${i}" value="${l.rate}"></label></div>
      <input class="cmpinput sm" data-desc="${i}" placeholder="Description shown to customer (optional)" value="${esc(l.detail || "")}">
    </div>`).join("");
  }

  function draw() {
    if (C.draft) { drawDraft(); return; }
    const ready = C.customer && C.lines.length && !C.busy;
    body().innerHTML = `
      <div class="eyebrow">Customer</div>
      <div class="cmpsect">${customerBlock()}</div>
      <div class="lanehead"><span class="eyebrow">Line items</span>
        <button class="linkbtn" id="cmpadd" ${C.items.length ? "" : "disabled"}>+ Add line</button></div>
      <div class="cmpsect">${linesBlock()}</div>
      <div class="eyebrow">Memo (customer-visible)</div>
      <textarea id="cmpmemo" class="cmpinput" rows="2" placeholder="Optional note that prints on the invoice">${esc(C.memo)}</textarea>
      <div class="cmptotal"><span>Subtotal (before tax)</span><b>${money2(subtotal())}</b></div>
      ${C.error ? `<p class="note err">${esc(C.error)}</p>` : ""}
      <button class="btn primary wide" id="cmpgo" ${ready ? "" : "disabled"}>${C.busy ? "Building draft…" : "Review Draft"}</button>`;
    wire();
  }

  function drawDraft() {
    const d = C.draft;
    body().innerHTML = `<div class="card" style="margin:0">
      <h3>${isEst ? "ESTIMATE DRAFT" : "INVOICE DRAFT"}</h3><div class="cust">${esc(d.customer)}</div>
      <table>${(d.lines || []).map((l) => `<tr><td>${esc(l.description || l.item_name)} × ${l.quantity}</td><td>${money(l.amount)}</td></tr>`).join("")}
        <tr><td class="total">Subtotal</td><td class="total">${money(d.subtotal)}</td></tr></table>
      ${isEst ? "" : termsRow(d.terms, d.terms_days)}
      ${d.customer_email ? `<label class="emailrow"><input type="checkbox" id="cmpem" checked> Email to ${esc(d.customer_email)}${(d.customer_email_cc || []).length ? ` · cc ${esc(d.customer_email_cc.join(", "))}` : ""}${d.recipients_locked ? ` <span class="note">(your standing rule for this customer)</span>` : ""}</label>` : ""}
      <label class="emailrow"><input type="checkbox" id="cmppr" ${accountStorage.getItem("ledger.printAfterPosting") === "1" ? "checked" : ""}> Print after posting</label>
      <div class="row"><button class="btn cancel" id="cmpcancel">Cancel</button><button class="btn confirm" id="cmpconfirm">Confirm</button></div>
      <div class="note" id="cmpnote" style="margin-top:9px"></div></div>`;
    const note = body().querySelector("#cmpnote");
    const draftBtns = () => [body().querySelector("#cmpconfirm"), body().querySelector("#cmpcancel")].filter(Boolean);
    body().querySelector("#cmppr").onchange = (e) => accountStorage.setItem("ledger.printAfterPosting", e.target.checked ? "1" : "0");
    body().querySelector("#cmpconfirm").onclick = async () => {
      draftBtns().forEach((b) => b.disabled = true);
      const sendEmail = body().querySelector("#cmpem")?.checked ?? false;
      const wantPrint = body().querySelector("#cmppr")?.checked ?? false;
      try {
        const tm = body().querySelector(".tm");
        const terms = tm && !tm.dataset.termsDays ? tm.value : undefined;
        const termsDays = tm && tm.dataset.termsDays ? Number(tm.value) : undefined;
        const r = await api(isEst ? "/quickbooks-invoice/estimate-confirm" : "/quickbooks-invoice/confirm",
          { draft_id: d.draft_id, send_email: sendEmail, ...(terms ? { terms } : {}), ...(termsDays != null ? { terms_days: termsDays } : {}) });
        note.className = "note ok";
        note.textContent = "✅ Posted" + (r.doc_number ? " — #" + r.doc_number : "") + (r.emailed ? " · emailed " + (r.emailed_to || "") : "");
        body().querySelector(".row").remove();
        if (wantPrint && (r.qbo_invoice_id || r.id)) printPdfById(r.qbo_invoice_id || r.id, r.doc_number, isEst ? "estimate" : "invoice");
        S.qboStale = true;
        setTimeout(() => { closeSheet(); loadInvoices(); }, 1400);
      } catch (e) { draftBtns().forEach((b) => b.disabled = false); note.className = "note err"; note.textContent = postedMessage(e); }
    };
    body().querySelector("#cmpcancel").onclick = async () => {
      draftBtns().forEach((b) => b.disabled = true);
      // The draft always goes off this screen; if the server refused, say so
      // rather than leaving a cancelled draft alive where the owner can't see it.
      try { await api(isEst ? "/quickbooks-invoice/estimate-cancel" : "/quickbooks-invoice/cancel", { draft_id: d.draft_id }); }
      catch (e) { toast(friendlyError(e, "Cleared here, but the draft may still be on the server. Check Finance."), "err"); }
      C.draft = null; draw();
    };
  }

  function wire() {
    const q = body().querySelector("#cmpq");
    if (q) {
      q.oninput = () => { C.query = q.value; const at = q.selectionStart; draw();
        const n = body().querySelector("#cmpq"); if (n) { n.focus(); n.setSelectionRange(at, at); } };
    }
    on("[data-pick]", "click", (e) => {
      C.customer = (S.qbo?.qbo?.customers || []).find((c) => c.id === e.currentTarget.dataset.pick) || null; draw();
    }, body());
    const clear = body().querySelector("#cmpclear");
    if (clear) clear.onclick = () => { C.customer = null; C.query = ""; draw(); };
    const add = body().querySelector("#cmpadd");
    if (add) add.onclick = () => itemPicker(C.items, (it) => {
      C.lines.push({ item_id: it.id, name: it.name, quantity: 1, rate: Number(it.unit_price) || 0, detail: "" });
      draw();
    });
    on("[data-del]", "click", (e) => { C.lines.splice(Number(e.currentTarget.dataset.del), 1); draw(); }, body());
    // Fractional quantities (1.5 h labour) are real on QuickBooks too: two
    // decimals, same as the built-in composer; the server caps QBO lines at 999.
    on("[data-qty]", "change", (e) => { const q = Math.round((Number(e.currentTarget.value) || 0) * 100) / 100; C.lines[Number(e.currentTarget.dataset.qty)].quantity = Math.min(999, Math.max(0.01, q || 1)); draw(); }, body());
    on("[data-rate]", "change", (e) => { C.lines[Number(e.currentTarget.dataset.rate)].rate = Math.max(0, Number(e.currentTarget.value) || 0); draw(); }, body());
    on("[data-desc]", "input", (e) => { C.lines[Number(e.currentTarget.dataset.desc)].detail = e.currentTarget.value; }, body());
    const memo = body().querySelector("#cmpmemo");
    if (memo) memo.oninput = () => { C.memo = memo.value; };
    const go = body().querySelector("#cmpgo");
    if (go) go.onclick = async () => {
      if (!C.customer || !C.lines.length) return;
      C.busy = true; C.error = ""; draw();
      try {
        const payload = { customer_id: C.customer.id, lines: C.lines.map((l) => {
          const e = { item_id: l.item_id, quantity: l.quantity, rate: l.rate };
          if (l.detail) e.description = l.detail;
          return e;
        }) };
        if (C.memo) payload.memo = C.memo;
        C.draft = (await api(isEst ? "/quickbooks-invoice/estimate-draft" : "/quickbooks-invoice/draft", payload)).draft;
      } catch (e) { C.error = e.message; }
      C.busy = false; draw();
    };
  }

  draw();
}

// Billable-item picker — the web twin of iOS ItemPickerSheet. Stacks over the composer.
function itemPicker(items, onPick) {
  let q = "";
  const wrap = document.createElement("div");
  wrap.id = "pickwrap";
  wrap._opener = rememberOpener();
  wrap.innerHTML = `<div class="sheet-back"></div><div class="sheet"><div class="grab"></div>
    <h2>Billable Items</h2>
    <input id="pickq" class="cmpinput" placeholder="Search items" aria-label="Search items" autocomplete="off">
    <div id="picklist" class="cmpsect"></div>
    <button class="sheet-close" id="pickclose">Close</button></div>`;
  closeStack();
  document.body.appendChild(wrap);
  labelPane(wrap.querySelector(".sheet"));
  // Back and Escape close the picker before the composer beneath it (audit 11.1).
  layerPush("stack");
  const close = () => closeStack();
  wrap.querySelector(".sheet-back").onclick = close;
  wrap.querySelector("#pickclose").onclick = close;
  const list = wrap.querySelector("#picklist");
  const paint = () => {
    const hits = q ? items.filter((i) => (i.name + " " + (i.description || "")).toLowerCase().includes(q)) : items;
    list.innerHTML = hits.length ? hits.map((i, n) => `<button class="cmprow" data-item="${n}">
        <span class="m"><b>${esc(i.name)}</b>${i.description ? `<span>${esc(i.description)}</span>` : ""}</span>
        <span class="rate">$${(Number(i.unit_price) || 0).toFixed(2)}</span></button>`).join("")
      : `<p class="note">No items match.</p>`;
    on("[data-item]", "click", (e) => { onPick(hits[Number(e.currentTarget.dataset.item)]); close(); }, list);
  };
  wrap.querySelector("#pickq").oninput = (e) => { q = e.target.value.trim().toLowerCase(); paint(); };
  paint();
}

// `back` is optional: when the invoice was opened from inside another sheet
// (a customer profile), render a return button so Close isn't the only exit.
function invoiceSheet(inv, back) {
  if (!inv) return;
  const lines = (inv.lines || []).map((l) => `<div class="kv"><span>${esc(l.description || l.item || "Item")}${l.quantity ? " × " + l.quantity : ""}</span><span>${money(l.amount)}</span></div>`).join("");
  sheet(`<h2>#${esc(inv.doc)} · ${esc(inv.customer)}</h2>
    <p class="sh-sub">${esc(dayLabel(inv.date))}${inv.due_date ? " · due " + esc(dateShort(inv.due_date)) : ""} · <span class="tag ${inv.status}">${inv.status}</span></p>
    ${lines}
    <div class="kv"><span>Subtotal</span><span>${money(inv.subtotal)}</span></div>
    <div class="kv"><span>Tax</span><span>${money(inv.tax)}</span></div>
    <div class="kv tot"><span>Total</span><span>${money(inv.total)}</span></div>
    ${inv.balance > 0 ? `<div class="kv"><span>Balance owing</span><span style="color:var(--orange)">${money(inv.balance)}</span></div>` : ""}
    ${inv.email ? `<p class="note" style="margin-top:10px">Bill to ${esc(inv.email)}</p>` : ""}
    ${inv.balance > 0 ? `<button class="btn em wide" id="markpaid" style="margin-top:12px">&#10003;&nbsp; Mark as paid</button>
    <p class="note" style="margin-top:6px">Records a payment in QuickBooks for the full open balance, applied to this invoice. Use when the customer paid by e-transfer, cash or cheque.</p>` : ""}
    <div class="rowbtns" style="margin-top:14px">
      <button class="btn ghost" id="sharepdf">Share PDF</button>
      <button class="btn primary" id="printpdf">Print</button>
    </div>
    ${back ? `<button class="btn ghost" id="invback" style="margin-top:9px;width:100%">&#8592; Back to ${esc(inv.customer || "customer")}</button>` : ""}
    <div class="note" id="pdfnote" style="margin-top:9px"></div>`, (sh) => {
    if (back) sh.querySelector("#invback").onclick = () => back();
    const mp = sh.querySelector("#markpaid");
    if (mp) mp.onclick = async () => {
      if (!(await askConfirm(`This posts a real ${money(inv.balance)} payment to your books. Reversing it later is a QuickBooks-side action.`, { title: "Mark this invoice paid?", ok: "Mark paid" }))) return;
      mp.disabled = true; mp.textContent = "Recording payment…";
      try {
        await api("/quickbooks-invoice/mark-paid", { id: inv.id });
        closeSheet(); toast(`Invoice #${inv.doc} marked paid`); S.qboStale = true; loadInvoices();
      } catch (e) { mp.disabled = false; mp.innerHTML = "&#10003;&nbsp; Mark as paid"; toast(friendlyError(e, "Couldn't mark the invoice paid. Nothing was posted — try again."), "err"); }
    };
    sh.querySelector("#printpdf").onclick = () => withPdf(inv, sh, (url) => {
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0";
      frame.src = url; document.body.appendChild(frame);
      frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, "_blank"); } };
      setTimeout(() => { if (document.body.contains(frame)) frame.remove(); }, 60000);
    });
    sh.querySelector("#sharepdf").onclick = () => withPdf(inv, sh, async (url, file) => {
      if (navigator.canShare && file && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: file.name }); return; } catch {}
      }
      const a = document.createElement("a"); a.href = url; a.download = file ? file.name : "invoice.pdf"; a.click();
    });
  });
}

async function withPdf(inv, sh, fn) {
  const note = sh.querySelector("#pdfnote");
  note.className = "note"; note.textContent = "Fetching the QuickBooks PDF…";
  try {
    const d = await api("/quickbooks-invoice/pdf", { id: inv.id, type: "invoice", doc_number: inv.doc });
    const bin = atob(d.pdf_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const file = window.File ? new File([blob], d.filename || `Invoice-${inv.doc}.pdf`, { type: "application/pdf" }) : null;
    note.className = "note ok"; note.textContent = `${d.filename} · ${(d.bytes / 1024).toFixed(0)} KB`;
    await fn(URL.createObjectURL(blob), file);
  } catch (e) { note.className = "note err"; note.textContent = e.message; }
}

/* ---------------- PROFIT ---------------- */
// Built-in books P&L — income is payments received, expenses are logged
// costs, straight off the books summary. Rendered even when empty: a new
// shop should see the board it is about to fill, not a blank lane.
async function loadNativeProfit() { return loadProfit(); }
async function loadProfit() {
  const slot = $("finbody"); if (!slot) return;
  try { S.profit = (await get("/profit/board")).board || {}; S.profitStale = false; drawProfit(); }
  catch (e) { if (S.profit) drawProfit(e.message); else slot.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function drawProfit(refreshError) {
  const slot = $("finbody"); if (!slot) return;
  const p=S.profit||{}, inv=p.inventory, today=p.today, lane=S.profitDetail||"today";
  const stale=p.refresh?.last_error || (p.last_sweep_at && Date.now()-new Date(p.last_sweep_at).getTime()>90*60000 ? "These records need a refresh." : "");
  slot.innerHTML=`
    <div class="seg" aria-label="Profit and inventory">
      ${[["today","Today"],["jobs","By job"],["inventory","Inventory"]].map(([k,t])=>`<button data-pdetail="${k}" class="${lane===k?"on":""}">${t}</button>`).join("")}
    </div>
    ${refreshError||stale?`<p class="note err" role="status">${esc(refreshError||stale)} Showing the last available records.</p>`:""}
    <div id="profitcontent"></div>
    <p class="note" style="margin:16px 0 10px">${p.last_sweep_at?"Updated "+esc(new Date(p.last_sweep_at).toLocaleString()):"First update is pending"} · updates when you open this view and during automatic catch-up.</p>
    <button class="btn wide" id="profitrefresh">Refresh records</button>`;
  on("[data-pdetail]","click",e=>{S.profitDetail=e.currentTarget.dataset.pdetail;drawProfit();},slot);
  $("profitrefresh").onclick=async()=>{const b=$("profitrefresh");b.disabled=true;b.textContent="Refreshing…";try{const r=await api("/profit/sweep",{});S.profit=r.board;drawProfit(r.email_scan&&!r.email_scan.ok?"Email could not be checked. Other records were refreshed.":null);}catch(e){drawProfit(e.message);}};
  const content=$("profitcontent");
  if(lane==="today"){
    const series=(p[S.profitRange]||[]).slice(-14), max=Math.max(1,...series.map(x=>Math.abs(x.net_profit||0)));
    const gaps=inv?.gaps||[], counts={};for(const g of gaps)counts[g.kind]=(counts[g.kind]||0)+1;
    const jobCount=(inv?.jobs||[]).filter(j=>j.date===p.today_date).length;
    content.innerHTML=`<div class="hero" style="margin-top:14px">
      <div class="headline"><span class="eyebrow">Profit so far</span><span class="pill">Partial costs</span></div>
      <div class="big" style="color:${today&&today.net_profit<0?"var(--red)":"var(--emerald)"}">${today?money(today.net_profit):"—"}</div>
      <p class="sub">Sales less recorded costs. Unrecorded labour, supplies or expenses may still reduce this.</p>
      <div class="trio"><div><small>Sales before tax</small><b>${today?money(today.total_income):"—"}</b></div><div><small>Recorded costs</small><b>${today?money(today.total_expenses):"—"}</b></div><div><small>Jobs today</small><b>${jobCount}</b></div></div>
    </div>
    <div class="fintiles"><button class="fintile" id="profitjobs"><small>See each job</small><b>Money left →</b></button><button class="fintile" id="profitstock"><small>Inventory</small><b>${inv?inv.items.length+" items →":"Loading…"}</b></button></div>
    <div class="panel"><h3>What's included</h3><p class="sub">Documented item use and recorded business expenses. Buying stock does not mean it was all used that day. An overhead budget is not subtracted a second time.</p>
    ${gaps.length?`<details style="margin-top:12px"><summary>What's still missing</summary><p class="note">${Object.entries(counts).map(([k,n])=>esc(k.replace(/_/g," "))+": "+n).join(" · ")}</p><p class="note">Open a job or inventory item to see its evidence. You do not need to approve every receipt.</p></details>`:""}</div>
    <div class="panel"><h3>Profit trend · recorded costs</h3><div class="seg">${[["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]].map(([k,l])=>`<button data-pr="${k}" class="${S.profitRange===k?"on":""}">${l}</button>`).join("")}</div>
    ${series.length?`<div class="bars">${series.map(x=>`<div class="b ${(x.net_profit||0)<0?"neg":""}" style="height:${Math.max(2,Math.abs(x.net_profit||0)/max*100)}%" title="${esc(x.date||x.label)}: ${money(x.net_profit)}"></div>`).join("")}</div>`:`<p class="sub">History appears after your first successful update.</p>`}</div>`;
    $("profitjobs").onclick=()=>{S.profitDetail="jobs";drawProfit();};$("profitstock").onclick=()=>{S.profitDetail="inventory";drawProfit();};
    on("[data-pr]","click",e=>{S.profitRange=e.currentTarget.dataset.pr;drawProfit();},content);
  } else if(!inv) content.innerHTML=`<div class="empty">Inventory records are not ready yet. Refresh to try again.</div>`;
  else {
    const stock=lane==="inventory";
    content.innerHTML=`<div class="panel" style="margin-top:14px"><h3>${stock?"Your recorded inventory":"Money left by job"}</h3><p class="sub">${stock?"Purchases less documented use and returns. Opening stock and unrecorded use may change the physical count.":"After identifiable materials, before unrecorded labour, supplies and shared business costs."}</p>
      <label class="note" for="profitsearch">${stock?"Find an item":"Find a customer or invoice"}</label><input id="profitsearch" type="search" placeholder="${stock?"Name, part number or supplier":"Customer, invoice or date"}" style="width:100%;margin-top:6px" autocomplete="off"></div><div id="profitresults"></div>`;
    let visibleLimit=100;
    const render=()=>{
      const q=$("profitsearch").value.trim().toLowerCase(), matching=(stock?inv.items:inv.jobs).filter(x=>(stock?[x.name,x.sku,x.vendor]:[x.customer,x.number,x.date]).join(" ").toLowerCase().includes(q));
      const rows=matching.slice(0,visibleLimit);
      $("profitresults").innerHTML=rows.length?`<div class="list">${rows.map(x=>stock?`<button class="item profit-result" data-item="${esc(x.id)}"><div class="main"><div class="ttl">${esc(x.name)}</div><div class="sub">${esc(x.sku||x.vendor)} · ${esc(x.role)}</div><div class="note">${esc(x.quantity_status)}</div></div><div class="amt">${x.remaining.toLocaleString()}<small style="display:block;font-size:11px;color:var(--dim)">${esc(x.unit)}</small></div></button>`:`<button class="item profit-result" data-job="${esc(x.id)}"><div class="main"><div class="ttl">${esc(x.customer||"Customer")}</div><div class="sub">${esc(x.number||"Invoice")} · ${esc(x.date)}</div><div class="note">${esc(x.status)}</div></div><div class="amt">${money(x.money_left)}<small style="display:block;font-size:11px;color:var(--dim)">before other costs</small></div></button><button class="btn small" style="margin:0 0 12px 12px" data-addjobcost="${esc(x.id)}">＋ Add job cost</button>`).join("")}</div>`:`<div class="empty">${q?"No matching records.":stock?"Your supplier items appear here as complete purchases are read.":"Your issued invoices appear here automatically."}</div>`;
      if(matching.length>rows.length){const more=document.createElement("button");more.className="btn wide";more.style.marginTop="12px";more.textContent=`Show more · ${rows.length} of ${matching.length}`;more.onclick=()=>{visibleLimit+=100;render();};$("profitresults").appendChild(more);}
      on("[data-item]","click",e=>profitItem(inv.items.find(x=>x.id===e.currentTarget.dataset.item)),content);
      on("[data-job]","click",e=>profitJob(inv.jobs.find(x=>x.id===e.currentTarget.dataset.job)),content);
      on("[data-addjobcost]","click",e=>jobCostSheet(inv.jobs.find(x=>x.id===e.currentTarget.dataset.addjobcost)),content);
    };$("profitsearch").oninput=()=>{visibleLimit=100;render();};render();
  }
}
function profitJob(j){
 if(!j)return;
 sheet(`<h2>${esc(j.customer||"Job")}</h2><p class="sh-sub">${esc(j.number||"Invoice")} · ${esc(j.date)}</p><div class="hero"><span class="eyebrow">Money left before other costs</span><div class="big">${money(j.money_left)}</div><p class="sub">${esc(j.note)}</p></div><div class="item"><span>Sales before tax</span><b>${money(j.revenue)}</b></div><div class="item"><span>Recorded job costs</span><b>${money(j.known_material_cost)}</b></div><p class="note">${esc(j.status)}</p><button class="btn primary wide" id="jobaddcost">＋ Add job cost</button><h3>Invoice</h3><div id="jobinvoice"><p class="note">Loading the invoice…</p></div><h3>Cost evidence</h3>${j.allocations.length?j.allocations.map(a=>{const i=S.profit.inventory.items.find(i=>i.id===a.item_key);return `<div class="item"><span>${esc(i?.name||"Item")} · ${a.quantity}</span><b>${money(a.cost)}</b></div>`;}).join(""):`<p class="note">No direct material costs are proven for this job yet. This is not a claim of 100% profit.</p>`}`);
 $("jobaddcost").onclick=()=>jobCostSheet(j);
 jobInvoiceSection(j);
}
// The whole invoice behind the "money left" figure (Kyle 2026-09-11): every
// line, the totals, and the same Print / Share PDF pair the invoice screen has.
// Read straight off the synced sales row; nothing here touches costs.
async function jobInvoiceSection(j){
 const slot=$("jobinvoice");if(!slot)return;
 try{
  const {invoice:inv}=await get(`/profit/job-invoice?sale_id=${encodeURIComponent(j.id)}`);
  if(!document.body.contains(slot))return; // sheet closed while loading
  const lines=inv.lines.length?inv.lines.map(l=>`<div class="kv"><span>${esc(l.description||l.item||"Item")}${l.qty!=null?" × "+esc(String(l.qty)):""}${l.rate!=null?" @ "+money(l.rate):""}</span><span>${l.amount!=null?money(l.amount):"—"}</span></div>`).join(""):`<p class="note">No line items have been read for this invoice yet.</p>`;
  // Built-in books open their invoice page (the QuickBooks PDF route is gated on a
  // QuickBooks connection in the browser); QuickBooks invoices get Print / Share PDF.
  const nativePage=inv.provider==="native"&&inv.link, qboPdf=inv.provider==="quickbooks"&&inv.pdf_available;
  slot.innerHTML=`<p class="sh-sub">${esc(inv.number?"#"+inv.number:"Invoice")} · ${esc(inv.customer||j.customer||"Customer")} · ${esc(inv.date)}</p>${inv.voided?`<p class="note err">This invoice is voided or not issued.</p>`:""}${lines}<div class="kv"><span>Subtotal</span><span>${money(inv.subtotal)}</span></div><div class="kv"><span>Tax</span><span>${money(inv.tax)}</span></div><div class="kv tot"><span>Total</span><span>${money(inv.total)}</span></div>${nativePage?`<button class="btn primary wide" id="jobinvpage" style="margin-top:12px">Open invoice page</button>`:qboPdf?`<div class="rowbtns" style="margin-top:12px"><button class="btn ghost" id="jobsharepdf">Share PDF</button><button class="btn primary" id="jobprintpdf">Print</button></div><div class="note" id="pdfnote" style="margin-top:9px"></div>`:`<p class="note">The document for this invoice is not available here.</p>`}`;
  if(nativePage){$("jobinvpage").onclick=()=>window.open(inv.link,"_blank");return;}
  if(!qboPdf)return;
  const sh=slot.closest(".sheet"),doc={id:inv.document_id,doc:inv.number||""};
  $("jobprintpdf").onclick=()=>withPdf(doc,sh,(url)=>{
   const frame=document.createElement("iframe");
   frame.style.cssText="position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0";
   frame.src=url;document.body.appendChild(frame);
   frame.onload=()=>{try{frame.contentWindow.focus();frame.contentWindow.print();}catch{window.open(url,"_blank");}};
   setTimeout(()=>{if(document.body.contains(frame))frame.remove();},60000);
  });
  $("jobsharepdf").onclick=()=>withPdf(doc,sh,async(url,file)=>{
   if(navigator.canShare&&file&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:file.name});return;}catch{}}
   const a=document.createElement("a");a.href=url;a.download=file?file.name:"invoice.pdf";a.click();
  });
 }catch(e){if(document.body.contains(slot))slot.innerHTML=`<p class="note err">${esc(e.message||"Could not load the invoice.")}</p>`;}
}
async function jobCostSheet(job, initialReceipt) {
 let opts, mode='choose', doc=null, stock=null, draft=null, requestId=crypto.randomUUID(), busy=false, message='', lastSubmit=null;
 let emailSearch='',emailQuery='',emails=[],emailPage=null,emailSearched=false,selectedEmail=null,fromEmailPicker=false;
 const errorText=e=>{const n=$('jcerror');if(n){n.textContent=e.message||String(e);n.scrollIntoView({block:'center'});}};
 const refresh=async()=>{opts=await get('/profit/job-cost-options?sale_id='+encodeURIComponent(job.id));job=opts.job;};
 const title=()=>`<h2>Add job cost</h2><p class="sh-sub">${esc(job.customer||'Customer')} · Invoice ${esc(job.number||'')} · ${esc(job.date)}</p><p class="note">Money left before other costs: <b>${money(job.money_left)}</b></p>`;
 const base=(html)=>{sheet(title()+html+`<p class="note err" id="jcerror" role="alert"></p>${message?`<p class="note" role="status">${esc(message)}</p>`:''}`);};
 const itemName=u=>opts.items.find(i=>i.id===u.item_key)?.name||'Recorded item';
 const choose=()=>{
  mode='choose';base(`<div class="stack" style="display:grid;gap:10px;margin-top:16px"><button class="btn primary wide" id="jccamera">Take a receipt photo</button><button class="btn wide" id="jcupload">Upload a receipt photo</button><button class="btn wide" id="jcreceipts">Existing receipt</button><button class="btn wide" id="jcemail">Receipt from email</button><button class="btn wide" id="jcstock">Use items from stock</button><button class="btn wide" id="jcmanual">Enter a known direct cost</button></div><input type="file" accept="image/*" capture="environment" id="jccamfile" hidden><input type="file" accept="image/*" id="jclibfile" hidden><p class="note">Only record what this job used. Leftover supplies stay in stock. For fuel covering several jobs, enter only a supported share.</p><p class="note">Internal costs only. This does not change the customer's invoice or post an expense to QuickBooks.</p>${opts.uses.length?'<h3>Job costs you recorded</h3>'+opts.uses.map(u=>`<div class="item"><div class="main"><b>${esc(itemName(u))}</b><p class="note">${u.quantity} · ${esc(u.evidence)}</p><button class="btn small" data-jcedit="${esc(u.item_key)}">Correct quantity</button> <button class="btn small" data-jcremove="${esc(u.item_key)}">Remove job link</button></div></div>`).join(''):''}`);
  $('jccamera').onclick=()=>$('jccamfile').click();$('jcupload').onclick=()=>$('jclibfile').click();
  const capture=async file=>{if(!file||busy)return;busy=true;for(const b of document.querySelectorAll('#sheetwrap button'))b.disabled=true;const back=document.querySelector('#sheetwrap .sheet-back');if(back)back.onclick=()=>{};$('jcerror').textContent='Reading the receipt…';try{const image=await downscaleReceipt(file),r=await api('/gmail/photo-receipt',{image,media_type:'image/jpeg'});await refresh();const d=opts.documents.find(d=>d.receipt_id===r.receipt.id);busy=false;if(d)editDocument(d);else list('receipts');}catch(e){busy=false;choose();errorText(e);}};
  $('jccamfile').onchange=e=>capture(e.target.files[0]);$('jclibfile').onchange=e=>capture(e.target.files[0]);
  $('jcemail').onclick=()=>{fromEmailPicker=true;emailPicker();};$('jcreceipts').onclick=()=>{fromEmailPicker=false;list('receipts');};$('jcstock').onclick=()=>list('stock');$('jcmanual').onclick=()=>editDocument(null);
  on('[data-jcedit]','click',e=>editStock(opts.items.find(i=>i.id===e.currentTarget.dataset.jcedit)),document);
  on('[data-jcremove]','click',async e=>{const key=e.currentTarget.dataset.jcremove;await save({request_id:crypto.randomUUID(),sale_id:job.id,mode:'remove',item_key:key,evidence:'Owner removed this job link; source receipt retained.'});},document);
 };
 const list=kind=>{mode=kind;base(`<button class="btn small" id="jcback">Back</button><label>${kind==='stock'?'Item, part number or supplier':'Supplier, receipt number or date'}<input id="jcsearch" autocomplete="off"></label><div id="jcresults"></div>`);$('jcback').onclick=choose;
  const render=()=>{const q=$('jcsearch').value.toLowerCase(),rows=(kind==='stock'?opts.items:opts.documents).filter(x=>(kind==='stock'?[x.name,x.sku,x.vendor]:[x.vendor,x.number,x.date]).join(' ').toLowerCase().includes(q));
   $('jcresults').innerHTML=rows.slice(0,150).map(x=>`<button class="item" style="width:100%;text-align:left" data-jcpick="${esc(x.id)}"><div class="main"><div class="ttl">${esc(kind==='stock'?x.name:x.vendor||'Receipt')}</div><div class="sub">${kind==='stock'?`${x.remaining} ${esc(x.unit)} recorded remaining · ${esc(x.vendor)}`:`${esc(x.number)} · ${esc(x.date)} · ${x.total==null?'Check total':money(x.total)}`}</div></div></button>`).join('')||'<p class="note">No matching records. Take a photo or enter a known cost.</p>';
   if(rows.length>150)$('jcresults').insertAdjacentHTML('beforeend','<p class="note">Search to narrow these results.</p>');
   on('[data-jcpick]','click',e=>{const x=rows.find(x=>x.id===e.currentTarget.dataset.jcpick);kind==='stock'?editStock(x):editDocument(x);},$('jcresults'));};$('jcsearch').oninput=render;render();
 };
 const emailPicker=()=>{
  mode='email';base(`<button class="btn small" id="jcback">Back</button><h3>Receipt from email</h3><form id="jcemailform"><label>Supplier, invoice number or email search<input id="jcemailsearch" autocomplete="off" value="${esc(emailSearch)}"></label><button class="btn primary wide" id="jcemailfind">Search email</button></form><p class="note">Saved receipts are below. Search your connected email for anything missing. No job cost is added until you select items and save.</p><h3>Saved email receipts</h3><div id="jcemailsaved"></div>${emailSearched?`<h3>${emailQuery?'Email results for “'+esc(emailQuery)+'”':'Recent invoices and receipts in email'}</h3><div id="jcemailresults">${emails.map(e=>`<button class="item" style="width:100%;text-align:left" data-jcemail="${esc(e.id)}"><div class="main"><div class="ttl">${esc(e.from_name||e.from_email)}</div><div>${esc(e.subject||'No subject')}</div><div class="sub">${esc(e.received_at.slice(0,10))}</div></div></button>`).join('')||'<p class="note">No matching emails. Try a supplier name or invoice number.</p>'}</div>${emailPage?'<button class="btn wide" id="jcemailmore">Load more emails</button>':''}`:''}`);
  $('jcback').onclick=()=>{fromEmailPicker=false;choose();};
  const saved=()=>{emailSearch=$('jcemailsearch').value;const q=emailSearch.toLowerCase(),rows=opts.documents.filter(d=>d.source==='email'&&[d.vendor,d.number,d.date,d.from_name,d.from_email,d.subject].join(' ').toLowerCase().includes(q));
   $('jcemailsaved').innerHTML=rows.map(d=>`<button class="item" style="width:100%;text-align:left" data-jcemailsaved="${esc(d.id)}"><div class="main"><div class="ttl">${esc(d.vendor||d.from_name||'Receipt')}</div><div class="sub">${esc(d.number)} · ${esc(d.date)} · ${d.total==null?'Check total':money(d.total)}</div><div class="sub">${esc(d.subject||'')}</div><span class="note" style="color:var(--cyan)">Already saved</span></div></button>`).join('')||'<p class="note">No saved email receipts match. Search email above.</p>';
   on('[data-jcemailsaved]','click',e=>{fromEmailPicker=true;editDocument(rows.find(d=>d.id===e.currentTarget.dataset.jcemailsaved));},$('jcemailsaved'));
  };$('jcemailsearch').oninput=saved;saved();
  $('jcemailform').onsubmit=e=>{e.preventDefault();searchEmail(false);};
  if($('jcemailmore'))$('jcemailmore').onclick=()=>searchEmail(true);
  on('[data-jcemail]','click',e=>openEmail(e.currentTarget.dataset.jcemail),document);
 };
 const emailBusy=(label)=>{busy=true;for(const n of document.querySelectorAll('#sheetwrap button,#sheetwrap input'))n.disabled=true;const back=document.querySelector('#sheetwrap .sheet-back');if(back)back.onclick=()=>{};$('jcerror').textContent=label;};
 const searchEmail=async more=>{
  if(busy)return;emailSearch=$('jcemailsearch').value;if(!more){emailQuery=emailSearch.trim();emails=[];emailPage=null;emailSearched=false;}
  emailBusy('Searching email…');let problem;
  try{const r=await get('/gmail/job-email-list?q='+encodeURIComponent(emailQuery)+(more&&emailPage?'&page='+encodeURIComponent(emailPage):''));const seen=new Set(emails.map(e=>e.id));emails.push(...r.emails.filter(e=>!seen.has(e.id)));emailPage=r.next_page;emailSearched=true;}catch(e){problem=e;}finally{busy=false;emailPicker();if(problem)errorText(problem);}
 };
 const openEmail=async id=>{if(busy)return;emailBusy('Opening email…');try{const r=await get('/gmail/job-email-preview?id='+encodeURIComponent(id));selectedEmail=r.email;busy=false;emailPreview();}catch(e){busy=false;emailPicker();errorText(e);}};
 const emailPreview=()=>{
  mode='emailPreview';const e=selectedEmail;base(`<button class="btn small" id="jcback">Back to email receipts</button><h3>${esc(e.subject||'Email receipt')}</h3><p class="note">${esc(e.from_name)} · ${esc(e.from_email)}<br>${esc(e.received_at.slice(0,10))}</p>${e.body?`<details><summary>Read email</summary><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(e.body)}</p></details>`:''}<h3>Choose the invoice or receipt</h3><p class="note">Choose one document to read and save to Receipts. You’ll check its items and enter only what this job used next.</p><div class="stack" style="display:grid;gap:10px">${(e.documents||[]).map(d=>`<button class="btn wide" data-jcemaildoc="${esc(d.key)}" style="white-space:normal;overflow-wrap:anywhere">${esc(d.filename)}</button>`).join('')||'<p class="note">No readable document was found. Choose another email or upload a receipt photo.</p>'}</div>`);
  $('jcback').onclick=emailPicker;on('[data-jcemaildoc]','click',event=>captureEmail(event.currentTarget.dataset.jcemaildoc),document);
 };
 const captureEmail=async key=>{if(busy)return;emailBusy('Reading the selected receipt…');try{const r=await api('/gmail/job-email-capture',{message_id:selectedEmail.id,document_key:key});await refresh();const d=opts.documents.find(d=>d.receipt_id===r.receipt_id||r.purchase_id&&d.purchase_id===r.purchase_id);busy=false;if(d){fromEmailPicker=true;editDocument(d);}else{emailPicker();errorText('The receipt is saved, but its choices could not refresh. Reopen this job and choose the saved receipt.');}}catch(e){busy=false;emailPreview();errorText(e);}};
 const editStock=i=>{if(!i)return;message='';mode='stockEntry';stock=i;doc=null;requestId=crypto.randomUUID();const use=opts.uses.find(u=>u.item_key===i.id),q=use?.quantity??job.allocations.filter(a=>a.item_key===i.id).reduce((n,a)=>n+a.quantity,0);
  base(`<button class="btn small" id="jcback">Back</button><h3>${esc(i.name)}</h3><p class="note">${i.remaining} ${esc(i.unit)} recorded remaining. Availability is checked on the job date.</p><label>Total quantity used (${esc(i.unit)})<input id="jcquantity" type="number" min="0" step="any" value="${q||''}"></label><p class="note">This is the item's total for this job, including any quantity already matched. Fractions are allowed.</p><label>Extra note (optional)<input id="jcnote" value="${esc(use?.evidence||'')}"></label><button class="btn primary wide" id="jcsave">Save job cost</button>`);
  $('jcback').onclick=choose;$('jcsave').onclick=()=>{if(!$('jcquantity').value)return errorText('Enter the quantity used.');save({request_id:requestId,sale_id:job.id,mode:'stock',item_key:i.id,purchase_id:use?.purchase_id||null,quantity:Number($('jcquantity').value),evidence:$('jcnote').value});};
 };
 const editDocument=d=>{message='';doc=d;stock=null;mode=d?'receiptEntry':'manualEntry';requestId=crypto.randomUUID();
  draft={vendor:d?.vendor||'',number:d?.number||'',date:d?.date||job.date,total:d?.total??'',gst:d?.gst??(d?'':0),lines:d?.lines?.length?d.lines.map(l=>({...l,qty:l.qty??'',unit_cost:l.unit_cost??'',uom:l.uom||'purchase units',selected:false,used:''})):[{description:'',qty:d?'':1,unit_cost:'',uom:d?'purchase units':'job'}],quantity:d?'':1,evidence:''};renderDocument();
 };
 const captureDraft=()=>{for(const k of ['vendor','number','date','total','gst','quantity','evidence']){const n=$('jc'+k);if(n)draft[k]=n.value;}draft.lines.forEach((l,i)=>{const used=$('jcused'+i);if(used)l.used=used.value;for(const k of ['description','qty','uom','unit_cost']){const n=$(`jcl${i}-${k}`);if(n)l[k]=n.value;}});};
 const renderDocument=()=>{const manual=mode==='manualEntry';
  base(`<button class="btn small" id="jcback">Back</button><h3>${manual?'Known direct cost':'Check the whole receipt'}</h3>${fromEmailPicker?'<p class="note">Check the purchase date against the receipt; the email may have arrived on a different day.</p>':''}<label>Supplier / paid to<input id="jcvendor" value="${esc(draft.vendor)}"></label><label>Receipt number, if available<input id="jcnumber" value="${esc(draft.number)}"></label><label>Purchase date<input id="jcdate" type="date" value="${esc(draft.date)}" max="${esc(S.profit.today_date)}"></label>${manual?'<p class="note">Enter the actual cost before tax, not the amount charged to the customer.</p>':`<label>Receipt total including tax<input id="jctotal" type="number" step=".01" value="${esc(draft.total)}"></label><label>Tax shown (enter 0 if none)<input id="jcgst" type="number" step=".01" value="${esc(draft.gst)}"></label><p class="note">Keep every receipt item, including those not used on this job. Quantities and units must match the receipt.</p>`}${draft.lines.map((l,i)=>`<fieldset style="border:1px solid var(--line);border-radius:14px;margin:12px 0;padding:12px"><legend>${manual?'Cost details':'Purchased item '+(i+1)}</legend><label>Item / description<input id="jcl${i}-description" value="${esc(l.description)}"></label>${manual?'':`<label>Quantity purchased<input id="jcl${i}-qty" type="number" step="any" value="${esc(l.qty)}"></label><label>Unit (litres, each, container…)<input id="jcl${i}-uom" value="${esc(l.uom)}"></label>`}<label>${manual?'Actual cost before tax':'Cost per purchased unit before tax'}<input id="jcl${i}-unit_cost" type="number" step="any" value="${esc(l.unit_cost)}"></label></fieldset>`).join('')}${manual?'':`<button class="btn small" id="jcaddline">Add another receipt item</button> ${draft.lines.length>1?'<button class="btn small" id="jcdropline">Remove last item</button>':''}<h3>Used on this job</h3><details id="jcitems" style="margin:12px 0;border:1px solid var(--line);border-radius:12px;padding:12px"><summary style="cursor:pointer">Select items used · <span id="jcselectedcount">${draft.lines.filter(l=>l.selected).length}</span> selected</summary><div style="display:flex;gap:8px;margin:12px 0"><button class="btn small" id="jcselectall">Select all</button><button class="btn small" id="jcclearselection">Clear selection</button></div>${draft.lines.map((l,i)=>`<label style="display:flex;gap:12px;align-items:center;margin:12px 0"><input type="checkbox" data-jcselected="${i}" ${l.selected?'checked':''} style="width:22px;height:22px;flex:0 0 22px;margin:0"><span>${esc(l.description||'Item '+(i+1))}</span></label>`).join('')}</details><p class="note">Select everything used on this job, then enter each quantity below.</p><div id="jcusage"></div><p class="note">Enter each item's total for this job, including any quantity already matched. Fractions are allowed: 0.25 of a 20-litre container means 5 litres.</p>`}<p class="note">The item and quantity you choose are recorded automatically.</p>${manual?'':'<p class="note">All selected items save together. Items you leave unselected are not changed.</p>'}<label>Extra note (optional)<input id="jcevidence" value="${esc(draft.evidence)}"></label><button class="btn primary wide" id="jcsave">${manual?'Save job cost':'Save selected job costs'}</button>`);
  $('jcback').onclick=fromEmailPicker?emailPicker:choose;if(!manual){$('jcaddline').onclick=()=>{captureDraft();draft.lines.push({description:'',qty:'',unit_cost:'',uom:'purchase units',selected:false,used:''});renderDocument();};if($('jcdropline'))$('jcdropline').onclick=()=>{captureDraft();draft.lines.pop();renderDocument();};const usage=()=>{$('jcselectedcount').textContent=draft.lines.filter(l=>l.selected).length;$('jcusage').innerHTML=draft.lines.map((l,i)=>l.selected?`<label><b>${esc(l.description||'Item '+(i+1))}</b><br>Total quantity used (${esc(l.uom)})<input id="jcused${i}" type="number" min="0" step="any" value="${esc(l.used??'')}"></label>`:'').join('');};on('[data-jcselected]','change',e=>{captureDraft();draft.lines[Number(e.target.dataset.jcselected)].selected=e.target.checked;usage();},document);const selectAll=value=>{captureDraft();draft.lines.forEach(l=>l.selected=value);for(const n of document.querySelectorAll('[data-jcselected]'))n.checked=value;usage();};$('jcselectall').onclick=()=>selectAll(true);$('jcclearselection').onclick=()=>selectAll(false);usage();}
  $('jcsave').onclick=()=>{captureDraft();if(draft.lines.some(l=>!l.description||l.qty===''||l.unit_cost==='')||(!manual&&(draft.total===''||draft.gst==='')))return errorText('Complete the receipt amounts, purchased quantities, and job usage.');
   if(!manual&&!draft.lines.some(l=>l.selected))return errorText('Select the items used on this job.');
   if(!manual&&draft.lines.some(l=>l.selected&&(l.used==null||l.used===''||!Number.isFinite(Number(l.used))||Number(l.used)<0)))return errorText('Enter the quantity used for every selected item.');
   const body={request_id:requestId,sale_id:job.id,mode:manual?'manual':'receipt',quantity:Number(draft.quantity),evidence:draft.evidence,line_index:0,review:{vendor:draft.vendor,number:draft.number,date:draft.date,total:manual?Number(draft.lines[0].unit_cost):Number(draft.total),gst:manual?0:Number(draft.gst),lines:draft.lines.map(l=>({...l,qty:Number(l.qty),unit_cost:Number(l.unit_cost)}))}};if(!manual){body.selections=draft.lines.flatMap((l,i)=>l.selected?[{line_index:i,quantity:Number(l.used)}]:[]);delete body.quantity;delete body.line_index;}if(doc?.purchase_id)body.purchase_id=doc.purchase_id;if(doc?.receipt_id)body.receipt_id=doc.receipt_id;save(body);};
 };
 const save=async body=>{if(busy)return;const content=JSON.stringify({...body,request_id:undefined});if(lastSubmit?.id===body.request_id&&lastSubmit.content!==content){requestId=crypto.randomUUID();body.request_id=requestId;}lastSubmit={id:body.request_id,content};busy=true;const controls=[...document.querySelectorAll('#sheetwrap button,#sheetwrap input')];for(const n of controls)n.disabled=true;const back=document.querySelector('#sheetwrap .sheet-back');if(back)back.onclick=()=>{};
  let saved=false;
  try{const r=await api('/profit/job-cost-save',body);saved=true;S.profit=r.board;drawProfit();const count=body.selections?.length||1;message=count>1?`Saved all ${count} selected items. This job's costs and money left are updated.`:"Saved. This job's costs and money left are updated.";if(r.refresh_pending)message+=" Today's summary is still refreshing.";requestId=crypto.randomUUID();await refresh();choose();}
  catch(e){if(saved){choose();errorText('The costs were saved, but the choices could not refresh. Reopen this job to see them.');}else errorText(e);for(const n of controls)n.disabled=false;const back=document.querySelector('#sheetwrap .sheet-back');if(back)back.onclick=closeSheet;}finally{busy=false;}};
 base('<p class="note">Loading job costs…</p>');try{await refresh();if(initialReceipt){const d=opts.documents.find(d=>d.receipt_id===initialReceipt);d?editDocument(d):choose();}else choose();}catch(e){errorText(e);}
}

function profitItem(i){
 if(!i)return;const inv=S.profit.inventory,gaps=inv.gaps.filter(g=>g.item_key===i.id);
 sheet(`<h2>${esc(i.name)}</h2><p class="sh-sub">${esc(i.sku||"")} · ${esc(i.vendor)}</p><div class="hero"><span class="eyebrow">Recorded quantity</span><div class="big">${i.remaining.toLocaleString()}</div><p class="sub">${esc(i.unit)} · ${esc(i.quantity_status)}</p></div><div class="item"><span>Purchased</span><b>${i.purchased}</b></div><div class="item"><span>Documented use</span><b>${i.used}</b></div><div class="item"><span>Returned</span><b>${i.returned}</b></div><div class="item"><span>Recorded cost remaining</span><b>${money(i.recorded_value)}</b></div><p class="note">${esc(inv.method)} ${i.value_complete?"":"Some counted units have no documented cost."}</p>${gaps.map(g=>`<p class="note">${esc(g.message)}</p>`).join("")}<details style="margin-top:16px"><summary>Correct item details</summary><p class="note">Optional. One correction is remembered for this item only. Use a supplier document or a measured process as evidence.</p><label>Used as<select id="inventoryrole">${[["material","Goods or job materials"],["supply","Shared supplies"],["equipment","Tools or equipment"],["expense","Business expense on purchase"],["unknown","Not established"]].map(([k,t])=>`<option value="${k}" ${i.role===k?"selected":""}>${t}</option>`).join("")}</select></label><label>Unit name<input id="inventoryunit" value="${esc(i.unit)}"></label><label>Units in each purchase unit<input id="inventoryfactor" type="number" min="0.000001" step="any" value="${i.units_per_purchase||1}"></label><label>Exact name or code used on sales invoices<input id="inventoryalias" value="${esc((i.sale_aliases||[]).join(", "))}"></label><label>Evidence<input id="inventoryevidence" placeholder="Supplier label confirms…"></label><button class="btn wide" id="saveinventoryrule">Save item details</button><p class="note err" id="inventoryruleerror"></p></details><details style="margin-top:16px"><summary>Record a stock count</summary><p class="note">Optional end-of-day check. A lower count records the difference as period usage, not as a made-up job cost.</p><label>Counted quantity<input id="inventorycount" type="number" min="0" step="any" value="${i.remaining}"></label><label>Count date<input id="inventorydate" type="date" value="${esc(S.profit.today_date)}" max="${esc(S.profit.today_date)}"></label><label>Count note<input id="inventorynote" placeholder="Shelf count by…"></label><button class="btn wide" id="saveinventorycount">Save count</button><p class="note err" id="inventoryerror"></p></details>`);
 $("saveinventoryrule").onclick=async()=>{const b=$("saveinventoryrule");b.disabled=true;try{const r=await api("/profit/inventory-rule",{item_key:i.id,role:$("inventoryrole").value,unit:$("inventoryunit").value,units_per_purchase:Number($("inventoryfactor").value),sale_aliases:$("inventoryalias").value.split(",").map(s=>s.trim()).filter(Boolean),evidence:$("inventoryevidence").value});S.profit=r.board;closeSheet();drawProfit();}catch(e){$("inventoryruleerror").textContent=e.message;b.disabled=false;}};
 $("saveinventorycount").onclick=async()=>{const b=$("saveinventorycount");b.disabled=true;try{const r=await api("/profit/inventory-count",{item_key:i.id,quantity:Number($("inventorycount").value),date:$("inventorydate").value,evidence:$("inventorynote").value});S.profit=r.board;closeSheet();drawProfit();}catch(e){$("inventoryerror").textContent=e.message;b.disabled=false;}};
}

/* ---------------- profit sweep walkthrough ----------------
   Kyle's 2026-08-24 redesign: the receipt scan and the profit sweep read as two
   fighting mechanisms, so this is the one button that does the whole day —
   scan the inbox, sweep the books, then triage today's receipts one card at a
   time. The card walkthrough is PULL, not push: it only runs when the owner
   taps the button, which is what keeps it outside the dismissal-fatigue rule
   that killed the nightly vendor roll-call. Known vendors arrive pre-answered,
   so the walk decays toward a single confirm as the vendor memory fills in. */
async function runProfitSweep() {
  S.financeLane="profit";S.profitStale=true;setTab("finance");
}

/* ---------------- match, don't move ----------------
   Kyle's 2026-09-05 redesign. The sweep used to ask, per receipt, "which day is
   the job?" — a calendar question nobody wants to answer, and the reason owners
   fall behind. The right question is "which SALE was this for?": once the sale
   is known the day is known. The matcher answers most of these on its own from
   the invoice lines; the owner sees one screen — what matched, the few that
   need a look, what's waiting for a sale — and every answer is one tap. */
const MATCHABLE_CLASSES = new Set(["tires_parts"]);

function msDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function msProfit(v) {
  if (v == null) return "";
  return `<span class="profit${v < 0 ? " neg" : ""}">${v < 0 ? "−" : ""}${money(Math.abs(v))}</span>`;
}
// `mode` "done" = the receipt is already on this job (profit is real);
// "if" = a guess the owner has not confirmed, so the number is what the job
// WOULD make once this receipt lands on it. A loss there is the tell that the
// receipt is bigger than the sale — two jobs, or the wrong invoice.
function msSaleLine(sale, profit, mode) {
  if (!sale) return "";
  let tail = "";
  if (profit != null) {
    if (mode === "if") tail = profit < 0 ? " · would lose " + msProfit(profit) + " — bigger than this sale?" : " · you'd make " + msProfit(profit);
    else tail = " · profit " + msProfit(profit);
  }
  return `<b>Invoice ${sale.number ? "#" + esc(sale.number) : ""}</b>${sale.customer ? " · " + esc(sale.customer) : ""} · ${msDate(sale.date)} · sold ${money(sale.subtotal)}${tail}`;
}
// The order bought more tires than this invoice sold (8 in, 4 out): the rest
// went to another job, so the guess is shown but never linked on its own.
function msSpareLine(detail) {
  const spare = detail && Number(detail.spare_qty) > 0 ? Number(detail.spare_qty) : 0;
  if (!spare) return "";
  const bought = Number(detail.receipt_tires), sold = Number(detail.sale_tires);
  return `<div class="ms-spare">${bought} tires on this order, ${sold} on this invoice — the other ${spare} went to another job or are still in stock. Only ${sold} tire${sold === 1 ? "'s" : "s'"} cost lands here.</div>`;
}
// Tires on the order: the card's per-tire share says it outright; otherwise
// count the product lines' quantities (a levy line has no size/code words).
function msUnits(c) {
  if (!c) return 0;
  if (c.count_split) return Number(c.count_split.order_qty) || 0;
  if (c.detail && Number(c.detail.receipt_tires) > 0) return Number(c.detail.receipt_tires);
  return 0;
}
function msLines(lines) {
  return (lines || []).slice(0, 3).map((l) =>
    `<div class="ms-line">${l.qty != null ? `<em>${esc(String(l.qty))}×</em>` : ""}${esc(l.text)}</div>`).join("");
}
// The sale's own lines, so the owner judges the pairing on what was sold, not
// just the customer's name and a number.
function msSaleLines(sale) {
  const lines = (sale && sale.lines) || [];
  if (!lines.length) return "";
  return `<div class="ms-sold">` + lines.slice(0, 4).map((l) =>
    `<div class="ms-line sale">${l.qty != null ? `<em>${esc(String(l.qty))}×</em>` : ""}${esc(l.text)}${l.amount != null ? `<span>${money(l.amount)}</span>` : ""}</div>`).join("")
    + (lines.length > 4 ? `<div class="ms-line sale more">+${lines.length - 4} more</div>` : "") + `</div>`;
}
// One order fed two jobs: show which tires go to which invoice, one tap to split.
function msSplitBlock(c) {
  const sp = c.split;
  if (!sp || !sp.parts || sp.parts.length < 2) return "";
  return `<div class="ms-split">
    <div class="ms-split-title">Looks like this order fed two jobs:</div>
    ${sp.parts.map((p) => `<div class="ms-split-part">
      ${(p.lines || []).map((l) => `<div class="ms-line">${l.qty != null ? `<em>${esc(String(l.qty))}×</em>` : ""}${esc(l.text)}</div>`).join("")}
      <div class="to">→ ${msSaleLine(p.sale, null)} · cost ${money(p.amount)}</div>
    </div>`).join("")}
    <button class="btn em wide" data-mssplit="${c.id}">&#10003;&nbsp; Split it between these two</button>
  </div>`;
}

/* A supplier the app hasn't seen before: one tap names what kind of cost it is,
   and that answer pre-classifies every receipt it ever sends. Asked once per
   vendor, not once per receipt. */
function psNewVendors(cards, tally, after) {
  const vendors = [];
  for (const c of cards) if (!vendors.some((v) => v.vendor_key === c.vendor_key)) vendors.push(c);
  const step = (i) => {
    if (i >= vendors.length) {
      // Classes changed, so the matcher's view changed — reload it.
      get("/profit/match-review").then((d) => psMatchScreen(d.match, tally, after))
        .catch(() => after());
      return;
    }
    const x = vendors[i];
    const chips = COST_CLASS_OPTIONS.map(([k, l]) =>
      `<button class="btn ghost" data-psclass="${k}" style="margin:3px 4px 0 0">${l}</button>`).join("");
    sheet(`<h2>${esc(x.vendor)}</h2>
      <p class="sh-sub">${money(x.amount)}${x.doc_number ? " · " + esc(x.doc_number) : ""} · new supplier ${i + 1} of ${vendors.length}</p>
      ${x.subject ? `<p class="note" style="margin:0 0 4px">${esc(x.subject)}</p>` : ""}
      <p style="font-weight:600;margin:8px 0 4px">What kind of cost is ${esc(x.vendor)}?</p>
      <p class="note" style="margin:0 0 8px">One answer covers everything this supplier sends from now on.</p>
      ${chips}
      <button class="btn ghost wide" style="margin-top:12px" id="psVendorSkip">Not sure — skip for now</button>
      <div class="note err" id="psErr" style="margin-top:8px"></div>`, (sh) => {
      const err = sh.querySelector("#psErr");
      sh.querySelector("#psVendorSkip").onclick = () => step(i + 1);
      on("[data-psclass]", "click", async (e) => {
        e.currentTarget.disabled = true; err.textContent = "";
        try {
          await api("/profit/classify-vendor", { vendor_key: x.vendor_key, cost_class: e.currentTarget.dataset.psclass });
          tally.classified += 1; S.review = null; step(i + 1);
        } catch (er) { err.textContent = er.message; e.currentTarget.disabled = false; }
      }, sh);
    });
  };
  step(0);
}

function psMatchScreen(review, tally, after) {
  const r = review || {};
  const auto = r.auto || [], proposed = r.proposed || [], waiting = r.waiting || [];
  const returns = r.returns || [], credits = r.credits || [];
  const overdue = returns.filter((x) => x.overdue).length;
  const unread = Number(r.unread_count || 0);
  const need = proposed.length;
  const headline = auto.length && need
    ? `${auto.length} matched to jobs on their own · ${need} need${need === 1 ? "s" : ""} a look`
    : auto.length ? `${auto.length} matched to jobs on their own — nothing needs you`
    : need ? `${need} receipt${need === 1 ? "" : "s"} need${need === 1 ? "s" : ""} a look`
    : credits.length ? (credits.length === 1 ? "A supplier credit needs a home" : `${credits.length} supplier credits need a home`)
    : overdue ? (overdue === 1 ? "One return still has no credit from the supplier" : `${overdue} returns still have no credit from the supplier`)
    : waiting.length ? "Nothing new to match — the rest is waiting for a sale"
    : unread ? "Reading your supplier invoices — matches land on the next pass"
    : returns.length ? "Nothing to match — your returns are waiting on their credits"
    : "Nothing needs matching right now";

  const autoBlock = auto.length ? `
    <div class="ms-auto">
      <div class="headline"><span class="eyebrow">Matched to jobs</span><span class="when">${auto.length} RECEIPT${auto.length === 1 ? "" : "S"}</span></div>
      <p class="sum">Each one landed on the day of the job it was bought for. Looks right?</p>
      <button class="btn em wide" style="margin-top:12px" id="msLooksRight">&#10003;&nbsp; Looks right</button>
      <details class="sc-all"><summary>See them <em>${auto.length}</em></summary>
        ${auto.map((a) => `<div class="ms-row">
          <div class="top"><span>${esc(a.vendor)}${a.doc_number ? " · " + esc(a.doc_number) : ""}</span><span>${money(a.amount)}</span></div>
          ${msLines(a.lines)}
          <div class="to">→ ${msSaleLine(a.sale, a.job_profit)}</div>
          ${msSaleLines(a.sale)}
          <button class="linkbtn" data-msunlink="${a.id}">Wrong invoice</button>
        </div>`).join("")}
      </details>
    </div>` : "";

  const card = (c) => {
    const s = c.sale;
    return `<div class="ms-card" data-mscard="${c.id}">
      <div class="head"><b>${esc(c.vendor)}</b><span>${money(c.amount)}</span></div>
      <div class="meta">${c.doc_number ? esc(c.doc_number) + " · " : ""}arrived ${msDate(c.cost_date)}${c.waiting ? " · was waiting for a sale" : ""}</div>
      ${msLines(c.lines)}
      ${s ? `<div class="ms-guess">Looks like ${msSaleLine(s, c.job_profit, "if")}${msSaleLines(s)}${msSpareLine(c.detail)}</div>${msSplitBlock(c)}`
          : `<div class="ms-guess none">No matching sale on file yet${c.lines_read ? "" : " — still reading this invoice"}.</div>`}
      ${s && c.count_split ? `<button class="btn em wide" data-mscountone="${c.id}" data-sale="${s.id}" data-qty="${c.count_split.sale_qty}">&#10003;&nbsp; Yes — ${c.count_split.sale_qty} of ${c.count_split.order_qty} went here</button>`
        : s ? `<button class="btn em wide" data-msconfirm="${c.id}" data-sale="${s.id}">&#10003;&nbsp; That's the one</button>` : ""}
      <button class="btn ghost wide" data-mspick="${c.id}" data-rej="${s ? s.id : ""}">${s ? "Wrong invoice" : "Pick the invoice"}</button>
      ${msUnits(c) > 1 ? `<button class="btn ghost wide" data-mscount="${c.id}">&#9776;&nbsp; Split by count — ${msUnits(c)} tires, several invoices</button>` : ""}
      <button class="btn ghost wide" data-mswait="${c.id}" data-rej="${s ? s.id : ""}">Not sold yet</button>
      <button class="btn ghost wide" data-msreturned="${c.id}">&#8630;&nbsp; Returned to supplier</button>
      <button class="btn ghost wide" data-msdrop="${c.id}">&#10005;&nbsp; Not a business cost</button>
      <button class="linkbtn" data-msnone="${c.id}">Stock order — not for one job</button>
      <div class="ms-pick" data-mspickbox="${c.id}" hidden></div>
    </div>`;
  };

  const waitBlock = waiting.length ? `
    <details class="sc-all ms-wait"><summary>Waiting for a sale <em>${waiting.length}</em></summary>
      <p class="note" style="margin:4px 0 2px">Bought, not invoiced yet. Each one links itself the moment its sale shows up — or pick it now. Sent it back instead? Mark it returned.</p>
      ${waiting.map((w) => `<div class="ms-row" data-mscard="${w.id}">
        <div class="top"><span>${esc(w.vendor)}${w.doc_number ? " · " + esc(w.doc_number) : ""}</span><span>${money(w.amount)}</span></div>
        <div class="to">since ${msDate(w.since || w.cost_date)}</div>
        <button class="linkbtn" data-mspick="${w.id}" data-rej="">Pick the invoice</button>
        <button class="linkbtn" data-msreturned="${w.id}">&#8630; Returned to supplier</button>
        <div class="ms-pick" data-mspickbox="${w.id}" hidden></div>
      </div>`).join("")}
    </details>` : "";

  // Supplier credit notes the hourly pass could not place: the owner names the
  // purchase, or says nothing on file matches it.
  const creditBlock = credits.length ? `
    <div class="ms-auto ms-credits">
      <div class="headline"><span class="eyebrow">Credits from suppliers</span><span class="when">${credits.length} CREDIT${credits.length === 1 ? "" : "S"}</span></div>
      <p class="sum">Money coming back. Which purchase does each one reverse?</p>
      ${credits.map((k) => `<div class="ms-row" data-mscard="${k.receipt_id}">
        <div class="top"><span>${esc(k.vendor)}${k.doc_number ? " · " + esc(k.doc_number) : ""}</span><span style="color:var(--emerald)">${money(k.amount)}</span></div>
        <div class="to">received ${msDate(k.received_at)}</div>
        <button class="btn ghost wide" data-mscreditpick="${k.receipt_id}">&#8630;&nbsp; Pick the purchase it reverses</button>
        <button class="linkbtn" data-mscreditdrop="${k.receipt_id}">Nothing to tie it to</button>
        <div class="ms-pick" data-mspickbox="${k.receipt_id}" hidden></div>
      </div>`).join("")}
    </div>` : "";

  // Returned purchases: off the numbers, watched until the supplier's credit
  // lands. Two weeks with no credit turns the row amber — that missing credit
  // is the part that actually costs the shop money.
  const returnRow = (x) => {
    const days = Number(x.days_waiting || 0);
    const status = x.credited
      ? `<span style="color:${Number(x.shortfall || 0) > 0.009 ? "var(--gold)" : "var(--emerald)"}">Credit ${x.credit_doc_number ? "#" + esc(x.credit_doc_number) + " " : ""}${money(x.credit_amount || 0)} landed ${msDate(x.credited_at || x.returned_at)}${Number(x.shortfall || 0) > 0.009 ? `. ${money(x.shortfall)} short — that part still counts` : ""}</span>`
      : x.overdue
        ? `<b style="color:var(--gold)">No credit yet after ${days} days — worth a call to ${esc(x.vendor)}</b>`
        : `No credit yet · ${days === 0 ? "returned today" : `${days} day${days === 1 ? "" : "s"}`}`;
    return `<div class="ms-row" data-mscard="${x.id}">
      <div class="top"><span>${esc(x.vendor)}${x.doc_number ? " · " + esc(x.doc_number) : ""}</span><span>${money(x.amount)}</span></div>
      <div class="to">returned ${msDate(x.returned_at)} · ${status}</div>
      <button class="linkbtn" data-msreturnundo="${x.id}">Didn't go back — undo</button>
    </div>`;
  };
  const returnBlock = returns.length ? `
    <details class="sc-all ms-wait ms-returns" ${overdue ? "open" : ""}><summary>Returned to supplier <em>${returns.length}</em>${overdue ? ` <b style="color:var(--gold)">· ${overdue} overdue</b>` : ""}</summary>
      <p class="note" style="margin:4px 0 2px">Sent back, so they don't count against you. Each one waits here for the supplier's credit note.</p>
      ${returns.map(returnRow).join("")}
    </details>` : "";

  const gmailStrip = tally.gmailNeeds ? `
    <div class="warnstrip" style="margin-top:10px"><em>&#9888;</em><span>${esc(tally.gmailNeeds)} — until it's back, new supplier invoices can't be read or matched.
      <button class="btn primary" data-connect="/gmail/start" style="display:block;margin-top:8px;padding:9px 13px;font-size:13px">Reconnect Gmail</button></span></div>` : "";
  const unreadNote = unread && !tally.gmailNeeds
    ? `<p class="note" style="margin-top:10px">${unread} supplier invoice${unread === 1 ? "" : "s"} still being read line by line — they match on the next pass.</p>` : "";

  sheet(`<h2>Profit sweep</h2>
    <p class="sh-sub">${headline}</p>
    ${gmailStrip}
    ${autoBlock}
    ${need ? `<p class="eyebrow" style="margin:16px 0 0;color:var(--gold)">Needs a look</p>` : ""}
    ${proposed.map(card).join("")}
    ${creditBlock}
    ${returnBlock}
    ${waitBlock}
    ${unreadNote}
    <div class="note err" id="msErr" style="margin-top:8px"></div>
    <button class="btn em wide" style="margin-top:14px" id="msDone">Done</button>`, (sh) => {
    const err = sh.querySelector("#msErr");
    const fail = (e) => { err.textContent = e.message; };
    const rerender = (d) => psMatchScreen(d.match, tally, after);
    const reload = async () => rerender(await get("/profit/match-review"));
    const busyCard = (id, onoff) => sh.querySelectorAll(`[data-mscard="${id}"] button`).forEach((b) => { b.disabled = onoff; });

    sh.querySelector("#msDone").onclick = () => after();
    const looks = sh.querySelector("#msLooksRight");
    if (looks) looks.onclick = async () => {
      looks.disabled = true; err.textContent = "";
      try {
        const d = await api("/profit/match-confirm-all", { ids: auto.map((a) => a.id) });
        tally.matched += Number(d.settled || 0); rerender(d);
      } catch (e) { fail(e); looks.disabled = false; }
    };
    on("[data-msunlink]", "click", async (e) => {
      const id = e.currentTarget.dataset.msunlink; e.currentTarget.disabled = true; err.textContent = "";
      try { applyBoard(await api("/profit/match-unlink", { id })); await reload(); }
      catch (er) { fail(er); e.currentTarget.disabled = false; }
    }, sh);
    on("[data-msconfirm]", "click", async (e) => {
      const id = e.currentTarget.dataset.msconfirm; busyCard(id, true); err.textContent = "";
      try {
        const d = await api("/profit/match-confirm", { id, sale_id: e.currentTarget.dataset.sale });
        applyBoard(d); tally.matched += 1; rerender(d);
      } catch (er) { fail(er); busyCard(id, false); }
    }, sh);
    on("[data-mssplit]", "click", async (e) => {
      const id = e.currentTarget.dataset.mssplit; busyCard(id, true); err.textContent = "";
      const card = (r.proposed || []).find((c) => c.id === id);
      const parts = card && card.split ? card.split.parts.map((p) => ({ sale_id: p.sale.id, line_indexes: p.line_indexes })) : [];
      try {
        const d = await api("/profit/match-split", { id, parts });
        applyBoard(d); tally.matched += parts.length; rerender(d);
      } catch (er) { fail(er); busyCard(id, false); }
    }, sh);
    on("[data-mswait]", "click", async (e) => {
      const id = e.currentTarget.dataset.mswait; busyCard(id, true); err.textContent = "";
      try { const d = await api("/profit/match-wait", { id, rejected_sale_id: e.currentTarget.dataset.rej || undefined }); tally.waiting += 1; rerender(d); }
      catch (er) { fail(er); busyCard(id, false); }
    }, sh);
    on("[data-msnone]", "click", async (e) => {
      const id = e.currentTarget.dataset.msnone; busyCard(id, true); err.textContent = "";
      try { const d = await api("/profit/match-none", { id }); tally.stock += 1; rerender(d); }
      catch (er) { fail(er); busyCard(id, false); }
    }, sh);
    // "Returned to supplier": off the numbers now, credit watched from here.
    on("[data-msreturned]", "click", async (e) => {
      const id = e.currentTarget.dataset.msreturned; busyCard(id, true); err.textContent = "";
      try { const d = await api("/profit/match-returned", { id }); tally.returned = (tally.returned || 0) + 1; rerender(d); }
      catch (er) { fail(er); busyCard(id, false); }
    }, sh);
    on("[data-msreturnundo]", "click", async (e) => {
      const id = e.currentTarget.dataset.msreturnundo; busyCard(id, true); err.textContent = "";
      try { rerender(await api("/profit/match-return-undo", { id })); }
      catch (er) { fail(er); busyCard(id, false); }
    }, sh);
    on("[data-mscreditdrop]", "click", async (e) => {
      const id = e.currentTarget.dataset.mscreditdrop; busyCard(id, true); err.textContent = "";
      try { rerender(await api("/profit/credit-dismiss", { receipt_id: id })); }
      catch (er) { fail(er); busyCard(id, false); }
    }, sh);
    // A credit note the hourly pass could not place: same-supplier purchases,
    // likeliest first. One tap on a row pairs it.
    on("[data-mscreditpick]", "click", async (e) => {
      const id = e.currentTarget.dataset.mscreditpick;
      const box = sh.querySelector(`[data-mspickbox="${id}"]`);
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `<p class="note" style="margin:8px 0 4px">Which purchase does this credit reverse?</p><div class="note">Loading recent purchases…</div>`;
      let rows = [];
      try { rows = (await get(`/profit/credit-choices?id=${encodeURIComponent(id)}`)).choices || []; }
      catch (er) { box.innerHTML = `<div class="note err">${esc(er.message)}</div>`; return; }
      if (!rows.length) { box.innerHTML = `<p class="note" style="margin:8px 0">No recent purchases from this supplier to pick from.</p>`; return; }
      box.innerHTML = `<p class="note" style="margin:8px 0 4px">Which purchase does this credit reverse?</p>` + rows.map((c) =>
        `<button class="opt" data-mscreditopt="${c.id}"><b>${c.doc_number ? esc(c.doc_number) : esc(c.vendor)}</b><span>${c.returned ? "returned" : ""}${c.returned && c.likely ? " · " : ""}${c.likely ? "looks like the one" : ""}</span><i>${msDate(c.date)} · ${money(c.amount)}</i></button>`).join("");
      on("[data-mscreditopt]", "click", async (ev) => {
        busyCard(id, true); err.textContent = "";
        try { rerender(await api("/profit/credit-pair", { receipt_id: id, cost_id: ev.currentTarget.dataset.mscreditopt })); }
        catch (er) { fail(er); busyCard(id, false); }
      }, box);
    }, sh);
    on("[data-msdrop]", "click", async (e) => {
      const id = e.currentTarget.dataset.msdrop; const box = sh.querySelector(`[data-mspickbox="${id}"]`);
      box.hidden = false;
      box.innerHTML = `<p class="note" style="margin:8px 0 6px">This removes it from your profit numbers and dismisses the receipt for good — it won't come back on the next scan.</p>
        <button class="btn em wide" data-msdropgo="${id}">Remove it</button>`;
      box.querySelector("[data-msdropgo]").onclick = async () => {
        busyCard(id, true); err.textContent = "";
        try { applyBoard(await api("/profit/exclude-cost", { id })); tally.excluded += 1; await reload(); }
        catch (er) { fail(er); busyCard(id, false); }
      };
    }, sh);
    // "Yes — 1 of 4 went here": place exactly this invoice's tires on it; the
    // rest wait in stock and get asked about when they sell.
    on("[data-mscountone]", "click", async (e) => {
      const id = e.currentTarget.dataset.mscountone, saleId = e.currentTarget.dataset.sale, qty = Number(e.currentTarget.dataset.qty);
      busyCard(id, true); err.textContent = "";
      try {
        const d = await api("/profit/match-split-count", { id, parts: [{ sale_id: saleId, qty }] });
        applyBoard(d); tally.matched += 1; rerender(d);
      } catch (er) { fail(er); busyCard(id, false); }
    }, sh);
    // "Split by count": how many of this order's tires went to each invoice.
    // Steppers per invoice, a running total, and whatever is not placed stays
    // in stock. One tap on "Split it" writes every share.
    on("[data-mscount]", "click", async (e) => {
      const id = e.currentTarget.dataset.mscount;
      const box = sh.querySelector(`[data-mspickbox="${id}"]`);
      if (!box.hidden && box.dataset.mode === "count") { box.hidden = true; return; }
      box.hidden = false; box.dataset.mode = "count";
      const item = proposed.find((c) => c.id === id);
      const units = msUnits(item);
      box.innerHTML = `<p class="note" style="margin:8px 0 4px">${units} tires came in. How many went to each invoice?</p><div class="note">Loading recent invoices…</div>`;
      const seen = new Set();
      const rows = [];
      if (item?.sale && !seen.has(item.sale.id)) { seen.add(item.sale.id); rows.push(item.sale); }
      for (const s of (item?.alternatives || [])) if (!seen.has(s.id)) { seen.add(s.id); rows.push(s); }
      try {
        const d = await get(`/profit/match-choices?id=${encodeURIComponent(id)}`);
        for (const s of d.choices || []) if (!seen.has(s.id)) { seen.add(s.id); rows.push(s); }
      } catch (er) { if (!rows.length) { box.innerHTML = `<div class="note err">${esc(er.message)}</div>`; return; } }
      if (!rows.length) { box.innerHTML = `<p class="note" style="margin:8px 0">No recent invoices to choose from yet.</p>`; return; }
      const counts = {};
      if (item?.count_split && item.sale) counts[item.sale.id] = Number(item.count_split.sale_qty) || 0;
      const render = () => {
        const placed = Object.values(counts).reduce((a, b) => a + b, 0);
        const left = units - placed;
        box.innerHTML = `<p class="note" style="margin:8px 0 4px">${units} tires came in. How many went to each invoice?</p>` + rows.map((s) =>
          `<div class="opt ms-count-row"><b>${s.number ? "#" + esc(s.number) : "—"}</b><span>${esc(s.customer || "")} · ${msDate(s.date)}${s.lines?.length ? "<br>" + esc(s.lines[0].text) : ""}</span>
            <span class="ms-step"><button class="stepbtn" data-msdec="${s.id}" ${!(counts[s.id] > 0) ? "disabled" : ""}>−</button><i>${counts[s.id] || 0}</i><button class="stepbtn" data-msinc="${s.id}" ${left <= 0 ? "disabled" : ""}>+</button></span></div>`).join("")
          + `<div class="ms-count-sum">${placed} of ${units} placed${left > 0 ? ` · <b>${left} still in stock</b> — the sweep asks about ${left === 1 ? "it" : "them"} when ${left === 1 ? "it" : "they"} sell${left === 1 ? "s" : ""}` : ""}</div>
          <button class="btn em wide" data-mscountgo="${id}" ${placed < 1 ? "disabled" : ""}>&#10003;&nbsp; Split it${placed < units ? ` — ${placed} sold, ${left} in stock` : " across these invoices"}</button>`;
        on("[data-msinc]", "click", (ev) => { const k = ev.currentTarget.dataset.msinc; counts[k] = (counts[k] || 0) + 1; render(); }, box);
        on("[data-msdec]", "click", (ev) => { const k = ev.currentTarget.dataset.msdec; counts[k] = Math.max(0, (counts[k] || 0) - 1); if (!counts[k]) delete counts[k]; render(); }, box);
        on("[data-mscountgo]", "click", async () => {
          const parts = Object.entries(counts).filter(([, q]) => q > 0).map(([sale_id, qty]) => ({ sale_id, qty }));
          busyCard(id, true); err.textContent = "";
          try {
            const d = await api("/profit/match-split-count", { id, parts });
            applyBoard(d); tally.matched += parts.length; rerender(d);
          } catch (er) { fail(er); busyCard(id, false); }
        }, box);
      };
      render();
    }, sh);
    // "Different invoice": the next-best guesses first, then the recent sales
    // ranked for this receipt. One tap on a row is the answer.
    on("[data-mspick]", "click", async (e) => {
      const id = e.currentTarget.dataset.mspick, rej = e.currentTarget.dataset.rej || "";
      const box = sh.querySelector(`[data-mspickbox="${id}"]`);
      if (!box.hidden && box.dataset.mode === "pick") { box.hidden = true; return; }
      box.hidden = false; box.dataset.mode = "pick";
      box.innerHTML = `<p class="note" style="margin:8px 0 4px">Which invoice was this for?</p><div class="note">Loading recent invoices…</div>`;
      const item = proposed.find((c) => c.id === id);
      const seen = new Set();
      const rows = [];
      for (const s of (item?.alternatives || [])) if (!seen.has(s.id)) { seen.add(s.id); rows.push(s); }
      try {
        const d = await get(`/profit/match-choices?id=${encodeURIComponent(id)}`);
        for (const s of d.choices || []) if (!seen.has(s.id) && s.id !== rej) { seen.add(s.id); rows.push(s); }
      } catch (er) { if (!rows.length) { box.innerHTML = `<div class="note err">${esc(er.message)}</div>`; return; } }
      if (!rows.length) { box.innerHTML = `<p class="note" style="margin:8px 0">No recent invoices to choose from yet.</p>`; return; }
      box.innerHTML = `<p class="note" style="margin:8px 0 4px">Which invoice was this for?</p>` + rows.map((s) =>
        `<button class="opt" data-msopt="${s.id}"><b>${s.number ? "#" + esc(s.number) : "—"}</b><span>${esc(s.customer || "")}${s.lines?.length ? " · " + esc(s.lines[0].text) : ""}</span><i>${msDate(s.date)} · ${money(s.subtotal)}</i></button>`).join("");
      on("[data-msopt]", "click", async (ev) => {
        busyCard(id, true); err.textContent = "";
        try {
          const d = await api("/profit/match-confirm", { id, sale_id: ev.currentTarget.dataset.msopt, rejected_sale_id: rej || undefined });
          applyBoard(d); tally.matched += 1; rerender(d);
        } catch (er) { fail(er); busyCard(id, false); }
      }, box);
    }, sh);
    on("[data-connect]", "click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const d = await api(b.dataset.connect + "?web=1", {}); location.href = d.authorization_url; }
      catch (er) { b.disabled = false; fail(er); }
    }, sh);
  });
}

/* Empty Day: no supplier invoice/receipt arrived today and nothing is on file
   for it yet. Universal by design — no KMJ/tire wording — so the same four
   buckets read naturally to a barber or a plumber: Supplies, Fuel, Materials,
   Other. Each maps onto an existing cost_class the board already counts. */
const EMPTY_DAY_CLASSES = [
  ["shop_supplies", "Supplies"],
  ["fuel", "Fuel"],
  ["tires_parts", "Materials"],
  ["other", "Other"],
];

function psEmptyDay(tally) {
  const today = S.profit?.today_date || localDay();
  sheet(`<h2>No invoices found today</h2>
    <p class="sh-sub">Would you like to add any costs to today's profit sweep?</p>
    ${EMPTY_DAY_CLASSES.map(([k, l]) => `
      <label class="fld">${esc(l.toUpperCase())}</label>
      <input id="ed-${k}-amt" class="cmpinput" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
      <input id="ed-${k}-note" class="cmpinput" style="margin-top:5px" placeholder="Note — optional">
    `).join("")}
    <button class="btn em wide" style="margin-top:13px" id="edSave">Add to today's sweep</button>
    <button class="btn ghost wide" style="margin-top:8px" id="edCam">&#128247;&nbsp; Photograph a receipt</button>
    <input type="file" id="edCamInput" accept="image/*" capture="environment" hidden>
    <button class="btn ghost wide" style="margin-top:8px" id="edSkip">Skip — nothing to add</button>
    <div class="note err" id="edErr" style="margin-top:8px"></div>`, (sh) => {
    const err = sh.querySelector("#edErr");
    sh.querySelector("#edCam").onclick = () => sh.querySelector("#edCamInput").click();
    // The existing receipt-photo pipeline: read → categorize → post to
    // QuickBooks. Reused as-is rather than re-built for this popup.
    sh.querySelector("#edCamInput").onchange = (e) => captureReceipt(e.target.files?.[0]);
    sh.querySelector("#edSkip").onclick = () => psDone(0, tally);
    sh.querySelector("#edSave").onclick = async (e) => {
      const lines = EMPTY_DAY_CLASSES.map(([k, l]) => ({
        k, l,
        amount: Number(sh.querySelector(`#ed-${k}-amt`).value) || 0,
        note: (sh.querySelector(`#ed-${k}-note`).value || "").trim(),
      })).filter((x) => x.amount > 0);
      if (!lines.length) { err.textContent = "Enter an amount in at least one section, or skip."; return; }
      e.currentTarget.disabled = true; err.textContent = "";
      try {
        for (const line of lines) {
          applyBoard(await api("/profit/add-cost", {
            vendor: line.l, date: today, amount: line.amount, gst: 0,
            cost_class: line.k, note: line.note,
          }));
          tally.added += 1;
        }
        toast(`${lines.length} cost${lines.length === 1 ? "" : "s"} added`);
        psDone(0, tally);
      } catch (er) { err.textContent = er.message; e.currentTarget.disabled = false; }
    };
  });
}

function psCard(cards, index, tally) {
  if (index >= cards.length) { psDone(cards.length, tally); return; }
  const x = cards[index];
  const step = `${index + 1} of ${cards.length}`;
  const chips = COST_CLASS_OPTIONS.map(([k, l]) =>
    `<button class="btn ghost" data-psclass="${k}" style="margin:3px 4px 0 0">${l}</button>`).join("");
  sheet(`<h2>${esc(x.vendor)}</h2>
    <p class="sh-sub">${money(x.amount)}${x.doc_number ? " · " + esc(x.doc_number) : ""} · receipt ${step}</p>
    ${x.subject ? `<p class="note" style="margin:0 0 4px">${esc(x.subject)}</p>` : ""}
    ${x.from ? `<p class="note" style="margin:0 0 8px">From ${esc(x.from)}</p>` : ""}
    <p class="note" style="margin:0 0 10px">${x.vendor_pending
      ? "New vendor — Ledger hasn't seen this one before."
      : "Counted as " + esc(COST_CLASS_NAME[x.cost_class] || x.cost_class) + (x.owner_dated ? " · date already set by you" : "") + "."}</p>
    <p style="font-weight:600;margin:0 0 8px">Is this part of today's costs?</p>
    <button class="btn em wide" id="psYes">&#10003;&nbsp; Yes — today's cost</button>
    <button class="btn ghost wide" style="margin-top:8px" id="psFuture">&#128197;&nbsp; It's for a future job</button>
    <button class="btn ghost wide" style="margin-top:8px" id="psNo">&#10005;&nbsp; No — not a business cost</button>
    <div id="psMore" style="margin-top:10px"></div>
    <div class="note err" id="psErr" style="margin-top:8px"></div>`, (sh) => {
    const more = sh.querySelector("#psMore");
    const err = sh.querySelector("#psErr");
    const busy = (on) => ["#psYes", "#psFuture", "#psNo"].forEach((s) => { const b = sh.querySelector(s); if (b) b.disabled = on; });
    const next = () => psCard(cards, index + 1, tally);
    const fail = (e) => { err.textContent = e.message; busy(false); };

    sh.querySelector("#psYes").onclick = async () => {
      if (x.vendor_pending) {
        // The class answer is the vendor memory: one tap here pre-answers every
        // future receipt this supplier ever sends.
        more.innerHTML = `<p style="font-weight:600;margin:0 0 4px">What kind of cost is ${esc(x.vendor)}?</p>${chips}`;
        on("[data-psclass]", "click", async (e) => {
          busy(true); err.textContent = "";
          try {
            await api("/profit/classify-vendor", { vendor_key: x.vendor_key, cost_class: e.currentTarget.dataset.psclass });
            tally.classified += 1; tally.confirmed += 1; S.review = null; next();
          } catch (er) { fail(er); }
        }, more);
        return;
      }
      tally.confirmed += 1; next();
    };

    sh.querySelector("#psFuture").onclick = () => {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      more.innerHTML = `<p style="font-weight:600;margin:0 0 4px">When is the job?</p>
        <input id="psDate" class="cmpinput" type="date" value="${localDay(tomorrow)}" min="${localDay(tomorrow)}">
        <button class="btn em wide" style="margin-top:8px" id="psPark">Park it on that day</button>
        <p class="note" style="margin-top:7px">It leaves today's costs and counts on the day you picked. Until then it shows under "parked for future jobs" — nothing vanishes.</p>`;
      more.querySelector("#psPark").onclick = async () => {
        busy(true); err.textContent = "";
        try {
          applyBoard(await api("/profit/set-cost-date", { id: x.id, service_date: more.querySelector("#psDate").value, future_ok: true }));
          tally.parked += 1; next();
        } catch (er) { fail(er); }
      };
    };

    sh.querySelector("#psNo").onclick = () => {
      more.innerHTML = `<p class="note" style="margin:0 0 6px">This removes it from your profit numbers and dismisses the receipt for good — it won't come back on the next scan.</p>
        <button class="btn em wide" id="psDrop">Remove it</button>`;
      more.querySelector("#psDrop").onclick = async () => {
        busy(true); err.textContent = "";
        try {
          applyBoard(await api("/profit/exclude-cost", { id: x.id }));
          tally.excluded += 1; next();
        } catch (er) { fail(er); }
      };
    };
  });
}

async function psDone(count, tally) {
  // A vendor answer reclassifies stored cost but only a sweep moves the day's
  // number — finish on the recomputed board so the profit shown is the real one.
  if (tally.classified) {
    try { applyBoard(await api("/profit/sweep", {})); } catch { /* board keeps last numbers */ }
  }
  const today = (S.profit || {}).today || {};
  const swept = today.date === localDay();
  const bits = [];
  if (tally.confirmed) bits.push(`${tally.confirmed} confirmed`);
  if (tally.parked) bits.push(`${tally.parked} parked for a future job`);
  if (tally.excluded) bits.push(`${tally.excluded} removed`);
  if (tally.added) bits.push(`${tally.added} cost${tally.added === 1 ? "" : "s"} added by hand`);
  if (tally.returned) bits.push(`${tally.returned} returned to the supplier — watching for the credit`);
  sheet(`<h2>Day locked in</h2>
    <p class="sh-sub">${count
      ? `${count} receipt${count === 1 ? "" : "s"} reviewed${bits.length ? " — " + bits.join(", ") : ""}.`
      : (bits.length ? `No invoices arrived by email today — ${bits.join(", ")}.` : "No receipts needed your eyes today.")}</p>
    <div class="hero" style="margin-top:10px">
      <div class="headline"><span class="eyebrow">Today's profit</span><span class="when">${esc(today.date || localDay())}</span></div>
      ${swept ? `<div class="big" style="color:${(today.net_profit || 0) >= 0 ? "var(--emerald)" : "var(--red)"}">${money(today.net_profit)}</div>
      <div class="trio">
        <div><small>Income</small><b style="color:var(--cyan)">${money0(today.total_income)}</b></div>
        <div><small>Expenses</small><b style="color:var(--orange)">${money0(today.total_expenses)}</b></div>
      </div>` : `<div class="big" style="color:var(--dim)">${money(today.net_profit || 0)}</div>`}
    </div>
    ${tally.scanNote ? `<p class="note" style="margin-top:9px">${esc(tally.scanNote)}</p>` : ""}
    <button class="btn em wide" style="margin-top:12px" id="psClose">Done</button>`, (sh) => {
    sh.querySelector("#psClose").onclick = () => { closeSheet(); drawProfit(); };
  });
}


/* ---------------- cost of operations ----------------
   Two things the board could not do before: move a cost to the day the work
   actually happened, and record a cost that never arrived by email.

   Both are on-demand. The app volunteers the date question only in aggregate —
   one amber line for costs sitting on days with no sales at all — and never as
   a card per invoice. That restraint is the same rule the vendor review queue
   follows: a queue that asks nightly gets tapped through, and a tapped-through
   queue produces worse data than no queue. */
const COST_CLASS_OPTIONS = [
  ["fuel", "Fuel"],
  ["meals", "Meals and coffee"],
  ["vehicle", "Vehicle and equipment"],
  ["shop_supplies", "Shop supplies"],
  ["tires_parts", "Goods I resell"],
  ["software", "Software"],
  ["advertising", "Advertising"],
  ["other", "Something else"],
];
const COST_CLASS_NAME = Object.fromEntries(COST_CLASS_OPTIONS);

const costTags = (x) => [
  x.redated ? "moved to this day" : null,
  x.manual ? "added by hand" : null,
  x.reconciled ? "in QuickBooks" : null,
  COST_CLASS_NAME[x.cost_class] || null,
].filter(Boolean).join(" · ");

const costRow = (x) => `<button class="attnrow" data-cost="${esc(x.id)}" style="width:100%;margin-bottom:7px">
    <span class="m"><b>${esc(x.vendor)} · ${money(x.amount)}</b>
      <span>${esc(x.date)}${costTags(x) ? " · " + esc(costTags(x)) : ""}</span></span>
    <span class="chev">&#8250;</span></button>`;

function costPanel(c) {
  const flagged = c.date_check || {};
  const recent = c.recent || [];
  return `<div class="panel">
      <div style="display:flex;align-items:center;gap:9px">
        <span class="eyebrow" style="color:var(--orange)">Cost of operations</span>
        <span class="note" style="margin-left:auto">${c.invoice_count || 0} this month</span>
      </div>
      <div class="trio" style="margin-top:11px">
        <div><small>Today</small><b style="color:var(--orange)">${money0(c.today_cost)}</b></div>
        <div><small>Month</small><b>${money0(c.month_cost)}</b></div>
        <div><small>Not in books</small><b style="color:var(--dim)">${money0(c.unposted_amount)}</b></div>
      </div>
      ${flagged.count ? `<button class="attnrow amber" data-datecheck="1" style="width:100%;margin-top:12px">
          <span class="ic">&#128197;</span>
          <span class="m"><b>${flagged.count} cost${flagged.count === 1 ? "" : "s"} on a day with no sales</b>
            <span>${money(flagged.amount)} — usually a delivery that landed before the job. Set the day the work happened.</span></span>
          <span class="chev">&#8250;</span></button>` : ""}
      ${c.parked?.count ? `<div class="warnstrip" style="margin-top:12px"><em>&#128198;</em>
          <span>${c.parked.count} cost${c.parked.count === 1 ? "" : "s"} parked for future jobs — ${money(c.parked.amount)}. ${c.parked.count === 1 ? "Counts" : "First one counts"} on ${esc(c.parked.next_date || "")}.</span></div>` : ""}
      ${recent.length
        ? `<div style="margin-top:12px">${recent.slice(0, 6).map(costRow).join("")}</div>
           <button class="btn ghost wide" style="margin-top:4px" data-allcosts="1">See every cost</button>`
        : `<p class="note" style="margin-top:11px">No costs captured this month yet.</p>`}
      <button class="btn em wide" style="margin-top:9px" data-addcost="1">&#43;&nbsp; Add a cost</button>
      <p class="note" style="margin-top:8px">Fuel, meals and anything paid in cash never arrives by email. Add it here and it lands on the day you spent it.</p>
    </div>`;
}

function wireCostPanel(scope) {
  const recent = (S.profit?.cost_of_operations?.recent) || [];
  on("[data-cost]", "click", (e) => {
    const found = recent.find((x) => x.id === e.currentTarget.dataset.cost);
    if (found) openCostDate(found);
  }, scope);
  on("[data-addcost]", "click", () => openAddCost(), scope);
  on("[data-allcosts]", "click", () => openCostList(false), scope);
  on("[data-datecheck]", "click", () => openCostList(true), scope);
}

/** The board comes back with every write, so the screen and the number move
 *  together — a correction that leaves the total unchanged reads as a no-op. */
function applyBoard(d) {
  if (d?.board) { S.profit = d.board; drawProfit(); }
}

async function openCostList(onlyFlagged) {
  sheet(`<h2>${onlyFlagged ? "Costs on days with no sales" : "Every cost"}</h2>
    <p class="sh-sub">Loading…</p>`);
  try {
    const d = await get(`/profit/costs${onlyFlagged ? "?only=date_check" : ""}`);
    const costs = d.costs || [];
    sheet(`<h2>${onlyFlagged ? "Costs on days with no sales" : "Every cost"}</h2>
      <p class="sh-sub">${onlyFlagged
        ? "Nothing was sold on these days, so the cost most likely belongs to another one. Tap to set the day the work happened."
        : `${costs.length} cost${costs.length === 1 ? "" : "s"} on file, newest first. Tap any one to change its day.`}</p>
      ${costs.length ? costs.map(costRow).join("") : `<div class="empty">Nothing here.</div>`}`, (sh) => {
      on("[data-cost]", "click", (e) => {
        const found = costs.find((x) => x.id === e.currentTarget.dataset.cost);
        if (found) openCostDate(found, onlyFlagged);
      }, sh);
    });
  } catch (e) { toast(friendlyError(e, "Couldn't load your costs. Try again."), "err"); closeSheet(); }
}

/** Re-date one cost. The arrival date is kept visible the whole time: the
 *  question is which of two real days this belongs to, not free data entry. */
/**
 * The document behind a cost, rendered into the re-date sheet.
 *
 * The date question is really a question about the invoice — which job these
 * tires were for — so the answer loads with the screen instead of one tap
 * further in. Fetched after the sheet paints so the picker is never held up by
 * a network call.
 */
// A signed receipt link is only good for five minutes, so a sheet left open on
// the counter renders a broken frame with no explanation. Ask the server for a
// fresh link on the failure itself, once — a second failure is a real problem.
function remintOnExpiry(img, refetch) {
  if (!img) return;
  let retried = false;
  img.onerror = async () => {
    if (retried) {
      const p = document.createElement("p");
      p.className = "note err";
      p.textContent = "Couldn't load the receipt image — close this and open it again.";
      img.replaceWith(p);
      return;
    }
    retried = true;
    try { const fresh = await refetch(); if (fresh) img.src = fresh; } catch { /* the next error swaps in the message */ }
  };
}

async function fillCostReceipt(scope, costId) {
  const slot = scope.querySelector("#cdReceipt");
  if (!slot) return;
  try {
    const { receipt } = await get(`/profit/cost-receipt?id=${encodeURIComponent(costId)}`);
    const doc = receipt.document;
    if (!doc) {
      slot.innerHTML = `<p class="note">${esc(receipt.note || "Typed in by hand — there is no invoice behind this one.")}</p>`;
      return;
    }
    const bits = [];
    if (doc.subject) bits.push(`<p style="font-weight:600;margin:0 0 4px">${esc(doc.subject)}</p>`);
    if (doc.summary) bits.push(`<p class="note" style="margin:0 0 6px;white-space:pre-wrap">${esc(doc.summary)}</p>`);
    const from = [doc.from_name, doc.from_email].filter(Boolean).join(" · ");
    if (from) bits.push(`<p class="note" style="margin:0">From ${esc(from)}</p>`);
    if (doc.received_at) bits.push(`<p class="note" style="margin:0">Landed ${esc(String(doc.received_at).slice(0, 10))}</p>`);
    bits.push(`<p class="note" style="margin:6px 0 0">${money(receipt.subtotal)} counts as cost · ${money(receipt.gst)} GST · ${money(receipt.total)} invoice total</p>`);
    if (doc.image_url) {
      // The signed link expires in five minutes — a supplier invoice is a
      // financial record, so the view dies with the sheet.
      bits.push(`<img src="${esc(doc.image_url)}" alt="The receipt" style="width:100%;border-radius:11px;margin-top:9px">`);
    }
    if (doc.gmail_url) {
      bits.push(`<p style="margin:9px 0 0"><a href="${esc(doc.gmail_url)}" target="_blank" rel="noopener">Open the original email</a></p>`);
    }
    slot.innerHTML = `<details${doc.image_url ? "" : " open"}>
      <summary style="cursor:pointer;font-weight:600">View the full receipt</summary>
      <div style="margin-top:8px">${bits.join("")}</div>
    </details>`;
    remintOnExpiry(slot.querySelector("img"), async () =>
      (await get(`/profit/cost-receipt?id=${encodeURIComponent(costId)}`)).receipt?.document?.image_url);
  } catch (err) {
    slot.innerHTML = `<p class="note">Couldn't open the receipt: ${esc(err.message)}</p>`;
  }
}

function openCostDate(x, cameFromList) {
  const back = () => (cameFromList === undefined ? closeSheet() : openCostList(cameFromList));
  if (x.reconciled) {
    sheet(`<h2>${esc(x.vendor)}</h2>
      <p class="sh-sub">${money(x.amount)} · ${esc(x.doc_number)}</p>
      <div class="note" id="cdReceipt">Opening the receipt…</div>
      <div class="note" style="margin-top:9px">This one is already posted in QuickBooks, so the books own its date now. Change it there and the board follows on the next sweep.</div>`,
      (sh) => fillCostReceipt(sh, x.id));
    return;
  }
  sheet(`<h2>${esc(x.vendor)}</h2>
    <p class="sh-sub">${money(x.amount)}${x.doc_number ? " · " + esc(x.doc_number) : ""} · arrived ${esc(x.received_date)}</p>
    <div class="note" id="cdReceipt" style="margin-top:10px">Opening the receipt…</div>
    <p style="font-weight:600;margin:14px 0 4px">What day was this work actually for?</p>
    <p class="note" style="margin:0 0 8px">Counted on ${esc(x.date)} right now.</p>
    <input id="cdDate" class="cmpinput" type="date" value="${esc(x.date)}" max="${localDay()}">
    <button class="btn em wide" style="margin-top:11px" id="cdGo">Move it to that day</button>
    ${x.redated ? `<button class="btn ghost wide" style="margin-top:8px" id="cdReset">Put it back on ${esc(x.received_date)}</button>` : ""}
    ${x.manual ? `<button class="btn ghost wide" style="margin-top:8px" id="cdDel">Delete this cost</button>` : ""}
    <p class="note" style="margin-top:9px">The board is recalculated for both days, so the profit on each one is right the moment you tap.</p>
    <div class="note" id="cdOut" style="margin-top:6px"></div>`, (sh) => {
    fillCostReceipt(sh, x.id);
    const out = sh.querySelector("#cdOut");
    const group = () => [sh.querySelector("#cdGo"), sh.querySelector("#cdReset"), sh.querySelector("#cdDel")].filter(Boolean);
    const send = async (button, body, done) => {
      group().forEach((b) => b.disabled = true); out.className = "note"; out.textContent = "Updating the board…";
      try { applyBoard(await api(body.path, body.payload)); toast(done); back(); }
      catch (err) { out.className = "note err"; out.textContent = err.message; group().forEach((b) => b.disabled = false); }
    };
    sh.querySelector("#cdGo").onclick = (e) => {
      const date = sh.querySelector("#cdDate").value;
      if (!date) { out.className = "note err"; out.textContent = "Pick a day first."; return; }
      if (date > localDay()) { out.className = "note err"; out.textContent = "That date hasn't happened yet — pick today or earlier."; return; }
      send(e.currentTarget, { path: "/profit/set-cost-date", payload: { id: x.id, service_date: date } },
        `Moved to ${date}`);
    };
    sh.querySelector("#cdReset")?.addEventListener("click", (e) =>
      send(e.currentTarget, { path: "/profit/set-cost-date", payload: { id: x.id, service_date: null } },
        `Back on ${x.received_date}`));
    sh.querySelector("#cdDel")?.addEventListener("click", async (e) => {
      if (!(await askConfirm(`The ${money(x.amount)} cost from ${x.vendor} comes off your profit numbers.`, { title: "Delete this cost?", ok: "Delete", danger: true }))) return;
      send(e.currentTarget, { path: "/profit/delete-cost", payload: { id: x.id } }, "Cost deleted");
    });
  });
}

function openAddCost() {
  const today = S.profit?.today_date || localDay();
  sheet(`<h2>Add a cost</h2>
    <p class="sh-sub">For spend that never arrives by email — fuel, meals, cash, personal card.</p>
    <label class="fld">PAID TO</label>
    <input id="mcVendor" class="cmpinput" placeholder="Shell, Tim Hortons, Canadian Tire…">
    <label class="fld">DAY THE MONEY WAS SPENT</label>
    <input id="mcDate" class="cmpinput" type="date" value="${today}" max="${today}">
    <label class="fld">TOTAL PAID</label>
    <input id="mcAmount" class="cmpinput" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
    <label class="fld">GST INCLUDED &mdash; OPTIONAL</label>
    <input id="mcGst" class="cmpinput" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
    <label class="fld">WHAT WAS IT</label>
    <select id="mcClass" class="cmpinput">${COST_CLASS_OPTIONS.map(([k, l]) =>
      `<option value="${k}">${esc(l)}</option>`).join("")}</select>
    <label class="fld">NOTE &mdash; OPTIONAL</label>
    <input id="mcNote" class="cmpinput" placeholder="Road call to Airdrie">
    <button class="btn em wide" style="margin-top:13px" id="mcGo">Save cost</button>
    <p class="note" style="margin-top:8px">GST is recorded for the audit trail but never counted as cost — it comes back as an input credit.</p>
    <div class="note" id="mcOut" style="margin-top:6px"></div>`, (sh) => {
    const out = sh.querySelector("#mcOut");
    const val = (id) => (sh.querySelector("#" + id)?.value || "").trim();
    sh.querySelector("#mcGo").onclick = async (e) => {
      const payload = {
        vendor: val("mcVendor"),
        date: val("mcDate"),
        amount: Number(val("mcAmount")),
        gst: Number(val("mcGst")) || 0,
        cost_class: val("mcClass"),
        note: val("mcNote"),
      };
      if (!payload.vendor) { out.className = "note err"; out.textContent = "Who was it paid to?"; return; }
      if (!(payload.amount > 0)) { out.className = "note err"; out.textContent = "Enter an amount greater than zero."; return; }
      if (payload.date > localDay()) { out.className = "note err"; out.textContent = "That date hasn't happened yet — pick today or earlier."; return; }
      if (payload.gst < 0) { out.className = "note err"; out.textContent = "GST can't be negative — enter the GST portion of what you paid, or leave it blank."; return; }
      if (payload.gst > payload.amount) { out.className = "note err"; out.textContent = "GST can't be more than the total paid."; return; }
      e.currentTarget.disabled = true; out.className = "note"; out.textContent = "Saving…";
      try {
        applyBoard(await api("/profit/add-cost", payload));
        toast(`${payload.vendor} · ${money(payload.amount)} added`);
        closeSheet();
      } catch (err) { out.className = "note err"; out.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

/* ---------------- CALENDAR ---------------- */
// CALENDAR — mirrors iOS AppointmentCommandView: day search, three schedule stats,
// a Next Up card, a real month booking grid, a Book button, and the selected DAY SCHEDULE.
const CAL = { sel: null, month: null, q: "", hours: null, hoursLine: "" };

/* ---------------- Calendar parity helpers (Kyle 1202, 2026-09-06) ----------------
   The iPhone's Business hours row + editor, the outside-hours override, crew
   dispatch on a booking, the crew section on an appointment, the needs-cover
   flag on the run sheet, and a Crew screen (Track record / Time cards / Roster). */
const HOUR_DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const hoursLineOf = (d) => (d?.description || "").trim() || "Not set — bookings at any time are allowed";

async function loadCalendarHoursLine() {
  if (!$("bizhoursline")) return;
  try {
    const d = await api("/google-calendar/hours", null, "GET");
    CAL.hours = d; CAL.hoursLine = hoursLineOf(d);
  } catch { CAL.hoursLine = "Couldn't load your hours"; }
  const el = $("bizhoursline"); if (el) el.textContent = CAL.hoursLine;
}

async function calendarHoursSheet() {
  let d = CAL.hours;
  if (!d) { try { d = await api("/google-calendar/hours", null, "GET"); CAL.hours = d; } catch (err) { toast(friendlyError(err, "Couldn't load your hours. Try again."), "err"); return; } }
  const hours = { ...(d.business_hours || {}) };
  const rule = "Bookings outside these hours are refused unless you choose Book anyway. Turn every day off to allow any time.";
  sheet(`<h2>Business hours</h2>
    <p class="sh-sub">When can customers be booked?</p>
    ${HOUR_DAYS.map(([k, l]) => { const h = hours[k]; return `<div class="hourrow" data-hday="${k}">
      <label class="hourtoggle"><input type="checkbox" data-hon="${k}" ${h ? "checked" : ""}> <b>${l}</b></label>
      <span class="hourtimes" ${h ? "" : "hidden"}><input type="time" data-hopen="${k}" value="${esc(h?.open || "08:00")}"> <em>to</em> <input type="time" data-hclose="${k}" value="${esc(h?.close || "17:00")}"></span>
    </div>`; }).join("")}
    <p class="note" style="margin-top:10px">${esc(d.timezone ? `${rule} Times are ${d.timezone}.` : rule)}</p>
    <button class="btn em wide" style="margin-top:13px" id="hoursave">Save hours</button>
    <div class="note" id="hoursnote" style="margin-top:8px"></div>`, (sh) => {
    sh.querySelectorAll("[data-hon]").forEach((c) => c.onchange = () => {
      sh.querySelector(`.hourrow[data-hday="${c.dataset.hon}"] .hourtimes`).hidden = !c.checked;
    });
    sh.querySelector("#hoursave").onclick = async (e) => {
      e.currentTarget.disabled = true; const note = sh.querySelector("#hoursnote");
      const body = {};
      for (const [k] of HOUR_DAYS) {
        const on = sh.querySelector(`[data-hon="${k}"]`).checked;
        body[k] = on ? { open: sh.querySelector(`[data-hopen="${k}"]`).value || "08:00", close: sh.querySelector(`[data-hclose="${k}"]`).value || "17:00" } : null;
      }
      try {
        const saved = await api("/google-calendar/hours", { business_hours: body });
        CAL.hours = saved; CAL.hoursLine = hoursLineOf(saved);
        toast("Business hours saved"); closeSheet();
        const el = $("bizhoursline"); if (el) el.textContent = CAL.hoursLine;
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

/** Today's run sheet: how many upcoming jobs have someone on them who is off today (iOS needsCover). */
async function loadRunSheetCover(todayTimed) {
  const el = $("rscover"); if (!el || !todayTimed.length) return;
  const today = dayKey(new Date());
  try {
    const d = await api("/crew", { action: "dispatch", from: today, to: today }, "POST", { silentUpgrade: true });
    const rows = (d.days || []).flatMap((x) => x.assignments || []);
    const now = new Date();
    const uncovered = todayTimed.filter((e) => new Date(e.end || e.start) >= now
      && rows.some((a) => a.eventId === e.id && a.crewOff && a.status !== "done")).length;
    const el2 = $("rscover"); if (!el2 || el2 !== el) return;
    if (uncovered) { el2.textContent = `${uncovered} need${uncovered === 1 ? "s" : ""} cover`; el2.hidden = false; }
  } catch { /* no roster, or signed out — the run sheet simply carries no cover flag */ }
}

/** Crew on an appointment: who's on it, off-day warnings, tap to add or remove (iOS CalendarDetailView + AssignCrewSheet). */
async function loadEventCrew(sh, e) {
  const box = sh.querySelector("#evcrew"), tag = sh.querySelector("#evcrewtag"); if (!box) return;
  let assignments = [], roster = [];
  try {
    const [a, r] = await Promise.all([api("/crew", { action: "for-event", event_id: e.id }, "POST", { silentUpgrade: true }), api("/crew", { action: "list" }, "POST", { silentUpgrade: true })]);
    assignments = a.assignments || []; roster = (r.employees || []).filter((x) => x.active !== false);
  } catch (err) {
    if (!sh.isConnected) return;
    tag.textContent = "";
    box.innerHTML = `<span class="note">${esc(err.status === 402 ? "Crew assignments are part of Pro. Your booking is available below." : err.message)}</span>${err.status === 402 ? "" : '<button class="btn ghost" id="crewretry">Retry crew details</button>'}`;
    const retry=box.querySelector("#crewretry"); if(retry) retry.onclick=()=>loadEventCrew(sh,e); return;
  }
  if (!sh.isConnected) return;
  const off = assignments.filter((a) => a.crewOff && a.status !== "done").length;
  tag.textContent = !assignments.length ? "Nobody on it yet" : off ? "Someone on this job is off" : "";
  tag.style.color = (!assignments.length || off) ? "var(--orange)" : "";
  box.innerHTML = `<div class="chips" style="display:flex;flex-wrap:wrap;gap:8px">
      ${assignments.map((a) => `<button type="button" class="chip on" data-evunassign="${esc(a.employeeId)}" title="Tap to take them off">${esc(a.employeeName || "Crew")}${a.crewOff && a.status !== "done" ? " · off that day — needs cover" : ""}</button>`).join("")}
      ${roster.filter((x) => !assignments.some((a) => a.employeeId === x.id)).map((x) => `<button type="button" class="chip" data-evassign="${esc(x.id)}">${esc(x.name)}</button>`).join("")}
    </div>
    ${assignments.map(a=>`<button class="btn" data-dispatch="${esc(a.employeeId)}">Review email to ${esc(a.employeeName || "crew member")}${a.dispatchedAt ? " · previously sent" : ""}</button>`).join("")}
    <p class="note" style="margin-top:6px">${roster.length
      ? `Tap a name to put them on this job ${esc(dayLabel(e.start))}. Tap again to take them off.`
      : "No crew on the roster yet. Add crew members from the Crew card on the Calendar tab first."}</p>`;
  const rerun = () => loadEventCrew(sh, e);
  box.querySelectorAll("[data-dispatch]").forEach(b=>b.onclick=()=>crewEmailDispatchSheet(e, b.dataset.dispatch));
  box.querySelectorAll("[data-evassign]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      await api("/crew", { action: "assign", employee_id: b.dataset.evassign, event_id: e.id, job_date: evDayKey(e.start),
        job_title: e.title, job_start: e.start, job_location: e.location || "", job_details: e.description || "" });
      rerun();
    } catch (err) { toast(friendlyError(err, "Couldn't assign that crew member. Try again."), "err"); b.disabled = false; }
  });
  box.querySelectorAll("[data-evunassign]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api("/crew", { action: "unassign", employee_id: b.dataset.evunassign, event_id: e.id }); rerun(); }
    catch (err) { toast(friendlyError(err, "Couldn't update that crew assignment. Try again."), "err"); b.disabled = false; }
  });
}

/* ---------------- LIVE CREW MAP (Kyle 1202, 2026-09-12) ----------------
   Apple Maps (MapKit JS) fed by crew {action:"locations"}. Every pin is a
   person's initial with a drive time to their job; a position under three
   minutes old pulses, anything older than ten minutes turns grey. Build 1.5
   (Kyle 12491): a drive time is LIVE only off a fresh position — otherwise
   the ORIGINAL estimate the customer was texted is shown as exactly that.
   Tap a name for call / text / route. The list under the map is the same
   feed in words, and it is what shows when the map is unavailable. Refreshes
   every 30 s while the sheet is open and stops the moment it closes. */
let MAPKIT_LOAD = null;
function loadMapKit() {
  if (window.mapkit && window.mapkit.init) return Promise.resolve(window.mapkit);
  if (MAPKIT_LOAD) return MAPKIT_LOAD;
  MAPKIT_LOAD = new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
    sc.crossOrigin = "anonymous";
    sc.dataset.libraries = "map,annotations";
    sc.onload = () => resolve(window.mapkit);
    sc.onerror = () => { MAPKIT_LOAD = null; reject(new Error("Apple Maps could not be loaded.")); };
    document.head.appendChild(sc);
  });
  return MAPKIT_LOAD;
}
let MAPKIT_READY = false;
async function ensureMapKit() {
  const mk = await loadMapKit();
  if (!MAPKIT_READY) {
    mk.init({
      authorizationCallback: (done) => api("/crew", { action: "maps-token" }).then((r) => done(r.token)).catch((err) => { toast(friendlyError(err, "The map is unavailable right now. The crew list is still live."), "err"); }),
      language: "en",
    });
    MAPKIT_READY = true;
  }
  return mk;
}
function agoWords(seconds) {
  if (seconds == null) return "no location yet";
  if (seconds < 60) return "just now";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60 ? (m % 60) + " min" : ""} ago`.replace(/\s+ago/, " ago") : "over a day ago";
}
function crewStatusWord(c) {
  if (!c.clockedIn) return "Off the clock";
  return { on_my_way: "On my way", on_site: "On site", done: "Done" }[c.status] || (c.currentJob ? "Assigned" : "On the clock");
}
function crewClock(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  try { return d.toLocaleTimeString("en-CA", { timeZone: tz || undefined, hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.m\./i, (m, p) => " " + p.toUpperCase() + "M"); }
  catch { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
}
function hoursWords(seconds) {
  const h = Math.floor((seconds || 0) / 3600), m = Math.round(((seconds || 0) % 3600) / 60);
  if (!h && !m) return "0 h";
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
// One line for "how far away": the server's rule (Kyle 2026-09-12) — live
// only off a position under three minutes old, otherwise the ORIGINAL
// estimate said as exactly that. This is display only; nothing is recomputed.
function crewEstimateLine(c, tz) {
  const e = c.estimate; if (!e) return "";
  const job = c.currentJob && c.currentJob.title ? esc(c.currentJob.title) : "the job";
  if (e.kind === "live") return `<span style="color:var(--cyan)">${Math.max(1, Math.round(e.etaSeconds / 60))} min from ${job} — arriving ~${crewClock(e.etaAt, tz)} <span class="note">(live, as of ${crewClock(e.asOf, tz)})</span></span>`;
  if (e.kind === "original") return `<span style="color:var(--orange)">Original estimate ${crewClock(e.etaAt, tz)} — location isn't updating${e.staleSince ? ` since ${crewClock(e.staleSince, tz)}` : ""}</span>`;
  return `<span class="note">${esc(e.line || "")}</span>`;
}
function crewTextMarks(t, tz) {
  if (!t) return "";
  const bits = [];
  const mark = (label, r) => {
    if (!r) return;
    if (r.state === "sent") bits.push(`<span style="color:var(--emerald)">${label} ${crewClock(r.sentAt, tz)} ✓</span>`);
    else if (r.state === "failed") bits.push(`<span style="color:var(--red);font-weight:700">${label} text failed ✗</span>`);
    else if (r.state === "sending") bits.push(`<span class="note">${label} sending…</span>`);
  };
  mark("Customer told", t.on_my_way); mark("Arrived text", t.arrived); mark("All-done text", t.done);
  return bits.join(" · ");
}
// ── Crew premium redesign (Kyle 12510 + 1202, 2026-09-12) ─────────────────
// The web twin of the iPhone Crew screens: hub dashboard with live readouts,
// map-as-hero (always drawn, centred on the shop when quiet), sigil pins,
// chip legend, one-row location setting, live sweep; Track Record with period
// chips + rank plates; Time Cards with a day strip that is always drawn.
// Pure UI over the feeds the app already has — nothing new on the server.
const CREW_REDUCE_MOTION = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const crewFirst = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const crewHours = (sec) => { const s = sec || 0; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); if (!h && !m) return "0h"; if (!h) return `${m}m`; return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`; };
const CREW_RGB = { cyan: "58,200,245", emerald: "47,224,160", orange: "251,146,60", purple: "168,85,247", pink: "244,114,182", yellow: "250,204,21", red: "248,113,113", blue: "59,130,246", silver: "194,209,230", gold: "251,191,36", grey: "110,120,135" };
const crewRgb = (tag) => CREW_RGB[String(tag || "").toLowerCase()] || CREW_RGB.cyan;
/** Chamfered crew badge (the sigil), tinted by the member's colour tag. `tick` = emerald | amber | orange | null. */
function crewSigil(name, tag, size = 44, tick = null) {
  const t = tick ? `<i class="ctick ${tick}"></i>` : "";
  return `<span class="csigw" style="--s:${size}px;--sig:${crewRgb(tag)}"><span class="csig">${sigilMark(name)}<i class="rail"></i></span>${t}</span>`;
}
function crewKicker(text, tint = "cyan", dot = false) {
  return `<span class="ck" style="--sig:${crewRgb(tint)}">${dot ? '<i class="ckd"></i>' : ""}${esc(text)}</span>`;
}
function crewPill(text, tint = "emerald", live = false) {
  return `<span class="cpill${live ? " live" : ""}" style="--sig:${crewRgb(tint)}"><i></i>${esc(text)}</span>`;
}
/** One stat tile: quiet at zero (dim number, silver glow). `text` overrides the number. */
function crewStat(number, label, tint = "cyan", { live = false, text = null } = {}) {
  const quiet = text == null ? !number : (text === "0h" || text === "—");
  return `<div class="cstat${quiet ? " quiet" : ""}" style="--sig:${crewRgb(quiet ? "silver" : tint)}">
    <div class="ckrow">${crewKicker(label, quiet ? "silver" : tint)}${live ? '<i class="cld"></i>' : ""}</div>
    <b ${text == null ? `data-count="${number}"` : ""}>${text == null ? (CREW_REDUCE_MOTION() ? number : 0) : esc(text)}</b>
  </div>`;
}
/** Roll every [data-count] number in `root` from 0 to its value. */
function crewCountUp(root) {
  if (!root) return;
  root.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count) || 0; delete el.dataset.count;
    if (CREW_REDUCE_MOTION() || !target) { el.textContent = String(target); return; }
    const t0 = performance.now(), dur = 700;
    const tick = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = String(Math.round(target * e)); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}
/** Radar for the hub tile: rings, a slow sweep, one blip per crew member on the clock. */
function crewRadar(members, tint = "cyan", size = 96) {
  const blips = members.map((m, i) => {
    let h = 0; for (const ch of String(m.name || "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const r = size * (0.18 + 0.28 * ((i + 1) % 3) / 2 + 0.06), rad = h * Math.PI / 180;
    const x = size / 2 + Math.cos(rad) * r, y = size / 2 + Math.sin(rad) * r;
    return `<i class="cblip${m.live ? " live" : ""}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;--sig:${crewRgb(m.colorTag)}"></i>`;
  }).join("");
  return `<div class="cradar" style="--s:${size}px;--sig:${crewRgb(tint)}"><i class="r1"></i><i class="r2"></i><i class="r3"></i><i class="cross"></i><i class="sweep"></i>${blips}<i class="core"></i></div>`;
}
function crewLegend() {
  const chips = [
    ["live", "cyan", "LIVE", "A pulsing pin is a position under three minutes old. Drive times off it are live.", true],
    ["way", "gold", "ON THE WAY", "Amber means they tapped On my way. The customer text carries this estimate.", false],
    ["paused", "grey", "PAUSED", "Grey means no update in ten minutes — updates pause while their job link is closed (like driving with Maps open). It does not mean they stopped moving.", false],
    ["job", "purple", "JOB", "Today's open jobs with an address. Done jobs leave the map.", false],
  ];
  return `<div class="clegend">${chips.map(([k, tint, label, hint, pulse]) => `<button type="button" class="clchip" data-hint="${esc(hint)}" style="--sig:${crewRgb(tint)}"><i class="${pulse ? "cld" : "cdot"}"></i>${label}</button>`).join("")}</div><div class="clhint" hidden></div>`;
}
function crewWireLegend(root) {
  const hint = root.querySelector(".clhint"); if (!hint) return;
  root.querySelectorAll(".clchip").forEach((b) => b.onclick = () => {
    const open = !hint.hidden && hint.dataset.for === b.dataset.hint;
    hint.hidden = open; hint.textContent = open ? "" : b.dataset.hint; hint.dataset.for = open ? "" : b.dataset.hint;
  });
}
function crewSweep(updatedAt) {
  const t = updatedAt ? new Date(updatedAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", second: "2-digit" }).replace(/\s?([ap])\.m\./i, (m, p) => " " + p.toUpperCase() + "M").toUpperCase() : "";
  return `<div class="csweep"><div class="cst"><i class="cld"></i><span>${t ? `LIVE · UPDATED ${esc(t)}` : "LIVE · CONNECTING"}</span><em>EVERY 30 S</em></div><div class="csb"><i></i></div></div>`;
}
function crewRestartSweep(root) {
  const bar = root.querySelector(".csb i"); if (!bar) return;
  bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = CREW_REDUCE_MOTION() ? "none" : "csweep 30s linear forwards";
  if (CREW_REDUCE_MOTION()) bar.style.width = "100%";
}
const crewShopCentreKey = "crew.shopCentre.v1";
function crewShopCentreCached() { try { const c = JSON.parse(accountStorage.getItem(crewShopCentreKey) || "null"); return c && typeof c.lat === "number" ? c : null; } catch { return null; } }
function crewShopCentreRemember(lat, lng, address) { try { accountStorage.setItem(crewShopCentreKey, JSON.stringify({ lat, lng, address: address || crewShopCentreCached()?.address || "" })); } catch {} }

async function crewLiveMapSheet() {
  const wrap = sheet(`<div class="chead">${crewKicker("LIVE MAP", "cyan", true)}<h2>Where your crew is</h2></div>
    <div class="cmapcard" id="lmcard">
      <div class="cmapwrap"><div id="lmmap" class="cmap"></div>
        <div class="cmapcounts" id="lmcounts"></div>
        <div class="cmapveil" id="lmveil" hidden><div class="cmapmsg" id="lmmsg"></div></div>
      </div>
      <p class="note cmapdown" id="lmnote" hidden></p>
      ${crewLegend()}
      <div id="lmsweep">${crewSweep(null)}</div>
    </div>
    <div class="ckrow" style="margin:16px 0 8px">${crewKicker("CREW", "cyan")}<span class="ckr" id="lmcount"></span></div>
    <div id="lmlist"></div>
    <div class="cpolicy crise" style="--i:3">
      <div class="cprow">
        <div>${crewKicker("LOCATION ON SHIFT", "cyan")}<div class="note" style="margin-top:3px">Never blocks a clock-in.</div></div>
        <div class="cseg" id="lmpolicy"></div>
        <button type="button" class="cinfo" id="lminfo" aria-label="How location on shift works">i</button>
      </div>
      <div class="cfine" id="lmfine" hidden>Required: crew are told the shop needs their location while clocked in. Optional: sharing is their choice. Either way it shuts off by itself at clock-out, and neither setting ever blocks a clock-in — a crew member with location off still gets clocked in and paid correctly; you see “location off” next to their name.</div>
      <p class="note" id="lmpnote" hidden></p>
    </div>`);
  const pane = wrap.querySelector(".sheet"); pane.classList.add("crewsheet");
  crewWireLegend(pane);
  pane.querySelector("#lminfo").onclick = () => { const f = pane.querySelector("#lmfine"); f.hidden = !f.hidden; };
  let map = null, mk = null, timer = null, mapFailed = false, marks = new Map(), routeLine = null, openCard = null, last = null, centred = false;
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  const alive = () => wrap.isConnected && document.body.contains(wrap);
  const MAP_DOWN = "Drive times and job pins are unavailable right now — crew positions still show.";
  const paintPolicy = (policy) => {
    const host = pane.querySelector("#lmpolicy"); if (!host) return;
    host.innerHTML = ["required", "optional"].map((p) => `<button type="button" class="${policy === p ? "on" : ""}" data-pol="${p}">${p === "required" ? "Required" : "Optional"}</button>`).join("");
    host.querySelectorAll("[data-pol]").forEach((b) => b.onclick = async () => {
      if (b.classList.contains("on")) return;
      host.querySelectorAll("button").forEach((x) => x.disabled = true);
      const note = pane.querySelector("#lmpnote"); note.hidden = true;
      try { const r = await api("/crew", { action: "set-location-policy", policy: b.dataset.pol }); paintPolicy(r.policy); toast(r.policy === "required" ? "Location is required on shift" : "Location is optional for your crew"); }
      catch (err) { note.textContent = err.status === 403 ? "Only the owner or an admin can change this." : err.message; note.hidden = false; note.style.color = "var(--orange)"; paintPolicy(policy); }
    });
  };
  const tel = (p) => { const d = String(p || "").replace(/[^\d+]/g, ""); return d.replace(/\D/g, "").length >= 10 ? d : null; };
  const showRoute = async (c) => {
    if (!map || !mk || c.lat == null || !c.currentJob || c.currentJob.lat == null) { toast("No pinned job to route to yet.", "err"); return; }
    if (routeLine) { map.removeOverlay(routeLine); routeLine = null; }
    const from = new mk.Coordinate(c.lat, c.lng), to = new mk.Coordinate(c.currentJob.lat, c.currentJob.lng);
    const straight = () => { routeLine = new mk.PolylineOverlay([from, to], { style: new mk.Style({ lineWidth: 3, strokeColor: "#22d3ee", lineDash: [6, 6] }) }); map.addOverlay(routeLine); };
    try {
      new mk.Directions().route({ origin: from, destination: to, transportType: mk.Directions.Transport.Automobile }, (err, data) => {
        if (!alive() || !map) return;
        const r = !err && data && data.routes && data.routes[0];
        if (r && r.polyline) { routeLine = r.polyline; routeLine.style = new mk.Style({ lineWidth: 4, strokeColor: "#22d3ee" }); map.addOverlay(routeLine); }
        else straight();
        map.showItems([routeLine], { animate: true, padding: new mk.Padding(50, 40, 50, 40) });
      });
    } catch { straight(); }
  };
  const statusTint = (c) => !c.clockedIn ? "grey" : c.status === "on_my_way" ? "gold" : c.status === "on_site" ? "emerald" : "cyan";
  const paintList = (d) => {
    const host = pane.querySelector("#lmlist"); if (!host) return;
    const crew = d.crew || [], tz = d.timezone;
    const onClock = crew.filter((c) => c.clockedIn).length;
    const cnt = pane.querySelector("#lmcount"); if (cnt) cnt.textContent = crew.length ? `${onClock} OF ${crew.length} ON THE CLOCK` : "";
    if (!crew.length) { host.innerHTML = '<div class="cghost">No active crew on the roster yet.</div>'; return; }
    host.innerHTML = crew.map((c, i) => {
      const off = c.permission === "denied" || c.permission === "unsupported";
      const live = c.clockedIn && !c.stale && !off && c.lat != null;
      const where = off ? "Location off on their phone" : (!c.clockedIn && c.clockedOutAt && crewClock(c.clockedOutAt, tz) ? `Clocked out at ${crewClock(c.clockedOutAt, tz)} · sharing stopped` : (c.lat == null ? (c.clockedIn ? "No position yet" : "No location yet") : (c.clockedIn ? `Seen ${agoWords(c.ageSeconds)}` : `Clocked out · last seen ${agoWords(c.ageSeconds)}`)));
      const job = c.currentJob ? ` · ${esc(c.currentJob.title || "Job")}${c.currentJob.location ? " — " + esc(c.currentJob.location) : ""}` : "";
      const est = c.clockedIn ? crewEstimateLine(c, tz) : "";
      const texts = crewTextMarks(c.texts, tz);
      const today = c.today && (c.today.seconds > 0 || c.today.jobsTotal > 0) ? `TODAY ${crewHours(c.today.seconds).toUpperCase()}${c.today.jobsTotal ? ` · ${c.today.jobsDone} OF ${c.today.jobsTotal} JOB${c.today.jobsTotal === 1 ? "" : "S"} DONE` : ""}` : "";
      const isOpen = openCard === c.id;
      const canPin = c.lat != null && c.clockedIn && !off, canRoute = canPin && c.currentJob && c.currentJob.lat != null, phone = tel(c.phone);
      const acts = isOpen ? `<div class="cacts">
          ${phone ? `<a class="cact" style="--sig:${CREW_RGB.emerald}" href="tel:${phone}">${ICON_PHONE}<span>CALL</span></a>` : `<span class="cact off">${ICON_PHONE}<span>CALL</span></span>`}
          ${phone ? `<a class="cact" style="--sig:${CREW_RGB.cyan}" href="sms:${phone}">${ICON_TEXT}<span>TEXT</span></a>` : `<span class="cact off">${ICON_TEXT}<span>TEXT</span></span>`}
          <button type="button" class="cact${canRoute ? "" : " off"}" style="--sig:${CREW_RGB.gold}" data-route="${esc(c.id)}" ${canRoute ? "" : "disabled"}>${ICON_ROUTE}<span>ROUTE</span></button>
          <button type="button" class="cact${canPin ? "" : " off"}" style="--sig:${CREW_RGB.purple}" data-center="${esc(c.id)}" ${canPin ? "" : "disabled"}>${ICON_SCOPE}<span>CENTRE</span></button>
        </div>
        <div class="cactfoot">${phone ? "" : '<span class="note">No phone on their roster card</span>'}${canPin ? `<a href="https://maps.apple.com/?ll=${c.lat},${c.lng}&q=${encodeURIComponent(c.name)}" target="_blank" rel="noopener">Open in Apple Maps ↗</a>` : ""}</div>` : "";
      return `<div class="ccrew crise${live ? " live" : c.clockedIn ? " on" : ""}" style="--i:${Math.min(i + 1, 8)};--sig:${crewRgb(live ? "cyan" : c.clockedIn ? "gold" : "grey")}">
        <button type="button" class="ccrewtop" data-crew="${esc(c.id)}">
          ${crewSigil(c.name, c.clockedIn ? c.colorTag : "grey", 42, c.clockedIn ? (off ? "orange" : live ? "emerald" : "amber") : null)}
          <span class="ccbody">
            <span class="ccname"><b>${esc(c.name)}</b><span class="cchip" style="--sig:${crewRgb(statusTint(c))}">${esc(crewStatusWord(c)).toUpperCase()}</span></span>
            <span class="note">${where}${job}</span>
            ${est ? `<span class="ccest">${est}</span>` : ""}
            ${texts ? `<span class="note">${texts}</span>` : ""}
            ${today ? `<span class="ccm">${today}</span>` : ""}
          </span>
          <span class="ccchev${isOpen ? " open" : ""}">⌄</span>
        </button>${acts}</div>`;
    }).join("");
    host.querySelectorAll("[data-crew]").forEach((b) => b.onclick = () => { openCard = openCard === b.dataset.crew ? null : b.dataset.crew; paintList(last || d); });
    host.querySelectorAll("[data-center]").forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); const c = crew.find((x) => x.id === b.dataset.center); if (map && mk && c && c.lat != null) { map.setCenterAnimated(new mk.Coordinate(c.lat, c.lng), true); pane.scrollTo({ top: 0, behavior: "smooth" }); } });
    host.querySelectorAll("[data-route]").forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); const c = crew.find((x) => x.id === b.dataset.route); if (c) { showRoute(c); pane.scrollTo({ top: 0, behavior: "smooth" }); } });
  };
  const pinFactory = (c, tz) => (coord) => {
    const el = document.createElement("div");
    const live = c.clockedIn && c.fresh;
    const tint = c.stale ? "grey" : c.status === "on_my_way" ? "gold" : (c.colorTag || "cyan");
    el.className = "cspin" + (live ? " live" : "") + (c.stale ? " stale" : "");
    el.style.setProperty("--sig", crewRgb(tint));
    const e = c.estimate;
    const tag = e && e.kind === "live" ? `${Math.max(1, Math.round(e.etaSeconds / 60))} min` : e && e.kind === "original" ? `est. ${crewClock(e.etaAt, tz)} · not updating` : agoWords(c.ageSeconds);
    el.innerHTML = `<span class="cspring"></span><span class="csig">${sigilMark(c.name)}<i class="rail"></i></span>${live ? '<i class="ctick emerald"></i>' : ""}<span class="tag">${esc(crewFirst(c.name))} · ${esc(tag)}</span>`;
    return el;
  };
  const jobFactory = () => () => { const el = document.createElement("div"); el.className = "cjpin"; el.innerHTML = `<span>${ICON_WRENCH}</span><i></i>`; return el; };
  const centreOnShop = async () => {
    if (centred || !map || !mk) return;
    centred = true;
    const cached = crewShopCentreCached();
    if (cached) map.region = new mk.CoordinateRegion(new mk.Coordinate(cached.lat, cached.lng), new mk.CoordinateSpan(0.08, 0.08));
    const address = String(S.profile?.business?.address || "").trim();
    if (!address || (cached && cached.address === address)) return;
    try {
      new mk.Geocoder().lookup(address, (err, data) => {
        if (err || !data || !data.results || !data.results[0] || !alive() || !map || map.__fitted) return;
        const c = data.results[0].coordinate;
        crewShopCentreRemember(c.latitude, c.longitude, address);
        map.setRegionAnimated(new mk.CoordinateRegion(c, new mk.CoordinateSpan(0.08, 0.08)), true);
      });
    } catch {}
  };
  const paintMap = async (d) => {
    const el = pane.querySelector("#lmmap"); if (!el) return;
    const note = pane.querySelector("#lmnote");
    const down = !d.mapsConfigured || d.mapsError;
    if (note) { note.textContent = down ? MAP_DOWN : ""; note.hidden = !down; }
    if (mapFailed) return;
    try {
      mk = await ensureMapKit();
      if (!alive()) return;
      if (!map) {
        map = new mk.Map(el, { colorScheme: mk.Map.ColorSchemes.Dark, showsCompass: mk.FeatureVisibility.Hidden, showsMapTypeControl: false, isRotationEnabled: false, showsPointsOfInterest: false });
      }
      const wanted = new Set();
      const items = [];
      for (const c of d.crew || []) {
        // Off the clock is not at work: listed below, never pinned.
        if (c.lat == null || c.permission === "denied" || !c.clockedIn) continue;
        const key = "crew:" + c.id; wanted.add(key);
        let m = marks.get(key);
        if (m) { map.removeAnnotation(m); marks.delete(key); }
        m = new mk.Annotation(new mk.Coordinate(c.lat, c.lng), pinFactory(c, d.timezone), { title: "", anchorOffset: new DOMPoint(0, 0), displayPriority: 1000 });
        marks.set(key, m); map.addAnnotation(m);
        items.push(m);
      }
      for (const j of d.jobs || []) {
        if (j.lat == null || j.status === "done") continue;
        const key = "job:" + j.assignmentId; wanted.add(key);
        const sub = `${j.employeeName ? j.employeeName + " · " : ""}${{ on_my_way: "On my way", on_site: "On site" }[j.status] || "Assigned"}`;
        let m = marks.get(key);
        if (!m) { m = new mk.Annotation(new mk.Coordinate(j.lat, j.lng), jobFactory(), { title: j.title || "Job", subtitle: sub, anchorOffset: new DOMPoint(0, -13), displayPriority: 900 }); marks.set(key, m); map.addAnnotation(m); }
        else { m.subtitle = sub; }
        items.push(m);
      }
      for (const [key, m] of Array.from(marks.entries())) if (!wanted.has(key)) { map.removeAnnotation(m); marks.delete(key); }
      if (items.length && !map.__fitted) {
        map.showItems(items, { animate: false, padding: new mk.Padding(60, 30, 50, 30) }); map.__fitted = true;
        try { const r = map.region; if (r) crewShopCentreRemember(r.center.latitude, r.center.longitude); } catch {}
      }
      if (!items.length && !map.__fitted) await centreOnShop();
    } catch (err) {
      mapFailed = true;
      if (note) { note.textContent = "The map could not load — the crew list below is still live."; note.hidden = false; }
    }
  };
  const paintCounts = (d) => {
    const crew = d.crew || [], jobs = d.jobs || [];
    const on = crew.filter((c) => c.clockedIn).length, sharing = crew.filter((c) => c.clockedIn && !c.stale && c.lat != null).length;
    const open = jobs.filter((j) => j.status !== "done").length, done = jobs.filter((j) => j.status === "done").length;
    const pinned = crew.some((c) => c.clockedIn && c.lat != null && c.permission !== "denied") || jobs.some((j) => j.status !== "done" && j.lat != null);
    const host = pane.querySelector("#lmcounts");
    if (host) host.innerHTML = crewPill(`${on} ON THE CLOCK`, on ? "emerald" : "silver", on > 0) + crewPill(`${sharing} SHARING LIVE`, sharing ? "cyan" : "silver", sharing > 0) + crewPill(done ? `${done}/${open + done} JOBS DONE` : `${open} OPEN JOBS`, (open + done) ? "purple" : "silver");
    const veil = pane.querySelector("#lmveil"), msg = pane.querySelector("#lmmsg"), card = pane.querySelector("#lmcard");
    if (veil) veil.hidden = pinned;
    if (card) card.classList.toggle("quiet", !pinned);
    if (msg) msg.innerHTML = on ? crewPill("ON THE CLOCK · NO POSITION YET", "gold", true) + '<span>Positions arrive from their job link within a minute of clocking in.</span>' : crewPill("SHOP QUIET · NOBODY ON THE CLOCK", "silver") + '<span>Pins appear the moment someone clocks in from their job link.</span>';
  };
  const load = async () => {
    if (!alive()) { stop(); return; }
    try {
      const d = await api("/crew", { action: "locations" }, "POST", { silentUpgrade: true });
      if (!alive()) { stop(); return; }
      last = d;
      paintCounts(d); paintPolicy(d.policy); paintList(d); await paintMap(d);
      const sw = pane.querySelector("#lmsweep"); if (sw) { sw.innerHTML = crewSweep(Date.now()); crewRestartSweep(sw); }
    } catch (err) {
      if (!alive()) { stop(); return; }
      if (err.status === 402 && err.data?.code === "upgrade_required") { stop(); closeSheet(); upgradeHit(err.data); return; }
      const note = pane.querySelector("#lmnote"); if (note) { note.textContent = err.message || "The crew map could not be read. Try again."; note.hidden = false; }
    }
  };
  await load();
  timer = setInterval(load, 30000);
  const obs = new MutationObserver(() => { if (!alive()) { stop(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}
const ICON_PHONE = '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25c1.1.37 2.3.57 3.6.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.6a1 1 0 01-.25 1L6.6 10.8z"/></svg>';
const ICON_TEXT = '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z"/></svg>';
const ICON_ROUTE = '<svg viewBox="0 0 24 24"><path d="M19 15.2V9a4 4 0 00-4-4H8.8l1.6-1.6L9 2 5 6l4 4 1.4-1.4L8.8 7H15a2 2 0 012 2v6.2a3 3 0 102 0zM18 20a1 1 0 110-2 1 1 0 010 2zM6 8.8a3 3 0 100 0z"/><circle cx="6" cy="18" r="3"/></svg>';
const ICON_SCOPE = '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.9 3H19a7 7 0 00-6-6V3.1h-2V5a7 7 0 00-6 6H3.1v2H5a7 7 0 006 6v1.9h2V19a7 7 0 006-6h1.9v-2zM12 17a5 5 0 110-10 5 5 0 010 10z"/></svg>';
const ICON_WRENCH = '<svg viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>';

/** The Crew hub — a dashboard, not a menu (iOS CrewCommandView twin). */
async function crewCommandSheet() {
  const wrap = sheet(`<div class="chead">${crewKicker("CREW COMMAND", "cyan", true)}<h2>Your crew, live</h2><span id="crewpill"></span></div><div id="crewbody" class="note">Loading crew…</div>`);
  const pane = wrap.querySelector(".sheet"); pane.classList.add("crewsheet");
  const box = pane.querySelector("#crewbody");
  const load = async () => {
    box.textContent = "Loading crew…";
    const [from, to] = crewRangeDates("week");
    try {
      const [rec, roster, live, week] = await Promise.all([
        api("/crew", { action: "track-record" }, "POST", { silentUpgrade: true }),
        api("/crew", { action: "list" }).catch(() => ({ employees: [] })),
        api("/crew", { action: "locations" }).catch(() => null),
        api("/crew", { action: "timecards", from, to }).catch(() => null),
      ]);
      if (!Array.isArray(rec.track_record)) throw new Error("Crew records could not be read. Try again.");
      if (!wrap.isConnected) return;
      const record = rec.track_record, crew = (roster.employees || []), liveCrew = (live && live.crew) || [];
      const active = crew.filter((e) => e.active !== false), inactive = crew.filter((e) => e.active === false);
      const onClock = liveCrew.filter((c) => c.clockedIn), sharing = onClock.filter((c) => !c.stale && c.lat != null).length;
      const weekSec = ((week && week.cards) || []).reduce((s, c) => s + (c.total_seconds || 0), 0);
      const jobsMonth = record.reduce((s, r) => s + (r.thisMonth || 0), 0), jobsTotal = record.reduce((s, r) => s + (r.total || 0), 0);
      const leader = record.filter((r) => r.total > 0).sort((a, b) => b.total - a.total)[0];
      const pill = pane.querySelector("#crewpill");
      if (pill) pill.innerHTML = live ? crewPill(onClock.length ? `${onClock.length} ON THE CLOCK` : "SHOP QUIET", onClock.length ? "emerald" : "silver", onClock.length > 0) : "";
      let headline, subline;
      if (!live) { headline = "Where your crew is"; subline = "Positions come from each crew member's job link while clocked in."; }
      else if (!onClock.length) { headline = "Nobody on the clock"; subline = "Shop quiet. Pins appear the moment someone clocks in."; }
      else if (onClock.length === 1) {
        const m = onClock[0], e = m.estimate;
        headline = e && e.kind === "live" ? `${crewFirst(m.name)} · ${Math.max(1, Math.round(e.etaSeconds / 60))} min from the job` : m.status === "on_my_way" ? `${crewFirst(m.name)} is on the way` : m.status === "on_site" ? `${crewFirst(m.name)} is on site` : `${crewFirst(m.name)} is on the clock`;
        subline = sharing ? "Tap for the map, drive times and routes." : "No live position yet — tap for the map.";
      } else { headline = `${onClock.length} on the clock · ${sharing} sharing live`; subline = sharing ? "Tap for the map, drive times and routes." : "No live position yet — tap for the map."; }
      const liveOf = (id) => liveCrew.find((c) => c.id === id);
      const tel = (p) => { const d = String(p || "").replace(/[^\d+]/g, ""); return d.replace(/\D/g, "").length >= 10 ? d : null; };
      const memberCard = (e, i, dim) => {
        const l = liveOf(e.id), on = !!(l && l.clockedIn), share = on && !l.stale && l.lat != null, r = record.find((x) => x.employeeId === e.id);
        return `<button type="button" class="cmember crise${on ? " on" : ""}${dim ? " dim" : ""}" style="--i:${Math.min(5 + i, 9)};--sig:${crewRgb(on ? "emerald" : e.colorTag)}" data-crewid="${esc(e.id)}">
          ${crewSigil(e.name, e.colorTag, 46, on ? (l.permission === "denied" ? "orange" : share ? "emerald" : "amber") : null)}
          <span class="ccbody">
            <span class="ccname"><b>${esc(e.name)}</b>${e.roleTitle ? `<span class="cchip" style="--sig:${crewRgb(e.colorTag)}">${esc(e.roleTitle).toUpperCase()}</span>` : ""}</span>
            <span class="note">${on ? `<span class="ccon"><i class="cld"></i>ON THE CLOCK</span> ` : ""}${esc(e.phone || "no phone")}${e.active === false ? ' · <b style="color:var(--orange)">INACTIVE</b>' : ""}${e.absence ? ' · <b style="color:var(--red)">OFF TODAY</b>' : ""}</span>
            ${e.absence ? `<span class="note" style="color:var(--red)">${esc(absenceLine(e.absence))}</span>` : e.upcomingAbsence ? `<span class="note" style="color:var(--orange)">Off ${esc(absenceDay(e.upcomingAbsence.startOn))}</span>` : ""}
          </span>
          ${r && r.total ? `<span class="ccstats"><b>${r.total} JOB${r.total === 1 ? "" : "S"}</b><span>${r.thisMonth} THIS MONTH</span></span>` : ""}
          ${tel(e.phone) ? `<a class="ccall" href="tel:${tel(e.phone)}" data-stop="1">${ICON_PHONE}</a>` : ""}
          <span class="ccchev right">›</span>
        </button>`;
      };
      box.classList.remove("note");
      box.innerHTML = `
        <div class="cstats crise" style="--i:1">
          ${crewStat(onClock.length, "ON THE CLOCK", "emerald", { live: onClock.length > 0 })}
          ${crewStat(0, "HOURS THIS WEEK", "cyan", { text: crewHours(weekSec) })}
          ${crewStat(jobsMonth, "JOBS THIS MONTH", "purple")}
        </div>
        <button type="button" class="ctile wide crise${onClock.length ? " lit" : ""}" style="--i:2;--sig:${crewRgb(onClock.length ? "cyan" : "silver")}" id="crewmap">
          ${crewRadar(onClock.map((c) => ({ name: c.name, colorTag: c.colorTag, live: !c.stale && c.lat != null })), onClock.length ? "cyan" : "silver", 96)}
          <span class="ctbody">${crewKicker("LIVE MAP", "cyan", onClock.length > 0)}<b>${esc(headline)}</b><span>${esc(subline)}</span></span><span class="ccchev right">›</span>
        </button>
        <div class="ctiles crise" style="--i:3">
          <button type="button" class="ctile${jobsTotal ? " lit" : ""}" style="--sig:${crewRgb(jobsTotal ? "purple" : "silver")}" id="crewtrack">
            ${crewKicker("TRACK RECORD", "purple")}<span class="ctnum"><b data-count="${jobsTotal}">0</b><em>JOBS</em></span>
            <span>${leader ? `${esc(crewFirst(leader.name))} leads · ${leader.total} job${leader.total === 1 ? "" : "s"}` : "No jobs recorded yet"}</span><span class="ccchev">›</span>
          </button>
          <button type="button" class="ctile${weekSec || onClock.length ? " lit" : ""}" style="--sig:${crewRgb(weekSec || onClock.length ? "emerald" : "silver")}" id="crewc">
            ${crewKicker("TIME CARDS", "emerald", onClock.length > 0)}<span class="ctnum"><b>${crewHours(weekSec)}</b></span>
            <span>${weekSec ? (onClock.length ? `this week · ${onClock.length} on the clock now` : "this week · payroll-ready") : (onClock.length ? "First hours of the week landing now" : "No hours this week yet")}</span><span class="ccchev">›</span>
          </button>
        </div>
        <div class="ckrow crise" style="--i:4;margin:16px 0 8px"><span>${crewKicker("ROSTER", "cyan")}<b class="crtitle">Crew Members</b></span><button type="button" class="cadd" id="crewadd">＋ ADD</button></div>
        ${active.length ? active.map((e, i) => memberCard(e, i, false)).join("") : `<button type="button" class="cghost" id="crewadd2">No crew yet — add your field staff, then assign them to jobs from any appointment.</button>`}
        ${active.length ? `<button type="button" class="cghost crise" style="--i:${Math.min(6 + active.length, 9)}" id="crewadd3">${active.length === 1 ? "Add your next crew member" : "Add a crew member"} <b>+</b></button>` : ""}
        ${inactive.length ? `<div class="ckrow" style="margin:14px 0 8px">${crewKicker("INACTIVE", "silver")}</div>${inactive.map((e, i) => memberCard(e, i, true)).join("")}` : ""}
        <button class="btn ghost wide" style="margin-top:14px" id="crewr">Roster &amp; shifts</button>`;
      crewCountUp(box);
      box.querySelector("#crewmap").onclick = () => crewLiveMapSheet();
      box.querySelector("#crewtrack").onclick = () => crewTrackRecordSheet(record);
      box.querySelector("#crewc").onclick = () => crewHoursSheet();
      box.querySelector("#crewr").onclick = () => crewRosterSheet();
      ["#crewadd", "#crewadd2", "#crewadd3"].forEach((id) => { const b = box.querySelector(id); if (b) b.onclick = () => { closeSheet(); crewMemberSheet(null); }; });
      box.querySelectorAll("[data-stop]").forEach((a) => a.onclick = (ev) => ev.stopPropagation());
      box.querySelectorAll("[data-crewid]").forEach((b) => b.onclick = () => { const emp = crew.find((x) => x.id === b.dataset.crewid); if (emp) { closeSheet(); crewMemberSheet(emp); } });
    } catch (err) {
      if (!wrap.isConnected) return;
      if (err.status === 402 && err.data?.code === "upgrade_required") { upgradeHit(err.data); return; }
      box.innerHTML = `<p>${esc(err.message)}</p><button class="btn" id="crewrtry">Retry</button>`;
      box.querySelector("#crewrtry").onclick = load;
    }
  }; await load();
}

function crewTrackRecordSheet(rec, period = "all") {
  const count = (r) => period === "7d" ? (r.last7Days || 0) : period === "month" ? (r.thisMonth || 0) : (r.total || 0);
  const ranked = [...rec].sort((a, b) => count(b) - count(a) || String(a.name).localeCompare(String(b.name)));
  const teamTotal = rec.reduce((s, r) => s + count(r), 0), maxCount = Math.max(...rec.map(count), 1);
  const leader = ranked[0] && count(ranked[0]) > 0 ? ranked[0] : null;
  const words = period === "7d" ? "LAST 7 DAYS" : period === "month" ? "THIS MONTH" : "ALL TIME";
  const share = leader ? Math.max(0, Math.min(1, count(leader) / Math.max(teamTotal, 1))) : 0;
  const wrap = sheet(`<div class="chead">${crewKicker("TRACK RECORD", "purple")}<h2>Jobs per crew member</h2></div>
    <div class="chips crise" style="--i:0">${[["7d", "7 DAYS"], ["month", "THIS MONTH"], ["all", "ALL TIME"]].map(([k, l]) => `<button type="button" class="chip cchipp${k === period ? " on" : ""}" data-period="${k}">${l}</button>`).join("")}</div>
    <div class="chero crise${teamTotal ? " lit" : ""}" style="--i:1;--sig:${crewRgb(teamTotal ? "purple" : "silver")}">
      <div>${crewKicker(`TEAM · ${words}`, "purple", teamTotal > 0)}<span class="ctnum big"><b data-count="${teamTotal}">0</b><em>JOBS</em></span>
        <span class="note">${leader ? `${esc(crewFirst(leader.name))} leads with ${count(leader)}` : "No jobs in this period yet"}</span></div>
      <div class="cring" style="--p:${(share * 100).toFixed(1)}"><span>${ICON_WRENCH}</span></div>
    </div>
    ${rec.length ? ranked.map((r, i) => { const n = count(r), quiet = !n, solo = rec.length === 1; return `
      <div class="crank crise${quiet ? " quiet" : ""}" style="--i:${Math.min(2 + i, 9)};--sig:${crewRgb(quiet ? "silver" : r.colorTag)}">
        <div class="crtop">
          <span class="cplate ${quiet ? "q" : i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : ""}">${quiet ? "—" : "#" + (i + 1)}</span>
          ${crewSigil(r.name, quiet ? "grey" : r.colorTag, 38)}
          <span class="ccbody"><b>${esc(r.name)}</b><span class="ccm">${r.last7Days} LAST 7 DAYS · ${r.thisMonth} THIS MONTH · ${r.total} ALL TIME</span></span>
          <span class="ctnum right"><b data-count="${n}">0</b><em>JOBS</em></span>
        </div>
        ${solo ? "" : `<div class="cbar"><i style="width:${n ? Math.max(3, Math.round(100 * n / maxCount)) : 0}%"></i></div>`}
      </div>`; }).join("") + (rec.length === 1 ? '<p class="note" style="text-align:center;margin-top:4px">Rankings appear once you add crew.</p>' : "")
      : `<div class="cghost">No crew on the roster yet.</div>`}
    <button class="btn ghost wide" style="margin-top:12px" id="trback">&#8592; Back to Crew</button>`, (sh) => {
    sh.classList.add("crewsheet");
    crewCountUp(sh);
    sh.querySelectorAll("[data-period]").forEach((b) => b.onclick = () => { closeSheet(); crewTrackRecordSheet(rec, b.dataset.period); });
    sh.querySelector("#trback").onclick = () => { closeSheet(); crewCommandSheet(); };
  });
}

function crewEmailDispatchSheet(event, employeeId) {
  const intent={employee_id:employeeId,event_id:event.id,details:"",request_ref:crypto.randomUUID()};
  let preview=null,busy=false,started=false;
  const wrap=sheet(`<h2>Email this job</h2><p class="note">Review the recipient and job before sending. Saving an assignment does not send it.</p><label class="fld" for="dispatchnote">Optional note</label><textarea class="cmpinput" id="dispatchnote" maxlength="2000"></textarea><div id="dispatchpreview"></div><div class="note" id="dispatchstatus" role="status"></div><button class="btn em wide" id="dispatchgo">Review email</button>`);
  const q=id=>wrap.querySelector("#"+id), note=q("dispatchnote"),button=q("dispatchgo"),status=q("dispatchstatus");
  note.oninput=()=>{preview=null;button.textContent="Review email";q("dispatchpreview").innerHTML="";};
  button.onclick=async()=>{
    if(busy)return;busy=true;button.disabled=true;status.textContent="";
    try {
      if(!preview){
        intent.details=note.value.trim();const d=await api("/gmail/crew-dispatch-preview",intent);
        if(!wrap.isConnected)return;preview=d.preview;if(!preview?.fingerprint)throw new Error("The email preview could not be loaded. Try again.");
        q("dispatchpreview").innerHTML=`<div class="panel"><b>${esc(preview.employee)}</b><p>${esc(preview.to)}</p><b>${esc(preview.title)}</b><p>${esc(preview.date)} ${esc(preview.time)} · ${esc(preview.timezone)}</p><p>${esc(preview.location || "No location on this job")}</p><p style="white-space:pre-wrap">${esc(preview.details)}</p></div>`;
        button.textContent="Send reviewed email";
      } else {
        started=true;note.disabled=true;button.textContent="Checking this send…";
        const d=await api("/gmail/crew-dispatch",{...intent,review_hash:preview.fingerprint});
        if(!wrap.isConnected)return;const result=d.dispatched;if(!result?.state)throw new Error("The send could not be confirmed.");
        status.textContent=result.message+(result.error ? " "+result.error : "");
        if(result.state==="sent"){button.textContent="Accepted by Gmail";button.dataset.done="true";}
        else button.textContent=result.state==="failed"?"Retry this send":"Check this send again";
      }
    } catch(err) {
      if(!wrap.isConnected)return;status.textContent=err.message;
      if(err.data?.code==="review_changed"){preview=null;started=false;note.disabled=false;button.textContent="Review updated email";}
      else button.textContent=started?"Check this send again":"Retry review";
    } finally {busy=false;button.disabled=button.dataset.done==="true";}
  };
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const evDayKey = (iso) => { const d = new Date(iso && iso.length === 10 ? iso + "T12:00:00" : iso); return isNaN(d) ? "" : dayKey(d); };

async function renderCalendar() {
  skeleton(4);
  try {
    if (!S.cal) S.cal = await get("/google-calendar/events");
    const today = startOfDay(new Date());
    if (!CAL.sel) CAL.sel = dayKey(today);
    if (!CAL.month) CAL.month = { y: today.getFullYear(), m: today.getMonth() };
    drawCalendar();
  } catch (e) {
    view().innerHTML = /not connected|Calendar/i.test(e.message) ? connectPanel("calendar") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(view());
  }
}

function calEvents() {
  const c = S.cal?.calendar || {};
  return [...(c.past || []), ...(c.upcoming || [])];
}

function drawCalendar() {
  const all = calEvents();
  const now = new Date();
  const today = startOfDay(now);
  const todayKey = dayKey(today);

  const countOn = (k) => all.filter((e) => evDayKey(e.start) === k).length;
  const inRange = (iso, from, to) => { const t = new Date(iso); return t >= from && t < to; };
  const weekFrom = new Date(today); weekFrom.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekTo = new Date(weekFrom); weekTo.setDate(weekFrom.getDate() + 7);
  const monthFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthTo = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const todayCount = countOn(todayKey);
  const weekCount = all.filter((e) => inRange(e.start, weekFrom, weekTo)).length;
  const monthCount = all.filter((e) => inRange(e.start, monthFrom, monthTo)).length;

  const upcoming = all.filter((e) => new Date(e.start) > now).sort((a, b) => new Date(a.start) - new Date(b.start));
  const next = upcoming[0];
  const countdown = (iso) => {
    const secs = (new Date(iso) - now) / 1000;
    if (secs < 3600) return `IN ${Math.max(1, Math.round(secs / 60))} MIN`;
    if (secs < 86400) return `IN ${Math.floor(secs / 3600)}H ${Math.round((secs % 3600) / 60)}M`;
    return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase();
  };

  // month grid
  const { y, m } = CAL.month;
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;               // Monday-first, same visual rhythm as iOS
  const dim = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => new Date(y, m, i + 1))];
  const grid = cells.map((d) => {
    if (!d) return `<span class="cd empty"></span>`;
    const k = dayKey(d);
    const n = Math.min(countOn(k), 3);
    const cls = [k === CAL.sel ? "on" : "", k === todayKey ? "now" : "", n ? "e" + n : ""].filter(Boolean).join(" ");
    return `<button class="cd ${cls}" data-day="${k}"><b>${d.getDate()}</b>
      <i>${n ? Array.from({ length: n }, () => "<u></u>").join("") : ""}</i></button>`;
  }).join("");

  const selDate = new Date(CAL.sel + "T12:00:00");
  const selCount = countOn(CAL.sel);
  const relLabel = CAL.sel === todayKey ? "TODAY"
    : CAL.sel === dayKey(new Date(today.getTime() + 86400000)) ? "TOMORROW"
    : CAL.sel === dayKey(new Date(today.getTime() - 86400000)) ? "YESTERDAY"
    : selDate.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase();

  const q = (CAL.q || "").toLowerCase();
  const dayEvents = all
    .filter((e) => evDayKey(e.start) === CAL.sel)
    .filter((e) => !q || ((e.title || "") + " " + (e.description || "") + " " + (e.location || "")).toLowerCase().includes(q))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const nextSelId = CAL.sel === todayKey ? (dayEvents.find((e) => new Date(e.start) > now) || {}).id : null;

  // ---- Command-center intelligence (iOS build 42 parity) ----
  const timed = (e) => (e.start || "").length > 10; // all-day rows carry no clock and stay off the run sheet
  const clock = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const todayTimed = all.filter((e) => evDayKey(e.start) === todayKey && timed(e))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const nextToday = todayTimed.find((e) => new Date(e.start) > now);
  const todayDetail = nextToday ? "next " + clock(new Date(nextToday.start))
    : todayCount > 0 ? "all wrapped" : "wide open";
  const weekEvents = all.filter((e) => inRange(e.start, weekFrom, weekTo));
  let weekDetail = "quiet week";
  if (weekEvents.length) {
    const byDay = {};
    weekEvents.forEach((e) => { const k = evDayKey(e.start); byDay[k] = (byDay[k] || 0) + 1; });
    const busiest = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
    weekDetail = new Date(busiest[0] + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }) + " ×" + busiest[1];
  }
  const monthEvents = all.filter((e) => inRange(e.start, monthFrom, monthTo));
  const bookedDays = new Set(monthEvents.map((e) => evDayKey(e.start))).size;
  const monthDetail = bookedDays ? bookedDays + " booked day" + (bookedDays === 1 ? "" : "s") : "clear board";

  // Run sheet: today's timed jobs, open gaps of an hour or more, and a NOW line.
  const runRows = [];
  if (todayTimed.length) {
    todayTimed.forEach((e) => runRows.push({ at: new Date(e.start), kind: "event", e }));
    for (let i = 0; i < todayTimed.length - 1; i++) {
      const endA = new Date(todayTimed[i].end || todayTimed[i].start);
      const startB = new Date(todayTimed[i + 1].start);
      const mins = (startB - endA) / 60000;
      if (mins >= 60) runRows.push({ at: new Date(endA.getTime() + 1000), kind: "gap",
        label: clock(endA) + " – " + clock(startB), slots: Math.floor(mins / 60) });
    }
    runRows.push({ at: now, kind: "now" });
    runRows.sort((a, b) => a.at - b.at);
  }
  const runSheet = runRows.length ? `<div class="runsheet">
    <div class="rshead">&#128421; TODAY'S RUN SHEET<span id="rscover" class="rscover" hidden></span></div>
    ${runRows.map((r) => {
      if (r.kind === "now") return `<div class="rsnow"><i></i><span>NOW · ${esc(clock(now))}</span><u></u></div>`;
      if (r.kind === "gap") return `<div class="rsgap"><span>&#10022; OPEN · ${esc(r.label)}</span>
        <small>room for ${r.slots} job${r.slots === 1 ? "" : "s"}</small></div>`;
      const past = new Date(r.e.end || r.e.start) < now;
      return `<button class="rsrow${past ? " past" : ""}" data-ev="${esc(r.e.id)}">
        <b>${esc(clock(new Date(r.e.start)))}</b><i class="bar"></i>
        <span>${esc(r.e.title)}</span>${past ? `<em>&#10003;</em>` : ""}</button>`;
    }).join("")}
  </div>` : "";

  // Schedule intelligence: this month's load by weekday.
  let intel = "";
  if (monthEvents.length) {
    const wd = [0, 0, 0, 0, 0, 0, 0];
    monthEvents.forEach((e) => { const d = new Date(evDayKey(e.start) + "T12:00:00"); if (!isNaN(d)) wd[d.getDay()]++; });
    const maxWd = Math.max(1, ...wd);
    const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const fullNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const busiestIdx = wd.indexOf(Math.max(...wd));
    const dim2 = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    intel = `<div class="calintel">
      <div class="cihead">&#129504; SCHEDULE INTELLIGENCE</div>
      ${names.map((n, i) => `<div class="cibar">
        <b>${n}</b><div class="track"><i style="width:${wd[i] ? Math.max(6, Math.round(wd[i] / maxWd * 100)) : 0}%"></i></div>
        <em class="${wd[i] === maxWd && wd[i] > 0 ? "hot" : ""}">${wd[i]}</em></div>`).join("")}
      ${wd[busiestIdx] > 1 ? `<p class="ciline">&#128293; ${fullNames[busiestIdx]}s carry the month — ${wd[busiestIdx]} bookings.</p>` : ""}
      <p class="ciline dim">&#128197; ${bookedDays} of ${dim2} days booked this month — ${dim2 - bookedDays} still open to sell.</p>
    </div>`;
  }

  // Audit 04-06: this calendar draws in the device's clock. When that differs
  // from the business's own zone (which the booking gate, Front Desk and
  // reminders use), say so where the times are read.
  const deviceZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
  const shopZone = S.shop?.timezone || S.businessTimezone || "";
  const zoneNote = shopZone && deviceZone && shopZone !== deviceZone
    ? `<div class="note" style="margin:-4px 0 12px">Times below are shown in this device's zone (${esc(deviceZone.replace(/_/g, " "))}). Your business runs on ${esc(shopZone.replace(/_/g, " "))} — change it under Settings → Your business.</div>` : "";
  view().innerHTML = `<div class="sect">
    ${pageHead("Calendar")}
    ${zoneNote}
    ${S.cal?.calendar?.provider === "ledger" ? `<div class="note" style="margin:-4px 0 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span>Ledger calendar — your appointments live right here in the app.</span><button class="btn ghost" data-connect="/google-calendar/start" style="padding:5px 10px">Connect Google Calendar</button></div>` : ""}
    ${next ? `<button class="nexthero" data-ev="${esc(next.id)}">
      <div class="t"><span class="dot"></span><span class="lbl">NEXT UP</span><span class="go">&#10132;</span></div>
      <div class="big">${esc(countdown(next.start))}</div>
      <b>${esc(next.title)}</b>
      <div class="meta"><span>&#128337; ${esc(timeLabel(next.start))}${next.end && timed(next) ? " – " + esc(timeLabel(next.end)) : ""}</span>
        ${next.location ? `<span>&#128205; ${esc(next.location)}</span>` : ""}</div>
    </button>` : ""}
    <div class="calstats">
      <div class="calstat"><i style="background:var(--cyan);box-shadow:0 0 8px var(--cyan)"></i><b>${todayCount}</b><small>Today</small><em>${esc(todayDetail)}</em></div>
      <div class="calstat"><i style="background:var(--emerald);box-shadow:0 0 8px var(--emerald)"></i><b>${weekCount}</b><small>This week</small><em>${esc(weekDetail)}</em></div>
      <div class="calstat"><i style="background:var(--magenta);box-shadow:0 0 8px var(--magenta)"></i><b>${monthCount}</b><small>This month</small><em>${esc(monthDetail)}</em></div>
    </div>
    ${runSheet}
    ${intel}
    <button class="bookbtn" id="crewbtn">
      <span class="ic">&#128119;</span>
      <span class="m"><b>Crew</b>
        <span>Roster, time cards and who's on what</span></span>
      <span class="go">&#8599;</span></button>
    <div class="bookcal">
      <div class="bchead">
        <div><span class="eyebrow">Booking calendar</span>
          <b>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b></div>
        <div class="nav"><button data-mo="-1">&#8249;</button><button data-mo="0">Today</button><button data-mo="1">&#8250;</button></div>
      </div>
      <div class="cgrid">
        ${["M", "T", "W", "T", "F", "S", "S"].map((d) => `<span class="dow">${d}</span>`).join("")}
        ${grid}
      </div>
      <div class="bcfoot"><span>&#128337; ${selCount} appointment${selCount === 1 ? "" : "s"}</span>
        <span>${selDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span></div>
    </div>
    <button class="bookbtn" id="bookday">
      <span class="ic">&#128197;</span>
      <span class="m"><b>Book ${selDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b>
        <span>Pick a time, add the crew, it lands on the calendar</span></span>
      <span class="go">&#8599;</span></button>
    <button class="bookbtn" id="bizhours">
      <span class="ic">&#128337;</span>
      <span class="m"><b>Business hours</b>
        <span id="bizhoursline">${esc(CAL.hoursLine || "Loading…")}</span></span>
      <span class="go">&#8599;</span></button>
    <div class="searchwrap"><span class="mag">${MAG}</span>
      <input id="calsearch" placeholder="Search selected day" value="${esc(CAL.q)}"></div>
    <div class="dayhead">
      <div><span class="eyebrow">Day schedule</span>
        <b>${selDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</b></div>
      <span class="rel">${esc(relLabel)}</span><span class="cnt">${dayEvents.length}</span>
    </div>
    ${dayEvents.length ? `<div class="list">${dayEvents.map((e) => {
      const past = new Date(e.end || e.start) < now;
      return `<button class="item${past ? " past" : ""}" data-ev="${esc(e.id)}">
        <div class="main"><div class="ttl">${e.id === nextSelId ? '<span class="tag new">NEXT</span> ' : ""}${esc(e.title)} <span class="tag">${e.provider === "google" ? (e.cached ? "Google · cached" : "Google") : "Built-in"}</span></div>
          <div class="sub">${esc(timeLabel(e.start))}${e.location ? " · " + esc(e.location) : ""}</div>
          ${isAuto() && !past ? `<div class="scanlink" data-evscan="${esc(e.id)}">&#128663; Scan vehicle &amp; close job</div>` : ""}</div>
        <div class="amt"><small>${esc((e.status || "").toUpperCase())}</small></div></button>`;
    }).join("")}</div>`
      : `<button class="empty tapable" id="bookempty">This day is open<br>Tap to book it</button>`}
  </div>`;

  const search = $("calsearch");
  wireConnect(view());
  search.addEventListener("input", () => { CAL.q = search.value; const at = search.selectionStart; drawCalendar();
    const n = $("calsearch"); if (n) { n.focus(); n.setSelectionRange(at, at); } });
  on("[data-mo]", "click", (e) => {
    const step = Number(e.currentTarget.dataset.mo);
    if (step === 0) { CAL.month = { y: today.getFullYear(), m: today.getMonth() }; CAL.sel = todayKey; }
    else { const d = new Date(CAL.month.y, CAL.month.m + step, 1); CAL.month = { y: d.getFullYear(), m: d.getMonth() }; CAL.sel = dayKey(d); }
    drawCalendar();
  });
  on("[data-day]", "click", (e) => { CAL.sel = e.currentTarget.dataset.day; drawCalendar(); });
  on("[data-ev]", "click", (e) => eventSheet(all.find((x) => x.id === e.currentTarget.dataset.ev)));
  $("bookday").onclick = () => bookingSheet(CAL.sel);
  $("crewbtn").onclick = () => crewCommandSheet();
  const resourceButton=document.createElement("button");resourceButton.className="btn ghost wide";resourceButton.textContent="Staff & resource availability";resourceButton.onclick=()=>schedulingResourcesSheet();$("bizhours").after(resourceButton);
  $("bizhours").onclick = () => calendarHoursSheet();
  loadCalendarHoursLine();
  loadRunSheetCover(todayTimed);
  on("[data-evscan]", "click", (ev) => {
    ev.stopPropagation();
    const e = calEvents().find((x) => x.id === ev.currentTarget.dataset.evscan);
    if (e) vehicleScanSheet(e, () => {});
  });
  if ($("bookempty")) $("bookempty").onclick = () => bookingSheet(CAL.sel);
}

// Appointment detail — the web twin of iOS CalendarDetailView (edit + delete).
// `back` is optional: set when opened from inside another sheet, so Close isn't
// the only way out.
function eventSheet(e, back) {
  if (!e) return;
  if(e.recovery_id) {
    sheet(`<h2>Awaiting Google confirmation</h2><p>${esc(e.title)}</p><p class="note">This time remains reserved while Google’s response is uncertain. Recovery checks the same booking; it does not create another one.</p><button class="btn primary wide" id="recover-booking">Recover this confirmation</button><p role="status" id="recover-status"></p>`,sh=>{
      sh.querySelector('#recover-booking').onclick=async ev=>{ev.currentTarget.disabled=true;try{await api('/google-calendar/reservation-retry',{reservation_id:e.recovery_id});S.cal=null;closeSheet();toast('Booking confirmation recovered');renderCalendar();}catch(err){sh.querySelector('#recover-status').textContent=err.message;ev.target.disabled=false;}};
    });return;
  }
  sheet(`<h2>${esc(e.title)}</h2>
    <p class="sh-sub">${esc(dayLabel(e.start))} · ${esc(timeLabel(e.start))}${e.end ? " – " + esc(timeLabel(e.end)) : ""}</p>
    <div class="kv"><span>Status</span><span>${esc((e.status || "confirmed").replace(/^./, (c) => c.toUpperCase()))}</span></div>
    ${e.location ? `<div class="kv"><span>Location</span><span>${esc(e.location)}</span></div>` : ""}
    ${e.description ? `<p class="note" style="white-space:pre-wrap;margin-top:11px">${esc(e.description)}</p>` : ""}
    <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Crew</span><span class="note" id="evcrewtag"></span></div>
    <div id="evcrew"><span class="note">Loading…</span></div>
    ${isAuto() ? `<button class="btn primary wide" style="margin-top:14px" id="evscan">&#128663; Scan vehicle &amp; close job</button>
    <p class="note" style="margin-top:6px">Scan the VIN and door placard, type the kilometres, and the completion message is ready to send. Nothing is invoiced.</p>` : `<button class="btn primary wide" style="margin-top:14px" id="evcomplete">Complete job</button>`}
    <div class="rowbtns" style="margin-top:12px">
      <button class="btn ghost" id="evdel">Delete</button>
      <button class="btn ghost" id="evedit" ${e.all_day ? "disabled" : ""}>Edit</button>
    </div>
    ${back ? `<button class="btn ghost wide" style="margin-top:9px" id="evback">&#8592; Back</button>` : ""}
    <div class="note" id="evnote" style="margin-top:9px"></div>`, (sh) => {
    const note = sh.querySelector("#evnote");
    if (back) sh.querySelector("#evback").onclick = () => back();
    const evscan = sh.querySelector("#evscan");
    if (evscan) evscan.onclick = () => vehicleScanSheet(e, () => eventSheet(e, back));
    const complete = sh.querySelector("#evcomplete"); if (complete) complete.onclick = () => completeJobSheet(e, () => eventSheet(e, back));
    loadEventCrew(sh, e);
    sh.querySelector("#evedit").onclick = () => bookingSheet(evDayKey(e.start), e);
    sh.querySelector("#evdel").onclick = async (ev) => {
      if (!(await askConfirm(`"${e.title}" comes off the calendar. This can't be undone.`, { title: "Delete this appointment?", ok: "Delete", danger: true }))) return;
      ev.currentTarget.disabled = true;
      try {
        await api("/google-calendar/event-delete", { event_id: e.id });
        S.cal = null; closeSheet(); toast("Appointment deleted"); renderCalendar();
      } catch (err) { ev.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
    };
  });
}

const BOOK_SOURCES = ["Phone", "Quo / OpenPhone", "Facebook", "Website", "Walk-in", "Kyle internal"];

// New/edit appointment — the web twin of iOS AddBookingView / EditBookingSheet.
function bookingSheet(dayISO, editing, prefill) {
  const now = new Date();
  const localVal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  // Setup and phone entry points do not have a selected calendar day yet.
  const base = editing ? new Date(editing.start) : new Date((dayISO || localVal(now).slice(0, 10)) + "T09:00:00");
  const startAt = !editing && base < now ? new Date(now.getTime() + 3600000) : base;
  const mins = editing && editing.end ? (new Date(editing.end) - new Date(editing.start)) / 60000 : 60;

  sheet(`<h2>${editing ? "Edit Appointment" : "New Appointment"}</h2>
    ${editing ? `<label class="fld">TITLE</label><input id="bkTitle" class="cmpinput" value="${esc(editing.title)}">`
      : `<div class="eyebrow">Customer</div>
    <div class="cmpsect">
      <input id="bkFirst" class="cmpinput" placeholder="First name" aria-label="First name">
      <input id="bkLast" class="cmpinput" placeholder="Last name" aria-label="Last name">
      <input id="bkPhone" class="cmpinput" inputmode="tel" placeholder="Phone" aria-label="Phone" value="${esc((prefill && prefill.phone) || "")}">
      <input id="bkEmail" class="cmpinput" inputmode="email" placeholder="Email" aria-label="Email">
    </div>
    <div class="eyebrow">Appointment</div>
    <div class="cmpsect">
      <input id="bkService" class="cmpinput" placeholder="Service" aria-label="Service">
      <input id="bkVehicle" class="cmpinput" placeholder="${isAuto() ? "Vehicle — year, make, model, trim" : "Job details — what needs doing, where"}" aria-label="${isAuto() ? "Vehicle" : "Job details"}">
      ${isAuto() ? `<input id="bkTire" class="cmpinput" placeholder="Tire size, if relevant" aria-label="Tire size, if relevant">` : ""}
    </div>`}
    <label class="fld">STAFF OR RESOURCE</label><select id="bkResource" class="cmpinput"><option value="">Unassigned · one appointment at a time</option></select>
    ${!editing ? `<label class="fld">SERVICE FROM YOUR MENU</label><select id="bkMenu" class="cmpinput"><option value="">Choose or enter the service above</option></select>` : ""}
    <label class="fld">STARTS</label>
    <input id="bkStart" class="cmpinput" type="datetime-local" value="${localVal(startAt)}">
    <label class="fld">DURATION</label>
    <select id="bkDur" class="cmpinput">${[...new Set([30, 45, 60, 90, 120, mins])].filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b).map((n) =>
      `<option value="${n}" ${n === mins ? "selected" : ""}>${n < 60 ? n + " minutes" : n === 60 ? "1 hour" : (n / 60) + " hours"}</option>`).join("")}</select>
    ${editing ? `<label class="fld">LOCATION</label><input id="bkLoc" class="cmpinput" value="${esc(editing.location || "")}">
      <label class="fld">DETAILS</label><textarea id="bkNotes" class="cmpinput" rows="4">${esc(editing.description || "")}</textarea>`
      : `<div class="eyebrow" style="margin-top:13px">Crew dispatch</div>
    <div class="cmpsect"><div class="chips" id="bkCrew" style="display:flex;flex-wrap:wrap;gap:8px"><span class="note">Loading crew…</span></div></div>
    <div class="eyebrow" style="margin-top:13px">Pricing — invoice-ready</div>
    <div class="cmpsect">
      <div id="bkLines"></div>
      <button type="button" class="btn ghost wide" id="bkAddLine" style="margin-top:4px">+ Add a line</button>
      <div class="note" id="bkTotals" style="margin-top:6px"></div>
      <datalist id="bkItems"></datalist>
    </div>
    <div class="eyebrow" style="margin-top:13px">Source &amp; job notes</div>
    <div class="cmpsect">
      <select id="bkSource" class="cmpinput">${BOOK_SOURCES.map((x) => `<option>${x}</option>`).join("")}</select>
      <textarea id="bkNotes" class="cmpinput" rows="3" placeholder="Order status and job notes — pricing goes in the lines above" aria-label="Job notes"></textarea>
    </div>`}
    <button class="btn primary wide" style="margin-top:13px" id="bkGo">${editing ? "Save changes" : "Create Appointment"}</button>
    <p class="note" style="margin-top:9px">The calendar is checked live for conflicts before anything is created.</p>
    <div class="note" id="bkNote" style="margin-top:6px"></div>`, (sh) => {
    const note = sh.querySelector("#bkNote");
    api("/google-calendar/resources",{}).then(r=>{const picker=sh.querySelector("#bkResource");if(!picker)return;picker.innerHTML='<option value="">Unassigned · one appointment at a time</option>'+(r.resources||[]).filter(x=>x.active).map(x=>`<option value="${esc(x.id)}"${editing?.resource_id===x.id?' selected':''}>${esc(x.name)}</option>`).join('');
      picker.dataset.loaded="1"; if(sh._bkResource&&[...picker.options].some(o=>o.value===sh._bkResource))picker.value=sh._bkResource;}).catch(e=>{note.textContent=e.message});

    const val = (id) => (sh.querySelector("#" + id)?.value || "").trim();
    // Pricing lines (four-point minimum, Kyle 2026-09-13): every booking is
    // invoice-ready, so the form takes the priced lines and the server writes
    // the PRICING block and does the maths. Items come from the business's own
    // price list (QuickBooks items or the built-in item list).
    const priceItems = new Map();
    const linesBox = sh.querySelector("#bkLines");
    const totalsBox = sh.querySelector("#bkTotals");
    const readLines = () => [...(linesBox ? linesBox.querySelectorAll(".bkline") : [])].map((row) => ({
      name: row.querySelector('[data-f="name"]').value.trim(),
      qty: Number(row.querySelector('[data-f="qty"]').value || 1),
      unit_price: row.querySelector('[data-f="price"]').value === "" ? null : Number(row.querySelector('[data-f="price"]').value),
    })).filter((l) => l.name || l.unit_price !== null);
    const showTotals = () => {
      if (!totalsBox) return;
      const ls = readLines().filter((l) => l.unit_price !== null);
      const sub = ls.reduce((s, l) => s + (l.qty > 0 ? l.qty : 0) * l.unit_price, 0);
      totalsBox.textContent = ls.length ? `Subtotal ${money(sub)} · tax and the total are added when you save` : "Add every charge: the service, levies or fees, supplies. Tax is added on save.";
    };
    const addLine = (pre) => {
      if (!linesBox) return;
      const row = document.createElement("div"); row.className = "bkline";
      row.style.cssText = "display:grid;grid-template-columns:1fr 58px 90px 30px;gap:6px;margin-bottom:6px";
      row.innerHTML = `<input class="cmpinput" list="bkItems" placeholder="Item from your price list" aria-label="Item from your price list" data-f="name" value="${esc((pre && pre.name) || "")}">
        <input class="cmpinput" type="number" step="1" min="0.01" data-f="qty" value="${esc(String((pre && pre.qty) || 1))}" title="Quantity" aria-label="Quantity">
        <input class="cmpinput" type="number" step="0.01" min="0" placeholder="$ each" aria-label="Price each" data-f="price" value="${pre && pre.unit_price != null ? esc(String(pre.unit_price)) : ""}">
        <button type="button" class="btn ghost" data-rm title="Remove line" aria-label="Remove line">×</button>`;
      row.querySelector("[data-rm]").onclick = () => { row.remove(); showTotals(); persist(); };
      row.querySelector('[data-f="name"]').addEventListener("change", (e) => {
        const hit = priceItems.get(e.target.value.trim().toLowerCase());
        const priceEl = row.querySelector('[data-f="price"]');
        if (hit !== undefined && priceEl.value === "") priceEl.value = hit;
        showTotals();
      });
      row.querySelectorAll("input").forEach((i) => i.addEventListener("input", showTotals));
      linesBox.appendChild(row);
    };
    if (sh.querySelector("#bkMenu")) booksApi({action:"shortcuts"}).then(r=>{
      const services=(r.shortcuts||[]).filter(s=>s.bookable!==false && s.duration_minutes != null),picker=sh.querySelector("#bkMenu");if(!picker)return;
      picker.innerHTML='<option value="">Choose or enter the service above</option>'+services.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · ${money(s.rate)} · ${s.duration_minutes} min</option>`).join('');
      picker.onchange=()=>{const svc=services.find(s=>s.id===picker.value);if(!svc)return;sh.querySelector("#bkService").value=svc.name;const d=sh.querySelector("#bkDur");if(![...d.options].some(o=>Number(o.value)===svc.duration_minutes))d.add(new Option(`${svc.duration_minutes} minutes`,String(svc.duration_minutes)));d.value=String(svc.duration_minutes);linesBox.innerHTML='';addLine({name:svc.name,qty:1,unit_price:svc.rate});showTotals()};
    }).catch(e=>{note.textContent=e.message});
    if (linesBox) {
      addLine(); showTotals();
      sh.querySelector("#bkAddLine").onclick = () => addLine();
      (async () => {
        try {
          let items = [];
          const r = await api("/quickbooks-invoice/items", null, "GET", { silentUpgrade: true });
          if (r.native_books) { const s = await booksApi({ action: "shortcuts" }); items = (s.shortcuts || []).map((x) => ({ name: x.name, price: x.rate })); }
          else items = (r.items || []).map((x) => ({ name: x.name, price: x.unit_price, description: x.description }));
          const dl = sh.querySelector("#bkItems");
          if (!dl || !sh.contains(dl)) return;
          dl.innerHTML = items.map((x) => `<option value="${esc(x.name)}">${esc(x.description ? `${x.description} — ` : "")}${money(Number(x.price || 0))}</option>`).join("");
          items.forEach((x) => priceItems.set(String(x.name).toLowerCase(), Number(x.price || 0)));
        } catch { /* no price list yet — lines are still typed by hand */ }
      })();
    }
    // Crew dispatch (web parity, Kyle 2026-09-06): the roster as tap-chips,
    // each picked name is put on the new job the moment it exists.
    const picked = new Set();
    const crewBox = sh.querySelector("#bkCrew");
    if (crewBox) api("/crew", { action: "list" }, "POST", { silentUpgrade: true }).then((r) => {
      if (!sh.contains(crewBox)) return;
      const crew = (r.employees || []).filter((x) => x.active !== false);
      // A restored draft may already name crew; anyone no longer on the roster drops off.
      for (const id of [...picked]) if (!crew.some((x) => x.id === id)) picked.delete(id);
      crewBox.innerHTML = crew.length
        ? crew.map((x) => `<button type="button" class="chip${picked.has(x.id) ? " on" : ""}" data-bkcrew="${esc(x.id)}" aria-pressed="${picked.has(x.id) ? "true" : "false"}">${esc(x.name)}</button>`).join("")
        : `<span class="note">No crew on the roster yet — add crew members from the Crew card on the Calendar tab.</span>`;
      crewBox.querySelectorAll("[data-bkcrew]").forEach((b) => b.onclick = () => {
        const id = b.dataset.bkcrew;
        if (picked.has(id)) { picked.delete(id); b.classList.remove("on"); } else { picked.add(id); b.classList.add("on"); }
        b.setAttribute("aria-pressed", picked.has(id) ? "true" : "false");
        persist();
      });
    }).catch(() => { if (crewBox) crewBox.innerHTML = ""; });
    // Audit 04-05: each 409 the server sends (`outside_hours`, `slot_conflict`)
    // names an explicit override; both are offered here, when creating AND when
    // editing, instead of a dead-end "resend with force" sentence. A second
    // refusal after forcing is shown as is — force is the last word.
    const overrideLabel = (e) => e.data?.error === "outside_hours" ? "Book outside hours anyway" : e.data?.error === "slot_conflict" ? "Double-book this time anyway" : null;
    const offerOverride = (e, resend) => {
      const label = overrideLabel(e); if (!label) return false;
      const suggested = e.data?.suggested_start ? `<br>Next opening after that: ${esc(dayLabel(e.data.suggested_start))} · ${esc(timeLabel(e.data.suggested_start))}` : "";
      note.className = "note err";
      note.innerHTML = `${esc(e.message)}${suggested}<br><button class="btn ghost wide" style="margin-top:9px" id="bkForce">&#10003;&nbsp; ${label}</button>`;
      note.querySelector("#bkForce").onclick = async (ev2) => {
        ev2.currentTarget.disabled = true;
        try { await resend(); } catch (err) { ev2.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
      };
      return true;
    };
    // Draft retention (audit 11.2b). A new appointment being typed is kept in
    // account-scoped storage as it changes and restored the next time this
    // sheet opens; the entry is cleared once the booking exists or the owner
    // chooses Discard. Editing an existing appointment has the calendar as its
    // source of truth and is never stored.
    const BK_KEY = "ledger.draft.booking";
    const BK_FIELDS = ["bkFirst", "bkLast", "bkPhone", "bkEmail", "bkService", "bkVehicle", "bkTire", "bkStart", "bkDur", "bkSource", "bkNotes", "bkResource"];
    const snapshot = () => ({ v: 1, savedAt: Date.now(), fields: Object.fromEntries(BK_FIELDS.map((id) => [id, val(id)])), lines: readLines(), crew: [...picked] });
    const typed = (s) => ({ fields: Object.fromEntries(Object.entries(s.fields).filter(([id]) => !["bkStart", "bkDur", "bkSource", "bkResource"].includes(id))), lines: s.lines, crew: s.crew });
    const baseline = JSON.stringify(typed(snapshot()));
    const dirty = () => !editing && JSON.stringify(typed(snapshot())) !== baseline;
    const persist = () => {
      if (editing) return;
      try { if (dirty()) accountStorage.setItem(BK_KEY, JSON.stringify(snapshot())); else accountStorage.removeItem(BK_KEY); } catch {}
    };
    const wrapEl = sh.closest("#sheetwrap");
    if (wrapEl && !editing) {
      wrapEl._isDirty = dirty;
      wrapEl._discard = () => { try { accountStorage.removeItem(BK_KEY); } catch {} };
      sh.addEventListener("input", persist);
      sh.addEventListener("change", persist);
      let saved = null;
      try { saved = JSON.parse(accountStorage.getItem(BK_KEY) || "null"); } catch {}
      if (saved && saved.v === 1 && saved.fields) {
        for (const [id, v] of Object.entries(saved.fields)) {
          const el = sh.querySelector("#" + id);
          if (!el || typeof v !== "string" || v === "" || id === "bkResource") continue;
          if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === v)) continue;
          if (id === "bkStart" && !(new Date(v).getTime() > Date.now())) continue;   // a start that has passed keeps the fresh default
          el.value = v;
        }
        if (Array.isArray(saved.lines) && saved.lines.length && linesBox) { linesBox.innerHTML = ""; saved.lines.forEach(addLine); showTotals(); }
        (Array.isArray(saved.crew) ? saved.crew : []).forEach((id) => { if (typeof id === "string") picked.add(id); });
        if (saved.fields.bkResource) sh._bkResource = saved.fields.bkResource;
        toast("Restored your unsaved appointment draft.");
      }
    }
    sh.querySelector("#bkGo").onclick = async (ev) => {
      // currentTarget is gone once the handler awaits; hold the button itself.
      const goBtn = ev.currentTarget;
      const startVal = val("bkStart");
      if (!startVal) { note.className = "note err"; note.textContent = "Pick a start time."; return; }
      const start = new Date(startVal);
      const end = new Date(start.getTime() + Number(val("bkDur") || 60) * 60000);
      try {
        if (editing) {
          goBtn.disabled = true;
          // Audit 04-01 / 04-02: only what changed is sent. Time travels only when
          // the start or duration moved; the resource only when the roster loaded
          // and the pick differs from the appointment's current one.
          const picker = sh.querySelector("#bkResource");
          const resourceNow = picker?.dataset.loaded === "1" ? (picker.value || null) : undefined;
          const timeChanged = startVal !== localVal(startAt) || Number(val("bkDur")) !== mins;
          const patch = {
            event_id: editing.id, title: val("bkTitle"),
            ...(timeChanged ? {start:start.toISOString(),end:end.toISOString()} : {}),
            ...(resourceNow !== undefined && resourceNow !== (editing.resource_id || null) ? { resource_id: resourceNow } : {}),
            location: val("bkLoc"), description: val("bkNotes"),
          };
          const saveEdit = async (force) => {
            await api("/google-calendar/event-update", force ? { ...patch, force: true } : patch);
            S.cal = null; closeSheet(); toast("Appointment updated"); renderCalendar();
          };
          try { await saveEdit(false); }
          catch (e) { goBtn.disabled = false; if (!offerOverride(e, () => saveEdit(true))) throw e; }
          return;
        }
        const required = ["bkFirst", "bkLast", "bkPhone", "bkEmail", "bkVehicle", "bkService"];
        if (required.some((id) => !val(id))) { note.className = "note err"; note.textContent = `Fill in name, phone, email, ${isAuto() ? "vehicle" : "job details"} and service.`; return; }
        const lines = readLines();
        if (!lines.length || lines.some((l) => !l.name || l.unit_price === null || !(l.qty > 0))) {
          note.className = "note err"; note.textContent = "Every booking is invoice-ready: add at least one priced line, each with an item, a quantity and a price."; return;
        }
        // In-page question (audit 11.3): a native confirm() answers "no"
        // silently inside a WKWebView with no UI delegate, and this is the only
        // path that creates a booking.
        if (!(await askConfirm(`${val("bkService")} for ${val("bkFirst")} ${val("bkLast")}\n${start.toLocaleString()}`, { title: "Create this booking?", ok: "Create booking" }))) return;
        goBtn.disabled = true;
        const title = `${val("bkFirst")} ${val("bkLast")} — ${val("bkService")}`;
        // The server composes the CUSTOMER / VEHICLE (or JOB DETAILS) / SERVICE /
        // PRICING blocks from these fields and refuses anything incomplete.
        const booking = {
          customer: { first_name: val("bkFirst"), last_name: val("bkLast"), phone: val("bkPhone"), email: val("bkEmail"), source: val("bkSource") },
          vehicle: isAuto() ? val("bkVehicle") : "", tire_size: val("bkTire"), job_details: isAuto() ? "" : val("bkVehicle"),
          service: { summary: val("bkService") }, pricing: { lines }, notes: val("bkNotes"),
        };
        const payload = { title, booking, email: val("bkEmail"), start: start.toISOString(), end: end.toISOString(),resource_id:val("bkResource") || null,service_ids:val("bkMenu") ? [val("bkMenu")] : [] };
        const finish = async (created) => {
          const eventId = created?.event?.id;
          const details = created?.event?.description || "";
          for (const employeeId of picked) {
            if (!eventId) break;
            try {
              await api("/crew", { action: "assign", employee_id: employeeId, event_id: eventId, job_date: localDay(start),
                job_title: payload.title, job_start: payload.start, job_location: "", job_details: details });
            } catch (err) { toast(`Couldn't put crew on the job: ${err.message}`, "err"); }
          }
          if (wrapEl) { wrapEl._isDirty = null; wrapEl._discard?.(); }
          S.cal = null; closeSheet(); renderCalendar();
          // Audit 04-09: an identical request replays the existing appointment
          // rather than creating a second one — say so instead of "booked".
          if (created?.replayed || created?.event?.replayed) toast("This exact appointment already exists — nothing new was created. Change the time or details to book another.", "err");
          else toast("Appointment booked");
        };
        try {
          await finish(await api("/google-calendar/bookings", payload));
        } catch (e) {
          goBtn.disabled = false;
          if (!offerOverride(e, async () => finish(await api("/google-calendar/bookings", { ...payload, force: true })))) throw e;
        }
      } catch (e) { goBtn.disabled = false; note.className = "note err"; note.textContent = e.message; }
    };
  });
}

/* ---------------- RECEIPTS ---------------- */
const CATEGORIES = {
  "Vehicle & Travel": ["Fuel", "Vehicle Repair", "Parking", "Tolls & Transit", "Travel & Lodging", "Meals"],
  "Inventory & Shop": ["Tires & Inventory", "Parts & Materials", "Tools & Equipment", "Shop Supplies", "Equipment Repair", "Freight & Courier"],
  "Property & Operations": ["Rent & Lease", "Utilities", "Phone & Internet", "Insurance", "Cleaning & Waste", "Security"],
  "Admin & Growth": ["Advertising", "Software & Subscriptions", "Office Supplies", "Professional Fees", "Bank & Processing Fees", "Licences & Permits", "Training & Education", "Other Business Cost"],
};

async function loadReceipts() {
  const slot = $("finbody"); if (!slot) return;
  try {
    if(S.booksProvider===undefined) S.booksProvider=(await booksApi({action:"settings"})).provider;
    const native=S.booksProvider==="native", gmailReady=S.connMap?.gmail !== false;
    const d = await get("/gmail/receipts");
    S.receipts = d.receipts || [];
    const ready = S.receipts.filter((r) => !r.qbo_purchase_id && r.category && r.category !== "Personal" && r.total);
    const queueTotal = ready.reduce((t, r) => t + (Number(r.total) || 0), 0);
    const rq = (S.receiptSearch || "").toLowerCase();
    const shown = !rq ? S.receipts : S.receipts.filter((r) =>
      ((r.vendor || "") + " " + (r.category || "") + " " + (r.received_at || "") + " " + (r.subject || "") + " " + (r.summary || ""))
        .toLowerCase().includes(rq));
    // Same intake math as iOS ReceiptIntakeSummary: unposted excludes Personal
    // but includes uncategorised rows — that pile is the money not yet in the books.
    const unposted = S.receipts.filter((r) => !r.qbo_purchase_id && r.category !== "Personal");
    const unpostedValue = unposted.reduce((t, r) => t + (Number(r.total) || 0), 0);
    slot.innerHTML = `
      <div class="fintiles" style="grid-template-columns:1fr 1fr 1.35fr">
        <div class="fintile"><span class="tic" style="background:rgba(58,200,245,.15);color:var(--cyan)">&#128246;</span><small>ON RADAR</small><b>${S.receipts.length}</b><i>shot + emailed</i></div>
        <div class="fintile em"><span class="tic" style="background:rgba(47,224,160,.15);color:var(--emerald)">&#10004;</span><small>READY</small><b>${ready.length}</b><i>priced &amp; filed</i></div>
        <div class="fintile warn"><span class="tic" style="background:rgba(251,146,60,.15);color:var(--orange)">&#8987;</span><small>${native ? "FILED RECEIPTS" : "UNPOSTED"}</small><b>${money(native ? queueTotal : unpostedValue)}</b><i>${native ? "receipt value · not profit" : unposted.length + " waiting"}</i></div>
      </div>
      <div class="lanehead"><span class="eyebrow">Intake</span><span class="note">camera · library</span></div>
      <div class="panel">
        <h3>&#9635; Capture a receipt</h3>
        <p class="sub">${native ? "Shoot it and Ledger reads the vendor, total and tax, then saves the receipt to your records." : "Shoot it and Ledger reads the vendor, total and tax, then files it for QuickBooks."}</p>
        <div class="rowbtns" style="margin-top:12px">
          <button class="cta" id="rcptshoot" style="flex:1;margin:0">
            <span class="ic">&#128247;</span>
            <span><b>Photograph</b><span>Reads it for you</span></span>
          </button>
          <button class="btn ghost" id="rcptpick" style="flex:0 0 auto;display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;min-width:78px">&#128444;<small style="font-size:10px;font-weight:800;letter-spacing:.6px">LIBRARY</small></button>
        </div>
        <label class="preclass" style="margin-top:12px;display:flex;align-items:center;gap:9px;padding:11px 13px;border-radius:13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09)">
          <span style="color:var(--gold)">&#127991;</span>
          <span style="font-size:10px;font-weight:800;letter-spacing:1.3px;color:var(--dim)">CATEGORY</span>
          <select id="preclassify" style="margin-left:auto;background:none;border:0;color:var(--gold);font-weight:700;font-family:inherit;text-align:right">
            <option value="">Let Ledger read it</option>
            ${Object.entries(CATEGORIES).map(([g, cats]) => `<optgroup label="${esc(g)}">${cats.map((c) =>
              `<option value="${esc(c)}" ${S.preClassify === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</optgroup>`).join("")}
          </select>
        </label>
      ${native ? `<p class="note">Categorize and check each receipt here. Materials count against a job when their use is recorded in Job costs.</p>` : `<button class="queue" id="batchqueue">
        <div class="ic">&#128229;</div>
        <div class="m"><small>QuickBooks batch queue</small>
          <b>${ready.length} queued · ${money(queueTotal)}</b>
          <span>Categorised receipts waiting to post as expenses.</span></div>
        <div class="chev">&#8250;</div>
      </button>`}
        <input type="file" id="rcptcam" accept="image/*" capture="environment" hidden>
        <input type="file" id="rcptlib" accept="image/*" hidden>
        <p class="note" id="rcptcamnote" style="margin-top:8px"></p>
      </div>
      <div class="lanehead"><span class="eyebrow" style="color:var(--red)">Cost ledger</span><span class="note">${S.receipts.length === 1 ? "1 record" : S.receipts.length + " records"}</span></div>
      <div class="panel" style="border-color:rgba(248,113,113,.35);box-shadow:0 0 18px rgba(248,113,113,.08)">
        <h3 style="color:var(--red)">&#128231; Receipt Radar</h3>
        <p class="sub">${gmailReady ? `Ledger scans your inbox daily at ${hourLabel(d.scan_hour ?? 18)} for receipts and supplier invoices. Photos land here too.` : "Photographed receipts land here. Connect Gmail to include emailed receipts and supplier invoices."}</p>
        <div class="rowbtns" style="margin-top:12px;align-items:center">
          ${gmailReady ? `<select id="scanhour" class="hourpick" title="Daily scan time">
            ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === (d.scan_hour ?? 18) ? "selected" : ""}>Daily at ${hourLabel(h)}</option>`).join("")}
          </select>
          <button class="btn em" id="scannow" style="background:linear-gradient(140deg,rgba(248,113,113,.85),rgba(251,146,60,.85));color:#fff;border:0">&#8635; Scan now</button>` : `<button class="btn primary" data-connect="/gmail/start">Connect Gmail</button>`}
          ${!native && ready.length >= 2 ? `<button class="btn em" id="batch">Post all ready (${ready.length})</button>` : ""}
        </div>
        <p class="note" style="margin-top:8px">${d.last_scan_at ? "Last scan " + esc(new Date(d.last_scan_at).toLocaleString()) : "Not scanned yet"}</p>
      </div>
      <div class="lanehead"><span class="eyebrow">Logged receipts</span>
        <span class="note">${S.receipts.length} saved</span></div>
      <div class="searchwrap"><span class="mag">${MAG}</span>
        <input id="rcptsearch" placeholder="Search vendor, category, date or notes" value="${esc(S.receiptSearch || "")}"></div>
      ${shown.length ? `<div class="list">${shown.map((r) => `
        <button class="item" data-rcpt="${esc(r.id)}">
          <div class="main">
            <div class="ttl">${esc(r.vendor || r.from_name || "Unknown vendor")}</div>
            <div class="sub">${esc(r.subject || "")}</div>
          </div>
          <div class="amt">${r.total ? money(r.total) : "—"}
            <small>${r.image_path ? '<span class="tag grey">Photo</span> ' : ""}${r.qbo_purchase_id ? '<span class="tag paid">In QuickBooks</span>'
              : r.category === "Personal" ? '<span class="tag grey">Personal</span>'
              : !r.total ? '<span class="tag open">Add amount</span>'
              : r.category ? (S.booksProvider === "native" ? '<span class="tag new">Filed</span>' : '<span class="tag new">Post to QuickBooks</span>')
              : '<span class="tag open">Needs category</span>'}</small></div>
        </button>`).join("")}</div>`
        : `<div class="empty">${rq ? "No receipts match that search." : "No receipts found yet.<br>Run a scan, or forward one to your inbox."}</div>`}`;
    $("rcptshoot").onclick = () => $("rcptcam").click();
    $("rcptpick").onclick = () => $("rcptlib").click();
    // Pre-classify is a hint, same as iOS: Ledger's own read of the photo wins;
    // this fills the category only when the read comes back without one.
    $("preclassify").onchange = (e) => { S.preClassify = e.target.value || null; };
    $("rcptcam").onchange = (e) => captureReceipt(e.target.files?.[0]);
    $("rcptlib").onchange = (e) => captureReceipt(e.target.files?.[0]);
    wireConnect(slot);
    if ($("scannow")) $("scannow").onclick = async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = "Scanning…";
      try { await api("/gmail/scan", {}); toast("Scan complete"); loadReceipts(); }
      catch (err) { toast(friendlyError(err, "Couldn't scan your inbox for receipts. Try again."), "err"); loadReceipts(); }
    };
    if ($("batch")) $("batch").onclick = () => batchPost(ready);
    if ($("batchqueue")) $("batchqueue").onclick = () => batchQueueSheet(ready, queueTotal);
    if ($("scanhour")) $("scanhour").onchange = async (e) => {
      const hour = Number(e.target.value);
      try { await api("/gmail/set-schedule", { hour }); toast("Daily scan set to " + hourLabel(hour)); }
      catch (err) { toast(friendlyError(err, "Couldn't save your receipt schedule. Try again."), "err"); loadReceipts(); }
    };
    const rs = $("rcptsearch");
    rs.addEventListener("input", () => {
      S.receiptSearch = rs.value.trim();
      clearTimeout(S._rt); S._rt = setTimeout(() => {
        loadReceipts().then(() => { const n = $("rcptsearch"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
      }, 220);
    });
    on("[data-rcpt]", "click", (e) => receiptSheet(S.receipts.find((r) => r.id === e.currentTarget.dataset.rcpt)), slot);
  } catch (e) {
    slot.innerHTML = /not connected|Gmail/i.test(e.message) ? connectPanel("gmail") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(slot);
  }
}

const hourLabel = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? " AM" : " PM");

// iOS ReceiptExpenseCatalog.suggestedAccount — same mapping, so both apps name the account identically.
function suggestedAccount(category) {
  if (["Fuel", "Vehicle Repair", "Parking", "Tolls & Transit"].includes(category)) return "Vehicle expenses";
  if (["Tires & Inventory", "Parts & Materials", "Shop Supplies", "Freight & Courier"].includes(category)) return "Cost of goods sold";
  if (["Tools & Equipment", "Equipment Repair"].includes(category)) return "Tools & equipment";
  if (category === "Advertising") return "Advertising & promotion";
  if (["Software & Subscriptions", "Phone & Internet"].includes(category)) return "Software / communications";
  if (["Rent & Lease", "Utilities", "Insurance", "Cleaning & Waste", "Security"].includes(category)) return "Occupancy & operations";
  if (["Professional Fees", "Bank & Processing Fees", "Office Supplies", "Licences & Permits", "Training & Education"].includes(category)) return "General & administrative";
  return "Needs accountant mapping";
}

// QuickBooks batch queue — the web twin of iOS ReceiptBatchQueueView.
function batchQueueSheet(ready, total) {
  sheet(`<h2>QuickBooks Batch Queue</h2>
    <p class="sh-sub">${ready.length} categorised receipt${ready.length === 1 ? "" : "s"} · ${money(total)}</p>
    ${ready.length ? `<div class="list">${ready.map((r) => `
      <button class="item" data-bq="${esc(r.id)}">
        <div class="main"><div class="ttl">${esc(r.vendor || r.from_name || "Unknown vendor")}</div>
          <div class="sub">${esc(r.category)} · ${esc(suggestedAccount(r.category))}</div></div>
        <div class="amt">${money(r.total)}<small><span class="tag new">ready</span></small></div>
      </button>`).join("")}</div>
      <button class="btn em wide" style="margin-top:13px" id="bqpost">Post all ready (${ready.length})</button>`
      : `<div class="empty">Nothing queued.<br>Categorise a receipt and set its amount to queue it.</div>`}`, (sh) => {
    on("[data-bq]", "click", (e) => {
      const r = ready.find((x) => x.id === e.currentTarget.dataset.bq);
      closeSheet(); receiptSheet(r);
    }, sh);
    const post = sh.querySelector("#bqpost");
    if (post) post.onclick = () => { closeSheet(); batchPost(ready); };
  });
}

// Same vendor, same total, same day as another receipt already on file — the
// one shape of duplicate a photo or a forwarded email both produce.
function duplicateOf(r) {
  const vendor = (r.vendor || r.from_name || "").trim().toLowerCase();
  const day = (r.received_at || "").slice(0, 10);
  if (!vendor || !r.total || !day) return null;
  return (S.receipts || []).find((o) => o.id !== r.id
    && (o.vendor || o.from_name || "").trim().toLowerCase() === vendor
    && Number(o.total) === Number(r.total)
    && (o.received_at || "").slice(0, 10) === day) || null;
}

async function batchPost(ready) {
  const b = $("batch"); b.disabled = true; b.textContent = "Posting…";
  let posted = 0, skipped = 0, duped = 0;
  for (const r of ready) {
    if (duplicateOf(r)) { duped++; continue; } // held for a manual look, not silently posted twice
    try {
      const v = await api("/quickbooks-invoice/expense-vendors", { receipt_id: r.id });
      if (!v.suggestedId) { skipped++; continue; }
      await api("/quickbooks-invoice/expense-post", { receipt_id: r.id, vendor_id: v.suggestedId });
      posted++;
    } catch { skipped++; }
  }
  toast(`${posted} posted${duped ? ", " + duped + " possible duplicate" + (duped === 1 ? "" : "s") + " held for review" : ""}${skipped ? ", " + skipped + " left for you" : ""}`);
  loadReceipts();
}

// Camera lane. The phone shoots 4000px JPEGs; a receipt only needs enough
// resolution to read the totals, and the edge function has to carry the image
// as base64 — so downscale here rather than push megabytes over the wire.
const RECEIPT_MAX_EDGE = 1600;

function downscaleReceipt(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, RECEIPT_MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL("image/jpeg", 0.72);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      base64 ? resolve(base64) : reject(new Error("Could not prepare that photo"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't a readable image")); };
    img.src = url;
  });
}

async function captureReceipt(file) {
  // Clear both inputs so re-picking the same photo still fires onchange.
  const cam = $("rcptcam"), lib = $("rcptlib");
  if (cam) cam.value = ""; if (lib) lib.value = "";
  if (!file) return;
  const note = $("rcptcamnote");
  const shoot = $("rcptshoot"), pick = $("rcptpick");
  const busy = (on) => { if (shoot) shoot.disabled = on; if (pick) pick.disabled = on; };
  busy(true);
  if (note) { note.className = "note"; note.textContent = "Reading the receipt…"; }
  try {
    const image = await downscaleReceipt(file);
    const d = await api("/gmail/photo-receipt", { image, media_type: "image/jpeg" });
    await loadReceipts();
    // loadReceipts rebuilds the panel, so the in-flight note is gone by now —
    // a toast is what actually survives to be read.
    toast("Receipt read — check the details");
    receiptSheet(d.receipt, d.suggested_category || S.preClassify);
  } catch (err) {
    busy(false);
    if (note) { note.className = "note err"; note.textContent = err.message; }
    toast(friendlyError(err, "Couldn't read that receipt photo. Try another photo."), "err");
  }
}

async function receiptPhotoSheet(id) {
  try {
    const d = await get("/gmail/receipt-photo?id=" + encodeURIComponent(id));
    sheet(`<h2>Receipt photo</h2>
      <img src="${esc(d.url)}" alt="Photographed receipt"
        style="width:100%;border-radius:14px;margin-top:10px;display:block">`, (sh) =>
      remintOnExpiry(sh.querySelector("img"), async () =>
        (await get("/gmail/receipt-photo?id=" + encodeURIComponent(id))).url));
  } catch (err) { toast(friendlyError(err, "Couldn't open that receipt photo. Try again."), "err"); }
}

function receiptSheet(r, suggestedCategory) {
  if (!r) return;
  // A photo arrives uncategorised on purpose; pre-select Ledger's read so it is
  // one tap to accept and still a deliberate choice, not an automatic one.
  const native=S.booksProvider==="native";
  const picked = r.category || suggestedCategory || "";
  const opts = Object.entries(CATEGORIES).map(([group, items]) =>
    `<optgroup label="${esc(group)}">${items.map((i) => `<option ${picked === i ? "selected" : ""}>${esc(i)}</option>`).join("")}</optgroup>`).join("");
  sheet(`<h2>${esc(r.vendor || r.from_name || "Receipt")}</h2>
    <p class="sh-sub">${esc(r.subject || "")} · ${esc(dayLabel(r.received_at))}</p>
    ${r.summary ? `<p class="note">${esc(r.summary)}</p>` : ""}
    ${r.image_path ? `<button class="btn ghost wide" style="margin-top:9px" id="rphoto">View photo</button>` : ""}
    ${suggestedCategory && !r.category ? `<p class="note">Ledger read this as <b>${esc(suggestedCategory)}</b> — confirm or change it below.</p>` : ""}
    <label class="fld">AMOUNT</label>
    <input id="ramt" inputmode="decimal" value="${r.total ?? ""}" placeholder="0.00">
    <label class="fld">CATEGORY</label>
    <select id="rcat"><option value="">Choose a category…</option><option ${picked === "Personal" ? "selected" : ""}>Personal</option>${opts}</select>
    <p class="note" id="racct" style="margin-top:7px">${picked && picked !== "Personal" ? "Suggested account · " + esc(suggestedAccount(picked)) : ""}</p>
    <div class="rowbtns" style="margin-top:15px">
      <button class="btn ghost" id="rdismiss">Dismiss</button>
      <button class="btn primary" id="rsave">Save</button>
    </div>
    ${native ? `<p class="note">Saved in your receipt records. No QuickBooks posting is needed. Record material use in Job costs when it is used.</p>` : r.qbo_purchase_id ? `<p class="note ok" style="margin-top:10px">Already in QuickBooks.</p>`
      : `<button class="btn em wide" style="margin-top:9px" id="rpost">Post to QuickBooks</button>`}
    <div class="note" id="rnote" style="margin-top:9px"></div>`, (sh) => {
    const note = sh.querySelector("#rnote");
    const acct = sh.querySelector("#racct");
    const photo = sh.querySelector("#rphoto");
    if (photo) photo.onclick = () => receiptPhotoSheet(r.id);
    sh.querySelector("#rcat").onchange = (e) => {
      const c = e.target.value;
      acct.textContent = c && c !== "Personal" ? "Suggested account · " + suggestedAccount(c) : "";
    };
    const save = async () => {
      const amt = parseFloat(sh.querySelector("#ramt").value);
      const cat = sh.querySelector("#rcat").value;
      if (Number.isFinite(amt) && amt !== r.total) { await api("/gmail/set-amount", { id: r.id, total: amt }); r.total = amt; }
      if (cat && cat !== r.category) { await api("/gmail/categorize", { id: r.id, category: cat }); r.category = cat; }
    };
    sh.querySelector("#rsave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await save(); closeSheet(); toast("Receipt updated"); loadReceipts(); }
      catch (err) { e.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
    };
    sh.querySelector("#rdismiss").onclick = async (e) => {
      if (!(await askConfirm("There's no undo for this in the app.", { title: "Dismiss this receipt?", ok: "Dismiss", danger: true }))) return;
      e.currentTarget.disabled = true;
      try { await api("/gmail/dismiss", { id: r.id }); closeSheet(); loadReceipts(); }
      catch (err) { e.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
    };
    const post = sh.querySelector("#rpost");
    if (post) post.onclick = async () => {
      const dup = duplicateOf(r);
      if (dup && !(await askConfirm(`Another receipt from ${dup.vendor || dup.from_name || "the same vendor"} for ${money(dup.total)} on the same day is already logged.`, { title: "Post this one too?", ok: "Post it" }))) return;
      post.disabled = true; note.className = "note"; note.textContent = "Looking up vendors…";
      try {
        await save();
        const v = await api("/quickbooks-invoice/expense-vendors", { receipt_id: r.id });
        const vendors = v.vendors || [];
        note.innerHTML = `<label class="fld">VENDOR — WHO WAS PAID</label><select id="rvend">${
          vendors.map((x) => `<option value="${esc(x.id)}" ${x.id === v.suggestedId ? "selected" : ""}>${esc(x.name)}</option>`).join("")
        }<option value="__new__">Create a new vendor…</option></select>
          <input id="rvendnew" class="cmpinput" placeholder="New vendor name" maxlength="100" style="margin-top:8px;display:none">
          <button class="btn em wide" style="margin-top:9px" id="rgo">Post expense</button>
          <p class="note" style="margin-top:6px">Creates a real expense in your books — you can edit or delete it in QuickBooks afterward.</p>`;
        const sel = note.querySelector("#rvend"), nv = note.querySelector("#rvendnew");
        sel.onchange = () => { nv.style.display = sel.value === "__new__" ? "block" : "none"; if (sel.value === "__new__") nv.focus(); };
        note.querySelector("#rgo").onclick = async (e2) => {
          const body = { receipt_id: r.id };
          if (sel.value === "__new__") {
            const name = nv.value.trim();
            if (!name) { toast("Type the new vendor's name", "err"); return; }
            body.vendor_name = name;
          } else body.vendor_id = sel.value;
          e2.currentTarget.disabled = true;
          try {
            await api("/quickbooks-invoice/expense-post", body);
            closeSheet(); toast("Posted to QuickBooks"); loadReceipts();
          } catch (err) { e2.currentTarget.disabled = false; toast(friendlyError(err, "Couldn't post that expense. Nothing was posted — try again."), "err"); }
        };
      } catch (err) { post.disabled = false; note.className = "note err"; note.textContent = err.message; }
    };
  });
}

/* ---------------- PHONE ---------------- */
const PHONE_DAY_LABELS = [["sun", "S"], ["mon", "M"], ["tue", "T"], ["wed", "W"], ["thu", "T"], ["fri", "F"], ["sat", "S"]];

function formatE164(n) {
  const m = String(n || "").match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (n || "");
}

async function renderPhone(cachedBoard = null) {
  if (phonePendingSave) cachedBoard = S.phone || cachedBoard;
  const request = S.phoneRequest = (S.phoneRequest || 0) + 1;
  if (!cachedBoard) view().innerHTML = `<div class="sect" aria-busy="true">${pageHead("Phone")}<p role="status">Loading your phone…</p></div>`;
  try {
    const d = cachedBoard || await api("/phone", { action: "board" });
    if (request !== S.phoneRequest || S.tab !== "phone" || (phonePendingSave && !cachedBoard)) return;
    S.phone = d;
    tabBadge("phone", (d.needsYou || []).length);
    view().innerHTML = `<div class="sect phone-command-center phone-os">
      ${d.hasNumber ? phoneOSHeader(d) + '<div class="phone-os-content">' + phoneLaneBody(d) + '</div>' + phoneOSDock(d) : pageHead("Phone") + `<button class="btn wide" id="phone-guided-demo">Try the phone walkthrough</button><p class="note">Sample conversation only — no live calls, texts or bookings.</p>` + requestNumberCard(d.pendingRequest, d.numberLocked, d)}
    </div>`;
    if($("phone-guided-demo")) $("phone-guided-demo").onclick=phoneGuidedDemo;
    if (!d.hasNumber) wireRequestNumber(d.pendingRequest, d.numberLocked);
    if (d.hasNumber && phoneLane() === "activity") on("[data-pevt]", "click", (e) => phoneEventSheet(d.events.find((ev) => ev.id === e.currentTarget.dataset.pevt)));

    if (d.hasNumber) {
      if ($("phsetup")) $("phsetup").onclick = () => phoneSetupSheet(d);
      if ($("phsettings")) $("phsettings").onclick = () => phoneSettingsSheet(d);
      on("[data-plane]", "click", (e) => { S.phoneLane = e.currentTarget.dataset.plane; renderPhone(d); });
      wirePhoneOS(d);
      if ($("parm")) $("parm").onclick = () => phoneArmLine(d);
      on("[data-pnowtext]", "click", (e) => phoneTextNumber(d, e.currentTarget.dataset.pnowtext));
      on("[data-pnowbook]", "click", (e) => phoneBookNumber(e.currentTarget.dataset.pnowbook));
      on("[data-needscall]", "click", (e) => e.stopPropagation());
      on("[data-needsdel]", "click", (e) => { e.stopPropagation(); phoneNeedsDelete(d, e.currentTarget.dataset.needsdel); });
      if ($("pjump")) $("pjump").onclick = () => { S.phoneLane = "autopilot"; renderPhone(d); };
      on("[data-pcell]", "click", (e) => {
        const k = e.currentTarget.dataset.pcell;
        S.phoneDayCell = S.phoneDayCell === k ? null : k;
        document.querySelectorAll("[data-pcell]").forEach((b) => b.classList.toggle("on", b.dataset.pcell === S.phoneDayCell));
        phoneDrawDayPeople(d);
      });
      phoneDrawDayPeople(d);
      on("[data-ptscan]", "click", (e) => {
        const a = ((d.today || {}).items || []).find((x) => x.id === e.currentTarget.dataset.ptscan);
        if (a) vehicleScanSheet({ id: a.id, start: a.at, title: a.name }, () => renderPhone());
      });
      if ($("thclear")) $("thclear").onclick = async () => {
        if (!(await askConfirm("Threads still waiting on a reply from you are kept. Everything else comes off the tab.", { title: "Clear text threads?", ok: "Clear", danger: true }))) return;
        try { await api("/phone", { action: "threads-clear" }); renderPhone(); } catch (err) { toast(friendlyError(err, "Couldn't clear your text threads. Try again.")); }
      };
      on("[data-thdel]", "click", async (e) => {
        e.stopPropagation();
        if (!(await askConfirm("It comes off the tab. Every message stays on file, and if they text again the thread comes right back.", { title: "Delete this thread?", ok: "Delete", danger: true }))) return;
        try { await api("/phone", { action: "thread-delete", conversation_id: e.currentTarget.dataset.thdel }); renderPhone(); } catch (err) { toast(friendlyError(err, "Couldn't delete that thread. Try again.")); }
      });
      if ($("evclear")) $("evclear").onclick = async () => {
        if (!(await askConfirm("These come off the tab. Calls still holding an unplayed voicemail are kept, and nothing is removed from your call history.", { title: "Clear the missed-call feed?", ok: "Clear", danger: true }))) return;
        try { await api("/phone", { action: "events-clear", scope: "calls" }); renderPhone(); } catch (err) { toast(friendlyError(err, "Couldn't clear the missed-call feed. Try again.")); }
      };
      on("[data-evdel]", "click", async (e) => {
        e.stopPropagation();
        try { await api("/phone", { action: "event-dismiss", event_id: e.currentTarget.dataset.evdel }); renderPhone(); } catch (err) { toast(friendlyError(err, "Couldn't dismiss that call. Try again.")); }
      });
      if ($("remindall")) $("remindall").onclick = () => apptReminderPreviewSheet();
      on("[data-needs]", "click", (e) => openNeedsYou(d, e.currentTarget.dataset.needs));
      on("[data-autotoggle]", "click", (e) => {
        e.stopPropagation();
        toggleAutomation(d, e.currentTarget.dataset.autotoggle);
      });
      on("[data-auto]", "click", (e) => {
        // The switch is a child of the row. Without this the flip would also
        // open the sheet it just changed the state of.
        if (e.target.closest("[data-autotoggle]")) return;
        openAutomation(d, e.currentTarget.dataset.auto);
      });
      if ($("fdtoggle")) $("fdtoggle").onclick = () => toggleFrontDesk(d);
      if ($("remtoggle")) $("remtoggle").onclick = () => toggleApptReminders(d);
      if ($("remtune")) $("remtune").onclick = () => apptReminderSheet(d);
      if ($("rempreview")) $("rempreview").onclick = () => apptReminderPreviewSheet();
      if ($("fdtune")) $("fdtune").onclick = () => frontDeskSheet(d);
      if ($("fdlog")) $("fdlog").onclick = () => frontDeskLogSheet();
      // First time a number goes live, open the setup guide once — same
      // one-shot pattern as the iOS onboarding interview's @AppStorage flag.
      const seenKey = "ledger.phoneSetupSeen." + d.number.id;
      if (!accountStorage.getItem(seenKey)) { accountStorage.setItem(seenKey, "1"); phoneSetupSheet(d); }
      if (phoneLane() === "activity") loadVoicemails(d);
    }
  } catch (e) {
    if (request !== S.phoneRequest || S.tab !== "phone") return;
    view().innerHTML = `<div class="sect">${pageHead("Phone")}<div class="empty">${esc(e.message)}</div><button class="btn" id="phone-retry">Retry</button></div>`;
    $("phone-retry").onclick = () => renderPhone();
  }
}

// Dense glanceable strip — line armed/off, the number, calls today and leads
// captured this week (both read off the already-fetched missed-call feed, no
// second round trip). LEADS LANE now lives under this tab, not Customers.
function phoneReplyLabel(minutes) {
  if (minutes === null || minutes === undefined) return "\u2014";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return Math.round(minutes) + "m";
  const hours = minutes / 60;
  if (hours < 24) return hours.toFixed(1) + "h";
  return Math.round(hours / 24) + "d";
}

function phoneStatusStrip(d) {
  const armed = !!((d.autoReplyHours || "").trim() || (d.autoReplyAfter || "").trim());
  const events = d.events || [];
  const threads = d.threads || [];
  const m = d.metrics || {};
  const today = localDay();
  // Prefer the server's metrics block; fall back to what's locally derivable so
  // an older edge deployment degrades to the old numbers instead of zeros.
  const callsToday = m.callsToday ?? events.filter((ev) => localDay(new Date(ev.occurredAt)) === today).length;
  const missedToday = m.missedToday ?? events.filter((ev) => localDay(new Date(ev.occurredAt)) === today && !ev.answered).length;
  const cutoff = Date.now() - 7 * 86400000;
  const leadsWeek = m.leads7d ?? events.filter((ev) => ev.leadId && new Date(ev.occurredAt).getTime() >= cutoff).length;
  const awaiting = m.awaitingReply ?? threads.filter((t) => (t.unreadCount || 0) > 0 && (t.status || "open") === "open").length;
  const textsToday = m.textsToday ?? 0;
  return `<div class="phstrip">
    <div class="phrow">
      <div class="phcell line"><span class="dot ${armed ? "on" : "off"}"></span>
        <div><small>Line</small><b>${esc(formatE164(d.number.e164))}</b></div></div>
      <div class="phcell"><small>Awaiting reply</small><b class="${awaiting > 0 ? "warn" : "ok"}">${awaiting}</b></div>
      <div class="phcell"><small>Median reply</small><b>${esc(phoneReplyLabel(m.medianResponseMinutes))}</b></div>
    </div>
    <div class="phrule"></div>
    <div class="phrow">
      <div class="phcell"><small>Calls</small><b>${callsToday}</b></div>
      <div class="phcell"><small>Missed</small><b class="${missedToday > 0 ? "warn" : ""}">${missedToday}</b></div>
      <div class="phcell"><small>Texts</small><b>${textsToday}</b></div>
      <div class="phcell"><small>Leads &middot; 7d</small><b>${leadsWeek}</b></div>
      <div class="phcell"><small>Auto-reply</small><b class="${armed ? "ok" : "warn"}">${armed ? "Armed" : "Off"}</b></div>
    </div>
  </div>`;
}

// THE STATUS RAIL — one line where a whole card used to be.
//
// What it replaced: a panel carrying a heading, a phone number that has never
// changed and will never change, a paragraph of marketing, and a button an
// owner presses exactly once in the life of the account. Four elements and a
// third of the first screen, none of it answering a question anybody has after
// day one.
//
// What it says instead is the one thing this tab never carried: state, right
// now. Open or after hours, and how much of the line is armed. Everything else
// on the Phone tab is a report on a week that has already happened.
//
// The setup guide moves to Activity → Your line, where the rest of the
// once-ever configuration already lives.
function phoneStatusRail(d) {
  const rows = d.automations || [];
  const armed = rows.filter((r) => r.enabled).length;
  const open = d.openNow === true;
  return `<div class="prail">
    <span class="pdot${open ? " open" : ""}"></span>
    <b>${esc(formatE164(d.number.e164))}</b>
    <span class="prstate${open ? " open" : ""}">${open ? "OPEN" : "AFTER HOURS"}</span>
    <span class="prarm${armed ? " on" : ""}">${armed} OF ${rows.length} ARMED</span>
  </div>`;
}

// Standard GSM/3GPP conditional-forwarding codes — the same codes Bell,
// Rogers, Telus, Fido, Koodo, AT&T and T-Mobile all honour. Verizon's legacy
// CDMA codes differ, so that's called out rather than guessed at.
function phoneForwardingCodes(target) {
  const t = target.replace(/^\+1/, "1");
  return [
    ["Busy", `*67*${t}#`, `#67#`],
    ["No answer", `*61*${t}#`, `#61#`],
    ["Unreachable / phone off", `*62*${t}#`, `#62#`],
    ["All calls", `*21*${t}#`, `#21#`],
  ];
}

function voicemailScript(businessName) {
  return `You've reached ${businessName}. We're either helping another customer or away from the phone right now. `
    + `Leave your name, number, and a quick note about what you need, and we'll call you back as soon as we can. `
    + `Thanks for calling ${businessName}!`;
}

function phoneSetupSheet(d) {
  const bizName = S.profile?.business?.name || "your business";
  const codes = phoneForwardingCodes(d.number.e164);
  const script = voicemailScript(bizName);
  sheet(`<h2>Set up your new number</h2>
    <p class="sh-sub">${esc(formatE164(d.number.e164))} is live. Two ways to put it to work:</p>
    <h3 style="margin-top:16px">1 &middot; Keep your old number</h3>
    <p class="sub">Forward calls from your existing line to your new Ledger AI number using your carrier's conditional-forwarding codes. Dial the "enable" code from the old phone once — no app, no settings menu.</p>
    <div class="list" style="margin-top:8px">
      ${codes.map(([label, on, off]) => `
        <div class="item" style="cursor:default">
          <div class="main"><div class="ttl">${esc(label)}</div>
            <div class="sub">Enable <code>${esc(on)}</code> &middot; Disable <code>${esc(off)}</code></div></div>
        </div>`).join("")}
    </div>
    <p class="note" style="margin-top:6px">Works on Bell, Rogers, Telus, Fido, Koodo, AT&amp;T and T-Mobile. On Verizon, use your carrier's call forwarding settings instead of these codes.</p>
    <h3 style="margin-top:18px">2 &middot; Or advertise your new number</h3>
    <p class="sub">Put ${esc(formatE164(d.number.e164))} on your website, Google Business Profile, invoices and vehicles as your primary line going forward. No forwarding needed — it just works.</p>
    <h3 style="margin-top:18px">Voicemail greeting script</h3>
    <p class="sub">Read this into your carrier's greeting recorder (recording the audio itself is still a manual step — this just gives you the words).</p>
    <p class="note" id="vmscript" style="margin-top:8px;white-space:pre-wrap">${esc(script)}</p>
    <button class="btn ghost wide" style="margin-top:9px" id="vmcopy">Copy script</button>`, (sh) => {
    sh.querySelector("#vmcopy").onclick = () => {
      navigator.clipboard?.writeText(script).then(() => toast("Script copied")).catch(() => toast("Couldn't copy — select and copy manually", "err"));
    };
  });
}

function phoneEventBadge(ev) {
  if (ev.autoReplySent) return '<span class="tag new">auto-replied</span>';
  if (!ev.answered) return '<span class="tag open">no reply sent</span>';
  return '<span class="tag paid">answered</span>';
}

// The Phone tab was calls-only because the original Quo webhook subscribed to
// call.completed alone. With message.received/message.delivered flowing, the
// thread inbox is the primary surface and the missed-call feed sits under it.
function phoneThreadsPanel(d) {
  const threads = d.threads || [];
  const open = threads.filter((t) => (t.status || "open") !== "done");
  const done = threads.filter((t) => (t.status || "open") === "done").slice(0, 6);
  const awaiting = open.filter((t) => (t.unreadCount || 0) > 0).length;
  const row = (t) => {
    const isDone = (t.status || "open") === "done";
    const unread = (t.unreadCount || 0) > 0 && !isDone;
    const preview = (t.lastMessagePreview || "").trim();
    const body = preview ? (t.lastMessageDirection === "outgoing" ? "You: " : "") + preview : "No messages yet.";
    return `<div class="pdelwrap"><button class="item thitem${unread ? " unread" : ""}" data-pthread="${esc(t.id)}">
      <div class="main">
        <div class="ttl">${esc(t.peerName || formatE164(t.peerNumber))}${unread ? '<span class="thdot"></span>' : ""}</div>
        <div class="sub">${esc(body)}</div>
      </div>
      <div class="thmeta">
        <small>${esc(t.lastMessageAt ? dayLabel(t.lastMessageAt) + " " + timeLabel(t.lastMessageAt) : "")}</small>
        ${unread ? '<span class="tag open">reply</span>' : isDone ? '<span class="thdone">&#10003;</span>' : ""}
      </div>
    </button><button class="pdel" data-thdel="${esc(t.id)}" aria-label="Delete thread">&times;</button></div>`;
  };
  return `<div class="lanehead"><span class="eyebrow">Text threads</span>
      <span class="note">${awaiting > 0 ? awaiting + " awaiting reply" : open.length + " open"}${threads.length ? ' &middot; <a href="#" id="thclear" onclick="return false">Clear</a>' : ""}</span></div>
    ${threads.length ? `<div class="list">${open.map(row).join("")}${done.length ? `<div class="eyebrow" style="margin:10px 0 4px">Done</div>${done.map(row).join("")}` : ""}</div>`
      : `<div class="empty">No texts yet. When someone texts your business number the conversation lands here, and you can answer from this screen.</div>`}`;
}

function phoneBubble(msg) {
  const mine = msg.direction !== "incoming";
  const status = (msg.status || "").toLowerCase();
  const failed = status === "failed" || status === "undelivered";
  return `<div class="bubrow ${mine ? "me" : "them"}">
    <div>
      <div class="bub">${esc(msg.body || "")}</div>
      <div class="bubstamp">${esc(dayLabel(msg.occurredAt))} ${esc(timeLabel(msg.occurredAt))}
        ${mine && msg.sentBy === "auto" ? '<span class="auto">AUTO</span>' : ""}
        ${failed ? `<span class="failed">${esc(status.toUpperCase())}</span>` : ""}</div>
    </div>
  </div>`;
}

async function phoneThreadSheet(t) {
  if (!t) return;
  const title = t.peerName || formatE164(t.peerNumber);
  let status = t.status || "open";
  const wrap = sheet(`<h2>${esc(title)}</h2>
    <p class="sh-sub" id="phthsub">${esc(formatE164(t.peerNumber))}</p>
    ${t.answeredBy === "front-desk" && status !== "done" ? '<p class="note" style="margin-top:6px">Ledger is answering this one. Anything you send goes out as you.</p>' : ""}
    <div class="chat" id="phchat"><div class="skel"></div></div>
    <div class="composer">
      <textarea id="phdraft" rows="1" placeholder="Text ${esc(title)}&hellip;"></textarea>
      <button class="btn primary" id="phsend">Send</button>
    </div>
    <div class="note" id="pherr" style="display:none"></div>
    <div class="rowbtns" style="margin-top:12px">
      <a class="btn ghost" href="tel:${esc(t.peerNumber)}">Call</a>
      <button class="btn ghost" id="phdone">${status === "done" ? "Reopen" : "Mark done"}</button>
    </div>`);
  let historyMore = false, oldestMessage = null;
  const chat = wrap.querySelector("#phchat");
  const err = wrap.querySelector("#pherr");
  const showErr = (msg) => { err.style.display = "block"; err.className = "note err"; err.textContent = msg; };

  async function load(markRead) {
    try {
      const d = await api("/phone", { action: "thread", conversation_id: t.id });
      status = (d.thread && d.thread.status) || status;
      historyMore = !!d.hasMore; oldestMessage = d.messages?.[0] || null;
      chat.innerHTML = (d.messages || []).length
        ? d.messages.map(phoneBubble).join("")
        : `<div class="empty">No messages in this thread yet.</div>`;
      wireOlder();
      chat.scrollTop = chat.scrollHeight;
      err.style.display = "none";
    } catch (e) { showErr(e.message); chat.innerHTML = ""; return; }
    // Opening a thread IS reading it — fired after the history lands so a
    // failed read never leaves the sheet blank. Mirrored into Quo server-side.
    if (markRead && (t.unreadCount || 0) > 0) {
      try { await api("/phone", { action: "thread-read", conversation_id: t.id }); renderPhone(); } catch (e) { /* non-fatal */ }
    }
  }

  function wireOlder() {
    chat.querySelector("#pholder")?.remove();
    if(!historyMore || !oldestMessage)return;
    const button=document.createElement("button");button.id="pholder";button.className="btn ghost";button.textContent="Load older messages";chat.prepend(button);
    button.onclick=async()=>{button.disabled=true;const height=chat.scrollHeight,top=chat.scrollTop;try{const d=await api("/phone",{action:"thread",conversation_id:t.id,before_at:oldestMessage.occurredAt,before_id:oldestMessage.id});historyMore=!!d.hasMore;oldestMessage=d.messages?.[0]||oldestMessage;button.remove();chat.insertAdjacentHTML("afterbegin",(d.messages||[]).map(phoneBubble).join(""));wireOlder();chat.scrollTop=top+chat.scrollHeight-height;}catch(e){showErr(e.message);button.disabled=false;}};
  }

  // One key per draft: kept across a failed tap, replaced after a successful
  // one, so a retry after a timeout replays the first send instead of
  // texting the customer twice (server dedupes on it).
  let sendKey = null, sendKeyBody = "";
  wrap.querySelector("#phsend").onclick = async (e) => {
    const field = wrap.querySelector("#phdraft");
    const body = field.value.trim();
    if (!body) return;
    e.currentTarget.disabled = true;
    // Edited wording is a new text and gets a new key.
    if (!sendKey || sendKeyBody !== body) { sendKey = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); sendKeyBody = body; }
    try {
      await api("/phone", { action: "reply", conversation_id: t.id, to_number: t.peerNumber, body, idempotency_key: sendKey });
      sendKey = null; sendKeyBody = "";
      field.value = "";
      await load(false);
      renderPhone();
    } catch (ex) {
      showErr(ex.message); smsSendFailed(ex);
      // The first attempt may already be on the thread — show it before the
      // owner decides whether to tap again.
      if (ex?.status === 409 && ex?.data?.error === "send_in_progress") await load(false);
    }
    e.currentTarget.disabled = false;
  };

  wrap.querySelector("#phdone").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api("/phone", { action: status === "done" ? "thread-open" : "thread-done", conversation_id: t.id });
      closeSheet();
      renderPhone();
    } catch (ex) { showErr(ex.message); e.currentTarget.disabled = false; }
  };

  load(true);
}

function phoneFeedPanel(d) {
  const events = d.events || [];
  return `<div class="lanehead"><span class="eyebrow">Missed-call feed</span><span class="note">${events.length} logged${events.length ? ' &middot; <a href="#" id="evclear" onclick="return false">Clear</a>' : ""}</span></div>
    ${events.length ? `<div class="list">${events.map((ev) => `
      <div class="pdelwrap"><button class="item" data-pevt="${esc(ev.id)}">
        <div class="main">
          <div class="ttl">${esc(ev.callerName || formatE164(ev.callerNumber) || "Unknown caller")}</div>
          <div class="sub">${esc(dayLabel(ev.occurredAt))} · ${esc(timeLabel(ev.occurredAt))}${ev.voicemailUrl ? " · 🎙 voicemail" : ""}</div>
        </div>
        <div class="amt"><small>${phoneEventBadge(ev)}</small></div>
      </button><button class="pdel" data-evdel="${esc(ev.id)}" aria-label="Delete">&times;</button></div>`).join("")}</div>`
      : `<div class="empty">No missed calls yet. When one comes in, it shows up here within seconds.</div>`}`;
}

function phoneEventSheet(ev) {
  if (!ev) return;
  // Same four actions as the iPhone: Book appointment · Play voicemail (fresh
  // signed link — provider media links expire) · Call back · Text back into
  // the in-app thread when one exists.
  const board = S.phone || {};
  const thread = (board.threads || []).find((t) => t.peerNumber === ev.callerNumber);
  const wrap = sheet(`<h2>${esc(ev.callerName || formatE164(ev.callerNumber) || "Unknown caller")}</h2>
    <p class="sh-sub">${esc(dayLabel(ev.occurredAt))} · ${esc(timeLabel(ev.occurredAt))} · ${esc(ev.direction)} · ${esc(ev.status)}</p>
    ${ev.voicemailUrl ? `<button class="btn em" id="evplay" style="margin-top:10px">&#9654; Play voicemail</button><div id="evplayer"></div>` : ""}
    ${ev.transcript ? `<p class="note" style="margin-top:9px">${esc(ev.transcript)}</p>` : ""}
    <p class="note" style="margin-top:9px">${ev.autoReplySent ? "Auto-reply sent: “" + esc(ev.autoReplyText || "") + "”" : ev.autoReplyError ? "Auto-reply " + esc(ev.autoReplyError) + "." : "No auto-reply was sent for this call."}</p>
    <div class="rowbtns" style="margin-top:14px">
      <button class="btn primary" id="evbook">Book appointment</button>
      <a class="btn ghost" href="tel:${esc(ev.callerNumber)}">Call back</a>
      ${thread ? `<button class="btn ghost" id="evtext">Text back</button>` : `<a class="btn ghost" href="sms:${esc(ev.callerNumber)}">Text back</a>`}
    </div>`);
  const play = wrap.querySelector("#evplay");
  if (play) play.onclick = async () => {
    const slot = wrap.querySelector("#evplayer");
    slot.innerHTML = `<div class="note">Loading…</div>`;
    try {
      const media = await api("/phone", { action: "voicemail-media", event_id: ev.id });
      slot.innerHTML = `<audio controls autoplay src="${esc(media.url)}" style="width:100%;margin-top:9px"></audio>`;
      if (!ev.voicemailHeardAt && !VM.heard.has(ev.id)) {
        VM.heard.add(ev.id);
        api("/phone", { action: "voicemail-heard", event_id: ev.id }).catch(() => {});
      }
    } catch (e) { slot.innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
  };
  wrap.querySelector("#evbook").onclick = () => { closeSheet(); phoneBookNumber(ev.callerNumber); };
  const tx = wrap.querySelector("#evtext");
  if (tx) tx.onclick = () => phoneThreadSheet(thread);
}

// Tappable summary row — opens the hours/template editor in a sheet instead
// of an always-inline form. The inline textareas used to sit right in the
// tab's own scroll flow with nothing to close the keyboard once open.
function phoneSettingsSummary(d) {
  const start = timeLabel12(d.hoursStart || "08:00"), end = timeLabel12(d.hoursEnd || "17:00");
  // The setup guide lives here now rather than above the lane bar. Call
  // forwarding is a once-in-the-life-of-the-account job, and a button for it
  // was holding the best strip on the screen hostage forever after.
  return `<div class="panel phsettingsrow" id="phsettings">
    <div class="ic">&#9200;</div>
    <div class="m"><b>Business hours &amp; auto-reply</b><span>${esc(start)} &ndash; ${esc(end)}</span></div>
    <span class="chev">&#8250;</span>
  </div>
  <div class="panel phsettingsrow" id="phsetup" style="margin-top:10px">
    <div class="ic">&#128203;</div>
    <div class="m"><b>Setup guide</b><span>Forward your calls to ${esc(formatE164(d.number ? d.number.e164 : ""))}</span></div>
    <span class="chev">&#8250;</span>
  </div>`;
}

// "08:00" -> "8:00 AM", local-format only (no timezone math — the string is
// already the shop's own clock, same contract as the input[type=time] value).
function timeLabel12(hhmm) {
  const [h, m] = (hhmm || "08:00").split(":").map(Number);
  const d = new Date(); d.setHours(h || 0, m || 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ---- VOICEMAIL -----------------------------------------------------------
// Only calls that actually left a message. Playback asks the server for a
// fresh signed URL at press-play rather than trusting the one stored at
// ingest, because provider media links expire.
const VM = { heard: new Set() };

async function loadVoicemails(board) {
  const host = $("vmlane");
  if (!host) return;
  try {
    const d = await api("/phone", { action: "voicemails", limit: 40 });
    const list = d.voicemails || [];
    const unheard = list.filter((v) => !v.voicemailHeardAt && !VM.heard.has(v.id)).length;
    host.innerHTML = `<div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <h3 style="margin:0">&#9993; Voicemail ${unheard ? `<span class="pill live">${unheard} NEW</span>` : (list.length ? '<span class="pill">all heard</span>' : "")}</h3>
        ${list.length ? '<button class="btn ghost" id="vmclear">Clear all</button>' : ""}
      </div>
      ${list.length ? `<div class="list">${list.map((v) => voicemailRow(v, board)).join("")}</div>`
        : `<p class="sub">No voicemails. When a caller leaves a message it lands here — play it right on this page, transcript underneath.</p>`}
    </div>`;
    on("[data-vmplay]", "click", (e) => playVoicemail(e.currentTarget.dataset.vmplay), host);
    on("[data-vmtx]", "click", (e) => {
      const row = (board.threads || []).find((t) => t.id === e.currentTarget.dataset.vmtx);
      if (row) phoneThreadSheet(row);
    }, host);
    on("[data-vmscript]", "click", (e) => {
      const box = host.querySelector(`#vmtx-${e.currentTarget.dataset.vmscript}`);
      if (box) box.hidden = !box.hidden;
    }, host);
    on("[data-vmdel]", "click", async (e) => {
      if (!(await askConfirm("It comes off the Phone tab. The call itself stays in your history.", { title: "Delete this voicemail?", ok: "Delete", danger: true }))) return;
      try { await api("/phone", { action: "event-dismiss", event_id: e.currentTarget.dataset.vmdel }); renderPhone(); } catch (err) { toast(friendlyError(err, "Couldn't delete that voicemail. Try again.")); }
    }, host);
    const vmclear = host.querySelector("#vmclear");
    if (vmclear) vmclear.onclick = async () => {
      if (!(await askConfirm("Every message here comes off the tab, heard or not. The calls stay in your history.", { title: "Clear all voicemail?", ok: "Clear", danger: true }))) return;
      try { await api("/phone", { action: "events-clear", scope: "voicemails" }); renderPhone(); } catch (err) { toast(friendlyError(err, "Couldn't clear your voicemail. Try again.")); }
    };
  } catch (e) {
    host.innerHTML = `<div class="panel"><h3>&#9993; Voicemail</h3><p class="sub">${esc(e.message)}</p></div>`;
  }
}

function vmClock(seconds) {
  const total = Number(seconds) || 0;
  if (total <= 0) return "";
  return `${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}`;
}

function voicemailRow(v, board) {
  const heard = !!v.voicemailHeardAt || VM.heard.has(v.id);
  const length = vmClock(v.voicemailDurationSeconds);
  const thread = (board.threads || []).find((t) => t.peerNumber === v.callerNumber);
  return `<div class="item vmitem">
    <div class="main">
      <div class="ttl">${heard ? "" : "&#128309; "}${esc(v.callerName || formatE164(v.callerNumber) || "Unknown caller")}</div>
      <div class="sub">${esc(dayLabel(v.occurredAt))} · ${esc(timeLabel(v.occurredAt))}${length ? ` · ${length}` : ""}</div>
      <div class="rowbtns" style="margin-top:8px">
        <button class="btn ${heard ? "" : "em"}" data-vmplay="${esc(v.id)}">&#9654; Play</button>
        ${v.transcript ? `<button class="btn" data-vmscript="${esc(v.id)}">Transcript</button>` : ""}
        <a class="btn" href="tel:${esc(v.callerNumber)}">Call back</a>
        ${thread ? `<button class="btn" data-vmtx="${esc(thread.id)}">Text back</button>` : ""}
        <button class="btn ghost" data-vmdel="${esc(v.id)}">Delete</button>
      </div>
      <div id="vmplayer-${esc(v.id)}"></div>
      ${v.transcript ? `<div class="note" id="vmtx-${esc(v.id)}" hidden style="margin-top:8px">${esc(v.transcript)}</div>` : ""}
    </div>
  </div>`;
}

async function playVoicemail(eventId) {
  const slot = $(`vmplayer-${eventId}`);
  if (!slot) return;
  // One at a time — starting a second message stops the first.
  document.querySelectorAll(".vmitem audio").forEach((a) => { if (a.parentElement !== slot) { a.pause(); a.remove(); } });
  slot.innerHTML = `<div class="note">Loading…</div>`;
  try {
    const media = await api("/phone", { action: "voicemail-media", event_id: eventId });
    slot.innerHTML = `<audio controls autoplay src="${esc(media.url)}" style="width:100%;margin-top:9px"></audio>`;
    if (!VM.heard.has(eventId)) {
      VM.heard.add(eventId);
      api("/phone", { action: "voicemail-heard", event_id: eventId }).catch(() => {});
    }
  } catch (e) {
    slot.innerHTML = `<div class="note err">${esc(e.message)}</div>`;
  }
}

// ---- FRONT DESK ----------------------------------------------------------
// The switch that lets the AI answer a missed caller on its own. Deliberately
// loud about what it does and does not do: an owner should never be surprised
// by what they just turned on.
// Night-before appointment reminders. The reminder is not the valuable half —
// the reply is: a cancellation at 6pm the night before is a bay that can still
// be refilled, where the same cancellation at 9am is an hour that is gone.
// ---------------------------------------------------------------------------
// The two new zones. Everything the old tab did is still here — this only
// changes what is loud.
// ---------------------------------------------------------------------------
//
// Nine cards laid out by system component meant an owner had to read all nine
// to find out a voicemail arrived 20 minutes ago. NEEDS YOU answers the
// question people actually open this tab with; RUNNING FOR YOU replaces two
// fat marketing cards with three measured lines.

// Kyle 2026-08-31: Autopilot leads, and it is where the tab lands.
// The order is a claim about what this product IS. Opening on the Inbox said
// "here is your mess"; opening on Autopilot says "here is what ran without
// you" — and the Inbox badge rides in the bar, so nothing waiting can hide
// behind that choice. Landing on a lane that moves with the day would be the
// alternative, and it is worse: a screen you cannot predict is a screen you
// have to read every time.
// Same three lanes as the iPhone, same names, same order, same landing
// (Kyle 2026-09-06, Phone tab parity): Needs You · Today · Auto. Work first,
// settings last. The Needs You badge rides in the bar, so nothing waiting can
// hide behind the landing choice.
const PHONE_LANES = [["activity", "Missed Calls"], ["inbox", "Texts"], ["autopilot", "Commands"], ["notifications", "Notifications"]];
const PHONE_LANE_HINT = {inbox:"Every conversation, in one place", activity:"Missed calls and voicemail", autopilot:"You choose what runs", notifications:"Understand what happened on your line"};
function phoneLane() { return PHONE_LANES.some(([k]) => k === S.phoneLane) ? S.phoneLane : "inbox"; }
function phoneCommandHero(d) {
  const rows=d.automations||[], active=rows.filter(r=>r.enabled).length;
  const waiting=d.needsYouTotal ?? (d.needsYou||[]).length;
  return `<section class="pcc-hero" aria-label="Phone command center">
    <div class="pcc-orbit" aria-hidden="true"><i></i><i></i><i></i><span>${segIc("autopilot")}</span></div>
    <div class="pcc-kicker"><span class="pcc-dot"></span> BUSINESS COMMUNICATIONS</div>
    <h2>Command center<span>Your business. In sync.</span></h2>
    <div class="pcc-line">${esc(formatE164(d.number?.e164))}<span>${d.openNow ? "Open now" : "After hours"}</span></div>
    <div class="pcc-metrics">
      <button data-plane="inbox" class="${waiting?'attention':''}"><strong>${waiting}</strong><span>Need you</span></button>
      <button data-plane="activity"><strong>${d.metrics?.callsToday??0}</strong><span>Calls today</span></button>
      <button data-plane="autopilot"><strong>${active}<small>/${rows.length}</small></strong><span>Commands on</span></button>
    </div>
  </section>`;
}
function phoneCommandIcon(key){return {frontdesk:"✦",autoreply:"↗",reminders:"◷",dispatcher:"⇄","crew-reminders":"◴","google-review-request":"☆","on-my-way":"➤"}[key]||"✦";}
const PHONE_COMMAND_ORDER=["frontdesk","autoreply","reminders","google-review-request","dispatcher","on-my-way","crew-reminders"];

function phoneLaneSwitcher(d) {
  const lane = phoneLane();
  const need = d.needsYouTotal ?? (d.needsYou || []).length;
  const rows = d.automations || [];
  const armed = rows.filter((r) => r.enabled).length;
  return `<div class="plane">${PHONE_LANES.map(([k, label]) => `
    <button class="${lane === k ? "on" : ""}" data-plane="${k}">${segIc(k)}${label}${k === "inbox" && need ? `<i class="badge">${need}</i>` : ""}${k === "autopilot" && rows.length ? `<i class="badge dim">${armed}/${rows.length}</i>` : ""}</button>`).join("")}</div>
  <p class="pdesc">${esc(PHONE_LANE_HINT[lane])}</p>`;
}

// ---- FIXED COMMAND HEADER (iPhone parity) ---------------------------------
// The top of this tab is a CUSTOMER, not a title. The last person who reached
// the line sits here with what happened to them and the three things you can
// do about it; the line's own facts (number, hours, who answers) are its
// footer. Above it, only when true, the one warning that outranks everything:
// nobody is answering.
function phoneSilentReason(d) {
  const textBack = d.autoReplyEnabled !== false;
  const desk = !!(d.frontDesk && d.frontDesk.enabled === true);
  if (!textBack && !desk) return "Nobody is answering your line";
  if (!textBack) return "Missed calls get no text back";
  if (!desk) return "Texts go unanswered";
  return null;
}

function phoneSilentStrip(d) {
  const reason = phoneSilentReason(d);
  if (!reason) return "";
  return `<div class="psilent"><b>${esc(reason)}</b><button class="btn" id="parm">Turn on</button></div>`;
}

async function phoneArmLine(d) {
  const btn = $("parm");
  if (btn) { btn.disabled = true; btn.textContent = "Turning on…"; }
  try {
    if (d.autoReplyEnabled === false) await api("/phone", { action: "settings-save", autoReplyEnabled: true });
    if (!(d.frontDesk && d.frontDesk.enabled === true)) await api("/phone", { action: "settings-save", frontDeskEnabled: true });
    toast("Ledger is answering your line");
  } catch (e) { toast(friendlyError(e, "Couldn't save that phone setting. Try again.")); }
  renderPhone();
}

function phoneHumanize(raw) {
  const s = String(raw || "");
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

function phoneNowIcon(kind) {
  return { voicemail: "&#127908;", text: "&#128172;", call: "&#128222;", missed: "&#128245;" }[kind] || "&#128222;";
}

function phoneNowCard(d) {
  const now = d.now;
  const silent = phoneSilentReason(d);
  const foot = `<div class="pnowfoot"><b>${esc(formatE164(d.number.e164))}</b><span class="${d.openNow === true ? "ok" : ""}">${d.openNow === true ? "Open now" : "After hours"}</span><span>${silent ? "You answer" : "Ledger answers"}</span></div>`;
  if (!now) {
    return `<div class="panel pnow"><div class="pnowh">Your line is live</div>
      <p class="sub" style="margin:4px 0 0">The next call or text lands here, with who it is.</p>${foot}</div>`;
  }
  const bits = [now.vehicle, now.tireSize, now.lastJob ? "last: " + now.lastJob : ""].filter(Boolean);
  if (now.visits) bits.push(now.visits + (now.visits === 1 ? " visit" : " visits"));
  const num = now.number || "";
  return `<div class="panel pnow">
    <div class="pnowtop"><span class="pnowk">${phoneNowIcon(now.kind)}</span><div style="flex:1;min-width:0">
      <div class="pnowh">${esc(now.name || formatE164(num) || "Unknown caller")}</div>
      ${bits.length ? `<div class="sub">${esc(bits.join(" · "))}</div>` : ""}
      ${now.waitLabel ? `<div class="pnowwait">${esc(String(now.waitLabel).toLowerCase())}</div>` : ""}
    </div></div>
    <div class="pnowout">${esc(phoneHumanize(now.outcome))}</div>
    ${num ? `<div class="rowbtns" style="margin-top:12px">
      <a class="btn primary" href="tel:${esc(num)}">&#128222; Call</a>
      <button class="btn" data-pnowtext="${esc(num)}">Text</button>
      <button class="btn" data-pnowbook="${esc(num)}">Book</button></div>` : ""}
    ${foot}</div>`;
}

function phoneTextNumber(d, number) {
  const t = (d.threads || []).find((x) => x.peerNumber === number);
  if (t) { phoneThreadSheet(t); return; }
  location.href = "sms:" + String(number).replace(/[^0-9+]/g, "");
}

function phoneBookNumber(number) {
  bookingSheet(localDay(), null, { phone: number });
}

async function phoneNeedsDelete(d, id) {
  const item = (d.needsYou || []).find((x) => x.id === id);
  if (!item) return;
  const target = id.slice(3);
  try {
    if (item.kind === "text") await api("/phone", { action: "thread-delete", conversation_id: target });
    else if (item.kind === "voicemail" || item.kind === "missed") await api("/phone", { action: "event-dismiss", event_id: target });
    else return;
    renderPhone();
  } catch (e) { toast(friendlyError(e, "Couldn't open the command center. Try again.")); }
}

// Signpost at the bottom of Needs You. The switches stay in Auto — this says
// so, and doubles as a state read (Kyle 2026-08-27: "the front desk button is
// gone from the phone tab").
function phoneJumpChip(d) {
  const rows = d.automations || [];
  const on = rows.filter((r) => r.enabled).length;
  const summary = !rows.length ? "Nothing set up yet"
    : on === 0 ? `Nothing is running — ${rows.length} to turn on`
    : on === rows.length ? `All ${rows.length} running` : `${on} of ${rows.length} running`;
  return `<button class="panel pjump" id="pjump"><div><small>AUTOMATIONS</small><b>${esc(summary)}</b></div><span>Turn on / off &rsaquo;</span></button>`;
}

// ---- TODAY LANE PIECES (iPhone parity) ------------------------------------
// Numbers are people (Kyle 2026-09-01): tap "3 calls" and the three names open
// under it, each one a tap away from its call or thread.
function phoneDayPeople(d, key) {
  const today = localDay();
  const threads = d.threads || [];
  const nm = (card, fallback, number) => { const k = ((card && card.name) || "").trim(); return k || fallback || formatE164(number) || "Unknown caller"; };
  const clock = (iso) => (iso ? timeLabel(iso) : "");
  if (key === "calls") {
    return (d.events || []).filter((ev) => ev.direction !== "outgoing" && localDay(new Date(ev.occurredAt)) === today).map((ev) => {
      let outcome;
      if (ev.voicemailUrl) outcome = ev.voicemailHeardAt ? "Voicemail" : "Voicemail · unheard";
      else if (ev.answered) outcome = "Answered" + ((ev.durationSeconds || 0) > 0 ? ` · ${Math.max(1, Math.floor((ev.durationSeconds || 0) / 60))} min` : "");
      else outcome = "Missed" + (ev.autoReplySent ? " · texted back" : " · nobody followed up");
      return { id: "call-" + ev.id, name: nm(ev.caller, ev.callerName, ev.callerNumber), detail: `${clock(ev.occurredAt)} · ${outcome}`, warm: !(ev.answered || ev.autoReplySent) };
    });
  }
  if (key === "texts") {
    return threads.filter((t) => t.lastMessageAt && localDay(new Date(t.lastMessageAt)) === today).map((t) => {
      const waiting = (t.unreadCount || 0) > 0 && (t.status || "open") !== "done";
      const who = t.lastMessageDirection === "outgoing" ? (t.answeredBy === "front-desk" ? "Ledger replied" : "You replied") : (waiting ? "Waiting on you" : "Handled");
      return { id: "text-" + t.id, name: nm(t.caller, t.peerName, t.peerNumber), detail: `${clock(t.lastMessageAt)} · ${who}`, warm: waiting };
    });
  }
  const cutoff = Date.now() - 7 * 86400000;
  return ((S.board && S.board.leads) || []).filter((l) => new Date(l.createdAt).getTime() >= cutoff).map((l) => {
    const digits = String(l.phone || "").replace(/\D/g, "").slice(-10);
    const t = digits.length >= 7 ? threads.find((x) => String(x.peerNumber || "").replace(/\D/g, "").slice(-10) === digits) : null;
    const status = l.status ? l.status[0].toUpperCase() + l.status.slice(1) : "";
    return { id: t ? "text-" + t.id : "lead-" + l.id, name: l.name || formatE164(l.phone) || "Unknown", detail: [status, l.source || ""].filter(Boolean).join(" · "), warm: false };
  });
}

function phoneDayStrip(d) {
  const m = d.metrics || {};
  const cells = [["calls", m.callsToday ?? 0, "calls today"], ["texts", m.textsToday ?? 0, "texts"], ["leads", m.leads7d ?? 0, "new leads"]];
  const openKey = S.phoneDayCell;
  return `<div class="panel hero pday">${cells.map(([k, n, l]) =>
    `<div class="pcell${openKey === k ? " on" : ""}" data-pcell="${k}" role="button"><p class="n">${esc(String(n))}</p><p class="l">${esc(l)}</p></div>`).join("")}</div>
    <div id="pdaypeople"></div>`;
}

function phoneDrawDayPeople(d) {
  const host = $("pdaypeople");
  if (!host) return;
  const key = S.phoneDayCell;
  if (!key) { host.innerHTML = ""; return; }
  const people = phoneDayPeople(d, key);
  host.innerHTML = !people.length
    ? `<div class="panel" style="padding:14px;margin-top:-6px"><p class="sub" style="margin:0">Nobody yet.</p></div>`
    : `<div class="panel flush" style="margin-top:-6px">${people.map((p) => `
      <button class="prow pperson${p.warm ? " warm" : ""}" data-pperson="${esc(p.id)}"><div style="flex:1;min-width:0">
        <div class="needst">${esc(p.name)}</div><div class="needsm">${esc(p.detail)}</div></div>
        ${p.id.startsWith("lead-") ? "" : '<span class="pchev">&rsaquo;</span>'}</button>`).join("")}</div>`;
  on("[data-pperson]", "click", (e) => {
    const id = e.currentTarget.dataset.pperson;
    if (id.startsWith("call-")) { const ev = (d.events || []).find((x) => x.id === id.slice(5)); if (ev) phoneEventSheet(ev); }
    else if (id.startsWith("text-")) { const t = (d.threads || []).find((x) => x.id === id.slice(5)); if (t) phoneThreadSheet(t); }
  }, host);
}

function phoneTodayCard(d) {
  const t = d.today;
  if (!t || !t.count) return "";
  let headline;
  if (t.remaining === 0) headline = t.count === 1 ? "1 job today, all done" : `${t.count} jobs today, all done`;
  else if (t.nextLabel && t.nextName) headline = `${t.nextLabel} · ${t.nextName}`;
  else headline = t.remaining === 1 ? "1 job left today" : `${t.remaining} jobs left today`;
  return `<p class="zonehead">${t.count === 1 ? "TODAY · 1 JOB" : `TODAY · ${t.count} JOBS`}</p>
    <div class="panel flush">
      <div class="prow" style="cursor:default"><div style="flex:1;min-width:0">
        <small class="eyebrow">${t.remaining === 0 ? "DONE" : "NEXT"}</small>
        <div class="needst" style="font-size:16px">${esc(headline)}</div>
        ${t.unconfirmed > 0 ? `<div class="needsm" style="color:var(--gold)">${t.unconfirmed === 1 ? "1 of them still hasn't confirmed." : `${t.unconfirmed} of them still haven't confirmed.`}</div>` : ""}
      </div></div>
      ${(t.items || []).map((a) => `<div class="prow" style="align-items:center;cursor:default"><b class="ptime">${esc(a.time)}</b>
        <div style="flex:1;min-width:0"><div class="needst">${esc(a.name)}</div>${a.confirmed ? "" : '<div class="needsm" style="color:var(--gold)">Unconfirmed</div>'}</div>
        ${a.done ? '<span class="thdone">&#10003;</span>' : isAuto() ? `<button class="btn" data-ptscan="${esc(a.id)}">Scan</button>` : ""}</div>`).join("")}
    </div>`;
}

function phoneLaneBody(d) {
  const lane = phoneLane();
  if (lane === "autopilot") return phoneAutopilotLane(d);
  if (lane === "activity") return phoneCallsDashboard(d);
  if (lane === "notifications") return phoneNotificationsDashboard(d);
  return phoneTextsDashboard(d);
}

function heroStrip(cells) {
  return `<div class="panel hero">${cells.map(([n, l]) =>
    `<div><p class="n">${esc(String(n))}</p><p class="l">${esc(l)}</p></div>`).join("")}</div>`;
}

function phoneInboxLane(d) {
  const items = (d.needsYou || []).filter((i) => i.kind !== "unconfirmed");
  const appt = (d.needsYou || []).find((i) => i.kind === "unconfirmed");
  const total = d.needsYouTotal || 0;
  return `
    ${phoneNowCard(d)}
    ${items.length ? `<div class="panel flush">${items.map((it) => `
      <div class="prow" data-needs="${esc(it.id)}">
        <span class="needsdot" style="background:${NEEDS_TONE[it.tone] || "var(--cyan)"}"></span>
        <div style="flex:1;min-width:0">
          <div class="needst">${esc(it.title)}</div>
          ${it.detail ? `<div class="needsm">${esc(it.detail)}</div>` : ""}
          <div class="needsw">${esc(it.meta || "")}</div>
          ${it.number ? `<a class="pcallback" href="tel:${esc(it.number)}" data-needscall>&#128222; Call back</a>` : ""}
        </div>
        <button class="pdel" data-needsdel="${esc(it.id)}" aria-label="Delete">&times;</button>
        <span class="pchev">&rsaquo;</span></div>`).join("")}</div>
      ${total > items.length ? `<p class="sub" style="margin:8px 4px 0">Showing the ${items.length} that matter most — ${total} are waiting in total.</p>` : ""}`
      : appt ? "" : `<div class="panel" style="text-align:center;padding:26px">
           <p class="needst" style="margin:0 0 4px">All caught up</p>
           <p class="sub" style="margin:0">Nothing waiting on you.</p></div>`}
    ${appt ? `<p class="zonehead">TOMORROW</p>
      <div class="panel flush"><div class="prow" style="cursor:default">
        <span class="needsdot" style="background:var(--cyan)"></span>
        <div style="flex:1;min-width:0">
          <div class="needst">${esc(appt.title)}</div>
          <div class="needsm">${esc(appt.detail || "")}</div>
          <button class="btn em" id="remindall" style="margin-top:11px">Send them all a confirmation text</button>
        </div></div></div>` : ""}
    <div id="vmlane"></div>
    ${phoneJumpChip(d)}`;
}

// ---------------------------------------------------------------------------
// THE AUTOPILOT LANE (rebuilt 2026-08-31, Kyle override 1202)
// ---------------------------------------------------------------------------
//
// What was here: three unlabelled counters, five identical rows, and a line of
// text telling the owner how to use the screen. Three faults, and the third is
// the one that mattered.
//
//   The counters had no header. "0 / 46 / 2" over TEXTED BACK / ANSWERED /
//   BOOKED is three numbers with no shared subject — 46 answered *what*, out of
//   how many, compared to when?
//
//   Every row weighed the same. Front Desk answering 46 customers rendered
//   identically to Dispatcher sitting off, so the eye had no reason to stop on
//   either and stopped on neither.
//
//   And the screen explained itself: "Tap any line to turn it on or off." A
//   control that needs a caption is a control that lost. It is also two
//   controls saying one thing — an ON pill beside a TURN OFF button.
//
// What replaced it, in the order it reads:
//
//   THE ARMATURE. Five segments, one per system, lit or dark. A breaker panel
//   for the phone line: how much of it is live is a shape, not a sentence, and
//   a dark segment is a tap away from being lit.
//
//   ROWS SORTED BY WHAT BEING OFF IS COSTING. Anything dark with a measured
//   price floats to the top wearing an amber rail. An off switch that shows the
//   bill gets flipped; one showing a description gets scrolled past. Under it,
//   what is earning; under that, what is quiet. The server computes the rank
//   (see impact() in the phone function) so both faces sort identically — a
//   client sorting on parsed prose is a client that drifts.
//
//   A SPARKLINE ON EVERY SWITCH. Seven days of that system's own work. "46
//   answered" reads the same whether it was 46 on one frantic Monday or seven a
//   day — and those are different businesses.
//
//   THE PROOF TICKER. What it actually did, in sentences, timestamped. Every
//   autonomous reply Front Desk ever sent was already a row in the database and
//   was never once shown to the man paying for it. This is the difference
//   between trusting it and watching it.
//
// The switch is now a switch. Tap the row for the whole story, tap the toggle
// to flip it, and nothing has to say so out loud.

const PHONE_SYSTEM_CODE = {
  frontdesk: "DESK", dispatcher: "DISPATCH", "crew-reminders": "CREW",
  reminders: "APPTS", autoreply: "TEXTBACK",
};
// A system's own colour, fixed for life. The ticker keys on THIS, not on the
// row's current tone — a line that says "Nudged Mike about their shift" must
// not turn amber just because the switch happens to be off today. What a thing
// did is history; whether it is armed is state, and they are different facts.
const PHONE_SYSTEM_TONE = {
  frontdesk: "var(--cyan)", dispatcher: "var(--blue)", "crew-reminders": "var(--emerald)",
  reminders: "var(--gold)", autoreply: "var(--purple)",
};
const PHONE_TONE_VAR = { cost: "var(--gold)", live: "var(--emerald)", ready: "var(--cyan)", idle: "#39424f" };

// Rank first, then the loudest number inside a rank, then the server's own
// order so equal rows never shuffle between renders.
function phoneRankedAutomations(d) {
  const rows = (d.automations || []).map((x, i) => ({ ...x, _i: i }));
  return rows.sort((a, b) =>
    ((a.impact?.rank ?? 9) - (b.impact?.rank ?? 9)) || (a._i - b._i));
}

// THE ARMATURE. Five bars, lit or dark, each one a system and each one a tap.
// Deliberately not five toggles: this is the read, the rows below are the
// write. Mixing them would put two ways to do the same thing on one screen.
function phoneArmature(d) {
  const rows = d.automations || [];
  if (!rows.length) return "";
  return `<div class="panel armature">
    <div class="arow">${rows.map((r) => {
      const tone = PHONE_TONE_VAR[r.impact?.tone] || (r.enabled ? "var(--emerald)" : "#39424f");
      const costing = !r.enabled && r.impact?.tone === "cost";
      return `<button class="aseg${r.enabled ? " lit" : ""}${costing ? " cost" : ""}" data-auto="${esc(r.key)}"
        style="--seg:${tone}" aria-label="${esc(r.title)} ${r.enabled ? "on" : "off"}">
        <span class="abar"></span>
        <span class="acode">${esc(PHONE_SYSTEM_CODE[r.key] || r.key.slice(0, 4).toUpperCase())}</span>
      </button>`;
    }).join("")}</div>
  </div>`;
}

// Seven days of one system's work. Bars, not a line: a line implies a
// continuous quantity, and these are counts of discrete things that happened.
// An empty week draws a baseline rather than nothing, so the row keeps its
// shape and "it did nothing" stays a visible answer.
function phoneSpark(series, tone) {
  const values = Array.isArray(series) && series.length ? series : [0, 0, 0, 0, 0, 0, 0];
  const peak = Math.max(...values);
  // A week of nothing draws one flat rule. Seven 2px stubs read as dirt on the
  // screen — a deliberate baseline reads as an answer, which is what it is.
  if (peak <= 0) return `<span class="pspark flat" aria-hidden="true"></span>`;
  return `<span class="pspark" aria-hidden="true">${values.map((v, i) => {
    const today = i === values.length - 1;
    return `<i style="height:${v > 0 ? Math.max(11, Math.round((v / peak) * 100)) : 4}%;background:${v > 0 ? tone : "currentColor"};opacity:${v > 0 ? (today ? 1 : 0.6) : 0.22}"></i>`;
  }).join("")}</span>`;
}

function phoneAutopilotLane(d) {
 const rows=(d.automations||[]).slice().sort((a,b)=>PHONE_COMMAND_ORDER.indexOf(a.key)-PHONE_COMMAND_ORDER.indexOf(b.key));
 return `<div class="pcc-section-title"><div><span class="pcc-kicker">AUTOPILOT</span><h3>Your commands</h3></div><span class="pcc-count">${rows.filter(r=>r.enabled).length} active</span></div>
 <div class="pcc-command-grid">${rows.map(x=>`<article class="pcc-command ${x.enabled?'is-on':''} ${x.key==='google-review-request'?'is-review':''}">
   <div class="pcc-command-top"><button class="pcc-command-open" data-auto="${esc(x.key)}"><span class="pcc-glyph" aria-hidden="true">${phoneCommandIcon(x.key)}</span><strong>${esc(x.title)}</strong></button>
   <button class="pswx${(phonePendingSave?.key===x.key?phonePendingSave.enabled:x.enabled)?' on':''}" data-autotoggle="${esc(x.key)}" role="switch" aria-checked="${!!(phonePendingSave?.key===x.key?phonePendingSave.enabled:x.enabled)}" aria-label="${esc(x.title)}" ${phonePendingSave?'disabled':''} ${phonePendingSave?.key===x.key?'aria-busy="true"':''}><i></i></button></div>
   ${phonePendingSave?.key===x.key?'<span class="command-save-status" role="status">Saving…</span>':''}
   <button class="pcc-command-detail" data-auto="${esc(x.key)}"><span>${esc(x.result).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')}</span>
   <div class="pcc-command-bottom"><small><i class="${x.enabled?'active':''}"></i>${esc(x.impact?.headline || (x.enabled?'On':'Off'))}</small>${phoneSpark(x.series,'var(--cyan)')}<span aria-hidden="true">↗</span></div></button>
 </article>`).join('')}</div>${phoneAutopilotFeed(d)}`;
}

// THE PROOF TICKER. Grouped by day, newest first, and every line is a sentence
// an owner can check against his own memory of that day. Being challengeable is
// the whole value of showing it — "frontdesk.booked" is a log line, "Booked Dan
// R. in" is a claim he can catch me on.
function phoneAutopilotFeed(d) {
  const feed = d.autopilotFeed || [];
  if (!feed.length) {
    return `<p class="zonehead">WHAT IT DID</p>
      <div class="panel" style="text-align:center;padding:22px">
        <p class="sub" style="margin:0">Nothing has run on its own yet. Every text your line sends without you shows up here, with the time it went.</p>
      </div>`;
  }
  const today = localDay();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA");
  let lastDay = "";
  const lines = feed.map((row) => {
    const when = new Date(row.at);
    const day = when.toLocaleDateString("en-CA");
    const head = day === lastDay ? "" :
      `<p class="ptickday">${day === today ? "TODAY" : day === yesterday ? "YESTERDAY"
        : esc(when.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }).toUpperCase())}</p>`;
    lastDay = day;
    const tone = PHONE_SYSTEM_TONE[row.key] || "var(--cyan)";
    return `${head}<div class="ptick" style="--tone:${tone}">
      <span class="ptickt">${esc(when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s/g, ""))}</span>
      <span class="ptickdot"></span>
      <span class="ptickx">${esc(row.text)}</span></div>`;
  }).join("");
  return `<p class="zonehead">WHAT IT DID</p><div class="panel pticker">${lines}</div>`;
}

function phoneActivityLane(d) {
  // Same order as the iPhone's Today lane: the day's numbers (people) first,
  // then the Lead Pipeline, today's bays, what happened, and the line's own
  // settings last. A live lead never sits under a history (Kyle 2026-08-27).
  return `
    ${phoneDayStrip(d)}
    <div id="phoneleads"><div class="skel"></div></div>
    ${phoneTodayCard(d)}
    <p class="zonehead">WHAT HAPPENED</p>
    ${phoneThreadsPanel(d)}
    ${phoneFeedPanel(d)}
    <p class="zonehead">YOUR LINE</p>
    ${phoneSettingsSummary(d)}`;
}

const NEEDS_TONE = { urgent: "var(--red)", warn: "var(--gold)", info: "var(--cyan)" };

function needsYouZone(d) {
  const items = d.needsYou || [];
  if (!items.length) {
    return `<p class="zonehead">NEEDS YOU</p>
      <div class="panel" style="text-align:center;padding:22px">
        <p class="sub" style="margin:0">Nothing waiting on you. Every call, text and voicemail has been handled.</p>
      </div>`;
  }
  return `<p class="zonehead hot">NEEDS YOU · ${items.length}</p>
    ${items.map((it) => `<div class="needsrow" data-needs="${esc(it.id)}">
      <span class="needsdot" style="background:${NEEDS_TONE[it.tone] || "var(--cyan)"}"></span>
      <div style="min-width:0">
        <div class="needst">${esc(it.title)}</div>
        ${it.detail ? `<div class="needsm">${esc(it.detail)}</div>` : ""}
        <div class="needsw">${esc(it.meta)}</div>
      </div></div>`).join("")}`;
}

function automationsZone(d) {
  const rows = d.automations || [];
  if (!rows.length) return "";
  // The result line carries **bold** for the number that should land first.
  const render = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--gold)">$1</b>');
  return `<p class="zonehead">RUNNING FOR YOU</p>
    <div class="panel" style="padding:0;overflow:hidden">
      ${rows.map((a, i) => `<div class="autorow" data-auto="${esc(a.key)}" style="${i ? "" : "border-top:0"}">
        <span class="needsdot" style="margin-top:6px;background:${a.enabled ? "var(--emerald)" : "#4a5563"}"></span>
        <div style="flex:1;min-width:0">
          <div class="needst">${esc(a.title)} <span class="pill ${a.enabled ? "live" : ""}">${a.enabled ? "ON" : "OFF"}</span></div>
          <div class="needsm">${render(a.result)}</div>
        </div>
        <span style="color:var(--dim2)">&rsaquo;</span></div>`).join("")}
    </div>`;
}

// A row is a shortcut to the thing it is about, never a dead end.
function openNeedsYou(d, id) {
  const item = (d.needsYou || []).find((x) => x.id === id);
  if (!item) return;
  if (item.kind === "voicemail") { const ev = (d.events || []).find((e) => "vm:" + e.id === id); if (ev) phoneEventSheet(ev); return; }
  if (item.kind === "missed") { const ev = (d.events || []).find((e) => "mc:" + e.id === id); if (ev) phoneEventSheet(ev); return; }
  if (item.kind === "text") { const t = (d.threads || []).find((x) => "tx:" + x.id === id); if (t) phoneThreadSheet(t); return; }
  if (item.kind === "unconfirmed") apptReminderPreviewSheet();
}

// Tapping a row opens the whole automation — what it did, the on/off switch,
// and its own settings. The switch has to live here now that the two fat cards
// that used to carry it are gone.
function openAutomation(d, key) {
  if(key === "google-review-request") return reviewRequestSheet(d);
  const a = (d.automations || []).find((x) => x.key === key);
  if (!a) return;
  const render = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--gold)">$1</b>');
  const extra = {
    frontdesk: '<button class="btn" id="autoset">Settings</button><button class="btn" id="autolog">What it did</button>',
    reminders: '<button class="btn" id="autoprev">See tonight\'s list</button><button class="btn" id="autoset">Change time</button>',
    autoreply: '<button class="btn" id="autoset">Wording &amp; hours</button>',
    dispatcher: '<button class="btn" id="autoorder">Dispatch order</button>',
    "crew-reminders": '<button class="btn" id="autocrewlist">Your reminders</button><button class="btn" id="autocrewhours">Crew hours</button><button class="btn" id="autocrewshifts">Clock-out timing</button>',
    "on-my-way": '<button class="btn" id="autocrewmap">Live crew map</button>',
  }[key] || "";
  const blurb = {
    frontdesk: "When a missed caller texts back, Ledger answers them — quoting your real QuickBooks prices and offering real open times. It can never invoice, take a payment or discuss a bill.",
    reminders: "The night before, everyone booked in gets a text asking them to confirm or say they need to move it. Each customer is texted once per appointment, ever.",
    autoreply: "A missed call gets an instant text back so the caller knows you exist and can reply.",
    dispatcher: "New bookings text your first-call crew member their job from the business line, and you can tell Ledger to dispatch anyone by name. It can only ever text people on your crew roster.",
    "crew-reminders": "Two things. After a crew member's shift ends, anyone still clocked in gets a text — replying DONE clocks them out. And any reminder you write yourself goes out from the business line at the time you set it. Each punch is nudged once, each reminder sends once a day, and only people on your roster can ever be texted.",
    "on-my-way": "The moment a crew member taps ON MY WAY on their job link, the customer on that booking gets one text from your business line: who is coming, an arrival time worked out from where the crew member actually is, and a link to a page that follows the job — on the way, arrived, done. They get one more text when the crew member marks ON SITE and one when the job is DONE (with your review link if that's the only review lane you have on). One text of each kind per job, never a second, and the crew member sees on their link whether it actually went. Needs the customer's number on the booking.",
  }[key] || "";
  sheet(`<h2>${esc(a.title)} ${a.enabled ? '<span class="pill live">ON</span>' : '<span class="pill">OFF</span>'}</h2>
    <p class="sub">${render(a.result)}</p>
    <p class="note" style="margin-top:10px">${esc(blurb)}</p>
    <div class="rowbtns" style="margin-top:16px">${extra}</div>
    <div class="rowbtns" style="margin-top:8px">
      <button class="btn ${a.enabled ? "" : "em"}" id="autotoggle">${a.enabled ? "Turn off" : "Turn on"}</button>
    </div>`, (sh) => {
    const set = sh.querySelector("#autoset"), log = sh.querySelector("#autolog"), prev = sh.querySelector("#autoprev");
    if (set) set.onclick = () => { closeSheet(); key === "frontdesk" ? frontDeskSheet(d) : key === "reminders" ? apptReminderSheet(d) : phoneSettingsSheet(d); };
    if (log) log.onclick = () => { closeSheet(); frontDeskLogSheet(); };
    if (prev) prev.onclick = () => { closeSheet(); apptReminderPreviewSheet(); };
    const order = sh.querySelector("#autoorder");
    if (order) order.onclick = () => { closeSheet(); dispatchOrderSheet(); };
    const crewHours = sh.querySelector("#autocrewhours");
    if (crewHours) crewHours.onclick = () => { closeSheet(); crewHoursSheet(); };
    const crewShifts = sh.querySelector("#autocrewshifts");
    if (crewShifts) crewShifts.onclick = () => { closeSheet(); crewTimingSheet(d); };
    const crewList = sh.querySelector("#autocrewlist");
    if (crewList) crewList.onclick = () => { closeSheet(); crewRemindersSheet(); };
    const crewMap = sh.querySelector("#autocrewmap");
    if (crewMap) crewMap.onclick = () => { closeSheet(); crewLiveMapSheet(); };
    sh.querySelector("#autotoggle").onclick = () => { closeSheet(); toggleAutomation(d, key); };
  });
}

// ONE flip, two callers. The switch on the Autopilot row and the button inside
// the automation's own sheet have to do exactly the same thing, including the
// two follow-up prompts — a switch that behaves differently depending on where
// you touched it is a bug waiting for the day you touch the other one.
// One outstanding automation save per board. Paint immediately, reuse the saved
// response, and invalidate reads started before the user's mutation.
let phonePendingSave = null;
async function savePhoneSwitch(d, key, enabled, payload) {
  if (phonePendingSave) return false;
  const pending = phonePendingSave = {key, enabled};
  S.phoneRequest = (S.phoneRequest || 0) + 1;
  const buttons = [...document.querySelectorAll('[data-autotoggle]')];
  const button = buttons.find(b => b.dataset.autotoggle === key);
  const previous = button?.getAttribute('aria-checked');
  buttons.forEach(b => b.disabled = true);
  let status;
  if (button) {
    button.classList.toggle('on', enabled); button.setAttribute('aria-checked', String(enabled));
    button.setAttribute('aria-busy','true');
    status = document.createElement('span'); status.className='command-save-status'; status.setAttribute('role','status');
    status.textContent='Saving…'; button.closest('.pcc-command').append(status);
  }
  try {
    const saved = await api('/phone', payload);
    S.phoneRequest = (S.phoneRequest || 0) + 1;
    S.phone = saved;
    phonePendingSave = null;
    if (S.tab === 'phone') {
      const scroller = view(); const y = scroller?.scrollTop || 0;
      await renderPhone(saved);
      if (scroller) scroller.scrollTop = y;
    }
    return true;
  } catch (error) {
    if (button?.isConnected) { button.classList.toggle('on', previous === 'true'); button.setAttribute('aria-checked',previous); }
    toast("Couldn't confirm the change. " + error.message, 'err');
    return false;
  } finally {
    if (phonePendingSave === pending) phonePendingSave = null;
    buttons.forEach(b => b.disabled = false); button?.removeAttribute('aria-busy'); status?.remove();
    if (S.tab === 'phone') document.querySelectorAll('[data-autotoggle]').forEach(b=>{
      b.disabled=false; b.removeAttribute('aria-busy');
      const enabled=(S.phone?.automations||[]).find(r=>r.key===b.dataset.autotoggle)?.enabled===true;
      b.classList.toggle('on',enabled); b.setAttribute('aria-checked',String(enabled));
    });
    document.querySelectorAll('.command-save-status').forEach(e=>e.remove());
  }
}

async function toggleAutomation(d, key) {
  if (phonePendingSave) return;
  d = S.phone || d;
  const row = (d.automations || []).find(x => x.key === key);
  if (key === 'frontdesk') return toggleFrontDesk(d);
  if (key === 'reminders') return toggleApptReminders(d);
  const enabled = !(row?.enabled ?? (key === 'crew-reminders' ? d.crewReminderEnabled === true : key === 'dispatcher' ? d.dispatcherEnabled === true : key === 'on-my-way' ? d.onMyWayEnabled === true : d.autoReplyEnabled !== false));
  if (key === 'google-review-request' && enabled && !d.reviewRequests?.url) return reviewRequestSheet(d);
  const field = {'google-review-request':'reviewRequestsEnabled','crew-reminders':'crewReminderEnabled',dispatcher:'dispatcherEnabled',autoreply:'autoReplyEnabled','on-my-way':'onMyWayEnabled'}[key];
  if (!field) return;
  const saved = await savePhoneSwitch(d,key,enabled,{action:key === 'google-review-request' ? 'review-settings-save' : 'settings-save',[field]:enabled});
  if (!saved) return;
  toast((row?.title || 'Command') + (enabled ? ' is on' : ' is off'));
  if (enabled && ['dispatcher','crew-reminders'].includes(key)) {
    try {
      const roster = await api('/crew',{action:'list'});
      if (S.tab !== 'phone' || phonePendingSave || (S.phone?.automations || []).find(x=>x.key===key)?.enabled !== true) return;
      const crew = (roster.employees || []).filter(e=>e.active !== false);
      if (key === 'dispatcher' && crew.filter(e=>(e.phone||'').trim()).length >= 2) dispatchOrderSheet(crew.filter(e=>(e.phone||'').trim()));
      if (key === 'crew-reminders' && !crew.some(e=>e.workEnd)) { toast('Set shift hours on the roster so Ledger knows when shifts end'); crewRosterSheet(); }
    } catch (error) { toast('Saved. Could not check the crew roster — open Crew to check dispatch order and shift hours.','err'); }
  }
}

function reviewRequestSheet(d) {
 const r=d.reviewRequests||{};
 sheet(`<div class="pcc-kicker">REPUTATION · ON AUTOPILOT</div><h2>Google Review Request</h2>
 <p class="sub">A thoughtful follow-up, without another thing on your list.</p>
 <div class="pcc-journey"><span>Invoice paid</span><b>→</b><span>Thank-you text</span><b>→</b><span>Google review</span></div>
 <p class="note">After a Ledger or QuickBooks invoice is fully paid, Ledger texts the customer once from your business number. Future payments only. Sends between 8am and 8pm in your business’s time zone, using your texting allowance. Customers can reply STOP.</p>
 <label class="pcc-field">Your Google review link<input id="review-url" type="url" value="${esc(r.url||'')}" placeholder="Paste your Google ‘Ask for reviews’ link" autocomplete="off"></label>
 <p class="sub">${r.url?'Your business’s link is ready.':'In Google Business Profile, choose Ask for reviews → Copy link.'}</p>
 ${r.preview?`<details class="pcc-preview"><summary>Message preview</summary><p>${esc(r.preview)}</p></details>`:''}
 ${r.error?`<p class="note" role="alert">${esc(r.error)}</p>`:''}
 <div class="rowbtns"><button class="btn em" id="review-save">${r.enabled?'Save link':'Save & turn on'}</button>${r.enabled?'<button class="btn" id="review-off">Turn off</button>':''}</div>
 <h3 style="margin-top:24px">Recent requests</h3>
 <p class="sub">${r.sentWeek||0} sent this week · ${r.queued||0} waiting</p>
 ${(r.recent||[]).map(x=>`<div class="pcc-history"><strong>${esc(x.customer_name||'Customer')} · ${esc(x.invoice_number||'Invoice')}</strong><span>${esc({sent:'Sent',queued:'Waiting',sending:'Sending',skipped:'Skipped',needs_check:'Check delivery'}[x.status]||x.status)} · ${x.source==='native'?'Ledger invoices':'QuickBooks'}</span>${x.reason?`<small>${esc(x.reason)}</small>`:''}</div>`).join('')||'<p class="sub">Your first request will appear here after a future payment. No old invoices will be texted.</p>'}`,sh=>{
 const save=sh.querySelector('#review-save');save.onclick=async()=>{save.disabled=true;save.textContent='Saving…';try{await api('/phone',{action:'review-settings-save',reviewURL:sh.querySelector('#review-url').value,reviewRequestsEnabled:true});closeSheet();toast('Google Review Request is on');renderPhone();}catch(e){toast(friendlyError(e, "Couldn't save your review link. Try again."),'err');save.disabled=false;save.textContent=r.enabled?'Save link':'Save & turn on';}};
 const off=sh.querySelector('#review-off');if(off)off.onclick=async()=>{off.disabled=true;try{await api('/phone',{action:'review-settings-save',reviewRequestsEnabled:false});closeSheet();toast('Review requests are off');renderPhone();}catch(e){toast(friendlyError(e, "Couldn't turn review requests off. Try again."),'err');off.disabled=false;}};
 });
}

// Dispatcher: standing dispatch order. 1 = first call. Arrows, not drag —
// works the same with a thumb on a phone and a mouse on a laptop.
async function dispatchOrderSheet(preloaded) {
  let crew = preloaded;
  if (!crew) {
    try {
      const roster = await api("/crew", { action: "list" });
      crew = (roster.employees || []).filter((e) => e.active !== false && (e.phone || "").trim());
    } catch (err) { toast(friendlyError(err, "Couldn't load your crew. Try again."), "err"); return; }
  }
  if (!crew.length) { toast("No crew members with phone numbers yet — add them on the Calendar tab first."); return; }
  crew = crew.slice().sort((a, b) => (a.dispatchRank ?? a.dispatch_rank ?? 9999) - (b.dispatchRank ?? b.dispatch_rank ?? 9999));
  const wrap = sheet(`<h2>Dispatch order</h2>
    <p class="sub">Who gets the job first. When a booking lands with nobody assigned, <b>1st call</b> gets the text.</p>
    <div id="dorder"></div>
    <button class="btn em wide" style="margin-top:14px" id="dsave">Save order</button>
    <div class="note" id="dnote" style="margin-top:8px"></div>`);
  const paint = () => {
    wrap.querySelector("#dorder").innerHTML = crew.map((e, i) => `
      <div class="item" style="display:flex;align-items:center;gap:10px;padding:11px 4px">
        <b style="color:var(--cyan);min-width:52px;font-family:var(--mono);font-size:11px">${i === 0 ? "1ST CALL" : (i + 1) + (i === 1 ? "ND" : i === 2 ? "RD" : "TH")}</b>
        <span style="flex:1"><b>${esc(e.name)}</b><br><small style="color:var(--dim)">${esc(e.phone || "")}</small></span>
        <button class="pillbtn" data-dup="${i}" ${i === 0 ? "disabled" : ""}>&#8593;</button>
        <button class="pillbtn" data-ddn="${i}" ${i === crew.length - 1 ? "disabled" : ""}>&#8595;</button>
      </div>`).join("");
    wrap.querySelectorAll("[data-dup]").forEach((b) => b.onclick = () => { const i = Number(b.dataset.dup); [crew[i - 1], crew[i]] = [crew[i], crew[i - 1]]; paint(); });
    wrap.querySelectorAll("[data-ddn]").forEach((b) => b.onclick = () => { const i = Number(b.dataset.ddn); [crew[i], crew[i + 1]] = [crew[i + 1], crew[i]]; paint(); });
  };
  paint();
  wrap.querySelector("#dsave").onclick = async (e) => {
    e.currentTarget.disabled = true;
    const note = wrap.querySelector("#dnote");
    try {
      await api("/phone", { action: "dispatch-order", employee_ids: crew.map((c) => c.id) });
      toast("Dispatch order saved");
      closeSheet();
    } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
  };
}

/* ---------------- CREW (2026-08-31) — hours view, roster & shifts --------- */
// The web twin of iOS Crew Command's Time Cards: every employee's punches,
// daily totals and overtime for a range, plus roster shift hours (which drive
// the Crew Reminders clock-out nudge) and the workspace overtime rules.

const CREW_DAY_LABELS = [["mon", "M"], ["tue", "T"], ["wed", "W"], ["thu", "T"], ["fri", "F"], ["sat", "S"], ["sun", "S"]];
const crewH = (sec) => `${(Math.round((sec || 0) / 360) / 10).toFixed(1)}h`;
const crewT = (iso) => iso ? new Date(iso).toLocaleTimeString(undefined, { timeZone: S.businessTimezone || "UTC", hour: "numeric", minute: "2-digit" }) : "—";

function crewShiftLabel(e) {
  if (!e.workStart && !e.workEnd) return "No shift set";
  const days = (e.workDays || []).map((d) => d[0].toUpperCase() + d.slice(1, 3)).join(" ");
  return `${e.workStart || "?"}–${e.workEnd || "?"}${days ? " · " + days : ""}`;
}

function crewRangeDates(range) {
  const day = businessDay();
  const today = new Date(day + "T12:00:00Z");
  const shift = (by) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10); };
  const monday = -((today.getUTCDay() + 6) % 7);
  if (range === "today") return [day, day];
  if (range === "week") return [shift(monday), shift(monday + 6)];
  if (range === "last-week") return [shift(monday - 7), shift(monday - 1)];
  return [day.slice(0, 8) + "01", day];
}
function crewCsv(d) {
  const cell = (v) => { let text = String(v ?? ""); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
  const local = (v) => v ? new Date(v).toLocaleString("en-CA", {timeZone:d.timezone || "UTC",hour12:false}) : "";
  const rows = [["Employee","Date","Clock in","Clock out","Hours","Regular hours","Overtime hours","Status","Corrected","Note","Timezone"]];
  for (const c of d.cards || []) {
    for (const day of c.days || []) for (const p of day.punches || []) rows.push([c.name,day.date,local(p.in),local(p.out),p.needs_review || !p.out ? "" : (p.seconds / 3600).toFixed(4),"","",p.needs_review ? "Needs correction" : !p.out ? "On the clock — provisional" : "Complete",p.corrected ? "yes" : "",p.review_note || p.note || "",d.timezone]);
    rows.push([c.name,"TOTAL","","",(c.total_seconds/3600).toFixed(4),(c.regular_seconds/3600).toFixed(4),(c.ot_seconds/3600).toFixed(4),c.needs_review ? "Needs correction" : c.on_clock ? "Provisional" : "Complete","","",d.timezone]);
  }
  return rows.map(r=>r.map(cell).join(",")).join("\r\n");
}

const CREW_RANGES = [["today", "TODAY"], ["week", "THIS WEEK"], ["last-week", "LAST WEEK"], ["month", "MONTH"]];

/** The always-drawn strip under the total: Mon–Sun for week views, one bar for Today, one per week for Month. */
function crewStrip(d, range, from, to) {
  const perDay = {};
  for (const c of d.cards || []) for (const day of c.days || []) perDay[day.date] = (perDay[day.date] || 0) + (day.seconds || 0);
  const today = businessDay();
  const addDays = (iso, n) => { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let days = [];
  if (range === "today") days = [{ id: from, label: "TODAY", seconds: perDay[from] || 0, today: true }];
  else if (range === "month") {
    let cursor = from, week = 1;
    while (cursor <= to && week <= 6) {
      const stop = addDays(cursor, 6) < to ? addDays(cursor, 6) : to;
      let secs = 0, hasToday = false;
      for (let x = cursor; x <= stop; x = addDays(x, 1)) { secs += perDay[x] || 0; if (x === today) hasToday = true; }
      days.push({ id: "w" + week, label: "WK " + week, seconds: secs, today: hasToday });
      cursor = addDays(cursor, 7); week += 1;
    }
  } else {
    const names = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    days = names.map((n, i) => { const k = addDays(from, i); return { id: k, label: n, seconds: perDay[k] || 0, today: k === today }; });
  }
  const peak = Math.max(...days.map((x) => x.seconds), 1);
  return `<div class="cstrip">${days.map((x) => `<div class="cday${x.today ? " today" : ""}"><div class="ccol">${x.seconds ? `<i style="height:${Math.max(4, Math.round(54 * x.seconds / peak))}px"></i>` : (x.today ? '<i class="base"></i>' : "")}</div><span>${x.label}</span></div>`).join("")}</div>`;
}

async function crewHoursSheet(range = "week") {
  const [from, to] = crewRangeDates(range);
  let d;
  try { d = await api("/crew", { action: "timecards", from, to }); }
  catch (err) { toast(friendlyError(err, "Couldn't load the timecards. Try again."), "err"); return; }
  if (d.timezone) S.businessTimezone = d.timezone;
  const all = d.cards || [];
  const cards = all.filter((c) => c.total_seconds > 0 || c.on_clock || c.needs_review);
  const total = all.reduce((s, c) => s + (c.total_seconds || 0), 0), onClock = all.filter((c) => c.on_clock).length;
  const otBits = [];
  if (d.ot_daily_hours != null) otBits.push(`over ${d.ot_daily_hours}h/day`);
  if (d.ot_weekly_hours != null) otBits.push(`over ${d.ot_weekly_hours}h/week`);
  const otLabel = otBits.length ? `Overtime counts hours ${otBits.join(" or ")}.` : "Overtime tracking is off.";
  const rangeWord = (CREW_RANGES.find(([k]) => k === range) || [])[1] || "";
  sheet(`<div class="chead">${crewKicker("TIME CARDS", "emerald")}<h2>Clock-in hours</h2></div>
    <div class="chips crise" style="--i:0">${CREW_RANGES.map(([k, l]) => `<button type="button" class="chip cchipe${k === range ? " on" : ""}" data-crange="${k}">${l}</button>`).join("")}</div>
    <div class="chero col crise${total || onClock ? " lit" : ""}" style="--i:1;--sig:${crewRgb(total || onClock ? "emerald" : "silver")}">
      <div class="chtop">
        <div>${crewKicker(`TOTAL HOURS · ${rangeWord}`, total ? "emerald" : "silver", onClock > 0)}<span class="ctnum big${total ? "" : " quiet"}"><b>${crewHours(total)}</b></span></div>
        ${crewPill(onClock ? `${onClock} ON THE CLOCK` : "NOBODY ON THE CLOCK", onClock ? "gold" : "silver", onClock > 0)}
      </div>
      ${crewStrip(d, range, from, to)}
    </div>
    ${cards.length ? cards.map((c, i) => `
      <div class="ctime crise" style="--i:${Math.min(2 + i, 9)};--sig:${crewRgb(c.on_clock ? "gold" : c.color_tag)}">
        <div class="crtop">
          ${crewSigil(c.name, c.color_tag, 40, c.on_clock ? "amber" : null)}
          <span class="ccbody"><b>${esc(c.name)}</b>
            <span class="ccm ${c.on_clock ? "amber" : ""}">${c.on_clock ? `<i class="cld"></i>ON THE CLOCK · SINCE ${esc(crewT(c.open_since)).toUpperCase()}` : "OFF THE CLOCK"}</span></span>
          <span class="ctnum right"><b>${crewHours(c.total_seconds)}</b></span>
        </div>
        ${c.ot_seconds > 0 ? `<div class="ccm" style="margin-top:8px">REG ${crewHours(c.regular_seconds).toUpperCase()} <span class="cchip" style="--sig:${CREW_RGB.gold}">OT ${crewHours(c.ot_seconds).toUpperCase()}</span></div>` : ""}
        ${(c.days || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map((day) => `
          <div class="cdayrow"><span class="ccm">${esc(day.date)}</span>${day.punches.some((p) => p.needs_review) ? '<span class="cchip" style="--sig:248,113,113">NEVER CLOCKED OUT</span>' : day.punches.some((p) => p.corrected) ? '<span class="cchip" style="--sig:58,200,245">CORRECTED</span>' : ""}<span class="cdayh">${crewHours(day.seconds)}</span></div>
          ${(day.punches || []).map((p) => `<p class="note cpunch">${crewT(p.in)} → ${p.needs_review ? "<b>needs correction — hours not counted</b>" : p.out ? crewT(p.out) : "<b>still on the clock — provisional</b>"}${p.review_note || p.note ? " · " + esc(p.review_note || p.note) : ""}</p>`).join("")}
        `).join("")}
      </div>`).join("")
      : `<div class="cghost crise" style="--i:2">${all.length ? "No hours yet — they land here the moment crew tap Clock in on their job link." : "No crew members yet — add them under Roster &amp; shifts."}</div>`}
    <p class="note" style="margin-top:12px">${esc(otLabel)}</p>
    <div class="rowbtns" style="margin-top:10px">
      <button class="btn ghost" id="crewroster">Roster &amp; shifts</button>
      <button class="btn ghost" id="crewot">Overtime rules</button>
      ${cards.length ? '<button class="btn ghost" id="crewcsv">Export CSV</button>' : ""}
    </div>`, (sh) => {
    sh.classList.add("crewsheet");
    on("[data-crange]", "click", (e) => { closeSheet(); crewHoursSheet(e.currentTarget.dataset.crange); }, sh);
    sh.querySelector("#crewroster").onclick = () => { closeSheet(); crewRosterSheet(); };
    sh.querySelector("#crewot").onclick = () => { closeSheet(); crewOtSheet(d, range); };
    const csv = sh.querySelector("#crewcsv");
    if (csv) csv.onclick = () => {
      const blob = new Blob([crewCsv(d)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `crew-hours-${from}-to-${to}.csv`; a.click();
      URL.revokeObjectURL(a.href);
    };
  });
}

function crewOtSheet(d, backRange) {
  sheet(`<h2>Overtime rules</h2>
    <p class="sh-sub">Hours past these thresholds count as overtime on every time card. Leave a box blank to turn that rule off.</p>
    <label class="fld" style="margin-top:12px">DAILY — OT AFTER THIS MANY HOURS IN A DAY</label>
    <input id="otdaily" class="cmpinput" type="number" min="1" max="24" step="0.5" value="${d.ot_daily_hours ?? ""}" placeholder="off">
    <label class="fld" style="margin-top:10px">WEEKLY — OT AFTER THIS MANY HOURS IN A WEEK</label>
    <input id="otweekly" class="cmpinput" type="number" min="1" max="168" step="0.5" value="${d.ot_weekly_hours ?? ""}" placeholder="off">
    <p class="note" style="margin-top:8px">Alberta's rules are 8 daily / 44 weekly — the starting defaults.</p>
    <button class="btn em wide" style="margin-top:13px" id="otsave">Save</button>
    <div class="note" id="otnote" style="margin-top:8px"></div>`, (sh) => {
    sh.querySelector("#otsave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      const note = sh.querySelector("#otnote");
      try {
        await api("/crew", {
          action: "set-ot-rules",
          daily_hours: sh.querySelector("#otdaily").value.trim(),
          weekly_hours: sh.querySelector("#otweekly").value.trim(),
        });
        toast("Overtime rules saved");
        closeSheet();
        crewHoursSheet(backRange || "week");
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

// ---- Crew availability (Kyle 2026-08-31) ---------------------------------
// The crew flip their own pill on their link. This is the owner's view of the
// same table: who is off right now, who is off next week, and the ability to
// book or cancel it for someone who phoned in instead of tapping.
const ABSENCE_LABELS = { sick: "Sick", appointment: "Appointment", personal: "Personal", "time-off": "Time off" };
const ABSENCE_SPANS = [
  ["today", "Today"],
  ["today-tomorrow", "Today + tomorrow"],
  ["tomorrow", "Tomorrow"],
  ["week", "This week"],
];

function absenceDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Always ends with when they are back — an absence with no visible end is the
// thing this whole feature exists to prevent.
function absenceLine(a) {
  if (!a) return "";
  const label = ABSENCE_LABELS[a.reason] || "Off";
  const back = new Date(`${a.endOn}T12:00:00`);
  back.setDate(back.getDate() + 1);
  const backLabel = isNaN(back.getTime()) ? "" : ` · back ${back.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`;
  const span = a.startOn === a.endOn ? absenceDay(a.startOn) : `${absenceDay(a.startOn)}\u2013${absenceDay(a.endOn)}`;
  const who = a.source === "self" ? "called in" : "booked off";
  return `${label} · ${span}${backLabel} · ${who}`;
}

async function crewRosterSheet() {
  let roster;
  try { roster = await api("/crew", { action: "list" }); }
  catch (err) { toast(friendlyError(err, "Couldn't load your crew. Try again."), "err"); return; }
  const crew = roster.employees || [];
  sheet(`<h2>Roster &amp; shifts</h2>
    <p class="sh-sub">Regular working hours drive both shift texts — no shift set means no reminders for that person. Anyone marked off is skipped by the reminders and by auto-dispatch.</p>
    ${crew.length ? `<div class="panel" style="padding:0;overflow:hidden;margin-top:10px">
      ${crew.map((e, i) => `<div class="autorow" data-crewid="${esc(e.id)}" style="${i ? "" : "border-top:0"}">
        <div style="flex:1;min-width:0">
          <div class="needst">${esc(e.name)} ${e.active === false ? '<span class="pill">INACTIVE</span>' : ""}${e.absence ? '<span class="pill" style="border-color:rgba(248,113,113,.5);color:#f87171">OFF TODAY</span>' : ""}</div>
          <div class="needsm">${e.absence ? esc(absenceLine(e.absence)) : (e.upcomingAbsence ? esc(`Off ${absenceDay(e.upcomingAbsence.startOn)}`) + " · " + esc(crewShiftLabel(e)) : esc(e.phone || "no phone") + " · " + esc(crewShiftLabel(e)))}</div>
        </div>
        <span style="color:var(--dim2)">&rsaquo;</span></div>`).join("")}
    </div>` : '<div class="panel" style="margin-top:10px;text-align:center"><p class="sub" style="margin:0">No crew members yet.</p></div>'}
    <div class="rowbtns" style="margin-top:12px">
      <button class="btn em" id="crewadd">&#43; Add crew member</button>
      <button class="btn" id="crewhoursback">Crew hours</button>
    </div>`, (sh) => {
    on("[data-crewid]", "click", (e) => {
      const emp = crew.find((x) => x.id === e.currentTarget.dataset.crewid);
      if (emp) { closeSheet(); crewMemberSheet(emp); }
    }, sh);
    sh.querySelector("#crewadd").onclick = () => { closeSheet(); crewMemberSheet(null); };
    sh.querySelector("#crewhoursback").onclick = () => { closeSheet(); crewHoursSheet(); };
  });
}

function crewMemberSheet(emp) {
  const days = new Set(emp?.workDays || ["mon", "tue", "wed", "thu", "fri"]);
  sheet(`<h2>${emp ? esc(emp.name) : "New crew member"}</h2>
    <label class="fld" style="margin-top:10px">NAME</label>
    <input id="cmName" class="cmpinput" value="${esc(emp?.name || "")}">
    <label class="fld" style="margin-top:10px">PHONE — WHERE THEIR TEXTS GO</label>
    <input id="cmPhone" class="cmpinput" inputmode="tel" value="${esc(emp?.phone || "")}">
    <label class="fld" style="margin-top:10px" for="cmEmail">PERSONAL EMAIL</label>
    <input id="cmEmail" class="cmpinput" type="email" value="${esc(emp?.email || "")}">
    <label class="fld" style="margin-top:10px" for="cmWorkEmail">WORK EMAIL — USED FIRST FOR DISPATCH</label>
    <input id="cmWorkEmail" class="cmpinput" type="email" value="${esc(emp?.workEmail || "")}">
    <p class="note">Work email is preferred. Personal email is used when work email is blank. Crew links do not add an owner login.</p>
    <label class="fld" style="margin-top:12px">REGULAR SHIFT — DRIVES BOTH SHIFT TEXTS</label>
    <div class="timerow" style="margin-top:6px">
      <input type="time" id="cmStart" value="${esc(emp?.workStart || "")}">
      <span class="note">to</span>
      <input type="time" id="cmEnd" value="${esc(emp?.workEnd || "")}">
    </div>
    <div class="daypick" style="margin-top:10px">
      ${CREW_DAY_LABELS.map(([k, l]) => `<button class="daybtn ${days.has(k) ? "on" : ""}" data-cmday="${k}" type="button">${l}</button>`).join("")}
    </div>
    <p class="note" style="margin-top:6px">Clear both times to turn their shift texts off. Start time drives the clock-in link, end time the clock-out nudge.</p>
    ${emp ? `<label class="fld" style="margin-top:14px">TIME OFF</label>
    ${emp.absence ? `<div class="panel" style="margin-top:6px">
      <p class="sub" style="margin:0">${esc(absenceLine(emp.absence))}</p>
      <button class="btn wide" style="margin-top:9px" id="cmAbsCancel">Cancel this time off</button>
    </div>` : `<div class="panel" style="margin-top:6px">
      <p class="sub" style="margin:0 0 8px">Book them off if they phoned in instead of using their link. They stop getting shift texts and drop out of auto-dispatch.</p>
      <select id="cmAbsReason" class="cmpinput">${Object.entries(ABSENCE_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <select id="cmAbsSpan" class="cmpinput" style="margin-top:8px">${ABSENCE_SPANS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <button class="btn wide" style="margin-top:9px" id="cmAbsSet">Book time off</button>
    </div>`}
    <div class="rowbtns" style="margin-top:12px">
      <button class="btn ghost" id="cmActive">${emp.active === false ? "Reactivate" : "Deactivate"}</button>
    </div>` : ""}
    <button class="btn em wide" style="margin-top:13px" id="cmSave">Save</button>
    <div class="note" id="cmNote" style="margin-top:8px"></div>`, (sh) => {
    on("[data-cmday]", "click", (e) => {
      const k = e.currentTarget.dataset.cmday;
      days.has(k) ? days.delete(k) : days.add(k);
      e.currentTarget.classList.toggle("on");
    }, sh);
    const note = sh.querySelector("#cmNote");
    const absSet = sh.querySelector("#cmAbsSet");
    if (absSet) absSet.onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api("/crew", {
          action: "absence-set",
          employee_id: emp.id,
          reason: sh.querySelector("#cmAbsReason").value,
          span: sh.querySelector("#cmAbsSpan").value,
        });
        toast(`${emp.name.split(" ")[0]} booked off`);
        closeSheet(); crewRosterSheet();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
    const absCancel = sh.querySelector("#cmAbsCancel");
    if (absCancel) absCancel.onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api("/crew", { action: "absence-cancel", id: emp.absence.id });
        toast("Time off cancelled");
        closeSheet(); crewRosterSheet();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
    const active = sh.querySelector("#cmActive");
    if (active) active.onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api("/crew", { action: "update", id: emp.id, active: emp.active === false });
        toast(emp.active === false ? "Reactivated" : "Deactivated");
        closeSheet(); crewRosterSheet();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
    sh.querySelector("#cmSave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      const name = sh.querySelector("#cmName").value.trim();
      if (!name) { note.className = "note err"; note.textContent = "Name is required."; e.currentTarget.disabled = false; return; }
      const body = {
        action: emp ? "update" : "add",
        name,
        phone: sh.querySelector("#cmPhone").value.trim(),
        email: sh.querySelector("#cmEmail").value.trim(),
        work_email: sh.querySelector("#cmWorkEmail").value.trim(),
        work_start: sh.querySelector("#cmStart").value,
        work_end: sh.querySelector("#cmEnd").value,
        work_days: [...days],
      };
      if (emp) body.id = emp.id;
      try {
        await api("/crew", body);
        toast(emp ? "Saved" : `${name} added`);
        closeSheet(); crewRosterSheet();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

// Crew Reminders timing: how long after shift end the nudge goes out, plus a
// shortcut to the roster where the shift hours themselves live.
function crewTimingSheet(d) {
  const lead = Number.isFinite(Number(d.crewReminderLeadMin)) ? Number(d.crewReminderLeadMin) : 5;
  sheet(`<h2>Shifts &amp; timing</h2>
    <p class="sh-sub">Each crew member's shift hours live on the roster. These set when the two shift texts go out. Both carry their personal clock-in link.</p>
    <label class="fld" style="margin-top:12px">MINUTES BEFORE SHIFT START</label>
    <input id="crewlead" class="cmpinput" type="number" min="0" max="240" step="5" value="${lead}">
    <p class="sh-sub" style="margin-top:6px">"Your shift starts at 8:00 AM" with a tap-to-clock-in link. Skipped for anyone already on the clock or off that day.</p>
    <label class="fld" style="margin-top:12px">MINUTES AFTER SHIFT END</label>
    <input id="crewdelay" class="cmpinput" type="number" min="5" max="240" step="5" value="${Number(d.crewReminderDelayMin) > 0 ? Number(d.crewReminderDelayMin) : 30}">
    <p class="sh-sub" style="margin-top:6px">Techs often work past their scheduled end — 20&ndash;30 minutes stops this catching everyone mid&#8209;cleanup.</p>
    <button class="btn em wide" style="margin-top:13px" id="crewdelaysave">Save</button>
    <button class="btn wide" style="margin-top:9px" id="crewrosterlink">Roster &amp; shift hours</button>
    <div class="note" id="crewdelaynote" style="margin-top:8px"></div>`, (sh) => {
    sh.querySelector("#crewrosterlink").onclick = () => { closeSheet(); crewRosterSheet(); };
    sh.querySelector("#crewdelaysave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      const note = sh.querySelector("#crewdelaynote");
      try {
        await api("/phone", {
          action: "settings-save",
          crewReminderDelayMin: sh.querySelector("#crewdelay").value,
          crewReminderLeadMin: sh.querySelector("#crewlead").value,
        });
        toast("Timing saved");
        closeSheet();
        renderPhone();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

// ---- The owner's own crew reminders (Kyle 2026-08-31) ---------------------
// The clock-out nudge is derived from an open punch. These are written by the
// owner: a message, a time, and who gets it. Same card, same switch, separate
// records — see the migration for why they are not one table.

// "Every Mon Tue Wed at 7:30 AM · everyone" — the whole schedule in the row,
// so nobody has to open a reminder to find out when it goes.
function crewReminderWhen(r, crew) {
  const time = apptPrettyTime(r.send_time || "08:00");
  const who = r.audience === "selected"
    ? (r.employee_ids || []).map((id) => (crew.find((e) => e.id === id) || {}).name).filter(Boolean).join(", ") || "nobody on the roster"
    : "everyone";
  if (r.send_on) {
    const [y, m, dd] = String(r.send_on).slice(0, 10).split("-").map(Number);
    const when = new Date(y, (m || 1) - 1, dd || 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `Once on ${when} at ${time} · ${who}`;
  }
  const labels = CREW_DAY_LABELS.filter(([k]) => (r.days || []).includes(k)).map(([, l]) => l);
  return `Every ${labels.join(" ") || "—"} at ${time} · ${who}`;
}

function crewRemindersSheet() {
  sheet(`<h2>Your reminders</h2>
    <p class="sh-sub">Texted to your crew from the business line at the time you set. The clock-out nudge is separate and always on with this switch.</p>
    <div id="crlist" class="note" style="margin-top:12px">Loading…</div>
    <button class="btn em wide" style="margin-top:13px" id="cradd">New reminder</button>`, async (sh) => {
    sh.querySelector("#cradd").onclick = () => { closeSheet(); crewReminderEditSheet(null); };
    try {
      const [data, roster] = await Promise.all([
        api("/phone", { action: "crew-reminder-list" }),
        api("/crew", { action: "list" }),
      ]);
      const crew = (roster.employees || []).filter((e) => e.active !== false);
      const rows = data.reminders || [];
      const list = sh.querySelector("#crlist");
      if (!rows.length) {
        list.innerHTML = `<p class="note">Nothing yet. A reminder is one text on a schedule — "Trailer inspection today", "Sign your time card", anything you say twice a week.</p>`;
        return;
      }
      list.className = "panel";
      list.style.padding = "0";
      list.style.overflow = "hidden";
      list.innerHTML = rows.map((r, i) => `<div class="autorow" data-crid="${esc(r.id)}" style="${i ? "" : "border-top:0"}">
        <div style="flex:1;min-width:0">
          <div class="needst">${esc(r.message)} ${r.active === false ? '<span class="pill">OFF</span>' : ""}</div>
          <div class="needsm">${esc(crewReminderWhen(r, crew))}${r.last_sent_on ? ` · last sent ${esc(r.last_sent_on)}` : ""}</div>
        </div>
        <span style="color:var(--dim2)">&rsaquo;</span></div>`).join("");
      on("[data-crid]", "click", (e) => {
        const r = rows.find((x) => x.id === e.currentTarget.dataset.crid);
        if (r) { closeSheet(); crewReminderEditSheet(r, crew); }
      }, sh);
    } catch (err) {
      sh.querySelector("#crlist").className = "note err";
      sh.querySelector("#crlist").textContent = err.message;
    }
  });
}

function crewReminderEditSheet(rem, crewCache) {
  const days = new Set(rem?.days?.length ? rem.days : ["mon", "tue", "wed", "thu", "fri"]);
  const picked = new Set(rem?.employee_ids || []);
  let mode = rem?.send_on ? "once" : "repeat";
  let audience = rem?.audience === "selected" ? "selected" : "all";
  sheet(`<h2>${rem ? "Edit reminder" : "New reminder"}</h2>
    <label class="fld" style="margin-top:10px">WHAT IT SAYS</label>
    <textarea id="crMsg" class="cmpinput" rows="3" maxlength="320" placeholder="Sign your time card before you leave">${esc(rem?.message || "")}</textarea>
    <p class="note" style="margin-top:6px">Your business name goes on the front of it automatically.</p>
    <label class="fld" style="margin-top:12px">WHAT TIME</label>
    <input type="time" id="crTime" class="cmpinput" value="${esc(rem?.send_time || "08:00")}">
    <div class="rowbtns" style="margin-top:12px">
      <button class="btn ${mode === "repeat" ? "em" : ""}" id="crModeRepeat" type="button">Every week</button>
      <button class="btn ${mode === "once" ? "em" : ""}" id="crModeOnce" type="button">Just once</button>
    </div>
    <div id="crRepeatWrap" style="display:${mode === "repeat" ? "block" : "none"}">
      <div class="daypick" style="margin-top:10px">
        ${CREW_DAY_LABELS.map(([k, l]) => `<button class="daybtn ${days.has(k) ? "on" : ""}" data-crday="${k}" type="button">${l}</button>`).join("")}
      </div>
    </div>
    <div id="crOnceWrap" style="display:${mode === "once" ? "block" : "none"}">
      <input type="date" id="crDate" class="cmpinput" style="margin-top:10px" value="${esc(String(rem?.send_on || "").slice(0, 10))}">
      <p class="note" style="margin-top:6px">It sends that day and then switches itself off.</p>
    </div>
    <label class="fld" style="margin-top:14px">WHO GETS IT</label>
    <div class="rowbtns" style="margin-top:6px">
      <button class="btn ${audience === "all" ? "em" : ""}" id="crWhoAll" type="button">Everyone</button>
      <button class="btn ${audience === "selected" ? "em" : ""}" id="crWhoSome" type="button">Only who I pick</button>
    </div>
    <div id="crPickWrap" style="display:${audience === "selected" ? "block" : "none"}">
      <div class="daypick" id="crPick" style="margin-top:10px;flex-wrap:wrap"></div>
    </div>
    ${rem ? `<div class="rowbtns" style="margin-top:14px">
      <button class="btn ghost" id="crToggle" type="button">${rem.active === false ? "Turn this one back on" : "Turn this one off"}</button>
      <button class="btn ghost" id="crDelete" type="button">Delete</button>
    </div>` : ""}
    <button class="btn em wide" style="margin-top:13px" id="crSave">Save</button>
    <div class="note" id="crNote" style="margin-top:8px"></div>`, async (sh) => {
    const note = sh.querySelector("#crNote");
    const setMode = (next) => {
      mode = next;
      sh.querySelector("#crRepeatWrap").style.display = next === "repeat" ? "block" : "none";
      sh.querySelector("#crOnceWrap").style.display = next === "once" ? "block" : "none";
      sh.querySelector("#crModeRepeat").classList.toggle("em", next === "repeat");
      sh.querySelector("#crModeOnce").classList.toggle("em", next === "once");
    };
    sh.querySelector("#crModeRepeat").onclick = () => setMode("repeat");
    sh.querySelector("#crModeOnce").onclick = () => setMode("once");
    on("[data-crday]", "click", (e) => {
      const k = e.currentTarget.dataset.crday;
      days.has(k) ? days.delete(k) : days.add(k);
      e.currentTarget.classList.toggle("on");
    }, sh);
    const setAudience = (next) => {
      audience = next;
      sh.querySelector("#crPickWrap").style.display = next === "selected" ? "block" : "none";
      sh.querySelector("#crWhoAll").classList.toggle("em", next === "all");
      sh.querySelector("#crWhoSome").classList.toggle("em", next === "selected");
    };
    sh.querySelector("#crWhoAll").onclick = () => setAudience("all");
    sh.querySelector("#crWhoSome").onclick = () => setAudience("selected");

    let crew = crewCache;
    if (!crew) {
      try { crew = ((await api("/crew", { action: "list" })).employees || []).filter((e) => e.active !== false); }
      catch { crew = []; }
    }
    // Only people who can actually be texted. Someone with no number on the
    // roster is shown as unavailable rather than silently missing.
    sh.querySelector("#crPick").innerHTML = crew.map((e) => {
      const textable = String(e.phone || "").trim();
      return `<button class="daybtn ${picked.has(e.id) ? "on" : ""}" data-crwho="${esc(e.id)}" type="button" style="flex:0 0 auto;padding:10px 13px" ${textable ? "" : "disabled"}>${esc(e.name)}${textable ? "" : " (no number)"}</button>`;
    }).join("") || `<p class="note">Nobody on the roster yet.</p>`;
    on("[data-crwho]", "click", (e) => {
      const id = e.currentTarget.dataset.crwho;
      picked.has(id) ? picked.delete(id) : picked.add(id);
      e.currentTarget.classList.toggle("on");
    }, sh);

    const save = async (patch) => {
      const message = sh.querySelector("#crMsg").value.trim();
      if (!message) { note.className = "note err"; note.textContent = "Say what the text should say."; return false; }
      const body = {
        action: "crew-reminder-save",
        message,
        sendTime: sh.querySelector("#crTime").value || "08:00",
        days: mode === "repeat" ? [...days] : [],
        sendOn: mode === "once" ? sh.querySelector("#crDate").value : "",
        audience,
        employeeIds: [...picked],
        active: rem ? rem.active !== false : true,
        ...patch,
      };
      if (rem) body.id = rem.id;
      try {
        await api("/phone", body);
        return true;
      } catch (err) { note.className = "note err"; note.textContent = err.message; return false; }
    };

    sh.querySelector("#crSave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      if (await save({})) { toast("Reminder saved"); closeSheet(); crewRemindersSheet(); renderPhone(); }
      else e.currentTarget.disabled = false;
    };
    const toggle = sh.querySelector("#crToggle");
    if (toggle) toggle.onclick = async (e) => {
      e.currentTarget.disabled = true;
      if (await save({ active: rem.active === false })) {
        toast(rem.active === false ? "Reminder is on" : "Reminder is off");
        closeSheet(); crewRemindersSheet(); renderPhone();
      } else e.currentTarget.disabled = false;
    };
    const del = sh.querySelector("#crDelete");
    if (del) del.onclick = async (e) => {
      if (!(await askConfirm("Your crew stops getting it.", { title: "Delete this reminder?", ok: "Delete", danger: true }))) return;
      e.currentTarget.disabled = true;
      try {
        await api("/phone", { action: "crew-reminder-delete", id: rem.id });
        toast("Reminder deleted");
        closeSheet(); crewRemindersSheet(); renderPhone();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

function apptReminderCard(d) {
  const r = d.reminders || {};
  const on = r.enabled === true;
  const when = apptPrettyTime(r.time || "18:00");
  const ahead = Number(r.daysAhead || 1);
  const aheadLabel = ahead === 1 ? "the night before" : `${ahead} days ahead`;
  return `<div class="panel">
    <h3>&#128276; Appointment reminders ${on ? '<span class="pill live">ON</span>' : '<span class="pill">OFF</span>'}</h3>
    <p class="sub">${on
      ? `Every day at <b>${esc(when)}</b>, everyone booked ${esc(aheadLabel)} gets a text asking them to confirm or tell you they need to move it.`
      : "Text tomorrow's customers automatically and ask them to confirm. The ones who can't make it tell you the night before, while you can still fill the slot."}</p>
    <p class="note" style="margin-top:8px">Each customer is texted <b>once per appointment</b>, ever. Anyone whose appointment has no phone number on it is reported to you, never skipped quietly.</p>
    ${on && r.lastRunAt ? `<p class="note" style="margin-top:6px">Last run ${esc(new Date(r.lastRunAt).toLocaleString())}.</p>` : ""}
    ${on && r.lastError ? `<p class="note err" style="margin-top:6px">The last scheduled run sent nothing: ${esc(r.lastError)}</p>` : ""}
    <div class="rowbtns" style="margin-top:12px">
      <button class="btn" id="rempreview">See tonight's list</button>
      <button class="btn ${on ? "" : "em"}" id="remtoggle">${on ? "Turn off" : "Turn on reminders"}</button>
      <button class="btn" id="remtune">Time &amp; wording</button>
    </div>
  </div>`;
}

function apptPrettyTime(hhmm) {
  const [h, m] = String(hhmm || "18:00").split(":").map(Number);
  const hour = ((h + 11) % 12) + 1;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

// Nothing is ever turned on without the owner having seen the actual list and
// the actual wording first — so the dry run is offered right here in the
// confirm, not buried behind a settings screen.
async function toggleApptReminders(d) {
  const r = d.reminders || {};
  if (r.enabled !== true) {
    const ok = await askConfirm(`Every day at ${apptPrettyTime(r.time || "18:00")}, Ledger will text everyone booked in for the next day from your business number, asking them to reply Y to confirm or C to change it.\n\nEach customer is texted once per appointment, ever. Nobody is texted twice.\n\nIf you haven't already, check "See tonight's list" first — it shows you exactly who would get a text and exactly what it says, and sends nothing.\n\nYou can turn this off any time.`, { title: "Turn on appointment reminders?", ok: "Turn on" });
    if (!ok) return;
  }
  if (await savePhoneSwitch(d, 'reminders', r.enabled !== true, {action:'settings-save', reminderEnabled:r.enabled !== true}))
    toast(r.enabled !== true ? "Reminders are on" : "Reminders are off");
}

// Reminder wording (Kyle 2026-09-13, 1202): the greeting "Hey {first name}!" is
// locked — shown here read-only so the owner can see it — and the note under it
// is theirs, prefilled with the standard wording so changing it is optional.
// Blank = the standard note comes back (the server stores ''). {shop} and
// {when} fill in at send time; the example under the box mirrors the server's
// rendering so the owner sees the exact text before saving.
const REM_FALLBACK_NOTE = "Reminder from {shop} — you're booked in {when}. Reply Y to confirm, or C if you need to change it.";
function apptRenderNote(note, shop, when, name) {
  return String(note || "").replace(/\{\s*(shop|business|when|time|name|first ?name|customer(?: ?name)?)\s*\}/gi, (_m, k) => {
    k = k.toLowerCase().replace(/\s+/g, "");
    return k === "shop" || k === "business" ? shop : k === "when" || k === "time" ? when : name;
  }).replace(/[ \t]{2,}/g, " ").trim();
}

function apptReminderSheet(d) {
  const r = d.reminders || {};
  const defaultNote = r.defaultNote || REM_FALLBACK_NOTE;
  const noteMax = Number(r.noteMax || 300);
  const shop = r.shopName || "your business";
  const example = (note) => "Hey Amy! " + apptRenderNote(String(note || "").trim() || defaultNote, shop, "Tuesday at 9:00am", "Amy");
  sheet(`<h2>Reminder settings</h2>
    <label class="lab">What the text says</label>
    <div class="inp" style="opacity:.7;cursor:default">&#128274; Hey {customer's first name}!</div>
    <p class="note">This part always stays. Ledger puts each customer's own name in.</p>
    <label class="lab" style="margin-top:12px">Your note</label>
    <textarea class="inp" id="remnote" rows="4" maxlength="${noteMax}" style="resize:vertical;min-height:96px">${esc(r.note || defaultNote)}</textarea>
    <p class="note">{shop} and {when} fill themselves in. Leave it as is, or make it yours. <a href="#" id="remreset">Use the standard note</a></p>
    <label class="lab" style="margin-top:10px">How it will read</label>
    <div id="remexample" style="padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.05);font-size:13px;line-height:1.4"></div>
    <label class="lab" style="margin-top:12px">What time to send</label>
    <input class="inp" id="remtime" type="time" value="${esc(r.time || "18:00")}">
    <p class="note">Your local time. Evening works best — late enough that the day is settled, early enough not to bother anyone.</p>
    <label class="lab" style="margin-top:12px">How far ahead</label>
    <select class="inp" id="remahead">
      ${[1, 2, 3].map((n) => `<option value="${n}" ${Number(r.daysAhead || 1) === n ? "selected" : ""}>${n === 1 ? "The night before" : `${n} days ahead`}</option>`).join("")}
    </select>
    <div class="rowbtns" style="margin-top:16px"><button class="btn em" id="remsave">Save</button></div>`, (sh) => {
    const box = sh.querySelector("#remnote"), ex = sh.querySelector("#remexample");
    const refresh = () => { ex.textContent = example(box.value); };
    box.oninput = refresh; refresh();
    sh.querySelector("#remreset").onclick = (e) => { e.preventDefault(); box.value = defaultNote; refresh(); };
    sh.querySelector("#remsave").onclick = async () => {
      try {
        const note = box.value.trim();
        await api("/phone", {
          action: "settings-save",
          reminderTime: sh.querySelector("#remtime").value || "18:00",
          reminderDaysAhead: Number(sh.querySelector("#remahead").value || 1),
          reminderNote: note === defaultNote ? "" : note,
        });
        toast("Saved"); closeSheet(); renderPhone();
      } catch (err) { toast(friendlyError(err, "Couldn't save your reminder settings. Try again.")); }
    };
  });
}

// The dry run. Shows the real recipients and the real wording, sends nothing.
async function apptReminderPreviewSheet() {
  sheet(`<h2>Tonight's reminders</h2><div id="rembody"><div class="skel"></div></div>`, async (sh) => {
    let d;
    try { d = await api("/phone", { action: "reminder-preview" }); }
    catch (err) { sh.querySelector("#rembody").innerHTML = `<p class="note">${esc(err.message)}</p>`; return; }
    if (d.error) { sh.querySelector("#rembody").innerHTML = `<p class="note">${esc(d.error)}</p>`; return; }
    const items = d.items || [];
    const label = { will_send: '<span class="pill live">WILL SEND</span>', already_sent: '<span class="pill">ALREADY SENT</span>', no_number: '<span class="pill" style="color:var(--red)">NO PHONE NUMBER</span>', opted_out: '<span class="pill" style="color:var(--red)">TEXTED STOP</span>' };
    sh.querySelector("#rembody").innerHTML = `
      <p class="sub">${d.appointments} appointment${d.appointments === 1 ? "" : "s"} on ${esc(d.day)} — <b>${d.would_send}</b> would get a text.${d.no_number ? ` <b>${d.no_number}</b> have no phone number on the appointment and would need you to text them yourself.` : ""}${d.opted_out ? ` <b>${d.opted_out}</b> texted STOP and will not be texted — call them instead.` : ""}</p>
      <p class="note">Nothing has been sent. This is exactly what would go out.</p>
      ${items.length ? items.map((it) => `<div class="kv" style="display:block"><div>${label[it.state] || ""} <b>${esc(it.title)}</b></div>
        <div><small style="color:var(--dim)">${esc(it.when)}${it.to ? " · " + esc(it.to) : ""}</small></div>
        ${it.message && !it.name ? `<div style="margin-top:4px"><small style="color:#f0a030">No name on this booking — this one opens with "Hey there!". Put the customer's name on the appointment to fix it.</small></div>` : ""}
        ${it.message ? `<div style="margin-top:6px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.05)"><small>${esc(it.message)}</small></div>` : ""}</div>`).join("")
        : '<p class="note">Nothing booked for that day.</p>'}`;
  });
}

function frontDeskCard(d) {
  const fd = d.frontDesk || {};
  const on = fd.enabled === true;
  return `<div class="panel">
    <h3>&#129302; Front Desk ${on ? '<span class="pill live">ON</span>' : '<span class="pill">OFF</span>'}</h3>
    <p class="sub">${on
      ? "When a missed caller texts back, Ledger answers them — quoting your real QuickBooks prices and booking real open times on your calendar. Nobody has to be watching."
      : "Turn this on and a missed call becomes a booking on its own: Ledger texts the caller back, quotes from your QuickBooks prices, offers open times from your calendar, and books one."}</p>
    <p class="note" style="margin-top:8px">It can never invoice, take a payment, or discuss a bill. Anything it isn't sure about goes straight to you.</p>
    ${on ? `<p class="note" style="margin-top:6px">${fd.booking === false ? "Booking is <b>off</b> — it quotes and gathers details, you book." : "Booking is <b>on</b>."} Max ${Number(fd.maxRepliesPerCaller || 8)} texts per caller a day.${fd.instructions ? `<br>Your instructions: <i>${esc(fd.instructions)}</i>` : ""}</p>` : ""}
    <div class="rowbtns" style="margin-top:12px">
      <button class="btn ${on ? "" : "em"}" id="fdtoggle">${on ? "Turn off" : "Turn on Front Desk"}</button>
      ${on ? '<button class="btn" id="fdtune">Settings</button><button class="btn" id="fdlog">What it did</button>' : ""}
    </div>
  </div>`;
}

async function toggleFrontDesk(d) {
  const fd = d.frontDesk || {};
  if (fd.enabled !== true) {
    const ok = await askConfirm("From now on, when someone calls, misses you, and texts back, Ledger will reply to them on its own — quoting your real QuickBooks prices and booking real times on your calendar. No one has to approve each message.\n\nIt can never invoice, take payment, or discuss a bill, and anything it's unsure about it hands straight to you.\n\nYou can turn this off any time.", { title: "Turn on Front Desk?", ok: "Turn on" });
    if (!ok) return;
  }
  if (await savePhoneSwitch(d, 'frontdesk', fd.enabled !== true, {action:'settings-save', frontDeskEnabled:fd.enabled !== true}))
    toast(fd.enabled !== true ? "Front Desk is on" : "Front Desk is off");
}

function frontDeskSheet(d) {
  const fd = d.frontDesk || {};
  sheet(`<h2>Front Desk settings</h2>
    <p class="sh-sub">How Ledger handles a missed caller who texts back.</p>
    <label class="fld" style="margin-top:14px">CAN IT BOOK APPOINTMENTS?</label>
    <div class="rowbtns">
      <button class="btn ${fd.booking !== false ? "em" : ""}" data-fdbook="1" type="button">Yes, book them</button>
      <button class="btn ${fd.booking === false ? "em" : ""}" data-fdbook="0" type="button">No, just quote</button>
    </div>
    <label class="fld" style="margin-top:14px">YOUR STANDING INSTRUCTIONS</label>
    <textarea id="fdinstr" rows="4" placeholder="e.g. Always ask what vehicle. Never book Saturdays before 10. We don't do alignments.">${esc(fd.instructions || "")}</textarea>
    <p class="note" style="margin-top:6px">Written in your words, followed on every reply.</p>
    <label class="fld" style="margin-top:14px">MAX TEXTS TO ONE CALLER PER DAY</label>
    <input id="fdcap" type="number" min="1" max="30" value="${Number(fd.maxRepliesPerCaller || 8)}">
    <button class="btn em wide" style="margin-top:13px" id="fdsave">Save</button>
    <div class="note" id="fdnote" style="margin-top:8px"></div>`, (sh) => {
    let booking = fd.booking !== false;
    on("[data-fdbook]", "click", (e) => {
      booking = e.currentTarget.dataset.fdbook === "1";
      sh.querySelectorAll("[data-fdbook]").forEach((b) => b.classList.toggle("em", (b.dataset.fdbook === "1") === booking));
    }, sh);
    sh.querySelector("#fdsave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      const note = sh.querySelector("#fdnote");
      try {
        await api("/phone", {
          action: "settings-save",
          frontDeskBooking: booking,
          frontDeskInstructions: sh.querySelector("#fdinstr").value,
          frontDeskMaxReplies: Number(sh.querySelector("#fdcap").value || 8),
        });
        toast("Front Desk settings saved");
        closeSheet();
        renderPhone();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

const FD_OUTCOME = { replied: "Answered", booked: "Booked them", handoff: "Handed to you", error: "Failed" };

async function frontDeskLogSheet() {
  sheet(`<h2>What Front Desk did</h2><div id="fdlogbody"><div class="skel"></div></div>`, async (sh) => {
    try {
      const d = await api("/phone", { action: "frontdesk-runs", limit: 40 });
      const runs = d.runs || [];
      sh.querySelector("#fdlogbody").innerHTML = runs.length
        ? `<div class="list">${runs.map((r) => `
            <div class="item">
              <div class="main">
                <div class="ttl">${esc(formatE164(r.peerNumber) || r.peerName || "Caller")}</div>
                <div class="sub">${esc(r.reply || r.error || "")}</div>
                ${r.handoffReason ? `<div class="sub">Why: ${esc(r.handoffReason)}</div>` : ""}
              </div>
              <div class="amt"><small>${esc(FD_OUTCOME[r.outcome] || r.outcome)}</small><br><small class="note">${esc(dayLabel(r.at))}</small></div>
            </div>`).join("")}</div>`
        : `<div class="empty">Front Desk hasn't answered anyone yet.</div>`;
    } catch (e) { sh.querySelector("#fdlogbody").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  });
}

function phoneSettingsSheet(d) {
  sheet(`<h2>Business hours &amp; templates</h2>
    <p class="sh-sub">Sets which auto-reply a missed call gets.</p>
    <div class="timerow" style="margin-top:10px">
      <input type="time" id="phstart" value="${esc(d.hoursStart || "08:00")}">
      <span class="note">to</span>
      <input type="time" id="phend" value="${esc(d.hoursEnd || "17:00")}">
    </div>
    <div class="daypick" style="margin-top:10px">
      ${PHONE_DAY_LABELS.map(([k, l]) => `<button class="daybtn ${((d.hoursDays || []).includes(k)) ? "on" : ""}" data-phday="${k}" type="button">${l}</button>`).join("")}
    </div>
    <label class="fld" style="margin-top:14px">AUTO-REPLY · BUSINESS HOURS</label>
    <textarea id="phauto1" rows="3">${esc(d.autoReplyHours || "")}</textarea>
    <label class="fld" style="margin-top:10px">AUTO-REPLY · AFTER HOURS</label>
    <textarea id="phauto2" rows="3">${esc(d.autoReplyAfter || "")}</textarea>
    <p class="note" style="margin-top:6px">Use <code>{business}</code> and <code>{hours}</code> — they fill in automatically.</p>
    <label class="fld" style="margin-top:10px">VOICEMAIL GREETING — SPOKEN TO CALLERS</label>
    <textarea id="phvmgreet" rows="3" placeholder="${esc(d.vmGreetingDefault || "You have reached your business. Please leave a message after the tone, and we will text you right back.")}">${esc(d.vmGreeting || "")}</textarea>
    <p class="note" style="margin-top:6px">Your own words, read aloud when a call goes to voicemail. Leave blank to use the built-in greeting above.</p>
    <button class="btn em wide" style="margin-top:13px" id="phsave">Save</button>
    <div class="note" id="phnote" style="margin-top:8px"></div>`, (sh) => {
    let days = new Set(d.hoursDays || []);
    on("[data-phday]", "click", (e) => {
      const k = e.currentTarget.dataset.phday;
      days.has(k) ? days.delete(k) : days.add(k);
      e.currentTarget.classList.toggle("on");
    }, sh);
    sh.querySelector("#phsave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      const note = sh.querySelector("#phnote");
      try {
        await api("/phone", {
          action: "settings-save",
          hoursStart: sh.querySelector("#phstart").value, hoursEnd: sh.querySelector("#phend").value,
          hoursDays: [...days], autoReplyHours: sh.querySelector("#phauto1").value, autoReplyAfter: sh.querySelector("#phauto2").value,
          voicemailGreeting: sh.querySelector("#phvmgreet").value,
        });
        toast("Phone settings saved");
        closeSheet();
        renderPhone();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

function requestNumberCard(pending, locked, lock = {}) {
  // Subscription-only since 2026-08-31. Show what the line DOES and the way to
  // get it, rather than a form whose only possible answer is "subscribe first".
  if (locked && !pending) {
    // Already subscribed, still on the free trial (16-03): the number opens
    // with the first payment. Say when — never "Subscribe" to someone who did.
    const cardOnFile = lock.numberLockReason === "trial_card_on_file";
    const unlockDay = cardOnFile && lock.numberUnlocksAt ? dayLabel(lock.numberUnlocksAt) : "";
    return `<div class="panel">
      <h3>&#128241; Your own business line</h3>
      <p class="sub">A local number of your own, included with your subscription: missed calls text the caller back automatically, every lead lands in your Leads list, and you can reply right from this tab.</p>
      <p class="note" style="margin-top:10px">Live calling and texting require a subscription, an available number and provider activation. Setup is usually the same business day, but carrier checks can take longer. Front Desk requires Pro. Try the sample walkthrough before subscribing.</p>
      ${cardOnFile ? `<p class="note ok" style="margin-top:13px">Your card is on file — nothing more to do. Your number unlocks with your first payment${unlockDay ? ` on ${esc(unlockDay)}` : " when your free trial ends"}, and the request form appears here then.</p>`
        : inAndroidApp() ? `<p class="note" style="margin-top:13px">${SUBSCRIPTION_REQUIRED}</p>`
        : `<button class="btn em wide" style="margin-top:13px" id="rnsubscribe">Subscribe to get your number</button>`}
      <div class="note" id="rnnote" style="margin-top:8px"></div>
    </div>`;
  }
  if (pending) {
    return `<div class="panel">
      <h3>&#128241; Business number requested</h3>
      <p class="sub">Your number request for <b>${esc(pending.businessName)}</b> is queued. Activation depends on number availability and provider checks. This tab will show the number when it is ready.</p>
      <p class="note" style="margin-top:8px">Requested ${esc(dayLabel(pending.createdAt))}</p>
    </div>`;
  }
  return `<div class="panel">
    <h3>&#128241; Request a business number</h3>
    <p class="sub">Get a dedicated business line: missed calls auto-text the caller and land them in your Leads list.</p>
    <label class="fld" style="margin-top:10px">BUSINESS NAME</label>
    <input id="rnbiz" placeholder="Your business name">
    <label class="fld" style="margin-top:10px">PREFERRED AREA CODE</label>
    <input id="rnarea" placeholder="e.g. 587" inputmode="numeric" maxlength="3">
    <label class="fld" style="margin-top:10px">YOUR CELL — CALLS FORWARD HERE</label>
    <input id="rncell" placeholder="e.g. 587 555 0123" inputmode="tel">
    <label class="fld" style="margin-top:10px">BUSINESS HOURS</label>
    <input id="rnhours" placeholder="e.g. Mon–Fri 8am–5pm">
    <label class="fld" style="margin-top:10px">AUTO-REPLY TEXT (OPTIONAL)</label>
    <textarea id="rntemplate" rows="3" placeholder="We'll suggest one if you leave this blank."></textarea>
    <button class="btn em wide" style="margin-top:13px" id="rnsubmit">Request number</button>
    <div class="note" id="rnnote" style="margin-top:8px"></div>
  </div>`;
}

function wireRequestNumber(pending, locked) {
  if (pending) return;
  if (locked) {
    const sub = $("rnsubscribe");
    if (sub) sub.onclick = async () => {
      try { const c = await startCheckout(); location.href = c.url; }
      catch (err) { if (err.cancelled) return; const note = $("rnnote"); note.className = "note err"; note.textContent = err.message; }
    };
    // Audit 16-03 (2026-09-17): the server hands out a number only once the
    // subscription is ACTIVE. A trial that already added a card is still
    // "trialing" until the trial converts, so "Subscribe to get your number"
    // would only bounce them to the billing portal. Say what actually happens.
    if (sub) api("/stripe-billing/status", {}).then((st) => {
      const live = $("rnsubscribe"); if (!live || !st) return;
      const status = String(st.subscription_status || "");
      const paidUp = st.card_on_file === true || st.apple_subscribed === true;
      if (status === "trialing" && paidUp) {
        const when = st.trial_ends_at ? dateShort(st.trial_ends_at) : null;
        const p = document.createElement("p"); p.className = "note"; p.id = "rnunlock"; p.style.marginTop = "13px"; p.style.color = "var(--cyan)";
        p.textContent = `You're subscribed — nothing more to buy. Your subscription starts${when ? ` on ${when}` : " when your free trial ends"}, and your business number can be requested from then.`;
        live.replaceWith(p);
      } else if (status === "past_due" && st.portal_available) {
        live.textContent = "Update your card to get your number";
        live.onclick = async () => {
          try { const c = await api("/stripe-billing/portal", {}); location.href = c.url; }
          catch (err) { const note = $("rnnote"); note.className = "note err"; note.textContent = err.message; }
        };
      }
    }).catch(() => {});
    return;
  }
  $("rnsubmit").onclick = async (e) => {
    const note = $("rnnote");
    const businessName = $("rnbiz").value.trim();
    if (businessName.length < 2) { note.className = "note err"; note.textContent = "Business name is required"; return; }
    e.currentTarget.disabled = true;
    try {
      const res = await api("/phone", {
        action: "request-number", businessName,
        areaCode: $("rnarea").value.trim(), forwardTo: $("rncell").value.trim(),
        hoursNote: $("rnhours").value.trim(),
        autoReplyTemplate: $("rntemplate").value.trim(),
      });
      // Managed lane provisions instantly; the fallback queue answers with a
      // pending request instead. Same endpoint, two possible outcomes.
      if (res?.hasNumber && res?.number?.e164) toast(`Your business number is live: ${formatE164(res.number.e164)}`);
      else toast("Request sent — we'll text you when your number is live");
      renderPhone();
    } catch (err) { e.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
  };
}

/* ---------------- CUSTOMERS · LEADS · TO-DO ---------------- */
const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost"];
const LEAD_SOURCES = [["call-in", "Call-in"], ["walk-in", "Walk-in"], ["referral", "Referral"],
  ["website", "Website"], ["social", "Social"], ["repeat", "Repeat"], ["other", "Other"]];
const TODO_PRIORITIES = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];

const LANE_CODE = { directory: "CUSTOMERS", reviews: "REVIEWS", posts: "GOOGLE POSTS" };

// Red badge count on the lane switcher, same rule as iOS CustomerLaneSwitcher:
// open to-dos due by end of today. Leads moved to the Phone tab — see
// phoneStatusStrip/loadPhoneLeads.
function laneAlerts() {
  const b = S.board || {};
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const todos = (b.todos || []).filter((t) =>
    t.status === "open" && t.dueAt && new Date(t.dueAt) <= endOfToday).length;
  return { todos };
}

async function renderCustomers() {
  view().innerHTML = `<div class="sect">
    ${pageHead(S.lane === "posts" ? "Google Posts" : S.lane === "reviews" ? "Reviews" : "Customers")}
    <div class="seg">
      ${[["directory", "Directory", laneAlerts().todos], ["reviews", "Reviews", S.revUnanswered || 0], ["posts", "Google Posts", GP.board ? (GP.board.drafts || []).length : 0]].map(([k, l, n]) =>
        `<button class="${S.lane === k ? "on" : ""}" data-lane="${k}">${segIc(k)}${l}${n ? `<i class="badge">${n}</i>` : ""}</button>`).join("")}
    </div>
    <div id="lanebody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  if (S.lane === "todos") S.lane = "directory";   // old deep links / saved state
  on("[data-lane]", "click", (e) => { S.lane = e.currentTarget.dataset.lane; renderCustomers(); });
  if (S.lane === "directory") {
    loadDirectory();
    // iOS keeps the To-Do badge live from the same board; fetch it once so Directory shows it too.
    if (!S.board) api("/leads", { action: "board" }).then((b) => { S.board = b; if (S.tab === "customers") renderCustomers(); }).catch(() => {});
    // The iPhone shows the waiting-review count on the Reviews pill without
    // opening the lane, so fetch the count once per session.
    if (S.revUnanswered === undefined) {
      S.revUnanswered = 0;
      if (accountStorage.getItem("kmj.gbpOff") !== "1") {
        get("/google-business-profile/reviews?limit=10")
          .then((d) => { S.revUnanswered = d.reviews?.unanswered_count || 0; if (S.tab === "customers" && S.revUnanswered) renderCustomers(); })
          .catch((e) => { if (e && (e.status === 409 || e.status === 403)) accountStorage.setItem("kmj.gbpOff", "1"); });
      }
    }
  } else if (S.lane === "reviews") loadReviewsLane();
  else loadPostsLane();
}

// Reviews lane — the web twin of iOS ReviewsCommandLane (build 40): live Google
// reviews, the public score, and the playbook for growing it.
async function loadReviewsLane() {
  const slot = $("lanebody"); if (!slot) return;
  const gold = "var(--gold, #fbbf24)";
  let board;
  try {
    board = (await get("/google-business-profile/reviews?limit=30")).reviews;
  } catch (e) {
    const connect = e.status === 409, pending = e.status === 403;
    slot.innerHTML = `<div class="revlane-err">
      <div class="eyebrow" style="color:${gold}">${connect ? "&#128279; CONNECT GOOGLE REVIEWS" : pending ? "&#8987; REVIEW ACCESS PENDING" : "REVIEWS UNAVAILABLE"}</div>
      <p class="note" style="margin-top:8px">${esc(e.message)}</p>
      ${connect ? `<p class="note">Business profile &amp; settings → Connected services → Business Profile → Connect. Your live reviews, rating and reply tools light up the moment it links.</p>` : ""}
      <button class="pillbtn" id="rvretry" style="margin-top:10px"><b>Try again</b></button>
    </div>`;
    $("rvretry").onclick = () => { slot.innerHTML = `<div class="skel"></div>`; loadReviewsLane(); };
    return;
  }
  // Reviews waiting on a reply come first \u2014 they are the ones that need Kyle.
  const items = (board.items || []).slice().sort((a, b) => (a.replied === b.replied ? 0 : a.replied ? 1 : -1));
  const revOpen = S.revExpanded || (S.revExpanded = new Set());
  const shownReviews = S.revShowAll ? items : items.slice(0, 10);
  const five = items.filter((r) => r.star_rating === 5).length;
  const low = items.filter((r) => r.star_rating <= 3).length;
  const stars = (n) => "&#9733;".repeat(Math.max(0, Math.min(5, n))) + "&#9734;".repeat(5 - Math.max(0, Math.min(5, n)));
  const rel = (iso) => {
    const d = new Date(iso); if (isNaN(d)) return "";
    const days = Math.floor((Date.now() - d) / 86400000);
    return days < 1 ? "today" : days === 1 ? "yesterday" : days < 30 ? days + "d ago"
      : days < 365 ? Math.floor(days / 30) + "mo ago" : Math.floor(days / 365) + "y ago";
  };
  const intel = [];
  if (items.length) intel.push(["&#10024;", `${five} of your last ${items.length} reviews are five-star${five === items.length ? " — a perfect run." : "."}`, "var(--emerald)"]);
  if (low > 0) intel.push(["&#10071;", `${low} recent review${low === 1 ? " sits" : "s sit"} at 3★ or below — a calm owner reply is the single strongest signal to the next reader.`, "var(--orange)"]);
  if (board.unanswered_count > 0) intel.push(["&#8617;", `${board.unanswered_count} unanswered — say "reply to my latest review" in Ask Ledger and confirm the draft before it posts.`, "var(--cyan)"]);
  else if (items.length) intel.push(["&#9989;", "Every recent review has an owner reply. That consistency is rare and customers notice.", "var(--emerald)"]);
  if (items[0]) intel.push(["&#128337;", `Newest review landed ${rel(items[0].updated_at)}.`, "var(--magenta)"]);

  slot.innerHTML = `
    <div class="revhero">
      <div class="t"><span class="eyebrow" style="color:${gold}">&#128737; Reputation command</span>
        <span class="livechip">LIVE · GOOGLE</span></div>
      <div class="score"><b>${board.average_rating > 0 ? board.average_rating.toFixed(1) : "—"}</b>
        <div class="m"><span class="starrow">${stars(Math.round(board.average_rating))}</span>
          <small>${board.total_review_count} Google review${board.total_review_count === 1 ? "" : "s"}</small></div></div>
      <div class="pulse">
        <div class="pm gold"><small>RATING</small><b>${board.average_rating > 0 ? board.average_rating.toFixed(2) : "—"}</b><i>public average</i></div>
        <div class="pm cyan"><small>REVIEWS</small><b>${board.total_review_count}</b><i>all time</i></div>
        <div class="pm ${board.unanswered_count === 0 ? "em" : "orange"}"><small>UNANSWERED</small><b>${board.unanswered_count}</b>
          <i>${board.unanswered_count === 0 ? "all replied — elite" : "awaiting your reply"}</i></div>
      </div>
      ${board.business_name ? `<div class="bizname">${esc(board.business_name.toUpperCase())}</div>` : ""}
    </div>
    ${items.length ? `<div class="revintel">
      <div class="cihead">&#129504; REVIEW INTELLIGENCE</div>
      ${[5, 4, 3, 2, 1].map((s) => { const c = items.filter((r) => r.star_rating === s).length;
        return `<div class="cibar"><b style="color:${gold}">${s}&#9733;</b>
          <div class="track gold"><i style="width:${items.length ? Math.round(c / items.length * 100) : 0}%"></i></div><em>${c}</em></div>`; }).join("")}
      ${intel.map(([ic, tx, tint]) => `<p class="ciline"><span class="icx" style="color:${tint}">${ic}</span>${esc(tx)}</p>`).join("")}
    </div>` : ""}
    <div class="revlist">
      <div class="t"><span class="eyebrow" style="color:${gold}">&#128225; Last ${board.count} from Google</span>
        <button class="pillbtn sm" id="rvreload">&#8635;</button></div>
      ${items.length ? shownReviews.map((r) => `<div class="gcard">
        <div class="t"><b>${esc(r.reviewer_anonymous ? "Google user" : r.reviewer_name)}</b>
          <span class="starrow sm">${stars(r.star_rating)}</span><small>${esc(rel(r.updated_at))}</small></div>
        <div class="rvchip ${r.replied ? "ok" : "warn"}">${r.replied ? "&#10003; Replied" : "&#9888; Needs a reply"}</div>
        ${r.comment ? `<p class="rvtext${(r.comment.length > 180 && !revOpen.has(r.review_id || r.name)) ? " clip" : ""}">${esc(r.comment)}</p>
          ${r.comment.length > 180 ? `<button class="rvmore" data-rexp="${esc(r.review_id || r.name)}">${revOpen.has(r.review_id || r.name) ? "Show less" : "Read the rest"}</button>` : ""}` : ""}
        ${r.replied ? `<div class="reply"><small>&#8617; OWNER REPLY</small>${esc(r.reply_comment || "")}</div>` : ""}
      </div>`).join("") + (items.length > shownReviews.length
        ? `<button class="btn ghost wide" style="margin-top:10px" id="rvall">Show all ${items.length} reviews</button>` : "")
        : `<p class="note">No reviews yet \u2014 the moment your first Google review lands it appears here.</p>`}
    </div>
    <button class="gppointer" id="gpopenlane">
      <span class="ic">&#128227;</span>
      <span class="m"><b>Google posts</b><span>Photos, drafts and autopilot now live in their own lane.</span></span>
      <span class="go">&#8594;</span></button>
    <div class="revgrow">
      <div class="cihead" style="color:var(--emerald)">&#128200; GROW YOUR REVIEWS WITH LEDGER</div>
      ${[["01", "Ask at the high point", "Right after a job they loved. The Directory lane puts an Ask-for-review button on every customer — it sends your real Google review link."],
        ["02", "Reply to every single one", "Ask Ledger to draft the reply — it answers what the customer actually said, and nothing posts until you confirm."],
        ["03", "Make it a weekly habit", "Two asks a week compounds. A steady stream of fresh reviews outranks a burst from last year."]]
        .map(([n, t, x]) => `<div class="playstep"><b>${n}</b><div><span>${t}</span><small>${x}</small></div></div>`).join("")}
      <button class="cta gold" id="rvask"><span class="ic">&#11088;</span>
        <span><b>Ask a customer for a review</b><span>Opens the Directory review queue</span></span></button>
    </div>`;
  const rvreload = $("rvreload"); if (rvreload) rvreload.onclick = () => { slot.innerHTML = `<div class="skel"></div>`; loadReviewsLane(); };
  if ($("gpopenlane")) $("gpopenlane").onclick = () => { S.lane = "posts"; renderCustomers(); };
  if ($("rvall")) $("rvall").onclick = () => { S.revShowAll = true; loadReviewsLane(); };
  on("[data-rexp]", "click", (e) => {
    const id = e.currentTarget.dataset.rexp;
    if (revOpen.has(id)) revOpen.delete(id); else revOpen.add(id);
    loadReviewsLane();
  }, slot);
  $("rvask").onclick = () => { S.lane = "directory"; renderCustomers(); };
}

// Google Posts lane (Kyle 12578 + 1202, build 163): the third Customers pill.
async function loadPostsLane() {
  const slot = $("lanebody"); if (!slot) return;
  slot.innerHTML = `<div id="gposts"><div class="skel"></div><div class="skel"></div></div>`;
  gpLoad();
}

/* ---- Google Posts (Kyle 12563 + 1202, 2026-09-13) ----------------------
   The owner's Google Business Profile posting desk, under the reviews: photo
   bin (drop photos in; the iPhone app syncs its "Ledger AI" album here),
   posting settings (on/off, ask-me-first or autopilot, schedule, the website
   behind Learn more, the phone behind Call now, the booking page behind Book),
   drafts waiting for a Post tap, and what already went out. Nothing reaches
   Google until the owner taps Post or turns autopilot on. */
const GP = { board: null, busy: false, expanded: new Set(), showHistory: false, loadGeneration: 0, scheduleNeedsRefresh: false };
const GP_CTA_LABEL = { LEARN_MORE: "Learn more", CALL: "Call now", BOOK: "Book", ORDER: "Order", SHOP: "Shop", SIGN_UP: "Sign up" };
const GP_TOPIC_LABEL = { STANDARD: "Update", OFFER: "Offer", EVENT: "Event" };

async function gpLoad(quiet) {
  const generation = ++GP.loadGeneration;
  const slot = $("gposts"); if (!slot) return;
  if (!quiet) slot.innerHTML = `<div class="skel"></div>`;
  try {
    const fresh = (await get("/google-business-profile/posts-board")).board;
    if (generation !== GP.loadGeneration) return;
    GP.board = fresh;
    GP.scheduleNeedsRefresh = false;
    gpRender();
  } catch (e) {
    if (generation !== GP.loadGeneration) return;
    slot.innerHTML = `<div class="gpbox"><div class="cihead" style="color:var(--cyan)">&#128227; GOOGLE POSTS</div>
      <p class="note">${esc(e.message || "Google Posts is unavailable right now.")}</p>
      <button class="pillbtn" id="gpretry" style="margin-top:8px"><b>Try again</b></button></div>`;
    $("gpretry").onclick = () => gpLoad();
  }
}

function gpRel(iso) {
  const d = new Date(iso); if (isNaN(d)) return "";
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return "just now"; if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60); if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24); return days === 1 ? "yesterday" : days < 30 ? days + "d ago" : Math.floor(days / 30) + "mo ago";
}
const gpHour = (h) => (h % 12 || 12) + (h < 12 ? " AM" : " PM");

function gpRender() {
  const slot = $("gposts"); const b = GP.board; if (!slot || !b) return;
  const s = b.settings || {};
  const photos = (b.photos || []).filter((p) => p.status !== "removed");
  const flagged = photos.filter((p) => p.status === "flagged");
  const drafts = b.drafts || [];
  const history = b.history || [];
  const posted = history.filter((h) => h.status === "posted");
  const lastPosted = posted[0];
  const cadence = { daily: "daily", three_week: "Mon·Wed·Fri", weekly: "weekly" }[s.cadence] || "daily";
  const status = !b.connected ? ["Connect Google", "var(--orange)"]
    : b.location_pending ? ["Choose your listing", "var(--orange)"]
    : b.degraded ? ["Google is slow right now", "var(--orange)"]
    : !s.enabled ? ["Off — post by hand", "var(--dim)"]
    : s.mode === "auto" ? [`Autopilot · ${cadence} · ${gpHour(s.post_hour)}`, "var(--emerald)"]
    : [`Asks you · ${cadence} · ${gpHour(s.post_hour)}`, "var(--cyan)"];
  // The bin is a single strip that scrolls sideways — it never grows the desk,
  // however many photos land in it. Needs-OK first, then fresh, then used.
  const binOrder = gpBinOrder(photos);
  const stripCount = 12;
  const draftCard = (d) => {
    const open = GP.expanded.has(d.id);
    const n = gpLen(d.summary);
    return `<div class="gpdraft" data-gpdraft="${esc(d.id)}">
      <div class="t"><b>${esc(GP_TOPIC_LABEL[d.topic_type] || "Update")}${d.source === "ai_scheduled" ? " · scheduled" : d.source === "ai_chat" ? " · from chat" : ""}</b>
        <small>${esc(gpRel(d.created_at))}${d.cta_type ? ` · ${esc(GP_CTA_LABEL[d.cta_type] || d.cta_type)} button` : " · no button"}</small></div>
      <div class="body">${d.photo ? `<img class="ph" src="${esc(d.photo.url)}" alt="">` : ""}
        <textarea class="gptext" data-gpsum="${esc(d.id)}" rows="${open ? 8 : 4}">${esc(d.summary)}</textarea></div>
      <div class="gpcount${n > GP_MAX ? " over" : n >= GP_WARN ? " warn" : ""}" data-gpcount="${esc(d.id)}">${gpCountText(n)}</div>
      ${d.error ? `<p class="note" style="color:var(--orange)">${esc(d.error)}</p>` : ""}
      <div class="rowbtns">
        <button class="btn em" data-gppost="${esc(d.id)}" ${n > GP_MAX ? "disabled" : ""}>Post to Google</button>
        <button class="btn" data-gpsave="${esc(d.id)}" ${n > GP_MAX ? "disabled" : ""}>Save edit</button>
        <button class="btn ghost" data-gpcancel="${esc(d.id)}">Discard</button>
      </div>
    </div>`;
  };
  // Truthful states: a post Ledger sent but never heard back about is
  // "unconfirmed" with a Check Google button — never a Post button; a post
  // Google rejected after the fact is "Failed" with the reason.
  const histRow = (h) => `<div class="gphist ${esc(h.status)}">
      ${h.photo ? `<img src="${esc(h.photo.url)}" alt="">` : `<i></i>`}
      <div><b${h.status === "unknown" || h.status === "posting" || h.status === "failed" ? ` style="color:var(--orange)"` : ""}>${{ posted: "Posted", failed: "Failed", expired: "Expired draft", deleted: "Removed from Google", unknown: "Unconfirmed — checking Google", posting: "Posting…" }[h.status] || h.status}${h.google_state && h.status === "posted" ? ` · ${esc(h.google_state.toLowerCase())}` : ""}</b>
        <p>${esc((h.summary || "").slice(0, 140))}${(h.summary || "").length > 140 ? "…" : ""}</p>
        ${(h.status === "unknown" || h.status === "failed") && h.error ? `<p class="note" style="color:var(--orange);margin:2px 0 0">${esc(h.error)}</p>` : ""}
        <small>${esc(gpRel(h.posted_at || h.created_at))}${h.cta_type ? ` · ${esc(GP_CTA_LABEL[h.cta_type] || h.cta_type)}` : ""}</small></div>
      ${h.status === "posted" ? `<div class="acts">${h.search_url ? `<a class="pillbtn sm" href="${esc(h.search_url)}" target="_blank" rel="noopener">View</a>` : ""}<button class="pillbtn sm" data-gpdel="${esc(h.id)}">Remove</button></div>`
        : h.status === "unknown" ? `<div class="acts"><button class="pillbtn sm" data-gpcheck="${esc(h.id)}">Check Google</button></div>` : ""}
    </div>`;
  const unconfirmed = history.filter((h) => h.status === "unknown" || h.status === "posting");
  // A grant that reaches more than one listing waits for the owner's choice (08-08).
  const locationChooser = b.location_pending ? `<div class="gpsec" style="margin-top:10px"><b>Which listing should Ledger post to?</b>
      <p class="note">This Google account manages ${(b.location_choices || []).length} listings. Pick one — Ledger only ever posts to the listing you choose.</p>
      ${(b.location_choices || []).map((c) => `<button class="btn" style="display:block;width:100%;text-align:left;margin-top:6px" data-gploc="${esc(c.name)}"><b>${esc(c.title || c.name)}</b>${c.address ? `<br><small class="note">${esc(c.address)}</small>` : ""}</button>`).join("")}</div>` : "";

  const rhythm = b.rhythm || { days: [], posted_30: posted.length, streak_weeks: 0 };
  const days14 = (rhythm.days || []).slice(-14);
  const next = gpNextLine(b);
  const live = s.enabled && s.mode === "auto";
  const laneTone = !b.connected ? "251,146,60" : live ? "47,224,160" : "58,200,245";
  const tile = (n, label, sig, isLive) => `<div class="cstat${n ? "" : " quiet"}" style="--sig:${sig}"><div class="ckrow"><span class="ckr">${label}</span>${isLive ? `<i class="cld"></i>` : ""}</div><b>${n}</b></div>`;

  slot.innerHTML = `<div class="gplane" style="--sig:${laneTone}">
    <div class="cglass gphero crise" style="--i:0">
      <div class="t"><div><div class="ckr" style="color:var(--cyan)">&#128227; GOOGLE POSTS</div>
          <b class="crtitle">${esc(b.business_name || "Your Google listing")}</b></div>
        <span class="cpill${live ? " live" : ""}" style="--sig:${!b.connected ? "251,146,60" : !s.enabled ? "141,154,168" : live ? "47,224,160" : "58,200,245"}"><i></i>${esc(status[0])}</span></div>
      <div class="cstats" style="margin-top:12px">
        ${tile(rhythm.streak_weeks || 0, "WEEKS IN A ROW", "47,224,160", false)}
        ${tile(rhythm.posted_30 || 0, "LAST 30 DAYS", "58,200,245", false)}
        ${tile(drafts.length, "WAITING", "251,191,36", drafts.length > 0)}
      </div>
      <div class="gpnext" style="color:${next[1]}"><span class="ic">&#9201;</span><span>${esc(next[0])}</span>
        <button class="cinfo" id="gpinfo" aria-label="How posting works">i</button></div>
      <div class="cfine" id="gpinfotext" hidden>Ledger writes each post from your own business facts and a fresh photo from your bin, and puts your button under it. Ask-first mode drafts and waits for your tap; autopilot posts on its own at your hour. The schedule check runs at 20 past the hour.</div>
    </div>

    <div class="cglass gpsec gpcard crise" style="--i:1;--sig:${drafts.length ? "47,224,160" : "58,200,245"}">
      ${drafts.length ? `<div class="t"><b>Waiting for your OK</b><span class="ckr">${drafts.length === 1 ? "1 DRAFT" : drafts.length + " DRAFTS"}</span></div>${drafts.map(draftCard).join("")}`
        : `<div class="ckr" style="color:var(--cyan)">NEXT UP</div>
           <p class="sub" style="margin-top:6px">${s.enabled ? "Ledger drafts the next post on schedule from a fresh photo. Want one sooner? Draft it now." : "Nothing waiting. Draft a post now, or turn on the schedule and Ledger keeps the listing fresh for you."}</p>`}
      ${unconfirmed.length ? `<p class="note" style="color:var(--orange)">&#9888; ${unconfirmed.length === 1 ? "One post" : unconfirmed.length + " posts"} Ledger sent but hasn't confirmed with Google yet — see Recent. Nothing goes out twice.</p>` : ""}
      ${locationChooser}
      <div class="rowbtns" style="margin-top:12px">
        <button class="btn em" id="gpnew" ${!b.connected || b.location_pending ? "disabled" : ""}>&#10024; Draft a post now</button>
        <button class="btn" id="gpsettings">Settings</button>
      </div>
      ${!b.connected ? `<p class="note">Connect Google Business Profile under Business profile &amp; settings first.</p>` : ""}
      ${b.connected && b.degraded ? `<p class="note" style="color:var(--orange)">${esc(b.degraded)} No need to reconnect.</p>` : ""}
      ${s.last_skip_reason && s.enabled ? `<p class="note" style="color:var(--orange)">&#9888; ${esc(s.last_skip_reason)}</p>` : ""}
    </div>

    <div class="cglass gpsec gpcard crise" style="--i:2"><div class="t"><b>Photo bin</b>
        <span class="gpbinacts">${photos.length ? `<button class="pillbtn sm" id="gpseeall">See all ${photos.length}</button>` : ""}
        <label class="pillbtn sm" style="cursor:pointer"><b>+ Add photos</b><input type="file" id="gpfiles" accept="image/*" multiple hidden></label></span></div>
      <p class="note">On your iPhone, anything you put in the <b>Ledger AI</b> album lands here on its own. Ledger checks each photo for faces, licence plates and paperwork — those wait for your OK.</p>
      ${photos.length ? `<div class="gpstrip" aria-label="Photo bin">${binOrder.slice(0, stripCount).map(gpPhotoCard).join("")}${binOrder.length > stripCount ? `<button class="gpph more" id="gpmore" aria-label="See all photos"><b>+${binOrder.length - stripCount}</b><small>more</small></button>` : ""}</div>` : `<p class="note" style="margin-top:8px">No photos yet — add a few shots of your work, your shop, your crew.</p>`}
      <div id="gpprog" class="note" style="display:none"></div>
    </div>

    <div class="cglass gpsec gpcard crise" style="--i:3">
      <div class="t"><span class="ckr" style="color:var(--cyan)">POSTING RHYTHM · 14 DAYS</span><span class="note" style="margin:0">${rhythm.posted_30 === 1 ? "1 post in 30 days" : (rhythm.posted_30 || 0) + " posts in 30 days"}</span></div>
      ${days14.length ? `<div class="cstrip" style="margin-top:10px">${days14.map((d) => `<div class="cday${d.today ? " today" : ""}" title="${esc(d.date)}${d.count ? " · " + d.count + (d.count === 1 ? " post" : " posts") : ""}"><div class="ccol">${d.count ? `<i style="height:${Math.max(14, Math.min(100, d.count * 50))}%"></i>` : d.today ? `<i class="base"></i>` : ""}</div><span>${esc(d.date.slice(-2))}</span></div>`).join("")}</div>
        <p class="cfine">Google shows your newest post on the listing — one steady post a week keeps something fresh in front of every searcher.</p>`
        : `<p class="note">Your first post starts the rhythm.</p>`}
    </div>

    ${gpCoachHTML()}

    ${history.length ? `<div class="cglass gpsec gpcard crise" style="--i:5"><div class="t"><b>Recent</b><button class="pillbtn sm" id="gphist">${GP.showHistory ? "Hide" : "Show " + history.length}</button></div>
      ${GP.showHistory ? history.map(histRow).join("") : unconfirmed.map(histRow).join("")}</div>` : ""}
  </div>`;

  $("gpfiles").onchange = (e) => gpUpload([...e.target.files]);
  $("gpnew").onclick = () => gpDraftSheet();
  $("gpsettings").onclick = () => gpSettingsSheet();
  if ($("gphist")) $("gphist").onclick = () => { GP.showHistory = !GP.showHistory; gpRender(); };
  if ($("gpseeall")) $("gpseeall").onclick = () => gpBinSheet();
  if ($("gpmore")) $("gpmore").onclick = () => gpBinSheet();
  on("[data-gpphoto]", "click", (e) => gpPhotoSheet(e.currentTarget.dataset.gpphoto), slot);
  on("[data-gppost]", "click", (e) => gpPublish(e.currentTarget.dataset.gppost, e.currentTarget), slot);
  on("[data-gpsave]", "click", (e) => gpSaveEdit(e.currentTarget.dataset.gpsave, e.currentTarget), slot);
  on("[data-gpcancel]", "click", (e) => gpCancel(e.currentTarget.dataset.gpcancel), slot);
  on("[data-gpdel]", "click", (e) => gpDelete(e.currentTarget.dataset.gpdel), slot);
  on("[data-gpcheck]", "click", (e) => gpReconcile(e.currentTarget.dataset.gpcheck, e.currentTarget), slot);
  on("[data-gploc]", "click", (e) => gpChooseLocation(e.currentTarget.dataset.gploc, e.currentTarget), slot);
  on("[data-gpsum]", "focus", (e) => { GP.expanded.add(e.currentTarget.dataset.gpsum); e.currentTarget.rows = 8; }, slot);
  on("[data-gpsum]", "input", (e) => gpCountUpdate(e.currentTarget), slot);
  if ($("gpinfo")) $("gpinfo").onclick = () => { const t = $("gpinfotext"); t.hidden = !t.hidden; };
  gpCoachWire(slot);
  // The pill badge follows the waiting count.
  const pill = document.querySelector('[data-lane="posts"]');
  if (pill) { const old = pill.querySelector(".badge"); if (old) old.remove(); if (drafts.length) pill.insertAdjacentHTML("beforeend", `<i class="badge">${drafts.length}</i>`); }
}

// "Next post" in the owner's words: the scheduled run, or why there is none.
function gpNextLine(b) {
  const s = b.settings || {};
  if (!b.connected) return ["Connect Google Business Profile under Business profile & settings and posting lights up.", "var(--orange)"];
  if (b.location_pending) return ["Choose which listing Ledger should post to (below) and posting lights up.", "var(--orange)"];
  if (s.last_skip_reason && s.enabled) return [s.last_skip_reason, "var(--orange)"];
  if (GP.scheduleNeedsRefresh && s.enabled) return ["Schedule saved — checking the next post time…", "var(--cyan)"];
  if (s.enabled && b.next_post_at) {
    const at = new Date(b.next_post_at);
    const now = new Date(); const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const day = at.toDateString() === now.toDateString() ? "today" : at.toDateString() === tomorrow.toDateString() ? "tomorrow" : at.toLocaleDateString(undefined, { weekday: "long" });
    const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return [s.mode === "auto" ? `Next automatic attempt: ${day} at ${time}.` : `Next draft lands ${day} at ${time} — you tap Post.`, s.mode === "auto" ? "var(--emerald)" : "var(--cyan)"];
  }
  return ["Nothing scheduled — draft one now, or turn on the schedule in Settings.", "var(--dim)"];
}

// Coach: what every owner should know about Google posts, one card at a
// time — universal facts, each ending with what Ledger does about it. "Got it"
// retires a card in this browser; the footer brings the set back.
const GP_COACH = [
  ["fresh", "&#10024;", "Fresh posts show on your listing", "Your newest posts sit right on your Google listing in Search and Maps. A listing with something new on it looks open and alive — a stale one looks closed.", "Ledger writes a post from your own shop's facts and a fresh photo, on your schedule."],
  ["rhythm", "&#127925;", "One post a week beats ten in a day", "Google shows the newest post first. A steady rhythm keeps something fresh in front of people every week; a burst disappears in days.", "Autopilot runs daily, Mon · Wed · Fri or weekly at the hour you pick."],
  ["button", "&#128073;", "Every post carries a button", "Book, Call now or Learn more sits right under the post, so a reader acts without hunting for your number or your site.", "Ledger uses your default button and writes the closing line to match it. Change it per post any time."],
  ["photo", "&#128247;", "Real photos win", "A phone shot of today's job beats a stock image every time. Faces, licence plates and paperwork need care — Google posts are public.", "Ledger checks every photo and holds anything with a face, a plate or paperwork until you OK it."],
  ["opener", "&#128204;", "The first line does the work", "People see the first line or two before they tap. That is why a post opens with the point, then the details as short bullets.", "Every draft: an emoji opener, two to four bullets, and a closing line that matches the button."],
  ["phone", "&#128245;", "Keep phone numbers out of the text", "Google rejects posts with a phone number in the words — the Call now button is the right way to offer one. Same idea for links: the button carries them.", "Ledger strips numbers from the text automatically and puts your number on the Call button when you choose it."],
  ["limit", "&#128207;", "1,500 characters, hard limit", "Google will not accept a longer post, and short and specific reads better anyway.", "Ledger keeps every draft under the limit and shows the count while you edit."],
  ["kinds", "&#128218;", "Three kinds of post", "Update: what's new. Offer: a deal with dates and an optional code. Event: something with a date and a title. Google shows offer and event details itself.", "Say it in chat — \"post an offer: 10% off brake service until Friday\" — or tap Draft a post now."],
];
const gpCoachDismissed = () => new Set(JSON.parse(accountStorage.getItem("ledger.gbpCoachDismissed") || "[]"));
function gpCoachHTML() {
  const gone = gpCoachDismissed();
  const tips = GP_COACH.filter(([id]) => !gone.has(id));
  return `<div class="cglass gpsec gpcard gpcoach crise" style="--i:4;--sig:251,191,36">
    <div class="t"><span class="ckr" style="color:var(--gold, #fbbf24)">COACH · WHY POSTS MATTER</span>${tips.length ? `<span class="ckr" id="gpcoachn">1 / ${tips.length}</span>` : ""}</div>
    ${tips.length ? `<div class="gptips" id="gptips">${tips.map(([id, ic, title, body, ledger], i) => `<div class="gptip" data-gptip="${id}" data-gpi="${i}">
        <div class="h"><span class="ic">${ic}</span><b>${esc(title)}</b></div>
        <p>${esc(body)}</p>
        <p class="ldg">&#10004; ${esc(ledger)}</p>
        <button class="pillbtn sm" data-gpgotit="${id}">Got it</button>
      </div>`).join("")}</div>`
      : `<div class="gpcoachdone"><span class="note" style="margin:0">You've read all ${GP_COACH.length} tips.</span><button class="pillbtn sm" id="gpcoachagain">Show again</button></div>`}
  </div>`;
}
function gpCoachWire(slot) {
  on("[data-gpgotit]", "click", (e) => {
    const gone = gpCoachDismissed(); gone.add(e.currentTarget.dataset.gpgotit);
    accountStorage.setItem("ledger.gbpCoachDismissed", JSON.stringify([...gone]));
    const card = e.currentTarget.closest(".gpcoach"); if (card) card.outerHTML = gpCoachHTML(); gpCoachWire($("gposts"));
  }, slot);
  if ($("gpcoachagain")) $("gpcoachagain").onclick = () => { accountStorage.removeItem("ledger.gbpCoachDismissed"); const card = $("gposts").querySelector(".gpcoach"); if (card) card.outerHTML = gpCoachHTML(); gpCoachWire($("gposts")); };
  const strip = $("gptips");
  if (strip) strip.onscroll = () => { const n = $("gpcoachn"); if (!n) return; const w = strip.firstElementChild ? strip.firstElementChild.getBoundingClientRect().width + 10 : 1; n.textContent = `${Math.min(strip.children.length, Math.round(strip.scrollLeft / w) + 1)} / ${strip.children.length}`; };
}

// Google's cap on post text, counted the way Google counts it (an emoji is two).
const GP_MAX = 1500;
const GP_WARN = 1400;
const gpLen = (s) => (s || "").length;
const gpCountText = (n) => n > GP_MAX ? `${n.toLocaleString()} / ${GP_MAX.toLocaleString()} — ${(n - GP_MAX).toLocaleString()} over Google's limit` : `${n.toLocaleString()} / ${GP_MAX.toLocaleString()}`;
function gpCountUpdate(ta) {
  const id = ta.dataset.gpsum; const n = gpLen(ta.value);
  const c = document.querySelector(`[data-gpcount="${CSS.escape(id)}"]`);
  if (c) { c.textContent = gpCountText(n); c.classList.toggle("over", n > GP_MAX); c.classList.toggle("warn", n <= GP_MAX && n >= GP_WARN); }
  for (const sel of [`[data-gppost="${CSS.escape(id)}"]`, `[data-gpsave="${CSS.escape(id)}"]`]) {
    const b = document.querySelector(sel); if (b) b.disabled = n > GP_MAX;
  }
}
function gpBinOrder(photos) {
  const rank = (p) => p.status === "flagged" ? 0 : !p.last_used_at ? 1 : 2;
  return [...photos].sort((a, b) => rank(a) - rank(b));
}
function gpPhotoCard(p) {
  return `<div class="gpph${p.status === "flagged" ? " flag" : ""}" data-gpphoto="${esc(p.id)}" title="${esc(p.caption || "")}" role="button" tabindex="0">
      <img src="${esc(p.url)}" alt="${esc(p.caption || "Photo")}" loading="lazy">
      ${p.status === "flagged" ? `<span class="tag warn">Needs OK</span>` : p.last_used_at ? `<span class="tag">Used</span>` : `<span class="tag fresh">Fresh</span>`}
    </div>`;
}
// Every photo, as a grid, in its own sheet — the desk stays one strip tall.
function gpBinSheet() {
  const photos = gpBinOrder((GP.board.photos || []).filter((p) => p.status !== "removed"));
  const flagged = photos.filter((p) => p.status === "flagged").length;
  const fresh = photos.filter((p) => p.status !== "flagged" && !p.last_used_at).length;
  sheet(`<div class="pcc-kicker">PHOTO BIN</div><h2>${photos.length} photo${photos.length === 1 ? "" : "s"}</h2>
    <p class="sub">${flagged ? `${flagged} need your OK · ` : ""}${fresh} fresh · ${photos.length - fresh - flagged} used. Tap one to approve it, draft a post with it, or remove it.</p>
    <div class="gpgrid">${photos.map(gpPhotoCard).join("")}</div>`, (sh) => {
    on("[data-gpphoto]", "click", (e) => { closeSheet(); setTimeout(() => gpPhotoSheet(e.currentTarget.dataset.gpphoto), 60); }, sh);
  });
}

async function gpUpload(files) {
  if (!files.length) return;
  const prog = $("gpprog"); let done = 0, dup = 0, flagged = 0;
  prog.style.display = "block";
  for (const file of files) {
    prog.textContent = `Adding ${done + 1} of ${files.length}…`;
    try {
      const image = await downscaleReceipt(file);
      const r = await api("/google-business-profile/photo-add", { image, media_type: "image/jpeg", source: "upload" });
      if (r.duplicate) dup++; else if (r.photo && r.photo.status === "flagged") flagged++;
      done++;
    } catch (e) {
      // An iPhone HEIC dropped into a browser that can't decode it: say so,
      // and where the same photo does work (08-10).
      const heic = /\.hei[cf]$/i.test(file.name || "") || /image\/hei[cf]/i.test(file.type || "");
      toast(heic && /readable image/i.test(e.message || "") ? "That's an iPhone HEIC photo, which this browser can't read — add it from the Ledger AI app on your phone, or export it as a JPEG first." : (e.message || "That photo didn't upload"), "err");
    }
  }
  prog.style.display = "none";
  toast(done ? `${done} photo${done === 1 ? "" : "s"} added${dup ? ` (${dup} already there)` : ""}${flagged ? ` · ${flagged} need your OK` : ""}` : "Nothing added");
  gpLoad(true);
}

function gpPhotoSheet(id) {
  const p = (GP.board.photos || []).find((x) => x.id === id); if (!p) return;
  const sf = p.safety || {};
  const why = [sf.faces && "a person's face", sf.plates && "a licence plate", sf.documents && "paperwork or a screen with text"].filter(Boolean).join(", ");
  sheet(`<h2>${p.status === "flagged" ? "Needs your OK" : "Photo"}</h2>
    <img src="${esc(p.url)}" alt="" style="width:100%;border-radius:14px;margin-top:10px">
    <p class="sub" style="margin-top:10px">${esc(p.caption || "")}</p>
    ${p.status === "flagged" ? `<p class="note">Ledger spotted ${esc(why || "something to check")}. Google posts are public — if you're fine with it, approve it and it joins the bin.</p>` : ""}
    <p class="note">${p.last_used_at ? `Used in a post ${esc(gpRel(p.last_used_at))}${p.used_count > 1 ? ` · ${p.used_count} times` : ""}.` : "Not used in a post yet."}</p>
    <div class="rowbtns">
      ${p.status === "flagged" ? `<button class="btn em" id="gpapprove">Approve for posting</button>` : `<button class="btn em" id="gpusenow">Draft a post with it</button>`}
      <button class="btn ghost" id="gpremove">Remove from bin</button>
    </div>`, (sh) => {
    const a = sh.querySelector("#gpapprove"); if (a) a.onclick = () => gpPhotoReview(id, "approve", a);
    const r = sh.querySelector("#gpremove"); r.onclick = () => gpPhotoReview(id, "remove", r);
    const u = sh.querySelector("#gpusenow"); if (u) u.onclick = () => { closeSheet(); gpDraftSheet(id); };
  });
}

async function gpPhotoReview(id, action, btn) {
  btn.disabled = true; btn.textContent = action === "approve" ? "Approving…" : "Removing…";
  try { await api("/google-business-profile/photo-review", { photo_id: id, action }); closeSheet(); toast(action === "approve" ? "Photo approved" : "Photo removed"); gpLoad(true); }
  catch (e) { btn.disabled = false; btn.textContent = action === "approve" ? "Approve for posting" : "Remove from bin"; toast(friendlyError(e, "Couldn't update that photo review. Try again."), "err"); }
}

function gpSettingsSheet() {
  const s = GP.board.settings || {};
  const suggestedPhone = GP.board.suggested_phone || "";
  const opt = (v, l, cur) => `<option value="${v}"${cur === v ? " selected" : ""}>${l}</option>`;
  sheet(`<div class="pcc-kicker">GOOGLE BUSINESS PROFILE</div><h2>Google Posts</h2>
    <p class="sub">Your posts, your photos, your buttons. Change anything, any time.</p>
    <div class="kv" style="align-items:center;margin-top:14px"><span><b>Post on a schedule</b><br><small class="note">Off means you still draft and post by hand whenever you like.</small></span>
      <button class="pswx${s.enabled ? " on" : ""}" id="gpen" role="switch" aria-checked="${!!s.enabled}" aria-label="Post on a schedule"><i></i></button></div>
    <label class="pcc-field">Before it goes on Google
      <select id="gpmode"><option value="approve"${s.mode !== "auto" ? " selected" : ""}>Ask me first — I tap Post</option><option value="auto"${s.mode === "auto" ? " selected" : ""}>Autopilot — post it for me</option></select></label>
    <label class="pcc-field">How often
      <select id="gpcad">${opt("daily", "Every day", s.cadence)}${opt("three_week", "Monday, Wednesday, Friday", s.cadence)}${opt("weekly", "Once a week (Monday)", s.cadence)}</select></label>
    <label class="pcc-field">What time
      <select id="gphour">${Array.from({ length: 24 }, (_, h) => opt(String(h), gpHour(h), String(s.post_hour ?? 9))).join("")}</select></label>
    <div class="kv" style="align-items:center;margin-top:16px"><span><b>Only post with a fresh photo</b><br><small class="note">No new photo in 30 days, no post. Keeps it real.</small></span>
      <button class="pswx${s.require_fresh_photo !== false ? " on" : ""}" id="gpfresh" role="switch" aria-checked="${s.require_fresh_photo !== false}" aria-label="Only post with a fresh photo"><i></i></button></div>
    <h3 style="margin-top:22px">The button under every post</h3>
    <label class="pcc-field">Default button
      <select id="gpcta">${opt("LEARN_MORE", "Learn more → your website", s.cta_default)}${opt("CALL", "Call now → your phone", s.cta_default)}${opt("BOOK", "Book → your Ledger booking page", s.cta_default)}${opt("NONE", "No button", s.cta_default)}</select></label>
    <label class="pcc-field">Your website (Learn more)<input id="gpweb" type="url" value="${esc(s.website_url || "")}" placeholder="https://yourshop.com" autocomplete="off"></label>
    <label class="pcc-field">Your phone (Call now)<input id="gpphone" type="tel" value="${esc(s.phone_number || suggestedPhone)}" placeholder="403 555 0142" autocomplete="off"></label>
    <p class="note">${s.booking_url ? `Book goes to <a href="${esc(s.booking_url)}" target="_blank" rel="noopener">your booking page</a>.` : "Turn on online booking under Business profile &amp; settings to use the Book button."} Google doesn't allow phone numbers in the post text — the Call now button is how customers reach you.</p>
    <div class="rowbtns" style="margin-top:18px"><button class="btn em" id="gpsave">Save</button></div>
    <p class="note" id="gperr" role="alert"></p>`, (sh) => {
    const sw = (id) => { const b = sh.querySelector(id); b.onclick = () => { b.classList.toggle("on"); b.setAttribute("aria-checked", b.classList.contains("on")); }; };
    sw("#gpen"); sw("#gpfresh");
    sh.querySelector("#gpsave").onclick = async () => {
      const btn = sh.querySelector("#gpsave"); btn.disabled = true; btn.textContent = "Saving…"; sh.querySelector("#gperr").textContent = "";
      try {
        const r = await api("/google-business-profile/posts-settings", {
          enabled: sh.querySelector("#gpen").classList.contains("on"),
          mode: sh.querySelector("#gpmode").value, cadence: sh.querySelector("#gpcad").value,
          post_hour: Number(sh.querySelector("#gphour").value), cta_default: sh.querySelector("#gpcta").value,
          website_url: sh.querySelector("#gpweb").value.trim(), phone_number: sh.querySelector("#gpphone").value.trim(),
          require_fresh_photo: sh.querySelector("#gpfresh").classList.contains("on"),
        });
        GP.loadGeneration++; // Invalidate reads started before the settings save.
        GP.board = { ...GP.board, settings: r.settings, next_post_at: null };
        GP.scheduleNeedsRefresh = true;
        closeSheet(); toast(r.settings.enabled ? (r.settings.mode === "auto" ? "Autopilot is on" : "Ledger will ask you before each post") : "Saved"); gpRender(); await gpLoad(true);
      } catch (e) { btn.disabled = false; btn.textContent = "Save"; sh.querySelector("#gperr").textContent = e.message; }
    };
  });
}

function gpDraftSheet(photoId) {
  const s = GP.board.settings || {};
  const photos = (GP.board.photos || []).filter((p) => p.status === "ready" || p.status === "used");
  const opt = (v, l, cur) => `<option value="${v}"${cur === v ? " selected" : ""}>${l}</option>`;
  sheet(`<h2>Draft a Google post</h2>
    <p class="sub">Tell Ledger the angle, or leave it blank for a what's-new post from your own business.</p>
    <label class="pcc-field">What's it about? (optional)<textarea id="gpbrief" rows="3" maxlength="600" placeholder="e.g. Fall booking week — we have openings Thursday and Friday" style="display:block;width:100%;margin-top:8px"></textarea></label>
    <label class="pcc-field">Kind of post<select id="gptopic">${opt("STANDARD", "Update", "STANDARD")}${opt("OFFER", "Offer (with dates)", "")}${opt("EVENT", "Event (with a date)", "")}</select></label>
    <div id="gpdates" style="display:none">
      <label class="pcc-field">Title<input id="gptitle" type="text" maxlength="58" placeholder="Short title Google shows"></label>
      <div class="rowbtns"><label class="pcc-field" style="flex:1">Starts<input id="gpstart" type="date"></label><label class="pcc-field" style="flex:1">Ends<input id="gpend" type="date"></label></div>
      <div id="gpoffer" style="display:none"><label class="pcc-field">Coupon code (optional)<input id="gpcoupon" type="text" maxlength="58"></label><label class="pcc-field">Terms (optional)<input id="gpterms" type="text" maxlength="200"></label></div>
    </div>
    <label class="pcc-field">Button<select id="gpdcta">${opt("", `Your default (${GP_CTA_LABEL[s.cta_default] || "none"})`, "")}${opt("LEARN_MORE", "Learn more", "")}${opt("CALL", "Call now", "")}${opt("BOOK", "Book", "")}${opt("NONE", "No button", "")}</select></label>
    <label class="pcc-field">Photo<select id="gpdphoto">${opt("auto", "Freshest photo in the bin", photoId ? "" : "auto")}${photos.map((p) => opt(p.id, (p.caption || "Photo").slice(0, 60) + (p.last_used_at ? " (used)" : ""), photoId || "")).join("")}${opt("none", "No photo", "")}</select></label>
    <div class="rowbtns" style="margin-top:18px"><button class="btn em" id="gpgo">&#10024; Write it</button></div>
    <p class="note" id="gpderr" role="alert"></p>`, (sh) => {
    const topic = sh.querySelector("#gptopic");
    topic.onchange = () => { sh.querySelector("#gpdates").style.display = topic.value === "STANDARD" ? "none" : "block"; sh.querySelector("#gpoffer").style.display = topic.value === "OFFER" ? "block" : "none"; };
    sh.querySelector("#gpgo").onclick = async () => {
      const btn = sh.querySelector("#gpgo"); btn.disabled = true; btn.textContent = "Writing…"; sh.querySelector("#gpderr").textContent = "";
      const photo = sh.querySelector("#gpdphoto").value;
      const body = { brief: sh.querySelector("#gpbrief").value.trim(), topic_type: topic.value, cta_type: sh.querySelector("#gpdcta").value || undefined };
      if (photo === "none") { body.photo_id = null; body.auto_photo = false; } else if (photo !== "auto") body.photo_id = photo;
      if (topic.value !== "STANDARD") {
        body.event = { title: sh.querySelector("#gptitle").value.trim(), start_date: sh.querySelector("#gpstart").value, end_date: sh.querySelector("#gpend").value };
        if (topic.value === "OFFER") body.offer = { coupon_code: sh.querySelector("#gpcoupon").value.trim(), terms: sh.querySelector("#gpterms").value.trim() };
      }
      try {
        const r = await api("/google-business-profile/post-draft", body);
        closeSheet(); toast("Draft ready — read it over, then Post"); GP.expanded.add(r.post.id); await gpLoad(true);
        const card = document.querySelector(`[data-gpdraft="${r.post.id}"]`); if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e) {
        btn.disabled = false; btn.textContent = "✨ Write it";
        sh.querySelector("#gpderr").textContent = e.message === "ai_budget_exhausted" ? "This month's AI allowance is used up — add a Power-Up to keep drafting." : e.message;
      }
    };
  });
}

async function gpSaveEdit(id, btn) {
  const ta = document.querySelector(`[data-gpsum="${id}"]`); if (!ta) return;
  btn.disabled = true; btn.textContent = "Saving…";
  try { await api("/google-business-profile/post-update", { post_id: id, summary: ta.value }); toast("Edit saved"); await gpLoad(true); }
  catch (e) { btn.disabled = false; btn.textContent = "Save edit"; toast(friendlyError(e, "Couldn't save your edit. Try again."), "err"); }
}

async function gpPublish(id, btn) {
  const ta = document.querySelector(`[data-gpsum="${id}"]`);
  const draft = (GP.board.drafts || []).find((d) => d.id === id);
  btn.disabled = true; btn.textContent = "Posting…";
  try {
    if (ta && draft && ta.value.trim() !== (draft.summary || "").trim()) await api("/google-business-profile/post-update", { post_id: id, summary: ta.value });
    const r = await api("/google-business-profile/post-publish", { post_id: id });
    toast(r.post && r.post.google_state === "LIVE" ? "Posted — it's live on Google" : "Posted — Google is putting it up now");
    GP.showHistory = true; await gpLoad(true);
  } catch (e) {
    // Sent but unanswered (08-01): the post is on hold under Recent with a
    // Check Google button — there is no Post button to tap again.
    if (e.data && e.data.post_status === "unknown") { toast(friendlyError(e, "Couldn't confirm whether the post went to Google. Check the history."), "err"); GP.showHistory = true; gpLoad(true); return; }
    btn.disabled = false; btn.textContent = "Post to Google"; toast(friendlyError(e, "Couldn't post to Google. Nothing was published — try again."), "err"); gpLoad(true);
  }
}

// "Check Google" on an unconfirmed post: Ledger asks Google's own list whether
// the post landed. Posted → it moves to history with its Google name; not
// there after a settling period → it comes back as a draft. Never re-posts.
async function gpReconcile(id, btn) {
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    const r = await api("/google-business-profile/post-reconcile", { post_id: id });
    toast(r.outcome === "posted" ? "Found it — the post is on Google" : r.outcome === "draft" ? "Google never got it — it's back as a draft" : "Still checking — Google hasn't shown it yet. Try again in a few minutes.");
    await gpLoad(true);
  } catch (e) { btn.disabled = false; btn.textContent = "Check Google"; toast(friendlyError(e, "Couldn't check Google for that post. Try again."), "err"); }
}

// One-time listing choice for a Google account that manages several (08-08).
async function gpChooseLocation(name, btn) {
  btn.disabled = true;
  try {
    const r = await api("/google-business-profile/posts-location", { location_name: name });
    toast(`Ledger will post to ${r.bound && r.bound.business_name ? r.bound.business_name : "that listing"}`);
    await gpLoad(true);
  } catch (e) { btn.disabled = false; toast(friendlyError(e, "Couldn't load your Business Profile locations. Try again."), "err"); }
}

async function gpCancel(id) {
  try { await api("/google-business-profile/post-cancel", { post_id: id }); toast("Draft discarded"); gpLoad(true); }
  catch (e) { toast(friendlyError(e, "Couldn't cancel that post. Try again."), "err"); }
}

function gpDelete(id) {
  sheet(`<h2>Remove this post from Google?</h2><p class="sub">Customers won't see it any more. You can always post a new one.</p>
    <div class="rowbtns"><button class="btn" id="gpdelyes" style="color:var(--red)">Remove from Google</button><button class="btn ghost" id="gpdelno">Keep it</button></div>`, (sh) => {
    sh.querySelector("#gpdelno").onclick = closeSheet;
    sh.querySelector("#gpdelyes").onclick = async () => {
      const b = sh.querySelector("#gpdelyes"); b.disabled = true; b.textContent = "Removing…";
      try { await api("/google-business-profile/post-delete", { post_id: id }); closeSheet(); toast("Removed from Google"); gpLoad(true); }
      catch (e) { b.disabled = false; b.textContent = "Remove from Google"; toast(friendlyError(e, "Couldn't remove that post from Google. Try again."), "err"); }
    };
  });
}

const reviewAsked = () => new Set((accountStorage.getItem("kmj.reviewRequestedCustomerIDs") || "").split(",").filter(Boolean));
const markReviewAsked = (id) => { const s = reviewAsked(); s.add(id); accountStorage.setItem("kmj.reviewRequestedCustomerIDs", [...s].sort().join(",")); };

/* ---- Customers tab shared pieces (iPhone parity, 2026-09-07) ---- */

// Web twin of iOS CustomerIntelligenceHero: the money number big, then four
// tiles that say in words what each number means.
function custHero(o) {
  const reachDetail = !o.total ? "add your first one below"
    : o.reachable === o.total ? "all reachable by phone or email"
    : `${o.reachable} reachable by phone or email`;
  const owingDetail = !o.owingCount ? "nobody owes you"
    : `${o.owingCount} customer${o.owingCount === 1 ? "" : "s"}${o.overdueCount ? ` · ${o.overdueCount} overdue` : ""}`;
  const tile = (label, value, detail, tint) =>
    `<div class="ctile ${tint}"><small>${esc(label)}</small><b>${value}</b><i>${esc(detail)}</i></div>`;
  return `<div class="cihero">
        <div class="t"><span class="eyebrow">&#128101; Customers</span>
          <span class="livechip">${o.native ? "LIVE · YOUR BOOKS" : "LIVE · QUICKBOOKS"}</span></div>
        <div class="bignum"><small>Customer revenue</small><b>${money0(o.lifetime)}</b></div>
        <div class="ctiles">
          ${tile("On file", o.total, reachDetail, "cyan")}
          ${tile("Buyers", o.buyers, o.buyers === 1 ? "has an invoice on record" : "have an invoice on record", "purple")}
          ${tile("Owing", money0(o.owingTotal), owingDetail, o.overdueCount ? "red" : o.owingCount ? "orange" : "em")}
          ${tile("Reviews asked", o.asked, o.asked ? "sent from this device" : "start with the card below", "gold")}
        </div>
      </div>`;
}

// One directory row — iOS CustomerDirectoryCard. The whole top opens the
// profile; Call and Text sit on the card so the phone is one tap away.
function custCard(c, o) {
  const contact = [c.phone, c.email].filter(Boolean).join(" · ");
  const tel = String(c.mobile || c.phone || "").replace(/[^0-9+]/g, "");
  const reach = tel
    ? `<a class="actbtn em" href="tel:${esc(tel)}">&#128222;&nbsp; Call</a>
             <a class="actbtn c" href="sms:${esc(tel)}">&#128172;&nbsp; Text</a>`
    : c.email ? `<a class="actbtn v" href="mailto:${esc(c.email)}">&#9993;&nbsp; Email</a>`
      : `<button class="actbtn" ${o.openAttr}="${esc(c.id)}">&#128100;&nbsp; Full profile</button>`;
  return `<div class="ccard">
          <button class="top" ${o.openAttr}="${esc(c.id)}">
            <div class="avaw"><div class="ava ${o.overdue ? "od" : c.balance > 0 ? "ow" : ""}">${sigilMark(c.name)}<i class="rail"></i></div>
              <i class="tick ${c.active === false ? "off" : ""}"></i></div>
            <div class="who"><b>${esc(c.name)}</b>
              <span>${contact ? esc(contact) : "No phone or email on file"}</span>
              <i>${esc(o.recordLine)}</i></div>
            ${c.balance > 0 ? `<span class="balchip ${o.overdue ? "od" : ""}">${money(c.balance)}${o.overdue ? " overdue" : ""}</span>` : ""}
            <span class="chev">&#8250;</span>
          </button>
          <div class="acts">${reach}
            <button class="actbtn p" data-review="${esc(c.id)}">${o.asked ? "&#10003;&nbsp; Asked" : "&#11088;&nbsp; Review"}</button>
          </div>
        </div>`;
}

// "Ranger Tire · 6 invoices · last Aug 22" — the quiet third line on a card.
function custRecordLine(c, count, lastDate) {
  const parts = [];
  if (c.company && String(c.company).toLowerCase() !== String(c.name || "").toLowerCase()) parts.push(c.company);
  parts.push(!count ? "No invoices yet" : count === 1 ? "1 invoice" : `${count} invoices`);
  if (lastDate) parts.push("last " + dateShort(lastDate));
  return parts.join(" · ");
}

// The "24 of 312" line above the list, so a filtered view never looks empty.
function custCountText(shown, total) {
  if (!total) return "No customers yet";
  if (shown === total) return total === 1 ? "1 customer" : `${total} customers`;
  return `${shown} of ${total}`;
}

async function loadDirectory() {
  const slot = $("lanebody"); if (!slot) return;
  // Same branch iOS makes: built-in books gets its own directory off
  // books_customers — the QuickBooks wall only belongs to QuickBooks shops.
  if (S.booksProvider === undefined) {
    try { S.booksProvider = (await booksApi({ action: "settings" })).provider; }
    catch { slot.innerHTML = pvretry("Could not load your customer settings."); wireRetry(slot, loadDirectory); return; }
  }
  if (S.booksProvider === "native") return loadNativeDirectory();
  try {
    if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
    const all = (S.qbo?.qbo?.customers || []).filter((c) => c.active !== false);
    const invoices = S.qbo?.qbo?.invoices || [];
    const asked = reviewAsked();
    const q = (S.custSearch || "").toLowerCase();
    const sort = S.custSort || "name";
    const lastInvoice = {};
    const invCount = {};
    invoices.forEach((i) => {
      invCount[i.customer_id] = (invCount[i.customer_id] || 0) + 1;
      if (!lastInvoice[i.customer_id] || i.date > lastInvoice[i.customer_id]) lastInvoice[i.customer_id] = i.date;
    });
    const lastPaid = {};
    invoices.filter((i) => Number(i.balance) === 0).forEach((i) => {
      if (!lastPaid[i.customer_id] || i.date > lastPaid[i.customer_id]) lastPaid[i.customer_id] = i.date;
    });
    // iOS PremiumCustomerCard turns the balance red when any invoice is past its due date.
    const todayISO = localDay();
    const overdueIds = new Set(invoices
      .filter((i) => Number(i.balance) > 0 && i.due_date && i.due_date < todayISO)
      .map((i) => i.customer_id));

    // iOS CustomerIntelligenceHero figures
    const reachable = all.filter((c) => c.phone || c.email).length;
    const buyers = new Set(invoices.map((i) => i.customer_id)).size;
    const lifetime = invoices.reduce((t, i) => t + (Number(i.total) || 0), 0);

    // iOS ReviewOpportunityPanel queue: paid customers we can reach and haven't asked yet
    const reviewQueue = all
      .filter((c) => (c.phone || c.email) && !asked.has(c.id) && lastPaid[c.id])
      .sort((a, b) => (lastPaid[b.id] || "").localeCompare(lastPaid[a.id] || ""));
    const qHead = reviewQueue.slice(0, 5);

    let list = all.filter((c) => !q || (c.name + " " + (c.email || "") + " " + (c.phone || "") + " " + c.id).toLowerCase().includes(q));
    if (S.custBalancesOnly) list = list.filter((c) => Number(c.balance) > 0);
    list = list.slice().sort((a, b) =>
      sort === "owing" ? Number(b.balance) - Number(a.balance)
      : sort === "recent" ? (lastInvoice[b.id] || "").localeCompare(lastInvoice[a.id] || "")
      : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    slot.innerHTML = `
      ${custHero({ total: all.length, reachable, buyers, lifetime, asked: asked.size,
        owingTotal: all.reduce((t, c) => t + (Number(c.balance) > 0 ? Number(c.balance) : 0), 0),
        owingCount: all.filter((c) => Number(c.balance) > 0).length,
        overdueCount: all.filter((c) => overdueIds.has(c.id)).length })}
      ${todoCardHTML()}
      <div class="revpanel">
        <div class="t"><div><span class="eyebrow" style="color:var(--magenta)">Review opportunities</span>
          <b>${qHead.length ? "Recent customers ready to ask" : "You\u2019re caught up"}</b></div>
          <span class="cnt">${reviewQueue.length} READY</span></div>
        ${qHead.length ? `<button class="asknext" data-review="${esc(qHead[0].id)}">
            <span class="ic">&#11088;</span>
            <span class="m"><small>Ask next</small><b>${esc(qHead[0].name)}</b>
              <span>${esc(qHead[0].phone || qHead[0].email)}</span></span>
            <span class="go">&#8594;</span></button>
          ${qHead.length > 1 ? `<div class="askrow">${qHead.slice(1).map((c) =>
            `<button class="askpill" data-review="${esc(c.id)}"><i>${esc(c.name.slice(0, 1).toUpperCase())}</i>${esc(c.name)} &#11088;</button>`).join("")}</div>` : ""}`
          : `<p class="note">No eligible recent customers waiting for a review request.</p>`}
      </div>
      <div class="searchwrap"><span class="mag">${MAG}</span>
        <input id="csearch" placeholder="Customer, invoice, email or phone" value="${esc(S.custSearch || "")}">${S.custSearch ? `<button class="clr" id="cclr" title="Clear search">&#10005;</button>` : ""}</div>
      <div class="dirbar">
        <span class="eyebrow">Customer directory</span>
        <span class="dircount">${custCountText(list.length, all.length)}</span>
        <button class="pillbtn em" id="cadd">+ Add</button>
        <select class="pillbtn" id="csort">
          ${[["name", "A–Z"], ["owing", "Owing"], ["recent", "Recent"]].map(([k, l]) =>
            `<option value="${k}" ${sort === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="pillbtn ${S.custBalancesOnly ? "hot" : ""}" id="cbal">${S.custBalancesOnly ? "Balances" : "All"}</button>
      </div>
      ${list.length ? list.slice(0, S.custShowAll ? list.length : 120).map((c) => {
        return custCard(c, { openAttr: "data-cust", overdue: overdueIds.has(c.id), asked: asked.has(c.id),
          recordLine: custRecordLine(c, invCount[c.id] || 0, lastInvoice[c.id]) });
      }).join("") + (!S.custShowAll && list.length > 120
        ? `<button class="btn ghost wide" style="margin-top:10px" id="cmore">Show all ${list.length} customers (${list.length - 120} more)</button>`
        : "")
      : `<div class="empty">No customers found.<br>Try a different name, email, phone or QBO ID.</div>`}`;
    if ($("cmore")) $("cmore").onclick = () => { S.custShowAll = true; loadDirectory(); };
    const sb = $("csearch");
    sb.addEventListener("input", () => { S.custSearch = sb.value; clearTimeout(S._c); S._c = setTimeout(loadDirectory, 220); });
    $("csort").onchange = (e) => { S.custSort = e.target.value; loadDirectory(); };
    $("cbal").onclick = () => { S.custBalancesOnly = !S.custBalancesOnly; loadDirectory(); };
    if ($("cclr")) $("cclr").onclick = () => { S.custSearch = ""; loadDirectory(); };
    $("cadd").onclick = () => newCustomerSheet();
    on("[data-cust]", "click", (e) => customerSheet(all.find((c) => c.id === e.currentTarget.dataset.cust)), slot);
    wireTodoCard();
    on("[data-review]", "click", (e) => {
      const c = all.find((x) => x.id === e.currentTarget.dataset.review);
      if (c) reviewSheet(c, asked.has(c.id));
    }, slot);
  } catch (e) {
    slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(slot);
  }
}

// Google Business review destination — same source as iOS: this workspace's own
// connector row, and nothing else. There is deliberately no built-in fallback
// link: a review page belongs to one business, so a shop with no connected
// listing gets no link rather than somebody else's.
async function reviewTarget() {
  if (S.reviewUrl !== undefined) return S.reviewUrl;
  S.reviewUrl = { url: null, name: S.profile?.business?.name || "Your business" };
  try {
    const t = await token();
    const r = await fetch(`${SUPA_URL}/rest/v1/connector_accounts?connector=eq.google_business_profile&select=status,display_name,public_config&order=updated_at.desc&limit=1`,
      { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + t } });
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) S.reviewUrl = {
      url: row.public_config?.review_uri || null,
      name: row.display_name || S.profile?.business?.name || "Your business",
    };
  } catch { /* no connector row reachable — stay linkless */ }
  return S.reviewUrl;
}

// Review request — the web twin of iOS ReviewRequestSheet. Nothing sends automatically:
// the tap opens the user's own SMS or mail client with the message pre-filled.
async function reviewSheet(c, already) {
  const { url, name } = await reviewTarget();
  const first = (c.name || "").split(" ")[0] || c.name;
  const msg = `Hi ${first}! Thanks again for choosing ${name}. If you have a moment, would you mind sharing your experience? It really helps our local business:${url ? " " + url : ""}`;
  const btn = (id, icon, title, detail, tint) => `<button class="revbtn ${tint}" id="${id}">
      <span class="ic">${icon}</span><span class="m"><b>${esc(title)}</b><span>${esc(detail)}</span></span>
      <span class="chev">&#8250;</span></button>`;
  sheet(`<h2>${already ? "Review already requested" : "Ask " + esc(first) + " for a review?"}</h2>
    <p class="sh-sub">${url ? `The verified direct-review link for ${esc(name)} is ready.` : "Connect Google Business Profile to load your verified direct-review link."}</p>
    <div class="eyebrow">Message preview</div>
    <p class="note" style="white-space:pre-wrap;margin-top:7px">${esc(msg)}</p>
    <div class="cmpsect" style="margin-top:14px">
      ${c.phone ? btn("rvsms", "&#128172;", "Open in Messages", c.phone, "em") : ""}
      ${c.email ? btn("rvmail", "&#9993;", "Open in Mail", c.email, "cyan") : ""}
      ${url ? btn("rvcopy", "&#128279;", "Copy review link", name, "purple") : ""}
      ${url ? btn("rvopen", "&#8599;", "Preview review page", "Opens Google Reviews", "gold") : ""}
      ${url ? "" : `<p class="note" style="color:var(--amber,#f5a524)">Connect Google Business Profile in Settings to enable sending.</p>`}
    </div>
    <p class="note">Nothing is sent automatically. You review the exact message in Messages or Mail before sending.</p>`, (sh) => {
    const done = () => { markReviewAsked(c.id); closeSheet(); loadDirectory(); if (S.tab === "home") loadHomeCustomers(); };
    const sms = sh.querySelector("#rvsms");
    if (sms) { sms.disabled = !url; sms.style.opacity = url ? "" : "0.45";
      sms.onclick = () => { if (!url) return; window.location.href = `sms:${c.phone}?&body=${encodeURIComponent(msg)}`; done(); }; }
    const mail = sh.querySelector("#rvmail");
    if (mail) { mail.disabled = !url; mail.style.opacity = url ? "" : "0.45";
      mail.onclick = () => {
        if (!url) return;
        window.location.href = `mailto:${c.email}?subject=${encodeURIComponent("Thank you from " + name)}&body=${encodeURIComponent(msg)}`;
        done();
      }; }
    const cp = sh.querySelector("#rvcopy");
    if (cp) cp.onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast("Review link copied"); } catch { toast("Copy failed", "err"); }
    };
    const op = sh.querySelector("#rvopen");
    if (op) op.onclick = () => window.open(url, "_blank", "noopener");
  });
}

// New QuickBooks customer — the web twin of iOS NewCustomerSheet, including the
// duplicate-match guard: a 409 lists the existing matches before anything is created.
// `prefill` is a lead row (iOS NewCustomerSheet(prefill:)); `onCreated` fires with
// the created customer so the caller can mark that lead won and link it.
// Built-in books directory: the same intelligence hero, review queue and
// customer cards as the QuickBooks lane, fed by books_customers/invoices.
async function loadNativeDirectory() {
  const slot = $("lanebody"); if (!slot) return;
  try {
    const [cd, inv] = await Promise.all([
      booksApi({ action: "customers" }),
      booksApi({ action: "invoices" }),
    ]);
    if (!Array.isArray(cd.customers) || !Array.isArray(inv.invoices)) throw new Error("Customer details could not be read. Try again.");
    const invoices = inv.invoices;
    const balanceBy = {}, lastPaid = {}, lastInvoice = {}, invCount = {};
    const todayISO = localDay();
    const overdueIds = new Set();
    for (const i of invoices) {
      if (!i.customer_id) continue;
      balanceBy[i.customer_id] = (balanceBy[i.customer_id] || 0) + Number(i.balance || 0);
      invCount[i.customer_id] = (invCount[i.customer_id] || 0) + 1;
      if (!lastInvoice[i.customer_id] || (i.issue_date || "") > lastInvoice[i.customer_id]) lastInvoice[i.customer_id] = i.issue_date || "";
      if (Number(i.balance) === 0 && (!lastPaid[i.customer_id] || (i.issue_date || "") > lastPaid[i.customer_id])) lastPaid[i.customer_id] = i.issue_date || "";
      if (Number(i.balance) > 0 && i.due_date && i.due_date < todayISO) overdueIds.add(i.customer_id);
    }
    const all = (cd.customers || []).map((c) => ({
      id: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company || "\u2014",
      company: c.company || "", email: c.email || "", phone: c.phone || "",
      balance: balanceBy[c.id] || 0, active: true, raw: c,
    }));
    const asked = reviewAsked();
    const q = (S.custSearch || "").toLowerCase();
    const sort = S.custSort || "name";
    const reachable = all.filter((c) => c.phone || c.email).length;
    const buyers = new Set(invoices.map((i) => i.customer_id).filter(Boolean)).size;
    const lifetime = invoices.reduce((tt, i) => tt + (Number(i.total) || 0), 0);
    const reviewQueue = all.filter((c) => (c.phone || c.email) && !asked.has(c.id) && lastPaid[c.id])
      .sort((a, b) => (lastPaid[b.id] || "").localeCompare(lastPaid[a.id] || ""));
    const qHead = reviewQueue.slice(0, 5);
    let list = all.filter((c) => !q || (c.name + " " + c.email + " " + c.phone + " " + c.company).toLowerCase().includes(q));
    if (S.custBalancesOnly) list = list.filter((c) => c.balance > 0);
    list = list.slice().sort((a, b) =>
      sort === "owing" ? b.balance - a.balance
      : sort === "recent" ? (lastInvoice[b.id] || "").localeCompare(lastInvoice[a.id] || "")
      : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    slot.innerHTML = `
      ${custHero({ native: true, total: all.length, reachable, buyers, lifetime, asked: asked.size,
        owingTotal: all.reduce((t, c) => t + (c.balance > 0 ? c.balance : 0), 0),
        owingCount: all.filter((c) => c.balance > 0).length,
        overdueCount: all.filter((c) => overdueIds.has(c.id)).length })}
      ${todoCardHTML()}
      <div class="revpanel">
        <div class="t"><div><span class="eyebrow" style="color:var(--magenta)">Review opportunities</span>
          <b>${qHead.length ? "Recent customers ready to ask" : "You’re caught up"}</b></div>
          <span class="cnt">${reviewQueue.length} READY</span></div>
        ${qHead.length ? `<button class="asknext" data-review="${esc(qHead[0].id)}">
            <span class="ic">&#11088;</span>
            <span class="m"><small>Ask next</small><b>${esc(qHead[0].name)}</b>
              <span>${esc(qHead[0].phone || qHead[0].email)}</span></span>
            <span class="go">&#8594;</span></button>
          ${qHead.length > 1 ? `<div class="askrow">${qHead.slice(1).map((c) =>
            `<button class="askpill" data-review="${esc(c.id)}"><i>${esc(c.name.slice(0, 1).toUpperCase())}</i>${esc(c.name)} &#11088;</button>`).join("")}</div>` : ""}`
          : `<p class="note">No eligible recent customers waiting for a review request.</p>`}
      </div>
      <div class="searchwrap"><span class="mag">${MAG}</span>
        <input id="csearch" placeholder="Customer, email or phone" value="${esc(S.custSearch || "")}">${S.custSearch ? `<button class="clr" id="cclr" title="Clear search">&#10005;</button>` : ""}</div>
      <div class="dirbar">
        <span class="eyebrow">Customer directory</span>
        <span class="dircount">${custCountText(list.length, all.length)}</span>
        <button class="pillbtn em" id="cadd">+ Add</button>
        <select class="pillbtn" id="csort">
          ${[["name", "A\u2013Z"], ["owing", "Owing"], ["recent", "Recent"]].map(([k, l]) =>
            `<option value="${k}" ${sort === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="pillbtn ${S.custBalancesOnly ? "hot" : ""}" id="cbal">${S.custBalancesOnly ? "Balances" : "All"}</button>
      </div>
      ${list.length ? list.slice(0, S.custShowAll ? list.length : 120).map((c) => {
        return custCard(c, { openAttr: "data-nprof", overdue: overdueIds.has(c.id), asked: asked.has(c.id),
          recordLine: custRecordLine(c, invCount[c.id] || 0, lastInvoice[c.id]) });
      }).join("")
      : `<div class="panel" style="text-align:center"><p class="sub" style="margin:0">No customers yet \u2014 add your first one, or create an invoice and Ledger saves the customer with it.</p></div>`}`;
    const sb = $("csearch");
    sb.addEventListener("input", () => { S.custSearch = sb.value; clearTimeout(S._c); S._c = setTimeout(loadDirectory, 220); });
    $("csort").onchange = (e) => { S.custSort = e.target.value; loadDirectory(); };
    $("cbal").onclick = () => { S.custBalancesOnly = !S.custBalancesOnly; loadDirectory(); };
    if ($("cclr")) $("cclr").onclick = () => { S.custSearch = ""; loadDirectory(); };
    $("cadd").onclick = () => nativeCustomerSheet(null);
    S.nativeDirRows = all; S.nativeInvoices = invoices;
    on("[data-nprof]", "click", (e) => nativeProfileSheet(all.find((c) => c.id === e.currentTarget.dataset.nprof)), slot);
    wireTodoCard();
    on("[data-review]", "click", (e) => {
      const c = all.find((x) => x.id === e.currentTarget.dataset.review);
      if (c) reviewSheet(c, asked.has(c.id));
    }, slot);
  } catch (e) {
    slot.innerHTML = pvretry(e.message); wireRetry(slot, loadNativeDirectory);
  }
}

// Add or edit a built-in-books customer — same fields as the iOS
// NewCustomerSheet's native mode, saved through books customer-save.
// Full profile for a built-in-books customer — the web twin of iOS
// NativeCustomerDetailView. Same shape as the QuickBooks profile: money tiles,
// duplicate warning, contact record, account, invoices and appointments.
// Edit opens the customer form; an invoice row opens the native invoice sheet.
function nativeProfileSheet(c) {
  if (!c) return;
  const inv = (S.nativeInvoices || [])
    .filter((i) => i.customer_id === c.id && i.status !== "void")
    .sort((a, b) => String(b.issue_date || "").localeCompare(String(a.issue_date || "")));
  const today = localDay();
  const open = inv.filter((i) => Number(i.balance) > 0);
  const paid = inv.filter((i) => Number(i.balance) <= 0);
  const overdue = open.filter((i) => i.due_date && i.due_date < today);
  const overdueAmt = overdue.reduce((t, i) => t + (Number(i.balance) || 0), 0);
  const outstanding = open.reduce((t, i) => t + (Number(i.balance) || 0), 0);
  const lifetime = inv.reduce((t, i) => t + (Number(i.total) || 0), 0);
  const avg = inv.length ? lifetime / inv.length : 0;
  const last = inv[0];
  const nkey = (v) => (v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const pkey = (v) => (v || "").replace(/\D/g, "").slice(-10);
  const dupes = (S.nativeDirRows || []).filter((o) => o.id !== c.id && (
    (c.email && (o.email || "").toLowerCase() === String(c.email).toLowerCase()) ||
    (c.phone && pkey(o.phone) && pkey(o.phone) === pkey(c.phone)) ||
    nkey(o.name) === nkey(c.name)));
  const terms = (c.name || "").toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const events = !terms.length ? [] : calEvents().filter((e) => {
    const hay = ((e.title || "") + " " + (e.description || "")).toLowerCase();
    return terms.every((t) => hay.includes(t));
  }).sort((a, b) => String(b.start).localeCompare(String(a.start)));
  const tel = String(c.phone || "").replace(/[^0-9+]/g, "");
  const since = c.raw?.created_at
    ? new Date(c.raw.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const invRows = (rows) => rows.map((i) => `<button class="item" data-pinv="${esc(i.id)}">
    <div class="main"><div class="ttl">${esc(i.number || "Invoice")}</div><div class="sub">${esc(dateShort(i.issue_date))}</div></div>
    <div class="amt">${money(i.total)}<small><span class="tag ${esc(i.status || "")}">${esc(i.status || "")}</span></small></div></button>`).join("");
  const kv = (label, value) => value ? `<div class="kv"><span>${esc(label)}</span><span>${esc(value)}</span></div>` : "";

  sheet(`<h2>${esc(c.name)}</h2>
    <p class="sh-sub">${esc(c.company || "In your books")}</p>
    ${tel || c.email ? `<div class="rowbtns" style="margin-top:4px">
      ${tel ? `<a class="btn ghost" href="tel:${esc(tel)}">&#128222; Call</a>
               <a class="btn ghost" href="sms:${esc(tel)}">&#128172; Text</a>` : ""}
      ${c.email ? `<a class="btn ghost" href="mailto:${esc(c.email)}">&#9993; Email</a>` : ""}
    </div>` : ""}
    <button class="btn primary wide" style="margin-top:9px" id="cask">&#10022; Ask Ledger about ${esc((c.name || "").split(" ")[0] || c.name)}</button>

    <div id="hubslot" style="margin-top:12px"></div>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi cyan"><small>Lifetime sales</small><b>${money0(lifetime)}</b></div>
      <div class="kpi em"><small>Average sale</small><b>${money0(avg)}</b></div>
      <div class="kpi ${outstanding > 0 ? "orange" : "gold"}"><small>Outstanding</small><b>${money0(outstanding)}</b></div>
      <div class="kpi ${overdueAmt > 0 ? "red" : "purple"}"><small>Overdue</small><b>${money0(overdueAmt)}</b></div>
    </div>

    ${dupes.length ? `<div class="eyebrow" style="margin-top:16px;color:var(--orange)">Duplicate warning</div>
      <div class="note err" style="margin-top:6px">&#9888; ${dupes.length} other profile${dupes.length === 1 ? "" : "s"} share${dupes.length === 1 ? "s" : ""} this name, phone or email. Keep invoices on one record so balances stay right.</div>
      ${dupes.map((d) => `<div class="kv"><span>${esc(d.phone || d.email || "—")}</span><span>${esc(d.name)}</span></div>`).join("")}` : ""}

    <div class="eyebrow" style="margin-top:16px">Contact &amp; record</div>
    ${kv("Customer", c.name)}
    ${kv("Company", c.company)}
    <div class="kv"><span>Email</span><span>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "Not on file"}</span></div>
    <div class="kv"><span>Phone</span><span>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : "Not on file"}</span></div>
    ${kv("Customer since", since)}

    <div class="eyebrow" style="margin-top:16px">Account status</div>
    <div class="kv"><span>Paid invoices</span><span>${paid.length}</span></div>
    <div class="kv"><span>Open invoices</span><span>${open.length}</span></div>
    <div class="kv"><span>Overdue invoices</span><span style="${overdue.length ? "color:var(--red)" : ""}">${overdue.length}</span></div>
    <div class="kv"><span>Overdue amount</span><span style="${overdueAmt > 0 ? "color:var(--red)" : ""}">${money(overdueAmt)}</span></div>
    <div class="kv tot"><span>Current balance</span><span style="${outstanding > 0 ? "color:var(--orange)" : ""}">${money(outstanding)}</span></div>
    ${last ? `<div class="kv"><span>Last purchase</span><span>${esc(dateShort(last.issue_date))}</span></div>
      <div class="kv"><span>Last invoice</span><span>${esc(last.number || "Invoice")} · ${money(last.total)}</span></div>` : ""}

    ${open.length ? `<div class="lanehead" style="margin-top:16px">
        <span class="eyebrow" style="color:var(--orange)">Open &amp; overdue</span>
        <span class="note">${open.length}</span></div>
      <div class="list" style="margin-top:8px">${invRows(open)}</div>` : ""}

    <div class="lanehead" style="margin-top:16px">
      <span class="eyebrow" style="color:var(--dim)">Invoice history</span>
      <span class="note">${inv.length}</span></div>
    ${inv.length ? `<div class="list" style="margin-top:8px">${invRows(inv)}</div>`
      : `<div class="note">No invoices yet.</div>`}

    <div class="lanehead" style="margin-top:16px">
      <span class="eyebrow" style="color:var(--dim)">Vehicles, services &amp; appointments</span>
      <span class="note">${events.length}</span></div>
    ${events.length ? `<div class="list" style="margin-top:8px">${events.slice(0, 40).map((e) => `
      <button class="item" data-cev="${esc(e.id)}">
        <div class="main"><div class="ttl">${esc(e.title)}</div>
          <div class="sub">${esc(dayLabel(e.start))}${e.location ? " · " + esc(e.location) : ""}</div></div>
        <div class="amt"><small>${esc((e.status || "").toUpperCase())}</small></div></button>`).join("")}</div>`
      : `<div class="note">No matching calendar history found.</div>`}

    <div class="rowbtns" style="margin-top:16px">
      <button class="btn ghost" id="cedit">&#9998; Edit details</button>
      <button class="btn ghost" id="crev">&#11088; Ask for review</button>
      <button class="btn primary" id="cinv">New invoice</button>
    </div>`, (sh) => {
    clientHubCard(sh.querySelector("#hubslot"), c);
    sh.querySelector("#cask").onclick = () => {
      closeSheet(); openChat();
      $("box").value = `Full briefing on ${c.name}: current balance, open and overdue invoices, purchase history, and anything I should know before I contact them.`;
      send();
    };
    sh.querySelector("#cinv").onclick = () => { closeSheet(); openChat(); $("box").value = `Create an invoice for ${c.name}`; send(); };
    sh.querySelector("#crev").onclick = () => reviewSheet(c, reviewAsked().has(c.id));
    sh.querySelector("#cedit").onclick = () => nativeCustomerSheet(c.raw);
    on("[data-pinv]", "click", (e) => nativeInvoiceSheet(e.currentTarget.dataset.pinv), sh);
    on("[data-cev]", "click", (e) => {
      const ev = events.find((x) => String(x.id) === e.currentTarget.dataset.cev);
      if (ev) eventSheet(ev, () => nativeProfileSheet(c));
    }, sh);
    if (!S.cal && terms.length) {
      get("/google-calendar/events")
        .then((d) => { S.cal = d; if ($("sheetwrap")) nativeProfileSheet(c); })
        .catch(() => {});
    }
  });
}

function nativeCustomerSheet(existing) {
  const c = existing || {};
  sheet(`<h2>${existing ? "Edit Customer" : "New Customer"}</h2>
    <div class="eyebrow">Name</div>
    <div class="cmpsect">
      <input id="ncFirst" class="cmpinput" placeholder="First name" value="${esc(c.first_name || "")}">
      <input id="ncLast" class="cmpinput" placeholder="Last name" value="${esc(c.last_name || "")}">
      <input id="ncCompany" class="cmpinput" placeholder="Company (optional)" value="${esc(c.company || "")}">
    </div>
    <div class="eyebrow">Contact</div>
    <div class="cmpsect">
      <input id="ncEmail" class="cmpinput" inputmode="email" placeholder="Email" value="${esc(c.email || "")}">
      <input id="ncPhone" class="cmpinput" inputmode="tel" placeholder="Phone" value="${esc(c.phone || "")}">
    </div>
    <button class="btn em wide" style="margin-top:14px" id="ncSave">${existing ? "Save changes" : "Add customer"}</button>
    <p class="note err" id="ncErr" style="margin-top:8px"></p>`, (sh) => {
    sh.querySelector("#ncSave").onclick = async (e) => {
      const v = (id) => sh.querySelector("#" + id).value.trim();
      const first = v("ncFirst"), last = v("ncLast"), company = v("ncCompany");
      if (!first && !last && !company) { sh.querySelector("#ncErr").textContent = "A name or company is required"; return; }
      e.currentTarget.disabled = true;
      try {
        const r = await booksApi({ action: "customer-save", customer: {
          ...(existing ? { id: existing.id } : {}),
          first_name: first, last_name: last, company, email: v("ncEmail"), phone: v("ncPhone"),
        } });
        closeSheet();
        // The books match a new entry to an existing customer by email/phone —
        // say so, instead of "added" for a customer that was already there.
        const who = r?.customer ? `${r.customer.first_name || ""} ${r.customer.last_name || ""}`.trim() || r.customer.company : "";
        toast(existing ? "Customer updated" : r?.customer?.matched_existing ? `Already on file as ${who} — no duplicate made` : "Customer added");
        loadDirectory();
      } catch (err) { e.currentTarget.disabled = false; sh.querySelector("#ncErr").textContent = err.message; }
    };
  });
}

// Splits one written name into first/last the way QuickBooks' own form does:
// everything before the first space is the given name, the rest is the family
// name. Only ever used to PRE-FILL a visible field — the owner sees the result
// and corrects it before anything reaches QuickBooks. Twin of iOS
// ledgerSplitPersonName.
function splitPersonName(full) {
  const t = String(full || "").trim();
  const i = t.indexOf(" ");
  return i < 0 ? { first: t, last: "" } : { first: t.slice(0, i), last: t.slice(i + 1).trim() };
}

// The display name QuickBooks lists a record under: the person when there is
// one, otherwise the business. Twin of iOS ledgerComposeDisplayName.
function composeDisplayName(first, last, company) {
  const person = [first, last].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  return person || String(company || "").trim();
}

// The Phone tab writes the caller's number into a new lead's name because that is
// all a missed call gives it. That is a placeholder, never a person — it must not
// pre-fill a name box, and it must never reach QuickBooks as a GivenName.
function isPhonePlaceholderName(name) {
  const t = String(name || "").trim();
  if (!t) return false;
  return /^[+()\-.\s\d]+$/.test(t) && t.replace(/\D/g, "").length >= 7;
}

// First/last for a lead: what was saved, else a split of the written name — but
// never a company name and never a phone placeholder.
function leadPersonName(l) {
  let first = String(l?.firstName || "").trim(), last = String(l?.lastName || "").trim();
  if (!first && !last) {
    const n = String(l?.name || "").trim();
    const co = String(l?.company || "").trim();
    const isCompany = !!co && n.toLowerCase() === co.toLowerCase();
    if (n && !isCompany && !isPhonePlaceholderName(n)) {
      const sp = splitPersonName(n);
      first = sp.first; last = sp.last;
    }
  }
  return { first, last };
}

// Live "this is what QuickBooks will call them" line under the name boxes, plus
// the pinning rule: typing in the display box pins it, emptying it hands control
// back to the first/last boxes so there is always a way out of a bad override.
function wireNameBoxes(sh, ids) {
  const q = (id) => sh.querySelector("#" + id);
  const first = q(ids.first), last = q(ids.last), co = q(ids.company), name = q(ids.name), filed = q(ids.filed);
  if (!first || !last || !name) return;
  const composed = () => composeDisplayName(first.value, last.value, co ? co.value : "");
  let pinned = !!name.value.trim() && name.value.trim() !== composed() && !ids.unpinned;
  const paint = () => {
    if (!filed) return;
    const shown = name.value.trim() || composed();
    const ok = !!shown && !isPhonePlaceholderName(shown);
    filed.className = ok ? "note" : "note err";
    filed.innerHTML = ok
      ? "Filed in QuickBooks as <b>" + esc(shown) + "</b>."
      : shown
        ? "That is the caller's number, not a name. Type the first and last name — the number stays in the phone box."
        : "Type a first and last name — or a business name. That is how QuickBooks will list them.";
  };
  const sync = () => { if (!pinned) name.value = composed(); paint(); };
  [first, last, co].forEach((el) => { if (el) el.addEventListener("input", sync); });
  name.addEventListener("input", () => {
    const typed = name.value.trim();
    if (!typed) pinned = false; else if (typed !== composed()) pinned = true;
    paint();
  });
  paint();
}

function newCustomerSheet(prefill, onCreated) {
  const pre = prefill || {};
  const person = leadPersonName(pre);
  // A lead the Phone tab named after the caller's number has no display name yet —
  // blank it so a real name has to be typed before a customer is filed under it.
  const preName = isPhonePlaceholderName(pre.name) ? "" : String(pre.name || "");
  const form = (force) => `<h2>New Customer</h2>
    ${prefill ? `<p class="sh-sub">Converting lead &ldquo;${esc(pre.name || "")}&rdquo; — creating the customer marks it WON.</p>` : ""}
    <div class="eyebrow">Customer</div>
    <div class="cmpsect">
      <div class="namepair">
        <input id="ncFirst" class="cmpinput" placeholder="First name" autocomplete="given-name" value="${esc(person.first)}">
        <input id="ncLast" class="cmpinput" placeholder="Last name" autocomplete="family-name" value="${esc(person.last)}">
      </div>
      <input id="ncCompany" class="cmpinput" placeholder="Business name (optional)" value="${esc(pre.company || "")}">
      <input id="ncName" class="cmpinput" placeholder="Display name (how QuickBooks lists them)" value="${esc(preName)}">
      <div class="note" id="ncFiled"></div>
    </div>
    <div class="eyebrow">Contact</div>
    <div class="cmpsect">
      <input id="ncEmail" class="cmpinput" inputmode="email" placeholder="Email" value="${esc(pre.email || "")}">
      <input id="ncPhone" class="cmpinput" inputmode="tel" placeholder="Phone" value="${esc(pre.phone || "")}">
      <input id="ncMobile" class="cmpinput" inputmode="tel" placeholder="Mobile (optional)">
    </div>
    <div class="eyebrow">Billing address (optional)</div>
    <div class="cmpsect">
      <input id="ncLine1" class="cmpinput" placeholder="Street">
      <input id="ncCity" class="cmpinput" placeholder="City">
      <input id="ncRegion" class="cmpinput" placeholder="Province/State">
      <input id="ncPostal" class="cmpinput" placeholder="Postal code">
    </div>
    <div class="eyebrow">Notes (optional)</div>
    <textarea id="ncNotes" class="cmpinput" rows="2" placeholder="Internal notes">${esc(pre.notes || "")}</textarea>
    <button class="btn primary wide" style="margin-top:13px" id="ncGo">Create in QuickBooks</button>
    <div id="ncDup"></div>
    <div class="note" id="ncNote" style="margin-top:9px"></div>`;

  sheet(form(false), (sh) => {
    wireNameBoxes(sh, { first: "ncFirst", last: "ncLast", company: "ncCompany", name: "ncName", filed: "ncFiled" });
    const note = sh.querySelector("#ncNote");
    const dup = sh.querySelector("#ncDup");
    const val = (id) => (sh.querySelector("#" + id)?.value || "").trim();
    const submit = async (force, btn) => {
      // First/last are what QuickBooks stores as GivenName/FamilyName; the display
      // name is what it lists the record under and falls back to the composed person.
      const name = val("ncName") || composeDisplayName(val("ncFirst"), val("ncLast"), val("ncCompany"));
      if (!name) { note.className = "note err"; note.textContent = "A first and last name — or a business name — is required."; return; }
      btn.disabled = true; note.className = "note"; note.textContent = "Creating…";
      const payload = { display_name: name, force };
      [["given_name", "ncFirst"], ["family_name", "ncLast"], ["company", "ncCompany"],
       ["email", "ncEmail"], ["phone", "ncPhone"], ["mobile", "ncMobile"], ["notes", "ncNotes"]]
        .forEach(([k, id]) => { const v = val(id); if (v) payload[k] = v; });
      if (val("ncLine1") || val("ncCity")) {
        payload.address = { line1: val("ncLine1"), city: val("ncCity"), region: val("ncRegion"), postal: val("ncPostal") };
      }
      try {
        const r = await api("/quickbooks-invoice/customer-create", payload);
        if (r.customer) {
          dup.innerHTML = "";
          note.className = "note ok";
          note.textContent = `${r.customer.name} is now in QuickBooks ✅ — Ledger can invoice them immediately.`;
          S.qboStale = true;
          if (onCreated) await onCreated(r.customer);
          setTimeout(() => { closeSheet(); if (!onCreated) loadDirectory(); }, 1500);
          return;
        }
        throw new Error(r.message || r.error || "Could not create the customer.");
      } catch (e) {
        btn.disabled = false;
        // A duplicate check comes back as a 409 whose body carries the matches.
        const matches = e.matches || [];
        if (/already|duplicate|match/i.test(e.message) || matches.length) {
          // Show who it collided with — name, email and QuickBooks id — so the
          // choice is "that's them" vs "different person, same name", not a guess.
          const rows = matches.map((m) => `<div class="duprow" data-use="${esc(m.id)}">
              <div><b>${esc(m.name || "(no name)")}</b>${m.email ? `<br><small>${esc(m.email)}</small>` : ""}
                <br><small>QuickBooks #${esc(m.id)}</small></div>
              <button class="btn ghost" data-useid="${esc(m.id)}">Use existing</button>
            </div>`).join("");
          dup.innerHTML = `<div class="note err" style="margin-top:10px">${esc(e.message)}</div>
            ${rows}
            <button class="btn ghost wide" style="margin-top:8px" id="ncForce">Create anyway</button>`;
          dup.querySelectorAll("[data-useid]").forEach((b) => {
            b.onclick = async () => {
              const m = matches.find((x) => String(x.id) === b.dataset.useid);
              const known = (S.qbo?.qbo?.customers || []).find((c) => String(c.id) === b.dataset.useid);
              const customer = known || { id: m.id, name: m.name, email: m.email };
              if (onCreated) { await onCreated(customer); closeSheet(); }
              else { closeSheet(); customerSheet(customer); }
            };
          });
          dup.querySelector("#ncForce").onclick = (ev) => submit(true, ev.currentTarget);
          note.textContent = "";
        } else { note.className = "note err"; note.textContent = e.message; }
      }
    };
    sh.querySelector("#ncGo").onclick = (ev) => submit(false, ev.currentTarget);
  });
}

// Full customer profile — the web twin of iOS CustomerDetailView. Every section
// that view shows: reach-out actions, lifetime metrics, duplicate warning, the
// complete QBO record, account status, open & overdue, the full invoice history
// and matching calendar history. All of it comes from data already loaded.
function customerSheet(c) {
  if (!c) return;
  const all = (S.qbo?.qbo?.invoices || []).filter((i) => i.customer_id === c.id)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const today = localDay();
  const open = all.filter((i) => Number(i.balance) > 0);
  const paid = all.filter((i) => Number(i.balance) === 0);
  const overdue = open.filter((i) => i.due_date && i.due_date < today);
  const overdueAmt = overdue.reduce((t, i) => t + (Number(i.balance) || 0), 0);
  const lifetime = all.reduce((t, i) => t + (Number(i.total) || 0), 0);
  const avg = all.length ? lifetime / all.length : 0;
  const last = all[0];

  // iOS possibleDuplicates: same email, same normalised phone, or same normalised name.
  const nkey = (v) => (v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const pkey = (v) => (v || "").replace(/\D/g, "").slice(-10);
  const dupes = (S.qbo?.qbo?.customers || []).filter((o) => o.id !== c.id && (
    (c.email && (o.email || "").toLowerCase() === c.email.toLowerCase()) ||
    (c.phone && pkey(o.phone) && pkey(o.phone) === pkey(c.phone)) ||
    nkey(o.name) === nkey(c.name)));

  // iOS matchingEvents: every name token longer than 2 chars must appear in the event.
  const terms = (c.name || "").toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const events = !terms.length ? [] : calEvents().filter((e) => {
    const hay = ((e.title || "") + " " + (e.description || "")).toLowerCase();
    return terms.every((t) => hay.includes(t));
  }).sort((a, b) => String(b.start).localeCompare(String(a.start)));

  const tel = (c.mobile || c.phone || "").replace(/[^0-9+]/g, "");
  const invRows = (rows) => rows.map((i) => `<button class="item" data-cinv="${esc(i.id)}">
    <div class="main"><div class="ttl">#${esc(i.doc)}</div><div class="sub">${esc(dateShort(i.date))}</div></div>
    <div class="amt">${money(i.total)}<small><span class="tag ${i.status}">${i.status}</span></small></div></button>`).join("");
  const kv = (label, value) => value ? `<div class="kv"><span>${esc(label)}</span><span>${esc(value)}</span></div>` : "";

  sheet(`<h2>${esc(c.name)}</h2>
    <p class="sh-sub">${esc(c.company || "")}</p>
    ${tel || c.email ? `<div class="rowbtns" style="margin-top:4px">
      ${tel ? `<a class="btn ghost" href="tel:${esc(tel)}">&#128222; Call</a>
               <a class="btn ghost" href="sms:${esc(tel)}">&#128172; Text</a>` : ""}
      ${c.email ? `<a class="btn ghost" href="mailto:${esc(c.email)}">&#9993; Email</a>` : ""}
    </div>` : ""}
    <button class="btn primary wide" style="margin-top:9px" id="cask">&#10022; Ask Ledger about ${esc((c.name || "").split(" ")[0] || c.name)}</button>

    <div id="hubslot" style="margin-top:12px"></div>

    <div class="kpis" style="margin-top:14px">
      <div class="kpi cyan"><small>Lifetime sales</small><b>${money0(lifetime)}</b></div>
      <div class="kpi ${overdueAmt > 0 ? "red" : "purple"}"><small>Overdue</small><b>${money0(overdueAmt)}</b></div>
      <div class="kpi em"><small>Average sale</small><b>${money0(avg)}</b></div>
      <div class="kpi ${Number(c.balance) > 0 ? "orange" : "gold"}"><small>Outstanding</small><b>${money0(c.balance)}</b></div>
    </div>

    ${dupes.length ? `<div class="eyebrow" style="margin-top:16px;color:var(--orange)">Duplicate warning</div>
      <div class="note err" style="margin-top:6px">&#9888; ${dupes.length} possible duplicate QBO profile${dupes.length === 1 ? "" : "s"}</div>
      ${dupes.map((d) => `<div class="kv"><span>#${esc(d.id)}</span><span>${esc(d.name)}</span></div>`).join("")}` : ""}

    <div class="eyebrow" style="margin-top:16px">Contact &amp; QBO record</div>
    ${kv("Customer", c.name)}
    ${kv("Company", c.company)}
    ${kv("QBO ID", c.id)}
    <div class="kv"><span>Email</span><span>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "Not recorded"}</span></div>
    <div class="kv"><span>Phone</span><span>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : "Not recorded"}</span></div>
    ${kv("Mobile", c.mobile)}
    ${kv("Billing address", c.address)}
    <div class="kv"><span>Taxable</span><span>${c.taxable === false ? "No" : "Yes"}</span></div>
    <div class="kv"><span>Status</span><span>${c.active === false ? "Inactive" : "Active"}</span></div>
    ${kv("Customer since", c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "")}

    <div class="eyebrow" style="margin-top:16px">Account status</div>
    <div class="kv"><span>Paid invoices</span><span>${paid.length}</span></div>
    <div class="kv"><span>Open invoices</span><span>${open.length}</span></div>
    <div class="kv"><span>Overdue invoices</span><span style="${overdue.length ? "color:var(--red)" : ""}">${overdue.length}</span></div>
    <div class="kv"><span>Overdue amount</span><span style="${overdueAmt > 0 ? "color:var(--red)" : ""}">${money(overdueAmt)}</span></div>
    <div class="kv tot"><span>Current balance</span><span style="${Number(c.balance) > 0 ? "color:var(--orange)" : ""}">${money(c.balance)}</span></div>
    ${last ? `<div class="kv"><span>Last purchase</span><span>${esc(dateShort(last.date))}</span></div>
      <div class="kv"><span>Last invoice</span><span>#${esc(last.doc)} · ${money(last.total)}</span></div>` : ""}

    ${c.notes ? `<div class="eyebrow" style="margin-top:16px">Finance notes</div>
      <p class="note" style="white-space:pre-wrap">${esc(c.notes)}</p>` : ""}

    ${open.length ? `<div class="lanehead" style="margin-top:16px">
        <span class="eyebrow" style="color:var(--orange)">Open &amp; overdue</span>
        <span class="note">${open.length}</span></div>
      <div class="list" style="margin-top:8px">${invRows(open)}</div>` : ""}

    <div class="lanehead" style="margin-top:16px">
      <span class="eyebrow" style="color:var(--dim)">Invoice history</span>
      <span class="note">${all.length}</span></div>
    ${all.length ? `<div class="list" style="margin-top:8px">${invRows(all)}</div>`
      : `<div class="note">No invoices in the loaded QuickBooks history.</div>`}

    <div class="lanehead" style="margin-top:16px">
      <span class="eyebrow" style="color:var(--dim)">Vehicles, services &amp; appointments</span>
      <span class="note">${events.length}</span></div>
    ${events.length ? `<div class="list" style="margin-top:8px">${events.slice(0, 40).map((e) => `
      <button class="item" data-cev="${esc(e.id)}">
        <div class="main"><div class="ttl">${esc(e.title)}</div>
          <div class="sub">${esc(dayLabel(e.start))}${e.location ? " · " + esc(e.location) : ""}</div></div>
        <div class="amt"><small>${esc((e.status || "").toUpperCase())}</small></div></button>`).join("")}</div>`
      : `<div class="note">No matching calendar history found.</div>`}

    <div class="rowbtns" style="margin-top:16px">
      <button class="btn ghost" id="crev">&#11088; Ask for review</button>
      <button class="btn primary" id="cinv">New invoice</button>
    </div>`, (sh) => {
    sh.querySelector("#cask").onclick = () => {
      closeSheet(); openChat();
      $("box").value = `Full briefing on ${c.name}: current balance, open and overdue invoices, purchase history, and anything I should know before I contact them.`;
      send();
    };
    sh.querySelector("#cinv").onclick = () => { closeSheet(); openChat(); $("box").value = `Create an invoice for ${c.name}`; send(); };
    sh.querySelector("#crev").onclick = () => reviewSheet(c, reviewAsked().has(c.id));
    clientHubCard(sh.querySelector("#hubslot"), c);
    // sheet() replaces whatever is open, so hand the child sheets a way back to
    // this customer — otherwise Close drops the user out of the profile entirely.
    on("[data-cinv]", "click", (e) => {
      const inv = all.find((x) => String(x.id) === e.currentTarget.dataset.cinv);
      if (inv) invoiceSheet(inv, () => customerSheet(c));
    }, sh);
    on("[data-cev]", "click", (e) => {
      const ev = events.find((x) => String(x.id) === e.currentTarget.dataset.cev);
      if (ev) eventSheet(ev, () => customerSheet(c));
    }, sh);
    if (!S.cal && terms.length) {
      get("/google-calendar/events")
        .then((d) => { S.cal = d; if ($("sheetwrap")) customerSheet(c); })
        .catch(() => {});   // Calendar not connected — the section just stays empty, like iOS.
    }
  });
}

async function loadBoard() {
  const slot = todoSlot(); if (!slot) return;
  try {
    S.board = await api("/leads", { action: "board" });
    drawTodos();
  } catch (e) { slot.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// LEADS LANE — lives under the Phone tab as of 2026-08-24. Calls are where
// leads are born, so the pipeline sits directly beneath the missed-call feed
// instead of in a second tab the shop has to remember to open. Same /leads
// board endpoint and same leadSheet editor as before; only the host moved.
async function loadPhoneLeads() {
  const slot = $("phoneleads"); if (!slot) return;
  try { S.board = await api("/leads", { action: "board" }); drawLeads(); }
  catch (e) { slot.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// Active / All only — the same two chips as the iPhone (Kyle 2026-09-06).
// The status still shows as a tag on every lead.
const LEAD_FILTERS = [["active", "Active"], ["any", "All"]];

function leadStatusTag(l) {
  if (l.status === "won") return "paid";
  if (l.status === "lost") return "grey";
  return l.followUpAt && new Date(l.followUpAt) <= new Date() ? "due" : "new";
}

function drawLeads() {
  const slot = $("phoneleads"); if (!slot) return;
  const leads = S.board?.leads || [];
  const now = new Date();
  const open = leads.filter((l) => l.status !== "won" && l.status !== "lost");
  const value = open.reduce((t, l) => t + (l.valueEstimate || 0), 0);
  const due = open.filter((l) => l.followUpAt && new Date(l.followUpAt) <= now)
    .sort((x, y) => new Date(x.followUpAt) - new Date(y.followUpAt));
  const cutoff = Date.now() - 30 * 86400000;
  const won = leads.filter((l) => l.status === "won" && new Date(l.updatedAt || l.createdAt).getTime() >= cutoff);
  const wonValue = won.reduce((t, l) => t + (l.valueEstimate || 0), 0);

  const filter = S.leadFilter || "active";
  const shown = (filter === "active" ? open : filter === "any" ? leads : leads.filter((l) => l.status === filter))
    .sort((x, y) => {
      const dx = x.followUpAt && new Date(x.followUpAt) <= now, dy = y.followUpAt && new Date(y.followUpAt) <= now;
      if (dx !== dy) return dx ? -1 : 1;
      return new Date(y.createdAt) - new Date(x.createdAt);
    });

  slot.innerHTML = `
    <div class="lanehdr">
      <span class="eyebrow" style="color:var(--purple,#b48cff)">LEAD PIPELINE</span>
      <button class="chip add" id="addlead">+ New lead</button>
    </div>
    <div class="leadtiles">
      <div class="leadtile cyan"><small>PIPELINE</small><b>${money0(value)}</b><i>${open.length} open</i></div>
      <div class="leadtile ${due.length ? "red" : "dim"}"><small>FOLLOW-UP DUE</small><b>${due.length}</b><i>${due.length ? "call today" : "all clear"}</i></div>
      <div class="leadtile emerald"><small>WON &middot; 30D</small><b>${money0(wonValue)}</b><i>${won.length} closed</i></div>
    </div>
    ${due.length ? `<div class="callq">
      <div class="eyebrow" style="color:var(--red)">CALL LIST &middot; ${due.length} DUE</div>
      <div class="list" style="margin-top:8px">${due.slice(0, 5).map((l) => `
        <button class="item" data-lead="${esc(l.id)}">
          <div class="main"><div class="ttl">${esc(l.name)}</div>
            <div class="sub">${esc(l.phone || l.email || "no contact on file")} &middot; due ${esc(dayLabel(l.followUpAt))}</div></div>
          ${l.phone ? `<span class="qcall" data-call="${esc(String(l.phone).replace(/[^0-9+]/g, ""))}">&#128222;</span>` : ""}
        </button>`).join("")}</div></div>` : ""}
    <div class="leadfilters">${LEAD_FILTERS.map(([k, lab]) =>
      `<button class="chip ${filter === k ? "on" : ""}" data-lfilter="${k}">${lab}</button>`).join("")}</div>
    ${shown.length ? `<div class="list">${shown.map((l) => `
      <button class="item" data-lead="${esc(l.id)}">
        <div class="main"><div class="ttl">${esc(l.name)}${l.company ? " &middot; " + esc(l.company) : ""}</div>
          <div class="sub">${esc(l.phone || l.email || l.source || "")}${l.followUpAt ? " &middot; follow up " + esc(dayLabel(l.followUpAt)) : ""}</div></div>
        <div class="amt">${l.valueEstimate ? money0(l.valueEstimate) : ""}
          <small><span class="tag ${leadStatusTag(l)}">${esc(l.status)}</span></small></div>
      </button>`).join("")}</div>`
      : `<div class="empty">${leads.length ? "No " + esc(filter) + " leads." : "The call list starts here.<br>Every missed call lands here on its own — or add one by hand."}</div>`}`;

  $("addlead").onclick = () => leadSheet({});
  on("[data-lfilter]", "click", (e) => { S.leadFilter = e.currentTarget.dataset.lfilter; drawLeads(); }, slot);
  on("[data-call]", "click", (e) => { e.stopPropagation(); location.href = "tel:" + e.currentTarget.dataset.call; }, slot);
  on("[data-lead]", "click", (e) => leadSheet(leads.find((l) => l.id === e.currentTarget.dataset.lead)), slot);
}

function leadSheet(l) {
  const isNew = !l.id;
  const person = leadPersonName(l);
  // An auto-created missed-call lead is named after the number. Keep it in the
  // display box so the lead still saves, but leave it unpinned — the first real
  // name typed replaces it instead of sitting behind a phone number forever.
  const placeholderName = isPhonePlaceholderName(l.name);
  sheet(`<h2>${isNew ? "New lead" : esc(l.name)}</h2>
    <p class="sh-sub">${isNew ? "Who is it, and when do you chase them?" : esc(l.company || "")}</p>
    <div class="namepair">
      <div><label class="fld">FIRST NAME</label><input id="lfirst" autocomplete="given-name" value="${esc(person.first)}"></div>
      <div><label class="fld">LAST NAME</label><input id="llast" autocomplete="family-name" value="${esc(person.last)}"></div>
    </div>
    <label class="fld">COMPANY</label><input id="lco" value="${esc(l.company || "")}">
    <label class="fld">DISPLAY NAME</label><input id="lname" value="${esc(l.name || "")}">
    <div class="note" id="lfiled" style="margin-top:6px"></div>
    <label class="fld">PHONE</label><input id="lph" type="tel" value="${esc(l.phone || "")}">
    <label class="fld">EMAIL</label><input id="lem" type="email" value="${esc(l.email || "")}">
    <label class="fld">ESTIMATED VALUE</label><input id="lval" inputmode="decimal" value="${l.valueEstimate ?? ""}">
    <label class="fld">FOLLOW UP</label><input id="lfu" type="datetime-local" value="${l.followUpAt ? new Date(l.followUpAt).toISOString().slice(0, 16) : ""}">
    <label class="fld">SOURCE</label>
    <select id="lsrc">${LEAD_SOURCES.map(([k, lab]) =>
      `<option value="${k}" ${(l.source || "call-in") === k ? "selected" : ""}>${lab}</option>`).join("")}</select>
    <label class="fld">STATUS</label>
    <select id="lst">${LEAD_STATUSES.map((s) => `<option ${l.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <label class="fld">NOTES</label><textarea id="lnotes" rows="3">${esc(l.notes || "")}</textarea>
    ${!isNew && (l.phone || l.email) ? `<div class="eyebrow" style="margin-top:15px">Reach out</div>
      <div class="rowbtns" style="margin-top:6px">
        ${l.phone ? `<a class="btn ghost" href="tel:${esc(String(l.phone).replace(/[^0-9+]/g, ""))}">&#128222; Call</a>
                     <a class="btn ghost" href="sms:${esc(String(l.phone).replace(/[^0-9+]/g, ""))}">&#128172; Text</a>` : ""}
        ${l.email ? `<a class="btn ghost" href="mailto:${esc(l.email)}">&#9993; Email</a>` : ""}
      </div>` : ""}
    ${isNew ? "" : (l.qboCustomerId
      ? `<p class="note ok" style="margin-top:15px">&#10004; QuickBooks customer #${esc(l.qboCustomerId)} — Ledger can invoice them from the chat.</p>`
      : `<button class="btn em wide" style="margin-top:15px" id="lconv">&#128100; Create QuickBooks customer from this lead</button>
         <p class="note">Opens the customer form pre-filled. Creating the customer marks this lead WON and links it.</p>`)}
    <div class="rowbtns" style="margin-top:15px">
      ${isNew ? "" : `<button class="btn ghost" id="ldel">Delete</button>`}
      <button class="btn primary" id="lsave">${isNew ? "Add lead" : "Save"}</button>
    </div>
    <div class="note" id="lnote" style="margin-top:9px"></div>`, (sh) => {
    wireNameBoxes(sh, { first: "lfirst", last: "llast", company: "lco", name: "lname",
      filed: "lfiled", unpinned: placeholderName });
    const conv = sh.querySelector("#lconv");
    // Carry what is on screen, not what was last saved — typing the caller's real
    // name and converting in one go must not file the customer under the old name.
    const liveLead = () => ({ ...l,
      name: sh.querySelector("#lname").value.trim(),
      firstName: sh.querySelector("#lfirst").value.trim(),
      lastName: sh.querySelector("#llast").value.trim(),
      company: sh.querySelector("#lco").value.trim(),
      phone: sh.querySelector("#lph").value.trim(),
      email: sh.querySelector("#lem").value.trim(),
      notes: sh.querySelector("#lnotes").value.trim() });
    if (conv) conv.onclick = () => newCustomerSheet(liveLead(), async (created) => {
      // Same contract as iOS markWon(customerId:) — the lead is won and linked.
      try {
        S.board = await api("/leads", { action: "lead-save",
          lead: { id: l.id, status: "won", qbo_customer_id: created.id } });
        drawLeads();
      } catch (err) { toast(friendlyError(err, "Couldn't update that lead. Try again."), "err"); }
    });
    sh.querySelector("#lsave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      const fu = sh.querySelector("#lfu").value;
      const lead = {
        ...(l.id ? { id: l.id } : {}),
        name: sh.querySelector("#lname").value.trim(),
        first_name: sh.querySelector("#lfirst").value.trim(),
        last_name: sh.querySelector("#llast").value.trim(),
        company: sh.querySelector("#lco").value.trim(),
        phone: sh.querySelector("#lph").value.trim(),
        email: sh.querySelector("#lem").value.trim(),
        value_estimate: parseFloat(sh.querySelector("#lval").value) || null,
        follow_up_at: fu ? new Date(fu).toISOString() : null,
        status: sh.querySelector("#lst").value,
        source: sh.querySelector("#lsrc").value,
        notes: sh.querySelector("#lnotes").value.trim(),
      };
      try { S.board = await api("/leads", { action: "lead-save", lead }); closeSheet(); drawLeads(); toast("Lead saved"); }
      catch (err) { e.currentTarget.disabled = false; const n = sh.querySelector("#lnote"); n.className = "note err"; n.textContent = err.message; }
    };
    const del = sh.querySelector("#ldel");
    if (del) del.onclick = async () => {
      if (!(await askConfirm("It comes off your leads board.", { title: "Delete this lead?", ok: "Delete", danger: true }))) return;
      try { S.board = await api("/leads", { action: "lead-delete", id: l.id }); closeSheet(); drawLeads(); }
      catch (err) { toast(friendlyError(err, "Couldn't delete that lead. Try again."), "err"); }
    };
  });
}

// Where the to-do board draws since build 163: the sheet opened from the
// Directory card (`#todobody`). Falls back to the lane body for any old caller.
function todoSlot() { return $("todobody") || $("lanebody"); }
function todoListSheet() {
  sheet(`<div class="pcc-kicker">TO-DO</div><div id="todobody"><div class="skel"></div></div>`, () => {
    if (S.board) drawTodos(); else loadBoard();
  });
}
// After an edit: redraw wherever the board is showing, or refresh the Directory card.
function todoAfterSave() {
  if ($("todobody")) drawTodos();
  else if (S.lane === "directory" && $("tdcard")) { const c = $("tdcard"); c.outerHTML = todoCardHTML(); wireTodoCard(); }
}
function todoCardHTML() {
  const all = S.board?.todos || [];
  const todos = all.filter((t) => t.status === "open");
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const overdue = todos.filter((t) => t.dueAt && new Date(t.dueAt) < startToday).length;
  const today = todos.filter((t) => t.dueAt && new Date(t.dueAt) >= startToday && new Date(t.dueAt) <= endToday).length;
  const tone = overdue ? "var(--red)" : today ? "var(--orange)" : "var(--cyan)";
  const headline = !S.board ? "Loading your to-dos…" : !todos.length ? "Board is clear"
    : overdue ? (overdue === 1 ? "1 item is overdue" : `${overdue} items are overdue`)
    : today ? (today === 1 ? "1 item due today" : `${today} items due today`)
    : todos.length === 1 ? "1 open item" : `${todos.length} open items`;
  const when = (t) => {
    if (!t.dueAt) return "Any time";
    const d = new Date(t.dueAt);
    if (d < startToday) return "Overdue";
    if (d <= endToday) return "Today " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  };
  const preview = todos.slice().sort((a, b) => (a.dueAt ? new Date(a.dueAt) : 8e15) - (b.dueAt ? new Date(b.dueAt) : 8e15)).slice(0, 3);
  return `<button class="tdcard" id="tdcard" style="--tone:${tone}">
    <div class="t"><span class="eyebrow" style="color:${tone}">&#9989; To-do</span><span class="go">${todos.length ? `Open all ${todos.length}` : "Open"} &#8594;</span></div>
    <b style="color:${tone === "var(--cyan)" ? "var(--text)" : tone}">${esc(headline)}</b>
    ${preview.length ? `<div class="rows">${preview.map((t) => `<div class="row"><i></i><span>${esc(t.title)}</span><small>${esc(when(t))}</small></div>`).join("")}</div>`
      : `<span class="note">Tell Ledger "remind me to call the fleet guy Thursday" in chat and it lands here.</span>`}
  </button>`;
}
function wireTodoCard() { const c = $("tdcard"); if (c) c.onclick = () => todoListSheet(); }

function drawTodos() {
  const slot = todoSlot(); if (!slot) return;
  const all = S.board?.todos || [];
  const todos = all.filter((t) => t.status === "open");
  const done = all.filter((t) => t.status === "done");
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const overdue = todos.filter((t) => t.dueAt && new Date(t.dueAt) < startToday);
  const today = todos.filter((t) => t.dueAt && new Date(t.dueAt) >= startToday && new Date(t.dueAt) <= endToday);
  const upcoming = todos.filter((t) => t.dueAt && new Date(t.dueAt) > endToday);
  const anytime = todos.filter((t) => !t.dueAt);
  // iOS TodoMissionHero: the headline follows the worst thing on the board.
  const headline = !todos.length ? "Board is clear"
    : overdue.length ? (overdue.length === 1 ? "1 item is overdue" : `${overdue.length} items are overdue`)
    : today.length ? (today.length === 1 ? "1 item due today" : `${today.length} items due today`)
    : todos.length === 1 ? "1 open item" : `${todos.length} open items`;
  const subline = !todos.length
    ? (done.length ? "Everything is done \u2014 nice week." : "Add one below, or ask Ledger to remind you.")
    : todos.length === 1 ? "1 open on the board" : `${todos.length} open on the board`;
  const row = (t, isDone) => `<div class="item">
      <button class="tdot ${isDone ? "on" : ""}" data-toggle="${esc(t.id)}" title="${esc((t.priority || "normal").toUpperCase())} priority"
        style="border-color:${todoPriorityTint(t.priority)}">${isDone ? "&#10003;" : ""}</button>
      <div class="main" data-todo="${esc(t.id)}"><div class="ttl"${isDone ? ` style="text-decoration:line-through"` : ""}>${esc(t.title)}</div>
        <div class="sub">${t.dueAt ? esc(dayLabel(t.dueAt) + " \u00b7 " + timeLabel(t.dueAt)) : "No date"}${t.customerName ? " \u00b7 " + esc(t.customerName) : ""}</div></div>
    </div>`;
  const group = (label, items, tint) => items.length ? `<div><div class="eyebrow" style="color:${tint}">${label}</div>
      <div class="list" style="margin-top:8px">${items.map((t) => row(t, false)).join("")}</div></div>` : "";
  slot.innerHTML = `
    <div class="todohero ${overdue.length ? "late" : today.length ? "warm" : ""}">
      <div class="t"><span class="eyebrow">&#9989; To-do</span><span class="livechip">LIVE</span></div>
      <b>${esc(headline)}</b><span>${esc(subline)}</span>
    </div>
    <div class="dirbar">
      <span class="dircount">${todos.length ? (todos.length === 1 ? "1 open" : todos.length + " open") : "Nothing open"}</span>
      <button class="pillbtn" id="tdrefresh" title="Refresh">&#8635;</button>
      <button class="pillbtn em" id="addtodo">+ Add</button>
    </div>
    ${!todos.length && !done.length ? `<div class="empty">Nothing on the board.<br>Tap Add \u2014 or tell Ledger &quot;remind me to order the Michelin set Tuesday&quot; in chat and it lands here.</div>` : ""}
    ${group("OVERDUE", overdue, "var(--red)")}
    ${group("TODAY", today, "var(--orange)")}
    ${group("UPCOMING", upcoming, "var(--cyan)")}
    ${group("ANYTIME", anytime, "var(--purple)")}
    ${!todos.length && done.length ? `<div class="empty em">All caught up.<br>${done.length === 1 ? "1 done item is below." : done.length + " done items are below."}</div>` : ""}
    ${done.length ? `<button class="donehead" id="tdone">
        <span class="eyebrow em">&#9679; DONE ${done.length}</span>
        <span class="note">${S.showDoneTodos ? "Hide" : "Show"}</span></button>
      ${S.showDoneTodos ? `<div class="list" style="margin-top:8px;opacity:.6">${done.map((t) => row(t, true)).join("")}</div>` : ""}` : ""}`;
  $("addtodo").onclick = () => todoSheet({});
  $("tdrefresh").onclick = () => { slot.innerHTML = `<div class="skel"></div>`; loadBoard(); };
  // Keep the Directory card and the pill badge honest while the sheet is open.
  if ($("tdcard")) { $("tdcard").outerHTML = todoCardHTML(); wireTodoCard(); }
  if ($("tdone")) $("tdone").onclick = () => { S.showDoneTodos = !S.showDoneTodos; drawTodos(); };
  // The board only understands a done flag \u2014 sending {status} silently saved nothing.
  // Tapping a done item puts it back on the board, the way the iPhone does.
  on("[data-toggle]", "click", async (e) => {
    const t = all.find((x) => x.id === e.currentTarget.dataset.toggle); if (!t) return;
    try { S.board = await api("/leads", { action: "todo-save", todo: { id: t.id, done: t.status === "open" } }); drawTodos(); }
    catch (err) { toast(friendlyError(err, "Couldn't update that to-do. Try again."), "err"); }
  }, slot);
  on("[data-todo]", "click", (e) => todoSheet(all.find((t) => t.id === e.currentTarget.dataset.todo)), slot);
}

const todoPriorityTint = (p) => p === "urgent" ? "var(--red)" : p === "high" ? "var(--orange)"
  : p === "low" ? "var(--dim)" : "var(--cyan)";

function todoSheet(t) {
  const isNew = !t.id;
  sheet(`<h2>${isNew ? "New to-do" : "Edit to-do"}</h2>
    <label class="fld">WHAT</label><input id="tt" value="${esc(t.title || "")}">
    <label class="fld">WHEN</label><input id="td" type="datetime-local" value="${t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 16) : ""}">
    <label class="fld">CUSTOMER</label><input id="tc" value="${esc(t.customerName || "")}">
    <label class="fld">PRIORITY</label>
    <select id="tp">${TODO_PRIORITIES.map(([k, lab]) =>
      `<option value="${k}" ${(t.priority || "normal") === k ? "selected" : ""}>${lab}</option>`).join("")}</select>
    <label class="fld">NOTES</label><textarea id="tn" rows="3">${esc(t.notes || "")}</textarea>
    <div class="rowbtns" style="margin-top:15px">
      ${isNew ? "" : `<button class="btn ghost" id="tdel">Delete</button>`}
      <button class="btn primary" id="tsave">${isNew ? "Add" : "Save"}</button>
    </div>
    <div class="note" id="tnote" style="margin-top:9px"></div>`, (sh) => {
    sh.querySelector("#tsave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      const when = sh.querySelector("#td").value;
      const todo = {
        ...(t.id ? { id: t.id } : {}),
        title: sh.querySelector("#tt").value.trim(),
        due_at: when ? new Date(when).toISOString() : null,
        customer_name: sh.querySelector("#tc").value.trim(),
        priority: sh.querySelector("#tp").value,
        notes: sh.querySelector("#tn").value.trim(),
      };
      try { S.board = await api("/leads", { action: "todo-save", todo }); closeSheet(); todoAfterSave(); toast("Saved"); }
      catch (err) { e.currentTarget.disabled = false; const n = sh.querySelector("#tnote"); n.className = "note err"; n.textContent = err.message; }
    };
    const del = sh.querySelector("#tdel");
    if (del) del.onclick = async () => {
      if (!(await askConfirm("It comes off your to-do list.", { title: "Delete this to-do?", ok: "Delete", danger: true }))) return;
      try { S.board = await api("/leads", { action: "todo-delete", id: t.id }); closeSheet(); todoAfterSave(); }
      catch (err) { toast(friendlyError(err, "Couldn't delete that to-do. Try again."), "err"); }
    };
  });
}

/* ---------------- CHAT ---------------- */
const CHAT_DRAFT_KEY = "ledger.draft.chat";
// The chat pane is a layer like a sheet: it owns a history entry while open so
// Back closes it (audit 11.1), and whatever is typed in the box stays there
// across close/open (audit 11.2c) — callers that seed a prompt assign it
// straight after openChat().
function openChat() {
  const wrap = $("chatwrap"); if (!wrap) return;
  if (!wrap.classList.contains("open")) { wrap._opener = rememberOpener(); layerPush("chat"); }
  wrap.classList.add("open");
  setTimeout(() => $("box")?.focus(), 60);
  restoreChatHistory();
}
function closeChat() {
  const wrap = $("chatwrap"); if (!wrap) return;
  const wasOpen = wrap.classList.contains("open");
  wrap.classList.remove("open");
  if (!wasOpen) return;
  layerPop("chat");
  restoreFocus(wrap._opener);
  reloadIfUpdatePending();
}
function newConversation() {
  S.conversationId = null; accountStorage.removeItem("ledger.conv");
  S.historyChecked = true; // an explicit fresh start is not a reload to recover from
  chatEl().innerHTML = ""; sys("Fresh conversation started.");
}

// A page reload rebuilds the chat pane from nothing but the welcome line — the
// real transcript still lives server-side. Ask for it once per session, on the
// first open, and only replace the local pane if nothing's been typed since.
async function restoreChatHistory() {
  if (S.historyChecked) return;
  S.historyChecked = true;
  try {
    const d = await api("/ledger-ai", { action: "history", ...(S.conversationId ? { conversation_id: S.conversationId } : {}) });
    if (chatEl().querySelector(".msg")) return; // a message was already sent while this was in flight
    if ((d.messages || []).length) {
      chatEl().innerHTML = "";
      d.messages.forEach((m) => bubble(m.role === "user" ? "msg me" : "msg ai", m.role === "user" ? esc(m.content) : md(m.content)));
    }
    if (d.conversation_id) { S.conversationId = d.conversation_id; accountStorage.setItem("ledger.conv", d.conversation_id); }
  } catch { /* No history route yet, or signed out — keep the local welcome message. */ }
}
const chatEl = () => $("chat");
function scrollChat() { const c = chatEl(); c.scrollTop = c.scrollHeight; }
function bubble(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; chatEl().appendChild(d); scrollChat(); return d; }
function sys(t) { bubble("sys", esc(t)); }

function banner() {
  const b = $("banner"); if (b) b.style.display = S.advisor ? "block" : "none";
  const p = $("advisor"); if (p) { p.className = "pill" + (S.advisor ? " on" : ""); p.setAttribute("aria-pressed", S.advisor ? "true" : "false"); }
}
async function toggleAdvisor() {
  if (!S.advisor && accountStorage.getItem("ledger.advisorNotice") !== "1") {
    const meter = S.usage ? ` (${money(S.usage.spent_usd)} of ${money(S.usage.budget_usd)} used ${S.usage.trial_credit?"during your trial":"this month"})` : "";
    if (!(await askConfirm("Advisor Mode opens up business guidance beyond your books — marketing, pricing, hiring, growth — grounded in your real numbers. It uses your available AI allowance" + meter + ".", { title: "Turn on Advisor Mode?", ok: "Turn it on" }))) return;
    accountStorage.setItem("ledger.advisorNotice", "1");
  }
  S.advisor = !S.advisor; accountStorage.setItem("ledger.advisor", S.advisor ? "1" : "0"); banner();
}

function setUsage(u) {
  S.usage = u; const el = $("usage");
  if (el && u && Number.isFinite(Number(u.spent_usd))) {
    const pct=u.budget_usd>0?Math.round(Number(u.spent_usd)/u.budget_usd*100):0;
    el.textContent=u.trial_credit?(u.trial_state==='pending'?'Activate US$20':u.trial_state==='active'?`US$${Number(u.remaining_usd||0).toFixed(2)} left`:'Trial credit'):pct+'% AI';
    el.style.color=pct>=80?'var(--orange)':'';el.style.cursor='pointer';el.onclick=u.trial_credit?trialCreditSheet:powerUpSheet;
  }
}
function trialCreditDescription(t) {
  if(t.trial_state==='pending')return 'Verify your phone to activate one shared US$20 AI credit. No card. No monthly reset. Your owner must complete this step.';
  if(t.trial_state==='active')return `US$${Number(t.remaining_usd||0).toFixed(2)} available until ${dateShort(t.expires_at)}. Shared by your business for the entire trial, including work already running. No automatic top-up.`;
  if(t.trial_state==='expired')return 'Your original trial credit has expired. Your setup is saved. Choose a subscription to continue with paid AI.';
  return 'This introductory credit needs an eligibility review. Contact Ledger support; starting a new account does not create a new credit.';
}
async function trialCreditSheet() {
  let t;try{t=await api('/trial-credit',{action:'status'});}catch(e){toast(friendlyError(e, "Couldn't load your trial credit. Try again."),'err');return;}
  if(!t.trial_credit){await refreshUsage();toast('Your account uses its normal plan allowance.');return;}
  sheet(`<h2>US$20 to make Ledger yours</h2><p class="sh-sub">${esc(trialCreditDescription(t))}</p>
    <p class="note">Set up your agent, save your rules and try real work. Credit expires ${esc(dateShort(t.expires_at))}; it is shared across everyone and every device in your business.</p>
    ${t.trial_state==='pending'?`<label class="fld" for="trialphone">YOUR PHONE NUMBER</label><input id="trialphone" type="tel" autocomplete="tel" placeholder="+1 403 555 0123" maxlength="32"><p class="note">Use a Canadian or US number you control. We'll send one verification text. This does not sign you up for marketing.</p><button class="btn primary wide" id="trialsend">Send verification code</button><div id="trialcodearea" hidden><label class="fld" for="trialcode">SIX-DIGIT CODE</label><input id="trialcode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button class="btn primary wide" id="trialcheck">Activate my US$20 credit</button><button class="btn ghost wide" id="trialreset">Use a different number or request a new code</button></div><p class="note" id="trialnote" role="status" aria-live="polite"></p>`:''}
    <p class="note"><a href="/terms/#trial-credit" target="_blank" rel="noopener">Offer details</a> · <a href="/support/" target="_blank" rel="noopener">Need help or share a phone number?</a></p>`,sh=>{
    const send=sh.querySelector('#trialsend');if(!send)return;let id=null;
    const note=sh.querySelector('#trialnote'),phone=sh.querySelector('#trialphone'),check=sh.querySelector('#trialcheck');
    sh.querySelector("#trialreset").onclick=()=>{id=null;phone.disabled=false;send.disabled=false;sh.querySelector("#trialcodearea").hidden=true;sh.querySelector("#trialcode").value="";note.textContent="Wait at least 60 seconds between codes. Only your most recent entered code should be used.";phone.focus();};
    send.onclick=async()=>{send.disabled=true;note.textContent='Sending your verification code…';
      try{const r=await api('/trial-credit',{action:'send',phone:phone.value});if(!sh.isConnected)return;id=r.verification_id;phone.disabled=true;sh.querySelector('#trialcodearea').hidden=false;note.textContent=r.message;sh.querySelector('#trialcode').focus();}
      catch(e){if(sh.isConnected){note.textContent=e.message;send.disabled=false;}}
    };
    check.onclick=async()=>{check.disabled=true;note.textContent='Checking your code…';
      try{const r=await api('/trial-credit',{action:'check',verification_id:id,code:sh.querySelector('#trialcode').value.trim()});if(!sh.isConnected)return;
       if(r.trial_state!=='active')throw new Error('The credit is not active yet. Please contact support.');await refreshUsage();closeSheet();toast('Your shared US$20 AI credit is ready.');if(S.tab==='home')loadHomeTrial();}
      catch(e){if(sh.isConnected){note.textContent=e.message;check.disabled=false;}}
    };
  });
}
async function loadHomeTrial(){
 const slot=$('hometrial');if(!slot)return;
 try{const u=await api('/ledger-ai',{action:'usage'});if($('hometrial')!==slot)return;setUsage(u);
  if(!u.trial_credit){slot.innerHTML='';return;}
  slot.innerHTML=`<div class="panel" style="border-color:rgba(91,218,187,.35);background:linear-gradient(125deg,rgba(42,100,88,.22),rgba(13,27,36,.85))"><div class="eyebrow">YOUR AI ONBOARDING CREDIT</div><h3 style="margin:8px 0">${u.trial_state==='active'?`US$${Number(u.remaining_usd||0).toFixed(2)} available`:'Your first US$20, on us'}</h3><p class="note">${esc(trialCreditDescription(u))}</p><button class="btn primary" id="hometrialopen">${u.trial_state==='pending'?'Activate my credit':'View trial credit'}</button></div>`;
  slot.querySelector('#hometrialopen').onclick=trialCreditSheet;
 }catch{if($('hometrial')===slot)slot.innerHTML='';}
}
async function refreshUsage() { try { setUsage(await api("/ledger-ai", { action: "usage" })); } catch {} }

async function powerUpSheet() {
  try { setUsage(await api("/ledger-ai", {action:"usage"})); } catch(e) { toast("Cannot verify your allowance right now. Please try again.","err"); return; }
  if(S.usage?.trial_credit)return trialCreditSheet();
  let pkgs = [{ key: "boost", emoji: "⚡", label: "Boost", price: 25, credit: 25 },
              { key: "power", emoji: "🔥", label: "Power Pack", price: 50, credit: 55 },
              { key: "heavy", emoji: "🚀", label: "Heavy Hitter", price: 100, credit: 120 }];
  try { const s = await api("/stripe-billing/status", {}); if (s.topup_packages?.length) pkgs = s.topup_packages; } catch {}
  sheet(`<h2>⚡ Power-Ups</h2><p class="sh-sub">Add to this month's AI allowance — credited the second the payment clears.</p>
    ${inAndroidApp() ? `<p class="note">${SUBSCRIPTION_REQUIRED}</p>` : ""}
    ${inAndroidApp() ? "" : pkgs.map((p) => `<button class="pu-card${p.key === "power" ? " hot" : ""}" data-k="${esc(p.key)}">
      <span class="pu-emoji">${p.emoji}</span>
      <span class="pu-info"><b>${esc(p.label)}</b><small>+$${p.credit} AI allowance${p.credit > p.price ? ` · $${p.credit - p.price} bonus` : ""}</small></span>
      <span class="pu-price">$${p.price}</span></button>`).join("")}`, (sh) => {
    on(".pu-card", "click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const c = await api("/stripe-billing/topup", { package: b.dataset.k }); location.href = c.url; }
      catch (err) { toast(friendlyError(err, "Couldn't start the top-up. Nothing was charged — try again."), "err"); b.disabled = false; }
    }, sh);
  });
}

/* Texting credit — the plan's monthly amount included with the business number
   ($10 Solo, $25 Pro — always read off the usage payload, never typed here),
   metered at the carrier's real per-text cost and topped up $25 at a time. Rides on the
   same usage call as the AI meter (S.usage.sms); hidden on a bring-your-own
   line, where the other provider bills the texts. (Kyle 2026-09-05) */
function smsMeterHtml(s) {
  const pct = s && s.allowance_usd > 0 ? Math.round(Number(s.used_usd) / s.allowance_usd * 100) : 0;
  const texts = s ? `${s.outbound_count} sent · ${s.inbound_count} received` : "";
  return `<div class="kv"><span>Used this month</span><span>${s ? money(s.used_usd) + " of " + money(s.allowance_usd) : "—"}</span></div>
    ${texts ? `<div class="kv" style="margin-top:4px"><span>Texts</span><span>${esc(texts)}</span></div>` : ""}
    <div style="height:7px;background:rgba(255,255,255,.07);border-radius:99px;margin-top:9px;overflow:hidden">
      <div style="height:100%;width:${Math.min(pct, 100)}%;background:${pct >= 80 ? "var(--orange)" : "linear-gradient(90deg,var(--cyan),var(--purple))"}"></div></div>
    ${s?.topup_usd > 0 ? `<p class="note" style="margin-top:6px">Includes ${money(s.topup_usd)} added this month. Resets on the 1st.</p>` : `<p class="note" style="margin-top:6px">${s ? money(s.credit_usd) + " included" : "Your plan's texting credit is included"} every month with your business number. Resets on the 1st.</p>`}`;
}
async function textingSheet() {
  try { setUsage(await api("/ledger-ai", {action:"usage"})); } catch(e) { toast("Cannot verify your allowance right now. Please try again.","err"); return; }
  if(S.usage?.trial_credit) { sheet(`<h2>Business phone &amp; texting</h2><p class="note">Your trial includes one US$20 AI credit. Live calling and texting require a paid subscription and provider activation; they are not charged to your trial AI credit.</p>`); return; }
  let s = S.usage?.sms || null;
  try { const r = await api("/phone", { action: "sms-usage" }); if (r?.sms) { s = r.sms; if (S.usage) S.usage.sms = s; } } catch {}
  let pkg = { key: "sms25", emoji: "💬", label: "Texting credit", price: 25, credit: 25 };
  try { const b = await api("/stripe-billing/status", {}); if (b.sms_topup) pkg = b.sms_topup; } catch {}
  sheet(`<h2>💬 Texting credit</h2><p class="sh-sub">Texts your business number sends and receives — reminders, replies, Front Desk, your own messages.</p>
    <div class="panel">${smsMeterHtml(s)}</div>
    ${s?.exhausted ? `<p class="note" style="margin-top:10px;color:var(--orange)">This month's credit is used up. Reminders and replies are paused until you add credit.</p>` : ""}
    ${inAndroidApp() ? `<p class="note" style="margin-top:12px">${SUBSCRIPTION_REQUIRED}</p>` : `<button class="pu-card hot" data-k="${esc(pkg.key)}" style="margin-top:12px">
      <span class="pu-emoji">${pkg.emoji}</span>
      <span class="pu-info"><b>Add $${pkg.credit} texting credit</b><small>About ${Math.round(pkg.credit / 0.0113 / 100) * 100} more texts · credited the second the payment clears</small></span>
      <span class="pu-price">$${pkg.price}</span></button>`}`, (sh) => {
    on(".pu-card", "click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const c = await api("/stripe-billing/sms-topup", {}); location.href = c.url; }
      catch (err) { toast(friendlyError(err, "Couldn't start the texting top-up. Nothing was charged — try again."), "err"); b.disabled = false; }
    }, sh);
  });
}
// A send that hit the monthly credit ceiling opens the top-up instead of a dead error.
function smsSendFailed(ex) {
  if (ex?.status === 402 && ex?.data?.error === "sms_credit_exhausted") { textingSheet(); return true; }
  return false;
}

async function billingCheck() {
  try {
    const s = await api("/stripe-billing/status", {});
    S.access = s.access || "full";
    if (S.access === "locked") { lockView(s); return; }
    renderAccessBanner(s);
  } catch {}
}

// A blocked write already carries the same fields the status call returns,
// so the banner is drawn from either without a second round-trip.
function paywallHit(d) {
  S.access = d.access || "locked";
  // Hard lock (2026-09-05): the server said locked, so the app closes to the
  // subscribe screen — no banner, no half-working shell.
  if (S.access === "locked") { lockView({ subscription_status: d.subscription_status, trial_ends_at: d.trial_ends_at, access_reason: d.reason, access_message: d.message }); return; }
  renderAccessBanner({ access: d.access, access_reason: d.reason, access_message: d.message, subscription_status: d.subscription_status, billing_ready: true });
}

function renderAccessBanner(s) {
  const a = $("alertbar"); if (!a) return;
  a.textContent = ""; a.style.background = ""; a.style.color = ""; a.style.display = "none";
  const link = (label, path) => {
    if (inAndroidApp()) { a.appendChild(document.createTextNode(label)); return; }
    const b = document.createElement("u"); b.style.cursor = "pointer"; b.textContent = label;
    b.onclick = async () => { try { const c = path === "/stripe-billing/checkout" ? await startCheckout() : await api(path, {}); location.href = c.url; } catch (e) { if (!e.cancelled) toast(friendlyError(e, "Couldn't open billing. Nothing was charged — try again."), "err"); } };
    a.appendChild(b);
  };
  if(s.complimentary_access)return;
  const access = s.access || "full";
  const reason = s.access_reason || "";
  if (access === "grace") {
    a.style.background = "rgba(251,191,36,.12)"; a.style.color = "var(--gold)";
    a.textContent = "⚠️ " + (s.access_message || "We couldn't charge your card. Update it in Billing to keep everything running.");
    if (s.portal_available) link(" Update card", "/stripe-billing/portal");
    a.style.display = "block";
  } else if (s.subscription_status === "trialing" && s.trial_days_left !== null && s.trial_days_left !== undefined) {
    a.style.background = "rgba(251,191,36,.12)"; a.style.color = "var(--gold)";
    const days = `${s.trial_days_left} day${s.trial_days_left === 1 ? "" : "s"} left`;
    if (s.card_on_file) {
      const when = s.trial_ends_at ? new Date(s.trial_ends_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "day 15";
      a.textContent = `🎁 Free trial — ${days}. Your card is on file; your first charge is on ${when}.`;
    } else {
      a.textContent = s.trial_days_left > 0 ? `🎁 Free trial — ${days}. Add a card so nothing stops on day 15.` : "⏰ Your free trial has ended.";
      if (s.billing_ready) link(s.trial_days_left > 0 ? " Add a card" : " Subscribe now", "/stripe-billing/checkout");
    }
    a.style.display = "block";
  }
}

// Matches MAX_MESSAGE_CHARS in the ledger-ai function — a long paste used to
// travel all the way to the server just to come back rejected.
const MAX_CHAT_CHARS = 4000;

async function send() {
  const box = $("box"); const text = box.value.trim(); if (!text) return;
  if (text.length > MAX_CHAT_CHARS) {
    openChat();
    box.value = text; // openChat clears the box — put the draft back so it can be trimmed, not retyped
    toast(`That's ${text.length.toLocaleString()} characters — Ledger reads up to ${MAX_CHAT_CHARS.toLocaleString()}. Trim it or send it in two messages.`, "err");
    return;
  }
  box.value = ""; box.style.height = "auto";
  try { accountStorage.removeItem(CHAT_DRAFT_KEY); } catch {}
  openChat();
  bubble("msg me", esc(text));
  const t = bubble("typing", "Ledger is thinking…");
  $("send").disabled = true;
  try {
    const d = await api("/ledger-ai", {
      message: text, mode: S.advisor ? "advisor" : "books",
      ...(S.conversationId ? { conversation_id: S.conversationId } : {}),
    });
    S.conversationId = d.conversation_id; accountStorage.setItem("ledger.conv", S.conversationId);
    t.remove(); bubble("msg ai", md(d.reply));
    if (d.usage_status) setUsage(d.usage_status);
    (d.invoice_drafts || []).forEach((x) => draftCard(x, "INVOICE DRAFT", "/quickbooks-invoice/confirm", "/quickbooks-invoice/cancel"));
    (d.estimate_drafts || []).forEach((x) => draftCard(x, "ESTIMATE DRAFT", "/quickbooks-invoice/estimate-confirm", "/quickbooks-invoice/estimate-cancel"));
    (d.booking_drafts || []).forEach(bookingCard);
    (d.reminder_drafts || []).forEach(reminderCard);
    (d.email_drafts || []).forEach(emailDraftCard);
    (d.sms_drafts || []).forEach(smsDraftCard);
    (d.print_jobs || []).forEach(printJobCard);
    (d.action_drafts || []).forEach(actionCard);
    S.qboStale = true; S.board = null; // books may have moved — refetch on next tab visit
  } catch (e) {
    t.remove();
    if (e.data?.code === "ai_unavailable" || e.status === 503) {
      // Provider outage: one plain sentence, never the raw error, and the
      // question goes back in the box so a retry is one tap.
      bubble("msg ai err", "⚠️ " + esc(e.message || "Ledger's AI helper is unavailable right now — try again in a few minutes."));
      box.value = text; box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 120) + "px";
      try { accountStorage.setItem(CHAT_DRAFT_KEY, text); } catch {}
    } else {
      bubble("msg ai err", "⚠️ " + esc(e.message));
      if (e.status === 402) { if(S.usage?.trial_credit)trialCreditSheet();else if (/subscription|trial|renew/i.test(e.message)) billingCheck(); else powerUpSheet(); }
      else if (/allowance|power-up/i.test(e.message)) powerUpSheet();
    }
  }
  $("send").disabled = false;
}

function cardDone(card, msg) {
  const row = card.querySelector(".row"); if (row) row.remove();
  const s = document.createElement("div"); s.className = "emailrow"; s.textContent = msg;
  card.appendChild(s); scrollChat();
}

// The idempotency backstop on invoice/estimate confirm returns the literal
// string "already_posted" plus the doc_number it landed under — show that
// number, not the raw server token.
function postedMessage(e) {
  const doc = e.data?.doc_number;
  return doc && /already_posted/i.test(e.message || "") ? `Already posted as #${doc}.` : e.message;
}

// QuickBooks resolves exactly two terms by shape (due now / Net 30). Built-in
// books drafts carry terms_days and get the composer's four choices, opening
// on the customer's or workspace default the server resolved.
const termsRow = (v, days) => days != null
  ? `<label class="emailrow">Payment due
    <select class="tm pillbtn" data-terms-days="1">
      ${[[0, "COD (due today)"], [15, "Net 15"], [30, "Net 30"], [60, "Net 60"]].map(([n, l]) =>
        `<option value="${n}"${Number(days) === n ? " selected" : ""}>${l}</option>`).join("")}
      ${[0, 15, 30, 60].includes(Number(days)) ? "" : `<option value="${Number(days)}" selected>Net ${Number(days)}</option>`}
    </select></label>`
  : `<label class="emailrow">Payment due
    <select class="tm pillbtn">
      <option value="due_now"${v === "net30" ? "" : " selected"}>Due now</option>
      <option value="net30"${v === "net30" ? " selected" : ""}>Net 30</option>
    </select></label>`;

function draftCard(d, label, confirmPath, cancelPath) {
  const lines = (d.lines || []).map((l) => `<tr><td>${esc(l.description || l.item_name)} × ${l.quantity}</td><td>${money(l.amount)}</td></tr>`).join("");
  // Estimates carry an expiry, not payment terms — the control is invoices only.
  const isInvoice = !/estimate/i.test(confirmPath);
  const card = bubble("card", `<h3>${label}</h3><div class="cust">${esc(d.customer)}</div>
    <table>${lines}<tr><td class="total">Subtotal</td><td class="total">${money(d.subtotal)}</td></tr>
    ${d.tax_total != null ? `<tr><td>${esc(d.tax_name || "Tax")}${d.tax_rate ? ` (${Math.round(d.tax_rate * 10000) / 100}%)` : ""}</td><td>${money(d.tax_total)}</td></tr>
    <tr><td class="total">Total</td><td class="total">${money(d.total)}</td></tr>` : `<tr><td colspan="2" class="note">Tax is added when you confirm.</td></tr>`}</table>
    ${isInvoice ? termsRow(d.terms, d.terms_days) : ""}
    ${isInvoice && d.issue_date ? `<div class="note">Issued ${esc(d.issue_date)}${d.due_date ? ` · Due ${esc(d.due_date)}` : ""} — the due date follows the terms you pick.</div>` : ""}
    ${d.customer_email ? `<label class="emailrow"><input type="checkbox" class="em" checked> Email to ${esc(d.customer_email)}${(d.customer_email_cc || []).length ? ` · cc ${esc(d.customer_email_cc.join(", "))}` : ""}${d.recipients_locked ? ` <span class="note">(your standing rule for this customer)</span>` : ""}</label>` : ""}
    <label class="emailrow"><input type="checkbox" class="pr" ${accountStorage.getItem("ledger.printAfterPosting") === "1" ? "checked" : ""}> Print after posting</label>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Confirm</button></div>`);
  const cardBtns = () => [card.querySelector(".confirm"), card.querySelector(".cancel")].filter(Boolean);
  card.querySelector(".pr").onchange = (e) => accountStorage.setItem("ledger.printAfterPosting", e.target.checked ? "1" : "0");
  // Rules the server hands back (a $0 total, a possible duplicate) are asked
  // once and answered on the retry — the draft itself is untouched meanwhile.
  const acknowledged = { force: false, allow_zero: false };
  card.querySelector(".confirm").onclick = async () => {
    cardBtns().forEach((b) => b.disabled = true);
    try {
      const sendEmail = card.querySelector(".em")?.checked ?? false;
      const wantPrint = card.querySelector(".pr")?.checked ?? false;
      const tm = card.querySelector(".tm");
      const terms = tm && !tm.dataset.termsDays ? tm.value : undefined;
      const termsDays = tm && tm.dataset.termsDays ? Number(tm.value) : undefined;
      const raw = await api(confirmPath, { draft_id: d.draft_id, send_email: sendEmail, ...(terms ? { terms } : {}), ...(termsDays != null ? { terms_days: termsDays } : {}),
        ...(acknowledged.force ? { force: true } : {}), ...(acknowledged.allow_zero ? { allow_zero: true } : {}) });
      const r = raw.posted || raw; // the server nests the result under `posted`
      const what = label.startsWith("ESTIMATE") ? "Estimate" : "Invoice";
      cardDone(card, `✅ ${what}${r.doc_number ? " " + r.doc_number : ""} posted` + (r.total != null ? ` — ${money(r.total)}` : "")
        + (r.emailed ? " · emailed to " + (r.emailed_to || "") : sendEmail ? " · email did not go out" : ""));
      if (r.link) {
        const a = document.createElement("a"); a.href = r.link; a.target = "_blank"; a.rel = "noopener";
        a.className = "emailrow"; a.textContent = `Open ${what.toLowerCase()} ${r.doc_number || ""} ↗`; card.appendChild(a);
      }
      if (wantPrint && (r.qbo_invoice_id || r.id)) {
        printPdfById(r.qbo_invoice_id || r.id, r.doc_number, label.startsWith("ESTIMATE") ? "estimate" : "invoice");
      }
    } catch (e) {
      cardBtns().forEach((b) => b.disabled = false);
      if (e.status === 409 && e.data?.zero_total) {
        if (await askConfirm("This invoice is for $0.00.", { title: "Create it anyway?", ok: "Create anyway" })) { acknowledged.allow_zero = true; return card.querySelector(".confirm").onclick(); }
      } else if (e.status === 409 && e.data?.duplicate_of) {
        if (await askConfirm(friendlyError(e, "This looks like one you already made."), { title: "Create it anyway?", ok: "Create anyway" })) { acknowledged.force = true; return card.querySelector(".confirm").onclick(); }
      } else toast(postedMessage(e), "err");
    }
  };
  card.querySelector(".cancel").onclick = async () => {
    cardBtns().forEach((b) => b.disabled = true);
    try { await api(cancelPath, { draft_id: d.draft_id }); cardDone(card, "Draft cancelled"); }
    catch (e) { cardBtns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't cancel that draft. Try again."), "err"); }
  };
}

function reminderCard(d) {
  const rows = (d.invoices || []).map((i) => `<tr><td>#${esc(i.doc_number)} · due ${esc(i.due_date)}</td><td>${money(i.balance)}</td></tr>`).join("");
  const card = bubble("card", `<h3>PAYMENT REMINDER</h3><div class="cust">${esc(d.customer)}</div>
    <table>${rows}<tr><td class="total">Total due</td><td class="total">${money(d.total_due)}</td></tr></table>
    <div class="emailrow">QuickBooks will email these invoices with a pay link to ${esc(d.customer_email)}</div>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Send reminder</button></div>`);
  const btns = () => [card.querySelector(".confirm"), card.querySelector(".cancel")].filter(Boolean);
  card.querySelector(".confirm").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try {
      const r = await api("/quickbooks-invoice/reminder-confirm", { draft_id: d.draft_id });
      cardDone(card, "✅ Reminder emailed to " + (r.emailed_to || d.customer_email) + ((r.failed || []).length ? " · couldn't send: " + r.failed.join(", ") : ""));
    } catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't send that reminder. Nothing was sent — try again."), "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/quickbooks-invoice/reminder-cancel", { draft_id: d.draft_id }); cardDone(card, "Cancelled — nothing was sent"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't cancel that reminder. Try again."), "err"); }
  };
}

function bookingCard(d) {
  const card = bubble("card", `<h3>BOOKING DRAFT</h3><div class="cust">${esc(d.title)}</div>
    <table><tr><td>Starts</td><td>${esc(new Date(d.start).toLocaleString())}</td></tr>
    <tr><td>Ends</td><td>${esc(new Date(d.end).toLocaleString())}</td></tr>
    ${d.location ? `<tr><td>Where</td><td>${esc(d.location)}</td></tr>` : ""}</table>
    ${d.description ? `<pre class="bkdesc" style="white-space:pre-wrap;font:12px/1.45 -apple-system,system-ui,sans-serif;color:var(--fg,#eee);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;margin:8px 0 2px;max-height:280px;overflow:auto">${esc(d.description)}</pre>` : ""}
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Book it</button></div>`);
  const btns = () => [card.querySelector(".confirm"), card.querySelector(".cancel")].filter(Boolean);
  card.querySelector(".confirm").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/google-calendar/booking-confirm", { draft_id: d.draft_id }); cardDone(card, "✅ Booked"); S.cal = null; }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't create that booking. Nothing was booked — try again."), "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/google-calendar/booking-cancel", { draft_id: d.draft_id }); cardDone(card, "Draft cancelled"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't cancel that booking draft. Try again."), "err"); }
  };
}

function emailDraftCard(d) {
  const card = bubble("card", `<h3>EMAIL DRAFT</h3><div class="cust">${esc(d.to)}</div>
    <table><tr><td>Subject</td><td>${esc(d.subject)}</td></tr></table>
    <div class="emailrow" style="display:block;white-space:pre-wrap;color:var(--text);max-height:190px;overflow:auto">${esc(d.body)}</div>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Send</button></div>`);
  const btns = () => [card.querySelector(".confirm"), card.querySelector(".cancel")].filter(Boolean);
  card.querySelector(".confirm").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { const r = await api("/gmail/email-send", { draft_id: d.draft_id }); cardDone(card, "✅ Sent to " + (r.to || d.to)); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't send that email. Nothing was sent — try again."), "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/gmail/email-cancel", { draft_id: d.draft_id }); cardDone(card, "Draft cancelled — nothing was sent"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't cancel that email draft. Try again."), "err"); }
  };
}

function smsDraftCard(d) {
  const card = bubble("card", `<h3>TEXT MESSAGE</h3><div class="cust">${esc(d.to_name ? d.to_name + " · " + d.to_number : d.to_number)}</div>
    <div class="emailrow" style="display:block;white-space:pre-wrap;color:var(--text);max-height:190px;overflow:auto">${esc(d.body)}</div>
    <div class="emailrow">From ${esc(d.from_number || "your business number")}</div>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Send text</button></div>`);
  const btns = () => [card.querySelector(".confirm"), card.querySelector(".cancel")].filter(Boolean);
  card.querySelector(".confirm").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try {
      const r = await api("/phone", { action: "sms-confirm", draft_id: d.draft_id });
      cardDone(card, "✅ Sent to " + (r.sent?.to_number || d.to_number));
    } catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't send that text. Nothing was sent — try again."), "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/phone", { action: "sms-cancel", draft_id: d.draft_id }); cardDone(card, "Draft cancelled — nothing was sent"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't cancel that text draft. Try again."), "err"); }
  };
}

// Confirm card for the tool calls the model may only STAGE (audit 07.02): crew
// dispatch texts, Front Desk / auto-reply changes, invoice-recipient rules, an
// invoice emailed to a new address, the email send permission. The server holds
// the exact reviewed payload; the tap replays that row and nothing else.
function actionCard(d) {
  const rows = (d.details || []).map((r) => `<tr><td>${esc(r.label)}</td><td style="white-space:pre-wrap">${esc(r.value)}</td></tr>`).join("");
  const card = bubble("card", `<h3>${esc(d.title || "CONFIRM")}</h3><div class="cust">${esc(d.summary || "")}</div>
    ${rows ? `<table>${rows}</table>` : ""}
    <div class="emailrow">Nothing happens until you tap ${esc(d.confirm_label || "Confirm")}.</div>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">${esc(d.confirm_label || "Confirm")}</button></div>`);
  const btns = () => [card.querySelector(".confirm"), card.querySelector(".cancel")].filter(Boolean);
  card.querySelector(".confirm").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try {
      const r = await api("/ledger-ai", { action: "action-confirm", draft_id: d.draft_id });
      const res = r.result || {};
      const done = d.kind === "dispatch_crew" ? "✅ Dispatch text sent"
        : d.kind === "send_invoice_email" ? "✅ Invoice emailed" + (res.to ? " to " + res.to : "")
        : d.kind === "email_autosend" ? "✅ Ledger may now send emails on its own"
        : d.kind === "set_customer_invoice_rule" ? "✅ Rule saved" + (res.summary ? " — " + res.summary : "")
        : "✅ Applied";
      cardDone(card, done);
      if (d.kind === "set_front_desk" || d.kind === "update_phone_autoreply") S.phone = null; // Phone tab refetches its board
    } catch (e) { btns().forEach((b) => b.disabled = false); if (!smsSendFailed(e)) toast(friendlyError(e, "Couldn't run that action. Nothing was changed — try again."), "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/ledger-ai", { action: "action-cancel", draft_id: d.draft_id }); cardDone(card, "Cancelled — nothing was changed"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(friendlyError(e, "Couldn't cancel that action. Try again."), "err"); }
  };
}

function printJobCard(j) {
  const card = bubble("card", `<h3>PRINT</h3><div class="cust">#${esc(j.doc_number)} · ${esc(j.customer || "")}</div>
    <table><tr><td>${esc(j.type || "invoice")}</td><td>${money(j.total)}</td></tr>
    <tr><td>Date</td><td>${esc(dateShort(j.date))}</td></tr></table>
    <div class="row"><button class="btn confirm">Print</button></div>`);
  card.querySelector(".confirm").onclick = (ev) => {
    ev.target.disabled = true;
    printPdfById(j.document_id, j.doc_number, j.type || "invoice")
      .then(() => cardDone(card, "Sent to your printer dialog"))
      .catch((e) => { ev.target.disabled = false; toast(friendlyError(e, "Couldn't open the print dialog. Try again."), "err"); });
  };
}

async function printPdfById(id, docNumber, type) {
  const d = await api("/quickbooks-invoice/pdf", { id: String(id), type: type || "invoice", doc_number: String(docNumber || "") });
  const bin = atob(d.pdf_base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0";
  frame.src = url; document.body.appendChild(frame);
  frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, "_blank"); } };
  setTimeout(() => { if (document.body.contains(frame)) frame.remove(); }, 60000);
}

/* ---------------- YOUR BUSINESS / TEAM / MENU ---------------- */
// iOS shows each connection's real state and account name (LedgerConnectionsView
// connectionRow). The web only ever showed a bare "Connect" button, so a broken
// connection looked identical to a healthy one. Same source of truth as iOS:
// the newest connected row in connector_accounts.
const CONNECTORS = [
  { key: "quickbooks", name: "QuickBooks Online", detail: "Books, invoices & reporting", start: "/quickbooks-oauth/start" },
  { key: "google_calendar", name: "Google Calendar", detail: "Bookings & appointments", start: "/google-calendar/start" },
  { key: "google_business_profile", name: "Business Profile", detail: "Reviews & reputation", start: "/google-business-profile/start" },
  { key: "gmail", name: "Gmail", detail: "Receipt & invoice radar", start: "/gmail/start" },
];

async function connectionStates() {
  try {
    const t = await token();
    const r = await fetch(`${SUPA_URL}/rest/v1/connector_accounts?status=eq.connected&select=connector,display_name,last_verified_at,last_error_code&order=updated_at.desc`,
      { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + t } });
    if (!r.ok) throw new Error("Connection status is temporarily unavailable.");
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error("Connection status is temporarily unavailable.");
    const map = {};
    rows.forEach(row => { if (!map[row.connector]) map[row.connector] = row; });
    S.connMap = map; S.connError = false;
    return map;
  } catch { S.connError = true; return S.connMap || {}; }
}
function connectionStatus(row) {
  return S.connError ? "Unable to check" : row?.last_error_code === "needs_reconnect" ? "Reconnect needed" : row ? "Connected" : "Not connected";
}
function renderConnectionRows(slot, map) {
  slot.innerHTML = (S.connError ? '<p class="note err">Connection status is temporarily unavailable. Your saved connections have not been removed.</p><button class="btn ghost" data-conn-retry>Retry status</button>' : "") + CONNECTORS.map(c => {
    const row = map[c.key], status = connectionStatus(row);
    // Every connected row can be cut (audit 10.2); QuickBooks keeps its own
    // handler because it also flips the workspace back to built-in books.
    const disconnect = !row ? "" : c.key === "quickbooks" ? '<button class="btn ghost" data-qbo-disconnect="1">Disconnect</button>' : `<button class="btn ghost" data-disconnect="${c.key}">Disconnect</button>`;
    return `<div class="kv"><span>${esc(c.name)}<br><small style="color:var(--dim)">${esc(row?.display_name || c.detail)}</small></span><span style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" data-connect="${c.start}" ${S.connError ? "disabled" : ""}>${status === "Connected" ? '<span style="color:var(--emerald)">Connected</span> · Reconnect' : status === "Not connected" ? "Connect" : esc(status)}</button>${disconnect}</span></div>`;
  }).join("");
  wireConnect(slot); wireDisconnectQuickBooks(slot); wireDisconnectConnector(slot, (latest) => { if (slot.isConnected) renderConnectionRows(slot, latest); });
  const retry = slot.querySelector("[data-conn-retry]");
  if (retry) retry.onclick = async () => { retry.disabled = true; const latest = await connectionStates(); if (slot.isConnected) renderConnectionRows(slot, latest); };
}

// Inventory & pricing — the catalog the assistant sells from. Two boxes on
// purpose: a CSV works for any business on day one, an API key needs to know
// which system it belongs to, so it carries a provider picker beside it.
const CAT_FIELDS = [
  ["sku", "Item / SKU"], ["brand", "Brand"], ["model", "Model"], ["size", "Size"],
  ["description", "Description"], ["price", "Price"], ["cost", "Cost"],
  ["quantity", "In stock"], ["unit", "Unit"], ["location", "Location"], ["duration_minutes","Duration (minutes)"], ["taxable","Taxable (yes/no)"], ["bookable","Bookable (yes/no)"],
];

async function renderCatalog(sh, initialImportType = "products") {
  const slot = sh.querySelector("#catslot");
  if (!slot) return;
  let board;
  try { board = await api("/catalog", { action: "board" }, "POST", { silentUpgrade: true }); }
  catch (err) {
    if (err.status === 402 && err.data?.code === "upgrade_required") {
      slot.innerHTML = `<p class="note">${esc(err.data.message || "Selling off your own price list is part of Ledger Pro.")}</p>
        <button class="btn em wide" style="margin-top:9px" id="catup">Move up to Ledger Pro</button>`;
      const up = slot.querySelector("#catup");
      if (up) up.onclick = () => upgradeHit(err.data);
      return;
    }
    slot.innerHTML = `<p class="note">Couldn't load your catalog — ${esc(err.message)}</p>`; return;
  }

  // A live feed that answers through the shop's own machine can be connected and
  // still unable to answer, because the machine is off. Saying "live feed" with
  // nothing behind it is the failure the owner finds out about mid-quote, so the
  // real state gets its own line.
  let bridges = {};
  try {
    const bs = await api("/catalog", { action: "bridge-status" });
    for (const b of bs.bridges || []) bridges[b.source_id] = b;
  } catch { /* status is a nicety; never block the page on it */ }

  const BRIDGE_LABEL = {
    online: ['<small style="color:var(--green,#39d98a)">· live · ready</small>', ""],
    offline: ['<small style="color:var(--red)">· not answering</small>',
              "Live prices come from the lookup service on your shop computer. It isn't responding, so Ledger will fall back to uploaded lists and say so."],
    paused: ['<small style="color:var(--amber,#f0b429)">· paused</small>',
             "The supplier refused a recent request, so lookups are paused for a short while rather than retried into a block. This clears on its own."],
  };

  const sources = board.sources || [];
  const providers = board.providers || [];
  const rows = sources.length
    ? sources.map((s) => {
        const st = s.kind === "api" ? (BRIDGE_LABEL[bridges[s.id]?.state] || BRIDGE_LABEL.offline) : null;
        return `<div class="kv"><span>${esc(s.name)}${s.archived_at ? " · archived (restorable from History)" : ""}${s.kind === "api" ? ' <small style="color:var(--cyan)">· live feed</small> ' + st[0] : ""}<br>
        <small style="color:var(--dim)">${s.kind === "api" ? (st[1] ? esc(st[1]) : "Prices are fetched at the moment you ask, so they are never stale.") : (s.item_count ? esc(String(s.item_count)) + " items · " : "") + esc(s.as_of || "")}</small></span>
        <span>${s.kind === "csv" ? `<button class="btn ghost" data-cathistory="${esc(s.id)}">History</button>` : ""}<button class="btn ghost" data-catdel="${esc(s.id)}" style="padding:6px 11px;font-size:12px;color:var(--red)">Remove</button></span></div>`;
      }).join("")
    : `<p class="note" style="margin:0 0 10px">Nothing loaded yet. Ledger will say it doesn't know rather than guess a price.</p>`;

  const liveFeeds = providers.some((p) => p.live);
  slot.innerHTML = `${rows}
    <div class="panel" style="margin-top:12px">
      <b style="font-size:13.5px">📄 Upload a price list</b>
      <p class="note" style="margin:6px 0 10px">Excel, CSV or tab-separated files with a single header row. Choose the worksheet, review the proposed columns and any exceptions, then choose a new list or explicitly update an existing one.</p>
      <button class="btn ghost wide" id="catpick">Choose a file</button>
      <input type="file" id="catfile" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      <p class="note" style="margin-top:8px">Need a starting point? <a href="#" id="cattpl">Price list template</a></p>
      <div id="catstage"></div>
    </div>
    ${liveFeeds ? `<div class="panel" style="margin-top:10px">
      <b style="font-size:13.5px">🔌 Connect a live feed</b>
      <p class="note" style="margin:6px 0 10px">A key on its own is just a string — pick the system it belongs to so Ledger knows where to send it. Prices stay live, nothing goes stale.</p>
      <label class="fld">WHICH SYSTEM</label>
      <select id="catprov" style="width:100%;padding:11px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid var(--line);color:inherit;font:inherit">
        ${providers.map((p) => `<option value="${esc(p.key)}">${esc(p.name)} — ${esc(p.detail)}</option>`).join("")}
      </select>
      <label class="fld" style="margin-top:10px">API KEY</label>
      <input id="catkey" placeholder="Paste the key from that system" autocomplete="off">
      <label class="fld" style="margin-top:10px">DEALER / LOCATION ID <span style="opacity:.6">(optional)</span></label>
      <input id="catdealer" placeholder="If that system gave you one" autocomplete="off">
      <button class="btn ghost wide" style="margin-top:11px" id="catconn">Save key</button>
      <p class="note" style="margin-top:8px;font-size:11.5px">Stored encrypted at rest and never shown back to anyone, including us.</p>
    </div>` : ""}`;

  slot.querySelectorAll("[data-cathistory]").forEach(btn=>btn.onclick=()=>catalogHistorySheet(sources.find(s=>s.id===btn.dataset.cathistory)));
  slot.querySelectorAll("[data-catdel]").forEach((btn) => {
    btn.onclick = async () => {
      if (!(await askConfirm("Its items stop appearing in catalog search, and History can restore them. Services already added to your service menu remain there until you remove them in Your business.", { title: "Archive this price list?", ok: "Archive", danger: true }))) return;
      btn.disabled = true;
      try { await api("/catalog", { action: "delete-source", source_id: btn.dataset.catdel }); toast("List archived — History can restore it"); renderCatalog(sh); }
      catch (err) { btn.disabled = false; toast(friendlyError(err, "Couldn't archive that price list. Try again."), "err"); }
    };
  });
  slot.querySelector("#cattpl").onclick = async (e) => {
    e.preventDefault();
    try { const t = await api("/catalog", { action: "template" }); downloadCsv(t.filename || "ledger-price-list-template.csv", t.csv); }
    catch (err) { toast(friendlyError(err, "Couldn't download the template. Try again."), "err"); }
  };

  const stage = slot.querySelector("#catstage");
  slot.querySelector("#catpick").onclick = () => slot.querySelector("#catfile").click();
  slot.querySelector("#catfile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6_000_000) { toast("That file is over 6 MB — trim unused columns or split it", "err"); return; }
    stage.innerHTML = `<p class="note" style="margin-top:10px">Reading ${esc(file.name)}…</p>`;
    let csv;
    try { csv = await readSpreadsheetAsCsv(file); }
    catch (err) { stage.innerHTML = `<p class="note" style="color:var(--red)">${esc(err.message || "Couldn't read that file.")}</p>`; return; }

    // Show what it decided BEFORE anything is stored, and let the owner fix a
    // wrong guess right here — a mis-read price column is the one mistake that
    // would quote a customer badly (audit 2026-09-14: Cancel was the only way out).
    const C = { map: null, importType:initialImportType, sourceId: "", requestId: crypto.randomUUID() };
    const paint = (look) => {
      const fields = look.fields || CAT_FIELDS.map(([k]) => k);
      const labelOf = Object.fromEntries(CAT_FIELDS);
      const pick = (f) => `<label class="emailrow">${esc(labelOf[f] || f)}<select data-catf="${f}" class="cmpinput">
          <option value="">— not in this file —</option>
          ${(look.headers || []).filter(Boolean).map((h) => `<option value="${esc(h)}"${look.column_map?.[f] === h ? " selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`;
      const found = CAT_FIELDS.filter(([key]) => look.column_map?.[key])
        .map(([key, label]) => `<div class="kv"><span>${esc(label)}</span><span style="color:var(--cyan);font-size:12.5px">${esc(look.column_map[key])}</span></div>`).join("");
      const preview = (look.preview || []).slice(0, 3).map((p) => `<div class="note" style="margin-top:4px">${esc([p.description || p.model || p.sku, p.brand, p.size].filter(Boolean).join(" · "))}${p.price != null ? ` — <b>${esc(money(p.price))}</b>` : ""}${p.quantity != null ? ` · ${esc(String(p.quantity))} in stock` : ""}${Object.keys(p.attributes||{}).some(k=>!k.startsWith("__")) ? `<details><summary>All preserved extra fields</summary>${Object.entries(p.attributes).filter(([k])=>!k.startsWith("__")).map(([k,v])=>`<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(k)}: ${esc(String(v))}</p>`).join("")}</details>` : ""}</div>`).join("");
      stage.innerHTML = `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
        <p class="note">${esc(file.name)}${file.ledgerSheet ? ` · ${esc(file.ledgerSheet)}` : ""}</p><label>What is in this file?<select id="cat-kind" class="cmpinput"><option value="products"${C.importType==="products" ? " selected" : ""}>Products &amp; inventory</option><option value="services"${C.importType==="services" ? " selected" : ""}>Services for invoices &amp; booking</option></select></label>${C.importType==="services" ? `<p class="note">Services go into your business menu and invoice choices. Duration is needed for booking. Taxable defaults to Yes; map a Taxable column for exemptions. Existing services are updated by name; other menu items stay.</p>` : ""}<label>Import destination<select id="cat-intent" class="cmpinput"><option value="">Add a new price list</option>${(board.sources || []).filter(s=>s.kind==="csv").map(s=>`<option value="${esc(s.id)}"${C.sourceId===s.id ? " selected" : ""}>Update: ${esc(s.name)}</option>`).join("")}</select></label><b style="font-size:13px">${esc(String(look.row_count))} rows${look.truncated ? " (first 25,000)" : ""}</b>
        ${look.summary ? `<p class="note" style="margin:5px 0 9px">${esc(look.summary)}</p>` : ""}
        ${look.note ? `<p class="note" style="margin:5px 0 9px">${esc(look.note)}</p>` : ""}
        ${look.warning ? `<p class="note" style="color:var(--orange);margin:5px 0 9px">⚠️ ${esc(look.warning)}</p>` : ""}
        <div class="eyebrow" style="margin-top:6px">COLUMNS I FOUND${look.mapped_by === "headers" ? ' <small style="color:var(--dim);letter-spacing:0;text-transform:none">· matched by column names</small>' : ""}</div>
        ${found || '<p class="note">None yet — pick them below.</p>'}
        <details${look.can_import === false ? " open" : ""}><summary class="eyebrow" style="cursor:pointer;margin:10px 0">Fix a column</summary>
          <div class="cmpsect">${fields.map(pick).join("")}</div></details>
        ${preview ? `<div class="eyebrow" style="margin-top:8px">PREVIEW</div>${preview}` : ""}
        ${look.issue_count ? `<details><summary>${look.issue_count} issues to review before import</summary>${look.issues.map(i=>`<p class="note">Row ${i.line}: ${esc(i.issues.join("; "))}</p>`).join("")}</details>` : ""}
        ${look.unmapped?.length ? `<p class="note" style="margin-top:8px;font-size:11.5px">Kept alongside each item: ${esc(look.unmapped.slice(0, 8).join(", "))}${look.unmapped.length > 8 ? "…" : ""}</p>` : ""}
        <button class="btn primary wide" style="margin-top:12px" id="catgo"${look.can_import === false ? " disabled" : ""}>Import ${esc(String(look.row_count))} items</button>
        <button class="btn ghost wide" style="margin-top:8px" id="catcancel">Cancel</button></div>`;
      stage.querySelector("#cat-kind").onchange=async e=>{C.importType=e.target.value;C.requestId=crypto.randomUUID();paint(await api("/catalog",{action:"analyze",filename:file.name,csv,column_map:C.map || look.column_map,import_type:C.importType}))};
      stage.querySelector("#cat-intent").onchange=e=>{C.sourceId=e.target.value;C.requestId=crypto.randomUUID()};
      stage.querySelectorAll("[data-catf]").forEach((sel) => sel.onchange = async () => {
        C.map = { ...(look.column_map || {}) };
        if (sel.value) C.map[sel.dataset.catf] = sel.value; else delete C.map[sel.dataset.catf];
        stage.querySelector("#catgo").disabled = true;
        try { paint(await api("/catalog", { action: "analyze", filename: file.name, csv, import_type:C.importType, column_map: C.map })); }
        catch (err) { toast(friendlyError(err, "Couldn't read that file. Check the format and try again."), "err"); }
      });
      stage.querySelector("#catcancel").onclick = () => { stage.innerHTML = ""; };
      stage.querySelector("#catgo").onclick = async (ev) => {
        const go = ev.currentTarget;
        go.disabled = true; go.textContent = "Importing…";
        try {
          const done = await api("/catalog", { action: "import", filename: file.name, csv, column_map: look.column_map,import_type:C.importType,request_id:C.requestId,keep_existing:!C.sourceId,replace_source_id:C.sourceId || undefined,expected_revision:(board.sources || []).find(s=>s.id===C.sourceId)?.revision });
          toast(`${done.imported} items loaded${done.replaced ? " — old copy replaced" : ""}`);
          renderCatalog(sh);
        } catch (err) { go.disabled = false; go.textContent = "Try import again"; toast(friendlyError(err, "Couldn't finish the import. Nothing was changed — try again."), "err"); }
      };
    };
    stage.innerHTML = `<p class="note" style="margin-top:10px">Working out your columns…</p>`;
    try { paint(await api("/catalog", { action: "analyze", filename: file.name, csv,import_type:C.importType })); }
    catch (err) { stage.innerHTML = `<p class="note" style="color:var(--red);margin-top:10px">${esc(err.message)}</p>`; return; }
  };

  const conn = slot.querySelector("#catconn");
  if (conn) conn.onclick = async (ev) => {
    const btn = ev.currentTarget;
    const key = slot.querySelector("#catkey").value.trim();
    if (!key) { toast("Paste the API key first", "err"); return; }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const done = await api("/catalog", {
        action: "connect-api",
        provider: slot.querySelector("#catprov").value,
        api_key: key,
        dealer_id: slot.querySelector("#catdealer").value.trim(),
      });
      toast("Key saved");
      if (done.note) alert(done.note);
      renderCatalog(sh);
    } catch (err) { btn.disabled = false; btn.textContent = "Save key"; toast(friendlyError(err, "Couldn't save that key. Try again."), "err"); }
  };
}

async function businessSheet() {
  const b = S.profile?.business || {};
  const u = S.usage;
  const pct = u && u.budget_usd > 0 ? Math.round(u.spent_usd / u.budget_usd * 100) : 0;
  if (S.booksProvider === undefined) {
    try { S.booksProvider = (await booksApi({ action: "settings" })).provider; }
    catch { S.booksProvider = "quickbooks"; }
  }
  const native = S.booksProvider === "native";
  const row = (id, icon, title, detail) => `<button class="revbtn" id="${id}">
      <span class="ic">${icon}</span><span class="m"><b>${esc(title)}</b><span>${esc(detail)}</span></span>
      <span class="chev">&#8250;</span></button>`;
  sheet(`<h2>Business profile &amp; settings</h2><p class="sh-sub">${esc(b.name || "")}${S.profile?.role ? " · you're the " + esc(S.profile.role) : ""}</p>
    <div class="cmpsect">
      ${native ? row("bzbooks", "&#9881;", "Books settings", "Tax, invoice numbering, branding, payment info")
        : row("bzbooks", "&#9881;", "Books", "This workspace runs on QuickBooks Online")}
      ${native ? row("bzcard", "&#128179;", "Card payments", "Stripe setup — get paid online") : ""}
      ${row("bzsecurity", "&#128737;", "Account security", "Two-step verification and backup authenticators")}
      ${row("bzphone", "&#128222;", "Phone & Front Desk", "Number, reminders, auto-replies")}
      ${row("bzshop", "&#127968;", "Your business", shopSummary(S.shop))}
      ${row("bzimport", "&#128229;", "Bring your data", isAuto() ? "Preview supported customer and vehicle tables before importing" : "Preview supported customer tables before importing")}
      ${row("bzexport", "&#128228;", "Export your data", "Download your records, original imports and available history")}
    </div>
    <div class="eyebrow" style="margin-top:20px">PROFILE</div>
    <label class="fld">BUSINESS NAME</label><input id="bn" value="${esc(b.name || "")}">
    <label class="fld">ADDRESS</label><input id="ba" value="${esc(b.address || "")}">
    <label class="fld">WHAT LEDGER CALLS YOU</label><input id="bcall" value="${esc(b.call_me ?? "Boss")}" placeholder="Boss, your first name, or leave blank" maxlength="40">
    <label class="fld">LOGO</label>
    <div class="rowbtns" style="align-items:center">
      ${b.logo_url ? `<img src="${esc(b.logo_url)}" alt="Business logo" style="width:46px;height:46px;border-radius:11px;object-fit:cover">` : ""}
      <button class="btn ghost" id="blogo">${b.logo_url ? "Replace logo" : "Upload logo"}</button>
    </div>
    <input type="file" id="blogofile" accept="image/jpeg,image/png,image/webp" hidden>
    <button class="btn ghost wide" style="margin-top:11px" id="bsave">Save</button>

    <div class="eyebrow" style="margin-top:20px">AI ALLOWANCE</div>
    <div class="panel" style="margin-top:8px">
      <div class="kv"><span>${u?.trial_credit?"Used during trial (USD)":"Used this month"}</span><span>${u ? money(u.spent_usd) + " of " + money(u.budget_usd) : "—"}</span></div>
      <div style="height:7px;background:rgba(255,255,255,.07);border-radius:99px;margin-top:9px;overflow:hidden">
        <div style="height:100%;width:${Math.min(pct, 100)}%;background:${pct >= 80 ? "var(--orange)" : "linear-gradient(90deg,var(--cyan),var(--purple))"}"></div></div>
      <button class="btn ghost wide" style="margin-top:11px" id="bpu">${u?.trial_credit?"View trial credit":"⚡ Power-Ups"}</button>
    </div>

    <div class="eyebrow" style="margin-top:20px">“HEY LEDGER”</div>
    <div class="panel" style="margin-top:8px">
      ${S.voice?.available ? `<div class="kv" style="align-items:center;border-bottom:0;padding-top:2px"><span style="color:var(--text)"><b>Say “Hey Ledger” to open Ledger Live</b></span>
        <button class="pswx${WAKE.on ? " on" : ""}" id="wakeTog" role="switch" aria-checked="${WAKE.on}" aria-label="Hey Ledger"${wakeSupported() ? "" : " disabled"}><i></i></button></div>
      <p class="note" style="margin-top:4px">${wakeSupported()
        ? "Works while this tab is open and on screen — your browser does the listening, and the mic stays on while the switch is on. On a phone, the Ledger AI iPhone app has the same switch."
        : "This browser can't listen for a wake word. Use Chrome or Edge on a computer, or the Ledger AI iPhone app."}</p>
      <p class="note" style="margin-top:6px;color:var(--cyan)">On iPhone, “Hey Siri, talk to Ledger” works anywhere — even with the app closed.</p>`
      // Voice is paused (audit 16-04): no switch, no mic, and the truth in one line.
      : `<div class="kv" style="align-items:center;border-bottom:0;padding-top:2px"><span style="color:var(--text)"><b>Ledger Live is paused</b></span>
        <button class="pswx" id="wakeTog" role="switch" aria-checked="false" aria-label="Hey Ledger" disabled><i></i></button></div>
      <p class="note" style="margin-top:4px" id="wakepaused">${esc(S.voice?.message || "Ledger Live is temporarily paused. Typed chat is still available.")} The “Hey Ledger” wake word and the microphone stay off until voice is back.</p>`}
    </div>
    ${u?.sms ? `<div class="eyebrow" style="margin-top:20px">TEXTING CREDIT</div>
    <div class="panel" style="margin-top:8px">
      ${u.sms.metered ? `${smsMeterHtml(u.sms)}
      <button class="btn ghost wide" style="margin-top:11px" id="bsms">💬 Add $25 texting credit</button>`
      // The included amount is the plan's ($10 Solo, $25 Pro) — read off the
      // workspace, never typed here (audit 16-07, 2026-09-17).
      : `<p class="note" style="margin-top:0">Your texts run on your own line, so that provider bills them. A Ledger business number includes ${Number.isFinite(Number(u.sms.credit_usd)) ? money0(u.sms.credit_usd) : "your plan's texting credit"} of texting every month.</p>`}
    </div>` : ""}

    <div class="eyebrow" style="margin-top:20px" id="connhead">CONNECTED SERVICES</div>
    <p class="note" style="margin-top:5px">Authorization happens on each provider's official sign-in page. Ledger never receives your password.</p>
    <div id="connslot" class="note" style="margin-top:8px">Checking connections…</div>

    <div class="eyebrow" style="margin-top:20px">INVENTORY &amp; PRICING</div>
    <p class="note" style="margin-top:5px">Give Ledger your product list and it can quote from it — price, size, what's in stock.</p>
    <div id="catslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">ONLINE BOOKING</div>
    <div id="bookslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">TEAM</div>
    ${u?.trial_credit?'<p class="note">Trial teammates share the same single US$20 credit. Separate paid-seat allowances start only after paid activation.</p>':""}<div id="teamslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">NOTIFICATIONS</div>
    <div id="pushslot" class="note" style="margin-top:8px">Checking…</div>

    <div class="eyebrow" style="margin-top:20px">YOUR PLAN</div>
    <div id="planslot" class="note" style="margin-top:8px">Checking…</div>

    <div class="eyebrow" style="margin-top:20px">APP</div>
    <div class="rowbtns" style="margin-top:8px;flex-direction:column">
      ${S.installPrompt ? `<button class="btn primary wide" id="install">📲 Install Ledger AI</button>` : ""}
      <button class="btn ghost wide" id="bnew">Start a fresh conversation</button>
      <button class="btn ghost wide" id="bbill">Subscription &amp; billing</button>
      <button class="btn ghost wide" id="bsupport">Contact support</button>
      <button class="btn ghost wide" id="bsupportchat">Support &amp; account help</button>
      <button class="btn ghost wide" id="bout" style="color:var(--red)">Sign out</button>
      <button class="btn ghost wide" id="bdel" style="color:var(--red)">Delete account</button>
    </div>
    <p class="note" style="margin-top:12px;text-align:center">
      <a href="${FN}/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a> ·
      <a href="${FN}/legal/terms" target="_blank" rel="noopener">Terms of Service</a></p>`, async (sh) => {
    wireConnect(sh);
    sh.querySelector("#bzsecurity").onclick = () => { closeSheet(); openSecurity(supa); };
    pushSettingsCard(sh.querySelector("#pushslot"));
    sh.querySelector("#bzbooks").onclick = () => {
      closeSheet();
      if (native) booksSettingsSheet();
      else { S.financeLane = "invoices"; setTab("finance"); }
    };
    const cardBtn = sh.querySelector("#bzcard");
    if (cardBtn) cardBtn.onclick = async () => {
      try { const r = await booksApi({ action: "connect-onboard" }); if (r.url) window.open(r.url, "_blank"); }
      catch (e) { toast(friendlyError(e, "Couldn't open payouts. Try again."), "err"); }
    };
    sh.querySelector("#bzphone").onclick = () => { closeSheet(); setTab("phone"); };
    sh.querySelector("#bzshop").onclick = () => shopProfileSheet(() => businessSheet());
    sh.querySelector("#bzimport").onclick = () => bringDataSheet();
    sh.querySelector("#bzexport").onclick = () => exportDataSheet();
    sh.querySelector("#bsupport").onclick = supportSheet;
    sh.querySelector("#bsupportchat").onclick = supportChatSheet;
    sh.querySelector("#blogo").onclick = () => sh.querySelector("#blogofile").click();
    sh.querySelector("#blogofile").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const btn = sh.querySelector("#blogo");
      btn.disabled = true; btn.textContent = "Uploading…";
      try {
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file);
        });
        const detail = await api("/workspace-profile", { action: "logo", image: { data: dataUrl, media_type: file.type } });
        S.profile.business = { ...S.profile.business, ...detail };
        toast("Logo updated"); closeSheet(); businessSheet();
      } catch (err) { btn.disabled = false; btn.textContent = "Upload logo"; toast(friendlyError(err, "Couldn't upload your logo. Try a smaller image."), "err"); }
    };
    connectionStates().then((map) => {
      const slot = sh.querySelector("#connslot"); if (slot?.isConnected) renderConnectionRows(slot, map);
    });
    renderCatalog(sh);
    // Online booking — public link customers use with no account; requests
    // land in booking_requests AND the Leads lane. Owner/admin can toggle.
    const renderBooking = async () => {
      const slot = sh.querySelector("#bookslot"); if (!slot) return;
      try {
        const s = await api("/bookings", { action: "settings" });
        const canToggle = ["owner", "admin"].includes(S.profile?.role || "owner");
        let html = "";
        if (s.enabled && s.link) {
          html = `<style>@keyframes bkpulse{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}50%{box-shadow:0 0 0 7px rgba(52,211,153,0)}}</style>
            <div style="border-radius:18px;padding:1px;background:linear-gradient(150deg,rgba(34,211,238,.5),rgba(168,85,247,.35) 55%,rgba(34,211,238,.12))">
            <div style="border-radius:17px;background:rgba(13,18,25,.95);padding:16px 15px">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">
              <span style="width:9px;height:9px;border-radius:50%;background:var(--emerald);animation:bkpulse 2s ease-in-out infinite"></span>
              <b style="color:var(--emerald);letter-spacing:.04em;font-size:13px">BOOKING PAGE LIVE</b></div>
            <div style="display:flex;gap:14px;align-items:center">
              <div id="bkqr" style="flex:0 0 auto;width:96px;height:96px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 6px 24px rgba(34,211,238,.18)"></div>
              <div style="min-width:0">
                <div style="font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--dim);word-break:break-all;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:10px;padding:8px 10px">${esc(s.link)}</div>
                <p class="note" style="margin:8px 0 0;font-size:11.5px">Scan or share — requests land in your Leads lane.</p>
              </div></div>
            <div style="display:flex;gap:9px;margin-top:14px">
              <button id="bkcopy" style="flex:1;padding:11px;border:0;border-radius:12px;font-weight:800;font-size:13px;color:#03181d;background:linear-gradient(135deg,var(--cyan),#7dd3fc);cursor:pointer">Copy link</button>
              <button id="bkshare" style="flex:1;padding:11px;border:0;border-radius:12px;font-weight:800;font-size:13px;color:#fff;background:linear-gradient(135deg,var(--purple),#c084fc);cursor:pointer">Share</button></div>
            ${canToggle ? '<button class="btn ghost wide" style="margin-top:10px;color:var(--red)" id="bktoggle">Turn booking page off</button>' : ""}
            <div id="bkreqs"></div></div></div>`;
        } else {
          html = `<p class="note" style="margin:0 0 8px">Give customers a link to request appointments 24/7 — no account, no phone tag. Requests land straight in your Leads lane.</p>
            ${canToggle ? '<button class="btn primary wide" id="bktoggle">Turn on my booking page</button>' : '<p class="note">Ask the owner to switch it on.</p>'}`;
        }
        slot.innerHTML = html;
        const tog = slot.querySelector("#bktoggle");
        if (tog) tog.onclick = async () => {
          tog.disabled = true;
          try { await api("/bookings", { action: "set-enabled", enabled: !s.enabled }); renderBooking(); }
          catch (e) { tog.disabled = false; toast(friendlyError(e, "Couldn't change your booking page. Try again."), "err"); }
        };
        const cp = slot.querySelector("#bkcopy");
        if (cp) cp.onclick = async () => {
          try { await navigator.clipboard.writeText(s.link); toast("Link copied"); }
          catch { await linkSheet("Your booking link", s.link); }
        };
        const sh2 = slot.querySelector("#bkshare");
        if (sh2) sh2.onclick = async () => {
          try { await navigator.share({ title: "Book with " + (S.profile?.business?.name || "us"), url: s.link }); }
          catch (shareErr) {
            if (shareErr?.name === "AbortError") return; // the owner closed the share sheet
            try { await navigator.clipboard.writeText(s.link); toast("Link copied"); }
            catch { await linkSheet("Your booking link", s.link); }
          }
        };
        const qrBox = slot.querySelector("#bkqr");
        if (qrBox && s.link) {
          try {
            if (!window.qrcode) await new Promise((res, rej) => {
              const sc = document.createElement("script"); sc.src = "assets/qrcode.js?v=1";
              sc.onload = res; sc.onerror = rej; document.head.appendChild(sc);
            });
            const q = window.qrcode(0, "M"); q.addData(s.link); q.make();
            qrBox.innerHTML = `<img src="${q.createDataURL(4, 2)}" alt="Booking QR" style="width:88px;height:88px;image-rendering:pixelated">`;
          } catch { qrBox.style.display = "none"; }
        }
        if (s.enabled) {
          try {
            const l = await api("/bookings", { action: "list" });
            const fresh = (l.requests || []).filter((r) => r.status === "new").slice(0, 5);
            const rq = slot.querySelector("#bkreqs");
            if (rq && fresh.length) {
              rq.innerHTML = `<div class="eyebrow" style="margin-top:12px;font-size:10px">NEW REQUESTS</div>` + fresh.map((r) =>
                `<div class="kv"><span>${esc(r.name)}<br><small style="color:var(--dim)">${esc(r.service || r.preferredText || "")}</small></span>
                 <span style="display:flex;gap:6px"><button class="btn ghost" data-bkbook="${esc(r.id)}" style="padding:6px 11px;font-size:12px">Book with Ledger</button><button class="btn ghost" data-bkdone="${esc(r.id)}" style="padding:6px 11px;font-size:12px">Handled</button></span></div>`).join("");
              // Every booking is a four-block work order (Kyle 2026-09-13): hand
              // the request to Ledger, which prices it from the business's own
              // list and drafts the appointment for a Confirm tap.
              rq.querySelectorAll("[data-bkbook]").forEach((btn) => btn.onclick = () => {
                const r = fresh.find((x) => x.id === btn.dataset.bkbook); if (!r) return;
                openChat();
                $("box").value = `Book this booking-page request: ${r.name}, phone ${r.phone || "not given"}, email ${r.email || "not given"}, wants "${r.service || "(no service given)"}"${r.preferredText ? `, preferred time ${r.preferredText}` : ""}${r.notes ? `, notes: ${r.notes}` : ""}. Ask me for anything missing, price it from our price list, and draft the appointment.`;
                send();
              });
              rq.querySelectorAll("[data-bkdone]").forEach((btn) => btn.onclick = async () => {
                btn.disabled = true;
                try { await api("/bookings", { action: "mark-handled", id: btn.dataset.bkdone }); renderBooking(); }
                catch (e) { btn.disabled = false; toast(friendlyError(e, "Couldn't mark that booking handled. Try again."), "err"); }
              });
            }
          } catch (reqErr) {
            const rq = slot.querySelector("#bkreqs");
            if (rq) rq.innerHTML = `<p class="note err" style="margin-top:12px">${esc(friendlyError(reqErr, "Couldn't load new booking requests. Reopen this screen to try again."))}</p>`;
          }
        }
      } catch { slot.textContent = "Booking unavailable right now."; }
    };
    renderBooking();
    // One billing read for the whole sheet: the plan card and the team card
    // both need to know how this workspace pays (audit 16-02, 2026-09-17).
    const billingStatus = api("/stripe-billing/status", {}).catch(() => null);
    // Which tier this shop is on, in words, with the one button that moves it.
    // A customer should never have to guess what they are paying for.
    (async () => {
      const slot = sh.querySelector("#planslot"); if (!slot) return;
      try {
        const st = await billingStatus;
        if (!st) throw new Error("Plan unavailable right now.");
        const key = st.plan || "pro";
        const spec = (st.plans || []).find((p) => p.key === key);
        const b = PLAN_BLURB[key] || { tag: "", line: "", extra: "" };
        const price = st.complimentary_access ? 0 : spec?.price;
        const apple = st.billing_source === "apple";
        let action = "";
        if (inAndroidApp() || st.complimentary_access) action = "";
        else if (key === "solo") action = `<button class="btn em wide" style="margin-top:11px" id="planup">Move up to Ledger Pro${st.plans?.find((p) => p.key === "pro")?.price ? ` — $${st.plans.find((p) => p.key === "pro").price}/mo` : ""}</button>`;
        else if (st.can_change_plan) action = `<button class="btn ghost wide" style="margin-top:11px" id="plandown">Switch to Ledger Solo</button>`;
        slot.innerHTML = `<div class="kv"><span><b>${esc(st.plan_name || (key === "solo" ? "Ledger Solo" : "Ledger Pro"))}</b><br>
          <small style="color:var(--dim)">${esc(b.tag)}</small></span>
          <span>${st.complimentary_access ? "$0 · test access" : price ? `$${price}<small style="color:var(--dim)">/mo</small>` : ""}</span></div>
          <p class="note" style="margin:8px 0 0">${esc(b.line)}</p>
          ${st.complimentary_access ? '<p class="note">Complimentary test access. No card required or automatic subscription charge. Processing fees are separate.</p>' : ""}
          ${apple ? `<p class="note" style="margin:8px 0 0">Billed through the App Store — change your plan on your iPhone in Settings → your name → Subscriptions.</p>` : ""}
          ${action}`;
        const up = slot.querySelector("#planup");
        if (up) up.onclick = async () => { up.disabled = true; up.textContent = "Switching…"; if (!(await moveToPlan("pro"))) { up.disabled = false; up.textContent = "Move up to Ledger Pro"; } };
        const down = slot.querySelector("#plandown");
        if (down) down.onclick = async () => {
          // Two taps, never one: dropping a tier is a decision, not a slip.
          if (down.dataset.armed !== "1") {
            down.dataset.armed = "1";
            down.textContent = "Tap again to move down to Solo";
            // Say what actually goes away, and that moving back up is at
            // today's price — an older price is never handed back.
            const warn = document.createElement("p");
            warn.className = "note"; warn.id = "plandownwarn"; warn.style.marginTop = "8px"; warn.style.color = "var(--gold)";
            warn.textContent = "This switches off crew dispatch, time cards, teammate logins, your own price list and Front Desk, and drops your included AI to $60/mo. Moving back up later is at today's Pro price.";
            if (!slot.querySelector("#plandownwarn")) down.after(warn);
            return;
          }
          down.disabled = true; down.textContent = "Switching…";
          if (!(await moveToPlan("solo"))) { down.disabled = false; down.dataset.armed = ""; down.textContent = "Switch to Ledger Solo"; }
        };
      } catch { slot.textContent = "Plan unavailable right now."; }
    })();
    sh.querySelector("#bpu").onclick = powerUpSheet;
    const wakeTog = sh.querySelector("#wakeTog"); if (wakeTog) wakeTog.onclick = () => wakeToggle(wakeTog);
    const bsms = sh.querySelector("#bsms"); if (bsms) bsms.onclick = textingSheet;
    sh.querySelector("#bnew").onclick = () => { newConversation(); closeSheet(); openChat(); };
    sh.querySelector("#bbill").onclick = async () => {
      try { const d = await api("/stripe-billing/portal", {}); location.href = d.url; }
      catch (e) { toast(friendlyError(e, "Couldn't open billing. Try again."), "err"); }
    };
    sh.querySelector("#bout").onclick = () => supa.auth.signOut().then(() => location.reload());
    sh.querySelector("#bdel").onclick = async (e) => {
      // App Store 5.1.1(v): a real, in-app, no-undo path — not a support-ticket request.
      const btn = e.currentTarget;
      if (btn.disabled) return;
      const typed = await confirmAccountDeletion(DELETE_ACCOUNT_WARNING);
      if (typed !== "DELETE") { if (typed !== null) toast("Account not deleted — you didn't type DELETE.", "err"); return; }
      btn.disabled = true; btn.textContent = "Deleting…";
      try {
        const done = await api("/workspace-profile", { action: "delete-account", confirm: "DELETE" });
        if (done?.notice) alert(done.notice);
        await supa.auth.signOut();
        location.reload();
      } catch (err) {
        btn.disabled = false; btn.textContent = "Delete account";
        toast(friendlyError(err, "Couldn't delete your account. Nothing was deleted — try again."), "err");
      }
    };
    const inst = sh.querySelector("#install");
    if (inst) inst.onclick = async () => { S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null; closeSheet(); };
    sh.querySelector("#bsave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        const detail = await api("/workspace-profile", { action: "update", name: sh.querySelector("#bn").value.trim(), address: sh.querySelector("#ba").value.trim(), call_me: sh.querySelector("#bcall").value.trim() });
        S.profile.business = { ...S.profile.business, ...detail };
        // The brand bar stays "Ledger AI"; the shop's name lives in the Home hero.
        const hero = $("heroname");
        if (hero) hero.textContent = S.profile.business.name || "Ledger AI";
        toast("Saved");
      } catch (err) { toast(friendlyError(err, "Couldn't save your business details. Try again."), "err"); }
      e.currentTarget.disabled = false;
    };
    try {
      const t = await api("/team", { action: "list" });
      S.team = t;
      const me = (t.members || []).find((m) => (m.email || "").toLowerCase() === S.email);
      if (me) S.profile.role = me.role;
      const slot = sh.querySelector("#teamslot");
      // Seat billing is a Stripe subscription item (audit 16-02): an App Store
      // subscription has no seat product, so an invite there would hand out a
      // login nothing bills. Say so instead of promising "$299/mo per seat".
      const bst = await billingStatus;
      const appleBilled = bst?.billing_source === "apple";
      const isOwner = (S.profile?.role || (S.team?.members || []).find((m) => (m.email || "").toLowerCase() === S.email)?.role) === "owner";
      slot.innerHTML = `${(t.members || []).map((m) => `<div class="kv"><span>${esc(m.email)}</span><span>${esc(m.role)} ${me?.role === "owner" && m.role !== "owner" ? `<button class="btn ghost" data-team-remove="${esc(m.userId)}">Remove</button>` : ""}</span></div>`).join("")}
        ${(t.invites || []).map((i) => `<div class="kv"><span>${esc(i.email)}</span><span style="color:var(--gold)">${i.locked ? "Locked" : i.expired ? "Expired" : "Waiting to join"} ${me?.role === "owner" ? `<button class="btn ghost" data-team-revoke="${esc(i.id)}">Revoke</button>` : ""}</span></div>`).join("")}
        ${(S.profile?.role || (S.team?.members || []).find((m) => (m.email || "").toLowerCase() === S.email)?.role) === "owner"
          // Seat price and availability come from the server (16-02 / 02-06):
          // an App Store-billed or complimentary workspace is told why it
          // cannot add a seat instead of being handed a button that fails.
          // Solo keeps the button — its 402 opens the "move up to Pro" door.
          ? (t.seats && t.seats.available === false && t.seats.reason !== "plan_solo"
            ? `<p class="note" style="margin-top:10px">${esc(t.seats.message || "Teammate seats aren't available on this plan.")}</p>`
            : `<div style="margin-top:10px"><input id="invmail" type="email" placeholder="teammate@business.com">
          ${inAndroidApp() ? "" : `<button class="btn ghost wide" style="margin-top:8px" id="invgo">Invite — $${Number(t.seats?.price_usd) || 299}/mo per seat</button>`}</div>`)
          : ""}`;
      const manage = async (button, action, key, question) => {
        if (!(await askConfirm(question, { title: action === "remove" ? "Remove this teammate?" : "Revoke this invitation?", ok: action === "remove" ? "Remove" : "Revoke", danger: true }))) return;
        button.disabled = true;
        try { await api("/team", { action, [key]: action === "remove" ? button.dataset.teamRemove : button.dataset.teamRevoke }); closeSheet(); businessSheet(); }
        catch (error) { button.disabled = false; toast(friendlyError(error, "Couldn't change that teammate. Nothing was changed — try again."), "err"); }
      };
      slot.querySelectorAll("[data-team-remove]").forEach(button => button.onclick = () => manage(button, "remove", "user_id", "They lose access and the paid seat is released."));
      slot.querySelectorAll("[data-team-revoke]").forEach(button => button.onclick = () => manage(button, "revoke", "invite_id", "Its join code will stop working."));
      const go = slot.querySelector("#invgo");
      if (go) go.onclick = async () => {
        go.disabled = true;
        try {
          const r = await api("/team", { action: "invite", email: slot.querySelector("#invmail").value.trim() });
          slot.innerHTML = `<p class="note ok">Invited. Their join code is <b>${esc(r.code || "")}</b> — send it to them; it expires in 7 days.</p>`;
        } catch (e) { go.disabled = false; toast(friendlyError(e, "Couldn't send that invitation. Try again."), "err"); }
      };
    } catch { const slot = sh.querySelector("#teamslot"); if (slot) slot.textContent = "Team unavailable."; }
  });
}

// Support tickets — the web twin of iOS SupportTicketSheet.
async function supportSheet() {
  sheet(`<h2>Contact support</h2>
    <p class="sh-sub">We read every ticket. Describe what happened and we'll come back to you.</p>
    <label class="fld">SUBJECT</label><input id="stsub" placeholder="What's it about?">
    <label class="fld">DETAILS</label><textarea id="stmsg" rows="5" placeholder="What happened, and what did you expect?"></textarea>
    <button class="btn primary wide" style="margin-top:12px" id="stgo">Send ticket</button>
    <div class="note" id="stnote" style="margin-top:9px"></div>
    <div class="eyebrow" style="margin-top:20px">YOUR TICKETS</div>
    <div id="stlist" class="note" style="margin-top:8px">Loading…</div>`, async (sh) => {
    const note = sh.querySelector("#stnote");
    const refresh = async () => {
      const slot = sh.querySelector("#stlist"); if (!slot) return;
      try {
        const d = await api("/support-ticket", { action: "list" });
        slot.innerHTML = (d.tickets || []).length
          ? d.tickets.map((t) => `<div class="kv"><span>${esc(t.subject)}</span><span>${esc(t.status)}</span></div>`).join("")
          : "No tickets yet.";
      } catch (e) { slot.textContent = e.message; }
    };
    sh.querySelector("#stgo").onclick = async (e) => {
      e.currentTarget.disabled = true;
      note.className = "note"; note.textContent = "Sending…";
      try {
        await api("/support-ticket", { action: "create",
          subject: sh.querySelector("#stsub").value.trim(),
          message: sh.querySelector("#stmsg").value.trim() });
        note.className = "note ok"; note.textContent = "Ticket sent — we'll be in touch.";
        sh.querySelector("#stsub").value = ""; sh.querySelector("#stmsg").value = "";
        refresh();
      } catch (err) { note.className = "note err"; note.textContent = err.message; }
      e.currentTarget.disabled = false;
    };
    refresh();
  });
}

// Support chat — support-agent function, native-styled twin of the marketing
// site's "Ask Ledger Support" widget (assets/support-widget.js). Authorization
// is OPTIONAL: v2 (2026-08-22) attaches the signed-in session token, the same
// idiom as api()/token() above, so a signed-in visitor unlocks three read-only
// self-service tools (subscription, connectors, AI allowance) server-side. A
// signed-out visitor sends no header and the chat behaves exactly as before.
const SUPPORT_FN = "https://lbzkyyehmgudlxmfpzzh.supabase.co/functions/v1/support-agent";
const SUPPORT_GREETING = "Hey — I'm the Ledger AI support agent. Ask me anything about how the product works, or tell me what's going wrong and I'll help or get you to a human.";

function supportChatSheet() {
  const history = []; // {role, content} pairs already answered — sent back each turn
  let sending = false;
  let lastFailed = null;

  sheet(`<h2>Support &amp; account help</h2>
    <p class="sh-sub">Ask anything about Ledger AI — instant answers, and it can open a ticket for you.</p>
    <div class="supchat-log" id="scLog"></div>
    <div class="typing" id="scTyping" style="display:none">Ledger Support is typing…</div>
    <div class="supchat-row">
      <textarea id="scInput" rows="1" placeholder="Type a message…" maxlength="4000"></textarea>
      <button class="supchat-send" id="scSend" aria-label="Send">&#8593;</button>
    </div>
    <p class="note" style="margin-top:9px;text-align:center">${S.email ? "Signed in — I can check your subscription, connections, and AI allowance." : "Public support chat · no account data visible here"} · <a href="mailto:supportteam@heyledger.ai">email a human</a></p>`,
  (root) => {
    const log = root.querySelector("#scLog");
    const typingEl = root.querySelector("#scTyping");
    const input = root.querySelector("#scInput");
    const sendBtn = root.querySelector("#scSend");

    const addBubble = (cls, html) => {
      const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html;
      log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
    };
    const renderTicket = (t) => `<div class="supchat-ticket"><b>Ticket ${esc(t.ticket_id)} opened</b><br>A human will follow up at ${esc(t.email)} — usually within 1 business day.</div>`;
    const renderError = (msg) => `${esc(msg)} <button class="btn ghost" style="padding:3px 10px;font-size:12px;margin-left:6px" data-scretry>Try again</button>`;

    addBubble("ai", esc(SUPPORT_GREETING));

    async function sendMessage(text) {
      if (sending) return;
      const trimmed = text.trim().slice(0, 4000);
      if (!trimmed) return;
      sending = true; lastFailed = null;
      addBubble("me", esc(trimmed));
      input.value = ""; input.style.height = "auto";
      sendBtn.disabled = true; typingEl.style.display = "block"; log.scrollTop = log.scrollHeight;

      // Prefill: a hidden context turn ahead of the real transcript so the agent
      // already has the signed-in email if it needs one for create_ticket, and
      // never has to ask. Only sent when S.email is set (signed in); the chat
      // works identically, minus the prefill, for a signed-out visitor.
      const payload = [];
      if (S.email) {
        payload.push({ role: "user", content: `[Silent context, do not reply to this line — just remember it: the signed-in visitor's account email is ${S.email}. If you open a support ticket, use this email automatically instead of asking for one.]` });
        payload.push({ role: "assistant", content: "Understood." });
      }
      payload.push(...history, { role: "user", content: trimmed });

      try {
        const headers = { "content-type": "application/json" };
        const t = await token().catch(() => null);
        if (t) headers.Authorization = "Bearer " + t;
        const r = await fetch(SUPPORT_FN, { method: "POST", headers, body: JSON.stringify({ messages: payload }) });
        const d = await r.json().catch(() => ({}));
        typingEl.style.display = "none";
        if (!r.ok || d?.error) {
          addBubble("ai err", renderError(d?.message || "Something went wrong reaching support just now."));
          lastFailed = trimmed;
        } else {
          history.push({ role: "user", content: trimmed }, { role: "assistant", content: d.reply });
          let html = esc(d.reply).replace(/\n/g, "<br>");
          if (d.ticket) html += renderTicket(d.ticket);
          addBubble("ai", html);
        }
      } catch {
        typingEl.style.display = "none";
        addBubble("ai err", renderError("Couldn't reach support — check your connection."));
        lastFailed = trimmed;
      }
      sending = false; sendBtn.disabled = false;
    }

    log.addEventListener("click", (e) => {
      if (e.target.closest("[data-scretry]") && lastFailed) { const t = lastFailed; lastFailed = null; sendMessage(t); }
    });
    sendBtn.onclick = () => sendMessage(input.value);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input.value); } });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 100) + "px"; });
    setTimeout(() => input.focus(), 60);
  });
}

/* ---------------- AUTH / SETUP / JOIN ---------------- */
/* ---------------- Hard lock (2026-09-05) ----------------
   Same verdict as the server's entitlement module: trial over with no card,
   or any status other than active / past_due / trialing = locked. Nothing
   in the app opens; the only doors are pay, export, delete, sign out. */
// One wording for both delete buttons. Teammates keep their logins and simply
// lose access; an App Store subscription is Apple's to cancel, not ours.
const DELETE_ACCOUNT_WARNING = "Delete your account? This permanently deletes your account and cannot be undone — receipts, conversations and connections go with it. If you're the workspace owner, this also deletes the workspace and removes every teammate's access (their logins are kept). Want a copy first? Download your Books archive before deleting. A subscription bought on our website is cancelled with the account; one bought through the App Store must be cancelled in your iPhone's Settings → Subscriptions.";
function accessLocked(row) {
  const status = String(row?.subscription_status ?? "trialing");
  if (status === "active" || status === "past_due") return false;
  if (status === "trialing") return Boolean(row?.trial_ends_at) && new Date(row.trial_ends_at).getTime() <= Date.now();
  return true;
}
// Account deletion asks twice, in the page (audit 11.3): the warning, then the
// word DELETE. Resolves the typed text, or null when the owner backs out.
async function confirmAccountDeletion(ownerNote) {
  const ok = await askConfirm("This permanently deletes your account and cannot be undone — receipts, conversations and connections go with it. " + ownerNote, { title: "Delete your account?", ok: "Continue", danger: true });
  if (!ok) return null;
  return askPrompt("Type DELETE to confirm.", { title: "Delete your account?", ok: "Delete account", placeholder: "DELETE" });
}

// The lock screen keeps asking billing until the webhook unlocks the workspace.
// It used to ask every 6 s forever, hidden tab included (audit 11.9): now it
// pauses while the tab is hidden, checks again the moment it is shown (that is
// the Back-from-Stripe moment), and slows down the longer nothing changes.
let lockPoll = null;
function lockPollStop() {
  if (!lockPoll) return;
  clearTimeout(lockPoll.timer);
  document.removeEventListener("visibilitychange", lockPoll.onVisible);
  lockPoll = null;
}
function lockView(seed) {
  lockPollStop();
  closeSheet?.();
  const s = seed || {};
  const status = String(s.subscription_status ?? "trialing");
  const expiredTrial = status === "trialing" || s.access_reason === "trial_expired";
  const name = s.name || S.profile?.business?.name || "";
  const headline = expiredTrial ? "Your free trial has ended" : "Your subscription has ended";
  const body = expiredTrial
    ? "Subscribe to keep using Ledger. Everything you created is saved and waiting for you."
    : "Resume your subscription to keep using Ledger. Your records are saved and waiting for you.";
  root.innerHTML = `<div class="login"><div class="mark"><img src="assets/logo-mark-96.png" alt=""></div>
    <h2>${esc(headline)}</h2>
    ${name ? `<p class="note" style="margin-top:-6px">${esc(name)}</p>` : ""}
    <p>${esc(body)}</p>
    ${inAndroidApp() ? `<p class="note">${SUBSCRIPTION_REQUIRED}</p>`
      : `<button class="btn" id="lk-pay">${expiredTrial ? "Subscribe now" : "Resume subscription"}</button>`}
    <p class="note" style="margin-top:10px">Cancel any time · your records stay exactly as you left them</p>
    <p style="margin-top:22px;font-size:13px;line-height:2"><a href="#" id="lk-export" style="color:var(--cyan)">Download complete Books archive</a> &middot; <a href="#" id="lk-delete" style="color:var(--dim)">Delete my account</a> &middot; <a href="#" id="lk-out" style="color:var(--dim)">Sign out</a></p>
    <p style="margin-top:12px;font-size:12.5px"><a href="privacy.html" style="color:var(--dim)">Privacy</a> &middot; <a href="terms.html" style="color:var(--dim)">Terms</a> &middot; <a href="support.html" style="color:var(--dim)">Support</a></p></div>`;
  const lkPay = $("lk-pay");
  if (lkPay) lkPay.onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      // A shop that already has a Stripe customer resumes in the portal; a
      // trial that never added a card goes to checkout.
      const st = await api("/stripe-billing/status", {}).catch(() => ({}));
      const c = expiredTrial || !st.portal_available ? await startCheckout() : await api("/stripe-billing/portal", {});
      location.href = c.url;
    } catch (err) { if (!err.cancelled) toast(friendlyError(err, "Couldn't open billing. Nothing was charged — try again."), "err"); btn.disabled = false; }
  };
  $("lk-export").onclick = async (e) => {
    e.preventDefault();
    try {
      // The pre-delete copy: records plus time-limited links to every receipt photo.
      const ex = await api("/books", { action: "archive", include_receipt_links: true });
      downloadBooksExport(ex);
      toast("Export downloaded");
    } catch (err) { toast(friendlyError(err, "Couldn't archive your books. Try again."), "err"); }
  };
  // One request at a time: a double tap must not send two deletions.
  let lkDeleting = false;
  $("lk-delete").onclick = async (e) => {
    e.preventDefault();
    if (lkDeleting) return;
    const typed = await confirmAccountDeletion(DELETE_ACCOUNT_WARNING);
    if (typed !== "DELETE") { if (typed !== null) toast("Account not deleted — you didn't type DELETE.", "err"); return; }
    lkDeleting = true;
    try {
      const done = await api("/workspace-profile", { action: "delete-account", confirm: "DELETE" });
      if (done?.notice) alert(done.notice);
      await supa.auth.signOut(); location.reload();
    }
    catch (err) { toast(friendlyError(err, "Couldn't delete your account. Nothing was deleted — try again."), "err"); }
    finally { lkDeleting = false; }
  };
  $("lk-out").onclick = (e) => { e.preventDefault(); supa.auth.signOut().then(() => location.reload()); };
  // Payment lands by webhook a few seconds after Stripe sends them back here:
  // keep asking, and open the app the moment the workspace is unlocked.
  const poll = { attempts: 0, timer: null, inFlight: false, onVisible: null };
  const delayFor = (n) => n < 10 ? 6000 : n < 20 ? 30000 : 120000;
  const check = async () => {
    poll.timer = null;
    if (document.hidden || poll.inFlight) return;   // resumes on visibilitychange
    poll.attempts++; poll.inFlight = true;
    try { const st = await api("/stripe-billing/status", {}); if (st.access && st.access !== "locked") { lockPollStop(); location.reload(); return; } } catch {}
    poll.inFlight = false;
    if (lockPoll !== poll || poll.timer) return;
    poll.timer = setTimeout(check, delayFor(poll.attempts));
  };
  poll.onVisible = () => {
    if (document.hidden || lockPoll !== poll || poll.timer || poll.inFlight) return;
    poll.attempts = 0;                    // just came back: ask right away, then at the fast cadence again
    void check();
  };
  document.addEventListener("visibilitychange", poll.onVisible);
  lockPoll = poll;
  poll.timer = setTimeout(check, 6000);
}

// One sign-in everywhere (2026-09-05, #7): email + password on the web, the
// same account the iPhone app uses. The magic-link screen is gone — Kyle:
// "it makes me put my email in and then sends a link, which is silly". Three
// modes share one card: signin · signup · forgot. Password resets always land
// on this page (?reset=1) so a phone user sets the new password here, then
// signs in on the phone — one path, no deep-link gymnastics.
const AUTH_LEGAL = `<p style="margin-top:18px;font-size:12.5px"><a href="privacy.html" style="color:var(--dim)">Privacy</a> &middot; <a href="terms.html" style="color:var(--dim)">Terms</a> &middot; <a href="support.html" style="color:var(--dim)">Support</a></p>`;
const APP_URL = location.origin + location.pathname;
function authCard(title, lead, fields, button, links) {
  const signup=button==="Create account", signin=button==="Sign in" && fields.includes('id="pw"');
  const regular=signup||signin;
  const selection=pendingOffer();
  if(signin){title="Welcome back.";lead="Your business, all in one place.";}
  if(signup){title="Start with Ledger.";lead=selection?"Your offer. Your own business.":"Meet the AI copilot for your business.";}
  root.innerHTML = `<main class="welcome-layout"><aside class="welcome-story"><div class="welcome-brand"><img src="assets/logo-mark-96.png" alt="">Ledger AI</div><div><div class="welcome-rail">Intelligence. Accuracy. Control.</div><h1>Your business.<br><span>One command<br>centre.</span></h1><p>Your books, customers and day-to-day — together with one AI assistant.</p><div class="welcome-feature">Books. Customers. Your day.<small>The details, all in one place.</small></div><div class="welcome-feature green">Your business, on speaking terms.<small>Meet your AI business copilot.</small></div></div><small>INTELLIGENCE. ACCURACY. CONTROL.</small></aside>
    <section class="welcome-form"><div class="welcome-brand mobile"><img src="assets/logo-mark-96.png" alt="">Ledger AI</div><div class="welcome-rail">Ledger OS // Welcome</div><h2>${title}</h2><p class="welcome-lead">${lead}</p>
    ${regular?`<div class="welcome-tabs" aria-label="Account options"><button id="welcome-signin" aria-pressed="${signin}">Sign in</button><button id="welcome-signup" aria-pressed="${signup}">Create account</button></div>`:""}
    ${selection && regular?'<div class="welcome-selected">Offer saved · verified after sign-in <button id="welcome-remove" type="button">Remove</button></div>':''}
    <div class="welcome-glass">${fields}${button ? `<button class="btn welcome-primary" id="go">${button}</button>` : ""}
    <div class="welcome-links">${links}</div>${signup?`<p class="welcome-small">${selection?'Your code will be checked securely before any benefit is applied.':'14 days free. No card needed.'}</p>`:''}</div>
    ${regular?'<button class="welcome-offer" id="welcome-offer"><span>✧</span><span><b>Have an offer or invitation code?</b><small>Apply a promo or test-client invitation.</small></span><span>→</span></button>':''}
    <div class="welcome-legal">${AUTH_LEGAL}</div></section></main>`;
  root.querySelectorAll('input').forEach(i=>{
    if(!['email','pw','pw2'].includes(i.id))return;
    const label=document.createElement('label');label.htmlFor=i.id;label.className='welcome-label';label.textContent=i.id==='email'?'Email address':i.id==='pw2'?'Confirm password':'Password';i.before(label);
    if(i.type==='password') { const wrap=document.createElement('div');wrap.className='welcome-password';i.before(wrap);wrap.append(i);const show=document.createElement('button');show.type='button';show.textContent='Show';show.setAttribute('aria-label','Show password');show.onclick=()=>{const yes=i.type==='password';i.type=yes?'text':'password';show.textContent=yes?'Hide':'Show';show.setAttribute('aria-label',yes?'Hide password':'Show password');};wrap.append(show); }
  });
  if(regular){$('welcome-signin').onclick=()=>loginView('signin',emailOf());$('welcome-signup').onclick=()=>loginView('signup',emailOf());$('welcome-offer').onclick=()=>offerEntryView(signup?'signup':'signin',emailOf());}
  if($('welcome-remove'))$('welcome-remove').onclick=()=>{clearOffer();if(S.email){boot();}else{loginView(signup?'signup':'signin',emailOf());}};
  const go = $("go");
  root.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",e=>{if(e.key==="Enter"&&go){e.preventDefault();go.click();}}));
  return go;
}
function offerEntryView(mode='signin',email='') {
  authCard('Your invitation.','A special offer for your next chapter.',`<label class="welcome-label" for="offer-kind">Code type</label><select id="offer-kind"><option value="invitation">Ledger test-client invitation</option><option value="promotion">Web subscription promo</option></select><label class="welcome-label" for="offer-code">Offer or invitation code</label><input id="offer-code" maxlength="80" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Enter your code"><p class="welcome-small" id="offer-help">Sign in with your invited email to check the private terms. No access is granted just by entering a code.</p>`,'Continue with code','<a href="#" id="offer-back">Back to sign in</a>');
  // Code fields have their own meaningful label, not an authentication label.
  root.querySelector('label.welcome-label[for="offer-code"] + label')?.remove();
  $('offer-kind').onchange=()=>{$('offer-help').textContent=$('offer-kind').value==='promotion'?'Stripe checks subscription promotions at secure checkout. Review the amount, offer duration and renewal terms before paying.':'Sign in with your invited email to check the private terms. No access is granted just by entering a code.';};
  $('offer-back').onclick=e=>{e.preventDefault();loginView(mode,email);};
  $('go').onclick=()=>{try{if(inAndroidApp()&&$('offer-kind').value==='promotion')throw Error(SUBSCRIPTION_REQUIRED);saveOffer($('offer-kind').value,$('offer-code').value);if(S.email){boot();}else{loginView(mode,email);}}catch(e){toast(friendlyError(e, "Couldn't apply that offer. Try again."),'err');}};
}
async function offerReviewView(selection,bootstrap) {
  const promotion=selection.kind==='promotion';
  authCard(promotion?'Your subscription offer.':'Your invitation.',promotion?'Choose your plan, then review the confirmed offer in secure checkout.':'Checking your private invitation…','','','');
  let offer;
  try {
    offer=promotion?{needs_setup:bootstrap.needs_setup}:await api('/login-offers',{action:'check',code:selection.code});
    if(pendingOffer()?.code!==selection.code)return;
    if(offer.redeemed){clearOffer();await boot();return;}
  }catch(e){authCard('Invitation not applied.',esc(e.message),'','','<button class="btn ghost" id="offer-retry">Retry</button><button class="btn ghost" id="offer-edit">Change code</button><button class="btn ghost" id="offer-skip">Continue without offer</button>');$('offer-retry').onclick=()=>offerReviewView(selection,bootstrap);$('offer-edit').onclick=()=>{clearOffer();offerEntryView();};$('offer-skip').onclick=()=>{clearOffer();boot();};return;}
  if(promotion && bootstrap.needs_setup){setupView();return;}
  const fields=promotion?'<p class="welcome-small">No payment has been made. Stripe will validate this code for your plan, currency and account and show the final total and renewal terms. Existing subscriptions will not be replaced.</p>':`<div class="welcome-ticket"><div class="welcome-rail">Complimentary test access</div><h3>Ledger Solo</h3><strong>$0</strong><p>while you’re our test client</p><ul><li>One owner. Your own business.</li><li>Solo features · $60 USD AI / $10 USD texting monthly</li><li>No card required or automatic subscription charge</li></ul><small>Payment-processing fees are separate.</small></div>${offer.needs_setup?'<label class="welcome-label" for="offer-name">Business name</label><input id="offer-name" maxlength="160" autocomplete="organization"><label class="welcome-label" for="offer-currency">Currency</label><select id="offer-currency"><option>CAD</option><option>USD</option></select>':''}`;
  authCard(promotion?'Review your offer.':'Your next chapter.',promotion?'The payment provider confirms your price.':'Your invitation has been verified for this account.',fields,promotion?'Choose plan and review checkout':'Activate free Solo access','<button type="button" class="welcome-text" id="offer-skip">Continue without offer</button>');
  $('offer-skip').onclick=()=>{clearOffer();boot();};
  $('go').onclick=async()=>{
    const go=$('go');go.disabled=true;
    try {
      if(promotion){const checkout=await startCheckout(null,selection.code);clearOffer();location.assign(checkout.url);return;}
      const name=$('offer-name')?.value.trim()||'';if(offer.needs_setup&&name.length<2)throw Error('Enter your business name.');
      const result=await api('/login-offers',{action:'redeem',code:selection.code,name,currency:$('offer-currency')?.value||'CAD',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'});
      if(!result.redeemed)throw Error('Access was not confirmed. Retry to check the same invitation.');
      clearOffer();toast('Complimentary Solo access is active. No subscription payment is required.');await boot();
    }catch(e){go.disabled=false;if(!e.cancelled)toast(friendlyError(e, "Couldn't redeem that code. Try again."),'err');}
  };
}
// A Google callback is accepted only after this tab started a short-lived,
// PKCE-bound flow. Supabase validates the saved verifier during code exchange.
function googleSignInButton() {
  const button=document.createElement("button");button.className="btn";button.type="button";button.id="google-signin";button.textContent="Continue with Google";
  button.style.cssText="background:#fff;color:#1f1f1f;border:1px solid #747775;margin-bottom:12px";
  const divider=document.createElement("p");divider.textContent="or use email";divider.className="note";
  const first=root.querySelector(".welcome-glass .welcome-label")||root.querySelector("input");first.before(button,divider);
  button.onclick=async()=>{
    button.disabled=true;
    try {
      sessionStorage.setItem("ledger.oauth.pending",JSON.stringify({provider:"google",started:Date.now()}));
      const {data,error}=await supa.auth.signInWithOAuth({provider:"google",options:{redirectTo:APP_URL,scopes:"openid email profile",queryParams:{prompt:"select_account"},skipBrowserRedirect:true}});
      if(error)throw error;const dest=new URL(data.url);
      if(dest.origin!==SUPA_URL||dest.pathname!=="/auth/v1/authorize"||dest.searchParams.get("code_challenge_method")!=="s256")throw Error("Secure Google sign-in could not start. Please retry.");
      location.assign(dest.href);
    } catch(error){sessionStorage.removeItem("ledger.oauth.pending");button.disabled=false;toast(authErr(error),"err");}
  };
}
async function finishGoogleReturn() {
  const q=new URLSearchParams(location.search);
  if(!q.has("code")&&!q.has("error"))return;
  const raw=sessionStorage.getItem("ledger.oauth.pending");sessionStorage.removeItem("ledger.oauth.pending");
  const code=q.get("code");history.replaceState({},"",location.pathname);
  const pending=JSON.parse(raw||"null");
  if(!pending||pending.provider!=="google"||Date.now()-pending.started>600000||Date.now()<pending.started||q.getAll("code").length!==1||!code)throw Error("This sign-in link expired or was not started here. Please sign in again.");
  const {error}=await supa.auth.exchangeCodeForSession(code);if(error)throw Error("Google sign-in could not be verified. Please start again.");
}
const authErr = (error) => {
  const m = String(error?.message || "");
  if (/invalid login credentials/i.test(m)) return "Wrong email or password. Try again, or tap Forgot password.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first — the link is in your inbox (check Spam).";
  if (/already registered|already been registered/i.test(m)) return "That email already has an account — sign in instead.";
  if (/rate limit|too many/i.test(m)) return "Too many tries — give it a minute and try again.";
  // GoTrue refuses password/email changes on an AAL1 session once a verified
  // factor exists (audit 01.1). Say what to do instead of echoing "AAL2".
  if (error?.code === "insufficient_aal" || /aal2/i.test(m)) return "Enter your authenticator code first, then save the new password — tap Save again to get the prompt.";
  return m || "Something went wrong — try again.";
};
const emailOf = () => ($("email")?.value || "").trim().toLowerCase();
const pwField = (id, ph, ct) => `<input id="${id}" type="password" placeholder="${ph}" autocomplete="${ct}" minlength="8">`;

function loginView(mode = "signin", email = "") {
  WAKE.ready = false; wakeSync();
  if (mode === "signup") {
    const go = authCard("Create your account", "14-day free trial · no card needed · cancel any time.",
      `<input id="email" type="email" placeholder="you@business.com" autocomplete="email" value="${esc(email)}">${pwField("pw", "Choose a password (8+ characters)", "new-password")}`,
      "Create account", `Already have an account? <a href="#" id="tosignin" style="color:var(--cyan)">Sign in</a>`);
    googleSignInButton();
    $("tosignin").onclick = (e) => { e.preventDefault(); loginView("signin", emailOf()); };
    go.onclick = async () => {
      const em = emailOf(), pw = $("pw").value;
      if (!em.includes("@")) { toast("Enter your work email", "err"); return; }
      if (pw.length < 8) { toast("Use at least 8 characters", "err"); return; }
      go.disabled = true;
      const { data, error } = await supa.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: APP_URL } });
      if (error) { go.disabled = false; toast(authErr(error), "err"); return; }
      // Supabase hides "already registered" behind an empty identities list.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) { go.disabled = false; toast(authErr({ message: "already registered" }), "err"); return; }
      if (data?.session) return; // autoconfirm on → onAuthStateChange boots the app
      loginView("sent-confirm", em);
    };
    return;
  }
  if (mode === "forgot") {
    const go = authCard("Reset your password", "Enter your email and we'll send a link to choose a new password. Works for the iPhone app too.",
      `<input id="email" type="email" placeholder="you@business.com" autocomplete="email" value="${esc(email)}">`,
      "Send reset link", `<a href="#" id="tosignin" style="color:var(--cyan)">Back to sign in</a>`);
    $("tosignin").onclick = (e) => { e.preventDefault(); loginView("signin", emailOf()); };
    go.onclick = async () => {
      const em = emailOf(); if (!em.includes("@")) { toast("Enter your email", "err"); return; }
      go.disabled = true;
      const { error } = await supa.auth.resetPasswordForEmail(em, { redirectTo: APP_URL + "?reset=1" });
      if (error) { go.disabled = false; toast(authErr(error), "err"); return; }
      loginView("sent-reset", em);
    };
    return;
  }
  if (mode === "sent-confirm" || mode === "sent-reset") {
    const reset = mode === "sent-reset";
    authCard(reset ? "Check your email" : "Confirm your email",
      reset ? `We sent a link to <b>${esc(email)}</b>. Tap it to choose a new password — then sign in here or on your phone.`
            : `We sent a confirmation link to <b>${esc(email)}</b>. Tap it once and you're in.`,
      "", "", `Not there in a minute? Check Spam or Updates. <a href="#" id="again" style="color:var(--cyan)">Send it again</a> · <a href="#" id="tosignin" style="color:var(--cyan)">Back to sign in</a>`);
    $("tosignin").onclick = (e) => { e.preventDefault(); loginView("signin", email); };
    $("again").onclick = async (e) => {
      e.preventDefault();
      const { error } = reset
        ? await supa.auth.resetPasswordForEmail(email, { redirectTo: APP_URL + "?reset=1" })
        : await supa.auth.resend({ type: "signup", email, options: { emailRedirectTo: APP_URL } });
      toast(error ? authErr(error) : "Sent again — give it a minute.", error ? "err" : undefined);
    };
    return;
  }
  // signin
  const go = authCard("Ledger AI", "Your business copilot. Same account on the web and the iPhone app.",
    `<input id="email" type="email" placeholder="you@business.com" autocomplete="email" value="${esc(email)}">${pwField("pw", "Password", "current-password")}`,
    "Sign in", `<a href="#" id="forgot" style="color:var(--cyan)">Forgot password?</a><br>New here? <a href="#" id="tosignup" style="color:var(--cyan)">Start your free trial</a>`);
  googleSignInButton();
  $("forgot").onclick = (e) => { e.preventDefault(); loginView("forgot", emailOf()); };
  $("tosignup").onclick = (e) => { e.preventDefault(); loginView("signup", emailOf()); };
  go.onclick = async () => {
    const em = emailOf(), pw = $("pw").value;
    if (!em.includes("@") || !pw) { toast("Enter your email and password", "err"); return; }
    go.disabled = true;
    const { error } = await supa.auth.signInWithPassword({ email: em, password: pw });
    if (error && /email not confirmed/i.test(error.message)) {
      // Right password, unconfirmed account: send a fresh confirmation and say so.
      await supa.auth.resend({ type: "signup", email: em, options: { emailRedirectTo: APP_URL } }).catch(() => {});
      loginView("sent-confirm", em); return;
    }
    if (error) { go.disabled = false; toast(authErr(error), "err"); }
    // success → onAuthStateChange(SIGNED_IN) boots the app
  };
}

// Landing from a reset email: the session is already established by the link;
// all that's left is choosing the password.
function newPasswordView(tokenHash = null) {
  const go = authCard("Choose a new password", "Then sign in with it here or on your phone.",
    `${pwField("pw", "New password (8+ characters)", "new-password")}${pwField("pw2", "Repeat new password", "new-password")}`,
    "Save password", "");
  go.onclick = async () => {
    const pw = $("pw").value;
    if (pw.length < 8) { toast("Use at least 8 characters", "err"); return; }
    if (pw !== $("pw2").value) { toast("Passwords don't match", "err"); return; }
    go.disabled = true;
    const savePassword = async () => {
      try {
        const { error } = await supa.auth.updateUser({ password: pw });
        if (error) throw error;
        history.replaceState({}, "", location.pathname);
        toast("Password saved — you're signed in");
        boot();
      } catch (error) { go.disabled = false; toast(authErr(error), "err"); }
    };
    try {
      if (tokenHash) {
        const { error: verr } = await supa.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (verr) { history.replaceState({}, "", location.pathname); loginView("forgot"); toast("That reset link has expired — send a fresh one.", "err"); return; }
        // The link is single-use. Retries use its established session, never consume it twice.
        tokenHash = null;
        history.replaceState({}, "", location.pathname + "?reset=1");
      }
      if (await needsMfa(supa)) {
        await openSecurity(supa, {required:true,onVerified:()=>void savePassword()});
      } else await savePassword();
    } catch (error) { go.disabled = false; toast(authErr(error), "err"); }
  };
}

function setupView() {
  root.innerHTML = `<div class="login"><div class="mark"><img src="assets/logo-mark-96.png" alt=""></div><h2>Welcome to Ledger AI</h2>
    <p>Let's set up your business. Your 14-day free trial starts now — no card needed until you decide to keep Ledger.</p>
    <input id="bizname" placeholder="Business name" maxlength="160" autocomplete="organization">
    <select id="bizcur" style="margin-bottom:11px">
      <option value="CAD">🇨🇦 Canadian dollars (CAD)</option><option value="USD">🇺🇸 US dollars (USD)</option></select>
    <button class="btn" id="bizgo">Start my free trial →</button></div>`;
  $("bizgo").onclick = async () => {
    const name = $("bizname").value.trim();
    if (name.length < 2) { toast("Enter your business name", "err"); return; }
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Edmonton";
      const created = await api("/workspace-profile", { action: "bootstrap", name, currency: $("bizcur").value, timezone: tz });
      S.currency = $("bizcur").value;
      await loadProfile(created);
      if(pendingOffer()){await boot();return;}
      onboardInterview(name);
    } catch (e) { toast(friendlyError(e, "Couldn't finish setting up your workspace. Try again."), "err"); }
  };
}

// First-run setup (universal, 2026-09-13, Kyle 1202). One screen — the same
// "Your business" sheet Settings opens later — instead of two layers that never
// talked to each other (four free-text questions that became memory facts, then
// a six-tap step on Home). Hours typed here reach the real hours setting,
// services become the price list, and the copilot and Front Desk read all of
// it. Pinned in localStorage until finished or skipped, so closing the tab on
// this screen brings the owner straight back to it (sim bug 16).
const OB_KEY = "ledger.onboard.pending";
function onboardPending() { try { return JSON.parse(accountStorage.getItem(OB_KEY) || "null"); } catch { return null; } }
function onboardInterview(bizName) {
  try { accountStorage.setItem(OB_KEY, JSON.stringify({ bizName, email: S.email || "" })); } catch {}
  appView();
  shopProfileSheet((saved) => {
    try { accountStorage.removeItem(OB_KEY); } catch {}
    S.cal = null; setTab("home");
    openChat();
    sys("🎉 " + bizName + " is set up — your 14-day free trial is live." +
      " Review your setup checklist before the first real job.");
    firstWorkingDaySheet();
  }, { firstRun: true, bizName });
}

function joinView(businessName) {
  root.innerHTML = `<div class="login"><div class="mark"><img src="assets/logo-mark-96.png" alt=""></div><h2>You're invited ✨</h2>
    <p><b>${esc(businessName)}</b> invited you to their Ledger AI team. Enter the 6-digit join code the owner gave you.</p>
    <input id="joincode" placeholder="6-digit code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="text-align:center;letter-spacing:8px;font-size:22px;font-weight:800">
    <button class="btn" id="joingo">Join the team →</button>
    <p style="font-size:12px;color:var(--dim)">No code? Ask the owner — it's on their Team screen in the app.</p></div>`;
  $("joingo").onclick = async () => {
    const code = $("joincode").value.replace(/\D/g, "");
    if (code.length !== 6) { toast("The join code is 6 digits", "err"); return; }
    try {
      const r = await api("/team", { action: "accept", code });
      await loadProfile(await api("/workspace-profile", { action: "bootstrap" }));
      appView(); openChat();
      sys("🎉 Welcome aboard — you're now part of " + (r.businessName || businessName) + ". Ask me anything about the business.");
    } catch (e) { toast(friendlyError(e, "Couldn't join that workspace. Try again."), "err"); }
  };
}

/* ---------------- BOOT ---------------- */
// bootstrap answers "does this user have a workspace"; `get` carries the business detail.
// currency_code isn't on either payload, so it comes from the workspaces row (RLS: members read).
async function loadProfile(boot) {
  const expected = accountBoundary.identity;
  const { data: { session } } = await supa.auth.getSession();
  accountBoundary.assertCurrent(expected);
  if (!accountBoundary.bindWorkspace(session, boot.workspace_id)) throw new Error("Business verification is unavailable. Please retry.");
  const profile = { ...boot, business: { name: boot.name || "", address: "", logo_url: null } };
  // Business profile rides on bootstrap. A payload without it (older function)
  // is treated as a completed generic business — never a nag, never automotive.
  S.shop = boot.shop_profile || { completed: true };
  try {
    const detail = await api("/workspace-profile", { action: "get" });
    profile.business = { ...profile.business, ...detail };
    if (detail.shop_profile) S.shop = detail.shop_profile;
  } catch {}
  try {
    const { data } = await supa.from("workspaces").select("currency_code").eq("id", boot.workspace_id).maybeSingle();
    if (data?.currency_code) S.currency = data.currency_code;
  } catch {}
  accountBoundary.assertCurrent(expected);
  S.profile = profile;
  return profile;
}

async function boot() {
  const { data: { session } } = await supa.auth.getSession();
  if (!accountBoundary.accept(session)) return;
  const expected = accountBoundary.identity;
  const qs = new URLSearchParams(location.search);
  // Reset emails carry a one-time token_hash that is only spent when the
  // customer taps Save — so inbox link-scanners that pre-open links (Gmail
  // did this to a test reset tonight) can't burn it before they get there.
  if (qs.get("reset") && qs.get("token_hash")) { newPasswordView(qs.get("token_hash")); return; }
  if (!session) {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (qs.get("reset")) { history.replaceState({}, "", location.pathname); loginView("forgot"); toast("That reset link has expired — send a fresh one.", "err"); return; }
    // A confirmation link that was already opened (by the customer or a
    // scanner) has done its job — the account is confirmed. Just sign in.
    if (hash.get("error_code")) { history.replaceState({}, "", location.pathname); loginView("signin"); toast(/expired|invalid/i.test(hash.get("error_code")) ? "That link was already used — just sign in with your password." : hash.get("error_description") || "That link didn't work — sign in below.", "err"); return; }
    // The website's free-trial buttons land here as ?signup=1 (2026-09-13):
    // a new visitor gets the Create-account card straight away instead of
    // the sign-in card with a "New here?" link under it. Someone already
    // signed in just goes on into the app. The param stays in the URL on
    // purpose: the build-freshen check and a worker update both reload the
    // page, and the visitor must land on this same card, not on Sign in.
    if (qs.get("signup")) { loginView("signup"); return; }
    loginView("signin"); return;
  }
  try {
    const mfaNeeded = await needsMfa(supa);
    accountBoundary.assertCurrent(expected);
    if (mfaNeeded) {
      root.innerHTML = '<div class="panel"><h2>Secure your account</h2><p>Two-step verification is required before you can use Ledger. Add an authenticator or enter its code to continue.</p><button class="btn primary" id="mfa-signin">Continue securely</button><button class="btn ghost" id="mfa-signout">Sign out</button></div>';
      const verify=()=>openSecurity(supa,{required:true,onVerified:()=>void boot()});
      $("mfa-signin").onclick=verify;$("mfa-signout").onclick=()=>supa.auth.signOut().then(()=>location.reload());await verify();return;
    }
  } catch {
    if (accountBoundary.stopped) return;
    root.innerHTML='<div class="panel"><h2>Security check unavailable</h2><p>Your business stays locked until we can verify your sign-in.</p><button class="btn primary" id="mfa-retry">Retry</button><button class="btn ghost" id="mfa-signout">Sign out</button></div>';
    $("mfa-retry").onclick=()=>void boot();$("mfa-signout").onclick=()=>supa.auth.signOut().then(()=>location.reload());return;
  }
  // The website's pricing cards say which plan was clicked (?plan=solo|pro,
  // 2026-09-17). Remembered for this tab so checkout can honour it — and can
  // say so plainly if that plan cannot be sold right now (launch audit 16-06).
  const planParam = String(qs.get("plan") || "").toLowerCase();
  if (planParam === "solo" || planParam === "pro") { try { sessionStorage.setItem("ledger.planHint", planParam); } catch {} }
  try { S.planHint = sessionStorage.getItem("ledger.planHint") || null; } catch {}
  if (qs.get("signup") || qs.get("plan")) history.replaceState({}, "", location.pathname);
  if (qs.get("reset")) { newPasswordView(); return; }
  S.email = (session.user?.email || "").toLowerCase();
  try {
    const b = await api("/workspace-profile", { action: "bootstrap" });
    const offer=bindOffer(session.user.id);
    if(offer && !b.invite_pending){await offerReviewView(offer,b);return;}
    if (b.invite_pending) { joinView(b.invited_business || "A business"); return; }
    if (b.needs_setup) { setupView(); return; }
    // Hard lock (2026-09-05): a lapsed subscription never sees the app shell.
    if (accessLocked(b)) { lockView({ name: b.name, subscription_status: b.subscription_status, trial_ends_at: b.trial_ends_at }); return; }
    if (!accountBoundary.bindWorkspace(session, b.workspace_id)) throw new Error("Business verification is unavailable. Please retry.");
    S.conversationId = accountStorage.getItem("ledger.conv");
    // Know what is connected before the first screen paints, so a built-in
    // books shop never fires QuickBooks/Google requests it can't answer.
    await Promise.all([loadProfile(b), connectionStates(), loadVoiceState()]);
    accountBoundary.assertCurrent(expected);
    // An interview that was open when the app closed comes straight back.
    const ob = onboardPending();
    if (ob && (!ob.email || ob.email === S.email)) { onboardInterview(ob.bizName || b.name || "", ob); return; }
    appView();
  } catch {
    if (accountBoundary.stopped) return;
    bootErrorView();
    return;
  }
  // app.html#vin opens the scanner straight away (Home Screen shortcut / QR on the shop wall).
  if (location.hash === "#vin") { history.replaceState(null, "", location.pathname); vinScannerSheet(); }
}
// The boot catch-all used to offer Retry and nothing else (audit 11.9): a
// sign-in that can no longer load ("Signed out", a revoked session) had no way
// out, and an offline message never changed when the connection came back.
function bootErrorView() {
  const offline = navigator.onLine === false;
  root.innerHTML = `<div class="panel"><h2>Unable to load your business</h2>
    <p>${offline ? "You're offline. Ledger will try again as soon as your connection is back." : "Check your connection and try again."}</p>
    <button class="btn primary" id="business-retry">Retry</button> <button class="btn ghost" id="business-signout">Sign out</button></div>`;
  $("business-retry").onclick = () => void boot();
  $("business-signout").onclick = () => supa.auth.signOut().then(() => location.reload());
}
window.addEventListener("online", () => { if ($("business-retry")) void boot(); });
window.addEventListener("offline", () => { if ($("business-retry")) bootErrorView(); });
/* ---------------- Client Hub sharing (web parity 2026-09-02) ----------------
   The iPhone hands a customer their portal link from the customer screen; the
   web twin does the same. One link per QBO customer, get-or-create, with
   copy / share / pause / new-link. Mirrors CustomerDetailView's hub card. */
function clientHubCard(slot, c) {
  if (!slot || !c?.id) return;
  const paint = (link, err) => {
    if (err) { slot.innerHTML = `<div class="note">Client Hub: ${esc(err)}</div><button class="btn ghost" id="hubretry">Retry client link</button>`; slot.querySelector("#hubretry").onclick = () => clientHubCard(slot, c); return; }
    if (!link) { slot.innerHTML = `<div class="note">Client Hub link: loading…</div>`; return; }
    slot.innerHTML = `<div style="padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--card)">
      <div class="eyebrow">CLIENT HUB</div>
      <div class="note" style="margin-top:4px">${link.active ? "Their private portal — invoices, estimates, approvals." : "Link paused — the customer sees nothing until you resume it."}</div>
      <div class="rowbtns" style="margin-top:10px">
        <button class="btn primary" id="hubcopy" ${link.active ? "" : "disabled"}>&#128279; Copy link</button>
        ${navigator.share ? `<button class="btn ghost" id="hubshare" ${link.active ? "" : "disabled"}>&#8599; Share</button>` : ""}
        <button class="btn ghost" id="hubpause">${link.active ? "Pause" : "Resume"}</button>
        <button class="btn ghost" id="hubnew">New link</button>
      </div></div>`;
    const busy = async (fn) => { try { await fn(); } catch (e) { toast(friendlyError(e, "Couldn't update the Client Hub link. Try again."), "err"); } };
    slot.querySelector("#hubcopy").onclick = () => busy(async () => {
      await navigator.clipboard.writeText(link.url); toast("Client Hub link copied");
    });
    const shareBtn = slot.querySelector("#hubshare");
    if (shareBtn) shareBtn.onclick = () => busy(async () => {
      try { await navigator.share({ title: (S.profile?.business?.name || "Ledger") + " — your account", url: link.url }); }
      catch (e) { if (e?.name !== "AbortError") { await navigator.clipboard.writeText(link.url); toast("Client Hub link copied"); } }
    });
    slot.querySelector("#hubpause").onclick = () => busy(async () => {
      const r = await api("/client-hub", { action: "set-active", id: link.id, active: !link.active });
      paint(r.link); toast(r.link.active ? "Client Hub link resumed" : "Client Hub link paused");
    });
    slot.querySelector("#hubnew").onclick = () => busy(async () => {
      if (!(await askConfirm("The old one stops working immediately.", { title: "Make a new link?", ok: "Make a new link", danger: true }))) return;
      const r = await api("/client-hub", { action: "regenerate", id: link.id });
      paint(r.link); toast("New Client Hub link ready");
    });
  };
  paint(null);
  api("/client-hub", { action: "link", qbo_customer_id: String(c.id), customer_name: c.name || "" })
    .then((r) => paint(r.link))
    .catch((e) => paint(null, e.message || "unavailable"));
}

/* ---------------- VIN scan & close job (web parity 2026-09-02) ----------------
   Web twin of the iPhone VehicleScanFlow. Photos come from the phone camera
   (file input with capture); the VIN barcode is read by the browser's own
   BarcodeDetector when it has one, otherwise — and for the door placard and
   dash — by Tesseract running locally in the browser (assets/ocr, no upload).
   Same parsers as iOS: VIN = 17 chars, no I/O/Q; placard = sizes + PSI pairs.
   The server (/vehicles) decodes, remembers the vehicle and writes the
   completion message. Nothing is invoiced. */
let OCR_WORKER = null;
async function ocrWorker() {
  if (OCR_WORKER) return OCR_WORKER;
  if (!window.Tesseract) {
    await new Promise((res, rej) => { const t = document.createElement("script"); t.src = "assets/ocr/tesseract.min.js"; t.onload = res; t.onerror = () => rej(new Error("Text reader failed to load")); document.head.appendChild(t); });
  }
  const base = new URL("assets/ocr/", location.href).href;
  OCR_WORKER = await window.Tesseract.createWorker("eng", 1, { workerPath: base + "worker.min.js", corePath: base, langPath: base, gzip: true });
  return OCR_WORKER;
}
async function readPhoto(file) {
  const out = { lines: [], barcodes: [] };
  if ("BarcodeDetector" in window) {
    try {
      const bmp = await createImageBitmap(file);
      const det = new BarcodeDetector({ formats: ["code_39", "code_128", "qr_code", "data_matrix"] });
      out.barcodes = (await det.detect(bmp)).map((b) => b.rawValue || "").filter(Boolean);
    } catch {}
  }
  try {
    const w = await ocrWorker();
    const { data } = await w.recognize(file);
    out.lines = String(data?.text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (e) { if (!out.barcodes.length) throw e; }
  return out;
}
function cleanedVIN(raw) {
  let compact = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.startsWith("VIN")) compact = compact.slice(3);
  if (compact.length < 17) return null;
  for (let i = 0; i + 17 <= compact.length; i++) {
    const c = compact.slice(i, i + 17);
    if (!/[IOQ]/.test(c) && /[A-Z]/.test(c) && /[0-9]/.test(c)) return c;
  }
  return null;
}
function vinFromRead(read) {
  for (const b of read.barcodes) { const v = cleanedVIN(b); if (v) return v; }
  for (const l of read.lines) if (l.toUpperCase().includes("VIN")) { const v = cleanedVIN(l); if (v) return v; }
  for (const l of read.lines) { const v = cleanedVIN(l); if (v) return v; }
  return null;
}
function placardFromRead(read) {
  const joined = read.lines.join(" \n ").toUpperCase();
  const sizes = [];
  for (const m of joined.matchAll(/\b(P|LT)?\s*(\d{3})\s*\/\s*(\d{2,3})\s*R\s*(\d{2}(?:\.\d)?)\b/g)) {
    const size = `${m[1] || ""}${m[2]}/${m[3]}R${m[4]}`; if (!sizes.includes(size)) sizes.push(size);
  }
  if (!sizes.length) for (const m of joined.matchAll(/\b(\d{2}(?:\.\d)?)\s*R\s*(\d{2}(?:\.\d)?)\b/g)) {
    const size = `${m[1]}R${m[2]}`; if (!sizes.includes(size)) sizes.push(size);
  }
  const psi = [...joined.matchAll(/\b(\d{2,3})\s*PSI\b/g)].map((m) => Number(m[1])).filter((n) => n >= 20 && n <= 150);
  return { frontSize: sizes[0] || "", rearSize: sizes[1] || "", frontPsi: psi[0] || "", rearPsi: psi[1] || psi[0] || "" };
}
function odometerFromRead(read) {
  const values = (lines) => lines.flatMap((line) => [...line.matchAll(/\b\d[\d\s,.]{2,9}\b/g)].map((m) => Number(m[0].replace(/[^0-9]/g, ""))).filter((v) => v >= 1000 && v <= 3000000));
  const labelled = read.lines.filter((l) => { const u = l.toUpperCase(); return u.includes("ODO") || u.includes(" KM") || u.endsWith("KM"); });
  const pick = values(labelled); const any = values(read.lines);
  return pick.length ? Math.max(...pick) : any.length ? Math.max(...any) : null;
}

/* ---------------- Live VIN scanner + one-skin spec card (2026-09-02) ----------------
   Alternative to photo-and-OCR: the camera stays open and ZXing (assets/scan,
   local, nothing uploaded) reads the door-jamb barcode the moment it is in
   frame — Code 39 / Code 128 / QR / Data Matrix / PDF417, which covers every
   North American VIN label. Works in iPhone Safari and Android Chrome, which
   have no BarcodeDetector. Photo + typing stay as fallbacks.
   Every decoded spec renders through ONE component, vehicleSpecCard(), so the
   standalone scanner and the close-job flow look identical. */
let ZX_READY = null;
function zxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (ZX_READY) return ZX_READY;
  ZX_READY = new Promise((res, rej) => {
    const t = document.createElement("script"); t.src = "assets/scan/zxing.min.js";
    t.onload = () => res(window.ZXing); t.onerror = () => rej(new Error("Barcode reader failed to load"));
    document.head.appendChild(t);
  });
  return ZX_READY;
}
function liveVinScan() {
  return new Promise(async (resolve) => {
    const wrap = document.createElement("div"); wrap.className = "vscan";
    wrap.innerHTML = `<video class="vscan-video" playsinline muted autoplay></video>
      <div class="vscan-mask"><div class="vscan-frame"><i></i></div></div>
      <div class="vscan-top"><span class="eyebrow">Live VIN scan</span><button class="vscan-x" type="button">&#10005;</button></div>
      <div class="vscan-hint">Line up the barcode on the door jamb or dash label</div>
      <div class="vscan-bot"><button class="btn ghost vscan-torch" type="button" hidden>&#128294; Light</button><button class="btn ghost vscan-type" type="button">Type it instead</button></div>`;
    document.body.appendChild(wrap);
    const video = wrap.querySelector("video"); const hint = wrap.querySelector(".vscan-hint");
    let reader = null; let done = false;
    const finish = (vin) => {
      if (done) return; done = true;
      try { reader && reader.reset(); } catch {}
      try { (video.srcObject?.getTracks() || []).forEach((t) => t.stop()); } catch {}
      wrap.remove(); resolve(vin || null);
    };
    wrap.querySelector(".vscan-x").onclick = () => finish(null);
    wrap.querySelector(".vscan-type").onclick = () => finish(null);
    if (!navigator.mediaDevices?.getUserMedia) { hint.textContent = "This browser has no camera access — type the VIN instead."; return; }
    try {
      const ZX = await zxing();
      const hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.CODE_39, ZX.BarcodeFormat.CODE_128, ZX.BarcodeFormat.QR_CODE, ZX.BarcodeFormat.DATA_MATRIX, ZX.BarcodeFormat.PDF_417]);
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      reader = new ZX.BrowserMultiFormatReader(hints, 250);
      const onRead = (result) => {
        if (!result || done) return;
        const v = cleanedVIN(result.getText ? result.getText() : result.text);
        if (v) { wrap.querySelector(".vscan-frame").classList.add("hit"); hint.textContent = "Got it · " + v; setTimeout(() => finish(v), 220); }
        else hint.textContent = "Barcode read, but it isn't a VIN — keep looking";
      };
      const constraints = { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
      if (reader.decodeFromConstraints) await reader.decodeFromConstraints(constraints, video, onRead);
      else await reader.decodeFromVideoDevice(undefined, video, onRead);
      // Torch when the phone offers one (Android Chrome); iPhone Safari does not.
      try {
        const track = video.srcObject?.getVideoTracks?.()[0];
        const caps = track?.getCapabilities?.() || {};
        if (caps.torch) {
          const tb = wrap.querySelector(".vscan-torch"); tb.hidden = false; let on = false;
          tb.onclick = () => { on = !on; track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {}); tb.classList.toggle("on", on); };
        }
      } catch {}
    } catch (err) {
      const why = String(err?.name || "") + " " + String(err?.message || "");
      hint.textContent = /denied|permission|NotAllowed/i.test(why)
        ? "Camera permission was refused — allow the camera in your browser, or type the VIN."
        : /failed to load/i.test(why) ? why.trim() : "No camera available here — use Photo, or type the VIN.";
    }
  });
}
function vehicleSpecCard(d, r, opts = {}) {
  if (!d) return "";
  const title = [d.year, d.make, d.model].filter(Boolean).join(" ");
  const sub = [d.trim, d.drivetrain, d.engine, d.fuel].filter(Boolean).join(" · ");
  const chips = [];
  if (r) {
    chips.push(`<span class="sc-chip em">Seen before${r.visit_count ? " · " + r.visit_count + " visit" + (r.visit_count === 1 ? "" : "s") : ""}</span>`);
    if (r.last_odometer_km) chips.push(`<span class="sc-chip">${Number(r.last_odometer_km).toLocaleString("en-CA")} km last visit</span>`);
    if (r.placard_tire_size) chips.push(`<span class="sc-chip cy">${esc(r.placard_tire_size)}${r.placard_rear_tire_size && r.placard_rear_tire_size !== r.placard_tire_size ? " / " + esc(r.placard_rear_tire_size) : ""}</span>`);
    if (r.placard_front_psi) chips.push(`<span class="sc-chip cy">${esc(String(r.placard_front_psi))}${r.placard_rear_psi ? "/" + esc(String(r.placard_rear_psi)) : ""} PSI</span>`);
  } else chips.push(`<span class="sc-chip">First time here</span>`);
  // The three numbers the bay actually needs sit on top, always visible:
  // factory tire size, wheel torque, cold pressure. Factory data first,
  // this shop's own placard reading as the fallback.
  const f = d.fitment || null;
  const tileTire = f?.front_tire ? (f.rear_tire ? `${f.front_tire} / ${f.rear_tire}` : f.front_tire)
    : r?.placard_tire_size ? `${r.placard_tire_size}${r.placard_rear_tire_size && r.placard_rear_tire_size !== r.placard_tire_size ? " / " + r.placard_rear_tire_size : ""}` : null;
  const tileTorque = f?.torque_lbft ? `${f.torque_lbft} lb-ft` : f?.torque || (r?.wheel_torque_lbft ? `${r.wheel_torque_lbft} lb-ft` : null);
  const tilePsi = f?.front_psi ? (f.rear_psi && f.rear_psi !== f.front_psi ? `${f.front_psi} / ${f.rear_psi}` : String(f.front_psi))
    : r?.placard_front_psi ? `${r.placard_front_psi}${r.placard_rear_psi && r.placard_rear_psi !== r.placard_front_psi ? " / " + r.placard_rear_psi : ""}` : null;
  const awaiting = !f && (Array.isArray(d.specs) ? d.specs : []).some((g) => g.items.some((it) => /awaiting/i.test(it.value)));
  const pending = !f && (awaiting || (!tileTire && !tilePsi));
  const tile = (label, value, unit, src) => `<div class="sc-tile ${value ? "" : "off"}"><span>${esc(label)}</span><b>${value ? esc(value) : "—"}</b><small>${value ? esc(unit || "") : esc(src || "not on file")}</small></div>`;
  const shop = `<div class="sc-shop">
      ${tile("Tire size", tileTire, f?.front_tire ? (f.load_speed ? "factory · " + f.load_speed : "factory") : tileTire ? "door placard" : "", pending ? "awaiting source" : "read the placard")}
      ${tile("Torque", tileTorque, f?.torque_nm ? f.torque_nm + " Nm" : tileTorque ? "shop entry" : "", pending ? "awaiting source" : "not on file")}
      ${tile("Pressure", tilePsi, "psi cold", pending ? "awaiting source" : "read the placard")}
    </div>${f && f.confidence !== "exact" ? `<div class="note sc-warn">&#9888; ${esc(f.confidence === "likely" ? "Best match" : "Model-level match")} of ${f.candidates} trims (${esc(f.matched)}) — confirm size on the door placard.</div>` : ""}`;
  const groups = Array.isArray(d.specs) ? d.specs : [];
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const body = groups.map((g) => `<div class="sc-group"><div class="eyebrow">${esc(g.group)}</div>
      ${g.items.map((it) => `<div class="kv"><span>${esc(it.label)}</span><b>${esc(it.value)}</b></div>`).join("")}</div>`).join("");
  return `<div class="speccard">
    <div class="sc-head">
      <span class="sc-ic">${segIc("car")}</span>
      <div class="sc-title"><b>${esc(title || "Vehicle")}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
    </div>
    <div class="sc-vin">${esc(d.vin || "")}</div>
    <div class="sc-chips">${chips.join("")}</div>
    ${shop}
    ${d.warning ? `<div class="note sc-warn">&#9888; ${esc(d.warning)}</div>` : ""}
    ${count ? `<details class="sc-all" ${opts.open ? "open" : ""}><summary>All specs <em>${count}</em></summary>${body}</details>` : `<div class="note">No further specs on file for this VIN.</div>`}
  </div>`;
}
function specsAsText(d) {
  const lines = [[d.year, d.make, d.model, d.trim].filter(Boolean).join(" "), "VIN " + d.vin, ""];
  for (const g of d.specs || []) { lines.push(g.group.toUpperCase()); for (const it of g.items) lines.push(`${it.label}: ${it.value}`); lines.push(""); }
  return lines.join("\n").trim();
}
function vinScannerSheet() {
  const V = { vin: "", decoded: null, remembered: null, busy: "", err: "" };
  const draw = () => {
    sheet(`<h2>VIN scanner</h2>
      <p class="sh-sub">Scan the barcode, or type the 17 characters. Every spec shows on one card.</p>
      <div class="rowbtns">
        <button class="btn primary" id="vnlive">&#9673; Scan with camera</button>
        <button class="btn ghost" id="vnphoto">&#128247; Photo</button>
      </div>
      <label class="emailrow" style="margin-top:8px">VIN (17 characters)<input id="vntxt" class="cmpinput" value="${esc(V.vin)}" maxlength="17" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="1FT…"></label>
      ${V.busy ? `<div class="note" style="margin-top:8px">${esc(V.busy)}</div>` : ""}
      ${V.err ? `<div class="note" style="color:#fca5a5;margin-top:8px">${esc(V.err)}</div>` : ""}
      ${vehicleSpecCard(V.decoded, V.remembered, { open: true })}
      ${V.decoded ? `<div class="rowbtns" style="margin-top:10px"><button class="btn ghost" id="vncopy">Copy specs</button><button class="btn ghost" id="vnask">Ask Ledger about it</button></div>` : ""}
      <input type="file" id="vnfile" accept="image/*" capture="environment" hidden>`, (sh) => {
      const decode = async () => {
        if (V.vin.length !== 17 || V.decoding) return;
        V.decoding = true; V.err = ""; V.busy = "Looking up the vehicle…"; V.decoded = null; draw();
        try { const r = await api("/vehicles", { action: "decode", vin: V.vin }); V.decoded = r.vehicle; V.remembered = r.remembered; }
        catch (err) { V.err = err.message || "VIN lookup failed"; }
        V.decoding = false; V.busy = ""; draw();
      };
      sh.querySelector("#vnlive").onclick = async () => { const v = await liveVinScan(); if (v) { V.vin = v; decode(); } };
      sh.querySelector("#vnphoto").onclick = () => { const f = sh.querySelector("#vnfile"); f.value = ""; f.click(); };
      sh.querySelector("#vnfile").onchange = async (ev) => {
        const file = ev.target.files?.[0]; if (!file) return;
        V.err = ""; V.busy = "Reading the photo…"; draw();
        try { const v = vinFromRead(await readPhoto(file)); if (v) { V.vin = v; V.busy = ""; await decode(); return; } V.err = "Couldn't find a 17‑character VIN in that photo — try the live scan, or type it."; }
        catch (err) { V.err = err.message || "Photo read failed"; }
        V.busy = ""; draw();
      };
      sh.querySelector("#vntxt").onchange = (ev) => { V.vin = (ev.target.value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (V.vin.length === 17) decode(); else if (V.vin) { V.err = "A VIN is 17 characters — no I, O or Q."; draw(); } };
      const copy = sh.querySelector("#vncopy"); if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(specsAsText(V.decoded)); toast("Specs copied"); } catch { toast("Couldn't copy", "err"); } };
      const ask = sh.querySelector("#vnask"); if (ask) ask.onclick = () => { const d = V.decoded; closeSheet(); openChat(); $("box").value = `What do you know about the ${[d.year, d.make, d.model].filter(Boolean).join(" ")} with VIN ${d.vin}? Last visit, kilometres and tire sizes on file.`; send(); };
    });
  };
  draw();
}

function completeJobSheet(e, back) {
  sheet(`<h2>Complete job</h2><p class="sh-sub">${esc(e.title)} · ${esc(timeLabel(e.start))}</p><p class="note">Confirm the work is finished. Ledger will prepare the invoice for your review; nothing is billed or sent to the customer here.</p><button class="btn primary wide" id="jobCompleteReview">Done — review with Ledger</button>`, (sh) => {
    sh.querySelector("#jobCompleteReview").onclick = () => {
      closeSheet(); openChat(); $("box").value = `The ${timeLabel(e.start)} appointment is done. Job: ${e.title}`; send();
    };
  });
}

function vehicleScanSheet(e, back) {
  const V = { vin: "", decoded: null, remembered: null, frontSize: "", rearSize: "", frontPsi: "", rearPsi: "", torque: "", odometer: "", busy: "", err: "" };
  const inp = (id, label, value, extra = "") => `<label class="emailrow">${label}<input id="${id}" class="cmpinput" value="${esc(value)}" ${extra}></label>`;
  const draw = () => {
    const d = V.decoded; const label = d ? [d.year, d.make, d.model, d.trim].filter(Boolean).join(" ") : "";
    const r = V.remembered;
    sheet(`<h2>Scan VIN &amp; close job</h2>
      <p class="sh-sub">${esc(e.title || "")} · ${esc(timeLabel(e.start))}</p>
      <div class="eyebrow" style="margin-top:8px">1 · VIN</div>
      <div class="rowbtns" style="margin-top:6px">
        <button class="btn primary" id="vsvin">&#9673; Scan with camera</button>
        <button class="btn ghost" id="vsvinphoto">&#128247; Photo</button>
      </div>
      ${inp("vsvintxt", "VIN (17 characters)", V.vin, 'maxlength="17" autocapitalize="characters" autocomplete="off" spellcheck="false"')}
      ${vehicleSpecCard(d, r)}
      <div class="eyebrow" style="margin-top:16px">2 · DOOR PLACARD</div>
      <div class="rowbtns" style="margin-top:6px"><button class="btn ghost" id="vsplac">&#128247; Photo the placard</button></div>
      <div class="rowbtns">${inp("vsfs", "Front tire size", V.frontSize)}${inp("vsrs", "Rear tire size", V.rearSize)}</div>
      <div class="rowbtns">${inp("vsfp", "Front PSI", V.frontPsi, 'inputmode="numeric"')}${inp("vsrp", "Rear PSI", V.rearPsi, 'inputmode="numeric"')}</div>
      ${inp("vstq", "Wheel torque (lb-ft)", V.torque, 'inputmode="numeric" placeholder="e.g. 100"')}
      <div class="note" style="margin-top:4px">Torque is remembered for this vehicle. Factory torque fills in from the VIN.</div>
      <div class="eyebrow" style="margin-top:16px">3 · KILOMETRES</div>
      <div class="rowbtns" style="margin-top:6px"><button class="btn ghost" id="vsodo">&#128247; Photo the dash</button></div>
      ${inp("vskm", "Odometer (km)", V.odometer, 'inputmode="numeric"')}
      ${V.err ? `<div class="note" style="color:#fca5a5;margin-top:8px">${esc(V.err)}</div>` : ""}
      ${V.busy ? `<div class="note" style="margin-top:8px">${esc(V.busy)}</div>` : ""}
      <button class="btn primary wide" style="margin-top:14px" id="vsdone" ${V.vin.length === 17 && V.odometer ? "" : "disabled"}>Finish &amp; send completion message</button>
      <p class="note" style="margin-top:6px">Copies the message and opens Telegram to send it. Nothing is invoiced.</p>
      <input type="file" id="vsfile" accept="image/*" capture="environment" hidden>`, (sh) => {
      const grab = () => {
        V.vin = (sh.querySelector("#vsvintxt").value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        V.frontSize = sh.querySelector("#vsfs").value.trim(); V.rearSize = sh.querySelector("#vsrs").value.trim();
        V.frontPsi = sh.querySelector("#vsfp").value.replace(/[^0-9]/g, ""); V.rearPsi = sh.querySelector("#vsrp").value.replace(/[^0-9]/g, "");
        V.torque = sh.querySelector("#vstq").value.replace(/[^0-9]/g, "");
        V.odometer = sh.querySelector("#vskm").value.replace(/[^0-9]/g, "");
      };
      const photo = (mode) => { grab(); const f = sh.querySelector("#vsfile"); f.value = ""; f.dataset.mode = mode; f.click(); };
      sh.querySelector("#vsfile").onchange = async (ev) => {
        const file = ev.target.files?.[0]; if (!file) return;
        const mode = ev.target.dataset.mode; V.err = ""; V.busy = "Reading the photo…"; draw();
        try {
          const read = await readPhoto(file);
          if (mode === "vin") { const v = vinFromRead(read); if (v) { V.vin = v; await decode(); } else V.err = "Couldn't find a 17‑character VIN in that photo — try closer, or type it."; }
          else if (mode === "placard") { const p = placardFromRead(read); Object.assign(V, { frontSize: p.frontSize || V.frontSize, rearSize: p.rearSize || V.rearSize, frontPsi: p.frontPsi || V.frontPsi, rearPsi: p.rearPsi || V.rearPsi }); if (!p.frontSize && !p.frontPsi) V.err = "No tire size or PSI read — type them from the sticker."; }
          else { const km = odometerFromRead(read); if (km) V.odometer = String(km); else V.err = "Couldn't read the kilometres — type them."; }
        } catch (err) { V.err = err.message || "Photo read failed"; }
        V.busy = ""; draw();
      };
      const decode = async () => {
        if (V.vin.length !== 17 || V.decoding) return;
        V.decoding = true; V.busy = "Looking up the vehicle…"; draw();
        try { const r = await api("/vehicles", { action: "decode", vin: V.vin }); V.decoded = r.vehicle; V.remembered = r.remembered;
          if (r.remembered) { V.frontSize = V.frontSize || r.remembered.placard_tire_size || ""; V.rearSize = V.rearSize || r.remembered.placard_rear_tire_size || ""; V.frontPsi = V.frontPsi || r.remembered.placard_front_psi || ""; V.rearPsi = V.rearPsi || r.remembered.placard_rear_psi || ""; }
          // Exact factory match pre-fills the placard fields so one VIN scan is enough; an ambiguous match stays blank.
          const fit = r.vehicle?.fitment; if (fit && fit.confidence === "exact") {
            V.frontSize = V.frontSize || fit.front_tire || ""; V.rearSize = V.rearSize || (fit.rear_tire && fit.rear_tire !== fit.front_tire ? fit.rear_tire : "");
            V.frontPsi = V.frontPsi || (fit.front_psi != null ? String(fit.front_psi) : ""); V.rearPsi = V.rearPsi || (fit.rear_psi != null ? String(fit.rear_psi) : "");
          }
          V.torque = V.torque || (r.remembered?.wheel_torque_lbft ? String(r.remembered.wheel_torque_lbft) : "") || (r.vehicle?.fitment?.torque_lbft ? String(r.vehicle.fitment.torque_lbft) : "");
        } catch (err) { V.decoded = null; V.err = err.message || "VIN lookup failed"; }
        V.decoding = false; V.busy = ""; draw();
      };
      sh.querySelector("#vsvin").onclick = async () => { grab(); const v = await liveVinScan(); if (v) { V.vin = v; await decode(); } };
      sh.querySelector("#vsvinphoto").onclick = () => photo("vin");
      sh.querySelector("#vsplac").onclick = () => photo("placard");
      sh.querySelector("#vsodo").onclick = () => photo("odo");
      sh.querySelector("#vsvintxt").onchange = () => { grab(); if (V.vin.length === 17) decode(); else draw(); };
      sh.querySelector("#vskm").oninput = () => { grab(); sh.querySelector("#vsdone").disabled = !(V.vin.length === 17 && V.odometer); };
      sh.querySelector("#vsdone").onclick = async () => {
        grab(); if (V.vin.length !== 17 || !V.odometer) return;
        V.err = ""; V.busy = "Saving the visit…"; draw();
        try {
          const r = await api("/vehicles", { action: "complete", vin: V.vin, event_id: e.id, event_title: e.title, event_start: e.start,
            event_time: timeLabel(e.start), customer_name: e.title, odometer_km: Number(V.odometer),
            placard_tire_size: V.frontSize || null, placard_rear_tire_size: V.rearSize || null,
            placard_front_psi: V.frontPsi ? Number(V.frontPsi) : null, placard_rear_psi: V.rearPsi ? Number(V.rearPsi) : null,
            wheel_torque_lbft: V.torque ? Number(V.torque) : null });
          try { await navigator.clipboard.writeText(r.message); } catch {}
          const u = r.handoff_telegram_username
            ? "tg://resolve?domain=" + encodeURIComponent(r.handoff_telegram_username) + "&text=" + encodeURIComponent(r.message)
            : "https://t.me/share/url?url=&text=" + encodeURIComponent(r.message);
          toast("Saved · message copied" + (r.km_since_last != null ? " · " + Number(r.km_since_last).toLocaleString("en-CA") + " km since last visit" : ""));
          window.open(u, "_blank"); closeSheet(); if (back) back();
        } catch (err) { V.busy = ""; V.err = err.message || "Couldn't save the visit"; draw(); }
      };
    });
  };
  draw();
}

/* ---------------- Push notifications (web parity 2026-09-02) ----------------
   Settings card. Subscribes this browser through the service worker and
   registers it with /web-push; the server fans every alert out to iPhones
   (APNs) and browsers (Web Push) together. iPhone Safari only allows this once
   the app is added to the Home Screen — the card says so instead of failing. */
function pushSettingsCard(slot) {
  if (!slot) return;
  const b64ToKey = (b64) => { const s = (b64 + "=".repeat((4 - b64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"); const raw = atob(s); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const paint = (html, wire) => { slot.innerHTML = html; if (wire) wire(); };
  const run = async () => {
    if (!supported) return paint(isIOS && !standalone
      ? "Add Ledger to your Home Screen (Share → Add to Home Screen) to turn on notifications."
      : "This browser can't receive notifications.");
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    let st; try { st = await api("/web-push", { action: "status", endpoint: existing?.endpoint || "" }); } catch (e) { return paint("Notifications: " + esc(e.message)); }
    if (!st.configured || !st.public_key) return paint("Notifications aren't switched on for the server yet.");
    const on = !!(existing && st.subscribed);
    paint(`<div>${on ? "&#10004; This device gets notifications — new texts, paid invoices, booking requests." : Notification.permission === "denied" ? "Notifications are blocked for this site in your browser settings." : "Get a buzz when a customer texts, pays, or books."}</div>
      <div class="rowbtns" style="margin-top:8px">
        <button class="btn ${on ? "ghost" : "primary"}" id="pushtoggle" ${Notification.permission === "denied" && !on ? "disabled" : ""}>${on ? "Turn off" : "Turn on"}</button>
        ${on ? `<button class="btn ghost" id="pushtest">Send a test</button>` : ""}
      </div>`, () => {
      slot.querySelector("#pushtoggle").onclick = async () => {
        try {
          if (on) {
            if (existing) { await api("/web-push", { action: "unregister", endpoint: existing.endpoint }); await existing.unsubscribe().catch(() => {}); }
            toast("Notifications off on this device");
          } else {
            const perm = await Notification.requestPermission();
            if (perm !== "granted") { toast("Notifications weren't allowed", "err"); return run(); }
            const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToKey(st.public_key) });
            await api("/web-push", { action: "register", subscription: sub.toJSON(), user_agent: navigator.userAgent });
            toast("Notifications on");
          }
        } catch (e) { toast(friendlyError(e, "Couldn't change your notifications. Try again."), "err"); }
        run();
      };
      const t = slot.querySelector("#pushtest");
      if (t) t.onclick = async () => {
        try { const r = await api("/web-push", { action: "test" }); toast(r.delivered > 0 ? `Test sent to ${r.delivered} device${r.delivered === 1 ? "" : "s"}` : "No device received it", r.delivered > 0 ? undefined : "err"); }
        catch (e) { toast(friendlyError(e, "Couldn't send the test notification. Try again."), "err"); }
      };
    });
  };
  run().catch((e) => paint("Notifications: " + esc(e.message || "unavailable")));
}

/* ---------------- Ledger Live voice (web parity 2026-09-02) ----------------
   Same OpenAI Realtime session the iPhone opens (/realtime/session mints the
   short-lived key, the tool catalog and safety gates are the server's), over
   the browser's own WebRTC. Tool calls arrive on the "oai-events" data channel
   and run through /ledger-ai tool-exec with the user's own sign-in, exactly as
   iOS does. Usage is reported back per response so the AI allowance holds. */
/* ---------------- "Hey Ledger" (web, 2026-09-13, v160) ----------------
   The browser's own speech recognition, on only while the switch is on, the
   app is signed in, this tab is visible and Ledger Live isn't already open.
   Hearing "hey ledger" opens Ledger Live. Chrome/Edge stop after silence and
   are restarted; Safari on iPhone drops the mic when the screen locks, which is
   why the switch points phone users at the iPhone app. */
const WAKE = { on: accountStorage.getItem("ledger.wakeWord") === "1", rec: null, ready: false, denied: false, last: 0 };
const WAKE_PHRASES = ["hey ledger", "hey ledgers", "hey ledge", "hey leger", "hey lodger", "hey lecher", "hey letcher"];
function wakeSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
// The wake word exists only to open Ledger Live. While Live is paused (audit
// 16-04) the recognizer is never constructed and the mic is never requested —
// a remembered "on" switch from before the pause stays parked, not armed.
function wakeAllowed() { return S.voice?.available === true; }
function wakeSync() {
  const want = wakeAllowed() && WAKE.on && WAKE.ready && !WAKE.denied && wakeSupported() && document.visibilityState === "visible" && !LIVE;
  if (want && !WAKE.rec) wakeStart();
  if (!want && WAKE.rec) wakeStop();
}
function wakeStart() {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec;
  try { rec = new R(); } catch { return; }
  rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let heard = "";
    for (let i = e.resultIndex; i < e.results.length; i++) heard += " " + (e.results[i][0]?.transcript || "");
    const text = heard.toLowerCase().replace(/[^a-z ]/g, " ");
    if (WAKE_PHRASES.some((p) => text.includes(p)) && Date.now() - WAKE.last > 3000) {
      WAKE.last = Date.now();
      wakeStop();
      liveSheet();
    }
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      WAKE.denied = true; wakeStop();
      toast("Ledger can't hear you — allow the microphone for this site in your browser, then switch “Hey Ledger” on again.", "err");
    }
  };
  // Chrome ends a session after silence or ~a minute; come straight back.
  rec.onend = () => { if (WAKE.rec === rec) { WAKE.rec = null; setTimeout(wakeSync, 500); } };
  WAKE.rec = rec;
  try { rec.start(); } catch { WAKE.rec = null; }
}
function wakeStop() { const r = WAKE.rec; WAKE.rec = null; try { r?.stop(); } catch {} }
function wakeToggle(btn) {
  if (!wakeAllowed()) { toast(S.voice?.message || "Ledger Live is temporarily paused. Typed chat is still available."); return; }
  WAKE.on = !WAKE.on; WAKE.denied = false;
  accountStorage.setItem("ledger.wakeWord", WAKE.on ? "1" : "0");
  if (btn) { btn.classList.toggle("on", WAKE.on); btn.setAttribute("aria-checked", String(WAKE.on)); }
  wakeSync();
  toast(WAKE.on ? "Listening for “Hey Ledger” while this tab is open" : "“Hey Ledger” is off");
}
document.addEventListener("visibilitychange", () => wakeSync());

let LIVE = null;

// Ledger Live "ready" tone: two quick rising notes (D5 → A5), soft attack, clean decay, under three
// quarters of a second and quiet — the same figure the iPhone plays. Skips silently if the browser
// will not let audio start (the glow still shows).
function liveReadyTone() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = liveReadyTone.ctx || (liveReadyTone.ctx = new AC());
    const go = () => {
      const t0 = ctx.currentTime + 0.02;
      const note = (f, at, dur, peak, tau) => {
        const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
        o.type = "sine"; o.frequency.value = f; o2.type = "sine"; o2.frequency.value = f * 2; g2.gain.value = 0.28;
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.01); g.gain.setTargetAtTime(0.0001, at + 0.012, tau);
        o.start(at); o2.start(at); o.stop(at + dur); o2.stop(at + dur);
      };
      note(587.33, t0, 0.32, 0.16, 0.11);
      note(880, t0 + 0.11, 0.64, 0.18, 0.22);
    };
    if (ctx.state === "suspended") ctx.resume().then(go).catch(() => {}); else go();
  } catch {}
}
function liveSheet() {
  if (LIVE) { LIVE.draw(); return; }
  // Paused (audit 16-04): say so and stop — no session request, no mic prompt.
  if (!S.voice?.available) { toast(S.voice?.message || "Ledger Live is temporarily paused. Typed chat is still available."); return; }
  wakeStop();
  // drafts = email drafts (rendered on end, as before); cards = every other confirm
  // card voice can now produce (invoice, estimate, booking, reminder, text, print) —
  // stored as renderers and drawn into the chat the moment the session ends.
  const L = { state: "connecting", err: "", lines: [], cost: 0, pc: null, dc: null, mic: null, audio: null, drafts: [], cards: [], hearing: false };
  const stop = () => {
    try { L.dc?.close(); } catch {}
    try { L.mic?.getTracks().forEach((t) => t.stop()); } catch {}
    try { L.pc?.close(); } catch {}
    if (L.audio) { L.audio.pause(); L.audio.srcObject = null; }
    LIVE = null;
    setTimeout(wakeSync, 300);
  };
  const labels = { connecting: "Connecting…", listening: "Listening — go ahead", thinking: "Thinking…", speaking: "Ledger is speaking", failed: "Couldn't connect", ended: "Ended" };
  L.draw = () => {
    const live = ["listening", "thinking", "speaking"].includes(L.state);
    sheet(`<h2>&#127908; Ledger Live</h2>
      <p class="sh-sub">${esc(labels[L.state] || L.state)}${L.cost ? ` · $${L.cost.toFixed(2)} this session` : ""}</p>
      ${(L.cards.length + L.drafts.length) ? `<div class="note" style="color:var(--cyan)">${L.cards.length + L.drafts.length} draft${(L.cards.length + L.drafts.length) === 1 ? "" : "s"} waiting for your OK — end the session to review.</div>` : ""}
      <div class="lv-wrap"><div class="lv-halo" id="lvhalo"></div><div class="lv-orb ${L.state}${L.hearing ? " hearing" : ""}"><span class="lv-sweep"></span><img src="assets/logo-mark-96.png" alt=""></div></div>
      ${L.err ? `<div class="note" style="color:#fca5a5">${esc(L.err)}</div>` : ""}
      <div class="note" style="max-height:34vh;overflow:auto">${L.lines.map((l) => `<div style="margin:4px 0"><b>${l.who === "you" ? "You" : "Ledger"}:</b> ${esc(l.text)}</div>`).join("") || "Talk naturally — ask for today's numbers, who owes you, or to draft an invoice. Say \"stop\" or tap End."}</div>
      <div class="rowbtns" style="margin-top:14px">
        ${live ? `<button class="btn ghost" id="livemute">${L.muted ? "Unmute" : "Mute"}</button>` : ""}
        <button class="btn primary" id="liveend">${L.state === "failed" || L.state === "ended" ? "Close" : "End"}</button>
      </div>`, (sh) => {
      sh.querySelector("#liveend").onclick = () => { stop(); closeSheet(); L.drafts.forEach(emailDraftCard); L.cards.forEach((render) => render()); L.cards = []; L.drafts = []; };
      const m = sh.querySelector("#livemute");
      if (m) m.onclick = () => { L.muted = !L.muted; L.mic?.getAudioTracks().forEach((t) => { t.enabled = !L.muted; }); L.draw(); };
    });
    const wrap = $("sheetwrap"); if (wrap) wrap.querySelector(".sheet-back").onclick = () => { closeSheet(); if (!live) stop(); };
  };
  const set = (state) => { L.state = state; L.draw(); };
  // The mic is live: the ring locks bright, one halo rolls outward, and the ready tone plays. Once per session.
  const liveReady = () => {
    requestAnimationFrame(() => { const h = document.getElementById("lvhalo"); if (h) h.classList.add("fire"); });
    liveReadyTone();
  };
  const send = (ev) => { try { L.dc?.send(JSON.stringify(ev)); } catch {} };
  const onEvent = async (ev) => {
    switch (ev.type) {
      case "session.created": if (L.state === "connecting") set("listening"); break;
      case "input_audio_buffer.speech_started": L.hearing = true; if (L.state !== "speaking") set("listening"); else L.draw(); break;
      case "input_audio_buffer.speech_stopped": L.hearing = false; set("thinking"); break;
      case "response.created": L.hearing = false; set("speaking"); break;
      case "conversation.item.input_audio_transcription.completed": if (ev.transcript) { L.lines.push({ who: "you", text: ev.transcript }); L.draw(); } break;
      case "response.output_audio_transcript.done": case "response.audio_transcript.done": if (ev.transcript) { L.lines.push({ who: "ledger", text: ev.transcript }); L.draw(); } break;
      case "response.done": {
        if (L.state === "speaking") set("listening");
        const outputs = ev.response?.output || [];
        const calls = outputs.filter((o) => o.type === "function_call");
        if (ev.response?.usage) api("/realtime/usage", { usage: ev.response.usage, tool_calls: calls.length }).then((r) => { L.cost += Number(r?.cost_usd || 0); L.draw(); }).catch(() => {});
        if (!calls.length) break;
        set("thinking");
        for (const c of calls) {
          let output = '{"error":"tool failed"}';
          try {
            const r = await api("/ledger-ai", { action: "tool-exec", name: c.name, input: JSON.parse(c.arguments || "{}") });
            output = r.output || "{}"; if (r.email_drafts) L.drafts.push(...r.email_drafts);
            // Same card renderers the text chat uses — voice now drafts everything text can.
            (r.invoice_drafts || []).forEach((x) => L.cards.push(() => draftCard(x, "INVOICE DRAFT", "/quickbooks-invoice/confirm", "/quickbooks-invoice/cancel")));
            (r.estimate_drafts || []).forEach((x) => L.cards.push(() => draftCard(x, "ESTIMATE DRAFT", "/quickbooks-invoice/estimate-confirm", "/quickbooks-invoice/estimate-cancel")));
            (r.booking_drafts || []).forEach((x) => L.cards.push(() => bookingCard(x)));
            (r.reminder_drafts || []).forEach((x) => L.cards.push(() => reminderCard(x)));
            (r.sms_drafts || []).forEach((x) => L.cards.push(() => smsDraftCard(x)));
            (r.print_jobs || []).forEach((x) => L.cards.push(() => printJobCard(x)));
            (r.action_drafts || []).forEach((x) => L.cards.push(() => actionCard(x)));
            if (r.email_drafts || r.invoice_drafts || r.estimate_drafts || r.booking_drafts || r.reminder_drafts || r.sms_drafts || r.print_jobs || r.action_drafts) L.draw();
          } catch (e) { output = JSON.stringify({ error: e.message || "tool failed" }); }
          send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output } });
        }
        send({ type: "response.create" });
        break;
      }
      case "error": L.err = ev.error?.message || "Voice error"; set("failed"); break;
    }
  };
  LIVE = L; L.draw();
  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error("This browser can't do live voice.");
      const info = await api("/realtime/session", { capabilities: { drafts: "all" } });
      L.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      L.pc = pc;
      L.audio = new Audio(); L.audio.autoplay = true;
      pc.ontrack = (e) => { L.audio.srcObject = e.streams[0]; L.audio.play().catch(() => {}); };
      L.mic.getTracks().forEach((t) => pc.addTrack(t, L.mic));
      const dc = pc.createDataChannel("oai-events"); L.dc = dc;
      dc.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
      dc.onopen = () => { if (L.state === "connecting") { set("listening"); liveReady(); } };
      dc.onclose = () => { if (LIVE === L && L.state !== "failed") set("ended"); };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      await new Promise((res) => { if (pc.iceGatheringState === "complete") return res(); const t = setTimeout(res, 2000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } }; });
      const r = await fetch("https://api.openai.com/v1/realtime/calls?model=" + encodeURIComponent(info.model || "gpt-realtime"), {
        method: "POST", headers: { Authorization: "Bearer " + info.client_secret, "Content-Type": "application/sdp" }, body: pc.localDescription.sdp });
      if (!r.ok) throw new Error("The voice service refused the connection (" + r.status + ").");
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    } catch (e) { L.err = e.message || "Couldn't start Ledger Live"; L.state = "failed"; stop(); LIVE = null; L.draw(); }
  })();
}

try { await finishGoogleReturn(); } catch(error) { loginView("signin");toast(friendlyError(error, "Couldn't finish signing in with Google. Try again."),"err"); }
boot();
supa.auth.onAuthStateChange((event, s) => {
  if (!accountBoundary.accept(s)) return;
  if (event === "SIGNED_OUT") { accountBoundary.invalidate(); return; }
  if (event === "PASSWORD_RECOVERY") { if (!$("pw2")) newPasswordView(); return; }
  if (event === "SIGNED_IN" && s && !$("view") && !$("bizname") && !$("joincode") && !$("pw2")) setTimeout(() => void boot(), 0);
});


// ---------------------------------------------------------------------------
// Bring your data (Kyle 1202, 2026-09-06): customers + vehicles from another
// platform's export. Three steps — drop the file, check the columns, import.
// The server never writes during the check step; import is idempotent, so a
// nervous second run adds nothing.
const MIGRATE_FIELD_LABELS = {
  first_name: "First name", last_name: "Last name", full_name: "Full name (one column)", display_name: "Display name", company: "Company", email: "Email",
  phone: "Phone", phone2: "Second phone", address: "Address", address2: "Unit / address line 2", city: "City", province: "Province / state",
  postal: "Postal / zip code", country: "Country", notes: "Notes", tags: "Tags", lead_source: "Lead source", customer_type: "Customer type",
  access_code: "Gate / access code", customer_source_id: "Customer ID",
  vin: "VIN", year: "Year", make: "Make", model: "Model", trim: "Trim", plate: "Plate", odometer: "Odometer",
  vehicle_source_id: "Vehicle ID", engine: "Engine", color: "Colour",
};
// Excel (.xlsx/.xls) is what most shops actually export. Read the first sheet in the browser and hand the
// backend the same CSV text a .csv file would give — SheetJS is fetched only when an Excel file is chosen.
// CSV bytes as text (audit 2026-09-17, 12.9). `file.text()` always decodes
// UTF-8, so Excel's "Unicode Text" export (UTF-16 with a byte-order mark) came
// through as NUL-studded garbage the server then blamed on the header row.
function decodeSpreadsheetText(buffer) {
  const bytes = new Uint8Array(buffer);
  let text;
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  else text = new TextDecoder("utf-8").decode(bytes);   // strips a UTF-8 BOM itself
  if (text.includes("\x00")) throw new Error("That file isn't text I can read. Export it as CSV or Excel and try again.");
  return text;
}
async function readSpreadsheetAsCsv(file) {
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name || "")) return decodeSpreadsheetText(await file.arrayBuffer());
  if (file.size > 6000000) throw new Error("That file is over 6 MB. Split it before importing; nothing was saved.");
  const XLSX = await import("./assets/vendor/xlsx-0.20.3.mjs");
  // cellDates:false matches the server-side Excel reader (spreadsheet.ts) so a workbook reads the same on web and iPhone.
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", cellDates: false });
  if (!wb.SheetNames.length) throw new Error("That Excel file has no sheets in it.");
  let selected = wb.SheetNames[0];
  if (wb.SheetNames.length > 1) selected = await new Promise((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "max-width:90vw;width:430px;padding:24px;border-radius:18px;background:var(--bg,#111827);color:var(--text,#fff);border:1px solid #777;z-index:99999";
    dialog.innerHTML = `<h2>Choose a worksheet</h2><p>${esc(file.name)} has ${wb.SheetNames.length} sheets. Only the sheet you choose will be imported.</p><select aria-label="Worksheet" class="cmpinput" style="width:100%">${wb.SheetNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select><pre style="white-space:pre-wrap;max-height:240px;overflow:auto"></pre><button class="btn primary" data-choose>Use this sheet</button> <button class="btn" data-cancel>Cancel</button>`;
    const choice = dialog.querySelector("select"), preview=dialog.querySelector("pre");
    const show=()=>{preview.textContent=XLSX.utils.sheet_to_csv(wb.Sheets[choice.value],{blankrows:false}).split("\n").slice(0,6).join("\n")}; choice.onchange=show; show();
    const close=()=>{dialog.close();dialog.remove()};
    dialog.querySelector("[data-choose]").onclick=()=>{const name=choice.value;close();resolve(name)};
    const cancel=()=>{close();reject(new Error("Worksheet selection cancelled. Nothing was imported."))};
    dialog.querySelector("[data-cancel]").onclick=cancel; dialog.oncancel=e=>{e.preventDefault();cancel()};
    document.body.append(dialog);dialog.showModal();
  });
  file.ledgerSheet = selected;
  return XLSX.utils.sheet_to_csv(wb.Sheets[selected], { blankrows: false });
}
// The address lives in notes as "Address: …" — show it in the preview so a plumber can see their service addresses came through.
const previewAddress = (c) => ((c?.notes || "").split("\n").find((l) => l.startsWith("Address: ")) || "").slice(9, 80);
function downloadCsv(name, csv) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name; a.click();
}
function catalogImportSheet(kind="products") {
  sheet(`<h2>${kind==="services" ? "Import services" : "Import products"}</h2><p class="note">Choose the worksheet, check the columns and review every exception before saving.</p><div id="catslot"></div>`,sh=>renderCatalog(sh,kind));
}
function bringDataSheet() {
  // `seq` (audit 2026-09-17, 12.1): every analyze carries a sequence number.
  // A response that lands after a newer pick was made is dropped, so the
  // mapping on screen is always the last choice — same fence as the iPhone.
  const C = { file: null, csv: "", analysis: null, map: {}, busy: false, result: null, error: "", mergeMode:"keep", seq: 0 };
  const paint = () => {
    const box = document.querySelector("#mgbox"); if (!box) return;
    if (C.result) {
      const r = C.result;
      box.innerHTML = `
        <div class="cmpsect" style="text-align:center">
          <div style="font-size:40px">&#10003;</div>
          <h3 style="margin:6px 0">${r.replayed ? "Already imported — nothing changed" : "Imported"}</h3>
          ${r.replayed ? `<p class="note">This exact file was imported before and is still in place, so nothing was added or changed. The counts below are from that import. An undone import can be imported again.</p>` : ""}
          <p><b>${r.customers.created}</b> new customer${r.customers.created === 1 ? "" : "s"} · <b>${r.customers.matched}</b> already here${r.customers.updated ? ` (${r.customers.updated} filled in)` : ""}</p>
          ${r.kind === "vehicles" ? `<p><b>${r.vehicles.created}</b> new vehicle${r.vehicles.created === 1 ? "" : "s"} · <b>${r.vehicles.matched}</b> already here</p>` : ""}
          ${r.issue_count ? `<p class="note">${r.issue_count} row${r.issue_count === 1 ? "" : "s"} need a look. <a href="#" id="mgissues">Download the list</a></p>` : `<p class="note">Every row came in clean.</p>`}
          ${r.skipped ? `<p class="note">${r.skipped} row${r.skipped === 1 ? "" : "s"} skipped — no name, over the row limit, or refused; the list says which.</p>` : ""}
        </div>
        <button class="btn primary wide" id="mgdone">Done</button>
        <button class="linkbtn" id="mgagain" style="margin-top:8px">Import another file</button>`;
      box.querySelector("#mgdone").onclick = () => { closeSheet(); S.customers = null; if (typeof loadNativeCustomers === "function") loadNativeCustomers(); };
      box.querySelector("#mgagain").onclick = () => { C.seq++; Object.assign(C, { file: null, csv: "", analysis: null, map: {}, result: null, error: "", busy: false }); paint(); };
      const iss = box.querySelector("#mgissues");
      if (iss) iss.onclick = (e) => { e.preventDefault(); downloadCsv("import-needs-a-look.csv", "Row,Issue\n" + r.issues.map((i) => `${i.line},"${i.issues.join("; ").replace(/"/g, '""')}"`).join("\n") + "\n"); };
      return;
    }
    if (!C.analysis) {
      box.innerHTML = `
        <button class="btn wide" id="mgfirst">Your first working day — setup checklist</button><button class="btn ghost wide" id="mghistory">Import history &amp; recovery</button><div class="cmpsect"><b>Bring your business data</b><p class="note">Choose where this file belongs.</p><button class="btn" id="mgproducts">Products &amp; inventory</button> <button class="btn" id="mgservices">Service menu</button></div>
        <p class="sh-sub">Export your customers${isAuto() ? " (and vehicles)" : ""} from your old system as an Excel file or CSV, then drop the file here. Preview and map customer exports from systems such as Jobber, Housecall Pro, ServiceTitan, QuickBooks, Square, Fresha, Vagaro, Jane, Booksy, Shopmonkey, Tekmetric, Google Contacts or a plain spreadsheet — in English or French.</p>
        <input type="file" id="mgfile" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        <button class="btn primary wide" id="mgpick" ${C.busy ? "disabled" : ""}>${C.busy ? "Reading…" : "Choose a file"}</button>
        <p class="note" style="margin-top:10px">Need a starting point? <a href="#" id="mgtplc">Customer template</a>${isAuto() ? ` · <a href="#" id="mgtplv">Vehicle template</a>` : ""}</p>
        ${C.error ? `<p class="note err">${esc(C.error)}</p>` : ""}`;
      box.querySelector("#mgfirst").onclick=firstWorkingDaySheet;
      box.querySelector("#mghistory").onclick=importHistorySheet;
      box.querySelector("#mgproducts").onclick=()=>catalogImportSheet("products");
      box.querySelector("#mgservices").onclick=()=>catalogImportSheet("services");
      const input = box.querySelector("#mgfile");
      box.querySelector("#mgpick").onclick = () => input.click();
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return;
        const seq = ++C.seq;
        C.busy = true; C.error = ""; paint();
        try {
          const csv = await readSpreadsheetAsCsv(file);
          const a = await api("/migrate/analyze", { csv, file_name: file.name });
          if (seq !== C.seq) return;
          C.file = file; C.csv = csv;
          C.analysis = a; C.map = { ...(a.map || {}) };
        } catch (e) { if (seq !== C.seq) return; C.error = e.message; }
        C.busy = false; paint();
      };
      box.querySelector("#mgtplc").onclick = async (e) => { e.preventDefault(); const t = await api("/migrate/template", { kind: "customers" }); downloadCsv("ledger-customers-template.csv", t.csv); };
      const tplv = box.querySelector("#mgtplv");
      if (tplv) tplv.onclick = async (e) => { e.preventDefault(); const t = await api("/migrate/template", { kind: "vehicles" }); downloadCsv("ledger-vehicles-template.csv", t.csv); };
      return;
    }
    const a = C.analysis;
    const fields = a.kind === "vehicles" ? [...a.fields.customers, ...a.fields.vehicles] : a.fields.customers;
    const pick = (f) => `<label class="emailrow">${esc(MIGRATE_FIELD_LABELS[f] || f)}<select data-mgf="${f}" class="cmpinput">
        <option value="">— not in this file —</option>
        ${a.headers.filter(Boolean).map((h) => `<option value="${esc(h)}"${C.map[f] === h ? " selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`;
    const nameOk = C.map.first_name || C.map.last_name || C.map.full_name || C.map.company || C.map.display_name;
    box.innerHTML = `
      <div class="cmpsect">
        <div class="lanehead"><span class="eyebrow">${esc(C.file?.name || "file")}${C.file?.ledgerSheet ? ` · ${esc(C.file.ledgerSheet)}` : ""}</span><b>${a.row_count.toLocaleString()} row${a.row_count === 1 ? "" : "s"}</b></div>
        <p>Found <b>${a.summary.customers}</b> customer${a.summary.customers === 1 ? "" : "s"}${a.kind === "vehicles" ? ` and <b>${a.summary.vehicles}</b> vehicle${a.summary.vehicles === 1 ? "" : "s"}` : ""}. ${a.summary.with_email} with an email, ${a.summary.with_phone} with a phone.${a.needs_review ? ` <b>${a.needs_review}</b> need a look after import.` : ""}</p>
        ${a.truncated ? `<p class="note err">Only the first 20,000 rows will import — split the file for the rest.</p>` : ""}
        ${nameOk ? "" : `<p class="note err">Pick which column holds the customer's name.</p>`}
        ${a.ambiguous_rows ? `<p class="note err">${a.ambiguous_rows} row${a.ambiguous_rows === 1 ? "" : "s"} (${esc((a.merge_preview || []).filter(r => r.ambiguous).map(r => r.line).slice(0, 20).join(", "))}${a.ambiguous_rows > 20 ? "…" : ""}) match more than one saved customer, so this import would stop without saving anything. Give those customers different emails, phones or Customer IDs, then check again.</p>` : ""}
      </div>
      <details ${nameOk ? "" : "open"}><summary class="eyebrow" style="cursor:pointer;margin:10px 0">Check the columns</summary>
        <div class="cmpsect">${fields.map(pick).join("")}</div></details>
      ${a.kept_in_notes?.length ? `<p class="note" style="margin:8px 0 0">Also kept on each customer, as notes: ${esc(a.kept_in_notes.slice(0, 8).join(", "))}${a.kept_in_notes.length > 8 ? "…" : ""}</p>` : ""}
      <div class="cmpsect"><div class="eyebrow">Preview</div>
        ${(a.preview || []).map((p) => `<div class="note" style="margin-top:6px">${p.customer ? esc(`${p.customer.first_name} ${p.customer.last_name}`.trim() + (p.customer.company ? ` · ${p.customer.company}` : "") + (p.customer.email ? ` · ${p.customer.email}` : "") + (p.customer.phone ? ` · ${p.customer.phone}` : "") + (p.customer.extras ? ` · ${p.customer.extras}` : "")) : "<i>no customer</i>"}${p.customer?.notes ? `<details><summary>All saved notes and extra fields</summary><pre style="white-space:pre-wrap">${esc(p.customer.notes)}</pre></details>` : ""}${p.vehicle ? esc(` — ${[p.vehicle.year, p.vehicle.make, p.vehicle.model].filter(Boolean).join(" ")}${p.vehicle.vin ? ` (${p.vehicle.vin})` : p.vehicle.plate ? ` (${p.vehicle.plate})` : ""}`) : ""}${p.issues.length ? ` <span style="color:var(--gold)">· ${esc(p.issues.join("; "))}</span>` : ""}</div>`).join("")}
      </div>
      ${(a.merge_preview || []).some(r=>r.existing) ? `<div class="cmpsect"><label>When uploaded values conflict<select id="mgmerge" class="cmpinput"><option value="keep"${C.mergeMode === "keep" ? " selected" : ""}>Keep saved values</option><option value="replace"${C.mergeMode === "replace" ? " selected" : ""}>Use uploaded nonblank values</option></select></label><p class="note">Blank cells never erase saved information. All original values stay in the import archive.</p><details><summary>Review repeat-upload changes</summary>${a.merge_preview.filter(r=>r.existing).map(r=>`<p class="note">Row ${r.line}</p>${r.changes.map(c=>`<p class="note">${esc(c.field)}: ${esc(c.status)} · saved: ${esc(String(c.previous ?? ""))} · uploaded: ${esc(String(c.incoming ?? ""))}</p>`).join("")}`).join("")}</details></div>` : ""}
      <button class="btn primary wide" id="mggo" ${C.busy || !nameOk || a.ambiguous_rows ? "disabled" : ""}>${C.busy ? (C.progress || "Importing…") : `Import ${a.summary.customers} customer${a.summary.customers === 1 ? "" : "s"}${a.kind === "vehicles" ? ` + ${a.summary.vehicles} vehicles` : ""}`}</button>
      <button class="linkbtn" id="mgback" style="margin-top:8px">Choose a different file</button>
      <p class="note" style="margin-top:8px">Already-known customers are matched by email, phone or name and never duplicated. Running the same file twice adds nothing; an import you undid can be imported again.</p>
      ${C.error ? `<p class="note err">${esc(C.error)}</p>` : ""}`;
    box.querySelectorAll("[data-mgf]").forEach((sel) => sel.onchange = async () => {
      C.map[sel.dataset.mgf] = sel.value;
      const seq = ++C.seq;
      C.busy = true; paint();
      try {
        const fresh = await api("/migrate/analyze", { csv: C.csv, file_name: C.file?.name, column_map: C.map, kind: a.kind });
        if (seq !== C.seq) return;   // a newer pick is already on its way
        C.analysis = fresh; C.map = { ...(fresh.map || {}) };
      }
      catch (e) { if (seq !== C.seq) return; C.error = e.message; }
      C.busy = false; paint();
    });
    box.querySelector("#mgback").onclick = () => { C.seq++; Object.assign(C, { file: null, csv: "", analysis: null, map: {}, error: "", busy: false }); paint(); };
    if(box.querySelector("#mgmerge")) box.querySelector("#mgmerge").onchange=e=>{C.mergeMode=e.target.value};
    box.querySelector("#mggo").onclick = async () => {
      C.busy = true; C.error = ""; C.progress = ""; paint();
      try {
        const body = { csv: C.csv, file_name: C.file?.name, column_map: C.map, kind: a.kind, merge_mode:C.mergeMode, source: (C.file?.name || "import").replace(/\.[^.]+$/, "").slice(0, 40), continuation: true };
        let r = await api("/migrate/import", body);
        // Continuation (12.6; server side owned by lane 05): a long QuickBooks
        // import answers in pages. A server that never says `partial` answers once.
        while (r && r.partial === true && Number.isInteger(r.next_cursor)) {
          if (Number.isInteger(r.processed) && Number.isInteger(r.total)) { C.progress = `Importing… ${r.processed} of ${r.total}`; paint(); }
          r = await api("/migrate/import", { ...body, cursor: r.next_cursor, import_id: r.import_id });
        }
        C.result = r; toast("Import finished");
      }
      catch (e) { C.error = e.message; }
      C.busy = false; C.progress = ""; paint();
    };
  };
  sheet(`<h2>Bring your data</h2><div id="mgbox"></div>`, () => paint());
}

function exportDataSheet() {
  sheet(`<h2>Export your data</h2>
    <p class="sh-sub">Choose a spreadsheet for everyday use or an exact-data archive. CSV text is made safe to open in spreadsheets; archives retain the original values. Archives are for portability, not a one-click whole-business restore.</p>
    <div class="cmpsect">
      <button class="btn primary wide" id="mgxc">Customers</button><button class="btn wide" id="mgxbusiness">Business records archive (ZIP)</button><button class="btn wide" id="mgxcat">Catalog &amp; import history archive</button><button class="btn wide" id="mgxhistory">Customer import originals &amp; recovery</button>
      <button class="btn wide" id="mgxv" style="margin-top:8px">Vehicles (with their customers)</button>
      <button class="btn wide" id="mgxi" style="margin-top:8px">Invoices &amp; payments</button>
    </div>
    <p class="note" id="mgxnote"></p>`, (sh) => {
    const note = sh.querySelector("#mgxnote");
    const run = async (kind, name) => {
      note.textContent = "Preparing…";
      try { const r = await api("/migrate/export", { kind }); downloadCsv(name, r.csv); note.textContent = `${r.count.toLocaleString()} ${kind} exported.`; }
      catch (e) { note.textContent = e.message; }
    };
    sh.querySelector("#mgxbusiness").onclick=async()=>{note.textContent="Preparing…";try{downloadBooksExport(await booksApi({action:"archive",include_receipt_links:true}));note.textContent="Business records archive prepared. See its manifest for coverage and exclusions; receipt photo links inside it expire in 12 hours."}catch(e){note.textContent=e.message}};
    sh.querySelector("#mgxcat").onclick=async()=>{note.textContent="Preparing…";try{const r=await api("/catalog",{action:"export"});downloadJson("ledger-catalog-archive.json",r.archive);note.textContent="Catalog, original values and retained versions exported."}catch(e){note.textContent=e.message}};
    sh.querySelector("#mgxhistory").onclick=importHistorySheet;
    sh.querySelector("#mgxc").onclick = () => run("customers", "ledger-customers.csv");
    sh.querySelector("#mgxv").onclick = () => run("vehicles", "ledger-vehicles.csv");
    sh.querySelector("#mgxi").onclick = async () => {
      note.textContent = "Preparing…";
      try {
        const ex = await booksApi({ action: "export" });
        downloadCsv("ledger-invoices.csv", ex.invoices_csv || ""); downloadCsv("ledger-invoice-lines.csv", ex.lines_csv || ""); downloadCsv("ledger-payments.csv", ex.payments_csv || "");
        note.textContent = "Invoices, invoice lines and payments exported as three files.";
      }
      catch (e) { note.textContent = e.message; }
    };
  });
}

// Phone OS — conversations first; the dock is stable while content changes.
function phoneOSIcon(key) {
 const paths={activity:'<path d="M8 3H4v4c0 7 6 13 13 13h4v-4l-5-2-2 2c-3-1-5-3-6-6l2-2z"/><path d="M15 3l6 6m0-6v6h-6"/>',inbox:'<path d="M21 11a9 9 0 0 1-9 9H4l-3 2 2-7a9 9 0 1 1 18-4Z"/><path d="M7 10h10M7 14h6"/>',autopilot:'<path d="M5 3v18M12 3v18M19 3v18"/><rect x="2" y="6" width="6" height="4" rx="2"/><rect x="9" y="14" width="6" height="4" rx="2"/><rect x="16" y="7" width="6" height="4" rx="2"/>',notifications:'<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M9 21h6"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',compose:'<path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M10 14l1-5 9-8 3 3-9 9z"/>',settings:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>'};
 return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]||paths.notifications}</svg>`;
}
function phoneMissed(d) { return (d.events||[]).filter(e=>e.direction!=="outgoing"&&!e.answered); }
function phoneNoticeRows(d) {
 const rows=(d.events||[]).map(e=>({id:'call:'+e.id,at:e.occurredAt,title:e.voicemailUrl?'Voicemail received':e.answered?'Call answered':'Missed call',detail:e.callerName||formatE164(e.callerNumber),kind:'activity',event:e}));
 for(const f of d.autopilotFeed||[]) if(!f.id.startsWith('ev:')&&!f.id.startsWith('review:')) rows.push({id:'auto:'+f.id,at:f.at,title:f.text,detail:({frontdesk:'Front Desk',reminders:'Appointment reminder',dispatcher:'Crew dispatch','crew-reminders':'Crew reminder'})[f.key]||'Automatic activity',kind:'autopilot',feed:f});
 for(const t of d.threads||[]) if(t.lastMessageDirection==='incoming')rows.push({id:'text:'+t.id+':'+t.lastMessageAt,at:t.lastMessageAt,title:'New text message',detail:t.peerName||formatE164(t.peerNumber),kind:'inbox',thread:t});
 for(const r of d.reviewRequests?.recent||[])rows.push({id:'review:'+r.id+':'+r.status,at:r.sent_at||r.created_at,title:'Google review request',detail:(r.customer_name||'Customer')+' · '+({sent:'Sent',queued:'Waiting',sending:'Sending',skipped:'Skipped',needs_check:'Check delivery'}[r.status]||r.status),kind:'autopilot',review:r});
 return rows.sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0));
}
function phoneNoticeUnread(d,n){return !(d.notificationReadIds||[]).includes(n.id);}
function phoneOSHeader(d) {
 const label=PHONE_LANES.find(([k])=>k===phoneLane())[1];
 return `<header class="pos-header"><button class="pos-back" id="pos-exit" aria-label="Back to Ledger">‹</button><div class="pos-brand"><div><span class="pos-eyebrow">PHONE DASHBOARD</span><h1>${label}</h1></div></div><div class="pos-header-actions">${phoneLane()==='inbox'?`<button class="pos-compose" id="pos-compose" aria-label="New text">${phoneOSIcon('compose')}</button>`:''}<button class="pos-circle" id="phsetup" aria-label="Line setup and forwarding">${phoneOSIcon('settings')}</button></div></header>
 <div class="pos-status"><span class="pos-status-dot"></span><span>${esc(formatE164(d.number?.e164))}</span><span class="pos-hours">${d.openNow?'Business hours':'After hours'}</span><button id="pos-refresh" aria-label="Refresh Phone">↻</button></div>`;
}

function phoneOSDock(d){
 const badges={activity:phoneMissed(d).length,inbox:d.inboxCounts?.unread??(d.threads||[]).filter(t=>t.status!=='done'&&t.unreadCount>0).length,notifications:phoneNoticeRows(d).filter(n=>phoneNoticeUnread(d,n)).length};
 return `<nav class="pos-dock" aria-label="Phone sections">${PHONE_LANES.map(([k,label])=>`<button data-plane="${k}" class="${phoneLane()===k?'selected':''}" aria-current="${phoneLane()===k?'page':'false'}" aria-label="${label}${badges[k]?', '+badges[k]+' unread':''}"><span class="pos-app-icon ${k}">${phoneOSIcon(k)}${badges[k]?`<b class="pos-badge">${badges[k]>99?'99+':badges[k]}</b>`:''}</span><span>${label}</span></button>`).join('')}</nav>`;
}
function phoneTextsDashboard(d){
 const f=S.phoneFilter||'all';const threads=d.threads||[];const counts={all:d.inboxCounts?.all??threads.filter(t=>t.status!=='done').length,unread:d.inboxCounts?.unread??threads.filter(t=>t.status!=='done'&&t.unreadCount>0).length,missed:phoneMissed(d).length,done:d.inboxCounts?.done??threads.filter(t=>t.status==='done').length};
 return ` <label class="pos-search">${phoneOSIcon('search')}<input id="pos-search" type="search" autocomplete="off" placeholder="Search names, numbers or messages" value="${esc(S.phoneSearch||'')}" aria-label="Search conversations"></label>
 <div class="pos-filters" role="tablist" aria-label="Conversation filters">${[['all','All'],['unread','Unread'],['missed','Missed Calls'],['done','Done']].map(([k,v])=>`<button role="tab" data-pfilter="${k}" aria-selected="${f===k}">${v}${counts[k]?`<span>${counts[k]}</span>`:''}</button>`).join('')}</div>
 <div id="pos-threads">${phoneConversationRows(d)}</div>`;
}
function phoneAvatar(name,number){const words=(name||'').trim().split(/\s+/);return `<span class="pos-avatar ${name?'named':''}">${name?esc(words.map(w=>w[0]).slice(0,2).join('').toUpperCase()):'<svg viewBox="0 0 40 40" fill="currentColor" aria-hidden="true"><circle cx="20" cy="14" r="7"/><path d="M6 36a14 14 0 0 1 28 0"/></svg>'}</span>`;}
function phoneConversationRows(d){
 const filter=S.phoneFilter||'all',q=(S.phoneSearch||'').toLowerCase();
 if(filter==='missed')return phoneCallRows(d,q);
 const rows=(S.phoneInboxRows||d.threads||[]).filter(t=>(filter==='done'?t.status==='done':t.status!=='done')&&(filter!=='unread'||t.unreadCount>0)&&[t.peerName,t.caller?.name,t.peerNumber,t.lastMessagePreview].join(' ').toLowerCase().includes(q));
 return rows.length?`<div class="pos-conversations">${rows.map(t=>{const name=t.caller?.name||t.peerName;const unread=t.unreadCount>0&&t.status!=='done';return `<button class="pos-conversation ${unread?'unread':''}" data-pthread="${esc(t.id)}">${phoneAvatar(name,t.peerNumber)}<span class="pos-conversation-body"><span class="pos-conversation-top"><strong>${esc(name||formatE164(t.peerNumber))}</strong><time>${esc(t.lastMessageAt?dayLabel(t.lastMessageAt)==='Today'?timeLabel(t.lastMessageAt):dayLabel(t.lastMessageAt):'')}</time></span><span class="pos-preview">${esc((t.lastMessageDirection==='outgoing'?(t.answeredBy==='front-desk'?'Ledger: ':t.answeredBy==='user'?'You: ':t.answeredBy?'Auto: ':'Sent: '):'')+(t.lastMessagePreview||'No messages yet'))}</span><span class="pos-conversation-state">${t.status==='done'?'✓ Done':t.answeredBy==='front-desk'?'✦ Ledger replied':unread?'Needs your attention':''}</span></span>${unread?`<b class="pos-count">${t.unreadCount}</b>`:'<span class="pos-chevron">›</span>'}</button>`}).join('')}</div>${S.phoneInboxMore?'<button class="btn ghost" id="pos-more">Load more conversations</button>':''}`:`<div class="pos-empty">${phoneOSIcon('inbox')}<h3>${q?'No matching conversations':filter==='done'?'No completed conversations':filter==='unread'?'You’re all caught up':'Your conversations start here'}</h3><p>${q?'Try another name, number or message.':filter==='done'?'Mark a conversation Done once it’s handled. A new customer message brings it back.':filter==='unread'?'New unread messages will appear here.':'Texts to your business number appear here. Open a conversation to read the full history and reply.'}</p></div>`;
}
function phoneCallRows(d,q=''){
 const rows=phoneMissed(d).filter(e=>[e.callerName,e.callerNumber].join(' ').toLowerCase().includes(q));
 return rows.length?`<div class="pos-conversations">${rows.map(e=>`<button class="pos-conversation" data-pevt="${esc(e.id)}">${phoneAvatar(e.callerName,e.callerNumber)}<span class="pos-conversation-body"><span class="pos-conversation-top"><strong>${esc(e.callerName||formatE164(e.callerNumber))}</strong><time>${esc(timeLabel(e.occurredAt))}</time></span><span class="pos-missed">↙ ${e.voicemailUrl?'Voicemail':'Missed call'}</span><span class="pos-preview">${esc(dayLabel(e.occurredAt))} · ${e.autoReplySent?'Automatic text-back sent':'No automatic text-back sent'}</span></span><span class="pos-chevron">›</span></button>`).join('')}</div>`:'<div class="pos-empty"><h3>No missed calls</h3><p>Missed calls that reach your Ledger line will appear here, with the outcome and a callback shortcut.</p></div>';
}
function phoneCallsDashboard(d){return `<div class="pos-section-title"><h2>Missed Calls <span>${phoneMissed(d).length}</span></h2><p>See who called and what happened next.${(d.events||[]).length>=100?' Showing the latest 100 calls.':''}</p></div>${phoneCallRows(d)}<div id="vmlane"></div>`;}
function phoneNotificationsDashboard(d){const all=phoneNoticeRows(d),rows=S.phoneNotificationFilter==='unread'?all.filter(n=>phoneNoticeUnread(d,n)):all;return `<button class="pos-explainer" id="pos-how"><span class="pos-app-icon notifications">${phoneOSIcon('notifications')}</span><span><strong>What happens when your line is forwarded?</strong><small>Follow the journey—from call to conversation.</small></span><b>›</b></button><div class="pos-inbox-top"><h2>Recent activity</h2><button class="pos-textbutton" id="pos-mark-all">Mark all read</button></div><div class="pos-filters" role="tablist" aria-label="Notification filters">${['all','unread'].map(k=>`<button data-nfilter="${k}" role="tab" aria-selected="${(S.phoneNotificationFilter||'all')===k}">${k==='all'?'All activity':'Unread'}</button>`).join('')}</div><div class="pos-conversations">${rows.map(n=>`<button class="pos-notification ${phoneNoticeUnread(d,n)?'unread':''}" data-pnotice="${esc(n.id)}"><span class="pos-notice-icon ${n.kind}">${phoneOSIcon(n.kind)}</span><span><strong>${esc(n.title)}</strong><p>${esc(n.detail)}</p><small>${esc(n.at?dayLabel(n.at)+' · '+timeLabel(n.at):'')}</small></span><span class="pos-chevron">›</span></button>`).join('')||'<div class="pos-empty"><h3>No new activity</h3><p>Call outcomes, messages and automatic actions will appear here. Each notification opens the details.</p></div>'}</div>`;}
function phoneHowSheet(d){sheet(`<div class="pos-detail"><span class="pos-eyebrow">YOUR FORWARDED LINE</span><h2>From ringing phone to real conversation.</h2><p>Your forwarding choice controls which calls reach Ledger. Ledger can only show calls and texts that reach your assigned business number.</p><ol><li><strong>Your carrier forwards the call</strong><p>Conditional forwarding sends unanswered or busy calls; full forwarding sends every call. Your carrier’s setup determines which happens.</p></li><li><strong>The call outcome is recorded</strong><p>Open Missed Calls to see who called, when, whether voicemail was left, and whether an automatic text-back was sent.</p></li><li><strong>Your chosen commands respond</strong><p>Auto text-back is ${d.autoReplyEnabled?'on':'off'}. Front Desk is ${d.frontDesk?.enabled?'on':'off'}. Enabled commands still depend on your plan, texting allowance, contact preferences and delivery availability. Forwarding by itself does not mean AI voice answering is active.</p></li><li><strong>The conversation stays visible</strong><p>Replies to your Ledger number appear in Texts. Calls forwarded from another number do not automatically forward that number’s existing SMS messages. Keep checking that original inbox too.</p></li><li><strong>You stay in control</strong><p>Open a notification for the outcome, answer in Texts, or adjust Commands. A sent text is not proof that the customer read it.</p></li></ol></div>`);}
function phoneNoticeSheet(d,n){
 let happened='',action='',next='',extra='';
 if(n.event){const e=n.event;happened=`${e.callerName||formatE164(e.callerNumber)} reached your Ledger line. ${e.answered?'The call was answered.':'The call was not answered.'}${e.voicemailUrl?' A voicemail was recorded.':''}`;action=e.autoReplySent?'Ledger recorded an automatic text-back as sent. Carrier acceptance does not prove the customer received or read it.':'No automatic text-back is recorded for this call. This event alone does not establish why; check Commands and the conversation before following up.';next=e.autoReplySent?'Open the conversation for any customer response. Call back if they still need help.':'Review the call and any voicemail, then call or text the customer if needed.';extra=e.autoReplyText?`<blockquote>${esc(e.autoReplyText)}</blockquote>`:'';}
 else if(n.thread){happened='A customer text reached your business number.';action=n.thread.answeredBy==='front-desk'?'Front Desk replied in this conversation.':'The message is saved in Texts. Open it to see the full conversation, including any later replies.';next='Read the conversation and reply if needed. Mark it Done when it is handled; a new incoming message reopens it.';extra=`<blockquote>${esc(n.thread.lastMessagePreview||'')}</blockquote>`;}
 else if(n.review){happened=`A paid-invoice review request for ${n.review.customer_name||'a customer'} is ${n.review.status.replaceAll('_',' ')}.`;action=n.review.reason||'Review requests follow your enabled command, contact preferences, business time zone and texting allowance.';next='Open Google Review Request for the request history and current settings.';}
 else{happened=n.feed?.text||n.title;action=({frontdesk:'Front Desk recorded this outcome while handling a text conversation. A handoff means the owner should review the conversation.',reminders:'The appointment reminder was recorded in the activity log. Check the booking for confirmation or changes.',dispatcher:'The crew dispatch was recorded in the activity log. A sent message does not by itself prove the job was accepted.','crew-reminders':'The crew reminder was recorded in the activity log. Check the timecard or shift for the latest status.'})[n.feed?.key]||'This action was recorded on your business line.';next='Open the related command to review its activity and settings.';}
 const wrap=sheet(`<div class="pos-detail"><span class="pos-eyebrow">LINE ACTIVITY · ${esc(n.at?dayLabel(n.at)+' '+timeLabel(n.at):'')}</span><h2>${esc(n.title)}</h2><h3>What happened</h3><p>${esc(happened)}</p><h3>What Ledger did</h3><p>${esc(action)}</p>${extra}<h3>What you should do</h3><p>${esc(next)}</p><button class="btn primary" id="pos-notice-open">${n.event?'Open call details':n.thread?'Open conversation':'Open command'}</button><button class="btn ghost" id="pos-notice-help">How forwarding works</button></div>`);
 wrap.querySelector('#pos-notice-open').onclick=()=>{closeSheet();if(n.event)phoneEventSheet(n.event);else if(n.thread)phoneThreadSheet(n.thread);else openAutomation(d,n.review?'google-review-request':n.feed?.key||'frontdesk');};
 wrap.querySelector('#pos-notice-help').onclick=()=>phoneHowSheet(d);
 if(phoneNoticeUnread(d,n))api('/phone',{action:'notifications-read',ids:[n.id]}).then(()=>{d.notificationReadIds=[...(d.notificationReadIds||[]),n.id];if(S.tab==='phone')renderPhone(d);}).catch(()=>toast('Could not mark this notification read. Try again.'));
}
function wirePhoneThreadRows(d){on('[data-pthread]','click',e=>phoneThreadSheet((S.phoneInboxRows||d.threads||[]).find(t=>t.id===e.currentTarget.dataset.pthread)));on('[data-pevt]','click',e=>phoneEventSheet(d.events.find(t=>t.id===e.currentTarget.dataset.pevt)));if($('pos-more'))$('pos-more').onclick=()=>phoneLoadInbox(d,true);}
async function phoneLoadInbox(d,more=false){const seq=S.phoneInboxRequest=(S.phoneInboxRequest||0)+1,filter=S.phoneFilter||'all',search=S.phoneSearch||'';if(filter==='missed')return;try{const r=await api('/phone',{action:'threads',filter,search,offset:more?(S.phoneInboxRows||[]).length:0,limit:50});if(seq!==S.phoneInboxRequest||S.tab!=='phone'||phoneLane()!=='inbox'||!$('pos-threads'))return;S.phoneInboxRows=more?[...(S.phoneInboxRows||[]),...r.threads.filter(t=>!(S.phoneInboxRows||[]).some(x=>x.id===t.id))]:r.threads;S.phoneInboxMore=r.hasMore;d.threads=[...(d.threads||[]).filter(t=>!r.threads.some(x=>x.id===t.id)),...r.threads];$('pos-threads').innerHTML=phoneConversationRows(d);wirePhoneThreadRows(d);}catch(e){if(seq===S.phoneInboxRequest&&$('pos-threads'))$('pos-threads').innerHTML='<div class="note err">'+esc(e.message)+' <button class="btn ghost" id="pos-retry">Retry</button></div>';if($('pos-retry'))$('pos-retry').onclick=()=>phoneLoadInbox(d,more);}}
function wirePhoneOS(d){
 if($("pos-exit"))$("pos-exit").onclick=()=>setTab("home");
 if($('pos-refresh'))$('pos-refresh').onclick=()=>{S.phoneInboxRows=null;renderPhone();};
 if(phoneLane()==='inbox'){
  on('[data-pfilter]','click',e=>{S.phoneFilter=e.currentTarget.dataset.pfilter;S.phoneInboxRows=null;S.phoneInboxMore=false;S.phoneInboxRequest=(S.phoneInboxRequest||0)+1;renderPhone(d);});
  if($('pos-search'))$('pos-search').oninput=e=>{S.phoneSearch=e.target.value;S.phoneInboxRequest=(S.phoneInboxRequest||0)+1;S.phoneInboxRows=null;$('pos-threads').innerHTML=phoneConversationRows(d);wirePhoneThreadRows(d);clearTimeout(S.phoneSearchTimer);S.phoneSearchTimer=setTimeout(()=>phoneLoadInbox(d),250);};
  if($('pos-compose'))$('pos-compose').onclick=()=>phoneComposeSheet(d);
  wirePhoneThreadRows(d);
  phoneLoadInbox(d);
 }
 if($('pos-how'))$('pos-how').onclick=()=>phoneHowSheet(d);
 on('[data-nfilter]','click',e=>{S.phoneNotificationFilter=e.currentTarget.dataset.nfilter;renderPhone(d);});
 on('[data-pnotice]','click',e=>phoneNoticeSheet(d,phoneNoticeRows(d).find(n=>n.id===e.currentTarget.dataset.pnotice)));
 if($('pos-mark-all'))$('pos-mark-all').onclick=async()=>{try{const ids=phoneNoticeRows(d).map(n=>n.id);await api('/phone',{action:'notifications-read',ids});d.notificationReadIds=ids;renderPhone(d);}catch(e){toast(friendlyError(e, "Couldn't mark those notices read. Try again."));}};
}
function phoneComposeSheet(d){const wrap=sheet('<h2>New text</h2><p class="sh-sub">Send from your business number.</p><label class="field"><span>To</span><input id="pos-to" type="tel" placeholder="+1 555 555 0123"></label><label class="field"><span>Message</span><textarea id="pos-new-body" rows="4" placeholder="Write a message…"></textarea></label><p class="note err" id="pos-send-error"></p><button class="btn primary" id="pos-send-new">Send text</button>');wrap.querySelector('#pos-send-new').onclick=async e=>{const to=wrap.querySelector('#pos-to').value.trim(),body=wrap.querySelector('#pos-new-body').value.trim();if(!to||!body){wrap.querySelector('#pos-send-error').textContent='Enter a phone number and a message.';return;}e.currentTarget.disabled=true;try{await api('/phone',{action:'reply',to_number:to,body});closeSheet();S.phoneInboxRows=null;await renderPhone();}catch(ex){wrap.querySelector('#pos-send-error').textContent=ex.message;e.target.disabled=false;smsSendFailed(ex);}};}

setInterval(async()=>{
 if(S.tab!=="phone"||phonePendingSave||document.hidden||document.querySelector("#sheetwrap")||document.activeElement?.id==="pos-search"||view()?.scrollTop>100)return;
 const revision=S.phoneRequest;
 try { const d=await api("/phone",{action:"board"});
  if(S.tab!=="phone"||phonePendingSave||revision!==S.phoneRequest||document.querySelector("#sheetwrap")||document.activeElement?.id==="pos-search"||view()?.scrollTop>100)return;
  await renderPhone(d);
 } catch (_) {}
},20000);

async function schedulingResourcesSheet() {
 const sh=sheet('<h2>Staff & resource availability</h2><p class="note">Each named resource has its own capacity, supported services, hours and time off. Crew dispatch is separate.</p><div id="resources"><p role="status">Loading…</p></div>');
 try {const r=await api('/google-calendar/resources',{});if(!sh.isConnected)return;const box=sh.querySelector('#resources');box.innerHTML=(r.resources||[]).map(x=>`<button class="btn wide" data-resource="${esc(x.id)}">${esc(x.name)} · capacity ${x.capacity}${x.active?'':' · inactive'}</button>`).join('')+'<button class="btn primary wide" id="resource-new">Add staff member or resource</button>';box.querySelectorAll('[data-resource]').forEach(b=>b.onclick=()=>schedulingResourceEditor(r.resources.find(x=>x.id===b.dataset.resource)));box.querySelector('#resource-new').onclick=()=>schedulingResourceEditor();}
 catch(e){sh.querySelector('#resources').textContent=e.message;}
}
async function schedulingResourceEditor(existing=null) {
 const days=['mon','tue','wed','thu','fri','sat','sun'];let services=[];
 try{services=(await booksApi({action:'shortcuts'})).shortcuts||[]}catch(e){toast(friendlyError(e, "Couldn't load your service shortcuts. Try again."),'err');return}
 const r=existing||{name:'',capacity:1,active:true,services:[],working_hours:{},time_off:[]};const off=[...r.time_off];
 const custom=Object.keys(r.working_hours||{}).length>0;
 const sh=sheet(`<h2>${existing?'Edit resource':'New resource'}</h2><label class="emailrow">Name<input id="rs-name" class="cmpinput" value="${esc(r.name)}"></label><label class="emailrow">Capacity<input id="rs-cap" class="cmpinput" type="number" min="1" max="100" value="${r.capacity}"></label><label class="resource-option"><input id="rs-active" type="checkbox"${r.active?' checked':''}> Available for new appointments</label>
 <h3>Working hours · business local time</h3><label class="resource-option"><input id="rs-custom" type="checkbox"${custom?' checked':''}> Use individual working hours</label><p class="note">Otherwise the business's opening hours apply.</p><div id="rs-hours">${days.map(d=>`<div class="resource-hours-row"><label class="resource-option"><input type="checkbox" data-rs-day="${d}"${r.working_hours?.[d]?' checked':''}> ${d.toUpperCase()}</label><input type="time" data-rs-open="${d}" value="${esc(r.working_hours?.[d]?.open||'09:00')}"><span>to</span><input type="time" data-rs-close="${d}" value="${esc(r.working_hours?.[d]?.close||'17:00')}"></div>`).join('')}</div>
 <h3>Supported services</h3><p class="note">Leave all unchecked to accept any service.</p>${services.map(s=>`<label class="resource-option"><input type="checkbox" data-rs-skill="${esc(s.id)}"${r.services.includes(s.id)?' checked':''}> ${esc(s.name)}</label>`).join('')}
 <h3>Time off · your device's local time</h3><div id="rs-off"></div><label>From<input id="rs-from" class="cmpinput" type="datetime-local"></label><label>Until<input id="rs-until" class="cmpinput" type="datetime-local"></label><button class="btn" id="rs-add-off">Add time off</button><p class="note err" id="rs-error"></p><button class="btn primary wide" id="rs-save">Save resource</button>`);
 const paintOff=()=>{sh.querySelector('#rs-off').innerHTML=off.map((t,i)=>`<p class="note">${esc(new Date(t.start).toLocaleString())} to ${esc(new Date(t.end).toLocaleString())} <button data-rs-remove="${i}">Remove</button></p>`).join('');sh.querySelectorAll('[data-rs-remove]').forEach(b=>b.onclick=()=>{off.splice(Number(b.dataset.rsRemove),1);paintOff()})};paintOff();
 const toggleHours=()=>{sh.querySelector('#rs-hours').hidden=!sh.querySelector('#rs-custom').checked};sh.querySelector('#rs-custom').onchange=toggleHours;toggleHours();
 sh.querySelector('#rs-add-off').onclick=()=>{const a=new Date(sh.querySelector('#rs-from').value),b=new Date(sh.querySelector('#rs-until').value);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||b<=a){sh.querySelector('#rs-error').textContent='Choose a valid start and later end.';return}off.push({start:a.toISOString(),end:b.toISOString()});paintOff()};
 sh.querySelector('#rs-save').onclick=async e=>{const button=e.currentTarget;button.disabled=true;sh.querySelector('#rs-error').textContent='';const hours={};if(sh.querySelector('#rs-custom').checked)for(const d of days)hours[d]=sh.querySelector(`[data-rs-day="${d}"]`).checked?{open:sh.querySelector(`[data-rs-open="${d}"]`).value,close:sh.querySelector(`[data-rs-close="${d}"]`).value}:null;
 try{await api('/google-calendar/resource-save',{id:existing?.id,name:sh.querySelector('#rs-name').value,capacity:Number(sh.querySelector('#rs-cap').value),active:sh.querySelector('#rs-active').checked,working_hours:hours,time_off:off,services:[...sh.querySelectorAll('[data-rs-skill]:checked')].map(x=>x.dataset.rsSkill)});toast('Resource saved');schedulingResourcesSheet()}catch(error){sh.querySelector('#rs-error').textContent=error.message;button.disabled=false}};
}

function downloadJson(filename,value) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
 const link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function importHistorySheet() {
 sheet(`<h2>Import history &amp; recovery</h2><p class="note">Download original values and row exceptions. Customer-only imports can be undone if no later edits or linked records would be lost. Vehicle and QuickBooks imports need record-by-record review.</p><div id="ihrows">Loading…</div>`,async sh=>{
 const slot=sh.querySelector("#ihrows");
 try {const r=await api("/migrate/history",{});slot.innerHTML=(r.imports||[]).map(i=>`<div class="cmpsect"><b>${esc(i.file_name||"Import")}</b><p class="note">${esc(new Date(i.created_at).toLocaleString())} · ${i.row_count} rows${i.undone_at ? " · Undone" : ""}</p>${i.vehicles_error ? `<p class="note err">Customers were saved but vehicles were not: ${esc(i.vehicles_error)} Import the same file again to finish.</p>` : ""}<button class="btn" data-original="${i.id}">Download original &amp; exceptions</button>${i.can_undo ? `<button class="btn ghost" data-undo="${i.id}">Undo this import</button>` : ""}<p class="note" data-result="${i.id}"></p></div>`).join("") || '<p class="note">No imports yet.</p>';
 slot.querySelectorAll("[data-original]").forEach(btn=>btn.onclick=async()=>{btn.disabled=true;try{const data=await api("/migrate/original",{import_id:btn.dataset.original});downloadJson("ledger-import-original.json",data.archive)}catch(e){slot.querySelector(`[data-result="${btn.dataset.original}"]`).textContent=e.message}finally{btn.disabled=false}});
 slot.querySelectorAll("[data-undo]").forEach(btn=>btn.onclick=async()=>{if(!(await askConfirm("Ledger will refuse if later changes or linked records would be lost.",{title:"Undo the customer changes from this import?",ok:"Undo import",danger:true})))return;btn.disabled=true;try{await api("/migrate/undo",{import_id:btn.dataset.undo});toast("Import undone");importHistorySheet()}catch(e){slot.querySelector(`[data-result="${btn.dataset.undo}"]`).textContent=e.message;btn.disabled=false}});
 }catch(e){slot.textContent=e.message;}
 });
}
function catalogHistorySheet(source) {
 sheet(`<h2>${esc(source.name)} — history</h2><p class="note">Restore a previous version as the current list. The current version remains in history. Service restores also update the linked service menu.</p><div id="chrows">Loading…</div>`,async sh=>{
 const slot=sh.querySelector("#chrows");
 try {const r=await api("/catalog",{action:"history",source_id:source.id});slot.innerHTML=(r.versions||[]).map(v=>`<div class="cmpsect"><b>Version ${v.revision}</b><p class="note">${esc(new Date(v.created_at).toLocaleString())}</p>${v.revision===source.revision ? '<p>Current version</p>' : `<button class="btn" data-restore="${v.revision}">Restore this version</button>`}</div>`).join("")||"No retained versions yet.";
 slot.querySelectorAll("[data-restore]").forEach(btn=>btn.onclick=async()=>{if(!(await askConfirm("The current version stays in history.",{title:"Restore this version?",ok:"Restore",danger:true})))return;btn.disabled=true;try{await api("/catalog",{action:"restore",source_id:source.id,revision:Number(btn.dataset.restore),expected_revision:source.revision,request_id:crypto.randomUUID()});toast("Version restored");catalogImportSheet(source.import_type||"products")}catch(e){toast(friendlyError(e, "Couldn't restore that version. Nothing changed — try again."), "err");btn.disabled=false}});
 }catch(e){slot.textContent=e.message;}
 });
}

function phoneGuidedDemo(){
 let step=0,choice="booking";
 const paint=()=>{const b=document.querySelector("#pdcontent");if(!b)return;
 const stages=[
 `<h3>A customer calls while you are busy</h3><p>The sample business misses Alex's call. With auto-text enabled, Ledger sends the owner's saved reply.</p><blockquote>Thanks for calling Example Services. Sorry we missed you — what can we help with?</blockquote><button class="btn primary" id="pdnext">See the customer's reply</button>`,
 `<h3>The conversation continues</h3><p>Choose a sample reply. These are scripted examples, not answers from your own business.</p><button class="btn" data-choice="booking">I would like an appointment</button> <button class="btn" data-choice="human">I need to speak to the owner</button>`,
 choice==="booking" ? `<h3>Front Desk checks before offering a time</h3><blockquote>Alex: I would like a consultation.</blockquote><p>In this sample, the saved service takes 30 minutes and the calendar has an opening. Front Desk collects the required contact details, offers a real available time, and waits for the customer's agreement.</p><blockquote>Alex: Tuesday at 10 works for me.</blockquote><button class="btn primary" id="pdnext">See the outcome</button>` : `<h3>A person takes over</h3><p>A request needing human judgment goes to Needs you. The owner can open the conversation and reply directly; Front Desk does not invent an answer.</p><button class="btn primary" id="pdnext">See the outcome</button>`,
 `<h3>${choice==="booking" ? "A reviewed booking" : "A clear handoff"}</h3><p>${choice==="booking" ? "The live service checks the slot again before confirming. If it was taken, it offers another time. The owner sees the appointment and conversation." : "The owner sees the customer's message and the reason help is needed."}</p><p><b>Nothing was sent or saved in this walkthrough.</b> Live calling/texting needs a paid subscription and provider activation. Front Desk is a Pro feature. This sample does not test carrier delivery or your business's setup.</p><button class="btn" id="pdreset">Try again</button>`];b.innerHTML=stages[step];
 b.querySelectorAll("[data-choice]").forEach(x=>x.onclick=()=>{choice=x.dataset.choice;step=2;paint()});if(b.querySelector("#pdnext"))b.querySelector("#pdnext").onclick=()=>{step++;paint()};if(b.querySelector("#pdreset"))b.querySelector("#pdreset").onclick=()=>{step=0;paint()};};
 sheet(`<h2>Phone walkthrough</h2><p class="eyebrow">SCRIPTED SAMPLE · NO LIVE ACTIVITY</p><div id="pdcontent" aria-live="polite"></div>`,paint);
}

function firstWorkingDaySheet(){
 sheet(`<h2>Your first working day</h2><p class="note">Start with a small representative import. Check saved contacts, prices, taxes and availability, then create one invoice and appointment. Try the phone sample and review the business-fit guide before subscribing.</p><div id="first-steps">Checking saved setup…</div><p><a href="/business-fit.html" target="_blank" rel="noopener">Business-fit guide</a></p>`,async sh=>{
 const slot=sh.querySelector("#first-steps");try{const r=await api("/workspace-profile",{action:"readiness"});slot.innerHTML=r.steps.map(s=>`<button class="btn wide" data-first="${s.id}" style="margin:7px 0;text-align:left">${s.done ? "✓" : "○"} ${esc(s.title)}</button>`).join("")+`<p class="note">${esc(r.note)}</p><button class="btn wide" id="first-staff">Staff, resource capacity &amp; time off</button><button class="btn wide" id="first-demo">Try the phone walkthrough</button>`;
 const actions={profile:()=>shopProfileSheet(),customers:bringDataSheet,services:()=>catalogImportSheet("services"),tax:()=>booksSettingsSheet(),invoice:()=>r.provider === "native" ? nativeComposerSheet() : composerSheet("invoice"),booking:()=>bookingSheet()};
 slot.querySelectorAll("[data-first]").forEach(btn=>btn.onclick=()=>actions[btn.dataset.first]());slot.querySelector("#first-staff").onclick=schedulingResourcesSheet;slot.querySelector("#first-demo").onclick=phoneGuidedDemo;
 }catch(e){slot.textContent=e.message;const retry=document.createElement("button");retry.className="btn";retry.textContent="Retry";retry.onclick=firstWorkingDaySheet;slot.append(retry);}});
}
