// Onboarding mock — a tiny static server for this repo that also plays the
// workspace-profile edge function for the sign-up onboarding (CONTRACT §4).
// Dev and tests only. Nothing here ships in the app bundle.
//
//   node tests/onboarding-mock.mjs            → http://localhost:4173/app.html?onboardingPreview=1
//   node tests/onboarding-mock.mjs 4200       → another port
//   import { startMock } from "./onboarding-mock.mjs"  (the Playwright walk does this)
//
// Everything lives in memory. POST /__mock/reset {scenario: fresh|in_progress|complete}
// starts over; GET /__mock/state shows what the "server" holds. The app's
// DEV_PREVIEW switch (loopback + ?onboardingPreview=1) points SUPA_URL at
// this origin, so /functions/v1/* and /rest/v1/* land here.
//
// Every line of text the onboarding actions return (understanding, brief,
// first_message, setup_plan, applied, suggestions) comes from
// assets/onboarding-text.js — the port of the server modules
// (_shared/onboarding_schema.ts, _shared/business_brief.ts,
// workspace-profile/onboarding.ts) — run the way the server runs them:
// validateSection → applyShopProfile (mirrored) → rowAfterSave / mergeAnswers
// → understandingFor; answersOf / briefInput / renderBusinessBrief for the
// summary. tests/onboarding-text.mjs holds this to the oracle fixture.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };

// ---- The server modules (classic script → globalThis.LedgerOnboardingText) ------
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "assets/onboarding-text.js"), "utf8"), { filename: "assets/onboarding-text.js" });
const T = globalThis.LedgerOnboardingText;
const { validateSection, splitByStore, nextSection, isStepId, STEP_IDS, STEP_SECTIONS, SCHEMA_VERSION, CONFIRM_SECTION } = T.schema;
const { answersOf, sectionsOf, statusOf, currentSectionOf, onboardingSummary, rowAfterSave, mergeAnswers } = T.onboarding;
const { describeHours } = T.hours;

export const SECTIONS = STEP_SECTIONS.map((s) => [s.id, s.title]);
const ORDER = STEP_IDS.slice();
// Server-owned example copy (CONTRACT onboarding-get.suggestions). Examples,
// never defaults: the app labels every one "example — change it".
export const SUGGESTIONS = T.suggestions;

// ---- State: the workspace row as bootstrap leaves it, the price list, the onboarding row ----
// (what the oracle held), plus the flat readers the walks and the recorder look at on
// /__mock/state: status, current_section, sections, answers (the onboarding-get view).
const NO_TYPE_YET = "Pick what kind of business you run first.";
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
function sync(st) {
  st.status = statusOf(st.row);
  st.current_section = currentSectionOf(st.row);
  st.sections = Object.fromEntries(sectionsOf(st.row).map((s) => [s.id, { done: s.done, skipped: s.skipped }]));
  st.answers = answersOf(st.ws, st.services, st.row);
  st.started_at = st.row?.started_at ?? null;
  st.completed_at = st.row?.completed_at ?? null;
  return st;
}
// onboarding-save, as onboarding_actions.ts runs it (and as the oracle mirrored applyShopProfile).
function saveSection(st, section, sent, skip) {
  if (!isStepId(section)) throw bad(section === CONFIRM_SECTION ? "The last step has nothing to save — finish instead." : "That section does not exist.");
  sent = sent && typeof sent === "object" && !Array.isArray(sent) ? sent : {};
  // team_roles is empty for a one-person business; the size may arrive in the same save.
  const teamSize = typeof sent.team_size === "string" ? sent.team_size : (st.ws.team_size ?? null);
  const v = validateSection(section, sent, { team_size: teamSize });
  if (!v.ok) throw bad(v.error);
  const { profile, answers } = splitByStore(v.answers);
  for (const [k, val] of Object.entries(profile)) {
    if (k === "services") {
      for (const s of val) {
        const existing = s.id ? st.services.find((x) => x.id === s.id) : null;
        if (existing) Object.assign(existing, { name: s.name, price: s.price, duration_minutes: s.duration_minutes ?? null });
        else st.services.push({ id: `svc_${++st.seq}`, name: s.name, price: s.price, duration_minutes: s.duration_minutes ?? null });
      }
    } else if (k === "remove_service_ids") st.services = st.services.filter((s) => !val.includes(s.id));
    else if (k === "payment_terms_days") st.ws.books_default_terms_days = val;
    else st.ws[k] = val;
  }
  const now = new Date().toISOString();
  const answered = Object.keys(v.answers).length > 0;
  const next = nextSection(section);
  st.row = { workspace_id: st.workspace_id, ...rowAfterSave(st.row, section, next, answered, skip, now), answers: mergeAnswers(st.row?.answers, answers) };
  st.log.push({ action: "onboarding-save", section, keys: Object.keys(v.answers), skip: !!skip });
  sync(st);
  const understanding = answered ? T.understanding(section, v.answers, { currency_code: st.ws.currency_code }) : T.understanding(section, {}, {});
  return { saved: true, status: st.row.status, section, next_section: next, understanding, sections: sectionsOf(st.row) };
}
// renderOnboarding on a fresh workspace: the summary's three texts (and, on complete, the applied list).
const rendered = (st) => ({ brief: T.brief(st.answers, st.ws), first_message: T.firstMessage(st.answers, st.ws), setup_plan: T.setupPlan(st.answers, st.ws) });
export function brief(st) { return T.brief(st.answers, st.ws); }
function completeRun(st) {
  if (!st.ws.business_type) throw bad(NO_TYPE_YET, 409);
  const out = { status: "complete", ...rendered(st), applied: T.applied(st.answers, st.ws) };
  const now = new Date().toISOString();
  st.row = { workspace_id: st.workspace_id, schema_version: SCHEMA_VERSION, status: "complete", current_section: CONFIRM_SECTION,
    sections_done: st.row?.sections_done ?? [], sections_skipped: st.row?.sections_skipped ?? [], answers: st.row?.answers ?? {},
    started_at: st.row?.started_at ?? now, completed_at: now, updated_at: now };
  st.log.push({ action: "onboarding-complete" });
  sync(st);
  return out;
}
function skipRun(st) {
  const now = new Date().toISOString();
  st.row = { workspace_id: st.workspace_id, schema_version: SCHEMA_VERSION, status: "skipped", current_section: currentSectionOf(st.row),
    sections_done: st.row?.sections_done ?? [], sections_skipped: st.row?.sections_skipped ?? [], answers: st.row?.answers ?? {},
    started_at: st.row?.started_at ?? now, updated_at: now };
  st.log.push({ action: "onboarding-skip" });
  sync(st);
  return { status: "skipped" };
}

// The seeded scenarios are replayed through the same saves, so what they hold is what saving would have left.
const SEED = {
  about: { business_type: "trades", business_description: "Licensed electrical work for homes in Red Deer", business_stage: "growing", team_size: "solo", region_code: "AB", timezone: "America/Edmonton" },
  offer: { services: [{ name: "Service call", price: 120, duration_minutes: 60 }, { name: "Panel inspection", price: 150, duration_minutes: 90 }], pricing_model: "hourly", hourly_rate: 95, quotes_first: true },
  customers: { customer_mix: "both", intake_channels: ["phone", "text", "referral"], job_location: "customer_place", service_area: "Red Deer and 40 km around", typical_job_length: "1_3h", repeat_business: "both" },
  week: { business_hours: { mon: { open: "08:00", close: "17:00" }, tue: { open: "08:00", close: "17:00" }, wed: { open: "08:00", close: "17:00" }, thu: { open: "08:00", close: "17:00" }, fri: { open: "08:00", close: "17:00" }, sat: null, sun: null }, after_hours: "text_back", booking_lead: "next_day" },
  money: { payment_methods: ["etransfer", "card"], payment_terms_days: 0, deposit: { type: "percent", value: 25 } },
  team: { team_roles: [], wants_front_desk: true, uses_quickbooks: false, uses_google_calendar: null },
  ledger: { ai_tone: "friendly", goals: ["fewer_missed_calls", "get_paid_faster"], rules: ["Emergency calls after 8 pm cost the after-hours rate"], autonomy: { reminders: true, review_replies: null, after_hours_texts: true } },
};
// `ws` may override the workspace bootstrap columns (name, currency_code, timezone, call_me) — the
// text test runs each oracle set on its own workspace; the walks and the recorder take the defaults.
export function freshState(scenario = "fresh", ws = {}) {
  const st = {
    workspace_id: "ws_preview", name: "Preview Business", call_me: "Boss", currency_code: "CAD", currency_symbol: "$", timezone: "America/Edmonton",
    schema_version: SCHEMA_VERSION, seq: 0, log: [],
    ws: null, services: [], row: null,
  };
  for (const k of ["name", "currency_code", "timezone"]) if (typeof ws[k] === "string" && ws[k]) st[k] = ws[k];
  if (ws.call_me === null || (typeof ws.call_me === "string")) st.call_me = ws.call_me;
  // Workspace row as bootstrap leaves it (name, currency, zone; terms default 0; nothing else known).
  st.ws = { name: st.name, currency_code: st.currency_code, ai_call_me: st.call_me, plan: null, phone_number: null, books_default_terms_days: 0, timezone: st.timezone };
  sync(st);
  const upto = scenario === "in_progress" ? 3 : scenario === "complete" ? ORDER.length : 0;
  for (const id of ORDER.slice(0, upto)) saveSection(st, id, SEED[id], false);
  if (scenario === "complete") completeRun(st);
  st.log.length = 0;
  return st;
}
const onboardingOut = (st) => onboardingSummary(st.row);
const shopProfile = (st) => { const a = st.answers; return {
  business_type: a.business_type ?? null, business_description: a.business_description ?? null, service_area: a.service_area ?? null, business_hours: a.business_hours ?? null,
  hours_text: describeHours(a.business_hours ?? null), timezone: a.timezone ?? st.timezone, pricing_model: a.pricing_model ?? null, customer_mix: a.customer_mix ?? null, team_size: a.team_size ?? null,
  intake_channels: a.intake_channels || [], region_code: a.region_code ?? null, services: a.services || [], completed: !!st.completed_at }; };

export function handleProfile(st, body) {
  const action = body?.action;
  if (action === "bootstrap") return { created: false, needs_setup: false, workspace_id: st.workspace_id, name: st.name, subscription_status: "trialing", trial_ends_at: new Date(Date.now() + 12 * 864e5).toISOString(), shop_profile: shopProfile(st), role: "owner", currency_code: st.currency_code };
  if (action === "get") return { name: st.name, address: "", logo_url: null, member_since: new Date(Date.now() - 3600e3).toISOString(), call_me: st.call_me, shop_profile: shopProfile(st), onboarding: onboardingOut(st) };
  if (action === "readiness") { const a = st.answers; return { provider: "native", steps: [
    { id: "profile", title: "Review business details, time zone and hours", done: !!a.business_type && !!describeHours(a.business_hours ?? null) },
    { id: "customers", title: "Bring customers and check saved details", done: false },
    { id: "services", title: "Review service prices and booking durations", done: !!a.services?.some((s) => s.duration_minutes > 0) },
    { id: "tax", title: "Review tax registration and rates", done: false },
    { id: "invoice", title: "Create and review your first invoice", done: false },
    { id: "booking", title: "Create and review your first appointment", done: false },
  ], note: "Checks show saved records, not independent verification that their details are correct.", onboarding: onboardingOut(st) }; }
  if (action === "onboarding-get") {
    // currency (ISO 4217) drives every price symbol the flow shows (round 2).
    return { status: st.status, schema_version: SCHEMA_VERSION, currency: st.ws.currency_code, current_section: st.current_section, sections: sectionsOf(st.row), answers: st.answers, suggestions: SUGGESTIONS, started_at: st.started_at, completed_at: st.completed_at };
  }
  if (action === "onboarding-save") return saveSection(st, body.section, body.answers, body.skip === true);
  if (action === "onboarding-complete") return completeRun(st);
  if (action === "onboarding-skip") return skipRun(st);
  if (action === "onboarding-summary") return { status: st.status, ...rendered(st) };
  if (action === "shop-profile-save") { const clean = {}; for (const [k, v] of Object.entries(body)) if (k !== "action") clean[k] = v; Object.assign(st.ws, clean); st.ws.shop_profile_completed_at = st.ws.shop_profile_completed_at || new Date().toISOString(); sync(st); if (!st.completed_at) st.completed_at = st.ws.shop_profile_completed_at; return { saved: true, shop_profile: shopProfile(st) }; }
  throw bad(`Unknown action ${action}`, 404);
}

// Harmless replies for everything else the Home screen asks for while the
// preview is up. Nothing here is asserted by the tests.
function handleOther(pathname, body) {
  if (pathname === "/functions/v1/stripe-billing/status") return { subscription_status: "trialing", trial_ends_at: new Date(Date.now() + 12 * 864e5).toISOString(), card_on_file: false, billing_ready: true, plan: "pro" };
  if (pathname === "/functions/v1/books") return body?.action === "settings" ? { chosen: false, provider: "native" } : {};
  if (pathname === "/functions/v1/ledger-ai") return body?.action === "usage" ? { trial_state: "pending", remaining_usd: 20 } : { reply: "" };
  if (pathname === "/functions/v1/phone") return { number: null, numbers: [], calls: [], messages: [] };
  if (pathname === "/functions/v1/realtime/state") return { available: false };
  if (pathname === "/functions/v1/catalog") return { items: [] };
  if (pathname === "/functions/v1/crew" || pathname === "/functions/v1/team") return { members: [], jobs: [] };
  if (pathname === "/functions/v1/bookings") return { bookings: [], appointments: [] };
  if (pathname === "/functions/v1/leads") return { leads: [] };
  if (pathname.startsWith("/functions/v1/google-calendar")) return { connected: false, hours: null };
  return {};
}

export function startMock({ port = 0, scenario = "fresh", root = ROOT } = {}) {
  let st = freshState(scenario);
  const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" }); res.end(JSON.stringify(obj)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const readBody = () => new Promise((ok) => { let s = ""; req.on("data", (c) => s += c); req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } }); });
    if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); return res.end(); }
    if (url.pathname === "/__mock/reset") { const b = await readBody(); st = freshState(b.scenario || "fresh", b); return send(res, 200, { ok: true, scenario: b.scenario || "fresh" }); }
    if (url.pathname === "/__mock/state") return send(res, 200, st);
    if (url.pathname === "/functions/v1/workspace-profile") {
      const b = await readBody();
      try { return send(res, 200, handleProfile(st, b)); } catch (e) { return send(res, e.status || 500, { error: e.message }); }
    }
    if (url.pathname.startsWith("/functions/v1/")) { const b = req.method === "POST" ? await readBody() : {}; return send(res, 200, handleOther(url.pathname, b)); }
    if (url.pathname.startsWith("/rest/v1/")) return send(res, 200, []);
    if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});
    // Static files from the repo root.
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname === "/" ? "/app.html" : url.pathname)));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html"); } catch {}
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ server, port: server.address().port, url: `http://localhost:${server.address().port}`, state: () => st, reset: (s, ws) => { st = freshState(s, ws); return st; } })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 4173;
  const scenario = process.argv[3] || "fresh";
  startMock({ port, scenario }).then((m) => {
    console.log(`onboarding mock on ${m.url}/app.html?onboardingPreview=1  (scenario: ${scenario}; add &scenario=firstrun for the sign-up path)`);
    console.log(`reset: curl -X POST ${m.url}/__mock/reset -d '{"scenario":"in_progress"}'`);
  });
}
