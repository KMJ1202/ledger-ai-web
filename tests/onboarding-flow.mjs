// Run from this repository: node tests/onboarding-flow.mjs
// Unit tests for the sign-up onboarding flow's pure half (app.js between the
// "Onboarding flow (start)" and "(pure end)" markers), same vm harness as
// first-working-day.mjs: the real source, stubbed globals, no browser.
import fs from "node:fs"; import vm from "node:vm"; import assert from "node:assert/strict";
const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const slice = (from, to) => { const a = source.indexOf(from); assert(a > 0, `missing ${from}`); const b = source.indexOf(to, a); assert(b > a, `missing ${to}`); return source.slice(a, b); };
const pure = slice("// ---- Onboarding flow (start)", "// ---- Onboarding flow (pure end)");
const types = slice("const BUSINESS_TYPES = [", "\n];") + "\n];";
const chips = slice("function chipsField(key, q, picked) {", "// Wires every chip group");
const planActions = slice("const OB_PLAN_ACTIONS = {", "\n};") + "\n};";
const placeholder = slice("const placeholderForType = ", "\n");

// CONTRACT §2, word for word.
const CONTRACT_SECTIONS = [
  ["about", "About your business"], ["offer", "What you offer"], ["customers", "Your customers and how work comes in"], ["week", "Your week"],
  ["money", "Getting paid"], ["team", "Your team and tools"], ["ledger", "How Ledger should work for you"], ["confirm", "Here's what Ledger understands"],
];
// CONTRACT §6.
const PLAN_IDS = ["services_import", "books_choice", "tax_review", "hours", "phone_front_desk", "reminders", "google_calendar", "google_business", "team_invite", "add_card", "booking_link", "first_invoice", "first_booking"];

const ctx = {
  S: { currency: "CAD" },
  esc: (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
  money: (n) => `$${Number(n).toFixed(2)}`,
  regionSelect: (id, cur) => `<select id="${id}" class="cmpinput"><option value="${cur}">${cur}</option></select>`,
  timezoneSelect: (id, cur) => `<select id="${id}" class="cmpinput"><option value="${cur}">${cur}</option></select>`,
  Intl, console,
};
vm.createContext(ctx);
vm.runInContext(types + "\n" + placeholder + "\n" + chips + "\n" + pure + "\n" + planActions, ctx);
// vm values come from another realm: hand them back through JSON so deepEqual compares shape, not prototypes.
const g = (name) => { const v = run(name, ctx); return v !== null && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v; };
const run = (code) => { const v = vm.runInContext(code, ctx); return v !== null && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v; };
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("PASS", name); };

test("section ids, order and titles equal CONTRACT §2", () => {
  assert.deepEqual(g("OB_SECTIONS"), CONTRACT_SECTIONS);
  assert.equal(g("OB_STEPS"), 7);
  assert.equal(g('obStepLabel("about")'), "Step 1 of 7");
  assert.equal(g('obStepLabel("ledger")'), "Step 7 of 7");
  assert.doesNotMatch(g('obStepLabel("confirm")'), /Step \d/, "confirm is not a step");
  assert.equal(g('obProgressPct("about")'), 0); assert.equal(g('obProgressPct("confirm")'), 100);
});

test("about cannot be skipped; confirm has no skip; every other section can", () => {
  assert.equal(g('obCanSkip("about")'), false);
  assert.equal(g('obCanSkip("confirm")'), false);
  for (const id of ["offer", "customers", "week", "money", "team", "ledger"]) assert.equal(g(`obCanSkip("${id}")`), true, id);
  assert.equal(g('obCanSkip("nope")'), false);
  // The flow's DOM half honours the same helper and the only skip wording is OB_COPY.skip, "Skip for now".
  const dom = slice("// ---- Onboarding flow (pure end)", "// ---- Onboarding flow (end)");
  assert.match(dom, /q\("#obskip"\)\.hidden = !obCanSkip\(section\)/);
  assert.match(dom, /if \(F\.saving \|\| !obCanSkip\(F\.section\)\) return;/);
  assert.equal(g("OB_COPY.skip"), "Skip for now");
  assert.doesNotMatch(dom, />[^<>\n]*Skip[^<>\n]*</, "no literal skip wording outside OB_COPY");
  assert.match(dom, /id="obskip" hidden>\$\{esc\(OB_COPY\.skip\)\}</);
});

test("conditional questions appear and disappear", () => {
  const vis = (s, a) => run(`obVisibleQuestions(${JSON.stringify(s)}, ${JSON.stringify(a)})`, ctx);
  assert.ok(!vis("offer", { pricing_model: "flat" }).includes("hourly_rate"));
  assert.ok(vis("offer", { pricing_model: "hourly" }).includes("hourly_rate"));
  assert.ok(vis("offer", { pricing_model: "mix" }).includes("hourly_rate"));
  assert.ok(!vis("offer", {}).includes("hourly_rate"));
  assert.ok(!vis("customers", { job_location: "my_place" }).includes("service_area"));
  assert.ok(!vis("customers", { job_location: "remote" }).includes("service_area"));
  assert.ok(vis("customers", { job_location: "customer_place" }).includes("service_area"));
  assert.ok(vis("customers", { job_location: "both" }).includes("service_area"));
  assert.ok(!vis("team", { team_size: "solo" }).includes("team_roles"));
  assert.ok(vis("team", { team_size: "small" }).includes("team_roles"));
  assert.ok(vis("team", {}).includes("team_roles"));
  // A question hidden by a later pick clears its saved value.
  const payload = run(`obPayload("offer", { pricing_model: "flat" }, { pricing_model: "hourly", hourly_rate: 95 }, new Set(["pricing_model"]), obVisibleQuestions("offer", { pricing_model: "flat" }))`, ctx);
  assert.deepEqual(payload, { pricing_model: "flat", hourly_rate: null });
  // Only this section's keys, and nothing the owner never touched.
  assert.deepEqual(Object.keys(payload).filter((k) => !g("OB_KEYS").offer.includes(k)), []);
});

test("next_section from the server wins over local order", () => {
  assert.equal(g('obNextSection("about", "week")'), "week");
  assert.equal(g('obNextSection("about", null)'), "offer");
  assert.equal(g('obNextSection("about", undefined)'), "offer");
  assert.equal(g('obNextSection("ledger", undefined)'), "confirm");
  assert.equal(g('obNextSection("about", "bogus")'), "offer");
  assert.equal(g('obPrevSection("about")'), null);
  assert.equal(g('obPrevSection("confirm")'), "ledger");
});

test("resume opens at current_section", () => {
  assert.equal(g('obResumeSection({ status: "in_progress", current_section: "money" })'), "money");
  assert.equal(g('obResumeSection({ status: "skipped", current_section: "team" })'), "team");
  assert.equal(g('obResumeSection({ status: "not_started", current_section: "about" })'), "about");
  assert.equal(g('obResumeSection({ status: "complete", current_section: "confirm" })'), "about");
  assert.equal(g('obResumeSection({ status: "in_progress", current_section: "money" }, { section: "about" })'), "about", "an explicit section (Update answers) wins");
  assert.equal(g('obResumeSection({ status: "in_progress", current_section: "nope" })'), "about");
  assert.equal(g('obResumeSection(null)'), "about");
});

test("plan renders an action button for every CONTRACT §6 id, mapped to a sheet", () => {
  const plan = PLAN_IDS.map((id, i) => ({ id, title: `Step ${i}`, detail: "d", done: false, action: id, needs: id === "phone_front_desk" ? "A Ledger business number (Pro)." : undefined }));
  // A plan is at most seven items (CONTRACT onboarding-complete), so the 13 ids are checked seven at a time.
  for (const batch of [plan.slice(0, 7), plan.slice(7)]) {
    const html = vm.runInContext(`obPlanHtml(${JSON.stringify(batch)})`, ctx);
    for (const it of batch) assert.match(html, new RegExp(`<button class="btn (primary|ghost)" data-plan="${it.id}" aria-label="[^"]+: Step \\d+">`), it.id);
    assert.equal((html.match(/data-plan=/g) || []).length, batch.length);
  }
  const html = vm.runInContext(`obPlanHtml(${JSON.stringify(plan)})`, ctx);
  assert.match(html, /Needs: A Ledger business number \(Pro\)\./);
  assert.equal((html.match(/data-plan=/g) || []).length, 7, "a plan shows at most seven items");
  const actions = vm.runInContext("OB_PLAN_ACTIONS", ctx);
  for (const id of PLAN_IDS) assert.equal(typeof actions[id], "function", `OB_PLAN_ACTIONS.${id}`);
  assert.equal(vm.runInContext("obPlanHtml([])", ctx), "", "no plan → nothing (the old checklist stays)");
  assert.equal(vm.runInContext('obPlanHtml([{ id: "hours", title: "x", done: true, action: "hours" }])', ctx), "", "all done → nothing");
  const done = vm.runInContext('obPlanHtml([{ id: "hours", title: "Set hours", done: true, action: "hours" }, { id: "first_booking", title: "Book", done: false, action: "first_booking" }])', ctx);
  assert.match(done, /setupstep done/); assert.match(done, /&#10003;/); assert.match(done, /btn primary" data-plan="first_booking"/);
});

test("first_message replaces the generic greeting", () => {
  assert.equal(g('obFinishLine({ first_message: "Hi Sam — Northside Auto is set up." }, "Northside Auto")'), "Hi Sam — Northside Auto is set up.");
  assert.equal(g('obFinishLine({ first_message: "  " }, "Northside Auto")'), "🎉 Northside Auto is set up — your 14-day free trial is live. Review your setup checklist before the first real job.");
  assert.match(g('obFinishLine(null, "Biz")'), /^🎉 Biz is set up/);
});

test("screen values become typed answers (CONTRACT §3) and back", () => {
  const v = run(`obValues("offer", { pricing_model: "hourly", hourly_rate: "95", quotes_first: "true" }, { services: { services: () => [{ name: "Service call", price: 120, duration_minutes: 60 }], removed: () => [] } })`, ctx);
  assert.deepEqual(v, { services: [{ name: "Service call", price: 120, duration_minutes: 60 }], remove_service_ids: [], pricing_model: "hourly", hourly_rate: 95, quotes_first: true });
  const m = run(`obValues("money", { payment_methods: ["card", "cash"], payment_terms_days: "7", deposit_type: "percent", deposit_value: "25" })`, ctx);
  assert.deepEqual(m, { payment_methods: ["cash", "card"], payment_terms_days: 7, deposit: { type: "percent", value: 25 } });
  const l = run(`obValues("ledger", { ai_tone: "brief", goals: ["less_admin"], rules: [" Always  call first ", "", "x".repeat(200)], autonomy: ["reminders"] })`, ctx);
  assert.deepEqual(l.autonomy, { reminders: true, review_replies: false, after_hours_texts: false });
  assert.deepEqual(l.rules, ["Always call first", "x".repeat(160)]);
  const seed = run(`obSeed("money", ${JSON.stringify(m)})`, ctx);
  assert.deepEqual(seed, { payment_methods: ["cash", "card"], payment_terms_days: "7", deposit_type: "percent", deposit_value: "25" });
  const hidden = run(`obValues("team", { team_roles: ["admin"], team_size: "solo" })`, ctx);
  assert.deepEqual(hidden.team_roles, ["admin"], "obValues reads; obPayload decides what to send");
  const p = run(`obPayload("team", { team_roles: ["admin"] }, { team_roles: ["admin"] }, new Set(), obVisibleQuestions("team", { team_size: "solo" }))`, ctx);
  assert.deepEqual(p, { team_roles: null }, "solo → team_roles cleared");
});

test("suggestions are examples labelled 'example — change it'; placeholder comes from the server", () => {
  // Built inside the vm: JSON would drop the editor's html() function.
  vm.runInContext(`var CTXQ = { picked: {}, answers: { business_type: "beauty" }, editors: { services: { html: () => "<div>editor</div>" } }, suggestions: { services: { beauty: [{ name: "Haircut", price: 45, duration_minutes: 45 }] }, descriptions: { beauty: "Cuts, colour and styling for women and men in <your town>" }, rules: { beauty: ["Colour appointments need a patch test 48 hours before"] } }, currency: "$" };`, ctx);
  const services = vm.runInContext(`obQuestionHtml("services", CTXQ)`, ctx);
  assert.match(services, /example — change it/); assert.match(services, /data-ex="0"[^>]*>Haircut · \$45</);
  assert.match(services, /<div>editor<\/div>/);
  const desc = vm.runInContext(`obQuestionHtml("business_description", CTXQ)`, ctx);
  assert.match(desc, /placeholder="Cuts, colour and styling for women and men in &lt;your town&gt;"/);
  assert.match(desc, /<label class="fld" for="ob-business_description">/);
  const rules = vm.runInContext(`obQuestionHtml("rules", CTXQ)`, ctx);
  assert.match(rules, /data-rex="0"/); assert.match(rules, /aria-label="Rule 1"/);
  // Copy rules (§9): questions ≤ 12 words, helper ≤ 20, never "please", no "!".
  const Q = vm.runInContext("OB_Q", ctx);
  for (const [k, q] of Object.entries(Q)) {
    assert.ok(q.q.split(/\s+/).length <= 12, `${k} question ≤ 12 words`);
    if (q.help) assert.ok(q.help.split(/\s+/).length <= 20, `${k} help ≤ 20 words`);
    assert.doesNotMatch(q.q + (q.help || ""), /please|!/i, `${k} copy`);
  }
  // Every chip is a button with aria-pressed.
  const chipsHtml = vm.runInContext(`obQuestionHtml("business_type", CTXQ)`, ctx);
  assert.equal((chipsHtml.match(/<button /g) || []).length, (chipsHtml.match(/aria-pressed=/g) || []).length);
});

test("price symbol follows onboarding-get's currency (round 2)", () => {
  for (const c of [undefined, null, "", "CAD", "USD", "AUD", "NZD", "cad"]) assert.equal(g(`obCurrencySymbol(${JSON.stringify(c ?? null)})`), "$", String(c));
  assert.equal(g('obCurrencySymbol("GBP")'), "£");
  assert.equal(g('obCurrencySymbol("EUR")'), "€");
  assert.equal(g('obCurrencySymbol("MXN")'), "MXN ");
  assert.equal(g('obCurrencySymbol("JPY")'), "JPY ");
  // The flow reads it from the get, after load, and the deposit hint carries it.
  const dom = slice("// ---- Onboarding flow (pure end)", "// ---- Onboarding flow (end)");
  assert.match(dom, /let currency = obCurrencySymbol\(null\);/);
  assert.match(dom, /currency = obCurrencySymbol\(F\.get\.currency\);/);
  assert.equal(g('obDepositHint("fixed", "£")'), "£ up front.");
  assert.equal(g('obDepositHint("percent", "£")'), "Percent of the job.");
  const html = vm.runInContext(`obQuestionHtml("hourly_rate", { picked: {}, answers: {}, editors: {}, suggestions: {}, currency: "EUR " })`, ctx);
  assert.match(html, /EUR  per hour, before tax\./);
});

test("onboarding-save's status wins; an older function without it means part-way (round 2)", () => {
  assert.equal(g('obStatusAfterSave("not_started", { status: "in_progress" })'), "in_progress");
  assert.equal(g('obStatusAfterSave("in_progress", { status: "complete" })'), "complete");
  assert.equal(g('obStatusAfterSave("not_started", { saved: true })'), "in_progress");
  assert.equal(g('obStatusAfterSave("complete", {})'), "complete");
  assert.equal(g('obStatusAfterSave("skipped", { status: "bogus" })'), "in_progress");
  assert.equal(g('obStatusAfterSave("in_progress", null)'), "in_progress");
  const dom = slice("// ---- Onboarding flow (pure end)", "// ---- Onboarding flow (end)");
  assert.match(dom, /F\.status = obStatusAfterSave\(F\.status, r\);/);
});

test("Home checklist step 1 opens the flow until onboarding is complete (round 2, Q1)", () => {
  assert.equal(g('obChecklistSection({ status: "not_started" })'), "about");
  assert.equal(g('obChecklistSection({ status: "in_progress", current_section: "money" })'), "money");
  assert.equal(g('obChecklistSection({ status: "in_progress", current_section: "nope" })'), "about");
  assert.equal(g('obChecklistSection({ status: "in_progress" })'), "about");
  assert.equal(g('obChecklistSection({ status: "skipped", current_section: "team" })'), null, "skipped → the profile sheet, as before");
  assert.equal(g('obChecklistSection({ status: "complete" })'), null);
  assert.equal(g('obChecklistSection(null)'), null); assert.equal(g('obChecklistSection({})'), null);
  // The handler itself: flow when a section comes back, the sheet otherwise; the rest of the checklist is untouched.
  const home = slice("async function loadHomeSetup()", "\n}\n");
  assert.match(home, /const section = obChecklistSection\(S\.profile\?\.onboarding\);\s*if \(section\) onboardingFlow\(\{ section, onDone: \(\) => \{ home\(\); drawBusinessTypeBanner\(\); \} \}\); else shopProfileSheet\(home\);/);
  assert.match(home, /const home = \(\) => \{ S\.cal = null; setTab\("home"\); \};/, "the sheet's onDone is what it was");
});

test("what onboarding-complete applied shows once, in the first-day sheet (round 2, Q3)", () => {
  assert.equal(g("obAppliedHtml([])"), ""); assert.equal(g("obAppliedHtml(null)"), ""); assert.equal(g('obAppliedHtml(["", "  "])'), "");
  const html = vm.runInContext(`obAppliedHtml(["Tax set to GST 5% for Alberta", "Payment terms: due on receipt", "<b>x</b>"])`, ctx);
  assert.match(html, /<b>Already set up from your answers<\/b>/);
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.match(html, /<li>Tax set to GST 5% for Alberta<\/li><li>Payment terms: due on receipt<\/li><li>&lt;b&gt;x&lt;\/b&gt;<\/li>/);
  const day = slice("function firstWorkingDaySheet(", "\n}\n");
  assert.match(day, /\$\{obAppliedHtml\(opts&&opts\.applied\)\}/);
  const dom = slice("// ---- Onboarding flow (pure end)", "// ---- Onboarding flow (end)");
  assert.match(dom, /firstWorkingDaySheet\(\{ applied: r\.applied \}\);/);
  assert.doesNotMatch(slice("async function loadHomeSetup()", "\n}\n"), /applied/, "never on Home");
});

console.log(`${passed} passed`);
