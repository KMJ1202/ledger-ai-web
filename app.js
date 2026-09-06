// Ledger AI — web/PWA client.
// One file, no build step: GitHub Pages serves it straight. Every screen talks to the
// same Supabase edge functions the iOS app uses, so there is no second backend to keep in sync.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = "https://lbzkyyehmgudlxmfpzzh.supabase.co";
const SUPA_KEY = "sb_publishable_I0BQ5Rkc2GCxKOlobtzCNg_GxAtNuPu";
const supa = createClient(SUPA_URL, SUPA_KEY);
const FN = SUPA_URL + "/functions/v1";
const root = document.getElementById("root");

const S = {
  tab: "home",
  advisor: localStorage.getItem("ledger.advisor") === "1",
  conversationId: localStorage.getItem("ledger.conv") || null,
  usage: null,
  profile: null,
  currency: "CAD",
  qbo: null, cal: null, receipts: null, emails: null, board: null, profit: null, team: null,
  qboStale: false, profitStale: false,
  lane: "directory",
  invoiceFilter: "all",
  profitRange: "daily",
  installPrompt: null,
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installPrompt = e; });

/* ---------------- helpers ---------------- */
const esc = (s) => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; };
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

async function token() { const { data } = await supa.auth.getSession(); return data.session?.access_token ?? null; }

async function api(path, body, method = "POST") {
  const t = await token(); if (!t) throw new Error("Signed out");
  const r = await fetch(FN + path, {
    method,
    headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Callers that need more than the message — a 409's match list, a 402's
    // billing state, an "already posted" doc_number — read it off the error.
    const err = new Error(d.message || d.error || ("Request failed (" + r.status + ")"));
    err.status = r.status; err.data = d;
    if (d.matches) err.matches = d.matches;
    // Real paywall (2026-09-05): the server refused a write because the
    // subscription is paused. One handler updates the banner so the customer
    // sees why, whatever screen they were on.
    if (r.status === 402 && d.code === "subscription_required") paywallHit(d);
    throw err;
  }
  return d;
}
const get = (path) => api(path, null, "GET");

function toast(text, kind) {
  const old = $("toast"); if (old) old.remove();
  const t = document.createElement("div"); t.id = "toast";
  t.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom) + 88px);background:" +
    (kind === "err" ? "#7f1d1d" : "#134e4a") + ";color:#fff;padding:11px 16px;border-radius:13px;font-size:14px;z-index:60;max-width:88%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.5)";
  t.textContent = text; document.body.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

/* ---------------- bottom sheet ---------------- */
function sheet(html, wire) {
  closeSheet();
  const wrap = document.createElement("div"); wrap.id = "sheetwrap";
  wrap.innerHTML = `<div class="sheet-back"></div><div class="sheet"><div class="grab"></div>
    <div class="kbbar"><button class="kbdone" type="button">Done</button></div>${html}
    <button class="sheet-close">Close</button></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector(".sheet-back").onclick = closeSheet;
  wrap.querySelector(".sheet-close").onclick = closeSheet;
  // Keyboard escape hatch (Kyle, 2026-08-24 — got trapped on the Phone tab).
  // The sheet's own Close button sits below the keyboard once it opens, so a
  // sticky Done bar rides the top of the sheet the whole time a field is
  // focused. Scrolling the sheet also dismisses, matching iOS.
  const pane = wrap.querySelector(".sheet");
  wrap.querySelector(".kbdone").onclick = () => blurInput();
  pane.addEventListener("focusin", (e) => { if (isTextInput(e.target)) wrap.classList.add("kbon"); });
  pane.addEventListener("focusout", () => setTimeout(() => {
    if (!isTextInput(document.activeElement)) wrap.classList.remove("kbon");
  }, 60));
  pane.addEventListener("scroll", () => { if (isTextInput(document.activeElement)) blurInput(); }, { passive: true });
  if (wire) wire(pane);
  return wrap;
}

const isTextInput = (el) => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
function blurInput() { if (isTextInput(document.activeElement)) document.activeElement.blur(); }

// Tap anywhere that is not itself a field and the keyboard closes. One global
// listener rather than per-form wiring, so a field added later can never ship
// without an escape hatch.
document.addEventListener("pointerdown", (e) => {
  if (!isTextInput(document.activeElement)) return;
  if (e.target === document.activeElement) return;
  if (e.target.closest && e.target.closest("input,textarea,select,label")) return;
  blurInput();
}, true);
function closeSheet() {
  const w = $("sheetwrap"); if (!w) return;
  // Removing a sheet that still holds the focused field fires blur mid-removal
  // and Chrome throws NotFoundError; blur first, and never let a stale node throw.
  if (w.contains(document.activeElement)) { try { document.activeElement.blur(); } catch {} }
  try { w.remove(); } catch { if (w.parentNode) try { w.parentNode.removeChild(w); } catch {} }
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
  profit: `<path d="M3 17l5-5 4 3 8-8M20 7h-5M20 7v5"/>`,
  receipts: `<path d="M7 3h10a1 1 0 011 1v16l-3-1.6L12 20l-3-1.6L6 20V4a1 1 0 011-1zM9 8h6M9 12h6"/>`,
  directory: `<circle cx="9" cy="8" r="3"/><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5M15 5a3 3 0 010 6M17 14c1.9.6 3 2.3 3 5"/>`,
  reviews: `<path d="M4 5h16v11H9l-5 4V5zM12 7.5l1 2.2 2.4.2-1.8 1.6.5 2.3-2.1-1.2-2.1 1.2.5-2.3-1.8-1.6 2.4-.2z"/>`,
  todos: `<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>`,
  inbox: `<path d="M4 4h16v16H4zM4 14h5c0 1.7 1.3 3 3 3s3-1.3 3-3h5"/>`,
  autopilot: `<path d="M13 2L5 13h5l-1 9 8-11h-5l1-9z"/>`,
  activity: `<path d="M3 12h2l2-6 3 12 3-9 2 3h6"/>`,
  card: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M6 15h4"/>`,
  phonearrow: `<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2zM14 4h6M20 4v6M20 4l-6 6"/>`,
  calclock: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4M12 13v3l2 1"/>`,
  camera: `<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>`,
  pulse: `<path d="M3 12h3l2-5 3 10 2-5h8"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`,
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
    <button class="qsparkle" data-qledger title="Chat with Ledger">${segIc("spark")}</button>
    <h2 class="qtitle">${esc(title)}</h2>
  </div>`;
}
// Delegated once at load — the four quiet tabs re-render their whole view()
// innerHTML on every load/refresh, so a per-render wire-up would need to run
// after each one. A single document-level listener survives every re-render.
document.addEventListener("click", (e) => { if (e.target.closest("[data-qledger]")) openChat(); });

function appView() {
  const logo = S.profile?.business?.logo_url;
  root.innerHTML = `
  <header>
    <div class="mark">${logo ? `<img src="${esc(logo)}" alt="">` : '<img src="assets/logo-mark-96.png" alt="">'}</div>
    <h1 class="brandttl chrome" id="bizname">${esc(S.profile?.business?.name || "Ledger AI")}</h1>
    <span id="usage"></span>
    <button class="hchat" id="hchat" title="Ask Ledger">&#128172;</button>
    <button class="avatar" id="more" title="Your business"><svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.6" fill="currentColor"/><path d="M5.5 19.4c.9-3.2 3.5-5 6.5-5s5.6 1.8 6.5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button>
  </header>
  <div id="banner">💡 Advisor Mode — business guidance beyond your books, on your AI allowance</div>
  <div id="alertbar"></div>
  <main id="view"></main>
  <nav id="tabs">${TABS.map((t) => `<button data-tab="${t.key}" class="${S.tab === t.key ? "on" : ""}">
      ${t.icon}${t.label}</button>`).join("")}</nav>
  <div id="chatwrap">
    <header>
      <button class="pill" id="chatback">‹ Back</button>
      <h1>Ask Ledger</h1>
      <span class="pill${S.advisor ? " on" : ""}" id="advisor">💡 Advisor</span>
      <button class="pill" id="newconv" title="New conversation">✚</button>
    </header>
    <main id="chat" class="chatpane"></main>
    <footer><textarea id="box" rows="1" placeholder="Ask about your business…"></textarea><button id="send">↑</button></footer>
  </div>`;

  on("#tabs button", "click", (e) => setTab(e.currentTarget.dataset.tab));
  $("more").onclick = businessSheet;
  $("hchat").onclick = () => openChat();
  $("chatback").onclick = closeChat;
  $("newconv").onclick = newConversation;
  $("advisor").onclick = toggleAdvisor;
  const box = $("box");
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  box.addEventListener("input", () => { box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 120) + "px"; });
  $("send").onclick = () => send();
  banner();
  if (!$("chat").childElementCount) {
    sys("Hi — I'm Ledger. Ask me anything about your business: sales, who owes you, your week ahead.");
    // Say what is actually connected instead of promising live books on an empty workspace.
    connectionStates().then(async (map) => {
      if (map.quickbooks || map.google_calendar) return;
      if (S.booksProvider === undefined) {
        try { S.booksProvider = (await booksApi({ action: "settings" })).provider; } catch { S.booksProvider = "quickbooks"; }
      }
      if ($("chat").childElementCount !== 1) return;
      sys(S.booksProvider === "native"
        ? "Your built-in books are on. Use QuickBooks? Tap Connect QuickBooks on the Home tab and I'll work from your real numbers."
        : "Nothing's connected yet — tap Connect QuickBooks on the Home tab to bring your books in.");
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
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === key));
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

function applyLaunchIntent() {
  const q = new URLSearchParams(location.search);
  // Back from a Google connect (Calendar / Gmail) started on the web: say what happened, then clean the URL.
  const connected = q.get("connected");
  if (connected) {
    history.replaceState({}, "", location.pathname);
    const name = connected === "gmail" ? "Gmail" : "Google Calendar";
    if (q.get("status") === "success") { toast(`${name} connected`); openChat(); sys(`✅ ${name} is connected. ${connected === "gmail" ? "Receipt Radar will start reading supplier receipts out of your inbox." : "Your bookings now show on the Calendar tab, and every booking Ledger proposes still needs your tap."}`); }
    else toast(`${name} didn't connect — please try again.`, "err");
    return;
  }
  // Back from Stripe: say plainly whether the card went through and when the trial ends.
  const state = q.get("state");
  if (state === "success") {
    history.replaceState({}, "", location.pathname);
    api("/stripe-billing/status", {}).then((s) => {
      const when = s.trial_ends_at ? dateShort(s.trial_ends_at) : null;
      const msg = s.subscription_status === "trialing" && when
        ? `✅ Card added. Your free trial runs until ${when} — nothing is charged before then.`
        : "✅ You're subscribed — thank you. Manage it any time under Business profile & settings.";
      openChat(); sys(msg); toast("Card saved");
    }).catch(() => { openChat(); sys("✅ Payment received — thank you."); });
    return;
  }
  if (state === "cancelled") {
    history.replaceState({}, "", location.pathname);
    toast("No charge made — you can add a card any time from the Home tab.");
    return;
  }
  if (q.get("go") === "chat") openChat();
  const ask = q.get("ask");
  if (ask) { openChat(); $("box").value = ask; send(); }
  if (q.get("go") || q.get("ask")) history.replaceState({}, "", location.pathname);
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
    try { const d = await api(b.dataset.connect + (b.dataset.connect.startsWith("/g") ? "?web=1" : ""), {}); location.href = d.authorization_url; }
    catch (err) { b.disabled = false; toast(err.message, "err"); }
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
function pvline(primary, secondary, badge, icon) {
  return `<div class="pvline">
    ${icon ? `<span class="pic">${segIc(icon)}</span>` : ""}
    <span class="m"><b>${esc(primary)}</b>${secondary ? `<small>${esc(secondary)}</small>` : ""}</span>
    ${badge ? `<span class="bdg">${esc(badge)}</span>` : ""}</div>`;
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
  // Section order is the iPhone app's, line for line (LedgerHomeView.body):
  // hero → profile & settings → Ask Ledger → Go to → Today → reviews → needs
  // your attention → Calendar → Phone → Finance → Customers → Inbox → safety.
  // The big "— HOME / LEDGER" masthead is gone here for the same reason it left
  // iOS in build 71: the brand bar above and the hero below already say it.
  view().innerHTML = `
    <div class="sect">
      <div class="brandcard">
        <div class="tile">${logo ? `<img src="${esc(logo)}" alt="">` : '<img src="assets/logo-mark-96.png" alt="">'}</div>
        <div class="who"><b class="chrome">Ledger AI</b><span>Your business, answered.</span></div>
        <span class="status"><i></i>READY</span>
      </div>

      <div id="homesetup"></div>

      <button class="bizrow" id="bizsettings">
        <span class="ic">&#9881;</span>
        <span class="m"><b>Business profile &amp; settings</b><small>CONNECTIONS · BOOKS · PHONE · TEAM · BILLING</small></span>
        <span class="go">&#8599;</span>
      </button>

      <div class="console">
        <div class="chead">
          <b>Ask Ledger</b>
          <span class="core">ONLINE</span>
          <button class="livepill" id="livebtn"><span class="wv"><i></i><i></i><i></i><i></i></span>LIVE</button>
        </div>
        <div class="askfield">
          <span class="sparkicon">&#10022;</span>
          <input id="askbox" placeholder="Tell Ledger what to do…" autocomplete="off">
          <button class="iconbtn" id="askcam" title="Capture a receipt">&#9673;</button>
          <button class="gobtn" id="askgo" title="Send">&#8593;</button>
        </div>
        <div class="askgrid">${ASK_CHIPS.map((c, i) =>
          `<button class="askchip c${i}" data-ask="${esc(c.prompt)}"><em>${segIc(c.ic)}</em>${esc(c.label)}</button>`).join("")}</div>
      </div>

      ${srail("grid", "Go to", "sil")}
      <div class="gotogrid">
        ${[
          ["finance", "em", "dollar", "Finance", "Invoices · profit"],
          ["calendar", "purple", "calendar", "Calendar", "Bookings"],
          ["phone", "cyan", "phone", "Phone", "Calls · leads"],
          ["customers", "red", "people", "Customers", "Directory"],
          ["receipts", "orange", "camera", "Receipts", "Snap · file"],
          ["reviews", "gold", "star", "Reviews", "Win 5 stars"],
        ].map(([k, tint, icon, label, sub]) => `<button class="gotile ${tint}" data-goto="${k}">
          <span class="ictile">${segIc(icon)}</span><span class="arrow">&#8599;</span>
          <b>${label}</b><small>${sub}</small></button>`).join("")}
      </div>
      <button class="bizrow vinrow" data-goto="vin">
        <span class="ic">${segIc("car")}</span>
        <span class="m"><b>Scan a VIN</b><small>LIVE CAMERA · EVERY SPEC · ONE CARD</small></span>
        <span class="go">&#8599;</span>
      </button>

      ${srail("pulse", "Today", "cy", `Updated ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`)}
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
      <div id="homenext"></div>
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
  // opens, over the browser's own WebRTC (Kyle 2026-09-02, web parity).
  $("livebtn").onclick = () => liveSheet();
  $("askcam").onclick = () => { S.financeLane = "receipts"; setTab("finance"); };
  $("bizsettings").onclick = () => businessSheet();
  on("[data-goto]", "click", (e) => {
    const k = e.currentTarget.dataset.goto;
    if (k === "vin") { vinScannerSheet(); return; }
    if (k === "receipts") { S.financeLane = "receipts"; setTab("finance"); }
    else if (k === "reviews") { S.lane = "reviews"; setTab("customers"); }
    else if (k === "finance") { S.financeLane = "invoices"; setTab("finance"); }
    else if (k === "customers") { S.lane = "directory"; setTab("customers"); }
    else setTab(k);
  });
  on("[data-ask]", "click", (e) => { openChat(); $("box").value = e.currentTarget.dataset.ask; send(); });
  loadHomeSetup();
  loadHomeKpis();
  loadHomeReviewsPulse();
  loadHomeAttention();
  loadHomeCalendar();
  loadHomePhone();
  loadHomeFinance();
  loadHomeCustomers();
  loadHomeMail();
  loadHomeNext();
}

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
  try {
    const board = (await get("/google-business-profile/reviews?limit=10")).reviews;
    const unanswered = Number(board.unanswered_count) || 0;
    const rating = board.average_rating != null ? Number(board.average_rating).toFixed(1) : "—";
    slot.innerHTML = `<button class="panel pvcard gd" id="rvpulse" style="width:100%;text-align:left">
      ${srail("star", "Google reviews", "gd", `<span class="bdg" style="--gt:${unanswered ? "251,146,60" : "26,230,148"}">${unanswered ? `${unanswered} to answer` : "All replied"}</span>`)}
      <div class="pvstats">
        <div class="pvstat"><b style="color:var(--gold)">${esc(rating)}</b><small>average rating</small></div>
        <div class="pvstat"><b>${Number(board.total_count) || 0}</b><small>reviews</small></div>
        <div class="pvstat"><b style="color:${unanswered ? "var(--orange)" : "var(--emerald)"}">${unanswered}</b><small>awaiting reply</small></div>
      </div></button>`;
    $("rvpulse").onclick = () => { S.lane = "reviews"; setTab("customers"); };
  } catch { slot.innerHTML = ""; }
}

async function loadHomeCalendar() {
  const slot = $("homecal"); if (!slot) return;
  let inner;
  try {
    if (!S.cal) S.cal = await get("/google-calendar/events");
    const up = S.cal?.calendar?.upcoming || [];
    inner = up.length
      ? up.slice(0, 3).map((e) => pvline(e.title || "Untitled appointment",
          `${dayLabel(e.start)} · ${new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
          null, "calendar")).join("") +
        (up.length > 3 ? `<p class="pvempty">+ ${up.length - 3} more upcoming</p>` : "")
      : `<p class="pvempty">Nothing booked yet.</p>`;
  } catch (e) {
    inner = /not connected/i.test(e.message)
      ? `<p class="pvempty">Google Calendar isn't connected yet — connect it in Business profile &amp; settings and your week lands here.</p>`
      : `<p class="pvempty">Couldn't load the calendar.</p>`;
  }
  slot.innerHTML = pvcard("pvcal", "calendar", "Calendar", "pu", "View Calendar", inner);
  wirePv("pvcal", () => setTab("calendar"));
}

async function loadHomePhone() {
  const slot = $("homephone"); if (!slot) return;
  let inner;
  try {
    if (!S.phone) S.phone = await api("/phone", { action: "board" });
    const d = S.phone;
    if (!d.hasNumber) {
      inner = `<p class="pvempty">No business number connected yet — set one up in Phone.</p>`;
    } else {
      const m = d.metrics || {};
      inner = pvstats([
        [String(m.missedToday ?? 0), "missed today", (m.missedToday ?? 0) > 0 ? "var(--orange)" : "var(--dim)"],
        [String(m.voicemailsUnheard ?? 0), "voicemails", (m.voicemailsUnheard ?? 0) > 0 ? "var(--cyan)" : "var(--dim)"],
        [String(m.leads7d ?? 0), "leads · 7 days", "var(--emerald)"],
      ]) + ((m.awaitingReply ?? 0) > 0
        ? `<p class="pvempty">${m.awaitingReply} conversation${m.awaitingReply === 1 ? " is" : "s are"} waiting on a reply.</p>` : "");
    }
  } catch { inner = `<p class="pvempty">Couldn't load phone activity.</p>`; }
  slot.innerHTML = pvcard("pvphone", "phone", "Phone", "cy", "Open Phone", inner);
  wirePv("pvphone", () => setTab("phone"));
}

async function loadHomeFinance() {
  const slot = $("homefin"); if (!slot) return;
  let inner;
  try {
    const k = await homeBooksKpis();
    inner = pvstats([
      [money0(k.today_sales), "sales today", "var(--emerald)"],
      [money0(k.month_sales), "month to date", "var(--cyan)"],
      [money0(k.outstanding), "outstanding", Number(k.outstanding) > 0 ? "var(--orange)" : "var(--dim)"],
    ]) + (Number(k.outstanding) > 0
      ? `<p class="pvempty">${k.open_count || 0} invoice${(k.open_count || 0) === 1 ? "" : "s"} still unpaid.</p>` : "");
  } catch { inner = `<p class="pvempty">Couldn't reach your books — pull down to retry.</p>`; }
  slot.innerHTML = pvcard("pvfin", "dollar", "Finance", "em", "Open Finance", inner);
  wirePv("pvfin", () => { S.financeLane = "invoices"; setTab("finance"); });
}

async function loadHomeCustomers() {
  const slot = $("homecust"); if (!slot) return;
  let inner;
  try {
    const rows = await homeCustomers();
    inner = rows.length
      ? rows.slice(0, 3).map((c) => pvline(c.name || "(no name)",
          c.created_at ? `Added ${dateShort(c.created_at)}` : (c.email || c.phone || ""), null, "people")).join("")
      : `<p class="pvempty">No customers on file yet.</p>`;
  } catch { inner = `<p class="pvempty">Couldn't load your customer list.</p>`; }
  slot.innerHTML = pvcard("pvcust", "people", "Recent customers", "pk", "View All Customers", inner);
  wirePv("pvcust", () => { S.lane = "directory"; setTab("customers"); });
}

/** Today's numbers from whichever book the workspace runs on. */
async function homeBooksKpis() {
  if (S.booksProvider === undefined) {
    try { S.booksProvider = (await booksApi({ action: "settings" })).provider; }
    catch { S.booksProvider = "quickbooks"; }
  }
  if (S.booksProvider === "native") {
    if (!S.nativeSummary) S.nativeSummary = await booksApi({ action: "summary" });
    const n = S.nativeSummary?.summary || S.nativeSummary || {};
    return {
      today_sales: n.today_sales ?? n.todaySales ?? 0,
      month_sales: n.month_sales ?? n.monthSales ?? 0,
      ytd_sales: n.ytd_sales ?? n.ytdSales ?? 0,
      outstanding: n.outstanding ?? 0,
      open_count: n.open_count ?? n.openCount ?? 0,
      today_profit: n.today_profit ?? n.todayProfit ?? null,
      profit_margin: n.profit_margin ?? n.profitMargin ?? null,
      missing_cost_count: n.missing_cost_count ?? n.missingCostCount ?? 0,
    };
  }
  if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
  return S.qbo?.qbo?.kpis || {};
}

/** Newest customers first, from whichever book is live. */
async function homeCustomers() {
  if (S.booksProvider === "native") {
    if (!S.nativeCustomers) S.nativeCustomers = (await booksApi({ action: "customers" })).customers || [];
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

// Three-step setup checklist at the top of Home for a workspace that is not
// fully set up: books, calendar, card. Every step deep-links to the action.
// Disappears on its own when all three are done, or when the owner hides it.
const SETUP_HIDE_KEY = "ledger.setupHidden";
async function loadHomeSetup() {
  const slot = $("homesetup"); if (!slot) return;
  if (localStorage.getItem(SETUP_HIDE_KEY) === "1") return;
  let map = {}, bill = null;
  try { [map, bill] = await Promise.all([connectionStates(), api("/stripe-billing/status", {}).catch(() => null)]); } catch {}
  if (!$("homesetup")) return;
  const books = !!map.quickbooks;
  const cal = !!map.google_calendar;
  const paid = bill && ["active", "past_due"].includes(bill.subscription_status);
  if (books && cal && paid) return;
  const step = (done, num, title, detail, action) => `<div class="setupstep${done ? " done" : ""}">
      <span class="num">${done ? "&#10003;" : num}</span>
      <span class="m"><b>${title}</b><small>${detail}</small></span>
      ${done ? "" : action}</div>`;
  const trialLine = bill?.subscription_status === "trialing" && bill.trial_ends_at
    ? `Free until ${dateShort(bill.trial_ends_at)} — add a card so nothing stops on day 15.` : "Keep Ledger running after your trial.";
  slot.innerHTML = `<div class="setupcard">
    <div class="lanehead" style="margin-top:0"><span class="eyebrow">&#9889; Get set up</span><button class="pill" id="setuphide" title="Hide">Hide</button></div>
    ${step(books, 1, "Connect QuickBooks", books ? "" : "Bring your invoices, customers and numbers in. Every post is confirmed by you first.",
      `<button class="btn primary" data-connect="/quickbooks-oauth/start">Connect</button>`)}
    ${step(cal, 2, "Connect Google Calendar", "See your week and let Ledger book jobs — every booking still needs your tap.",
      `<button class="btn ghost" data-connect="/google-calendar/start">Connect</button>`)}
    ${step(paid, 3, "Add a card", trialLine,
      bill?.billing_ready ? `<button class="btn ghost" id="setupcard">Add card</button>` : "")}
    ${books ? "" : `<p class="note" style="margin:8px 0 0">Don't use QuickBooks? Ledger's built-in books are already on — invoices, estimates and payment links work today.</p>`}
  </div>`;
  wireConnect(slot);
  const hide = slot.querySelector("#setuphide");
  if (hide) hide.onclick = () => { localStorage.setItem(SETUP_HIDE_KEY, "1"); slot.innerHTML = ""; };
  const card = slot.querySelector("#setupcard");
  if (card) card.onclick = async () => {
    card.disabled = true;
    try { const c = await api("/stripe-billing/checkout", {}); location.href = c.url; }
    catch (e) { card.disabled = false; toast(e.message, "err"); }
  };
}

// Business profile & settings hub — the web twin of the iOS settings row (build 41).
// Each row deep-links to the surface that already owns that setting.
// One settings surface (2026-09-02): the gear row and the avatar open the same
// sheet. "Connected services" used to bounce to the Reviews page — dead end.
async function bizSettingsSheet() { return businessSheet(); }

function kpiBlock(k) {
  // The four instrument tiles from the iPhone app's businessPulse, same order,
  // same labels, same captions.
  const pct = (v) => v == null ? null : `${Number(v).toFixed(1)}% margin`;
  const profit = k.today_profit;
  return `<div class="ptiles">
    ${ptile({ label: "Sales today", value: money0(k.today_sales), detail: `${money0(k.month_sales)} this month`, icon: "dollar", tone: "em" })}
    ${ptile({ label: "Est. profit", value: profit == null ? "—" : money0(profit),
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
  // Books, calendar and phone each answer for their own tile. One dead
  // connector greys one number — it never blanks the row.
  const [books, cal, phone] = await Promise.all([
    homeBooksKpis().catch(() => null),
    (S.cal ? Promise.resolve(S.cal) : get("/google-calendar/events")).then((d) => { S.cal = d; return d; }).catch(() => null),
    (S.phone ? Promise.resolve(S.phone) : api("/phone", { action: "board" })).then((d) => { S.phone = d; return d; }).catch(() => null),
  ]);
  const k = { ...(books || {}) };
  if (!books) { k.today_sales = 0; k.month_sales = 0; k.today_profit = null; }
  k.appointments = cal ? (cal.calendar?.upcoming || []).length : null;
  k.missed = phone?.hasNumber ? (phone.metrics?.missedToday ?? 0) : (phone ? 0 : null);
  k.leads7d = phone?.metrics?.leads7d ?? 0;
  slot.innerHTML = kpiBlock(k) + (books ? "" :
    `<p class="note err" style="margin-top:8px">Couldn't reach your books just now.</p>`);
}

// Mirrors the iOS "LEDGER'S NEXT MOVE" card: one prioritised suggestion driven by open AR.
async function loadHomeNext() {
  const slot = $("homenext"); if (!slot) return;
  try {
    if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
    const k = S.qbo?.qbo?.kpis || {};
    const outstanding = Number(k.outstanding) || 0;
    const openCount = Number(k.open_count) || 0;
    const owed = outstanding > 0;
    const headline = owed
      ? `${money(outstanding)} is sitting in ${openCount} unpaid invoice${openCount === 1 ? "" : "s"}.`
      : "Books are clean — dig into this month's momentum.";
    const cta = owed ? "Ask Ledger who owes the most →" : "Ask Ledger for the month in review →";
    const prompt = owed ? "Who owes me the most right now?" : "Give me this month in review.";
    slot.innerHTML = `<button class="nextmove" id="nextmove">
      <span class="ic">&#10022;</span>
      <span class="m"><small>Ledger's next move</small><b>${esc(headline)}</b><span>${esc(cta)}</span></span>
    </button>`;
    $("nextmove").onclick = () => { openChat(); $("box").value = prompt; };
  } catch { slot.innerHTML = ""; }
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
          } catch (err) { toast(err.message, "err"); group.forEach((b) => b.disabled = false); }
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
        } catch (err) { toast(err.message, "err"); e.currentTarget.disabled = false; }
      }, sh);
    });
  };

  try {
    if (!review) { review = await get("/profit/review"); S.review = review; }
    render();
  } catch (e) { toast(e.message, "err"); }
}

// Mirrors the iOS "NEEDS ATTENTION" queue: cost review, profit exceptions, receipt review, schedule.
async function loadHomeAttention() {
  const slot = $("homeattn"); if (!slot) return;
  let costs = 0;
  try {
    if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
    costs = Number(S.qbo?.qbo?.kpis?.missing_cost_count) || 0;
  } catch { /* Books not connected yet — the row still reads 0, exactly like iOS. */ }
  let review = S.review;
  try { if (!review) { review = await get("/profit/review"); S.review = review; } }
  catch { review = null; /* Signed out or offline — the row simply stays hidden. */ }
  let receipts = 0, appts = 0;
  try {
    if (!S.receipts) { const d = await get("/gmail/receipts"); S.receipts = d.receipts || []; }
    receipts = S.receipts.filter((r) => !r.qbo_purchase_id && r.category !== "Personal").length;
  } catch { /* Gmail not connected — the row still reads 0, exactly like iOS. */ }
  try {
    if (!S.cal) S.cal = await get("/google-calendar/events");
    appts = (S.cal?.calendar?.upcoming || []).length;
  } catch { /* Calendar not connected. */ }
  const row = (tint, tab, icon, title, detail) => `<button class="attnrow ${tint}" data-attn="${tab}">
      <span class="ic">${icon}</span>
      <span class="m"><b>${esc(title)}</b><span>${esc(detail)}</span></span>
      <span class="chev">&#8250;</span></button>`;
  // Only shown when there is something to answer: an empty queue is not a chore.
  const reviewRow = review?.open_count
    ? `<button class="attnrow amber" data-costreview="1">
         <span class="ic">&#127991;</span>
         <span class="m"><b>Cost review</b><span>${review.vendor_count} vendor${review.vendor_count === 1 ? "" : "s"} to classify${review.exception_count ? ` · ${review.exception_count} invoice${review.exception_count === 1 ? "" : "s"} flagged` : ""}</span></span>
         <span class="chev">&#8250;</span></button>`
    : "";
  slot.innerHTML = `<div class="attn"><div class="eyebrow">Needs attention</div>
    ${reviewRow}
    ${row("orange", "finance", "&#128269;", "Profit exceptions", `${costs} cost${costs === 1 ? "" : "s"} require verification`)}
    ${row("cyan", "receipts", "&#128247;", "Receipt review", `${receipts} receipt draft${receipts === 1 ? "" : "s"} waiting`)}
    ${row("purple", "calendar", "&#128197;", "Schedule", `${appts} upcoming appointment${appts === 1 ? "" : "s"}`)}
  </div>`;
  on("[data-attn]", "click", (e) => {
    const t = e.currentTarget.dataset.attn;
    if (t === "receipts") { S.financeLane = "receipts"; setTab("finance"); } else setTab(t);
  }, slot);
  on("[data-costreview]", "click", () => openCostReview(), slot);
}

async function loadHomeMail() {
  const slot = $("homemail"); if (!slot) return;
  try {
    const d = await get("/gmail/inbox?limit=10");
    S.emails = d.emails || [];
    if (!S.emails.length) { slot.innerHTML = ""; return; }
    const unread = S.emails.filter((m) => m.unread).length;
    const shown = S.mailExpanded ? S.emails : S.emails.slice(0, 3);
    slot.innerHTML = `<div class="maillane">
      <div class="mhead"><b>Inbox</b>${unread ? `<span class="mchip">${unread} unread</span>` : `<span class="mchip zero">clear</span>`}<button id="mailrefresh" title="Refresh">&#8635;</button></div>
      ${shown.map((m, i) => `
      <button class="mailrow" data-mail="${i}">
        <span class="dot ${m.unread ? "" : "read"}"></span>
        <span class="m"><b>${esc(m.from_name || m.from || "(unknown sender)")}</b>
          <span>${esc(m.subject || "(no subject)")}</span></span>
        <span class="chev">&#8250;</span>
      </button>`).join("")}
      ${S.emails.length > 3 ? `<button class="mmore" id="mailmore">${S.mailExpanded ? "Show less &#9650;" : `All mail (${S.emails.length}) &#9660;`}</button>` : ""}</div>`;
    on("[data-mail]", "click", (e) => emailSheet(S.emails[Number(e.currentTarget.dataset.mail)]), slot);
    slot.querySelector("#mailrefresh").onclick = (e) => { e.stopPropagation(); loadHomeMail(); };
    const more = slot.querySelector("#mailmore");
    if (more) more.onclick = () => { S.mailExpanded = !S.mailExpanded; loadHomeMail(); };
  } catch { slot.innerHTML = ""; }
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

async function booksApi(body) { return api("/books", body); }

// SALES INTELLIGENCE hero for native books — the web twin of iOS's Finance
// Overview card. Every figure comes from the live invoice rows (voids
// excluded): month-to-date total, a 14-day daily spark, MOM/YOY growth against
// the SAME elapsed span, the real average sale, and a straight run-rate
// forecast. "—" when there is no prior period to compare against.
// Built-in books store an issued invoice as "sent" (it is issued, not
// necessarily emailed). Owners read SENT as "emailed" — show OPEN instead.
function nativeStatusLabel(status) { return status === "sent" ? "open" : (status || ""); }

function salesIntelNative(invoices) {
  const now = new Date();
  const sales = invoices.filter((i) => i.status !== "void");
  const dayTotal = (key) => sales.filter((i) => (i.issue_date || "").slice(0, 10) === key)
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  const rangeTotal = (from, to) => sales.filter((i) => {
    const d = (i.issue_date || "").slice(0, 10);
    return d >= from && d <= to;
  }).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const iso = (d) => localDay(d);
  const ym = iso(now).slice(0, 7);
  const month = sales.filter((i) => (i.issue_date || "").slice(0, 7) === ym);
  const mtd = month.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const avg = month.length ? mtd / month.length : 0;
  const elapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  // A run rate off one or two invoices in the first days of a month reads as
  // broken ("$24,727 from one sale"). Show it once there is a week of data or
  // five invoices — whichever comes first.
  const forecastReady = elapsed >= 7 || month.length >= 5;
  const forecast = elapsed ? mtd / elapsed * daysInMonth : 0;
  // Same elapsed span, one month back / one year back.
  const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMEnd = new Date(prevM.getFullYear(), prevM.getMonth(),
    Math.min(elapsed, new Date(prevM.getFullYear(), prevM.getMonth() + 1, 0).getDate()));
  const momBase = rangeTotal(iso(prevM), iso(prevMEnd));
  const ytd = rangeTotal(now.getFullYear() + "-01-01", iso(now));
  const prevY = new Date(now); prevY.setFullYear(now.getFullYear() - 1);
  const yoyBase = rangeTotal((now.getFullYear() - 1) + "-01-01", iso(prevY));
  const growth = (cur, base) => base > 0
    ? `${cur >= base ? "+" : "−"}${Math.abs(Math.round((cur - base) / base * 100))}%` : "—";
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const t = new Date(now); t.setDate(now.getDate() - d);
    days.push({ key: iso(t), total: dayTotal(iso(t)) });
  }
  const max = Math.max(1, ...days.map((d) => d.total));
  return `<div class="intel">
    <div class="ihead"><b>&#9651; Sales</b><span class="live"><i></i>Built-in books</span></div>
    <p class="cap">This month</p>
    <div class="big">${money(mtd)}</div>
    <div class="sub">Live sales performance</div>
    <div class="pspark">${days.map((d, i) =>
      `<div class="b ${i === days.length - 1 ? "hot" : ""}" style="height:${Math.max(Math.round(d.total / max * 100), 3)}%" title="${d.key}: ${money0(d.total)}"></div>`).join("")}</div>
    <div class="sparkends"><span>14 days ago</span><span>Today</span></div>
    <div class="kpis" style="margin-top:15px">
      <div class="kpi cyan"><small>MOM &middot; MTD</small><b>${growth(mtd, momBase)}</b><i>vs same point last month</i></div>
      <div class="kpi purple"><small>YOY &middot; YTD</small><b>${growth(ytd, yoyBase)}</b><i>vs same point last year</i></div>
      <div class="kpi em"><small>Avg sale</small><b>${money(avg)}</b><i>${month.length} invoice${month.length === 1 ? "" : "s"} this month</i></div>
      <div class="kpi orange"><small>Forecast</small><b>${forecastReady ? money(forecast) : "—"}</b><i>${forecastReady ? "month-end run rate" : "after a week of sales"}</i></div>
    </div>
    <p class="infoline"><em>&#9432;</em>Growth compares matching elapsed periods &mdash; not partial months against full months.</p>
  </div>`;
}

async function loadNativeInvoices() {
  const slot = $("finbody"); if (!slot) return;
  let data, summary, connect, estData, settings;
  try {
    [data, summary, connect, estData, settings] = await Promise.all([
      booksApi({ action: "invoices" }),
      booksApi({ action: "summary" }),
      booksApi({ action: "connect-status" }),
      booksApi({ action: "estimates" }).catch(() => ({ estimates: [] })),
      booksApi({ action: "settings" }).catch(() => null),
    ]);
  } catch (e) { slot.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const invoices = data.invoices || [];
  const estimates = estData.estimates || [];
  // Same split as iOS: open/accepted estimates are live work; the rest is history.
  const liveEst = estimates.filter((x) => x.status === "open" || x.status === "accepted");
  const filtered = invoices.filter((i) => !S.invoiceSearch ||
    (i.customer + " " + i.number).toLowerCase().includes(S.invoiceSearch));
  const chargesOn = connect?.charges_enabled === true;
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
      <div class="fintile"><small>THIS MONTH</small><b>${money(thisMonth)}</b></div>
      <div class="fintile"><small>YEAR TO DATE</small><b>${money(ytd)}</b></div>
      <div class="fintile warn"><span class="tic" style="background:rgba(251,146,60,.15);color:var(--orange)">&#36;</span><small>OUTSTANDING</small><b>${money(summary.open_balance || 0)}</b></div>
      <div class="fintile blue"><span class="tic" style="background:rgba(59,130,246,.15);color:var(--blue)">&#128196;</span><span class="nextchip">Next ${esc(String(nextNum))}</span><small>OPEN INVOICES</small><b>${summary.open_invoices ?? 0}</b></div>
    </div>
    <button class="cta" id="newinv">
      <span class="ic">&#43;</span>
      <span><b>Create Invoice</b><span>Numbered, taxed, with a payment link</span></span>
    </button>
    <button class="cta ghost" id="newest">
      <span class="ic">&#128221;</span>
      <span><b>Create Estimate</b><span>EST-numbered quote with a share page — posts nothing</span></span>
    </button>
    ${liveEst.length ? `<div class="lanehead"><span class="eyebrow" style="color:var(--dim)">Open estimates</span>
      <span class="note">${liveEst.length}</span></div>
    <div class="list">${liveEst.slice(0, 40).map((x) => `
      <button class="item" data-best="${esc(x.id)}">
        <div class="main"><div class="ttl">${esc(x.customer || "—")}</div>
          <div class="sub">${esc(x.number || "EST")} · ${esc(dateShort(x.issue_date))}${x.expiry_date ? " · expires " + esc(dateShort(x.expiry_date)) : ""}</div></div>
        <div class="amt">${money(x.total)}
          <small><span class="tag ${x.status === "accepted" ? "paid" : "open"}">${esc(x.status)}</span></small></div>
      </button>`).join("")}</div>` : ""}
    <div class="searchwrap"><span class="mag">${MAG}</span>
      <input id="invsearch" placeholder="Customer or invoice number" value="${esc(S.invoiceSearch || "")}"></div>
    <div class="opsgrid">
      <button class="opcard ${chargesOn ? "em" : "purple"}" data-op="stripe"><span class="ic">&#128179;</span>
        <b>Card payments</b><span>${chargesOn ? "ON — customers can pay online" : "Set up Stripe to get paid online"}</span>
        <em>${chargesOn ? "MANAGE" : "SET UP"} &#8599;</em></button>
      <button class="opcard" data-op="bsettings"><span class="ic">&#9881;</span><b>Books settings</b>
        <span>Tax, numbering, payment info</span><em>OPEN &#8599;</em></button>
      <button class="opcard em" data-op="receipts"><span class="ic">&#128229;</span><b>Receipt Queue</b>
        <span>Review &amp; batch</span><em>OPEN &#8599;</em></button>
      <button class="opcard" data-op="bexport"><span class="ic">&#128228;</span><b>Export CSV</b>
        <span>Invoices, payments, customers</span><em>EXPORT &#8599;</em></button>
    </div>
    <div class="lanehead"><span class="eyebrow" style="color:var(--dim)">${S.invoiceSearch ? "Matching invoices" : "Recent invoices"}</span>
      <span class="note">${filtered.length}</span></div>
    ${filtered.length ? `<div class="list">${filtered.slice(0, 120).map((i) => `
      <button class="item" data-binv="${esc(i.id)}">
        <div class="main"><div class="ttl">${esc(i.customer || "—")}</div>
          <div class="sub">${esc(i.number)} · ${esc(dateShort(i.issue_date))}</div></div>
        <div class="amt">${money(i.total)}
          <small><span class="tag ${i.status === "paid" ? "paid" : i.status === "void" ? "" : "open"}">${esc(nativeStatusLabel(i.status))}</span></small></div>
      </button>`).join("")}</div>`
      : `<div class="empty">${S.invoiceSearch ? "No matches." : "No invoices yet — create your first, or ask Ledger in chat."}</div>`}`;
  $("newinv").onclick = () => nativeComposerSheet();
  $("newest").onclick = () => nativeComposerSheet("estimate");
  const search = $("invsearch");
  if (search) search.oninput = () => { S.invoiceSearch = search.value.trim().toLowerCase(); loadNativeInvoices(); };
  on("[data-binv]", "click", (e) => nativeInvoiceSheet(e.currentTarget.dataset.binv), slot);
  on("[data-best]", "click", (e) => nativeEstimateSheet(e.currentTarget.dataset.best), slot);
  on("[data-op]", "click", async (e) => {
    const op = e.currentTarget.dataset.op;
    if (op === "receipts") { S.financeLane = "receipts"; renderFinance(); }
    else if (op === "bsettings") booksSettingsSheet();
    else if (op === "bexport") {
      try {
        const ex = await booksApi({ action: "export" });
        const blob = new Blob([
          "== CUSTOMERS ==\n" + ex.customers_csv + "\n\n== INVOICES ==\n" + ex.invoices_csv +
          "\n\n== LINES ==\n" + ex.lines_csv + "\n\n== PAYMENTS ==\n" + ex.payments_csv,
        ], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "ledger-books-export.csv"; a.click();
        toast("Export downloaded");
      } catch (err) { toast(err.message, "err"); }
    } else if (op === "stripe") {
      try {
        const r = await booksApi({ action: "connect-onboard" });
        if (r.url) window.open(r.url, "_blank");
      } catch (err) { toast(err.message, "err"); }
    }
  }, slot);
}

async function nativeInvoiceSheet(id) {
  const wrap = sheet(`<h2>Invoice</h2><div id="binvbody"><div class="skel"></div><div class="skel"></div></div>`);
  const body = () => wrap.querySelector("#binvbody");
  let inv;
  try { inv = (await booksApi({ action: "invoice-get", id })).invoice; }
  catch (e) { body().innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
  const paint = () => {
    body().innerHTML = `
      <div class="lanehead"><span class="eyebrow">${esc(inv.number)}</span>
        <span class="tag ${inv.status === "paid" ? "paid" : "open"}">${esc(inv.status)}</span></div>
      <p class="note">${esc(inv.customer?.name || "")}${inv.customer?.email ? " · " + esc(inv.customer.email) : ""}<br>
        Issued ${esc(inv.issue_date)}${inv.due_date ? " · Due " + esc(inv.due_date) : ""}</p>
      <table class="dtable"><tbody>
        ${(inv.lines || []).map((l) => `<tr><td>${esc(l.name)} × ${l.quantity}</td><td style="text-align:right">${money(l.amount)}</td></tr>`).join("")}
        <tr><td>Subtotal</td><td style="text-align:right">${money(inv.subtotal)}</td></tr>
        ${Number(inv.tax_total) > 0 ? `<tr><td>${esc(inv.tax_name || "Tax")}</td><td style="text-align:right">${money(inv.tax_total)}</td></tr>` : ""}
        <tr><td><b>Total</b></td><td style="text-align:right"><b>${money(inv.total)}</b></td></tr>
        ${Number(inv.balance) > 0 && Number(inv.balance) < Number(inv.total)
          ? `<tr><td>Balance due</td><td style="text-align:right">${money(inv.balance)}</td></tr>` : ""}
      </tbody></table>
      ${(inv.payments || []).length ? `<p class="note">${inv.payments.map((p) =>
        `Paid ${money(p.amount)} · ${esc(p.method)} · ${esc(String(p.received_at).slice(0, 10))}`).join("<br>")}</p>` : ""}
      ${inv.email_enabled ? `<button class="pillbtn" id="bemail"><b>Email invoice</b></button>` : ""}
      ${inv.email_sent_at ? `<p class="note">Emailed to ${esc(inv.email_sent_to)} · ${esc(String(inv.email_sent_at).slice(0, 10))}</p>` : ""}
      <button class="pillbtn" id="blink">Copy payment link</button>
      <button class="pillbtn" id="bopen">Open invoice page</button>
      ${Number(inv.balance) > 0 ? `
        <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Record a payment</span></div>
        <div class="f" style="display:flex;gap:8px">
          <input id="bamt" type="number" min="0.01" step="0.01" class="cmpinput" style="flex:1" value="${inv.balance}">
          <select id="bmethod" class="pillbtn"><option value="etransfer">E-transfer</option><option value="cash">Cash</option>
            <option value="cheque">Cheque</option><option value="other">Other</option></select>
        </div>
        <button class="pillbtn" id="bpay" style="margin-top:8px"><b>Mark paid</b></button>` : ""}
      ${inv.status === "sent" && !(inv.payments || []).length ? `<button class="linkbtn" id="bvoid" style="color:var(--red);margin-top:10px">Void this invoice</button>` : ""}
      <p class="note err" id="berr"></p>`;
    const link = inv.link || "";
    wrap.querySelector("#blink").onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast("Payment link copied"); }
      catch { prompt("Payment link:", link); }
    };
    wrap.querySelector("#bopen").onclick = () => window.open(link, "_blank");
    const emailBtn = wrap.querySelector("#bemail");
    if (emailBtn) emailBtn.onclick = async () => {
      const to = (prompt("Email this invoice to:", inv.customer?.email || "") || "").trim();
      if (!to) return;
      emailBtn.disabled = true;
      const send = async (force) => {
        const r = await booksApi({ action: "invoice-send", id: inv.id, to, ...(force ? { force: true } : {}) });
        toast(`Invoice emailed to ${r.to}`);
        inv = { ...inv, email_sent_at: new Date().toISOString(), email_sent_to: r.to };
        paint();
      };
      try { await send(false); }
      catch (e) {
        if (/already emailed/i.test(e.message)) {
          if (confirm(`${inv.number} was already emailed to ${to}. Send it again?`)) {
            try { await send(true); return; } catch (e2) { wrap.querySelector("#berr").textContent = e2.message; }
          }
        } else wrap.querySelector("#berr").textContent = e.message;
        emailBtn.disabled = false;
      }
    };
    const pay = wrap.querySelector("#bpay");
    if (pay) pay.onclick = async () => {
      pay.disabled = true;
      try {
        const amount = Number(wrap.querySelector("#bamt").value);
        const r = await booksApi({ action: "payment-record", invoice_id: inv.id, amount, method: wrap.querySelector("#bmethod").value });
        inv = { ...inv, ...r.invoice, link };
        toast(r.invoice.status === "paid" ? "Invoice paid in full" : "Payment recorded");
        paint(); loadNativeInvoices();
      } catch (e) { wrap.querySelector("#berr").textContent = e.message; pay.disabled = false; }
    };
    const voidBtn = wrap.querySelector("#bvoid");
    if (voidBtn) voidBtn.onclick = async () => {
      if (!confirm(`Void ${inv.number}? The number is never reused.`)) return;
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
        <tr><td>Subtotal</td><td style="text-align:right">${money(est.subtotal)}</td></tr>
        ${Number(est.tax_total) > 0 ? `<tr><td>${esc(est.tax_name || "Tax")}</td><td style="text-align:right">${money(est.tax_total)}</td></tr>` : ""}
        <tr><td><b>Total</b></td><td style="text-align:right"><b>${money(est.total)}</b></td></tr>
      </tbody></table>
      ${est.converted_invoice_number ? `<p class="note ok">Converted to invoice ${esc(est.converted_invoice_number)}</p>` : ""}
      ${est.email_enabled && live ? `<button class="pillbtn" id="estemail"><b>Email estimate</b></button>` : ""}
      ${est.email_sent_at ? `<p class="note">Emailed to ${esc(est.email_sent_to)} · ${esc(String(est.email_sent_at).slice(0, 10))}</p>` : ""}
      ${est.link ? `<button class="pillbtn" id="estlink">Copy share link</button>
      <button class="pillbtn" id="estopen">Open estimate page</button>` : ""}
      ${est.status === "open" ? `
        <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Customer decision</span></div>
        <div class="f" style="display:flex;gap:8px">
          <button class="pillbtn" id="estaccept" style="flex:1"><b>Mark accepted</b></button>
          <button class="pillbtn" id="estdecline" style="flex:1">Mark declined</button>
        </div>` : ""}
      ${est.status === "accepted" ? `<button class="cta" id="estconvert" style="margin-top:12px">
        <span class="ic">&#8594;</span>
        <span><b>Convert to invoice</b><span>Numbered invoice + payment link, tax applied</span></span></button>` : ""}
      ${live ? `<button class="linkbtn" id="estvoid" style="color:var(--red);margin-top:10px">Void this estimate</button>` : ""}
      <p class="note err" id="esterr"></p>`;
    const err = (m) => { wrap.querySelector("#esterr").textContent = m; };
    const link = est.link || "";
    const lb = wrap.querySelector("#estlink");
    if (lb) lb.onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast("Share link copied"); }
      catch { prompt("Estimate link:", link); }
    };
    const ob = wrap.querySelector("#estopen");
    if (ob) ob.onclick = () => window.open(link, "_blank");
    const emailBtn = wrap.querySelector("#estemail");
    if (emailBtn) emailBtn.onclick = async () => {
      const to = (prompt("Email this estimate to:", est.customer?.email || "") || "").trim();
      if (!to) return;
      emailBtn.disabled = true;
      const doSend = async (force) => {
        const r = await booksApi({ action: "estimate-send", id: est.id, to, ...(force ? { force: true } : {}) });
        toast(`Estimate emailed to ${r.to}`);
        est = { ...est, email_sent_at: new Date().toISOString(), email_sent_to: r.to };
        paint();
      };
      try { await doSend(false); }
      catch (e) {
        if (/already emailed/i.test(e.message)) {
          if (confirm(`${est.number} was already emailed to ${to}. Send it again?`)) {
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
    const conv = wrap.querySelector("#estconvert");
    if (conv) conv.onclick = async () => {
      conv.disabled = true;
      try {
        const r = await booksApi({ action: "estimate-convert", id: est.id });
        toast(`Invoice ${r.invoice.number} created from ${est.number}`);
        closeSheet(); loadNativeInvoices(); nativeInvoiceSheet(r.invoice.id);
      } catch (e) { err(e.message); conv.disabled = false; }
    };
    const vb = wrap.querySelector("#estvoid");
    if (vb) vb.onclick = async () => {
      if (!confirm(`Void ${est.number}? The number is never reused.`)) return;
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
  // kind "estimate": EST numbering, VALID FOR instead of payment terms, and the
  // create posts nothing to the books — money moves only on convert-to-invoice.
  const isEst = kind === "estimate";
  const C = { customer: null, customers: [], query: "", lines: [{ name: "", quantity: 1, rate: 0 }], memo: "", termsDays: 0, validDays: 14, newCust: false, busy: false, shortcuts: [] };
  const wrap = sheet(`<h2>${isEst ? "New Estimate" : "New Invoice"}</h2><div id="bcmp"><div class="skel"></div></div>`);
  const body = () => wrap.querySelector("#bcmp");
  try {
    const [cust, sc, set] = await Promise.all([
      booksApi({ action: "customers" }),
      booksApi({ action: "shortcuts" }).catch(() => ({ shortcuts: [] })),
      booksApi({ action: "settings" }).catch(() => null),
    ]);
    C.customers = cust.customers || [];
    C.shortcuts = sc.shortcuts || [];
    C.termsDays = set?.default_terms_days ?? 0;
  } catch { C.customers = []; }
  const subtotal = () => C.lines.reduce((t, l) => t + Math.round((Number(l.quantity) || 0) * (Number(l.rate) || 0) * 100) / 100, 0);
  const paint = () => {
    const hits = C.query
      ? C.customers.filter((c) => (`${c.first_name} ${c.last_name} ${c.company || ""} ${c.email || ""}`).toLowerCase().includes(C.query.toLowerCase())).slice(0, 8)
      : C.customers.slice(0, 6);
    body().innerHTML = `
      <div class="lanehead"><span class="eyebrow">Customer</span></div>
      ${C.customer ? `<div class="cmpsel"><span class="av">${esc((C.customer.first_name || "?").slice(0, 1).toUpperCase())}</span>
          <span class="m"><b>${esc(`${C.customer.first_name} ${C.customer.last_name}`.trim())}</b>${C.customer.email ? `<span>${esc(C.customer.email)}</span>` : ""}</span>
          <button class="x" id="bclear">&#10005;</button></div>`
        : C.newCust ? `
          <div class="f" style="display:flex;gap:8px">
            <input id="ncf" class="cmpinput" placeholder="First name" style="flex:1">
            <input id="ncl" class="cmpinput" placeholder="Last name" style="flex:1"></div>
          <input id="nce" class="cmpinput sm" placeholder="Email">
          <input id="ncp" class="cmpinput sm" placeholder="Phone">
          <input id="ncc" class="cmpinput sm" placeholder="Company (optional)">
          <button class="pillbtn" id="ncsave">Save customer</button>
          <button class="linkbtn" id="ncback">Back to search</button>`
        : `<input id="bq" class="cmpinput" placeholder="Search customers…" value="${esc(C.query)}" autocomplete="off">
          ${hits.map((c) => `<button class="cmprow" data-bpick="${esc(c.id)}">
            <span class="av sm">${esc((c.first_name || "?").slice(0, 1).toUpperCase())}</span>
            <span class="m"><b>${esc(`${c.first_name} ${c.last_name}`.trim() || c.company || "")}</b>${c.email ? `<span>${esc(c.email)}</span>` : ""}</span>
            <span class="plus">+</span></button>`).join("")}
          <button class="linkbtn" id="bnewc">+ New customer</button>`}
      <div class="lanehead" style="margin-top:12px"><span class="eyebrow">Lines</span></div>
      ${C.lines.map((l, i) => `<div class="cmpline">
        <div class="t"><input class="cmpinput sm" data-bname="${i}" placeholder="Service or product — or a shortcut like MTFR" value="${esc(l.name)}" style="flex:1" autocomplete="off">
          <button class="del" data-bdel="${i}">&#128465;</button></div>
        <div id="bsug${i}" class="scsug"></div>
        <div class="f"><label>Qty<input type="number" min="1" step="1" data-bqty="${i}" value="${l.quantity}"></label>
          <label>Rate<input type="number" min="0" step="0.01" data-brate="${i}" value="${l.rate}"></label></div>
      </div>`).join("") || `<p class="note">Add what's being billed — free-form, priced by you.${C.shortcuts.length ? " Type a shortcut code to fill a line instantly." : ""}</p>`}
      <button class="pillbtn" id="baddline">+ Add line</button>
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
      <input id="bmemo" class="cmpinput sm" placeholder="Note to customer (optional)" value="${esc(C.memo)}">
      <div class="lanehead" style="margin-top:10px"><span class="eyebrow">Subtotal before tax</span><b>${money(subtotal())}</b></div>
      <button class="cta" id="bcreate" ${C.busy || !C.customer || !C.lines.length ? "disabled" : ""}>
        <span><b>${C.busy ? "Creating…" : isEst ? "Create estimate" : "Create invoice"}</b>
          <span>${isEst ? "EST-numbered quote with a share page — posts nothing" : "Numbered + payment link, tax applied"}</span></span></button>
      <p class="note err" id="bcerr"></p>`;
    const q = wrap.querySelector("#bq");
    if (q) { q.oninput = () => { C.query = q.value; paint(); wrap.querySelector("#bq").focus(); const el = wrap.querySelector("#bq"); el.setSelectionRange(el.value.length, el.value.length); }; }
    on("[data-bpick]", "click", (e) => {
      C.customer = C.customers.find((c) => c.id === e.currentTarget.dataset.bpick);
      if (C.customer?.default_terms_days != null) C.termsDays = C.customer.default_terms_days;
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
        C.customers.unshift(r.customer); C.customer = r.customer; C.newCust = false; paint();
      } catch (e) { wrap.querySelector("#bcerr").textContent = e.message; }
    };
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
        C.lines[i] = { name: s.name, description: s.description || "", quantity: C.lines[i].quantity || 1, rate: s.rate, code: s.code };
        paint();
      });
    };
    on("[data-bname]", "input", (e) => {
      const i = Number(e.currentTarget.dataset.bname);
      C.lines[i].name = e.currentTarget.value;
      delete C.lines[i].code;
      paintSuggestions(i, e.currentTarget.value);
    }, body());
    on("[data-bqty]", "input", (e) => { C.lines[Number(e.currentTarget.dataset.bqty)].quantity = e.currentTarget.value; }, body());
    on("[data-brate]", "input", (e) => { C.lines[Number(e.currentTarget.dataset.brate)].rate = e.currentTarget.value; }, body());
    on("[data-bterm]", "click", (e) => { C.termsDays = Number(e.currentTarget.dataset.bterm); paint(); }, body());
    on("[data-bvalid]", "click", (e) => { C.validDays = Number(e.currentTarget.dataset.bvalid); paint(); }, body());
    wrap.querySelector("#bmemo").oninput = (e) => { C.memo = e.target.value; };
    const create = wrap.querySelector("#bcreate");
    if (create) create.onclick = async (e, force) => {
      C.busy = true; paint();
      try {
        const kept = C.lines.filter((l) => l.name.trim());
        const mappedLines = kept.map((l) => ({ name: l.name.trim(), description: l.description || undefined, quantity: Number(l.quantity) || 1, rate: Number(l.rate) || 0 }));
        let r, docId, docNumber;
        if (isEst) {
          r = await booksApi({ action: "estimate-create", customer_id: C.customer.id, lines: mappedLines,
            memo: C.memo, ...(C.validDays > 0 ? { valid_for_days: C.validDays } : {}) });
          docId = r.estimate.id; docNumber = r.estimate.number;
        } else {
          r = await booksApi({ action: "invoice-create", customer_id: C.customer.id, lines: mappedLines,
            memo: C.memo, terms_days: C.termsDays,
            shortcut_codes: kept.map((l) => l.code).filter(Boolean), force: force === true });
          docId = r.invoice.id; docNumber = r.invoice.number;
        }
        toast(`${docNumber || (isEst ? "Estimate" : "Invoice")} created`);
        closeSheet(); loadNativeInvoices();
        const openDoc = () => isEst ? nativeEstimateSheet(docId) : nativeInvoiceSheet(docId);
        // First-use shortcut offer: hand-typed lines the owner might want as a
        // one-tap code next time. Lines filled from a shortcut are skipped.
        const offer = isEst ? [] : kept.filter((l) => !l.code && l.name.trim() && Number(l.rate) > 0 &&
          !C.shortcuts.some((s) => s.name.toLowerCase() === l.name.trim().toLowerCase()));
        if (offer.length) shortcutOfferSheet(offer, C.shortcuts, openDoc);
        else openDoc();
      } catch (err) {
        C.busy = false; paint();
        if (err.status === 409 && err.data?.duplicate_of) {
          if (confirm(err.message + "\n\nCreate anyway?")) return create.onclick(null, true);
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
  let shortcuts = [];
  try { shortcuts = (await booksApi({ action: "shortcuts" })).shortcuts || []; } catch {}
  const br = s.branding || {};
  const template = { v: br.template || "classic" };
  const termsDefault = { v: Number(s.default_terms_days) || 0 };
  const paintShortcuts = () => {
    const box = wrap.querySelector("#sclist");
    if (!box) return;
    box.innerHTML = shortcuts.length ? shortcuts.map((sc) => `
      <div class="cmpline"><div class="t">
        <span style="flex:1"><b>${esc(sc.code)}</b> ${esc(sc.name)} · ${money(sc.rate)}</span>
        <button class="del" data-scdel="${esc(sc.id)}">&#128465;</button></div></div>`).join("")
      : `<p class="note">No shortcuts yet — you'll be offered one after each invoice with a new line item.</p>`;
    box.querySelectorAll("[data-scdel]").forEach((btn) => btn.onclick = async () => {
      await booksApi({ action: "shortcut-delete", id: btn.dataset.scdel }).catch(() => {});
      shortcuts = shortcuts.filter((x) => x.id !== btn.dataset.scdel);
      paintShortcuts();
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
    <label class="emailrow">Tax name<input id="stax" class="cmpinput" value="${esc(s.tax.name)}"></label>
    <label class="emailrow">Tax rate %<input id="srate" type="number" min="0" max="100" step="0.01" class="cmpinput" value="${(Number(s.tax.rate) * 100).toFixed(2)}"></label>
    <label class="emailrow">Tax registration # (shown on invoices)<input id="sreg" class="cmpinput" value="${esc(s.tax.registration_number || "")}"></label>
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
  wrap.querySelector("#ssave").onclick = async () => {
    try {
      await booksApi({ action: "settings-save",
        tax_name: wrap.querySelector("#stax").value, tax_rate: Number(wrap.querySelector("#srate").value) / 100,
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

const FINANCE_TITLE = { invoices: "Finance", profit: "Profit", receipts: "Receipts" };

async function renderFinance() {
  // Which ledger this workspace runs on decides the whole tab: native books
  // hides the Profit lane (a QuickBooks P&L board) and swaps the invoice
  // screens. Cached for the session; a connect/disconnect reloads the app.
  if (S.booksProvider === undefined) {
    try { S.booksProvider = (await booksApi({ action: "settings" })).provider; }
    catch { S.booksProvider = "quickbooks"; }
  }
  const native = S.booksProvider === "native";
  const lane = S.financeLane === "profit" || S.financeLane === "receipts" ? S.financeLane : "invoices";
  view().innerHTML = `<div class="sect">
    ${pageHead(FINANCE_TITLE[lane])}
    <div class="seg">
      <button class="${lane === "invoices" ? "on" : ""}" data-fl="invoices">${segIc("overview")}Overview</button>
      <button class="${lane === "profit" ? "on" : ""}" data-fl="profit">${segIc("profit")}Profit</button>
      <button class="${lane === "receipts" ? "on" : ""}" data-fl="receipts">${segIc("receipts")}Receipts</button>
    </div>
    <div id="finbody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  on("[data-fl]", "click", (e) => { S.financeLane = e.currentTarget.dataset.fl; renderFinance(); });
  if (lane === "profit") { if (native) loadNativeProfit(); else loadProfit(); }
  else if (lane === "receipts") loadReceipts();
  else if (native) loadNativeInvoices();
  else loadInvoices();
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
    const filtered = all.filter((i) => S.invoiceFilter === "all" || i.status === S.invoiceFilter)
      .filter((i) => !S.invoiceSearch || (i.customer + " " + i.doc + " " + (i.email || "")).toLowerCase().includes(S.invoiceSearch));
    // iOS searches customers alongside invoices and lists the matches above them.
    const custHits = !S.invoiceSearch ? [] : (S.qbo?.qbo?.customers || []).filter((c) =>
      (c.name + " " + (c.email || "") + " " + (c.phone || "") + " " + c.id).toLowerCase().includes(S.invoiceSearch)).slice(0, 20);
    slot.innerHTML = `
      ${refreshError ? `<p class="note err">Couldn't refresh — showing the last invoices Ledger loaded. ${esc(refreshError)}</p>` : ""}
      ${salesIntel(all, k)}
      <button class="cta" id="newinv">
        <span class="ic">&#43;</span>
        <span><b>Create Invoice</b><span>Draft, review, post to QuickBooks</span></span>
      </button>
      <button class="cta ghost" id="newest">
        <span class="ic">&#128221;</span>
        <span><b>Create Estimate</b><span>A quote on QuickBooks' EST numbering — posts nothing</span></span>
      </button>
      <div class="searchwrap"><span class="mag">${MAG}</span>
        <input id="invsearch" placeholder="Customer, invoice, email or phone" value="${esc(S.invoiceSearch || "")}"></div>
      <div class="chips">
        ${[["all", "All"], ["open", "Open"], ["paid", "Paid"]].map(([k2, l]) =>
          `<button class="chip ${S.invoiceFilter === k2 ? "on" : ""}" data-if="${k2}">${l}</button>`).join("")}
      </div>
      <div class="lanehead"><span class="eyebrow">${S.invoiceSearch ? "Search results" : "Operations"}</span>
        ${S.invoiceSearch ? `<button class="linkbtn" id="clrsearch">Clear</button>` : ""}</div>
      ${!S.invoiceSearch ? `<div class="opsgrid">
        <button class="opcard purple" data-op="profit"><span class="ic">&#9650;</span><b>Profit &amp; Loss</b>
          <span>Daily sweep &amp; trends</span><em>OPEN &#8599;</em></button>
        <button class="opcard em" data-op="receipts"><span class="ic">&#128229;</span><b>Receipt Queue</b>
          <span>Review &amp; batch</span><em>OPEN &#8599;</em></button>
      </div>` : ""}
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
      <div class="lanehead"><span class="eyebrow" style="color:var(--dim)">${S.invoiceSearch ? "Matching invoices" : "Recent invoices"}</span>
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
    <div class="pspark">${days.map((d, i) =>
      `<div class="b ${i === days.length - 1 ? "hot" : ""}" style="height:${Math.max(Math.round(d.total / max * 100), 3)}%" title="${d.key}: ${money0(d.total)}"></div>`).join("")}</div>
    <div class="sparkends"><span>14 days ago</span><span>Today</span></div>
    <div class="kpis" style="margin-top:15px">
      <div class="kpi cyan"><small>Today</small><b>${money0(k.today_sales)}</b></div>
      <div class="kpi em"><small>Year to date</small><b>${money0(k.ytd_sales)}</b></div>
      <div class="kpi gold"><small>Outstanding</small><b>${money0(k.outstanding)}</b><i>${k.open_count ?? 0} open</i></div>
      <div class="kpi purple"><small>Open invoices</small><b>${k.open_count ?? 0}</b><i>Next #${esc(k.next_invoice ?? "—")}</i></div>
      <div class="kpi cyan"><small>Avg sale</small><b>${money(avg)}</b><i>${month.length} invoice${month.length === 1 ? "" : "s"} this month</i></div>
      <div class="kpi orange"><small>Forecast</small><b>${forecastReady ? money(forecast) : "—"}</b><i>${forecastReady ? "month-end run rate" : "after a week of sales"}</i></div>
    </div>
    <p class="infoline"><em>&#9432;</em>Run rate projects this month's pace across the full month — it is not a promise.</p>
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
      <div class="f"><label>Qty<input type="number" min="1" step="1" data-qty="${i}" value="${l.quantity}"></label>
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
      ${isEst ? "" : termsRow(d.terms)}
      ${d.customer_email ? `<label class="emailrow"><input type="checkbox" id="cmpem" checked> Email to ${esc(d.customer_email)}${(d.customer_email_cc || []).length ? ` · cc ${esc(d.customer_email_cc.join(", "))}` : ""}${d.recipients_locked ? ` <span class="note">(your standing rule for this customer)</span>` : ""}</label>` : ""}
      <label class="emailrow"><input type="checkbox" id="cmppr" ${localStorage.getItem("ledger.printAfterPosting") === "1" ? "checked" : ""}> Print after posting</label>
      <div class="row"><button class="btn cancel" id="cmpcancel">Cancel</button><button class="btn confirm" id="cmpconfirm">Confirm</button></div>
      <div class="note" id="cmpnote" style="margin-top:9px"></div></div>`;
    const note = body().querySelector("#cmpnote");
    const draftBtns = () => [body().querySelector("#cmpconfirm"), body().querySelector("#cmpcancel")].filter(Boolean);
    body().querySelector("#cmppr").onchange = (e) => localStorage.setItem("ledger.printAfterPosting", e.target.checked ? "1" : "0");
    body().querySelector("#cmpconfirm").onclick = async () => {
      draftBtns().forEach((b) => b.disabled = true);
      const sendEmail = body().querySelector("#cmpem")?.checked ?? false;
      const wantPrint = body().querySelector("#cmppr")?.checked ?? false;
      try {
        const terms = body().querySelector(".tm")?.value;
        const r = await api(isEst ? "/quickbooks-invoice/estimate-confirm" : "/quickbooks-invoice/confirm",
          { draft_id: d.draft_id, send_email: sendEmail, ...(terms ? { terms } : {}) });
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
      try { await api(isEst ? "/quickbooks-invoice/estimate-cancel" : "/quickbooks-invoice/cancel", { draft_id: d.draft_id }); } catch {}
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
    on("[data-qty]", "change", (e) => { C.lines[Number(e.currentTarget.dataset.qty)].quantity = Math.max(1, Number(e.currentTarget.value) || 1); draw(); }, body());
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
  wrap.innerHTML = `<div class="sheet-back"></div><div class="sheet"><div class="grab"></div>
    <h2>Billable Items</h2>
    <input id="pickq" class="cmpinput" placeholder="Search items" autocomplete="off">
    <div id="picklist" class="cmpsect"></div>
    <button class="sheet-close" id="pickclose">Close</button></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
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
    <div class="rowbtns" style="margin-top:14px">
      <button class="btn ghost" id="sharepdf">Share PDF</button>
      <button class="btn primary" id="printpdf">Print</button>
    </div>
    ${back ? `<button class="btn ghost" id="invback" style="margin-top:9px;width:100%">&#8592; Back to ${esc(inv.customer || "customer")}</button>` : ""}
    <div class="note" id="pdfnote" style="margin-top:9px"></div>`, (sh) => {
    if (back) sh.querySelector("#invback").onclick = () => back();
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
async function loadNativeProfit() {
  const slot = $("finbody"); if (!slot) return;
  let summary;
  try { summary = await booksApi({ action: "summary" }); }
  catch (e) { slot.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const months = (summary.months || []).slice(-12).reverse();
  const nowKey = new Date().toISOString().slice(0, 7);
  const cur = months.find((m) => m.month === nowKey) || { income: 0, expenses: 0, net: 0 };
  const ytdRows = months.filter((m) => m.month.slice(0, 4) === nowKey.slice(0, 4));
  const ytdNet = ytdRows.reduce((s, m) => s + Number(m.net || 0), 0);
  const monthLabel = (k) => new Date(k + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  slot.innerHTML = `
    <div class="fintiles">
      <div class="fintile"><small>THIS MONTH NET</small><b>${money(cur.net || 0)}</b></div>
      <div class="fintile"><small>YEAR TO DATE NET</small><b>${money(ytdNet)}</b></div>
    </div>
    <div class="panel">
      <h3>&#128200; Month by month</h3>
      <p class="sub">Income is payments received; expenses are the costs you've logged on jobs and receipts.</p>
    </div>
    ${months.length ? `<div class="list">${months.map((m) => `
      <div class="item">
        <div class="main"><div class="ttl">${esc(monthLabel(m.month))}</div>
          <div class="sub">${money(m.income || 0)} in &middot; ${money(m.expenses || 0)} out</div></div>
        <div class="amt" style="color:${Number(m.net || 0) >= 0 ? "var(--emerald)" : "var(--red)"}">${money(m.net || 0)}</div>
      </div>`).join("")}</div>`
    : `<div class="panel" style="text-align:center"><p class="sub" style="margin:0">No activity yet — your first paid invoice starts this board.</p></div>`}`;
}

async function loadProfit() {
  const slot = $("finbody"); if (!slot) return;
  let refreshError = null;
  try {
    if (!S.profit || S.profitStale) { S.profit = (await get("/profit/board")).board || {}; S.profitStale = false; }
  } catch (e) {
    if (!S.profit) {
      slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo") : `<div class="empty">${esc(e.message)}</div>`;
      wireConnect(slot);
      return;
    }
    refreshError = e.message; // keep showing the last profit board Ledger loaded
  }
  if (!S.receipts) { try { S.receipts = (await get("/gmail/receipts")).receipts || []; } catch { S.receipts = []; } }
  drawProfit(refreshError);
}

function drawProfit(refreshError) {
  const slot = $("finbody"); if (!slot) return;
  const p = S.profit || {};
  const series = (p[S.profitRange] || []).slice(-14);
  const today = p.today || {};
  const swept = today.date === localDay();
  const unposted = (S.receipts || []).filter((r) => !r.qbo_purchase_id && r.category !== "Personal").length;
  const max = Math.max(1, ...series.map((s) => Math.abs(s.net_profit || 0)));
  const income = today.total_income || 0, costs = today.total_expenses || 0;
  const margin = income > 0 ? Math.round((today.net_profit || 0) / income * 100) : 0;
  const total = series.reduce((t, x) => t + (x.net_profit || 0), 0);
  const best = series.reduce((b, x) => (!b || (x.net_profit || 0) > (b.net_profit || 0) ? x : b), null);
  slot.innerHTML = `
    ${refreshError ? `<p class="note err">Couldn't refresh the profit board — showing the last numbers Ledger has. ${esc(refreshError)}</p>` : ""}
    <div class="hero">
      <div class="headline"><span class="eyebrow">Today's profit</span>
        <span class="when">${esc(today.date || localDay())}</span></div>
      ${swept ? `<div class="big" style="color:${(today.net_profit || 0) >= 0 ? "var(--emerald)" : "var(--red)"}">${money(today.net_profit)}</div>
      <div class="trio">
        <div><small>Income</small><b style="color:var(--cyan)">${money0(income)}</b></div>
        <div><small>Expenses</small><b style="color:var(--orange)">${money0(costs)}</b></div>
        <div><small>Margin</small><b style="color:var(--magenta)">${margin}%</b></div>
      </div>` : `<div class="big" style="color:var(--dim)">Not yet swept</div>
      <p class="note" style="margin-top:6px">Today isn't counted yet — that's not a $0 day, it lands after the ${String(p.sweep_hour ?? 18).padStart(2, "0")}:30 sweep.</p>`}
    </div>
    ${unposted ? `<div class="warnstrip"><em>&#9888;</em><span>${unposted} receipt${unposted === 1 ? " isn't" : "s aren't"} posted to QuickBooks yet — ${unposted === 1 ? "it won't" : "they won't"} count in tonight's sweep.</span></div>` : ""}
    <div class="panel">
      <div class="eyebrow" style="margin-bottom:12px">Profit trend</div>
      <div class="seg">${[["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]].map(([k, l]) =>
        `<button class="${S.profitRange === k ? "on" : ""}" data-pr="${k}">${l}</button>`).join("")}</div>
      ${series.length ? `<div class="bars">${series.map((s) => {
        const h = Math.round(Math.abs(s.net_profit || 0) / max * 100);
        return `<div class="b ${(s.net_profit || 0) < 0 ? "neg" : ""}" style="height:${Math.max(h, 2)}%" title="${esc(s.label || s.date)}: ${money0(s.net_profit)}"></div>`;
      }).join("")}</div>
      <div class="barlabels">${series.map((s, i) => `<span>${i % 2 === 0 ? esc((s.label || s.date || "").slice(-5)) : ""}</span>`).join("")}</div>
      <p class="note" style="margin-top:11px">Total ${money(total)}${best ? " · best " + esc((best.label || best.date || "").slice(-5)) + ": " + money(best.net_profit) : ""}</p>`
      : `<div class="empty">No snapshots yet — run a sweep to fill the board.</div>`}
    </div>
    ${costPanel(p.cost_of_operations || {})}
    <div class="panel">
      <div style="display:flex;align-items:center;gap:9px">
        <span class="eyebrow" style="color:var(--emerald)">Profit sweep</span>
        <span class="note" style="margin-left:auto;font-family:var(--mono);font-size:10.5px;letter-spacing:1.1px">AUTO AT ${String(p.sweep_hour ?? 18).padStart(2, "0")}:30</span>
      </div>
      <p class="sub" style="margin-top:9px">One button, the whole day: pulls today's receipts from your email, walks you through each one — today's cost, not a cost, or a future job — then locks the day's profit.</p>
      <p class="note" style="margin-top:8px">${p.last_sweep_at ? "Last sweep " + esc(new Date(p.last_sweep_at).toLocaleString()) : "Never swept"} · ${p.snapshot_count || 0} days on file · runs by itself every evening too</p>
      <button class="btn em wide" style="margin-top:13px" id="sweep">&#8635;&nbsp; Profit sweep</button>
    </div>`;
  on("[data-pr]", "click", (e) => { S.profitRange = e.currentTarget.dataset.pr; drawProfit(); }, slot);
  wireCostPanel(slot);
  $("sweep").onclick = () => runProfitSweep();
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
  sheet(`<h2>Profit sweep</h2>
    <p class="sh-sub" id="psStage">Pulling today's receipts from your email…</p>
    <div class="note" id="psNote" style="margin-top:8px"></div>`);
  const stage = (t) => { const el = document.querySelector("#psStage"); if (el) el.textContent = t; };
  let scanNote = "", gmailNeeds = "";
  try { await api("/gmail/scan", {}); }
  catch (e) { scanNote = "Email scan skipped — " + e.message; if (/reconnect|not connected/i.test(e.message)) gmailNeeds = e.message; } // Gmail down or not connected: sweep what we have
  // "Match, don't move" (Kyle 2026-09-05): read each supplier invoice line by
  // line so the matcher can find the sale it fed. This tap is explicit intent,
  // so it reads a bigger batch than the nightly scan does.
  stage("Reading supplier invoices line by line…");
  try { const r = await api("/gmail/read-lines", { limit: 15 }); if (r.skipped && !gmailNeeds) gmailNeeds = r.skipped; }
  catch { /* lines are a bonus; the sweep still runs on what is on file */ }
  stage("Sweeping the books and matching costs to jobs…");
  let sweepResult;
  try { sweepResult = await api("/profit/sweep", {}); applyBoard(sweepResult); }
  catch (e) { toast(e.message, "err"); closeSheet(); return; }
  const tally = { confirmed: 0, excluded: 0, parked: 0, classified: 0, added: 0, matched: 0, waiting: 0, stock: 0, scanNote, gmailNeeds };
  const review = sweepResult.match || { auto: [], proposed: [], waiting: [], new_vendors: [], unread_count: 0 };
  // Costs the matcher doesn't handle (fuel, supplies, meals) still get the old
  // "is this today's cost?" pass — those are day-of costs, no sale to find.
  let cards = [];
  try { cards = ((await get("/profit/day-review")).cards || []).filter((c) => !MATCHABLE_CLASSES.has(c.cost_class) && !c.vendor_pending); }
  catch { /* the board already updated; a review hiccup shouldn't eat the sweep */ }
  const after = () => psCard(cards, 0, tally);
  const nothingToMatch = !review.auto.length && !review.proposed.length && !review.waiting.length
    && !review.new_vendors.length && !review.unread_count && !gmailNeeds
    && !(review.returns || []).length && !(review.credits || []).length;
  // Nothing arrived by email and nothing is on file for today at all — the one
  // moment the sweep volunteers a question, because it is the owner's explicit
  // tap that got us here, not a background nag.
  if (nothingToMatch && !cards.length && sweepResult?.sweep_empty_today) { psEmptyDay(tally); return; }
  if (nothingToMatch) { after(); return; }
  if (review.new_vendors.length) { psNewVendors(review.new_vendors, tally, after); return; }
  psMatchScreen(review, tally, after);
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
          <button class="linkbtn" data-msunlink="${a.id}">Not this one</button>
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
      <button class="btn ghost wide" data-mspick="${c.id}" data-rej="${s ? s.id : ""}">${s ? "Different invoice" : "Pick the invoice"}</button>
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
  } catch (e) { toast(e.message, "err"); closeSheet(); }
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
    sh.querySelector("#cdDel")?.addEventListener("click", (e) => {
      if (!confirm(`Delete the ${money(x.amount)} cost from ${x.vendor}?`)) return;
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
const CAL = { sel: null, month: null, q: "" };
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
    <div class="rshead">&#128421; TODAY'S RUN SHEET</div>
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

  view().innerHTML = `<div class="sect">
    ${pageHead("Calendar")}
    <div class="searchwrap"><span class="mag">${MAG}</span>
      <input id="calsearch" placeholder="Search selected day" value="${esc(CAL.q)}"></div>
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
    <div class="bookcal">
      <div class="bchead">
        <div><span class="eyebrow">Booking calendar</span>
          <b>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b></div>
        <div class="nav"><button data-mo="-1">&#8249;</button><button data-mo="0">TODAY</button><button data-mo="1">&#8250;</button></div>
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
      <span class="m"><b>BOOK ${selDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}</b>
        <span>Live availability · verified Calendar write</span></span>
      <span class="go">&#8599;</span></button>
    <button class="bookbtn" id="crewbtn">
      <span class="ic">&#128119;</span>
      <span class="m"><b>CREW</b>
        <span>Hours, time cards, roster &amp; shifts</span></span>
      <span class="go">&#8599;</span></button>
    <div class="dayhead">
      <div><span class="eyebrow">Day schedule</span>
        <b>${selDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</b></div>
      <span class="rel">${esc(relLabel)}</span><span class="cnt">${dayEvents.length}</span>
    </div>
    ${dayEvents.length ? `<div class="list">${dayEvents.map((e) => {
      const past = new Date(e.end || e.start) < now;
      return `<button class="item${past ? " past" : ""}" data-ev="${esc(e.id)}">
        <div class="main"><div class="ttl">${e.id === nextSelId ? '<span class="tag new">NEXT</span> ' : ""}${esc(e.title)}</div>
          <div class="sub">${esc(timeLabel(e.start))}${e.location ? " · " + esc(e.location) : ""}</div></div>
        <div class="amt"><small>${esc((e.status || "").toUpperCase())}</small></div></button>`;
    }).join("")}</div>`
      : `<button class="empty tapable" id="bookempty">This day is open.<br>Tap to create a verified appointment.</button>`}
  </div>`;

  const search = $("calsearch");
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
  $("crewbtn").onclick = () => crewHoursSheet();
  if ($("bookempty")) $("bookempty").onclick = () => bookingSheet(CAL.sel);
}

// Appointment detail — the web twin of iOS CalendarDetailView (edit + delete).
// `back` is optional: set when opened from inside another sheet, so Close isn't
// the only way out.
function eventSheet(e, back) {
  if (!e) return;
  sheet(`<h2>${esc(e.title)}</h2>
    <p class="sh-sub">${esc(dayLabel(e.start))} · ${esc(timeLabel(e.start))}${e.end ? " – " + esc(timeLabel(e.end)) : ""}</p>
    <div class="kv"><span>Status</span><span>${esc((e.status || "confirmed").replace(/^./, (c) => c.toUpperCase()))}</span></div>
    ${e.location ? `<div class="kv"><span>Location</span><span>${esc(e.location)}</span></div>` : ""}
    ${e.description ? `<p class="note" style="white-space:pre-wrap;margin-top:11px">${esc(e.description)}</p>` : ""}
    <button class="btn primary wide" style="margin-top:14px" id="evscan">&#128663; Scan VIN &amp; close job</button>
    <p class="note" style="margin-top:6px">Scan the VIN and door placard, type the kilometres, and the completion message is ready to send. Nothing is invoiced.</p>
    <div class="rowbtns" style="margin-top:12px">
      <button class="btn ghost" id="evdel">Delete</button>
      <button class="btn ghost" id="evedit" ${e.all_day ? "disabled" : ""}>Edit</button>
    </div>
    ${back ? `<button class="btn ghost wide" style="margin-top:9px" id="evback">&#8592; Back</button>` : ""}
    <div class="note" id="evnote" style="margin-top:9px"></div>`, (sh) => {
    const note = sh.querySelector("#evnote");
    if (back) sh.querySelector("#evback").onclick = () => back();
    sh.querySelector("#evscan").onclick = () => vehicleScanSheet(e, () => eventSheet(e, back));
    sh.querySelector("#evedit").onclick = () => bookingSheet(evDayKey(e.start), e);
    sh.querySelector("#evdel").onclick = async (ev) => {
      if (!confirm(`Delete "${e.title}" from the calendar? This can't be undone.`)) return;
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
function bookingSheet(dayISO, editing) {
  const base = editing ? new Date(editing.start) : new Date(dayISO + "T09:00:00");
  const now = new Date();
  const startAt = !editing && base < now ? new Date(now.getTime() + 3600000) : base;
  const localVal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const mins = editing && editing.end ? Math.max(15, Math.round((new Date(editing.end) - new Date(editing.start)) / 60000)) : 60;

  sheet(`<h2>${editing ? "Edit Appointment" : "New Appointment"}</h2>
    ${editing ? `<label class="fld">TITLE</label><input id="bkTitle" class="cmpinput" value="${esc(editing.title)}">`
      : `<div class="eyebrow">Customer</div>
    <div class="cmpsect">
      <input id="bkFirst" class="cmpinput" placeholder="First name">
      <input id="bkLast" class="cmpinput" placeholder="Last name">
      <input id="bkPhone" class="cmpinput" inputmode="tel" placeholder="Phone">
      <input id="bkEmail" class="cmpinput" inputmode="email" placeholder="Email">
    </div>
    <div class="eyebrow">Appointment</div>
    <div class="cmpsect">
      <input id="bkService" class="cmpinput" placeholder="Service">
      <input id="bkVehicle" class="cmpinput" placeholder="Vehicle — year, make, model, trim">
      <input id="bkTire" class="cmpinput" placeholder="Tire size, if relevant">
    </div>`}
    <label class="fld">STARTS</label>
    <input id="bkStart" class="cmpinput" type="datetime-local" value="${localVal(startAt)}">
    <label class="fld">DURATION</label>
    <select id="bkDur" class="cmpinput">${[30, 45, 60, 90, 120].map((n) =>
      `<option value="${n}" ${n === mins ? "selected" : ""}>${n < 60 ? n + " minutes" : n === 60 ? "1 hour" : (n / 60) + " hours"}</option>`).join("")}</select>
    ${editing ? `<label class="fld">LOCATION</label><input id="bkLoc" class="cmpinput" value="${esc(editing.location || "")}">
      <label class="fld">DETAILS</label><textarea id="bkNotes" class="cmpinput" rows="4">${esc(editing.description || "")}</textarea>`
      : `<div class="eyebrow" style="margin-top:13px">Source &amp; job details</div>
    <div class="cmpsect">
      <select id="bkSource" class="cmpinput">${BOOK_SOURCES.map((x) => `<option>${x}</option>`).join("")}</select>
      <textarea id="bkNotes" class="cmpinput" rows="4" placeholder="Pricing, order status and job notes"></textarea>
    </div>`}
    <button class="btn primary wide" style="margin-top:13px" id="bkGo">${editing ? "Save changes" : "Review &amp; Add Booking"}</button>
    <p class="note" style="margin-top:9px">The calendar is checked live for conflicts before anything is created.</p>
    <div class="note" id="bkNote" style="margin-top:6px"></div>`, (sh) => {
    const note = sh.querySelector("#bkNote");
    const val = (id) => (sh.querySelector("#" + id)?.value || "").trim();
    sh.querySelector("#bkGo").onclick = async (ev) => {
      const startVal = val("bkStart");
      if (!startVal) { note.className = "note err"; note.textContent = "Pick a start time."; return; }
      const start = new Date(startVal);
      const end = new Date(start.getTime() + Number(val("bkDur") || 60) * 60000);
      try {
        if (editing) {
          ev.currentTarget.disabled = true;
          await api("/google-calendar/event-update", {
            event_id: editing.id, title: val("bkTitle"), start: start.toISOString(), end: end.toISOString(),
            location: val("bkLoc"), description: val("bkNotes"),
          });
          S.cal = null; closeSheet(); toast("Appointment updated"); renderCalendar();
          return;
        }
        const required = ["bkFirst", "bkLast", "bkPhone", "bkEmail", "bkVehicle", "bkService"];
        if (required.some((id) => !val(id))) { note.className = "note err"; note.textContent = "Fill in name, phone, email, vehicle and service."; return; }
        if (!confirm(`Create this booking?\n\n${val("bkService")} for ${val("bkFirst")} ${val("bkLast")}\n${start.toLocaleString()}`)) return;
        ev.currentTarget.disabled = true;
        const details = [
          `Phone: ${val("bkPhone")}`, `Email: ${val("bkEmail")}`, `Vehicle: ${val("bkVehicle")}`,
          val("bkTire") ? `Tire size: ${val("bkTire")}` : null,
          `Source: ${val("bkSource")}`, val("bkNotes") ? `Notes: ${val("bkNotes")}` : null,
        ].filter(Boolean).join("\n");
        await api("/google-calendar/bookings", {
          title: `${val("bkFirst")} ${val("bkLast")} — ${val("bkService")}`,
          description: details, email: val("bkEmail"),
          start: start.toISOString(), end: end.toISOString(),
        });
        S.cal = null; closeSheet(); toast("Appointment booked"); renderCalendar();
      } catch (e) { ev.currentTarget.disabled = false; note.className = "note err"; note.textContent = e.message; }
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
        <div class="fintile warn"><span class="tic" style="background:rgba(251,146,60,.15);color:var(--orange)">&#8987;</span><small>UNPOSTED</small><b>${money(unpostedValue)}</b><i>${unposted.length === 1 ? "1 waiting" : unposted.length + " waiting"}</i></div>
      </div>
      <div class="lanehead"><span class="eyebrow">Intake</span><span class="note">camera · library</span></div>
      <div class="panel">
        <h3>&#9635; Capture a receipt</h3>
        <p class="sub">Shoot it and Ledger reads the vendor, total and tax, then files it for QuickBooks.</p>
        <div class="rowbtns" style="margin-top:12px">
          <button class="cta" id="rcptshoot" style="flex:1;margin:0">
            <span class="ic">&#128247;</span>
            <span><b>Photograph</b><span>Reads it for you</span></span>
          </button>
          <button class="btn ghost" id="rcptpick" style="flex:0 0 auto;display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;min-width:78px">&#128444;<small style="font-size:10px;font-weight:800;letter-spacing:.6px">LIBRARY</small></button>
        </div>
        <label class="preclass" style="margin-top:12px;display:flex;align-items:center;gap:9px;padding:11px 13px;border-radius:13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09)">
          <span style="color:var(--gold)">&#127991;</span>
          <span style="font-size:10px;font-weight:800;letter-spacing:1.3px;color:var(--dim)">PRE-CLASSIFY</span>
          <select id="preclassify" style="margin-left:auto;background:none;border:0;color:var(--gold);font-weight:700;font-family:inherit;text-align:right">
            <option value="">Let Ledger read it</option>
            ${Object.entries(CATEGORIES).map(([g, cats]) => `<optgroup label="${esc(g)}">${cats.map((c) =>
              `<option value="${esc(c)}" ${S.preClassify === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</optgroup>`).join("")}
          </select>
        </label>
      <button class="queue" id="batchqueue">
        <div class="ic">&#128229;</div>
        <div class="m"><small>QuickBooks batch queue</small>
          <b>${ready.length} queued · ${money(queueTotal)}</b>
          <span>Categorised receipts waiting to post as expenses.</span></div>
        <div class="chev">&#8250;</div>
      </button>
        <input type="file" id="rcptcam" accept="image/*" capture="environment" hidden>
        <input type="file" id="rcptlib" accept="image/*" hidden>
        <p class="note" id="rcptcamnote" style="margin-top:8px"></p>
      </div>
      <div class="lanehead"><span class="eyebrow" style="color:var(--red)">Cost ledger</span><span class="note">${S.receipts.length === 1 ? "1 record" : S.receipts.length + " records"}</span></div>
      <div class="panel" style="border-color:rgba(248,113,113,.35);box-shadow:0 0 18px rgba(248,113,113,.08)">
        <h3 style="color:var(--red)">&#128231; Receipt Radar</h3>
        <p class="sub">Ledger scans your inbox daily at ${hourLabel(d.scan_hour ?? 18)} for receipts and supplier invoices. Photos land here too.</p>
        <div class="rowbtns" style="margin-top:12px;align-items:center">
          <select id="scanhour" class="hourpick" title="Daily scan time">
            ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === (d.scan_hour ?? 18) ? "selected" : ""}>Daily at ${hourLabel(h)}</option>`).join("")}
          </select>
          <button class="btn em" id="scannow" style="background:linear-gradient(140deg,rgba(248,113,113,.85),rgba(251,146,60,.85));color:#fff;border:0">&#8635; Scan now</button>
          ${ready.length >= 2 ? `<button class="btn em" id="batch">Post all ready (${ready.length})</button>` : ""}
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
            <small>${r.qbo_purchase_id ? '<span class="tag paid">posted</span>'
              : r.category === "Personal" ? '<span class="tag grey">personal</span>'
              : r.category ? '<span class="tag new">ready</span>' : '<span class="tag open">needs category</span>'}</small></div>
        </button>`).join("")}</div>`
        : `<div class="empty">${rq ? "No receipts match that search." : "No receipts found yet.<br>Run a scan, or forward one to your inbox."}</div>`}`;
    $("rcptshoot").onclick = () => $("rcptcam").click();
    $("rcptpick").onclick = () => $("rcptlib").click();
    // Pre-classify is a hint, same as iOS: Ledger's own read of the photo wins;
    // this fills the category only when the read comes back without one.
    $("preclassify").onchange = (e) => { S.preClassify = e.target.value || null; };
    $("rcptcam").onchange = (e) => captureReceipt(e.target.files?.[0]);
    $("rcptlib").onchange = (e) => captureReceipt(e.target.files?.[0]);
    $("scannow").onclick = async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = "Scanning…";
      try { await api("/gmail/scan", {}); toast("Scan complete"); loadReceipts(); }
      catch (err) { toast(err.message, "err"); loadReceipts(); }
    };
    if ($("batch")) $("batch").onclick = () => batchPost(ready);
    $("batchqueue").onclick = () => batchQueueSheet(ready, queueTotal);
    $("scanhour").onchange = async (e) => {
      const hour = Number(e.target.value);
      try { await api("/gmail/set-schedule", { hour }); toast("Daily scan set to " + hourLabel(hour)); }
      catch (err) { toast(err.message, "err"); loadReceipts(); }
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
    toast(err.message, "err");
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
  } catch (err) { toast(err.message, "err"); }
}

function receiptSheet(r, suggestedCategory) {
  if (!r) return;
  // A photo arrives uncategorised on purpose; pre-select Ledger's read so it is
  // one tap to accept and still a deliberate choice, not an automatic one.
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
    ${r.qbo_purchase_id ? `<p class="note ok" style="margin-top:10px">Already in QuickBooks.</p>`
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
      if (!confirm("Dismiss this receipt? There's no undo for this in the app.")) return;
      e.currentTarget.disabled = true;
      try { await api("/gmail/dismiss", { id: r.id }); closeSheet(); loadReceipts(); }
      catch (err) { e.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
    };
    const post = sh.querySelector("#rpost");
    if (post) post.onclick = async () => {
      const dup = duplicateOf(r);
      if (dup && !confirm(`Another receipt from ${dup.vendor || dup.from_name || "the same vendor"} for ${money(dup.total)} on the same day is already logged. Post this one too?`)) return;
      post.disabled = true; note.className = "note"; note.textContent = "Looking up vendors…";
      try {
        await save();
        const v = await api("/quickbooks-invoice/expense-vendors", { receipt_id: r.id });
        const vendors = v.vendors || [];
        note.innerHTML = `<label class="fld">VENDOR</label><select id="rvend">${
          vendors.map((x) => `<option value="${esc(x.id)}" ${x.id === v.suggestedId ? "selected" : ""}>${esc(x.name)}</option>`).join("")
        }</select><button class="btn em wide" style="margin-top:9px" id="rgo">Post expense</button>`;
        note.querySelector("#rgo").onclick = async (e2) => {
          e2.currentTarget.disabled = true;
          try {
            await api("/quickbooks-invoice/expense-post", { receipt_id: r.id, vendor_id: note.querySelector("#rvend").value });
            closeSheet(); toast("Posted to QuickBooks"); loadReceipts();
          } catch (err) { e2.currentTarget.disabled = false; toast(err.message, "err"); }
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

async function renderPhone() {
  skeleton(3);
  try {
    const d = await api("/phone", { action: "board" });
    S.phone = d;
    view().innerHTML = `<div class="sect">
      ${pageHead("Phone")}
      ${d.hasNumber ? "" : requestNumberCard(d.pendingRequest, d.numberLocked)}
      ${/* The number and its setup guide sit ABOVE the lane switcher, not in a
            lane. Call forwarding is the thing that has to be working before any
            of this tab means anything, and a setup guide found at the bottom of
            a third sub-tab is a setup guide nobody reads. */""}
      ${d.hasNumber ? phoneStatusRail(d) : ""}
      ${d.hasNumber ? phoneLaneSwitcher(d) : ""}
      ${d.hasNumber ? phoneLaneBody(d) : ""}
    </div>`;
    if (!d.hasNumber) wireRequestNumber(d.pendingRequest, d.numberLocked);
    if (d.hasNumber) on("[data-pevt]", "click", (e) => phoneEventSheet(d.events.find((ev) => ev.id === e.currentTarget.dataset.pevt)));
    if (d.hasNumber) on("[data-pthread]", "click", (e) => phoneThreadSheet((d.threads || []).find((t) => t.id === e.currentTarget.dataset.pthread)));
    if (d.hasNumber) {
      if ($("phsetup")) $("phsetup").onclick = () => phoneSetupSheet(d);
      if ($("phsettings")) $("phsettings").onclick = () => phoneSettingsSheet(d);
      on("[data-plane]", "click", (e) => { S.phoneLane = e.currentTarget.dataset.plane; renderPhone(); });
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
      if (!localStorage.getItem(seenKey)) { localStorage.setItem(seenKey, "1"); phoneSetupSheet(d); }
      if (phoneLane() === "inbox") loadVoicemails(d);
      if (phoneLane() === "activity") loadPhoneLeads();
    }
  } catch (e) {
    view().innerHTML = `<div class="sect">${pageHead("Phone")}<div class="empty">${esc(e.message)}</div></div>`;
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
    return `<button class="item thitem${unread ? " unread" : ""}" data-pthread="${esc(t.id)}">
      <div class="main">
        <div class="ttl">${esc(t.peerName || formatE164(t.peerNumber))}${unread ? '<span class="thdot"></span>' : ""}</div>
        <div class="sub">${esc(body)}</div>
      </div>
      <div class="thmeta">
        <small>${esc(t.lastMessageAt ? dayLabel(t.lastMessageAt) + " " + timeLabel(t.lastMessageAt) : "")}</small>
        ${unread ? '<span class="tag open">reply</span>' : isDone ? '<span class="thdone">&#10003;</span>' : ""}
      </div>
    </button>`;
  };
  return `<div class="lanehead"><span class="eyebrow">Text threads</span>
      <span class="note">${awaiting > 0 ? awaiting + " awaiting reply" : open.length + " open"}</span></div>
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
  const chat = wrap.querySelector("#phchat");
  const err = wrap.querySelector("#pherr");
  const showErr = (msg) => { err.style.display = "block"; err.className = "note err"; err.textContent = msg; };

  async function load(markRead) {
    try {
      const d = await api("/phone", { action: "thread", conversation_id: t.id });
      status = (d.thread && d.thread.status) || status;
      chat.innerHTML = (d.messages || []).length
        ? d.messages.map(phoneBubble).join("")
        : `<div class="empty">No messages in this thread yet.</div>`;
      chat.scrollTop = chat.scrollHeight;
      err.style.display = "none";
    } catch (e) { showErr(e.message); chat.innerHTML = ""; }
    // Opening a thread IS reading it — fired after the history lands so a
    // failed read never leaves the sheet blank. Mirrored into Quo server-side.
    if (markRead && (t.unreadCount || 0) > 0) {
      try { await api("/phone", { action: "thread-read", conversation_id: t.id }); renderPhone(); } catch (e) { /* non-fatal */ }
    }
  }

  wrap.querySelector("#phsend").onclick = async (e) => {
    const field = wrap.querySelector("#phdraft");
    const body = field.value.trim();
    if (!body) return;
    e.currentTarget.disabled = true;
    try {
      await api("/phone", { action: "reply", conversation_id: t.id, to_number: t.peerNumber, body });
      field.value = "";
      await load(false);
      renderPhone();
    } catch (ex) { showErr(ex.message); smsSendFailed(ex); }
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
  return `<div class="lanehead"><span class="eyebrow">Missed-call feed</span><span class="note">${events.length} logged</span></div>
    ${events.length ? `<div class="list">${events.map((ev) => `
      <button class="item" data-pevt="${esc(ev.id)}">
        <div class="main">
          <div class="ttl">${esc(formatE164(ev.callerNumber) || "Unknown caller")}</div>
          <div class="sub">${esc(dayLabel(ev.occurredAt))} · ${esc(timeLabel(ev.occurredAt))}${ev.voicemailUrl ? " · 🎙 voicemail" : ""}</div>
        </div>
        <div class="amt"><small>${phoneEventBadge(ev)}</small></div>
      </button>`).join("")}</div>`
      : `<div class="empty">No missed calls yet. When one comes in, it shows up here within seconds.</div>`}`;
}

function phoneEventSheet(ev) {
  if (!ev) return;
  sheet(`<h2>${esc(formatE164(ev.callerNumber) || "Unknown caller")}</h2>
    <p class="sh-sub">${esc(dayLabel(ev.occurredAt))} · ${esc(timeLabel(ev.occurredAt))} · ${esc(ev.direction)} · ${esc(ev.status)}</p>
    ${ev.voicemailUrl ? `<audio controls src="${esc(ev.voicemailUrl)}" style="width:100%;margin-top:10px"></audio>` : ""}
    ${ev.transcript ? `<p class="note" style="margin-top:9px">${esc(ev.transcript)}</p>` : ""}
    <p class="note" style="margin-top:9px">${ev.autoReplySent ? "Auto-reply sent: “" + esc(ev.autoReplyText || "") + "”" : "No auto-reply was sent for this call."}</p>
    <div class="rowbtns" style="margin-top:14px">
      <a class="btn ghost" href="tel:${esc(ev.callerNumber)}">Call back</a>
      <a class="btn primary" href="sms:${esc(ev.callerNumber)}">Text back</a>
    </div>`);
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
      <h3>&#9993; Voicemail ${unheard ? `<span class="pill live">${unheard} NEW</span>` : (list.length ? '<span class="pill">all heard</span>' : "")}</h3>
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
const PHONE_LANES = [["autopilot", "AUTOPILOT"], ["inbox", "INBOX"], ["activity", "ACTIVITY"]];
function phoneLane() { return PHONE_LANES.some(([k]) => k === S.phoneLane) ? S.phoneLane : "autopilot"; }

// Same three-lane shape Finance uses, for the same reason: one screen per
// question. What needs me / what is running for me / what happened.
function phoneLaneSwitcher(d) {
  const lane = phoneLane();
  const need = (d.needsYou || []).length;
  return `<div class="plane">${PHONE_LANES.map(([k, label]) => `
    <button class="${lane === k ? "on" : ""}" data-plane="${k}">${segIc(k)}${label}${k === "inbox" && need ? `<i class="badge">${need}</i>` : ""}</button>`).join("")}</div>`;
}

function phoneLaneBody(d) {
  const lane = phoneLane();
  if (lane === "autopilot") return phoneAutopilotLane(d);
  if (lane === "activity") return phoneActivityLane(d);
  return phoneInboxLane(d);
}

function heroStrip(cells) {
  return `<div class="panel hero">${cells.map(([n, l]) =>
    `<div><p class="n">${esc(String(n))}</p><p class="l">${esc(l)}</p></div>`).join("")}</div>`;
}

function phoneInboxLane(d) {
  const items = (d.needsYou || []).filter((i) => i.kind !== "unconfirmed");
  const appt = (d.needsYou || []).find((i) => i.kind === "unconfirmed");
  return `
    ${items.length ? `<div class="panel flush">${items.map((it) => `
      <div class="prow" data-needs="${esc(it.id)}">
        <span class="needsdot" style="background:${NEEDS_TONE[it.tone] || "var(--cyan)"}"></span>
        <div style="flex:1;min-width:0">
          <div class="needst">${esc(it.title)}</div>
          ${it.detail ? `<div class="needsm">${esc(it.detail)}</div>` : ""}
          <div class="needsw">${esc(it.meta || "")}</div>
        </div><span class="pchev">&rsaquo;</span></div>`).join("")}</div>`
      : `<div class="panel" style="text-align:center;padding:26px">
           <p class="sub" style="margin:0">Nothing waiting on you. Every call, text and voicemail has been handled.</p></div>`}
    ${appt ? `<p class="zonehead">TOMORROW</p>
      <div class="panel flush"><div class="prow" style="cursor:default">
        <span class="needsdot" style="background:var(--cyan)"></span>
        <div style="flex:1;min-width:0">
          <div class="needst">${esc(appt.title)}</div>
          <div class="needsm">${esc(appt.detail || "")}</div>
          <button class="btn em" id="remindall" style="margin-top:11px">Send them all a confirmation text</button>
        </div></div></div>` : ""}
    <div id="vmlane"></div>`;
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
  const render = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--gold)">$1</b>');
  const rows = phoneRankedAutomations(d);
  const costing = rows.filter((r) => r.impact?.tone === "cost").length;
  return `
    ${phoneArmature(d)}
    <p class="zonehead${costing ? " cost" : ""}">${costing
      ? `${costing} SWITCH${costing === 1 ? " IS" : "ES ARE"} COSTING YOU`
      : "THIS WEEK, WITHOUT YOU TOUCHING IT"}</p>
    <div class="panel flush">${rows.map((x) => {
      const tone = PHONE_TONE_VAR[x.impact?.tone] || "#39424f";
      return `<div class="prow autorow" data-auto="${esc(x.key)}" style="--tone:${tone}">
        <span class="autorail"></span>
        <div style="flex:1;min-width:0">
          <div class="needst">${esc(x.title)}${x.impact?.headline
            ? `<span class="pihead">${esc(x.impact.headline)}</span>` : ""}</div>
          <div class="needsm">${render(x.result)}</div>
        </div>
        ${phoneSpark(x.series, tone)}
        <button class="pswx${x.enabled ? " on" : ""}" data-autotoggle="${esc(x.key)}"
          role="switch" aria-checked="${x.enabled ? "true" : "false"}"
          aria-label="${esc(x.title)}"><i></i></button>
      </div>`;
    }).join("")}</div>
    ${phoneAutopilotFeed(d)}`;
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
  const m = d.metrics || {};
  return `
    ${heroStrip([[m.callsToday ?? 0, "CALLS TODAY"], [m.textsToday ?? 0, "TEXTS"], [m.leads7d ?? 0, "NEW LEADS"]])}
    <div id="phoneleads"><div class="skel"></div></div>
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
  const a = (d.automations || []).find((x) => x.key === key);
  if (!a) return;
  const render = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<b style="color:var(--gold)">$1</b>');
  const extra = {
    frontdesk: '<button class="btn" id="autoset">Settings</button><button class="btn" id="autolog">What it did</button>',
    reminders: '<button class="btn" id="autoprev">See tonight\'s list</button><button class="btn" id="autoset">Change time</button>',
    autoreply: '<button class="btn" id="autoset">Wording &amp; hours</button>',
    dispatcher: '<button class="btn" id="autoorder">Dispatch order</button>',
    "crew-reminders": '<button class="btn" id="autocrewlist">Your reminders</button><button class="btn" id="autocrewhours">Crew hours</button><button class="btn" id="autocrewshifts">Clock-out timing</button>',
  }[key] || "";
  const blurb = {
    frontdesk: "When a missed caller texts back, Ledger answers them — quoting your real QuickBooks prices and offering real open times. It can never invoice, take a payment or discuss a bill.",
    reminders: "The night before, everyone booked in gets a text asking them to confirm or say they need to move it. Each customer is texted once per appointment, ever.",
    autoreply: "A missed call gets an instant text back so the caller knows you exist and can reply.",
    dispatcher: "New bookings text your first-call crew member their job from the business line, and you can tell Ledger to dispatch anyone by name. It can only ever text people on your crew roster.",
    "crew-reminders": "Two things. After a crew member's shift ends, anyone still clocked in gets a text — replying DONE clocks them out. And any reminder you write yourself goes out from the business line at the time you set it. Each punch is nudged once, each reminder sends once a day, and only people on your roster can ever be texted.",
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
    sh.querySelector("#autotoggle").onclick = () => { closeSheet(); toggleAutomation(d, key); };
  });
}

// ONE flip, two callers. The switch on the Autopilot row and the button inside
// the automation's own sheet have to do exactly the same thing, including the
// two follow-up prompts — a switch that behaves differently depending on where
// you touched it is a bug waiting for the day you touch the other one.
async function toggleAutomation(d, key) {
  const row = (d.automations || []).find((x) => x.key === key);
  if (key === "frontdesk") return toggleFrontDesk(d);
  if (key === "reminders") return toggleApptReminders(d);
  if (key === "crew-reminders") {
    const turningOn = d.crewReminderEnabled !== true;
    try {
      await api("/phone", { action: "settings-save", crewReminderEnabled: turningOn });
      toast(turningOn ? "Crew reminders are on" : "Crew reminders are off");
      renderPhone();
      // Turning it on with nobody's shift hours set would run silently
      // forever — send the owner straight to where the hours live.
      if (turningOn) {
        const roster = await api("/crew", { action: "list" });
        const withShift = (roster.employees || []).filter((e) => e.active !== false && e.workEnd);
        if (!withShift.length) { toast("Set shift hours on the roster so Ledger knows when shifts end"); crewRosterSheet(); }
      }
    } catch (err) { toast(err.message, "err"); }
    return;
  }
  if (key === "dispatcher") {
    const turningOn = !(row ? row.enabled : d.dispatcherEnabled === true);
    try {
      await api("/phone", { action: "settings-save", dispatcherEnabled: turningOn });
      toast(turningOn ? "Dispatcher is on" : "Dispatcher is off");
      renderPhone();
      // Kyle 2026-08-30: flipping it on with 2+ crew immediately asks for
      // the standing dispatch order — the machine always knows who's first.
      if (turningOn) {
        const roster = await api("/crew", { action: "list" });
        const dispatchable = (roster.employees || []).filter((e) => e.active !== false && (e.phone || "").trim());
        if (dispatchable.length >= 2) dispatchOrderSheet(dispatchable);
      }
    } catch (err) { toast(err.message, "err"); }
    return;
  }
  try {
    await api("/phone", { action: "settings-save", autoReplyEnabled: d.autoReplyEnabled === false });
    toast(d.autoReplyEnabled === false ? "Auto text-back is on" : "Auto text-back is off");
    renderPhone();
  } catch (err) { toast(err.message); }
}

// Dispatcher: standing dispatch order. 1 = first call. Arrows, not drag —
// works the same with a thumb on a phone and a mouse on a laptop.
async function dispatchOrderSheet(preloaded) {
  let crew = preloaded;
  if (!crew) {
    try {
      const roster = await api("/crew", { action: "list" });
      crew = (roster.employees || []).filter((e) => e.active !== false && (e.phone || "").trim());
    } catch (err) { toast(err.message, "err"); return; }
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
const crewT = (iso) => iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";

function crewShiftLabel(e) {
  if (!e.workStart && !e.workEnd) return "No shift set";
  const days = (e.workDays || []).map((d) => d[0].toUpperCase() + d.slice(1, 3)).join(" ");
  return `${e.workStart || "?"}–${e.workEnd || "?"}${days ? " · " + days : ""}`;
}

function crewRangeDates(range) {
  const day = (d) => d.toLocaleDateString("en-CA");
  const today = new Date();
  if (range === "today") return [day(today), day(today)];
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  if (range === "week") { const sun = new Date(monday); sun.setDate(monday.getDate() + 6); return [day(monday), day(sun)]; }
  if (range === "last-week") {
    const lm = new Date(monday); lm.setDate(monday.getDate() - 7);
    const ls = new Date(monday); ls.setDate(monday.getDate() - 1);
    return [day(lm), day(ls)];
  }
  return [day(new Date(today.getFullYear(), today.getMonth(), 1)), day(today)];
}

const CREW_RANGES = [["today", "Today"], ["week", "This week"], ["last-week", "Last week"], ["month", "Month"]];

async function crewHoursSheet(range = "week") {
  const [from, to] = crewRangeDates(range);
  let d;
  try { d = await api("/crew", { action: "timecards", from, to }); }
  catch (err) { toast(err.message, "err"); return; }
  const cards = (d.cards || []).filter((c) => c.total_seconds > 0 || c.on_clock || c.active);
  const otBits = [];
  if (d.ot_daily_hours != null) otBits.push(`over ${d.ot_daily_hours}h/day`);
  if (d.ot_weekly_hours != null) otBits.push(`over ${d.ot_weekly_hours}h/week`);
  const otLabel = otBits.length ? `Overtime counts hours ${otBits.join(" or ")}.` : "Overtime tracking is off.";
  sheet(`<h2>Crew hours</h2>
    <p class="sh-sub">${esc(from)} → ${esc(to)}</p>
    <div class="rowbtns" style="margin-top:8px">${CREW_RANGES.map(([k, l]) =>
      `<button class="btn ${k === range ? "em" : ""}" data-crange="${k}">${l}</button>`).join("")}</div>
    ${cards.length ? cards.map((c) => `
      <div class="panel" style="margin-top:12px">
        <h3 style="display:flex;gap:8px;align-items:center">${esc(c.name)}
          ${c.on_clock ? '<span class="pill live">ON THE CLOCK</span>' : ""}
          <span style="margin-left:auto;font-weight:800">${crewH(c.total_seconds)}</span></h3>
        <p class="note" style="margin-top:2px">Regular ${crewH(c.regular_seconds)}${c.ot_seconds > 0 ? ` · <b style="color:var(--gold)">OT ${crewH(c.ot_seconds)}</b>` : " · no OT"}</p>
        ${(c.days || []).map((day) => `
          <div class="kv" style="margin-top:6px"><span>${esc(day.date)}</span><span>${crewH(day.seconds)}</span></div>
          ${(day.punches || []).map((p) => `<p class="note" style="margin:2px 0 0 4px">${crewT(p.in)} → ${p.out ? crewT(p.out) : "<b>still on the clock</b>"}${p.corrected ? " · corrected" : ""}${p.note ? " · " + esc(p.note) : ""}</p>`).join("")}
        `).join("") || '<p class="note" style="margin-top:6px">No punches in this range.</p>'}
      </div>`).join("")
      : '<div class="panel" style="margin-top:12px;text-align:center"><p class="sub" style="margin:0">No crew members yet — add them under Roster &amp; shifts.</p></div>'}
    <p class="note" style="margin-top:10px">${esc(otLabel)}</p>
    <div class="rowbtns" style="margin-top:10px">
      <button class="btn" id="crewroster">Roster &amp; shifts</button>
      <button class="btn" id="crewot">Overtime rules</button>
      ${cards.length ? '<button class="btn" id="crewcsv">Export CSV</button>' : ""}
    </div>`, (sh) => {
    on("[data-crange]", "click", (e) => { closeSheet(); crewHoursSheet(e.currentTarget.dataset.crange); }, sh);
    sh.querySelector("#crewroster").onclick = () => { closeSheet(); crewRosterSheet(); };
    sh.querySelector("#crewot").onclick = () => { closeSheet(); crewOtSheet(d, range); };
    const csv = sh.querySelector("#crewcsv");
    if (csv) csv.onclick = () => {
      const rows = [["Employee", "Date", "In", "Out", "Hours", "Corrected", "Note"]];
      for (const c of cards) for (const day of c.days || []) for (const p of day.punches || []) {
        rows.push([c.name, day.date, p.in || "", p.out || "", "", p.corrected ? "yes" : "", p.note || ""]);
      }
      for (const c of cards) rows.push([c.name, "TOTAL", "", "", crewH(c.total_seconds), c.ot_seconds > 0 ? `OT ${crewH(c.ot_seconds)}` : "", ""]);
      const blob = new Blob([rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
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
  catch (err) { toast(err.message, "err"); return; }
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
      <button class="btn ${audience === "all" ? "em" : ""}" id="crWhoAll" type="button">Everyone on the crew</button>
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
      if (!confirm("Delete this reminder? Your crew stops getting it.")) return;
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
    <div class="rowbtns" style="margin-top:12px">
      <button class="btn" id="rempreview">See tonight's list</button>
      <button class="btn ${on ? "" : "em"}" id="remtoggle">${on ? "Turn off" : "Turn on reminders"}</button>
      ${on ? '<button class="btn" id="remtune">Change time</button>' : ""}
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
    const ok = confirm(`Turn on appointment reminders?\n\nEvery day at ${apptPrettyTime(r.time || "18:00")}, Ledger will text everyone booked in for the next day from your business number, asking them to reply Y to confirm or C to change it.\n\nEach customer is texted once per appointment, ever. Nobody is texted twice.\n\nIf you haven't already, check "See tonight's list" first — it shows you exactly who would get a text and exactly what it says, and sends nothing.\n\nYou can turn this off any time.`);
    if (!ok) return;
  }
  try {
    await api("/phone", { action: "settings-save", reminderEnabled: r.enabled !== true });
    toast(r.enabled !== true ? "Reminders are on" : "Reminders are off");
    renderPhone();
  } catch (err) { toast(err.message); }
}

function apptReminderSheet(d) {
  const r = d.reminders || {};
  sheet(`<h2>Reminder settings</h2>
    <label class="lab">What time to send</label>
    <input class="inp" id="remtime" type="time" value="${esc(r.time || "18:00")}">
    <p class="note">Your local time. Evening works best — late enough that the day is settled, early enough not to bother anyone.</p>
    <label class="lab" style="margin-top:12px">How far ahead</label>
    <select class="inp" id="remahead">
      ${[1, 2, 3].map((n) => `<option value="${n}" ${Number(r.daysAhead || 1) === n ? "selected" : ""}>${n === 1 ? "The night before" : `${n} days ahead`}</option>`).join("")}
    </select>
    <div class="rowbtns" style="margin-top:16px"><button class="btn em" id="remsave">Save</button></div>`, (sh) => {
    sh.querySelector("#remsave").onclick = async () => {
      try {
        await api("/phone", {
          action: "settings-save",
          reminderTime: sh.querySelector("#remtime").value || "18:00",
          reminderDaysAhead: Number(sh.querySelector("#remahead").value || 1),
        });
        toast("Saved"); closeSheet(); renderPhone();
      } catch (err) { toast(err.message); }
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
    const label = { will_send: '<span class="pill live">WILL SEND</span>', already_sent: '<span class="pill">ALREADY SENT</span>', no_number: '<span class="pill" style="color:var(--red)">NO PHONE NUMBER</span>' };
    sh.querySelector("#rembody").innerHTML = `
      <p class="sub">${d.appointments} appointment${d.appointments === 1 ? "" : "s"} on ${esc(d.day)} — <b>${d.would_send}</b> would get a text.${d.no_number ? ` <b>${d.no_number}</b> have no phone number on the appointment and would need you to text them yourself.` : ""}</p>
      <p class="note">Nothing has been sent. This is exactly what would go out.</p>
      ${items.length ? items.map((it) => `<div class="kv" style="display:block"><div>${label[it.state] || ""} <b>${esc(it.title)}</b></div>
        <div><small style="color:var(--dim)">${esc(it.when)}${it.to ? " · " + esc(it.to) : ""}</small></div>
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
    const ok = confirm("Turn on Front Desk?\n\nFrom now on, when someone calls, misses you, and texts back, Ledger will reply to them on its own — quoting your real QuickBooks prices and booking real times on your calendar. No one has to approve each message.\n\nIt can never invoice, take payment, or discuss a bill, and anything it's unsure about it hands straight to you.\n\nYou can turn this off any time.");
    if (!ok) return;
  }
  try {
    await api("/phone", { action: "settings-save", frontDeskEnabled: fd.enabled !== true });
    toast(fd.enabled !== true ? "Front Desk is on" : "Front Desk is off");
    renderPhone();
  } catch (e) { toast(e.message); }
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

function requestNumberCard(pending, locked) {
  // Subscription-only since 2026-08-31. Show what the line DOES and the way to
  // get it, rather than a form whose only possible answer is "subscribe first".
  if (locked && !pending) {
    return `<div class="panel">
      <h3>&#128241; Your own business line &#128664;</h3>
      <p class="sub">A local number of your own, included with your subscription: missed calls text the caller back automatically, every lead lands in your Leads list, and you can reply right from this tab.</p>
      <p class="note" style="margin-top:10px">Included with Ledger AI &mdash; after you subscribe, tell us your area code and we set your line up, usually the same business day.</p>
      <button class="btn em wide" style="margin-top:13px" id="rnsubscribe">Subscribe to get your number</button>
      <div class="note" id="rnnote" style="margin-top:8px"></div>
    </div>`;
  }
  if (pending) {
    return `<div class="panel">
      <h3>&#128241; Business number requested</h3>
      <p class="sub">We're provisioning <b>${esc(pending.businessName)}</b>'s number now — you'll be texted here the moment it's live.</p>
      <p class="note" style="margin-top:8px">Requested ${esc(dayLabel(pending.createdAt))}</p>
    </div>`;
  }
  return `<div class="panel">
    <h3>&#128241; Request a business number &#128664;</h3>
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
      try { const c = await api("/stripe-billing/checkout", {}); location.href = c.url; }
      catch (err) { const note = $("rnnote"); note.className = "note err"; note.textContent = err.message; }
    };
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

const LANE_CODE = { directory: "CUSTOMERS", reviews: "REVIEWS", todos: "TO-DO" };

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
    ${pageHead(S.lane === "todos" ? "To-Do" : S.lane === "reviews" ? "Reviews" : "Customers")}
    <div class="seg">
      ${[["directory", "Directory", 0], ["reviews", "Reviews", 0], ["todos", "To-Do", laneAlerts().todos]].map(([k, l, n]) =>
        `<button class="${S.lane === k ? "on" : ""}" data-lane="${k}">${segIc(k)}${l}${n ? `<i class="badge">${n}</i>` : ""}</button>`).join("")}
    </div>
    <div id="lanebody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  on("[data-lane]", "click", (e) => { S.lane = e.currentTarget.dataset.lane; renderCustomers(); });
  if (S.lane === "directory") {
    loadDirectory();
    // iOS keeps the To-Do badge live from the same board; fetch it once so Directory shows it too.
    if (!S.board) api("/leads", { action: "board" }).then((b) => { S.board = b; if (S.tab === "customers") renderCustomers(); }).catch(() => {});
  } else if (S.lane === "reviews") loadReviewsLane();
  else loadBoard();
}

// Reviews lane — the web twin of iOS ReviewsCommandLane (build 40): live Google
// reviews, the public score, and the playbook for growing it.
async function loadReviewsLane() {
  const slot = $("lanebody"); if (!slot) return;
  const gold = "var(--gold, #fbbf24)";
  let board;
  try {
    board = (await get("/google-business-profile/reviews?limit=10")).reviews;
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
  const items = board.items || [];
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
      ${items.length ? items.map((r) => `<div class="gcard">
        <div class="t"><b>${esc(r.reviewer_anonymous ? "Google user" : r.reviewer_name)}</b>
          <span class="starrow sm">${stars(r.star_rating)}</span><small>${esc(rel(r.updated_at))}</small></div>
        ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}
        ${r.replied ? `<div class="reply"><small>&#8617; OWNER REPLY</small>${esc(r.reply_comment || "")}</div>`
          : `<div class="noreply">&#9888; No owner reply yet</div>`}
      </div>`).join("") : `<p class="note">No reviews yet — the moment your first Google review lands it appears here.</p>`}
    </div>
    <div class="revgrow">
      <div class="cihead" style="color:var(--emerald)">&#128200; GROW YOUR REVIEWS WITH LEDGER</div>
      ${[["01", "Ask at the high point", "Right after a job they loved. The Directory lane puts an Ask-for-review button on every customer — it sends your real Google review link."],
        ["02", "Reply to every single one", "Ask Ledger to draft the reply — it answers what the customer actually said, and nothing posts until you confirm."],
        ["03", "Make it a weekly habit", "Two asks a week compounds. A steady stream of fresh reviews outranks a burst from last year."]]
        .map(([n, t, x]) => `<div class="playstep"><b>${n}</b><div><span>${t}</span><small>${x}</small></div></div>`).join("")}
      <button class="cta gold" id="rvask"><span class="ic">&#11088;</span>
        <span><b>Ask a customer for a review</b><span>Opens the Directory review queue</span></span></button>
    </div>`;
  $("rvreload").onclick = () => { slot.innerHTML = `<div class="skel"></div>`; loadReviewsLane(); };
  $("rvask").onclick = () => { S.lane = "directory"; renderCustomers(); };
}

const reviewAsked = () => new Set((localStorage.getItem("kmj.reviewRequestedCustomerIDs") || "").split(",").filter(Boolean));
const markReviewAsked = (id) => { const s = reviewAsked(); s.add(id); localStorage.setItem("kmj.reviewRequestedCustomerIDs", [...s].sort().join(",")); };

async function loadDirectory() {
  const slot = $("lanebody"); if (!slot) return;
  // Same branch iOS makes: built-in books gets its own directory off
  // books_customers — the QuickBooks wall only belongs to QuickBooks shops.
  if (S.booksProvider === undefined) {
    try { S.booksProvider = (await booksApi({ action: "settings" })).provider; }
    catch { S.booksProvider = "quickbooks"; }
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
    invoices.forEach((i) => { if (!lastInvoice[i.customer_id] || i.date > lastInvoice[i.customer_id]) lastInvoice[i.customer_id] = i.date; });
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
      <div class="cihero">
        <div class="t"><div><span class="eyebrow">Customer intelligence</span>
          <b>Relationships, revenue &amp; reputation</b></div><span class="ic">&#128101;</span></div>
        <div class="pulse">
          <div class="pm cyan"><small>QBO</small><b>${all.length}</b></div>
          <div class="pm em"><small>Reachable</small><b>${reachable}</b></div>
          <div class="pm purple"><small>Buyers</small><b>${buyers}</b></div>
        </div>
        <div class="split"><div><small>Customer revenue</small><b>${money0(lifetime)}</b></div>
          <div class="r"><small>Reviews asked</small><b class="em">${asked.size}</b></div></div>
      </div>
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
        <input id="csearch" placeholder="Customer, invoice, email or phone" value="${esc(S.custSearch || "")}"></div>
      <div class="dirbar">
        <span class="eyebrow">Customer directory</span>
        <button class="pillbtn em" id="cadd">+ Add</button>
        <select class="pillbtn" id="csort">
          ${[["name", "A–Z"], ["owing", "Owing"], ["recent", "Recent"]].map(([k, l]) =>
            `<option value="${k}" ${sort === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="pillbtn ${S.custBalancesOnly ? "hot" : ""}" id="cbal">${S.custBalancesOnly ? "Balances" : "All"}</button>
      </div>
      ${list.length ? list.slice(0, S.custShowAll ? list.length : 120).map((c) => {
        const contact = [c.email, c.phone].filter(Boolean).join(" · ");
        const od = overdueIds.has(c.id);
        return `<div class="ccard">
          <div class="top">
            <div class="avaw"><div class="ava ${od ? "od" : c.balance > 0 ? "ow" : ""}">${sigilMark(c.name)}<i class="rail"></i></div><i class="tick ${c.active === false ? "off" : ""}"></i></div>
            <div class="who"><b>${esc(c.name)}</b>
              ${contact ? `<span>${esc(contact)}</span>` : ""}
              <i>QBO #${esc(c.id)} · ${c.balance > 0
                ? `<span style="color:${od ? "var(--red)" : "var(--orange)"}">${money(c.balance)} ${od ? "overdue" : "owing"}</span>`
                : (c.active === false ? "Inactive" : "Active")}</i></div>
          </div>
          <div class="acts">
            <button class="actbtn" data-cust="${esc(c.id)}">&#128100;&nbsp; Full Profile</button>
            <button class="actbtn p" data-review="${esc(c.id)}">${asked.has(c.id) ? "&#10003;&nbsp; Review Asked" : "&#11088;&nbsp; Ask for Review"}</button>
          </div>
        </div>`;
      }).join("") + (!S.custShowAll && list.length > 120
        ? `<button class="btn ghost wide" style="margin-top:10px" id="cmore">Show all ${list.length} customers (${list.length - 120} more)</button>`
        : "")
      : `<div class="empty">No customers found.<br>Try a different name, email, phone or QBO ID.</div>`}`;
    if ($("cmore")) $("cmore").onclick = () => { S.custShowAll = true; loadDirectory(); };
    const sb = $("csearch");
    sb.addEventListener("input", () => { S.custSearch = sb.value; clearTimeout(S._c); S._c = setTimeout(loadDirectory, 220); });
    $("csort").onchange = (e) => { S.custSort = e.target.value; loadDirectory(); };
    $("cbal").onclick = () => { S.custBalancesOnly = !S.custBalancesOnly; loadDirectory(); };
    $("cadd").onclick = () => newCustomerSheet();
    on("[data-cust]", "click", (e) => customerSheet(all.find((c) => c.id === e.currentTarget.dataset.cust)), slot);
    on("[data-review]", "click", (e) => {
      const c = all.find((x) => x.id === e.currentTarget.dataset.review);
      if (c) reviewSheet(c, asked.has(c.id));
    }, slot);
  } catch (e) {
    slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(slot);
  }
}

// Google Business review destination — same source as iOS: the connector row's
// public_config.review_uri, falling back to the configured KMJ link.
const FALLBACK_REVIEW_URL = "https://g.page/r/CbmEs1o9TuK3EBM/review";
async function reviewTarget() {
  if (S.reviewUrl !== undefined) return S.reviewUrl;
  S.reviewUrl = { url: FALLBACK_REVIEW_URL, name: S.profile?.business?.name || "Your business" };
  try {
    const t = await token();
    const r = await fetch(`${SUPA_URL}/rest/v1/connector_accounts?connector=eq.google_business_profile&select=status,display_name,public_config&order=updated_at.desc&limit=1`,
      { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + t } });
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) S.reviewUrl = {
      url: row.public_config?.review_uri || FALLBACK_REVIEW_URL,
      name: row.display_name || S.profile?.business?.name || "Your business",
    };
  } catch { /* keep the configured fallback */ }
  return S.reviewUrl;
}

// Review request — the web twin of iOS ReviewRequestSheet. Nothing sends automatically:
// the tap opens the user's own SMS or mail client with the message pre-filled.
async function reviewSheet(c, already) {
  const { url, name } = await reviewTarget();
  const first = (c.name || "").split(" ")[0] || c.name;
  const msg = `Hi ${first}! Thanks again for choosing ${name}. If you have a moment, would you mind sharing your experience? It really helps our local business: ${url}`;
  const btn = (id, icon, title, detail, tint) => `<button class="revbtn ${tint}" id="${id}">
      <span class="ic">${icon}</span><span class="m"><b>${esc(title)}</b><span>${esc(detail)}</span></span>
      <span class="chev">&#8250;</span></button>`;
  sheet(`<h2>${already ? "Review already requested" : "Ask " + esc(first) + " for a review?"}</h2>
    <p class="sh-sub">The verified direct-review link for ${esc(name)} is ready.</p>
    <div class="eyebrow">Message preview</div>
    <p class="note" style="white-space:pre-wrap;margin-top:7px">${esc(msg)}</p>
    <div class="cmpsect" style="margin-top:14px">
      ${c.phone ? btn("rvsms", "&#128172;", "Open in Messages", c.phone, "em") : ""}
      ${c.email ? btn("rvmail", "&#9993;", "Open in Mail", c.email, "cyan") : ""}
      ${btn("rvcopy", "&#128279;", "Copy review link", name, "purple")}
      ${btn("rvopen", "&#8599;", "Preview review page", "Opens Google Reviews", "gold")}
    </div>
    <p class="note">Nothing is sent automatically. You review the exact message in Messages or Mail before sending.</p>`, (sh) => {
    const done = () => { markReviewAsked(c.id); closeSheet(); loadDirectory(); };
    const sms = sh.querySelector("#rvsms");
    if (sms) sms.onclick = () => { window.location.href = `sms:${c.phone}?&body=${encodeURIComponent(msg)}`; done(); };
    const mail = sh.querySelector("#rvmail");
    if (mail) mail.onclick = () => {
      window.location.href = `mailto:${c.email}?subject=${encodeURIComponent("Thank you from " + name)}&body=${encodeURIComponent(msg)}`;
      done();
    };
    sh.querySelector("#rvcopy").onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast("Review link copied"); } catch { toast("Copy failed", "err"); }
    };
    sh.querySelector("#rvopen").onclick = () => window.open(url, "_blank", "noopener");
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
      booksApi({ action: "invoices" }).catch(() => ({ invoices: [] })),
    ]);
    const invoices = inv.invoices || [];
    const balanceBy = {}, lastPaid = {}, lastInvoice = {};
    const todayISO = localDay();
    const overdueIds = new Set();
    for (const i of invoices) {
      if (!i.customer_id) continue;
      balanceBy[i.customer_id] = (balanceBy[i.customer_id] || 0) + Number(i.balance || 0);
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
      <div class="cihero">
        <div class="t"><div><span class="eyebrow">Customer intelligence</span>
          <b>Relationships, revenue &amp; reputation</b></div><span class="ic">&#128101;</span></div>
        <div class="pulse">
          <div class="pm cyan"><small>On file</small><b>${all.length}</b></div>
          <div class="pm em"><small>Reachable</small><b>${reachable}</b></div>
          <div class="pm purple"><small>Buyers</small><b>${buyers}</b></div>
        </div>
        <div class="split"><div><small>Customer revenue</small><b>${money0(lifetime)}</b></div>
          <div class="r"><small>Reviews asked</small><b class="em">${asked.size}</b></div></div>
      </div>
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
        <input id="csearch" placeholder="Customer, email or phone" value="${esc(S.custSearch || "")}"></div>
      <div class="dirbar">
        <span class="eyebrow">Customer directory</span>
        <button class="pillbtn em" id="cadd">+ Add</button>
        <select class="pillbtn" id="csort">
          ${[["name", "A\u2013Z"], ["owing", "Owing"], ["recent", "Recent"]].map(([k, l]) =>
            `<option value="${k}" ${sort === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="pillbtn ${S.custBalancesOnly ? "hot" : ""}" id="cbal">${S.custBalancesOnly ? "Balances" : "All"}</button>
      </div>
      ${list.length ? list.slice(0, S.custShowAll ? list.length : 120).map((c) => {
        const contact = [c.email, c.phone].filter(Boolean).join(" \u00b7 ");
        const od = overdueIds.has(c.id);
        return `<div class="ccard">
          <div class="top">
            <div class="avaw"><div class="ava ${od ? "od" : c.balance > 0 ? "ow" : ""}">${sigilMark(c.name)}<i class="rail"></i></div></div>
            <div class="who"><b>${esc(c.name)}</b>
              ${contact ? `<span>${esc(contact)}</span>` : ""}
              <i>${c.balance > 0
                ? `<span style="color:${od ? "var(--red)" : "var(--orange)"}">${money(c.balance)} ${od ? "overdue" : "owing"}</span>`
                : "Active"}</i></div>
          </div>
          <div class="acts">
            <button class="actbtn" data-ncust="${esc(c.id)}">&#128100;&nbsp; Edit Details</button>
            <button class="actbtn p" data-review="${esc(c.id)}">${asked.has(c.id) ? "&#10003;&nbsp; Review Asked" : "&#11088;&nbsp; Ask for Review"}</button>
          </div>
        </div>`;
      }).join("")
      : `<div class="panel" style="text-align:center"><p class="sub" style="margin:0">No customers yet \u2014 add your first one, or create an invoice and Ledger saves the customer with it.</p></div>`}`;
    const sb = $("csearch");
    sb.addEventListener("input", () => { S.custSearch = sb.value; clearTimeout(S._c); S._c = setTimeout(loadDirectory, 220); });
    $("csort").onchange = (e) => { S.custSort = e.target.value; loadDirectory(); };
    $("cbal").onclick = () => { S.custBalancesOnly = !S.custBalancesOnly; loadDirectory(); };
    $("cadd").onclick = () => nativeCustomerSheet(null);
    on("[data-ncust]", "click", (e) => nativeCustomerSheet(all.find((c) => c.id === e.currentTarget.dataset.ncust)?.raw), slot);
    on("[data-review]", "click", (e) => {
      const c = all.find((x) => x.id === e.currentTarget.dataset.review);
      if (c) reviewSheet(c, asked.has(c.id));
    }, slot);
  } catch (e) {
    slot.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// Add or edit a built-in-books customer — same fields as the iOS
// NewCustomerSheet's native mode, saved through books customer-save.
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
        await booksApi({ action: "customer-save", customer: {
          ...(existing ? { id: existing.id } : {}),
          first_name: first, last_name: last, company, email: v("ncEmail"), phone: v("ncPhone"),
        } });
        closeSheet();
        toast(existing ? "Customer updated" : "Customer added");
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
      <div class="kpi purple"><small>Invoices</small><b>${all.length}</b></div>
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
  const slot = $("lanebody"); if (!slot) return;
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

const LEAD_FILTERS = [["active", "Active"], ["any", "All"], ["new", "New"],
  ["contacted", "Contacted"], ["quoted", "Quoted"], ["won", "Won"], ["lost", "Lost"]];

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
      } catch (err) { toast(err.message, "err"); }
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
      if (!confirm("Delete this lead?")) return;
      try { S.board = await api("/leads", { action: "lead-delete", id: l.id }); closeSheet(); drawLeads(); }
      catch (err) { toast(err.message, "err"); }
    };
  });
}

function drawTodos() {
  const slot = $("lanebody"); if (!slot) return;
  const todos = (S.board?.todos || []).filter((t) => t.status === "open");
  const done = (S.board?.todos || []).filter((t) => t.status === "done").slice(0, 10);
  const now = new Date(); const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const groups = [
    ["OVERDUE", todos.filter((t) => t.dueAt && new Date(t.dueAt) < now)],
    ["TODAY", todos.filter((t) => t.dueAt && new Date(t.dueAt) >= now && new Date(t.dueAt) <= endToday)],
    ["UPCOMING", todos.filter((t) => t.dueAt && new Date(t.dueAt) > endToday)],
    ["ANYTIME", todos.filter((t) => !t.dueAt)],
  ].filter(([, items]) => items.length);
  slot.innerHTML = `
    <button class="btn primary wide" id="addtodo">+ New to-do</button>
    ${groups.length ? groups.map(([label, items]) => `<div><div class="eyebrow" style="color:${label === "OVERDUE" ? "var(--red)" : "var(--cyan)"}">${label}</div>
      <div class="list" style="margin-top:8px">${items.map((t) => `<div class="item">
        <button data-done="${esc(t.id)}" title="${esc((t.priority || "normal").toUpperCase())} priority" style="background:none;border:1.7px solid ${todoPriorityTint(t.priority)};border-radius:50%;width:24px;height:24px;color:var(--dim);cursor:pointer;flex-shrink:0"></button>
        <div class="main" data-todo="${esc(t.id)}"><div class="ttl">${esc(t.title)}</div>
          <div class="sub">${t.dueAt ? esc(dayLabel(t.dueAt) + " · " + timeLabel(t.dueAt)) : "No date"}${t.customerName ? " · " + esc(t.customerName) : ""}</div></div>
      </div>`).join("")}</div></div>`).join("")
      : `<div class="empty">Nothing on the list.<br>Ask Ledger to remind you about something.</div>`}
    ${done.length ? `<div><div class="eyebrow" style="color:var(--dim)">DONE</div>
      <div class="list" style="margin-top:8px;opacity:.55">${done.map((t) => `<div class="item" style="cursor:default">
        <div class="main"><div class="ttl" style="text-decoration:line-through">${esc(t.title)}</div></div></div>`).join("")}</div></div>` : ""}`;
  $("addtodo").onclick = () => todoSheet({});
  on("[data-done]", "click", async (e) => {
    const id = e.currentTarget.dataset.done;
    try { S.board = await api("/leads", { action: "todo-save", todo: { id, status: "done" } }); drawTodos(); }
    catch (err) { toast(err.message, "err"); }
  }, slot);
  on("[data-todo]", "click", (e) => todoSheet(todos.find((t) => t.id === e.currentTarget.dataset.todo)), slot);
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
      try { S.board = await api("/leads", { action: "todo-save", todo }); closeSheet(); drawTodos(); toast("Saved"); }
      catch (err) { e.currentTarget.disabled = false; const n = sh.querySelector("#tnote"); n.className = "note err"; n.textContent = err.message; }
    };
    const del = sh.querySelector("#tdel");
    if (del) del.onclick = async () => {
      if (!confirm("Delete this to-do?")) return;
      try { S.board = await api("/leads", { action: "todo-delete", id: t.id }); closeSheet(); drawTodos(); }
      catch (err) { toast(err.message, "err"); }
    };
  });
}

/* ---------------- CHAT ---------------- */
function openChat() {
  $("chatwrap").classList.add("open");
  $("box").value = ""; // callers that seed a prompt assign it straight after this

  setTimeout(() => $("box").focus(), 60);
  restoreChatHistory();
}
function closeChat() { $("chatwrap").classList.remove("open"); $("box").value = ""; }
function newConversation() {
  S.conversationId = null; localStorage.removeItem("ledger.conv");
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
    if (d.conversation_id) { S.conversationId = d.conversation_id; localStorage.setItem("ledger.conv", d.conversation_id); }
  } catch { /* No history route yet, or signed out — keep the local welcome message. */ }
}
const chatEl = () => $("chat");
function scrollChat() { const c = chatEl(); c.scrollTop = c.scrollHeight; }
function bubble(cls, html) { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; chatEl().appendChild(d); scrollChat(); return d; }
function sys(t) { bubble("sys", esc(t)); }

function banner() {
  const b = $("banner"); if (b) b.style.display = S.advisor ? "block" : "none";
  const p = $("advisor"); if (p) p.className = "pill" + (S.advisor ? " on" : "");
}
function toggleAdvisor() {
  if (!S.advisor && localStorage.getItem("ledger.advisorNotice") !== "1") {
    const meter = S.usage ? ` (${money(S.usage.spent_usd)} of ${money(S.usage.budget_usd)} used this month)` : "";
    if (!window.confirm("Advisor Mode opens up business guidance beyond your books — marketing, pricing, hiring, growth — grounded in your real numbers. It uses your monthly AI allowance" + meter + ".")) return;
    localStorage.setItem("ledger.advisorNotice", "1");
  }
  S.advisor = !S.advisor; localStorage.setItem("ledger.advisor", S.advisor ? "1" : "0"); banner();
}

function setUsage(u) {
  S.usage = u; const el = $("usage");
  if (el && u && u.budget_usd > 0 && Number.isFinite(Number(u.spent_usd))) {
    const pct = Math.round(Number(u.spent_usd) / u.budget_usd * 100);
    el.textContent = pct + "% AI";
    el.style.color = pct >= 80 ? "var(--orange)" : "";
    el.style.cursor = "pointer"; el.onclick = powerUpSheet;
  }
}
async function refreshUsage() { try { setUsage(await api("/ledger-ai", { action: "usage" })); } catch {} }

async function powerUpSheet() {
  let pkgs = [{ key: "boost", emoji: "⚡", label: "Boost", price: 25, credit: 25 },
              { key: "power", emoji: "🔥", label: "Power Pack", price: 50, credit: 55 },
              { key: "heavy", emoji: "🚀", label: "Heavy Hitter", price: 100, credit: 120 }];
  try { const s = await api("/stripe-billing/status", {}); if (s.topup_packages?.length) pkgs = s.topup_packages; } catch {}
  sheet(`<h2>⚡ Power-Ups</h2><p class="sh-sub">Add to this month's AI allowance — credited the second the payment clears.</p>
    ${pkgs.map((p) => `<button class="pu-card${p.key === "power" ? " hot" : ""}" data-k="${esc(p.key)}">
      <span class="pu-emoji">${p.emoji}</span>
      <span class="pu-info"><b>${esc(p.label)}</b><small>+$${p.credit} AI allowance${p.credit > p.price ? ` · $${p.credit - p.price} bonus` : ""}</small></span>
      <span class="pu-price">$${p.price}</span></button>`).join("")}`, (sh) => {
    on(".pu-card", "click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const c = await api("/stripe-billing/topup", { package: b.dataset.k }); location.href = c.url; }
      catch (err) { toast(err.message, "err"); b.disabled = false; }
    }, sh);
  });
}

/* Texting credit — the $25/month included with the business number, metered at
   the carrier's real per-text cost and topped up $25 at a time. Rides on the
   same usage call as the AI meter (S.usage.sms); hidden on a bring-your-own
   line, where the other provider bills the texts. (Kyle 2026-09-05) */
function smsMeterHtml(s) {
  const pct = s && s.allowance_usd > 0 ? Math.round(Number(s.used_usd) / s.allowance_usd * 100) : 0;
  const texts = s ? `${s.outbound_count} sent · ${s.inbound_count} received` : "";
  return `<div class="kv"><span>Used this month</span><span>${s ? money(s.used_usd) + " of " + money(s.allowance_usd) : "—"}</span></div>
    ${texts ? `<div class="kv" style="margin-top:4px"><span>Texts</span><span>${esc(texts)}</span></div>` : ""}
    <div style="height:7px;background:rgba(255,255,255,.07);border-radius:99px;margin-top:9px;overflow:hidden">
      <div style="height:100%;width:${Math.min(pct, 100)}%;background:${pct >= 80 ? "var(--orange)" : "linear-gradient(90deg,var(--cyan),var(--purple))"}"></div></div>
    ${s?.topup_usd > 0 ? `<p class="note" style="margin-top:6px">Includes ${money(s.topup_usd)} added this month. Resets on the 1st.</p>` : `<p class="note" style="margin-top:6px">${s ? money(s.credit_usd) : "$25"} included every month with your business number. Resets on the 1st.</p>`}`;
}
async function textingSheet() {
  let s = S.usage?.sms || null;
  try { const r = await api("/phone", { action: "sms-usage" }); if (r?.sms) { s = r.sms; if (S.usage) S.usage.sms = s; } } catch {}
  let pkg = { key: "sms25", emoji: "💬", label: "Texting credit", price: 25, credit: 25 };
  try { const b = await api("/stripe-billing/status", {}); if (b.sms_topup) pkg = b.sms_topup; } catch {}
  sheet(`<h2>💬 Texting credit</h2><p class="sh-sub">Texts your business number sends and receives — reminders, replies, Front Desk, your own messages.</p>
    <div class="panel">${smsMeterHtml(s)}</div>
    ${s?.exhausted ? `<p class="note" style="margin-top:10px;color:var(--orange)">This month's credit is used up. Reminders and replies are paused until you add credit.</p>` : ""}
    <button class="pu-card hot" data-k="${esc(pkg.key)}" style="margin-top:12px">
      <span class="pu-emoji">${pkg.emoji}</span>
      <span class="pu-info"><b>Add $${pkg.credit} texting credit</b><small>About ${Math.round(pkg.credit / 0.0113 / 100) * 100} more texts · credited the second the payment clears</small></span>
      <span class="pu-price">$${pkg.price}</span></button>`, (sh) => {
    on(".pu-card", "click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const c = await api("/stripe-billing/sms-topup", {}); location.href = c.url; }
      catch (err) { toast(err.message, "err"); b.disabled = false; }
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
    const b = document.createElement("u"); b.style.cursor = "pointer"; b.textContent = label;
    b.onclick = async () => { try { const c = await api(path, {}); location.href = c.url; } catch (e) { toast(e.message, "err"); } };
    a.appendChild(b);
  };
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
  openChat();
  bubble("msg me", esc(text));
  const t = bubble("typing", "Ledger is thinking…");
  $("send").disabled = true;
  try {
    const d = await api("/ledger-ai", {
      message: text, mode: S.advisor ? "advisor" : "books",
      ...(S.conversationId ? { conversation_id: S.conversationId } : {}),
    });
    S.conversationId = d.conversation_id; localStorage.setItem("ledger.conv", S.conversationId);
    t.remove(); bubble("msg ai", md(d.reply));
    if (d.usage_status) setUsage(d.usage_status);
    (d.invoice_drafts || []).forEach((x) => draftCard(x, "INVOICE DRAFT", "/quickbooks-invoice/confirm", "/quickbooks-invoice/cancel"));
    (d.estimate_drafts || []).forEach((x) => draftCard(x, "ESTIMATE DRAFT", "/quickbooks-invoice/estimate-confirm", "/quickbooks-invoice/estimate-cancel"));
    (d.booking_drafts || []).forEach(bookingCard);
    (d.reminder_drafts || []).forEach(reminderCard);
    (d.email_drafts || []).forEach(emailDraftCard);
    (d.sms_drafts || []).forEach(smsDraftCard);
    (d.print_jobs || []).forEach(printJobCard);
    S.qboStale = true; S.board = null; // books may have moved — refetch on next tab visit
  } catch (e) {
    t.remove(); bubble("msg ai err", "⚠️ " + esc(e.message));
    if (e.status === 402) { if (/subscription|trial|renew/i.test(e.message)) billingCheck(); else powerUpSheet(); }
    else if (/allowance|power-up/i.test(e.message)) powerUpSheet();
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

const termsRow = (v) => `<label class="emailrow">Payment due
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
    ${isInvoice ? termsRow(d.terms) : ""}
    ${d.customer_email ? `<label class="emailrow"><input type="checkbox" class="em" checked> Email to ${esc(d.customer_email)}${(d.customer_email_cc || []).length ? ` · cc ${esc(d.customer_email_cc.join(", "))}` : ""}${d.recipients_locked ? ` <span class="note">(your standing rule for this customer)</span>` : ""}</label>` : ""}
    <label class="emailrow"><input type="checkbox" class="pr" ${localStorage.getItem("ledger.printAfterPosting") === "1" ? "checked" : ""}> Print after posting</label>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Confirm</button></div>`);
  const cardBtns = () => [card.querySelector(".confirm"), card.querySelector(".cancel")].filter(Boolean);
  card.querySelector(".pr").onchange = (e) => localStorage.setItem("ledger.printAfterPosting", e.target.checked ? "1" : "0");
  card.querySelector(".confirm").onclick = async () => {
    cardBtns().forEach((b) => b.disabled = true);
    try {
      const sendEmail = card.querySelector(".em")?.checked ?? false;
      const wantPrint = card.querySelector(".pr")?.checked ?? false;
      const terms = card.querySelector(".tm")?.value;
      const raw = await api(confirmPath, { draft_id: d.draft_id, send_email: sendEmail, ...(terms ? { terms } : {}) });
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
    } catch (e) { cardBtns().forEach((b) => b.disabled = false); toast(postedMessage(e), "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    cardBtns().forEach((b) => b.disabled = true);
    try { await api(cancelPath, { draft_id: d.draft_id }); cardDone(card, "Draft cancelled"); }
    catch (e) { cardBtns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
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
    } catch (e) { btns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/quickbooks-invoice/reminder-cancel", { draft_id: d.draft_id }); cardDone(card, "Cancelled — nothing was sent"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
  };
}

function bookingCard(d) {
  const card = bubble("card", `<h3>BOOKING DRAFT</h3><div class="cust">${esc(d.title)}</div>
    <table><tr><td>Starts</td><td>${esc(new Date(d.start).toLocaleString())}</td></tr>
    <tr><td>Ends</td><td>${esc(new Date(d.end).toLocaleString())}</td></tr>
    ${d.location ? `<tr><td>Where</td><td>${esc(d.location)}</td></tr>` : ""}</table>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Book it</button></div>`);
  const btns = () => [card.querySelector(".confirm"), card.querySelector(".cancel")].filter(Boolean);
  card.querySelector(".confirm").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/google-calendar/booking-confirm", { draft_id: d.draft_id }); cardDone(card, "✅ Booked"); S.cal = null; }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/google-calendar/booking-cancel", { draft_id: d.draft_id }); cardDone(card, "Draft cancelled"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
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
    catch (e) { btns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/gmail/email-cancel", { draft_id: d.draft_id }); cardDone(card, "Draft cancelled — nothing was sent"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
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
    } catch (e) { btns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
  };
  card.querySelector(".cancel").onclick = async () => {
    btns().forEach((b) => b.disabled = true);
    try { await api("/phone", { action: "sms-cancel", draft_id: d.draft_id }); cardDone(card, "Draft cancelled — nothing was sent"); }
    catch (e) { btns().forEach((b) => b.disabled = false); toast(e.message, "err"); }
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
      .catch((e) => { ev.target.disabled = false; toast(e.message, "err"); });
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
    const r = await fetch(`${SUPA_URL}/rest/v1/connector_accounts?status=eq.connected&select=connector,display_name,last_verified_at&order=updated_at.desc`,
      { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + t } });
    const rows = await r.json();
    const map = {};
    if (Array.isArray(rows)) rows.forEach((row) => { if (!map[row.connector]) map[row.connector] = row; });
    return map;
  } catch { return {}; }
}

// Inventory & pricing — the catalog the assistant sells from. Two boxes on
// purpose: a CSV works for any business on day one, an API key needs to know
// which system it belongs to, so it carries a provider picker beside it.
const CAT_FIELDS = [
  ["sku", "Item / SKU"], ["brand", "Brand"], ["model", "Model"], ["size", "Size"],
  ["description", "Description"], ["price", "Price"], ["cost", "Cost"],
  ["quantity", "In stock"], ["unit", "Unit"], ["location", "Location"],
];

async function renderCatalog(sh) {
  const slot = sh.querySelector("#catslot");
  if (!slot) return;
  let board;
  try { board = await api("/catalog", { action: "board" }); }
  catch (err) { slot.innerHTML = `<p class="note">Couldn't load your catalog — ${esc(err.message)}</p>`; return; }

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
        return `<div class="kv"><span>${esc(s.name)}${s.kind === "api" ? ' <small style="color:var(--cyan)">· live feed</small> ' + st[0] : ""}<br>
        <small style="color:var(--dim)">${s.kind === "api" ? (st[1] ? esc(st[1]) : "Prices are fetched at the moment you ask, so they are never stale.") : (s.item_count ? esc(String(s.item_count)) + " items · " : "") + esc(s.as_of || "")}</small></span>
        <span><button class="btn ghost" data-catdel="${esc(s.id)}" style="padding:6px 11px;font-size:12px;color:var(--red)">Remove</button></span></div>`;
      }).join("")
    : `<p class="note" style="margin:0 0 10px">Nothing loaded yet. Ledger will say it doesn't know rather than guess a price.</p>`;

  slot.innerHTML = `${rows}
    <div class="panel" style="margin-top:12px">
      <b style="font-size:13.5px">📄 Upload a price list</b>
      <p class="note" style="margin:6px 0 10px">Any spreadsheet, any column names — CSV or tab-separated. Ledger reads the header and works out which column is the price, the size and the stock count. Nothing to set up.</p>
      <button class="btn ghost wide" id="catpick">Choose a file</button>
      <input type="file" id="catfile" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden>
      <div id="catstage"></div>
    </div>
    <div class="panel" style="margin-top:10px">
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
    </div>`;

  slot.querySelectorAll("[data-catdel]").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Remove this price list? Ledger will stop quoting from it.")) return;
      btn.disabled = true;
      try { await api("/catalog", { action: "delete-source", source_id: btn.dataset.catdel }); toast("Removed"); renderCatalog(sh); }
      catch (err) { btn.disabled = false; toast(err.message, "err"); }
    };
  });

  const stage = slot.querySelector("#catstage");
  slot.querySelector("#catpick").onclick = () => slot.querySelector("#catfile").click();
  slot.querySelector("#catfile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6_000_000) { toast("That file is over 6 MB — trim unused columns or split it", "err"); return; }
    stage.innerHTML = `<p class="note" style="margin-top:10px">Reading ${esc(file.name)}…</p>`;
    let csv;
    try {
      csv = await new Promise((res, rej) => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsText(file);
      });
    } catch { stage.innerHTML = `<p class="note" style="color:var(--red)">Couldn't read that file.</p>`; return; }

    stage.innerHTML = `<p class="note" style="margin-top:10px">Working out your columns…</p>`;
    let look;
    try { look = await api("/catalog", { action: "analyze", filename: file.name, csv }); }
    catch (err) { stage.innerHTML = `<p class="note" style="color:var(--red);margin-top:10px">${esc(err.message)}</p>`; return; }

    // Show what it decided BEFORE anything is stored. A mapping the owner can
    // see is a mapping they can catch — and a wrong price column is the one
    // mistake that would quote a customer badly.
    const mapped = CAT_FIELDS.filter(([key]) => look.column_map?.[key])
      .map(([key, label]) => `<div class="kv"><span>${esc(label)}</span><span style="color:var(--cyan);font-size:12.5px">${esc(look.column_map[key])}</span></div>`).join("");
    stage.innerHTML = `<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
      <b style="font-size:13px">${esc(String(look.row_count))} rows${look.truncated ? " (first 25,000)" : ""}</b>
      ${look.summary ? `<p class="note" style="margin:5px 0 9px">${esc(look.summary)}</p>` : ""}
      ${look.warning ? `<p class="note" style="color:var(--orange);margin:5px 0 9px">⚠️ ${esc(look.warning)}</p>` : ""}
      <div class="eyebrow" style="margin-top:6px">COLUMNS I FOUND</div>
      ${mapped || '<p class="note">None — this file may not be a product list.</p>'}
      ${look.unmapped?.length ? `<p class="note" style="margin-top:8px;font-size:11.5px">Kept alongside each item: ${esc(look.unmapped.slice(0, 8).join(", "))}${look.unmapped.length > 8 ? "…" : ""}</p>` : ""}
      <button class="btn primary wide" style="margin-top:12px" id="catgo">Import ${esc(String(look.row_count))} items</button>
      <button class="btn ghost wide" style="margin-top:8px" id="catcancel">Cancel</button></div>`;
    stage.querySelector("#catcancel").onclick = () => { stage.innerHTML = ""; };
    stage.querySelector("#catgo").onclick = async (ev) => {
      const go = ev.currentTarget;
      go.disabled = true; go.textContent = "Importing…";
      try {
        const done = await api("/catalog", { action: "import", filename: file.name, csv, column_map: look.column_map });
        toast(`${done.imported} items loaded`);
        renderCatalog(sh);
      } catch (err) { go.disabled = false; go.textContent = "Try import again"; toast(err.message, "err"); }
    };
  };

  slot.querySelector("#catconn").onclick = async (ev) => {
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
    } catch (err) { btn.disabled = false; btn.textContent = "Save key"; toast(err.message, "err"); }
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
      ${row("bzphone", "&#128222;", "Phone & Front Desk", "Number, reminders, auto-replies")}
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
      <div class="kv"><span>Used this month</span><span>${u ? money(u.spent_usd) + " of " + money(u.budget_usd) : "—"}</span></div>
      <div style="height:7px;background:rgba(255,255,255,.07);border-radius:99px;margin-top:9px;overflow:hidden">
        <div style="height:100%;width:${Math.min(pct, 100)}%;background:${pct >= 80 ? "var(--orange)" : "linear-gradient(90deg,var(--cyan),var(--purple))"}"></div></div>
      <button class="btn ghost wide" style="margin-top:11px" id="bpu">⚡ Power-Ups</button>
    </div>
    ${u?.sms ? `<div class="eyebrow" style="margin-top:20px">TEXTING CREDIT</div>
    <div class="panel" style="margin-top:8px">
      ${u.sms.metered ? `${smsMeterHtml(u.sms)}
      <button class="btn ghost wide" style="margin-top:11px" id="bsms">💬 Add $25 texting credit</button>`
      : `<p class="note" style="margin-top:0">Your texts run on your own line, so that provider bills them. A Ledger business number includes $25 of texting every month.</p>`}
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
    <div id="teamslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">NOTIFICATIONS</div>
    <div id="pushslot" class="note" style="margin-top:8px">Checking…</div>

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
    pushSettingsCard(sh.querySelector("#pushslot"));
    sh.querySelector("#bzbooks").onclick = () => {
      closeSheet();
      if (native) booksSettingsSheet();
      else { S.financeLane = "invoices"; setTab("finance"); }
    };
    const cardBtn = sh.querySelector("#bzcard");
    if (cardBtn) cardBtn.onclick = async () => {
      try { const r = await booksApi({ action: "connect-onboard" }); if (r.url) window.open(r.url, "_blank"); }
      catch (e) { toast(e.message, "err"); }
    };
    sh.querySelector("#bzphone").onclick = () => { closeSheet(); setTab("phone"); };
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
      } catch (err) { btn.disabled = false; btn.textContent = "Upload logo"; toast(err.message, "err"); }
    };
    connectionStates().then((map) => {
      const slot = sh.querySelector("#connslot"); if (!slot) return;
      slot.innerHTML = CONNECTORS.map((c) => {
        const row = map[c.key];
        const live = !!row;
        return `<div class="kv"><span>${esc(c.name)}<br><small style="color:var(--dim)">${esc(row?.display_name || c.detail)}</small></span>
          <span><button class="btn ghost" data-connect="${c.start}" style="padding:6px 11px;font-size:12px">
            ${live ? `<span style="color:var(--emerald)">&#9679; Live</span> · Reconnect` : "Connect"}</button></span></div>`;
      }).join("");
      wireConnect(slot);
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
          catch (e) { tog.disabled = false; toast(e.message, "err"); }
        };
        const cp = slot.querySelector("#bkcopy");
        if (cp) cp.onclick = async () => {
          try { await navigator.clipboard.writeText(s.link); toast("Link copied"); }
          catch { prompt("Copy your booking link:", s.link); }
        };
        const sh2 = slot.querySelector("#bkshare");
        if (sh2) sh2.onclick = async () => {
          try { await navigator.share({ title: "Book with " + (S.profile?.business?.name || "us"), url: s.link }); }
          catch { try { await navigator.clipboard.writeText(s.link); toast("Link copied"); } catch {} }
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
                 <span><button class="btn ghost" data-bkdone="${esc(r.id)}" style="padding:6px 11px;font-size:12px">Handled</button></span></div>`).join("");
              rq.querySelectorAll("[data-bkdone]").forEach((btn) => btn.onclick = async () => {
                btn.disabled = true;
                try { await api("/bookings", { action: "mark-handled", id: btn.dataset.bkdone }); renderBooking(); }
                catch (e) { btn.disabled = false; toast(e.message, "err"); }
              });
            }
          } catch {}
        }
      } catch { slot.textContent = "Booking unavailable right now."; }
    };
    renderBooking();
    sh.querySelector("#bpu").onclick = powerUpSheet;
    const bsms = sh.querySelector("#bsms"); if (bsms) bsms.onclick = textingSheet;
    sh.querySelector("#bnew").onclick = () => { newConversation(); closeSheet(); openChat(); };
    sh.querySelector("#bbill").onclick = async () => {
      try { const d = await api("/stripe-billing/portal", {}); location.href = d.url; }
      catch (e) { toast(e.message, "err"); }
    };
    sh.querySelector("#bout").onclick = () => supa.auth.signOut().then(() => location.reload());
    sh.querySelector("#bdel").onclick = async (e) => {
      // App Store 5.1.1(v): a real, in-app, no-undo path — not a support-ticket request.
      if (!confirm("Delete your account? This permanently deletes your account and cannot be undone — receipts, conversations and connections go with it. If you're the workspace owner, this also deletes the workspace and every teammate's account.")) return;
      const typed = prompt('Type DELETE to confirm.');
      if (typed !== "DELETE") { if (typed !== null) toast("Account not deleted — you didn't type DELETE.", "err"); return; }
      e.currentTarget.disabled = true; e.currentTarget.textContent = "Deleting…";
      try {
        await api("/workspace-profile", { action: "delete-account", confirm: "DELETE" });
        await supa.auth.signOut();
        location.reload();
      } catch (err) {
        e.currentTarget.disabled = false; e.currentTarget.textContent = "Delete account";
        toast(err.message, "err");
      }
    };
    const inst = sh.querySelector("#install");
    if (inst) inst.onclick = async () => { S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null; closeSheet(); };
    sh.querySelector("#bsave").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        const detail = await api("/workspace-profile", { action: "update", name: sh.querySelector("#bn").value.trim(), address: sh.querySelector("#ba").value.trim(), call_me: sh.querySelector("#bcall").value.trim() });
        S.profile.business = { ...S.profile.business, ...detail };
        const hdr = $("bizname");
        if (hdr) hdr.textContent = S.profile.business.name || "Ledger AI";
        toast("Saved");
      } catch (err) { toast(err.message, "err"); }
      e.currentTarget.disabled = false;
    };
    try {
      const t = await api("/team", { action: "list" });
      S.team = t;
      const me = (t.members || []).find((m) => (m.email || "").toLowerCase() === S.email);
      if (me) S.profile.role = me.role;
      const slot = sh.querySelector("#teamslot");
      slot.innerHTML = `${(t.members || []).map((m) => `<div class="kv"><span>${esc(m.email)}</span><span>${esc(m.role)}</span></div>`).join("")}
        ${(t.invites || []).map((i) => `<div class="kv"><span>${esc(i.email)}</span><span style="color:var(--gold)">invited</span></div>`).join("")}
        ${(S.profile?.role || (S.team?.members || []).find((m) => (m.email || "").toLowerCase() === S.email)?.role) === "owner" ? `<div style="margin-top:10px"><input id="invmail" type="email" placeholder="teammate@business.com">
          <button class="btn ghost wide" style="margin-top:8px" id="invgo">Invite — $299/mo per seat</button></div>` : ""}`;
      const go = slot.querySelector("#invgo");
      if (go) go.onclick = async () => {
        go.disabled = true;
        try {
          const r = await api("/team", { action: "invite", email: slot.querySelector("#invmail").value.trim() });
          slot.innerHTML = `<p class="note ok">Invited. Their join code is <b>${esc(r.code || "")}</b> — send it to them; it expires in 7 days.</p>`;
        } catch (e) { go.disabled = false; toast(e.message, "err"); }
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
function accessLocked(row) {
  const status = String(row?.subscription_status ?? "trialing");
  if (status === "active" || status === "past_due") return false;
  if (status === "trialing") return Boolean(row?.trial_ends_at) && new Date(row.trial_ends_at).getTime() <= Date.now();
  return true;
}
let lockPoll = null;
function lockView(seed) {
  if (lockPoll) clearInterval(lockPoll);
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
    <button class="btn" id="lk-pay">${expiredTrial ? "Subscribe now" : "Resume subscription"}</button>
    <p class="note" style="margin-top:10px">Cancel any time · your records stay exactly as you left them</p>
    <p style="margin-top:22px;font-size:13px;line-height:2"><a href="#" id="lk-export" style="color:var(--cyan)">Export my data</a> &middot; <a href="#" id="lk-delete" style="color:var(--dim)">Delete my account</a> &middot; <a href="#" id="lk-out" style="color:var(--dim)">Sign out</a></p>
    <p style="margin-top:12px;font-size:12.5px"><a href="privacy.html" style="color:var(--dim)">Privacy</a> &middot; <a href="terms.html" style="color:var(--dim)">Terms</a> &middot; <a href="support.html" style="color:var(--dim)">Support</a></p></div>`;
  $("lk-pay").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      // A shop that already has a Stripe customer resumes in the portal; a
      // trial that never added a card goes to checkout.
      const st = await api("/stripe-billing/status", {}).catch(() => ({}));
      const path = expiredTrial || !st.portal_available ? "/stripe-billing/checkout" : "/stripe-billing/portal";
      const c = await api(path, {}); location.href = c.url;
    } catch (err) { toast(err.message, "err"); e.currentTarget.disabled = false; }
  };
  $("lk-export").onclick = async (e) => {
    e.preventDefault();
    try {
      const ex = await api("/books", { action: "export" });
      const rows = (csv) => Math.max(0, String(csv || "").trim().split("\n").length - 1);
      if (!rows(ex.customers_csv) && !rows(ex.invoices_csv) && !rows(ex.payments_csv)) { toast("Nothing to export here — your books live in QuickBooks, which you still own.", "err"); return; }
      const blob = new Blob(["== CUSTOMERS ==\n" + ex.customers_csv + "\n\n== INVOICES ==\n" + ex.invoices_csv + "\n\n== LINES ==\n" + ex.lines_csv + "\n\n== PAYMENTS ==\n" + ex.payments_csv], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ledger-books-export.csv"; a.click();
      toast("Export downloaded");
    } catch (err) { toast(err.message, "err"); }
  };
  $("lk-delete").onclick = async (e) => {
    e.preventDefault();
    if (!confirm("Delete your account? This permanently deletes your account and cannot be undone — receipts, conversations and connections go with it. If you're the workspace owner, this also deletes the workspace and every teammate's access.")) return;
    const typed = prompt("Type DELETE to confirm.");
    if (typed !== "DELETE") { if (typed !== null) toast("Account not deleted — you didn't type DELETE.", "err"); return; }
    try { await api("/workspace-profile", { action: "delete-account", confirm: "DELETE" }); await supa.auth.signOut(); location.reload(); }
    catch (err) { toast(err.message, "err"); }
  };
  $("lk-out").onclick = (e) => { e.preventDefault(); supa.auth.signOut().then(() => location.reload()); };
  // Payment lands by webhook a few seconds after Stripe sends them back here:
  // keep asking, and open the app the moment the workspace is unlocked.
  lockPoll = setInterval(async () => {
    try { const st = await api("/stripe-billing/status", {}); if (st.access && st.access !== "locked") { clearInterval(lockPoll); location.reload(); } } catch {}
  }, 6000);
}

function loginView(sent) {
  root.innerHTML = `<div class="login"><div class="mark"><img src="assets/logo-mark-96.png" alt=""></div><h2>Ledger AI</h2>
    <p>${sent ? `We emailed a sign-in link to <b>${esc(sent)}</b>. Tap it and you'll land right back here.` : "Your business copilot. Sign in with your work email — new here? The same link starts your free trial."}</p>
    ${sent ? `<p class="note">Not there in a minute? Check Spam or Updates. <a href="#" id="resend" style="color:var(--cyan)">Send it again</a> · <a href="#" id="retype" style="color:var(--cyan)">Wrong address?</a></p>`
      : '<input id="email" type="email" placeholder="you@business.com" autocomplete="email"><button class="btn" id="go">Send sign-in link</button><p class="note" style="margin-top:10px">14-day free trial · no card needed · no password to remember</p>'}
    <p style="margin-top:18px;font-size:12.5px"><a href="privacy.html" style="color:var(--dim)">Privacy</a> &middot; <a href="support.html" style="color:var(--dim)">Support</a></p></div>`;
  if (sent) {
    $("retype").onclick = (e) => { e.preventDefault(); loginView(); };
    $("resend").onclick = async (e) => {
      e.preventDefault();
      const { error } = await supa.auth.signInWithOtp({ email: sent, options: { emailRedirectTo: location.href.split("#")[0].split("?")[0] } });
      toast(error ? error.message : "Sent again — give it a minute.", error ? "err" : undefined);
    };
    return;
  }
  const go = async () => {
    const email = $("email").value.trim(); if (!email) return;
    const { error } = await supa.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0].split("?")[0] } });
    if (error) toast(error.message, "err"); else loginView(email);
  };
  $("go").onclick = go;
  $("email").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
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
      onboardInterview(name);
    } catch (e) { toast(e.message, "err"); }
  };
}

// Four universal questions right after workspace creation. Answers become
// owner-stated memory facts (confidence 0.95) so Ledger knows the business
// from its very first message. Every question is skippable — onboarding is
// where signups die, so the whole screen is one tap from gone.
const ONBOARD_QUESTIONS = [
  { id: "obq1", q: "What kind of work do you do?", ph: "e.g. mobile tire shop, plumbing, barbershop, towing", fact: "Business type", cat: "operations" },
  { id: "obq2", q: "What are your main services or products?", ph: "e.g. tire installs, seasonal changeovers, flat repairs", fact: "Main services/products", cat: "operations" },
  { id: "obq3", q: "Who's on the team, and who handles the books?", ph: "e.g. just me — I do everything; my wife does invoicing", fact: "Team", cat: "people" },
  { id: "obq4", q: "What are your hours and service area?", ph: "e.g. Mon-Sat 9-6, Calgary and area", fact: "Hours and service area", cat: "operations" },
];

function onboardInterview(bizName) {
  root.innerHTML = `<div class="login" style="max-width:440px"><div class="mark"><img src="assets/logo-mark-96.png" alt=""></div><h2>Tell Ledger about ${esc(bizName)}</h2>
    <p>Answer what you like, skip what you don't — Ledger remembers all of it and starts day one already knowing your business.</p>
    ${ONBOARD_QUESTIONS.map((o) => `<label class="fld" style="text-align:left;display:block;margin-top:12px">${esc(o.q).toUpperCase()}</label>
      <input id="${o.id}" placeholder="${esc(o.ph)}" maxlength="400">`).join("")}
    <button class="btn" id="obgo" style="margin-top:18px">Finish setup →</button>
    <button class="btn ghost" id="obskip" style="margin-top:8px">Skip for now</button></div>`;
  const finish = async (save) => {
    const btn = $("obgo"); btn.disabled = true; btn.textContent = "Saving…";
    let saved = 0;
    if (save) {
      for (const o of ONBOARD_QUESTIONS) {
        const a = $(o.id).value.trim();
        if (!a) continue;
        try { await api("/ledger-ai", { action: "memory_add", fact: `${o.fact}: ${a}`, category: o.cat }); saved++; } catch {}
      }
    }
    appView();
    openChat();
    sys("🎉 " + bizName + " is set up — your 14-day free trial is live." +
      (saved ? " I've memorized what you told me about the business — ask me anything." : " Ask me anything, and connect QuickBooks to bring your books in."));
  };
  $("obgo").onclick = () => finish(true);
  $("obskip").onclick = () => finish(false);
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
    } catch (e) { toast(e.message, "err"); }
  };
}

/* ---------------- BOOT ---------------- */
// bootstrap answers "does this user have a workspace"; `get` carries the business detail.
// currency_code isn't on either payload, so it comes from the workspaces row (RLS: members read).
async function loadProfile(boot) {
  const profile = { ...boot, business: { name: boot.name || "", address: "", logo_url: null } };
  try {
    const detail = await api("/workspace-profile", { action: "get" });
    profile.business = { ...profile.business, ...detail };
  } catch {}
  try {
    const { data } = await supa.from("workspaces").select("currency_code").eq("id", boot.workspace_id).maybeSingle();
    if (data?.currency_code) S.currency = data.currency_code;
  } catch {}
  S.profile = profile;
  return profile;
}

async function boot() {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) { loginView(false); return; }
  S.email = (session.user?.email || "").toLowerCase();
  try {
    const b = await api("/workspace-profile", { action: "bootstrap" });
    if (b.invite_pending) { joinView(b.invited_business || "A business"); return; }
    if (b.needs_setup) { setupView(); return; }
    // Hard lock (2026-09-05): a lapsed subscription never sees the app shell.
    if (accessLocked(b)) { lockView({ name: b.name, subscription_status: b.subscription_status, trial_ends_at: b.trial_ends_at }); return; }
    await loadProfile(b);
    appView();
  } catch { appView(); }
  // app.html#vin opens the scanner straight away (Home Screen shortcut / QR on the shop wall).
  if (location.hash === "#vin") { history.replaceState(null, "", location.pathname); vinScannerSheet(); }
}
/* ---------------- Client Hub sharing (web parity 2026-09-02) ----------------
   The iPhone hands a customer their portal link from the customer screen; the
   web twin does the same. One link per QBO customer, get-or-create, with
   copy / share / pause / new-link. Mirrors CustomerDetailView's hub card. */
function clientHubCard(slot, c) {
  if (!slot || !c?.id) return;
  const paint = (link, err) => {
    if (err) { slot.innerHTML = `<div class="note">Client Hub: ${esc(err)}</div>`; return; }
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
    const busy = async (fn) => { try { await fn(); } catch (e) { toast(e.message || "Client Hub failed", "err"); } };
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
      if (!confirm("Make a new link? The old one stops working immediately.")) return;
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
        } catch (e) { toast(e.message || "Couldn't change notifications", "err"); }
        run();
      };
      const t = slot.querySelector("#pushtest");
      if (t) t.onclick = async () => {
        try { const r = await api("/web-push", { action: "test" }); toast(r.delivered > 0 ? `Test sent to ${r.delivered} device${r.delivered === 1 ? "" : "s"}` : "No device received it", r.delivered > 0 ? undefined : "err"); }
        catch (e) { toast(e.message || "Test failed", "err"); }
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
let LIVE = null;
function liveSheet() {
  if (LIVE) { LIVE.draw(); return; }
  const L = { state: "connecting", err: "", lines: [], cost: 0, pc: null, dc: null, mic: null, audio: null, drafts: [] };
  const stop = () => {
    try { L.dc?.close(); } catch {}
    try { L.mic?.getTracks().forEach((t) => t.stop()); } catch {}
    try { L.pc?.close(); } catch {}
    if (L.audio) { L.audio.pause(); L.audio.srcObject = null; }
    LIVE = null;
  };
  const labels = { connecting: "Connecting…", listening: "Listening", thinking: "Thinking…", speaking: "Ledger is speaking", failed: "Couldn't connect", ended: "Ended" };
  L.draw = () => {
    const live = ["listening", "thinking", "speaking"].includes(L.state);
    sheet(`<h2>&#127908; Ledger Live</h2>
      <p class="sh-sub">${esc(labels[L.state] || L.state)}${L.cost ? ` · $${L.cost.toFixed(2)} this session` : ""}</p>
      <div style="display:flex;justify-content:center;margin:14px 0">
        <div style="width:96px;height:96px;border-radius:50%;background:${L.state === "speaking" ? "var(--cyan)" : L.state === "failed" ? "#7f1d1d" : "var(--card2)"};border:2px solid var(--line);box-shadow:0 0 ${live ? "34px" : "0"} rgba(34,211,238,.35);transition:all .3s"></div>
      </div>
      ${L.err ? `<div class="note" style="color:#fca5a5">${esc(L.err)}</div>` : ""}
      <div class="note" style="max-height:34vh;overflow:auto">${L.lines.map((l) => `<div style="margin:4px 0"><b>${l.who === "you" ? "You" : "Ledger"}:</b> ${esc(l.text)}</div>`).join("") || "Talk naturally — ask for today's numbers, who owes you, or to draft an invoice. Say \"stop\" or tap End."}</div>
      <div class="rowbtns" style="margin-top:14px">
        ${live ? `<button class="btn ghost" id="livemute">${L.muted ? "Unmute" : "Mute"}</button>` : ""}
        <button class="btn primary" id="liveend">${L.state === "failed" || L.state === "ended" ? "Close" : "End"}</button>
      </div>`, (sh) => {
      sh.querySelector("#liveend").onclick = () => { stop(); closeSheet(); L.drafts.forEach(emailDraftCard); };
      const m = sh.querySelector("#livemute");
      if (m) m.onclick = () => { L.muted = !L.muted; L.mic?.getAudioTracks().forEach((t) => { t.enabled = !L.muted; }); L.draw(); };
    });
    const wrap = $("sheetwrap"); if (wrap) wrap.querySelector(".sheet-back").onclick = () => { closeSheet(); if (!live) stop(); };
  };
  const set = (state) => { L.state = state; L.draw(); };
  const send = (ev) => { try { L.dc?.send(JSON.stringify(ev)); } catch {} };
  const onEvent = async (ev) => {
    switch (ev.type) {
      case "session.created": case "input_audio_buffer.speech_started": if (L.state !== "speaking") set("listening"); break;
      case "input_audio_buffer.speech_stopped": set("thinking"); break;
      case "response.created": set("speaking"); break;
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
      const info = await api("/realtime/session", {});
      L.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      L.pc = pc;
      L.audio = new Audio(); L.audio.autoplay = true;
      pc.ontrack = (e) => { L.audio.srcObject = e.streams[0]; L.audio.play().catch(() => {}); };
      L.mic.getTracks().forEach((t) => pc.addTrack(t, L.mic));
      const dc = pc.createDataChannel("oai-events"); L.dc = dc;
      dc.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
      dc.onopen = () => { if (L.state === "connecting") set("listening"); };
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

boot();
supa.auth.onAuthStateChange((event, s) => {
  if (event === "SIGNED_IN" && s && !$("view") && !$("bizname") && !$("joincode")) boot();
});
