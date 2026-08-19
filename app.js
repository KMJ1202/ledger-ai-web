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
  if (!r.ok) throw new Error(d.message || d.error || ("Request failed (" + r.status + ")"));
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
  wrap.innerHTML = `<div class="sheet-back"></div><div class="sheet"><div class="grab"></div>${html}
    <button class="sheet-close">Close</button></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector(".sheet-back").onclick = closeSheet;
  wrap.querySelector(".sheet-close").onclick = closeSheet;
  if (wire) wire(wrap.querySelector(".sheet"));
  return wrap;
}
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
};
const TABS = [
  { key: "home", icon: ICONS.ledger, label: "Ledger" },
  { key: "finance", icon: ICONS.finance, label: "Finance" },
  { key: "calendar", icon: ICONS.calendar, label: "Calendar" },
  { key: "receipts", icon: ICONS.receipts, label: "Receipts" },
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
    <button class="avatar" id="more" title="Your business">&#9679;</button>
  </header>
  <div id="banner">💡 Advisor Mode — business guidance beyond your books, on your AI allowance</div>
  <div id="alertbar"></div>
  <main id="view"></main>
  <button class="fab" id="fab" title="Ask Ledger">&#9679;</button>
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
  $("fab").onclick = () => openChat();
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
    if (key === "home" || key === "finance" || key === "customers") S.qbo = null;
    if (key === "calendar") S.cal = null;
    if (key === "finance") S.profit = null;
    if (key === "receipts") S.receipts = null;
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
  if (S.tab === "receipts") return renderReceipts();
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
  $("askcam").onclick = () => setTab("receipts");
  on("[data-ask]", "click", (e) => { openChat(); $("box").value = e.currentTarget.dataset.ask; send(); });
  loadHomeKpis();
  loadHomeMail();
  loadHomeNext();
  loadHomeAttention();
}

async function loadHomeKpis() {
  const slot = $("homekpis"); if (!slot) return;
  try {
    if (!S.qbo) S.qbo = await get("/quickbooks-data");
    const k = S.qbo?.qbo?.kpis || {};
    slot.innerHTML = `<div class="eyebrow" style="margin-bottom:-3px">LIVE BOOKS</div><div class="kpis">
      <div class="kpi cyan"><small>Today's sales</small><b>${money0(k.today_sales)}</b></div>
      <div class="kpi em"><small>This month</small><b>${money0(k.month_sales)}</b></div>
      <div class="kpi gold"><small>Outstanding</small><b>${money0(k.outstanding)}</b><i>${k.open_count ?? 0} open invoice${(k.open_count ?? 0) === 1 ? "" : "s"}</i></div>
      <div class="kpi purple"><small>Year to date</small><b>${money0(k.ytd_sales)}</b></div>
    </div>`;
  } catch (e) {
    slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo")
      : `<div class="panel"><p class="sub">Couldn't reach QuickBooks: ${esc(e.message)}</p></div>`;
    wireConnect(slot);
  }
}

// Mirrors the iOS "LEDGER'S NEXT MOVE" card: one prioritised suggestion driven by open AR.
async function loadHomeNext() {
  const slot = $("homenext"); if (!slot) return;
  try {
    if (!S.qbo) S.qbo = await get("/quickbooks-data");
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

// Mirrors the iOS "NEEDS ATTENTION" queue: profit exceptions, receipt review, schedule.
async function loadHomeAttention() {
  const slot = $("homeattn"); if (!slot) return;
  const k = S.qbo?.qbo?.kpis || {};
  const costs = Number(k.missing_cost_count) || 0;
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
  slot.innerHTML = `<div class="attn"><div class="eyebrow">Needs attention</div>
    ${row("orange", "finance", "&#128269;", "Profit exceptions", `${costs} cost${costs === 1 ? "" : "s"} require verification`)}
    ${row("cyan", "receipts", "&#128247;", "Receipt review", `${receipts} receipt draft${receipts === 1 ? "" : "s"} waiting`)}
    ${row("purple", "calendar", "&#128197;", "Schedule", `${appts} upcoming appointment${appts === 1 ? "" : "s"}`)}
  </div>`;
  on("[data-attn]", "click", (e) => setTab(e.currentTarget.dataset.attn), slot);
}

async function loadHomeMail() {
  const slot = $("homemail"); if (!slot) return;
  try {
    const d = await get("/gmail/inbox?limit=10");
    S.emails = d.emails || [];
    if (!S.emails.length) { slot.innerHTML = ""; return; }
    slot.innerHTML = `<div class="maillane">
      <div class="mhead"><b>Latest Emails</b><button id="mailrefresh" title="Refresh">&#8635;</button></div>
      ${S.emails.map((m, i) => `
      <button class="mailrow" data-mail="${i}">
        <span class="dot ${m.unread ? "" : "read"}"></span>
        <span class="m"><b>${esc(m.from_name || m.from || "(unknown sender)")}</b>
          <span>${esc(m.subject || "(no subject)")}</span></span>
        <span class="chev">&#8250;</span>
      </button>`).join("")}</div>`;
    on("[data-mail]", "click", (e) => emailSheet(S.emails[Number(e.currentTarget.dataset.mail)]), slot);
    slot.querySelector("#mailrefresh").onclick = (e) => { e.stopPropagation(); loadHomeMail(); };
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
async function renderFinance() {
  const profit = S.financeLane === "profit";
  view().innerHTML = `<div class="sect">
    ${osHead(profit ? "FIN.02 · PROFIT & LOSS" : "FIN.02 · REVENUE GRID", profit ? "Profit" : "Finance")}
    <div class="seg">
      <button class="${profit ? "" : "on"}" data-fl="invoices">Invoices</button>
      <button class="${profit ? "on" : ""}" data-fl="profit">Profit &amp; Loss</button>
    </div>
    <div id="finbody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  on("[data-fl]", "click", (e) => { S.financeLane = e.currentTarget.dataset.fl; renderFinance(); });
  if (S.financeLane === "profit") loadProfit(); else loadInvoices();
}

async function loadInvoices() {
  const slot = $("finbody"); if (!slot) return;
  try {
    if (!S.qbo) S.qbo = await get("/quickbooks-data");
    const all = S.qbo?.qbo?.invoices || [];
    const k = S.qbo?.qbo?.kpis || {};
    const filtered = all.filter((i) => S.invoiceFilter === "all" || i.status === S.invoiceFilter)
      .filter((i) => !S.invoiceSearch || (i.customer + " " + i.doc + " " + (i.email || "")).toLowerCase().includes(S.invoiceSearch));
    // iOS searches customers alongside invoices and lists the matches above them.
    const custHits = !S.invoiceSearch ? [] : (S.qbo?.qbo?.customers || []).filter((c) =>
      (c.name + " " + (c.email || "") + " " + (c.phone || "") + " " + c.id).toLowerCase().includes(S.invoiceSearch)).slice(0, 20);
    slot.innerHTML = `
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
      if (op === "profit") { S.financeLane = "profit"; renderFinance(); } else setTab("receipts");
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
  } catch (e) {
    slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(slot);
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
    const key = t.toISOString().slice(0, 10);
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
    if (!S.qbo) S.qbo = await get("/quickbooks-data");
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
      ${d.customer_email ? `<label class="emailrow"><input type="checkbox" id="cmpem" checked> Email to ${esc(d.customer_email)}</label>` : ""}
      <label class="emailrow"><input type="checkbox" id="cmppr" ${localStorage.getItem("ledger.printAfterPosting") === "1" ? "checked" : ""}> Print after posting</label>
      <div class="row"><button class="btn cancel" id="cmpcancel">Cancel</button><button class="btn confirm" id="cmpconfirm">Confirm</button></div>
      <div class="note" id="cmpnote" style="margin-top:9px"></div></div>`;
    const note = body().querySelector("#cmpnote");
    body().querySelector("#cmppr").onchange = (e) => localStorage.setItem("ledger.printAfterPosting", e.target.checked ? "1" : "0");
    body().querySelector("#cmpconfirm").onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      const sendEmail = body().querySelector("#cmpem")?.checked ?? false;
      const wantPrint = body().querySelector("#cmppr")?.checked ?? false;
      try {
        const r = await api("/quickbooks-invoice/confirm", { draft_id: d.draft_id, send_email: sendEmail });
        note.className = "note ok";
        note.textContent = "✅ Posted" + (r.doc_number ? " — #" + r.doc_number : "") + (r.emailed ? " · emailed " + (r.emailed_to || "") : "");
        body().querySelector(".row").remove();
        if (wantPrint && (r.qbo_invoice_id || r.id)) printPdfById(r.qbo_invoice_id || r.id, r.doc_number, "invoice");
        S.qbo = null;
        setTimeout(() => { closeSheet(); loadInvoices(); }, 1400);
      } catch (e) { ev.currentTarget.disabled = false; note.className = "note err"; note.textContent = e.message; }
    };
    body().querySelector("#cmpcancel").onclick = async (ev) => {
      ev.currentTarget.disabled = true;
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
  try {
    if (!S.profit) S.profit = (await get("/profit/board")).board || {};
    if (!S.receipts) { try { S.receipts = (await get("/gmail/receipts")).receipts || []; } catch { S.receipts = []; } }
    drawProfit();
  } catch (e) {
    slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(slot);
  }
}

function drawProfit() {
  const slot = $("finbody"); if (!slot) return;
  const p = S.profit || {};
  const series = (p[S.profitRange] || []).slice(-14);
  const today = p.today || {};
  const unposted = (S.receipts || []).filter((r) => !r.qbo_purchase_id && r.category !== "Personal").length;
  const max = Math.max(1, ...series.map((s) => Math.abs(s.net_profit || 0)));
  const income = today.total_income || 0, costs = today.total_expenses || 0;
  const margin = income > 0 ? Math.round((today.net_profit || 0) / income * 100) : 0;
  const total = series.reduce((t, x) => t + (x.net_profit || 0), 0);
  const best = series.reduce((b, x) => (!b || (x.net_profit || 0) > (b.net_profit || 0) ? x : b), null);
  slot.innerHTML = `
    <div class="hero">
      <div class="headline"><span class="eyebrow">Today's profit</span>
        <span class="when">${esc(today.date || new Date().toISOString().slice(0, 10))}</span></div>
      <div class="big" style="color:${(today.net_profit || 0) >= 0 ? "var(--emerald)" : "var(--red)"}">${money(today.net_profit)}</div>
      <div class="trio">
        <div><small>Income</small><b style="color:var(--cyan)">${money0(income)}</b></div>
        <div><small>Expenses</small><b style="color:var(--orange)">${money0(costs)}</b></div>
        <div><small>Margin</small><b style="color:var(--magenta)">${margin}%</b></div>
      </div>
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
    <div class="panel">
      <div style="display:flex;align-items:center;gap:9px">
        <span class="eyebrow" style="color:var(--emerald)">Daily sweep</span>
        <span class="note" style="margin-left:auto;font-family:var(--mono);font-size:10.5px;letter-spacing:1.1px">DAILY AT ${String(p.sweep_hour ?? 18).padStart(2, "0")}:30</span>
      </div>
      <p class="sub" style="margin-top:9px">Receipts and invoices land all day — the evening sweep pulls the day's Profit &amp; Loss from QuickBooks and locks it into the chart.</p>
      <p class="note" style="margin-top:8px">${p.last_sweep_at ? "Last sweep " + esc(new Date(p.last_sweep_at).toLocaleString()) : "Never swept"} · ${p.snapshot_count || 0} days on file</p>
      <button class="btn em wide" style="margin-top:13px" id="sweep">&#8635;&nbsp; Run sweep now</button>
    </div>`;
  on("[data-pr]", "click", (e) => { S.profitRange = e.currentTarget.dataset.pr; drawProfit(); }, slot);
  $("sweep").onclick = async (e) => {
    e.currentTarget.disabled = true; e.currentTarget.textContent = "Sweeping…";
    try { S.profit = (await api("/profit/sweep", {})).board || {}; drawProfit(); toast("Profit board updated"); }
    catch (err) { toast(err.message, "err"); drawProfit(); }
  };
}

/* ---------------- CALENDAR ---------------- */
// CALENDAR — mirrors iOS AppointmentCommandView: day search, three schedule stats,
// a Next Up card, a real month booking grid, a Book button, and the selected DAY SCHEDULE.
const CAL = { sel: null, month: null, q: "" };
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const evDayKey = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : dayKey(d); };

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
    <p class="note" style="margin-top:9px">The calendar is checked live for conflicts and booking hours before anything is created.</p>
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

async function renderReceipts() {
  skeleton(4);
  try {
    const d = await get("/gmail/receipts");
    S.receipts = d.receipts || [];
    const ready = S.receipts.filter((r) => !r.qbo_purchase_id && r.category && r.category !== "Personal" && r.total);
    const queueTotal = ready.reduce((t, r) => t + (Number(r.total) || 0), 0);
    const rq = (S.receiptSearch || "").toLowerCase();
    const shown = !rq ? S.receipts : S.receipts.filter((r) =>
      ((r.vendor || "") + " " + (r.category || "") + " " + (r.received_at || "") + " " + (r.subject || "") + " " + (r.summary || ""))
        .toLowerCase().includes(rq));
    view().innerHTML = `<div class="sect">
      ${osHead("EXP.04 · EXPENSE INTAKE", "Receipts")}
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
        : `<div class="empty">${rq ? "No receipts match that search." : "No receipts found yet.<br>Run a scan, or forward one to your inbox."}</div>`}
    </div>`;
    $("rcptshoot").onclick = () => $("rcptcam").click();
    $("rcptpick").onclick = () => $("rcptlib").click();
    $("rcptcam").onchange = (e) => captureReceipt(e.target.files?.[0]);
    $("rcptlib").onchange = (e) => captureReceipt(e.target.files?.[0]);
    $("scannow").onclick = async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = "Scanning…";
      try { await api("/gmail/scan", {}); toast("Scan complete"); renderReceipts(); }
      catch (err) { toast(err.message, "err"); renderReceipts(); }
    };
    if ($("batch")) $("batch").onclick = () => batchPost(ready);
    $("batchqueue").onclick = () => batchQueueSheet(ready, queueTotal);
    $("scanhour").onchange = async (e) => {
      const hour = Number(e.target.value);
      try { await api("/gmail/set-schedule", { hour }); toast("Daily scan set to " + hourLabel(hour)); }
      catch (err) { toast(err.message, "err"); renderReceipts(); }
    };
    const rs = $("rcptsearch");
    rs.addEventListener("input", () => {
      S.receiptSearch = rs.value.trim();
      clearTimeout(S._rt); S._rt = setTimeout(() => {
        renderReceipts().then(() => { const n = $("rcptsearch"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
      }, 220);
    });
    on("[data-rcpt]", "click", (e) => receiptSheet(S.receipts.find((r) => r.id === e.currentTarget.dataset.rcpt)));
  } catch (e) {
    view().innerHTML = /not connected|Gmail/i.test(e.message) ? connectPanel("gmail") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(view());
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

async function batchPost(ready) {
  const b = $("batch"); b.disabled = true; b.textContent = "Posting…";
  let posted = 0, skipped = 0;
  for (const r of ready) {
    try {
      const v = await api("/quickbooks-invoice/expense-vendors", { receipt_id: r.id });
      if (!v.suggestedId) { skipped++; continue; }
      await api("/quickbooks-invoice/expense-post", { receipt_id: r.id, vendor_id: v.suggestedId });
      posted++;
    } catch { skipped++; }
  }
  toast(`${posted} posted${skipped ? ", " + skipped + " left for you" : ""}`);
  renderReceipts();
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
    await renderReceipts();
    // renderReceipts rebuilds the panel, so the in-flight note is gone by now —
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
        style="width:100%;border-radius:14px;margin-top:10px;display:block">`);
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
      try { await save(); closeSheet(); toast("Receipt updated"); renderReceipts(); }
      catch (err) { e.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
    };
    sh.querySelector("#rdismiss").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await api("/gmail/dismiss", { id: r.id }); closeSheet(); renderReceipts(); }
      catch (err) { e.currentTarget.disabled = false; note.className = "note err"; note.textContent = err.message; }
    };
    const post = sh.querySelector("#rpost");
    if (post) post.onclick = async () => {
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
            closeSheet(); toast("Posted to QuickBooks"); renderReceipts();
          } catch (err) { e2.currentTarget.disabled = false; toast(err.message, "err"); }
        };
      } catch (err) { post.disabled = false; note.className = "note err"; note.textContent = err.message; }
    };
  });
}

/* ---------------- CUSTOMERS · LEADS · TO-DO ---------------- */
const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost"];
const LEAD_SOURCES = [["call-in", "Call-in"], ["walk-in", "Walk-in"], ["referral", "Referral"],
  ["website", "Website"], ["social", "Social"], ["repeat", "Repeat"], ["other", "Other"]];
const TODO_PRIORITIES = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];

const LANE_CODE = { directory: "CRM.05 · RELATIONSHIPS", leads: "CRM.05 · PIPELINE", todos: "CRM.05 · MISSION CONTROL" };

// Red badge counts on the lane switcher, same rule as iOS CustomerLaneSwitcher:
// leads whose follow-up is due, and open to-dos due by end of today.
function laneAlerts() {
  const b = S.board || {};
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const leads = (b.leads || []).filter((l) =>
    l.status !== "won" && l.status !== "lost" && l.followUpAt && new Date(l.followUpAt) <= now).length;
  const todos = (b.todos || []).filter((t) =>
    t.status === "open" && t.dueAt && new Date(t.dueAt) <= endOfToday).length;
  return { leads, todos };
}

async function renderCustomers() {
  view().innerHTML = `<div class="sect">
    ${osHead(LANE_CODE[S.lane] || LANE_CODE.directory, S.lane === "todos" ? "To-Do" : S.lane === "leads" ? "Leads" : "Customers")}
    <div class="seg">
      ${[["directory", "Directory", 0], ["leads", "Leads", laneAlerts().leads], ["todos", "To-Do", laneAlerts().todos]].map(([k, l, n]) =>
        `<button class="${S.lane === k ? "on" : ""}" data-lane="${k}">${l}${n ? `<i class="badge">${n}</i>` : ""}</button>`).join("")}
    </div>
    <div id="lanebody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  on("[data-lane]", "click", (e) => { S.lane = e.currentTarget.dataset.lane; renderCustomers(); });
  if (S.lane === "directory") {
    loadDirectory();
    // iOS keeps the badges live from the same board; fetch it once so Directory shows them too.
    if (!S.board) api("/leads", { action: "board" }).then((b) => { S.board = b; if (S.tab === "customers") renderCustomers(); }).catch(() => {});
  } else loadBoard();
}

const reviewAsked = () => new Set((localStorage.getItem("kmj.reviewRequestedCustomerIDs") || "").split(",").filter(Boolean));
const markReviewAsked = (id) => { const s = reviewAsked(); s.add(id); localStorage.setItem("kmj.reviewRequestedCustomerIDs", [...s].sort().join(",")); };

async function loadDirectory() {
  const slot = $("lanebody"); if (!slot) return;
  try {
    if (!S.qbo) S.qbo = await get("/quickbooks-data");
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
    const todayISO = new Date().toISOString().slice(0, 10);
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
          S.qbo = null;
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
          dup.innerHTML = `<div class="note err" style="margin-top:10px">${esc(e.message)}</div>
            <button class="btn ghost wide" style="margin-top:8px" id="ncForce">Create anyway</button>`;
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
  const today = new Date().toISOString().slice(0, 10);
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
    S.lane === "leads" ? drawLeads() : drawTodos();
  } catch (e) { slot.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function drawLeads() {
  const slot = $("lanebody"); if (!slot) return;
  const leads = S.board?.leads || [];
  const openLeads = leads.filter((l) => l.status !== "won" && l.status !== "lost");
  const value = openLeads.reduce((t, l) => t + (l.valueEstimate || 0), 0);
  const due = openLeads.filter((l) => l.followUpAt && new Date(l.followUpAt) <= new Date());
  slot.innerHTML = `
    <div class="hero"><div class="eyebrow">PIPELINE</div>
      <div class="big">${money0(value)}</div>
      <div class="note" style="margin-top:4px">${openLeads.length} open lead${openLeads.length === 1 ? "" : "s"}${due.length ? ` · <span style="color:var(--red)">${due.length} follow-up due</span>` : ""}</div></div>
    <button class="btn primary wide" id="addlead">+ New lead</button>
    ${leads.length ? `<div class="list">${leads.map((l) => `
      <button class="item" data-lead="${esc(l.id)}">
        <div class="main"><div class="ttl">${esc(l.name)}${l.company ? " · " + esc(l.company) : ""}</div>
          <div class="sub">${esc(l.phone || l.email || l.source || "")}${l.followUpAt ? " · follow up " + esc(dayLabel(l.followUpAt)) : ""}</div></div>
        <div class="amt">${l.valueEstimate ? money0(l.valueEstimate) : ""}
          <small><span class="tag ${l.status === "won" ? "paid" : l.status === "lost" ? "grey" : l.followUpAt && new Date(l.followUpAt) <= new Date() ? "due" : "new"}">${esc(l.status)}</span></small></div>
      </button>`).join("")}</div>` : `<div class="empty">No leads yet.<br>Snap a photo of your call list and ask Ledger to add them.</div>`}`;
  $("addlead").onclick = () => leadSheet({});
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
function openChat() { $("chatwrap").classList.add("open"); setTimeout(() => $("box").focus(), 60); }
function closeChat() { $("chatwrap").classList.remove("open"); }
function newConversation() {
  S.conversationId = null; localStorage.removeItem("ledger.conv");
  chatEl().innerHTML = ""; sys("Fresh conversation started.");
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

async function send() {
  const box = $("box"); const text = box.value.trim(); if (!text) return;
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
    (d.print_jobs || []).forEach(printJobCard);
    S.qbo = null; S.board = null; // books may have moved — refetch on next tab visit
  } catch (e) {
    t.remove(); bubble("msg ai", esc(e.message));
    if (/allowance|power-up/i.test(e.message)) powerUpSheet();
  }
  $("send").disabled = false;
}

function cardDone(card, msg) {
  const row = card.querySelector(".row"); if (row) row.remove();
  const s = document.createElement("div"); s.className = "emailrow"; s.textContent = msg;
  card.appendChild(s); scrollChat();
}

function draftCard(d, label, confirmPath, cancelPath) {
  const lines = (d.lines || []).map((l) => `<tr><td>${esc(l.description || l.item_name)} × ${l.quantity}</td><td>${money(l.amount)}</td></tr>`).join("");
  const card = bubble("card", `<h3>${label}</h3><div class="cust">${esc(d.customer)}</div>
    <table>${lines}<tr><td class="total">Subtotal</td><td class="total">${money(d.subtotal)}</td></tr></table>
    ${d.customer_email ? `<label class="emailrow"><input type="checkbox" class="em" checked> Email to ${esc(d.customer_email)}</label>` : ""}
    <label class="emailrow"><input type="checkbox" class="pr" ${localStorage.getItem("ledger.printAfterPosting") === "1" ? "checked" : ""}> Print after posting</label>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Confirm</button></div>`);
  card.querySelector(".pr").onchange = (e) => localStorage.setItem("ledger.printAfterPosting", e.target.checked ? "1" : "0");
  card.querySelector(".confirm").onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const sendEmail = card.querySelector(".em")?.checked ?? false;
      const wantPrint = card.querySelector(".pr")?.checked ?? false;
      const r = await api(confirmPath, { draft_id: d.draft_id, send_email: sendEmail });
      cardDone(card, "✅ Posted" + (r.doc_number ? " — #" + r.doc_number : "") + (r.emailed ? " · emailed " + (r.emailed_to || "") : ""));
      if (wantPrint && (r.qbo_invoice_id || r.id)) {
        printPdfById(r.qbo_invoice_id || r.id, r.doc_number, label.startsWith("ESTIMATE") ? "estimate" : "invoice");
      }
    } catch (e) { ev.target.disabled = false; toast(e.message, "err"); }
  };
  card.querySelector(".cancel").onclick = async (ev) => {
    ev.target.disabled = true;
    try { await api(cancelPath, { draft_id: d.draft_id }); cardDone(card, "Draft cancelled"); }
    catch (e) { ev.target.disabled = false; toast(e.message, "err"); }
  };
}

function reminderCard(d) {
  const rows = (d.invoices || []).map((i) => `<tr><td>#${esc(i.doc_number)} · due ${esc(i.due_date)}</td><td>${money(i.balance)}</td></tr>`).join("");
  const card = bubble("card", `<h3>PAYMENT REMINDER</h3><div class="cust">${esc(d.customer)}</div>
    <table>${rows}<tr><td class="total">Total due</td><td class="total">${money(d.total_due)}</td></tr></table>
    <div class="emailrow">QuickBooks will email these invoices with a pay link to ${esc(d.customer_email)}</div>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Send reminder</button></div>`);
  card.querySelector(".confirm").onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const r = await api("/quickbooks-invoice/reminder-confirm", { draft_id: d.draft_id });
      cardDone(card, "✅ Reminder emailed to " + (r.emailed_to || d.customer_email) + ((r.failed || []).length ? " · couldn't send: " + r.failed.join(", ") : ""));
    } catch (e) { ev.target.disabled = false; toast(e.message, "err"); }
  };
  card.querySelector(".cancel").onclick = async (ev) => {
    ev.target.disabled = true;
    try { await api("/quickbooks-invoice/reminder-cancel", { draft_id: d.draft_id }); cardDone(card, "Cancelled — nothing was sent"); }
    catch (e) { ev.target.disabled = false; toast(e.message, "err"); }
  };
}

function bookingCard(d) {
  const card = bubble("card", `<h3>BOOKING DRAFT</h3><div class="cust">${esc(d.title)}</div>
    <table><tr><td>Starts</td><td>${esc(new Date(d.start).toLocaleString())}</td></tr>
    <tr><td>Ends</td><td>${esc(new Date(d.end).toLocaleString())}</td></tr>
    ${d.location ? `<tr><td>Where</td><td>${esc(d.location)}</td></tr>` : ""}</table>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Book it</button></div>`);
  card.querySelector(".confirm").onclick = async (ev) => {
    ev.target.disabled = true;
    try { await api("/google-calendar/booking-confirm", { draft_id: d.draft_id }); cardDone(card, "✅ Booked"); S.cal = null; }
    catch (e) { ev.target.disabled = false; toast(e.message, "err"); }
  };
  card.querySelector(".cancel").onclick = async (ev) => {
    ev.target.disabled = true;
    try { await api("/google-calendar/booking-cancel", { draft_id: d.draft_id }); cardDone(card, "Draft cancelled"); }
    catch (e) { ev.target.disabled = false; toast(e.message, "err"); }
  };
}

function emailDraftCard(d) {
  const card = bubble("card", `<h3>EMAIL DRAFT</h3><div class="cust">${esc(d.to)}</div>
    <table><tr><td>Subject</td><td>${esc(d.subject)}</td></tr></table>
    <div class="emailrow" style="display:block;white-space:pre-wrap;color:var(--text);max-height:190px;overflow:auto">${esc(d.body)}</div>
    <div class="row"><button class="btn cancel">Cancel</button><button class="btn confirm">Send</button></div>`);
  card.querySelector(".confirm").onclick = async (ev) => {
    ev.target.disabled = true;
    try { const r = await api("/gmail/email-send", { draft_id: d.draft_id }); cardDone(card, "✅ Sent to " + (r.to || d.to)); }
    catch (e) { ev.target.disabled = false; toast(e.message, "err"); }
  };
  card.querySelector(".cancel").onclick = async (ev) => {
    ev.target.disabled = true;
    try { await api("/gmail/email-cancel", { draft_id: d.draft_id }); cardDone(card, "Draft cancelled — nothing was sent"); }
    catch (e) { ev.target.disabled = false; toast(e.message, "err"); }
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

    <div class="eyebrow" style="margin-top:20px">TEAM</div>
    <div id="teamslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">APP</div>
    <div class="rowbtns" style="margin-top:8px;flex-direction:column">
      ${S.installPrompt ? `<button class="btn primary wide" id="install">📲 Install Ledger AI</button>` : ""}
      <button class="btn ghost wide" id="bnew">Start a fresh conversation</button>
      <button class="btn ghost wide" id="bbill">Manage subscription</button>
      <button class="btn ghost wide" id="bsupport">Contact support</button>
      <button class="btn ghost wide" id="bout" style="color:var(--red)">Sign out</button>
    </div>
    <p class="note" style="margin-top:12px;text-align:center">
      <a href="${FN}/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a> ·
      <a href="${FN}/legal/terms" target="_blank" rel="noopener">Terms of Service</a></p>`, async (sh) => {
    wireConnect(sh);
    sh.querySelector("#bsupport").onclick = supportSheet;
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
    sh.querySelector("#bpu").onclick = powerUpSheet;
    sh.querySelector("#bnew").onclick = () => { newConversation(); closeSheet(); openChat(); };
    sh.querySelector("#bbill").onclick = async () => {
      try { const d = await api("/stripe-billing/portal", {}); location.href = d.url; }
      catch (e) { toast(e.message, "err"); }
    };
    sh.querySelector("#bout").onclick = () => supa.auth.signOut().then(() => location.reload());
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

/* ---------------- AUTH / SETUP / JOIN ---------------- */
function loginView(sent) {
  root.innerHTML = `<div class="login"><div class="mark">L</div><h2>Ledger AI</h2>
    <p>${sent ? "Check your email — tap the sign-in link and you'll land right back here." : "Your business copilot. Sign in with your work email."}</p>
    ${sent ? "" : '<input id="email" type="email" placeholder="you@business.com" autocomplete="email"><button class="btn" id="go">Send sign-in link</button>'}</div>`;
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
      appView();
      openChat();
      sys("🎉 " + name + " is set up — your 14-day free trial is live. Ask me anything, and connect QuickBooks to bring your books in.");
    } catch (e) { toast(e.message, "err"); }
  };
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
