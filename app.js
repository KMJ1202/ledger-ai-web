// Ledger AI — web/PWA client.
// One file, no build step: GitHub Pages serves it straight. Every screen talks to the
// same Supabase edge functions the iOS app uses, so there is no second backend to keep in sync.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = "https://lbzkyyehmgudlxmfpzzh.supabase.co";
const supa = createClient(SUPA_URL, "sb_publishable_I0BQ5Rkc2GCxKOlobtzCNg_GxAtNuPu");
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
  { icon: "&#128196;", label: "Create an invoice" },
  { icon: "&#128200;", label: "Sales this week" },
  { icon: "&#128221;", label: "Create an estimate" },
  { icon: "&#128202;", label: "Last month & YOY" },
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
          `<button class="askchip c${i}" data-ask="${esc(c.label)}"><em>${c.icon}</em>${esc(c.label)}</button>`).join("")}</div>
      </div>

      <div id="homekpis"><div class="skel"></div></div>
      <div id="homemail"></div>
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
      .filter((i) => !S.invoiceSearch || (i.customer + " " + i.doc).toLowerCase().includes(S.invoiceSearch));
    slot.innerHTML = `
      ${salesIntel(all, k)}
      <button class="cta" id="newinv">
        <span class="ic">&#43;</span>
        <span><b>Create Invoice</b><span>Draft, review, post to QuickBooks</span></span>
      </button>
      <div class="searchwrap"><span class="mag">${MAG}</span>
        <input id="invsearch" placeholder="Search customer or invoice #" value="${esc(S.invoiceSearch || "")}"></div>
      <div class="chips">
        ${[["all", "All"], ["open", "Open"], ["paid", "Paid"]].map(([k2, l]) =>
          `<button class="chip ${S.invoiceFilter === k2 ? "on" : ""}" data-if="${k2}">${l}</button>`).join("")}
      </div>
      ${filtered.length ? `<div class="list">${filtered.slice(0, 120).map((i, idx) => `
        <button class="item" data-inv="${esc(i.id)}">
          <div class="main">
            <div class="ttl">${esc(i.customer || "—")}</div>
            <div class="sub">#${esc(i.doc)} · ${esc(dateShort(i.date))}</div>
          </div>
          <div class="amt">${money(i.total)}
            <small><span class="tag ${i.status}">${i.status}</span></small></div>
        </button>`).join("")}</div>`
        : `<div class="empty">No invoices match.</div>`}`;
    $("newinv").onclick = () => { openChat(); $("box").value = "Create an invoice"; send(); };
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
      <div class="kpi cyan"><small>Avg sale</small><b>${money(avg)}</b><i>${month.length} invoice${month.length === 1 ? "" : "s"} this month</i></div>
      <div class="kpi orange"><small>Forecast</small><b>${money(forecast)}</b><i>month-end run rate</i></div>
      <div class="kpi gold"><small>Outstanding</small><b>${money0(k.outstanding)}</b><i>${k.open_count ?? 0} open</i></div>
      <div class="kpi purple"><small>Next invoice #</small><b>${esc(k.next_invoice ?? "—")}</b></div>
    </div>
    <p class="infoline"><em>&#9432;</em>Run rate projects this month's pace across the full month — it is not a promise.</p>
  </div>`;
}

function invoiceSheet(inv) {
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
    <div class="note" id="pdfnote" style="margin-top:9px"></div>`, (sh) => {
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
async function renderCalendar() {
  skeleton(4);
  try {
    if (!S.cal) S.cal = await get("/google-calendar/events");
    const up = S.cal?.calendar?.upcoming || [];
    const past = (S.cal?.calendar?.past || []).slice(0, 20);
    const groups = [];
    up.forEach((e) => {
      const key = dayLabel(e.start);
      const g = groups.find((x) => x.key === key);
      (g ? g.items : (groups.push({ key, items: [] }), groups[groups.length - 1].items)).push(e);
    });
    const now = new Date();
    const sameDay = (iso) => (iso || "").slice(0, 10) === now.toISOString().slice(0, 10);
    const within = (iso, days) => {
      const t = new Date(iso); const end = new Date(now); end.setDate(now.getDate() + days);
      return t >= now && t <= end;
    };
    const todayCount = up.filter((e) => sameDay(e.start)).length;
    const weekCount = up.filter((e) => within(e.start, 7)).length;
    const monthCount = up.filter((e) => (e.start || "").slice(0, 7) === now.toISOString().slice(0, 7)).length;
    const next = up[0];
    const mins = next ? Math.round((new Date(next.start) - now) / 60000) : 0;
    const soon = mins <= 0 ? "now" : mins < 60 ? `in ${mins} min` : mins < 1440 ? `in ${Math.round(mins / 60)} h` : dayLabel(next.start);
    view().innerHTML = `<div class="sect">
      ${osHead("CAL.03 · SCHEDULE", "Calendar")}
      <div class="calstats">
        <div class="calstat"><i style="background:var(--cyan);box-shadow:0 0 8px var(--cyan)"></i><b>${todayCount}</b><small>Today</small></div>
        <div class="calstat"><i style="background:var(--emerald);box-shadow:0 0 8px var(--emerald)"></i><b>${weekCount}</b><small>This week</small></div>
        <div class="calstat"><i style="background:var(--magenta);box-shadow:0 0 8px var(--magenta)"></i><b>${monthCount}</b><small>This month</small></div>
      </div>
      ${next ? `<div class="nextup">
        <div class="ic">&#9203;</div>
        <div class="m"><small>&#9679; Next up · ${esc(soon)}</small><b>${esc(next.title)}</b>
          <span>${esc(timeLabel(next.start))}${next.location ? " · " + esc(next.location) : ""}</span></div>
        <div class="go">&#8594;</div>
      </div>` : ""}
      ${groups.length ? groups.map((g) => `<div><div class="eyebrow">${esc(g.key.toUpperCase())}</div>
        <div class="list" style="margin-top:8px">${g.items.map((e) => `<div class="item" style="cursor:default">
          <div class="main"><div class="ttl">${esc(e.title)}</div>
            <div class="sub">${esc(timeLabel(e.start))}${e.location ? " · " + esc(e.location) : ""}</div></div>
        </div>`).join("")}</div></div>`).join("")
        : `<div class="empty">Nothing booked ahead.<br>Ask Ledger to book something.</div>`}
      ${past.length ? `<div><div class="eyebrow">RECENTLY DONE</div>
        <div class="list" style="margin-top:8px">${past.map((e) => `<div class="item" style="cursor:default;opacity:.65">
          <div class="main"><div class="ttl">${esc(e.title)}</div>
          <div class="sub">${esc(dayLabel(e.start))} · ${esc(timeLabel(e.start))}</div></div></div>`).join("")}</div></div>` : ""}
    </div>`;
  } catch (e) {
    view().innerHTML = /not connected|Calendar/i.test(e.message) ? connectPanel("calendar") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(view());
  }
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
    view().innerHTML = `<div class="sect">
      ${osHead("EXP.04 · EXPENSE INTAKE", "Receipts")}
      <div class="queue">
        <div class="ic">&#128229;</div>
        <div class="m"><small>QuickBooks batch queue</small>
          <b>${ready.length} queued · ${money(queueTotal)}</b>
          <span>Categorised receipts waiting to post as expenses.</span></div>
        <div class="chev">&#8250;</div>
      </div>
      <div class="panel">
        <h3>&#128231; Email Receipt Radar</h3>
        <p class="sub">Ledger reads supplier receipts out of your inbox and turns them into expenses. Scans daily at ${d.scan_hour ?? 18}:00.</p>
        <div class="rowbtns" style="margin-top:12px">
          <button class="btn ghost" id="scannow">Scan now</button>
          ${ready.length >= 2 ? `<button class="btn em" id="batch">Post all ready (${ready.length})</button>` : ""}
        </div>
        <p class="note" style="margin-top:8px">${d.last_scan_at ? "Last scan " + esc(new Date(d.last_scan_at).toLocaleString()) : "Not scanned yet"}</p>
      </div>
      ${S.receipts.length ? `<div class="list">${S.receipts.map((r) => `
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
        : `<div class="empty">No receipts found yet.<br>Run a scan, or forward one to your inbox.</div>`}
    </div>`;
    $("scannow").onclick = async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = "Scanning…";
      try { await api("/gmail/scan", {}); toast("Scan complete"); renderReceipts(); }
      catch (err) { toast(err.message, "err"); renderReceipts(); }
    };
    if ($("batch")) $("batch").onclick = () => batchPost(ready);
    on("[data-rcpt]", "click", (e) => receiptSheet(S.receipts.find((r) => r.id === e.currentTarget.dataset.rcpt)));
  } catch (e) {
    view().innerHTML = /not connected|Gmail/i.test(e.message) ? connectPanel("gmail") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(view());
  }
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

function receiptSheet(r) {
  if (!r) return;
  const opts = Object.entries(CATEGORIES).map(([group, items]) =>
    `<optgroup label="${esc(group)}">${items.map((i) => `<option ${r.category === i ? "selected" : ""}>${esc(i)}</option>`).join("")}</optgroup>`).join("");
  sheet(`<h2>${esc(r.vendor || r.from_name || "Receipt")}</h2>
    <p class="sh-sub">${esc(r.subject || "")} · ${esc(dayLabel(r.received_at))}</p>
    ${r.summary ? `<p class="note">${esc(r.summary)}</p>` : ""}
    <label class="fld">AMOUNT</label>
    <input id="ramt" inputmode="decimal" value="${r.total ?? ""}" placeholder="0.00">
    <label class="fld">CATEGORY</label>
    <select id="rcat"><option value="">Choose a category…</option><option ${r.category === "Personal" ? "selected" : ""}>Personal</option>${opts}</select>
    <div class="rowbtns" style="margin-top:15px">
      <button class="btn ghost" id="rdismiss">Dismiss</button>
      <button class="btn primary" id="rsave">Save</button>
    </div>
    ${r.qbo_purchase_id ? `<p class="note ok" style="margin-top:10px">Already in QuickBooks.</p>`
      : `<button class="btn em wide" style="margin-top:9px" id="rpost">Post to QuickBooks</button>`}
    <div class="note" id="rnote" style="margin-top:9px"></div>`, (sh) => {
    const note = sh.querySelector("#rnote");
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

const LANE_CODE = { directory: "CRM.05 · RELATIONSHIPS", leads: "CRM.05 · PIPELINE", todos: "CRM.05 · MISSION CONTROL" };

async function renderCustomers() {
  view().innerHTML = `<div class="sect">
    ${osHead(LANE_CODE[S.lane] || LANE_CODE.directory, S.lane === "todos" ? "To-Do" : S.lane === "leads" ? "Leads" : "Customers")}
    <div class="seg">
      ${[["directory", "Directory"], ["leads", "Leads"], ["todos", "To-Do"]].map(([k, l]) =>
        `<button class="${S.lane === k ? "on" : ""}" data-lane="${k}">${l}</button>`).join("")}
    </div>
    <div id="lanebody"><div class="skel"></div><div class="skel"></div></div>
  </div>`;
  on("[data-lane]", "click", (e) => { S.lane = e.currentTarget.dataset.lane; renderCustomers(); });
  if (S.lane === "directory") loadDirectory();
  else loadBoard();
}

async function loadDirectory() {
  const slot = $("lanebody"); if (!slot) return;
  try {
    if (!S.qbo) S.qbo = await get("/quickbooks-data");
    const all = (S.qbo?.qbo?.customers || []).filter((c) => c.active !== false);
    const q = (S.custSearch || "").toLowerCase();
    const list = all.filter((c) => !q || (c.name + " " + (c.email || "") + " " + (c.phone || "")).toLowerCase().includes(q));
    slot.innerHTML = `<div class="searchwrap"><span class="mag">${MAG}</span>
        <input id="csearch" placeholder="Search customers" value="${esc(S.custSearch || "")}"></div>
      <p class="note">${all.length} customer${all.length === 1 ? "" : "s"}</p>
      ${list.length ? list.slice(0, 120).map((c) => {
        const contact = [c.email, c.phone].filter(Boolean).join(" · ");
        const initial = (c.name || "?").trim().charAt(0).toUpperCase();
        return `<div class="ccard">
          <div class="top">
            <div class="ava">${esc(initial)}</div>
            <div class="who"><b>${esc(c.name)}</b>
              ${contact ? `<span>${esc(contact)}</span>` : ""}
              <i>QBO #${esc(c.id)} · ${c.balance > 0 ? `<span style="color:var(--orange)">${money(c.balance)} owing</span>` : "Active"}</i></div>
          </div>
          <div class="acts">
            <button class="actbtn" data-cust="${esc(c.id)}">&#128100;&nbsp; Full Profile</button>
            <button class="actbtn p" data-review="${esc(c.id)}">&#11088;&nbsp; Ask for Review</button>
          </div>
        </div>`;
      }).join("") : `<div class="empty">No matches.</div>`}`;
    const s = $("csearch");
    s.addEventListener("input", () => { S.custSearch = s.value; clearTimeout(S._c); S._c = setTimeout(loadDirectory, 220); });
    on("[data-cust]", "click", (e) => customerSheet(all.find((c) => c.id === e.currentTarget.dataset.cust)), slot);
    on("[data-review]", "click", (e) => {
      const c = all.find((x) => x.id === e.currentTarget.dataset.review);
      openChat();
      $("box").value = `Draft a short, friendly review request email to ${c.name}${c.email ? " at " + c.email : ""}.`;
      send();
    }, slot);
  } catch (e) {
    slot.innerHTML = /not connected/i.test(e.message) ? connectPanel("qbo") : `<div class="empty">${esc(e.message)}</div>`;
    wireConnect(slot);
  }
}

function customerSheet(c) {
  if (!c) return;
  const invoices = (S.qbo?.qbo?.invoices || []).filter((i) => i.customer_id === c.id).slice(0, 8);
  sheet(`<h2>${esc(c.name)}</h2>
    <p class="sh-sub">${esc(c.company || "")}</p>
    ${c.phone ? `<div class="kv"><span>Phone</span><span><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></span></div>` : ""}
    ${c.email ? `<div class="kv"><span>Email</span><span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></span></div>` : ""}
    ${c.address ? `<div class="kv"><span>Address</span><span>${esc(c.address)}</span></div>` : ""}
    <div class="kv tot"><span>Balance</span><span style="${c.balance > 0 ? "color:var(--orange)" : ""}">${money(c.balance)}</span></div>
    ${invoices.length ? `<div class="eyebrow" style="margin-top:14px">RECENT INVOICES</div>
      <div class="list" style="margin-top:8px">${invoices.map((i) => `<div class="item" style="cursor:default">
        <div class="main"><div class="ttl">#${esc(i.doc)}</div><div class="sub">${esc(dateShort(i.date))}</div></div>
        <div class="amt">${money(i.total)}<small><span class="tag ${i.status}">${i.status}</span></small></div></div>`).join("")}</div>` : ""}
    <div class="rowbtns" style="margin-top:14px">
      <button class="btn ghost" id="cask">Ask Ledger</button>
      <button class="btn primary" id="cinv">New invoice</button>
    </div>`, (sh) => {
    sh.querySelector("#cask").onclick = () => { closeSheet(); openChat(); $("box").value = `Tell me about ${c.name} — what have they bought and do they owe anything?`; send(); };
    sh.querySelector("#cinv").onclick = () => { closeSheet(); openChat(); $("box").value = `Create an invoice for ${c.name}`; send(); };
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
    <label class="fld">STATUS</label>
    <select id="lst">${LEAD_STATUSES.map((s) => `<option ${l.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <label class="fld">NOTES</label><textarea id="lnotes" rows="3">${esc(l.notes || "")}</textarea>
    <div class="rowbtns" style="margin-top:15px">
      ${isNew ? "" : `<button class="btn ghost" id="ldel">Delete</button>`}
      <button class="btn primary" id="lsave">${isNew ? "Add lead" : "Save"}</button>
    </div>
    ${l.phone ? `<a class="btn ghost wide" style="display:block;margin-top:9px;text-align:center;text-decoration:none;padding:12px" href="tel:${esc(l.phone)}">Call ${esc(l.phone)}</a>` : ""}
    <div class="note" id="lnote" style="margin-top:9px"></div>`, (sh) => {
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
        <button data-done="${esc(t.id)}" style="background:none;border:1px solid var(--line);border-radius:50%;width:24px;height:24px;color:var(--dim);cursor:pointer;flex-shrink:0"></button>
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

function todoSheet(t) {
  const isNew = !t.id;
  sheet(`<h2>${isNew ? "New to-do" : "Edit to-do"}</h2>
    <label class="fld">WHAT</label><input id="tt" value="${esc(t.title || "")}">
    <label class="fld">WHEN</label><input id="td" type="datetime-local" value="${t.dueAt ? new Date(t.dueAt).toISOString().slice(0, 16) : ""}">
    <label class="fld">CUSTOMER</label><input id="tc" value="${esc(t.customerName || "")}">
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
async function businessSheet() {
  const b = S.profile?.business || {};
  const u = S.usage;
  const pct = u && u.budget_usd > 0 ? Math.round(u.spent_usd / u.budget_usd * 100) : 0;
  sheet(`<h2>Your business</h2><p class="sh-sub">${esc(b.name || "")}${S.profile?.role ? " · you're the " + esc(S.profile.role) : ""}</p>
    <label class="fld">BUSINESS NAME</label><input id="bn" value="${esc(b.name || "")}">
    <label class="fld">ADDRESS</label><input id="ba" value="${esc(b.address || "")}">
    <button class="btn ghost wide" style="margin-top:11px" id="bsave">Save</button>

    <div class="eyebrow" style="margin-top:20px">AI ALLOWANCE</div>
    <div class="panel" style="margin-top:8px">
      <div class="kv"><span>Used this month</span><span>${u ? money(u.spent_usd) + " of " + money(u.budget_usd) : "—"}</span></div>
      <div style="height:7px;background:rgba(255,255,255,.07);border-radius:99px;margin-top:9px;overflow:hidden">
        <div style="height:100%;width:${Math.min(pct, 100)}%;background:${pct >= 80 ? "var(--orange)" : "linear-gradient(90deg,var(--cyan),var(--purple))"}"></div></div>
      <button class="btn ghost wide" style="margin-top:11px" id="bpu">⚡ Power-Ups</button>
    </div>

    <div class="eyebrow" style="margin-top:20px">CONNECTIONS</div>
    <div class="rowbtns" style="margin-top:8px;flex-direction:column">
      <button class="btn ghost wide" data-connect="/quickbooks-oauth/start">QuickBooks</button>
      <button class="btn ghost wide" data-connect="/google-calendar/start">Google Calendar</button>
      <button class="btn ghost wide" data-connect="/gmail/start">Gmail</button>
    </div>

    <div class="eyebrow" style="margin-top:20px">TEAM</div>
    <div id="teamslot" class="note" style="margin-top:8px">Loading…</div>

    <div class="eyebrow" style="margin-top:20px">APP</div>
    <div class="rowbtns" style="margin-top:8px;flex-direction:column">
      ${S.installPrompt ? `<button class="btn primary wide" id="install">📲 Install Ledger AI</button>` : ""}
      <button class="btn ghost wide" id="bnew">Start a fresh conversation</button>
      <button class="btn ghost wide" id="bbill">Manage subscription</button>
      <button class="btn ghost wide" id="bout" style="color:var(--red)">Sign out</button>
    </div>`, async (sh) => {
    wireConnect(sh);
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
