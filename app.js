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
function closeSheet() { const w = $("sheetwrap"); if (w) w.remove(); }

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

function osHead(code, title) {
  return `<div>
    <div class="oshead"><span class="dash"></span>
      <span class="code">LEDGER OS // ${esc(code)}</span>
      <span class="eq"><i></i><i></i><i></i></span></div>
    <h2 class="ostitle">${esc(title)}</h2>
    <div class="osrule"></div>
  </div>`;
}

function appView() {
  const logo = S.profile?.business?.logo_url;
  root.innerHTML = `
  <header>
    <div class="mark">${logo ? `<img src="${esc(logo)}" alt="">` : "L"}</div>
    <h1 id="bizname">${esc(S.profile?.business?.name || "Ledger AI")}</h1>
    <span id="usage"></span>
    <button class="hchat" id="hchat" title="Ask Ledger">&#128172;</button>
    <button class="avatar" id="more" title="Your business">&#9679;</button>
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
    sys("Connected to your live books and calendar. Ask me anything — sales, who owes you, your week ahead.");
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
    try { const d = await api(b.dataset.connect, {}); location.href = d.authorization_url; }
    catch (err) { b.disabled = false; toast(err.message, "err"); }
  }, scope);
}

/* ---------------- HOME ---------------- */
const ASK_CHIPS = [
  { icon: "&#128196;", label: "Create an invoice", prompt: "Create me an invoice — let's draft one now." },
  { icon: "&#128200;", label: "Sales this week", prompt: "Report my sales for this week." },
  { icon: "&#128221;", label: "Create an estimate", prompt: "Create me an estimate — let's draft one." },
  { icon: "&#128202;", label: "Last month & YOY", prompt: "Report my sales for last month, and compare them year over year." },
];

async function renderHome() {
  const logo = S.profile?.business?.logo_url;
  view().innerHTML = `
    <div class="sect">
      ${osHead("CORE.01 · COMMAND", "Ledger")}
      <div class="brandcard">
        <div class="tile">${logo ? `<img src="${esc(logo)}" alt="">` : "L"}</div>
        <div class="who"><b>Ledger AI</b><span>Intelligence.<br>Accuracy. Control.</span></div>
        <span class="status"><i></i>READY</span>
      </div>

      <div class="console">
        <div class="chead">
          <b>Ask Ledger</b>
          <span class="core">AI CORE // ONLINE</span>
          <button class="livepill" id="livebtn"><span class="wv"><i></i><i></i><i></i><i></i></span>LIVE</button>
        </div>
        <div class="askfield">
          <span class="sparkicon">&#10022;</span>
          <input id="askbox" placeholder="Tell Ledger what to do…" autocomplete="off">
          <button class="iconbtn" id="askcam" title="Capture a receipt">&#9673;</button>
          <button class="gobtn" id="askgo" title="Send">&#8593;</button>
        </div>
        <div class="askgrid">${ASK_CHIPS.map((c, i) =>
          `<button class="askchip c${i}" data-ask="${esc(c.prompt)}"><em>${c.icon}</em>${esc(c.label)}</button>`).join("")}</div>
      </div>

      <div id="homekpis"><div class="skel"></div></div>
      <div id="homemail"></div>
      <div id="homenext"></div>
      <div id="homeattn"></div>
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
  // Ledger Live (realtime voice) is an iPhone capability — say so rather than fake an orb.
  $("livebtn").onclick = () => toast("Ledger Live voice runs in the iPhone app");
  $("askcam").onclick = () => { S.financeLane = "receipts"; setTab("finance"); };
  on("[data-ask]", "click", (e) => { openChat(); $("box").value = e.currentTarget.dataset.ask; send(); });
  loadHomeKpis();
  loadHomeMail();
  loadHomeNext();
  loadHomeAttention();
}

function kpiBlock(k) {
  return `<div class="eyebrow" style="margin-bottom:-3px">LIVE BOOKS</div><div class="kpis">
      <div class="kpi cyan"><small>Today's sales</small><b>${money0(k.today_sales)}</b></div>
      <div class="kpi em"><small>This month</small><b>${money0(k.month_sales)}</b></div>
      <div class="kpi gold"><small>Outstanding</small><b>${money0(k.outstanding)}</b><i>${k.open_count ?? 0} open invoice${(k.open_count ?? 0) === 1 ? "" : "s"}</i></div>
      <div class="kpi purple"><small>Year to date</small><b>${money0(k.ytd_sales)}</b></div>
    </div>`;
}

async function loadHomeKpis() {
  const slot = $("homekpis"); if (!slot) return;
  try {
    if (!S.qbo || S.qboStale) { S.qbo = await get("/quickbooks-data"); S.qboStale = false; }
    slot.innerHTML = kpiBlock(S.qbo?.qbo?.kpis || {});
  } catch (e) {
    if (S.qbo) {
      // A refresh failed, but we still have the last numbers Ledger pulled — show
      // those instead of blanking a screen the owner is glancing at mid-shift.
      slot.innerHTML = kpiBlock(S.qbo?.qbo?.kpis || {}) +
        `<p class="note err" style="margin-top:8px">Couldn't refresh just now — showing the last numbers Ledger has. ${esc(e.message)}</p>`;
    } else {
      slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo")
        : `<div class="panel"><p class="sub">Couldn't reach QuickBooks: ${esc(e.message)}</p></div>`;
      wireConnect(slot);
    }
  }
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
const FINANCE_CODE = { invoices: "FIN.02 · REVENUE GRID", profit: "FIN.02 · PROFIT & LOSS", receipts: "EXP.04 · EXPENSE INTAKE" };
const FINANCE_TITLE = { invoices: "Finance", profit: "Profit", receipts: "Receipts" };

async function renderFinance() {
  const lane = S.financeLane === "profit" || S.financeLane === "receipts" ? S.financeLane : "invoices";
  view().innerHTML = `<div class="sect">
    ${osHead(FINANCE_CODE[lane], FINANCE_TITLE[lane])}
    <div class="seg">
      <button class="${lane === "invoices" ? "on" : ""}" data-fl="invoices">Invoices</button>
      <button class="${lane === "profit" ? "on" : ""}" data-fl="profit">Profit &amp; Loss</button>
      <button class="${lane === "receipts" ? "on" : ""}" data-fl="receipts">Receipts</button>
    </div>
    <div id="finbody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  on("[data-fl]", "click", (e) => { S.financeLane = e.currentTarget.dataset.fl; renderFinance(); });
  if (lane === "profit") loadProfit();
  else if (lane === "receipts") loadReceipts();
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
    <div class="ihead"><b>&#9651; Sales Intelligence</b><span class="live"><i></i>LIVE QBO</span></div>
    <p class="cap">This month</p>
    <div class="big">${money(monthTotal)}</div>
    <div class="sub">Live sales performance</div>
    <div class="spark">${days.map((d, i) =>
      `<div class="b ${i === days.length - 1 ? "hot" : ""}" style="height:${Math.max(Math.round(d.total / max * 100), 3)}%" title="${d.key}: ${money0(d.total)}"></div>`).join("")}</div>
    <div class="sparkends"><span>14 days ago</span><span>Today</span></div>
    <div class="kpis" style="margin-top:15px">
      <div class="kpi cyan"><small>Today</small><b>${money0(k.today_sales)}</b></div>
      <div class="kpi em"><small>Year to date</small><b>${money0(k.ytd_sales)}</b></div>
      <div class="kpi gold"><small>Outstanding</small><b>${money0(k.outstanding)}</b><i>${k.open_count ?? 0} open</i></div>
      <div class="kpi purple"><small>Open invoices</small><b>${k.open_count ?? 0}</b><i>Next #${esc(k.next_invoice ?? "—")}</i></div>
      <div class="kpi cyan"><small>Avg sale</small><b>${money(avg)}</b><i>${month.length} invoice${month.length === 1 ? "" : "s"} this month</i></div>
      <div class="kpi orange"><small>Forecast</small><b>${money(forecast)}</b><i>month-end run rate</i></div>
    </div>
    <p class="infoline"><em>&#9432;</em>Run rate projects this month's pace across the full month — it is not a promise.</p>
  </div>`;
}

// Manual invoice composer — the web twin of iOS InvoiceComposerSheet.
// Same single write path as chat: build → /quickbooks-invoice/draft → Confirm → /confirm.
// The AI has no posting tool here either; the Confirm tap is the only thing that posts.
async function composerSheet() {
  const C = { customer: null, lines: [], memo: "", items: [], itemsError: "", query: "", draft: null, busy: false, error: "" };
  const wrap = sheet(`<h2>New Invoice</h2><div id="cmpbody"><div class="skel"></div><div class="skel"></div></div>`);
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
      <h3>INVOICE DRAFT</h3><div class="cust">${esc(d.customer)}</div>
      <table>${(d.lines || []).map((l) => `<tr><td>${esc(l.description || l.item_name)} × ${l.quantity}</td><td>${money(l.amount)}</td></tr>`).join("")}
        <tr><td class="total">Subtotal</td><td class="total">${money(d.subtotal)}</td></tr></table>
      ${termsRow(d.terms)}
      ${d.customer_email ? `<label class="emailrow"><input type="checkbox" id="cmpem" checked> Email to ${esc(d.customer_email)}</label>` : ""}
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
        const r = await api("/quickbooks-invoice/confirm", { draft_id: d.draft_id, send_email: sendEmail, ...(terms ? { terms } : {}) });
        note.className = "note ok";
        note.textContent = "✅ Posted" + (r.doc_number ? " — #" + r.doc_number : "") + (r.emailed ? " · emailed " + (r.emailed_to || "") : "");
        body().querySelector(".row").remove();
        if (wantPrint && (r.qbo_invoice_id || r.id)) printPdfById(r.qbo_invoice_id || r.id, r.doc_number, "invoice");
        S.qboStale = true;
        setTimeout(() => { closeSheet(); loadInvoices(); }, 1400);
      } catch (e) { draftBtns().forEach((b) => b.disabled = false); note.className = "note err"; note.textContent = postedMessage(e); }
    };
    body().querySelector("#cmpcancel").onclick = async () => {
      draftBtns().forEach((b) => b.disabled = true);
      try { await api("/quickbooks-invoice/cancel", { draft_id: d.draft_id }); } catch {}
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
        C.draft = (await api("/quickbooks-invoice/draft", payload)).draft;
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
  let scanNote = "";
  try { await api("/gmail/scan", {}); }
  catch (e) { scanNote = "Email scan skipped — " + e.message; } // Gmail down or not connected: sweep what we have
  stage("Sweeping the books…");
  let sweepResult;
  try { sweepResult = await api("/profit/sweep", {}); applyBoard(sweepResult); }
  catch (e) { toast(e.message, "err"); closeSheet(); return; }
  stage("Lining up today's receipts…");
  let cards = [];
  try { cards = (await get("/profit/day-review")).cards || []; }
  catch { /* the board already updated; a review hiccup shouldn't eat the sweep */ }
  const tally = { confirmed: 0, excluded: 0, parked: 0, classified: 0, added: 0, scanNote };
  // Nothing arrived by email and nothing is on file for today at all — the one
  // moment the sweep volunteers a question, because it is the owner's explicit
  // tap that got us here, not a background nag.
  if (!cards.length && sweepResult?.sweep_empty_today) { psEmptyDay(tally); return; }
  psCard(cards, 0, tally);
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
    const cls = [k === CAL.sel ? "on" : "", k === todayKey ? "now" : ""].filter(Boolean).join(" ");
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

  view().innerHTML = `<div class="sect">
    ${osHead("CAL.03 · SCHEDULE", "Calendar")}
    <div class="searchwrap"><span class="mag">${MAG}</span>
      <input id="calsearch" placeholder="Search selected day" value="${esc(CAL.q)}"></div>
    <div class="calstats">
      <div class="calstat"><i style="background:var(--cyan);box-shadow:0 0 8px var(--cyan)"></i><b>${todayCount}</b><small>Today</small></div>
      <div class="calstat"><i style="background:var(--emerald);box-shadow:0 0 8px var(--emerald)"></i><b>${weekCount}</b><small>This week</small></div>
      <div class="calstat"><i style="background:var(--magenta);box-shadow:0 0 8px var(--magenta)"></i><b>${monthCount}</b><small>This month</small></div>
    </div>
    ${next ? `<button class="nextup" data-ev="${esc(next.id)}">
      <div class="ic">&#9203;</div>
      <div class="m"><small>&#9679; Next up · ${esc(countdown(next.start))}</small><b>${esc(next.title)}</b>
        <span>${esc(timeLabel(next.start))}${next.location ? " · " + esc(next.location) : ""}</span></div>
      <div class="go">&#8594;</div></button>` : ""}
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
    <div class="rowbtns" style="margin-top:14px">
      <button class="btn ghost" id="evdel">Delete</button>
      <button class="btn primary" id="evedit" ${e.all_day ? "disabled" : ""}>Edit</button>
    </div>
    ${back ? `<button class="btn ghost wide" style="margin-top:9px" id="evback">&#8592; Back</button>` : ""}
    <div class="note" id="evnote" style="margin-top:9px"></div>`, (sh) => {
    const note = sh.querySelector("#evnote");
    if (back) sh.querySelector("#evback").onclick = () => back();
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
    slot.innerHTML = `
      <button class="queue" id="batchqueue">
        <div class="ic">&#128229;</div>
        <div class="m"><small>QuickBooks batch queue</small>
          <b>${ready.length} queued · ${money(queueTotal)}</b>
          <span>Categorised receipts waiting to post as expenses.</span></div>
        <div class="chev">&#8250;</div>
      </button>
      <div class="panel">
        <h3>&#128247; Photograph a receipt</h3>
        <p class="sub">Snap the paper. Ledger reads the vendor, date and total, then it queues like any other receipt.</p>
        <div class="rowbtns" style="margin-top:12px">
          <button class="btn primary" id="rcptshoot">Take photo</button>
          <button class="btn ghost" id="rcptpick">Choose from library</button>
        </div>
        <input type="file" id="rcptcam" accept="image/*" capture="environment" hidden>
        <input type="file" id="rcptlib" accept="image/*" hidden>
        <p class="note" id="rcptcamnote" style="margin-top:8px"></p>
      </div>
      <div class="panel">
        <h3>&#128231; Email Receipt Radar</h3>
        <p class="sub">Ledger reads supplier receipts out of your inbox and turns them into expenses.</p>
        <div class="rowbtns" style="margin-top:12px;align-items:center">
          <select id="scanhour" class="hourpick" title="Daily scan time">
            ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === (d.scan_hour ?? 18) ? "selected" : ""}>Daily at ${hourLabel(h)}</option>`).join("")}
          </select>
          <button class="btn ghost" id="scannow">Scan now</button>
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
    receiptSheet(d.receipt, d.suggested_category);
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
      ${osHead("COM.06 · CALL LINE", "Phone")}
      ${d.hasNumber ? phoneStatusStrip(d) : ""}
      ${d.hasNumber ? "" : requestNumberCard(d.pendingRequest)}
      ${d.hasNumber ? needsYouZone(d) : ""}
      ${d.hasNumber ? automationsZone(d) : ""}
      ${d.hasNumber ? `<p class="zonehead">EVERYTHING ELSE</p>` : ""}
      ${d.hasNumber ? `<div id="vmlane"><div class="skel"></div></div>` : ""}
      ${d.hasNumber ? phoneThreadsPanel(d) : ""}
      ${d.hasNumber ? phoneFeedPanel(d) : ""}
      ${d.hasNumber ? `<div id="phoneleads"><div class="skel"></div></div>` : ""}
      ${d.hasNumber ? `<p class="zonehead">SET ONCE</p>` : ""}
      ${d.hasNumber ? phoneNumberCard(d) : ""}
      ${d.hasNumber ? phoneSettingsSummary(d) : ""}
    </div>`;
    if (!d.hasNumber) wireRequestNumber(d.pendingRequest);
    if (d.hasNumber) on("[data-pevt]", "click", (e) => phoneEventSheet(d.events.find((ev) => ev.id === e.currentTarget.dataset.pevt)));
    if (d.hasNumber) on("[data-pthread]", "click", (e) => phoneThreadSheet((d.threads || []).find((t) => t.id === e.currentTarget.dataset.pthread)));
    if (d.hasNumber) {
      $("phsetup").onclick = () => phoneSetupSheet(d);
      $("phsettings").onclick = () => phoneSettingsSheet(d);
      on("[data-needs]", "click", (e) => openNeedsYou(d, e.currentTarget.dataset.needs));
      on("[data-auto]", "click", (e) => openAutomation(d, e.currentTarget.dataset.auto));
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
      loadVoicemails(d);
      loadPhoneLeads();
    }
  } catch (e) {
    view().innerHTML = `<div class="sect">${osHead("COM.06 · CALL LINE", "Phone")}<div class="empty">${esc(e.message)}</div></div>`;
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

function phoneNumberCard(d) {
  return `<div class="panel">
    <h3>&#128222; Business number</h3>
    <div class="bignum">${esc(formatE164(d.number.e164))}</div>
    <p class="sub">Missed calls get a same-second auto-text, and the caller lands in your Leads lane below — nothing to do here but read the feed.</p>
    <button class="btn ghost wide" style="margin-top:12px" id="phsetup">&#128203; Setup guide</button>
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
    } catch (ex) { showErr(ex.message); }
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
  return `<div class="panel phsettingsrow" id="phsettings">
    <div class="ic">&#9200;</div>
    <div class="m"><b>Business hours &amp; auto-reply</b><span>${esc(start)} &ndash; ${esc(end)}</span></div>
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
  }[key] || "";
  const blurb = {
    frontdesk: "When a missed caller texts back, Ledger answers them — quoting your real QuickBooks prices and offering real open times. It can never invoice, take a payment or discuss a bill.",
    reminders: "The night before, everyone booked in gets a text asking them to confirm or say they need to move it. Each customer is texted once per appointment, ever.",
    autoreply: "A missed call gets an instant text back so the caller knows you exist and can reply.",
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
    sh.querySelector("#autotoggle").onclick = async () => {
      closeSheet();
      if (key === "frontdesk") return toggleFrontDesk(d);
      if (key === "reminders") return toggleApptReminders(d);
      try {
        await api("/phone", { action: "settings-save", autoReplyEnabled: d.autoReplyEnabled === false });
        toast(d.autoReplyEnabled === false ? "Auto text-back is on" : "Auto text-back is off");
        renderPhone();
      } catch (err) { toast(err.message); }
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
        });
        toast("Phone settings saved");
        closeSheet();
        renderPhone();
      } catch (err) { note.className = "note err"; note.textContent = err.message; e.currentTarget.disabled = false; }
    };
  });
}

function requestNumberCard(pending) {
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
    <label class="fld" style="margin-top:10px">BUSINESS HOURS</label>
    <input id="rnhours" placeholder="e.g. Mon–Fri 8am–5pm">
    <label class="fld" style="margin-top:10px">AUTO-REPLY TEXT (OPTIONAL)</label>
    <textarea id="rntemplate" rows="3" placeholder="We'll suggest one if you leave this blank."></textarea>
    <button class="btn em wide" style="margin-top:13px" id="rnsubmit">Request number</button>
    <div class="note" id="rnnote" style="margin-top:8px"></div>
  </div>`;
}

function wireRequestNumber(pending) {
  if (pending) return;
  $("rnsubmit").onclick = async (e) => {
    const note = $("rnnote");
    const businessName = $("rnbiz").value.trim();
    if (businessName.length < 2) { note.className = "note err"; note.textContent = "Business name is required"; return; }
    e.currentTarget.disabled = true;
    try {
      await api("/phone", {
        action: "request-number", businessName,
        areaCode: $("rnarea").value.trim(), hoursNote: $("rnhours").value.trim(),
        autoReplyTemplate: $("rntemplate").value.trim(),
      });
      toast("Request sent — we'll text you when your number is live");
      renderPhone();
    } catch (err) { e.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
  };
}

/* ---------------- CUSTOMERS · LEADS · TO-DO ---------------- */
const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost"];
const LEAD_SOURCES = [["call-in", "Call-in"], ["walk-in", "Walk-in"], ["referral", "Referral"],
  ["website", "Website"], ["social", "Social"], ["repeat", "Repeat"], ["other", "Other"]];
const TODO_PRIORITIES = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];

const LANE_CODE = { directory: "CRM.05 · RELATIONSHIPS", todos: "CRM.05 · MISSION CONTROL" };

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
    ${osHead(LANE_CODE[S.lane] || LANE_CODE.directory, S.lane === "todos" ? "To-Do" : "Customers")}
    <div class="seg">
      ${[["directory", "Directory", 0], ["todos", "To-Do", laneAlerts().todos]].map(([k, l, n]) =>
        `<button class="${S.lane === k ? "on" : ""}" data-lane="${k}">${l}${n ? `<i class="badge">${n}</i>` : ""}</button>`).join("")}
    </div>
    <div id="lanebody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  on("[data-lane]", "click", (e) => { S.lane = e.currentTarget.dataset.lane; renderCustomers(); });
  if (S.lane === "directory") {
    loadDirectory();
    // iOS keeps the To-Do badge live from the same board; fetch it once so Directory shows it too.
    if (!S.board) api("/leads", { action: "board" }).then((b) => { S.board = b; if (S.tab === "customers") renderCustomers(); }).catch(() => {});
  } else loadBoard();
}

const reviewAsked = () => new Set((localStorage.getItem("kmj.reviewRequestedCustomerIDs") || "").split(",").filter(Boolean));
const markReviewAsked = (id) => { const s = reviewAsked(); s.add(id); localStorage.setItem("kmj.reviewRequestedCustomerIDs", [...s].sort().join(",")); };

async function loadDirectory() {
  const slot = $("lanebody"); if (!slot) return;
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
function newCustomerSheet(prefill, onCreated) {
  const pre = prefill || {};
  const form = (force) => `<h2>New Customer</h2>
    ${prefill ? `<p class="sh-sub">Converting lead &ldquo;${esc(pre.name || "")}&rdquo; — creating the customer marks it WON.</p>` : ""}
    <div class="eyebrow">Customer</div>
    <div class="cmpsect">
      <input id="ncName" class="cmpinput" placeholder="Name (required)" value="${esc(pre.name || "")}">
      <input id="ncCompany" class="cmpinput" placeholder="Company (optional)" value="${esc(pre.company || "")}">
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
    const note = sh.querySelector("#ncNote");
    const dup = sh.querySelector("#ncDup");
    const val = (id) => (sh.querySelector("#" + id)?.value || "").trim();
    const submit = async (force, btn) => {
      const name = val("ncName");
      if (!name) { note.className = "note err"; note.textContent = "A name is required."; return; }
      btn.disabled = true; note.className = "note"; note.textContent = "Creating…";
      const payload = { display_name: name, force };
      [["company", "ncCompany"], ["email", "ncEmail"], ["phone", "ncPhone"], ["mobile", "ncMobile"], ["notes", "ncNotes"]]
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
  sheet(`<h2>${isNew ? "New lead" : esc(l.name)}</h2>
    <p class="sh-sub">${isNew ? "Who is it, and when do you chase them?" : esc(l.company || "")}</p>
    <label class="fld">NAME</label><input id="lname" value="${esc(l.name || "")}">
    <label class="fld">COMPANY</label><input id="lco" value="${esc(l.company || "")}">
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
    const conv = sh.querySelector("#lconv");
    if (conv) conv.onclick = () => newCustomerSheet(l, async (created) => {
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

async function billingCheck() {
  try {
    const s = await api("/stripe-billing/status", {});
    const a = $("alertbar"); if (!a) return;
    const link = (label) => {
      const b = document.createElement("u"); b.style.cursor = "pointer"; b.textContent = label;
      b.onclick = async () => { try { const c = await api("/stripe-billing/checkout", {}); location.href = c.url; } catch (e) { toast(e.message, "err"); } };
      a.appendChild(b);
    };
    if (s.subscription_status === "canceled") {
      a.textContent = "Subscription inactive — renew to keep your copilot."; a.style.display = "block";
      if (s.billing_ready) link(" Renew now");
    } else if (s.subscription_status === "trialing" && s.trial_days_left !== null) {
      a.style.background = "rgba(251,191,36,.12)"; a.style.color = "var(--gold)";
      a.textContent = s.trial_days_left > 0
        ? `🎁 Free trial — ${s.trial_days_left} day${s.trial_days_left === 1 ? "" : "s"} left.`
        : "⏰ Your free trial has ended.";
      if (s.billing_ready) link(" Subscribe now");
      a.style.display = "block";
    }
  } catch {}
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
    <table>${lines}<tr><td class="total">Subtotal</td><td class="total">${money(d.subtotal)}</td></tr></table>
    ${isInvoice ? termsRow(d.terms) : ""}
    ${d.customer_email ? `<label class="emailrow"><input type="checkbox" class="em" checked> Email to ${esc(d.customer_email)}</label>` : ""}
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
      const r = await api(confirmPath, { draft_id: d.draft_id, send_email: sendEmail, ...(terms ? { terms } : {}) });
      cardDone(card, "✅ Posted" + (r.doc_number ? " — #" + r.doc_number : "") + (r.emailed ? " · emailed " + (r.emailed_to || "") : ""));
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
  sheet(`<h2>Your business</h2><p class="sh-sub">${esc(b.name || "")}${S.profile?.role ? " · you're the " + esc(S.profile.role) : ""}</p>
    <label class="fld">BUSINESS NAME</label><input id="bn" value="${esc(b.name || "")}">
    <label class="fld">ADDRESS</label><input id="ba" value="${esc(b.address || "")}">
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

    <div class="eyebrow" style="margin-top:20px">CONNECTIONS</div>
    <p class="note" style="margin-top:5px">Authorization happens on each provider's official sign-in page. Ledger never receives your password.</p>
    <div id="connslot" class="note" style="margin-top:8px">Checking connections…</div>

    <div class="eyebrow" style="margin-top:20px">INVENTORY &amp; PRICING</div>
    <p class="note" style="margin-top:5px">Give Ledger your product list and it can quote from it — price, size, what's in stock.</p>
    <div id="catslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">ONLINE BOOKING</div>
    <div id="bookslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">TEAM</div>
    <div id="teamslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">APP</div>
    <div class="rowbtns" style="margin-top:8px;flex-direction:column">
      ${S.installPrompt ? `<button class="btn primary wide" id="install">📲 Install Ledger AI</button>` : ""}
      <button class="btn ghost wide" id="bnew">Start a fresh conversation</button>
      <button class="btn ghost wide" id="bbill">Manage subscription</button>
      <button class="btn ghost wide" id="bsupport">Contact support</button>
      <button class="btn ghost wide" id="bsupportchat">Support &amp; account help</button>
      <button class="btn ghost wide" id="bout" style="color:var(--red)">Sign out</button>
      <button class="btn ghost wide" id="bdel" style="color:var(--red)">Delete account</button>
    </div>
    <p class="note" style="margin-top:12px;text-align:center">
      <a href="${FN}/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a> ·
      <a href="${FN}/legal/terms" target="_blank" rel="noopener">Terms of Service</a></p>`, async (sh) => {
    wireConnect(sh);
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
        const detail = await api("/workspace-profile", { action: "update", name: sh.querySelector("#bn").value.trim(), address: sh.querySelector("#ba").value.trim() });
        S.profile.business = { ...S.profile.business, ...detail };
        $("bizname").textContent = S.profile.business.name || "Ledger AI";
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
          <button class="btn ghost wide" style="margin-top:8px" id="invgo">Invite — $125/mo per seat</button></div>` : ""}`;
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
function loginView(sent) {
  root.innerHTML = `<div class="login"><div class="mark">L</div><h2>Ledger AI</h2>
    <p>${sent ? "Check your email — tap the sign-in link and you'll land right back here." : "Your business copilot. Sign in with your work email."}</p>
    ${sent ? "" : '<input id="email" type="email" placeholder="you@business.com" autocomplete="email"><button class="btn" id="go">Send sign-in link</button>'}
    <p style="margin-top:18px;font-size:12.5px"><a href="privacy.html" style="color:var(--dim)">Privacy</a> &middot; <a href="support.html" style="color:var(--dim)">Support</a></p></div>`;
  if (sent) return;
  const go = async () => {
    const email = $("email").value.trim(); if (!email) return;
    const { error } = await supa.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0].split("?")[0] } });
    if (error) toast(error.message, "err"); else loginView(true);
  };
  $("go").onclick = go;
  $("email").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

function setupView() {
  root.innerHTML = `<div class="login"><div class="mark">L</div><h2>Welcome to Ledger AI</h2>
    <p>Let's set up your business. Your 14-day free trial starts now — no card needed.</p>
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
  root.innerHTML = `<div class="login" style="max-width:440px"><div class="mark">L</div><h2>Tell Ledger about ${esc(bizName)}</h2>
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
  root.innerHTML = `<div class="login"><div class="mark">L</div><h2>You're invited ✨</h2>
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
    await loadProfile(b);
    appView();
  } catch { appView(); }
}
boot();
supa.auth.onAuthStateChange((event, s) => {
  if (event === "SIGNED_IN" && s && !$("view") && !$("bizname") && !$("joincode")) boot();
});
