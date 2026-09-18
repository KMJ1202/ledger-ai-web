// Customer tracking page (Kyle 2026-09-12, 1202). Package-tracker honesty:
// the timeline is what the technician actually tapped, the estimate is either
// LIVE (their position is under three minutes old) or the ORIGINAL estimate
// they were texted, said exactly that way. No fake live dot, no coordinates.
//
// Audit 14.5: lives in its own file (CSP allows same-origin scripts without a
// hash) and classifies responses with LinkRecovery — a dead link is terminal,
// a rate limit waits, a server fault shows the server's words, and only a real
// connection failure says "check your connection".
const FN = "https://lbzkyyehmgudlxmfpzzh.supabase.co/functions/v1/crew";
const token = new URLSearchParams(location.search).get("t") || "";
const $ = (id) => document.getElementById(id);
let timer = null, lastStatus = null, stopped = false;
const RATE_LIMIT_WAIT_MS = 120000;

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function clock(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  try { return d.toLocaleTimeString("en-CA", { timeZone: tz, hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.m\./i, (m, p) => " " + p.toUpperCase() + "M"); }
  catch { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
}
function telHref(phone) { const d = String(phone || "").replace(/[^\d+]/g, ""); return d.replace(/\D/g, "").length >= 10 ? "tel:" + d : null; }

function render(d) {
  const tz = d.timezone || "America/Edmonton";
  const first = d.tech?.firstName || "Your technician";
  const shop = d.shop?.name || "";
  const status = d.status || "assigned";
  const t = d.timeline || {};
  $("shop").textContent = shop;
  const steps = [
    { key: "on_my_way", label: "On the way", at: t.onMyWayAt },
    { key: "on_site", label: "Arrived", at: t.onSiteAt },
    { key: "done", label: "All done", at: t.doneAt },
  ];
  const idx = status === "done" ? 2 : status === "on_site" ? 1 : status === "on_my_way" ? 0 : -1;
  const track = steps.map((s, i) => `<div class="${i <= idx ? "step done" : i === idx + 1 ? "step current" : "step"}">
      <div style="display:flex;align-items:center;width:100%">
        ${i > 0 ? '<div class="step-line"></div>' : '<div style="width:0"></div>'}
        <div class="step-dot">${i <= idx ? "✓" : String(i + 1)}</div>
        ${i < steps.length - 1 ? '<div class="step-line"></div>' : '<div style="width:0"></div>'}
      </div>
      <div class="step-label">${s.label}</div>
      <div class="step-time">${i <= idx && s.at ? esc(clock(s.at, tz)) : ""}</div>
    </div>`).join("");
  const tel = telHref(d.shop?.phone);
  const callRow = tel ? `<div class="callrow"><a class="callbtn" href="${tel}">Call ${esc(shop || "us")}</a></div>` : "";

  let head = "", sub = "", body = "", icon = "🚗", foot = "";
  if (status === "done") {
    icon = "✓";
    head = "All done";
    sub = `${esc(first)} finished the job${t.doneAt ? ` at ${esc(clock(t.doneAt, tz))}` : ""}. Thank you for choosing ${esc(shop || "us")}.`;
    body = `<div class="finished"><div class="big">🎉</div><h2>Job complete</h2></div><div class="track">${track}</div>${callRow}`;
  } else if (status === "on_site") {
    icon = "📍";
    head = `${esc(first)} has arrived`;
    sub = t.onSiteAt ? `Arrived at ${esc(clock(t.onSiteAt, tz))}.` : "";
    body = `<div class="track">${track}</div>${callRow}`;
  } else if (status === "on_my_way") {
    head = `${esc(first)} is on the way`;
    const e = d.estimate || { kind: "none", line: "" };
    if (e.kind === "live") {
      sub = "Live — updated as your technician moves.";
      body = `<div class="eta"><div class="label">Arriving around</div><div class="big">${esc(clock(e.etaAt, tz))}</div>
        <span class="live"><span class="dot"></span>LIVE · AS OF ${esc(clock(e.asOf, tz)).toUpperCase()}</span>
        <div class="line">About ${Math.max(1, Math.round((e.etaSeconds || 0) / 60))} minutes away by road.</div></div>
        <div class="track">${track}</div>${callRow}`;
    } else if (e.kind === "original") {
      sub = "Location isn't updating right now, so this is the estimate you were sent — not a live one.";
      body = `<div class="eta"><div class="label">Original arrival estimate</div><div class="big orig">${esc(clock(e.etaAt, tz))}</div>
        <span class="live warn"><span class="dot"></span>${e.staleSince ? "LOCATION NOT UPDATING SINCE " + esc(clock(e.staleSince, tz)).toUpperCase() : "LOCATION NOT UPDATING"}</span>
        <div class="line">${e.asOf ? `Texted to you at ${esc(clock(e.asOf, tz))}. ` : ""}${tel ? "Need a firmer time? Give us a call." : ""}</div></div>
        <div class="track">${track}</div>${callRow}`;
    } else {
      sub = t.onMyWayAt ? `Left for you at ${esc(clock(t.onMyWayAt, tz))}.` : "";
      body = `<div class="eta"><div class="label">Arrival</div><div class="big" style="font-size:22px">No estimate yet</div>
        <div class="line">${esc(e.line || "We'll show a time as soon as one is available.")}</div></div>
        <div class="track">${track}</div>${callRow}`;
    }
    foot = "This page refreshes on its own. It shows what the technician has reported — it never shows their exact position.";
  } else {
    head = `${esc(first)} is scheduled`;
    sub = "You'll see live progress here once they're on the way.";
    body = `<div class="track">${track}</div>${callRow}`;
  }
  $("icon").textContent = icon;
  $("headline").innerHTML = head;
  $("subline").innerHTML = sub;
  $("card").innerHTML = body;
  $("footnote").textContent = foot;
  document.title = shop ? `${shop} — ${first}` : "Your technician";
  lastStatus = status;
}

// What to do with a failed load. Exported on window so the page test can
// exercise the classification without a browser session.
function classify(error) {
  if (error.status === 400 || LinkRecovery.terminal(error)) return { kind: "terminal", message: error.message || LinkRecovery.message(error, "tracking") };
  if (LinkRecovery.rateLimited(error)) return { kind: "wait", message: LinkRecovery.message(error, "tracking"), delay: Math.max(RATE_LIMIT_WAIT_MS, (error.retryAfter || 0) * 1000) };
  if (error.status === 0) return { kind: "offline", message: "Still loading… check your connection.", delay: 60000 };
  return { kind: "fault", message: LinkRecovery.message(error, "tracking"), delay: 60000 };
}

let holdUntil = 0;
function schedule(delay) {
  clearTimeout(timer);
  if (stopped || lastStatus === "done" || document.hidden) return;
  timer = setTimeout(load, delay);
}

async function load() {
  clearTimeout(timer);
  if (stopped) return;
  let delay = lastStatus === "on_my_way" ? 30000 : 60000;
  try {
    const d = await LinkRecovery.request(FN, { action: "crew-track/data", token });
    $("loading").style.display = "none"; $("expired").style.display = "none"; $("app").style.display = "block";
    render(d);
    delay = lastStatus === "on_my_way" ? 30000 : 60000;
  } catch (error) {
    const outcome = classify(error);
    if (outcome.kind === "terminal") { showExpired(outcome.message); return; }
    delay = outcome.delay;
    // A rate limit holds even across tab switches; nothing hammers the server.
    if (outcome.kind === "wait") holdUntil = Date.now() + delay;
    // Keep whatever is on screen; say why it is not fresh and when we retry.
    if ($("app").style.display !== "block") $("loading").textContent = outcome.message;
    else $("footnote").textContent = outcome.kind === "wait" ? outcome.message + " This page will refresh again shortly." : outcome.message;
  }
  schedule(delay);
}
function showExpired(msg) {
  stopped = true;
  clearTimeout(timer);
  $("loading").style.display = "none"; $("app").style.display = "none";
  if (msg) $("expiredmsg").textContent = msg + " Call us if you have a question.";
  $("expired").style.display = "block";
}
window.TrackPage = { classify, RATE_LIMIT_WAIT_MS };
if (!token) showExpired("This link is missing its code."); else load();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { clearTimeout(timer); return; }
  if (!token || stopped || lastStatus === "done") return;
  if (Date.now() < holdUntil) schedule(holdUntil - Date.now()); else load();
});
