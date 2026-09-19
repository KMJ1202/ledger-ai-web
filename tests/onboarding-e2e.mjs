// Playwright walk through the sign-up onboarding (2026-09-19) against
// tests/onboarding-mock.mjs — every screen at 390×844 and 1280×800, one
// screenshot per screen, plus Home (tailored plan + first message), Settings
// ("What Ledger knows") and the resume banner.
//
//   node tests/onboarding-e2e.mjs                      (playwright resolvable from cwd)
//   npx -y -p playwright@1.60.0 -c 'node tests/onboarding-e2e.mjs'
//
// Env: SHOTS_DIR (where screenshots go; default os.tmpdir()/onboarding-shots),
//      HEADED=1 to watch. Playwright is dev-only — nothing here ships.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startMock } from "./onboarding-mock.mjs";

// The app repo has no package.json, so Playwright comes from whatever npx put
// on PATH (or an npx cache) — never from the app bundle.
async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  const cands = [];
  for (const p of (process.env.PATH || "").split(path.delimiter)) if (p.endsWith(path.join("node_modules", ".bin"))) cands.push(path.join(p, "..", "playwright", "index.mjs"));
  const npx = path.join(os.homedir(), ".npm", "_npx");
  try { for (const d of fs.readdirSync(npx)) cands.push(path.join(npx, d, "node_modules", "playwright", "index.mjs")); } catch {}
  const found = cands.filter((f) => fs.existsSync(f)).map((f) => ({ f, v: JSON.parse(fs.readFileSync(path.join(path.dirname(f), "package.json"), "utf8")).version }))
    .sort((a, b) => b.v.localeCompare(a.v, undefined, { numeric: true }));
  if (!found.length) { console.error("Playwright not found. Run: npx -y -p playwright@1.60.0 -c 'node tests/onboarding-e2e.mjs'"); process.exit(2); }
  return import(pathToFileURL(found[0].f).href);
}

const SHOTS = path.resolve(process.env.SHOTS_DIR || path.join(os.tmpdir(), "onboarding-shots"));
fs.mkdirSync(SHOTS, { recursive: true });
const VIEWPORTS = [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]];
const SECTIONS = ["about", "offer", "customers", "week", "money", "team", "ledger", "confirm"];
const TITLES = { about: "About your business", offer: "What you offer", customers: "Your customers and how work comes in", week: "Your week", money: "Getting paid", team: "Your team and tools", ledger: "How Ledger should work for you", confirm: "Here's what Ledger understands" };
// Short sections must fit without scrolling at 390×844 and keep the first
// input above a soft keyboard (≈320px on iOS).
const SHORT = ["about", "customers", "money", "team"];
const KEYBOARD = 320;

// The Supabase client from esm.sh is replaced with a stand-in: the preview
// boot never signs in, so the client only has to exist and stay quiet.
const SUPA_STUB = `
const quiet = { data: null, error: null };
const chain = new Proxy(function () {}, { get: (t, k) => k === "then" ? (res) => res(quiet) : () => chain, apply: () => chain });
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      exchangeCodeForSession: async () => ({ error: new Error("preview") }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }), listFactors: async () => ({ data: { totp: [], all: [] }, error: null }) },
    },
    from: () => chain, rpc: () => chain, channel: () => chain, removeChannel() {}, functions: { invoke: async () => quiet },
  };
}
export default { createClient };`;

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log(`FAIL ${msg}`); } };
const shotPaths = [];
async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  if (await page.$("#obbody")) {
    await page.$eval("#obbody", (b) => { if (b.contains(document.activeElement)) document.activeElement.blur(); });
    await page.waitForTimeout(350);
    await page.$eval("#obbody", (b) => { b.scrollTop = 0; });
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: file, fullPage: false });
  shotPaths.push(file);
  return file;
}

// Every text field on a short phone screen must sit above the keyboard once it
// has focus (the flow scrolls it there). Fields are focused one at a time, the
// way a thumb would, and measured after the scroll settles.
async function keyboardChecks(page, label, vp) {
  const fields = await page.$$eval("#obbody input:not([type=checkbox]):not([type=time]), #obbody textarea, #obbody select", (ns) => ns.filter((n) => !n.closest("[hidden]")).map((n) => n.id || n.name));
  for (const id of fields) {
    await page.focus(`#${id}`);
    await page.waitForTimeout(450); // smooth scroll
    const r = await page.$eval(`#${id}`, (n) => { const r = n.getBoundingClientRect(); const b = document.querySelector("#obbody").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, bodyTop: b.top }; });
    ok(r.top >= r.bodyTop - 1 && r.bottom <= vp.height - KEYBOARD, `${label}: #${id} sits above the keyboard when focused (${Math.round(r.top)}–${Math.round(r.bottom)}, safe < ${vp.height - KEYBOARD})`);
  }
  if (fields.length) await page.$eval("#obbody", (b) => { document.activeElement?.blur(); b.scrollTop = 0; });
  await page.waitForTimeout(100);
}

async function layoutChecks(page, label, section, vp, { revealed = false } = {}) {
  const m = await page.evaluate(({ short, KEYBOARD }) => {
    const el = document.getElementById("obflow");
    const body = el.querySelector("#obbody");
    const rect = (sel) => { const n = el.querySelector(sel); if (!n || n.hidden) return null; const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, visible: r.width > 0 && r.height > 0 }; };
    const under = el.querySelector("#obunder");
    const firstInput = body.querySelector("input:not([type=checkbox]):not([type=time]), textarea, select");
    const fr = firstInput ? firstInput.getBoundingClientRect() : null;
    return {
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      bodyScrollW: body.scrollWidth, bodyW: body.clientWidth, bodyScrollX: body.scrollLeft,
      bodyOverflow: (() => { const kb = body.classList.contains("kb"); body.classList.remove("kb"); const o = body.scrollHeight - body.clientHeight; if (kb) body.classList.add("kb"); return o; })(),
      next: rect("#obnext"), back: rect("#obback"), skip: rect("#obskip"), later: rect("#oblater"),
      underVisible: !under.hidden && under.textContent.trim().length > 0 && under.getBoundingClientRect().height > 0,
      underText: under.textContent.trim(),
      title: el.querySelector("#obtitle").textContent.trim(), step: el.querySelector("#obstep").textContent.trim(),
      firstInputTop: fr ? fr.top : null, firstInputTag: firstInput ? firstInput.tagName + (firstInput.id ? "#" + firstInput.id : "") : null,
      focusInFlow: el.contains(document.activeElement) && document.activeElement !== document.body,
      unlabelled: [...body.querySelectorAll("input, select, textarea, button")].filter((c) => !(c.labels && c.labels.length) && !c.getAttribute("aria-label") && !c.getAttribute("aria-labelledby") && !c.textContent.trim() && !c.closest("[role=group][aria-labelledby]")).length,
      chipsNoPressed: [...body.querySelectorAll(".chip")].filter((c) => c.tagName !== "BUTTON" || !c.hasAttribute("aria-pressed")).length,
    };
  }, { short: SHORT.includes(section), KEYBOARD });
  ok(m.scrollW <= m.innerW, `${label}: no horizontal overflow (${m.scrollW} > ${m.innerW})`);
  ok(m.bodyScrollW <= m.bodyW && m.bodyScrollX === 0, `${label}: questions fit the width (${m.bodyScrollW} > ${m.bodyW}, scrolled ${m.bodyScrollX})`);
  ok(m.title === TITLES[section], `${label}: title "${m.title}" is "${TITLES[section]}"`);
  ok(m.next && m.next.bottom <= vp.height && m.next.right <= vp.width, `${label}: Continue inside viewport`);
  if (m.skip) ok(m.skip.bottom <= vp.height, `${label}: Skip inside viewport`);
  ok(section === "about" ? !m.skip : section === "confirm" ? !m.skip : !!m.skip, `${label}: Skip for now ${section === "about" || section === "confirm" ? "absent" : "present"}`);
  ok(section === "about" ? !m.back : !!m.back, `${label}: Back ${section === "about" ? "absent" : "present"}`);
  ok(m.unlabelled === 0, `${label}: every control labelled (${m.unlabelled} without)`);
  ok(m.chipsNoPressed === 0, `${label}: chips are buttons with aria-pressed`);
  ok(m.focusInFlow, `${label}: focus moved into the flow (${m.firstInputTag || "no input"})`);
  if (vp.width === 390 && SHORT.includes(section)) {
    // First paint must fit. A conditional reveal may push the screen into a
    // scroll; then the revealed field has to be on screen, which
    // keyboardChecks proves.
    if (revealed) { if (m.bodyOverflow > 0) console.log(`note ${label}: body scrolls by ${m.bodyOverflow}px after the reveal`); }
    else ok(m.bodyOverflow <= 0, `${label}: nothing below the fold (body overflows by ${m.bodyOverflow}px)`);
    await keyboardChecks(page, label, vp);
  }
  return m;
}

// A chip tap must register even right after typing in a field (the keyboard
// room goes away and the layout shifts); every pick is verified.
async function chip(page, key, v) {
  const sel = `[data-q="${key}"] .chip[data-v="${v}"]`;
  await page.click(sel);
  const pressed = await page.$eval(sel, (c) => c.getAttribute("aria-pressed"));
  ok(pressed === "true", `chip ${key}=${v} registered (aria-pressed=${pressed})`);
}
const fill = (page, id, v) => page.fill(`#ob-${id}`, String(v));
async function next(page, expectSection) {
  await page.click("#obnext");
  await page.waitForFunction((t) => document.querySelector("#obtitle")?.textContent.trim() === t && !document.querySelector("#obnext").disabled, TITLES[expectSection]);
  await page.waitForTimeout(500); // understanding fade-in, focus frame
}

// One full pass through the eight screens for a viewport.
async function walk(browser, name, vp, mock) {
  await fetch(`${mock.url}/__mock/reset`, { method: "POST", body: JSON.stringify({ scenario: "fresh" }) });
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 700, hasTouch: vp.width < 700, reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("https://esm.sh/**", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: SUPA_STUB }));
  await page.goto(`${mock.url}/app.html?onboardingPreview=1&scenario=firstrun`);
  await page.waitForSelector("#obflow [data-q='business_type'] .chip", { timeout: 15000 });
  await page.waitForTimeout(400);
  const label = (s) => `${name} ${s}`;
  // The keyboard-room behaviour keys off (pointer: coarse); the phone context must look like a phone.
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  ok(coarse === (vp.width < 700), `${label("boot")}: pointer is ${vp.width < 700 ? "coarse" : "fine"} (${coarse})`);
  const shots = {};

  // 1 about — Skip must be absent; Continue without a type is refused.
  await layoutChecks(page, label("about"), "about", vp);
  await page.click("#obnext");
  ok(await page.$eval("#obnote", (n) => !n.hidden && /kind of business/.test(n.textContent)), `${label("about")}: Continue without a type shows the note`);
  ok(await page.$eval("#obnote", (n) => { const r = n.getBoundingClientRect(); return r.height > 0 && r.bottom <= innerHeight; }), `${label("about")}: the note is on screen`);
  await layoutChecks(page, label("about (note showing)"), "about", vp, { revealed: true });
  await chip(page, "business_type", "trades");
  await fill(page, "business_description", "Plumbing and heating repairs around Red Deer");
  await chip(page, "business_stage", "growing");
  await chip(page, "team_size", "small");
  await page.selectOption("#ob-region_code", "AB");
  ok(await page.$eval('[data-q="business_description"] input', (i) => i.placeholder.length > 0), `${label("about")}: description placeholder comes from suggestions`);
  shots.about = await shot(page, `${name}-1-about`);
  await next(page, "offer");

  // 2 offer — understanding line shown; example chip adds a service; hourly rate appears for hourly.
  let m = await layoutChecks(page, label("offer"), "offer", vp);
  ok(m.underVisible, `${label("offer")}: understanding line visible after Continue ("${m.underText}")`);
  ok(await page.$eval('[data-q="hourly_rate"]', (n) => n.hidden), `${label("offer")}: hourly rate hidden before pricing picked`);
  ok(await page.$eval(".obex .chip", (c) => c.title === "example — change it" && c.getAttribute("aria-pressed") === "false"), `${label("offer")}: suggestion chips are examples`);
  ok(await page.$eval('[data-q="services"] label', (n) => n.textContent.trim() === "What do you sell or do?"), `${label("offer")}: services question reads "What do you sell or do?"`);
  await page.click(".obex .chip[data-ex='0']");
  await page.click(".obex .chip[data-ex='1']");
  ok(await page.$$eval("[data-svcbox] [data-sn]", (ns) => ns.filter((n) => n.value).length === 2), `${label("offer")}: two example services added`);
  await chip(page, "pricing_model", "hourly");
  ok(await page.$eval('[data-q="hourly_rate"]', (n) => !n.hidden), `${label("offer")}: hourly rate shown for hourly`);
  await fill(page, "hourly_rate", 95);
  ok(await page.$eval('[data-q="hourly_rate"] .qhelp', (n) => n.textContent.trim() === "$ per hour, before tax."), `${label("offer")}: price symbol comes from onboarding-get's currency (CAD → $)`);
  await chip(page, "quotes_first", "true");
  shots.offer = await shot(page, `${name}-2-offer`);
  await next(page, "customers");

  // 3 customers — service area appears only for customer_place / both.
  m = await layoutChecks(page, label("customers"), "customers", vp);
  ok(m.underVisible, `${label("customers")}: understanding line visible ("${m.underText}")`);
  ok(await page.$eval('[data-q="service_area"]', (n) => n.hidden), `${label("customers")}: service area hidden at first`);
  await chip(page, "customer_mix", "individuals");
  await chip(page, "intake_channels", "phone"); await chip(page, "intake_channels", "text");
  await chip(page, "job_location", "customer_place");
  ok(await page.$eval('[data-q="service_area"]', (n) => !n.hidden), `${label("customers")}: service area shown for customer_place`);
  await fill(page, "service_area", "Within 40 km of Red Deer");
  await chip(page, "typical_job_length", "1_3h");
  await chip(page, "repeat_business", "both");
  await layoutChecks(page, label("customers (all shown)"), "customers", vp, { revealed: true });
  shots.customers = await shot(page, `${name}-3-customers`);
  await next(page, "week");

  // 4 week — hours editor defaults to Mon–Fri; Sat opens via the toggle.
  m = await layoutChecks(page, label("week"), "week", vp);
  ok(m.underVisible, `${label("week")}: understanding line visible ("${m.underText}")`);
  ok(await page.$$eval("[data-hon]:checked", (c) => c.length === 5), `${label("week")}: hours default to five open days`);
  await page.check("[data-hon='sat']");
  await page.fill("[data-hclose='sat']", "13:00");
  await chip(page, "after_hours", "text_back");
  await chip(page, "booking_lead", "next_day");
  shots.week = await shot(page, `${name}-4-week`);
  await next(page, "money");

  // 5 money — deposit value appears only for percent / fixed.
  m = await layoutChecks(page, label("money"), "money", vp);
  ok(m.underVisible, `${label("money")}: understanding line visible ("${m.underText}")`);
  await chip(page, "payment_methods", "etransfer"); await chip(page, "payment_methods", "card");
  await chip(page, "payment_terms_days", "7");
  ok(await page.$eval('[data-q="deposit_value"]', (n) => n.hidden), `${label("money")}: deposit amount hidden until a type is picked`);
  await chip(page, "deposit_type", "percent");
  ok(await page.$eval('[data-q="deposit_value"]', (n) => !n.hidden), `${label("money")}: deposit amount shown for percent`);
  await fill(page, "deposit_value", 25);
  await layoutChecks(page, label("money (all shown)"), "money", vp, { revealed: true });
  shots.money = await shot(page, `${name}-5-money`);
  await next(page, "team");

  // 6 team — team_roles visible (team_size small); Back keeps answers.
  m = await layoutChecks(page, label("team"), "team", vp);
  ok(m.underVisible, `${label("team")}: understanding line visible ("${m.underText}")`);
  ok(await page.$eval('[data-q="team_roles"]', (n) => !n.hidden), `${label("team")}: team roles shown for a 2–5 team`);
  await chip(page, "team_roles", "field_crew");
  await chip(page, "wants_front_desk", "true");
  await chip(page, "uses_quickbooks", "false");
  await chip(page, "uses_google_calendar", "true");
  await page.click("#obback");
  await page.waitForFunction((t) => document.querySelector("#obtitle")?.textContent.trim() === t, TITLES.money);
  ok(await page.$eval("#ob-deposit_value", (i) => i.value === "25"), `${label("team")}: Back keeps the deposit typed on Money`);
  await page.click("#obnext");
  await page.waitForFunction((t) => document.querySelector("#obtitle")?.textContent.trim() === t && !document.querySelector("#obnext").disabled, TITLES.team);
  await page.waitForTimeout(300);
  ok(await page.$eval('[data-q="wants_front_desk"] .chip[data-v="true"]', (c) => c.getAttribute("aria-pressed") === "true"), `${label("team")}: forward again keeps the Team picks`);
  shots.team = await shot(page, `${name}-6-team`);
  await next(page, "ledger");

  // 7 ledger — rule example fills the first row; goals cap at three; autonomy chips.
  m = await layoutChecks(page, label("ledger"), "ledger", vp);
  ok(m.underVisible, `${label("ledger")}: understanding line visible ("${m.underText}")`);
  await chip(page, "ai_tone", "friendly");
  await chip(page, "goals", "more_bookings"); await chip(page, "goals", "get_paid_faster"); await chip(page, "goals", "less_admin");
  await page.click('[data-q="goals"] .chip[data-v="better_reviews"]');
  ok(await page.$eval("#obnote", (n) => !n.hidden && /Up to 3/.test(n.textContent)), `${label("ledger")}: fourth goal refused with a note`);
  await page.click("[data-rex='0']");
  ok(await page.$eval("[data-rule='0']", (i) => i.value.length > 0), `${label("ledger")}: rule example filled the first row`);
  await chip(page, "autonomy", "reminders");
  shots.ledger = await shot(page, `${name}-7-ledger`);
  await next(page, "confirm");

  // 8 confirm — brief, Change links, no Skip; Change jumps and Continue returns.
  await page.waitForSelector("#obflow .obbrief p", { timeout: 10000 });
  m = await layoutChecks(page, label("confirm"), "confirm", vp);
  ok(m.underVisible, `${label("confirm")}: understanding line visible ("${m.underText}")`);
  ok(!/Step \d/.test(m.step) && m.step.length > 0, `${label("confirm")}: confirm is not counted as a step ("${m.step}")`);
  ok(await page.$eval("#obnext", (b) => b.textContent.trim() === "Looks right — finish"), `${label("confirm")}: primary button reads "Looks right — finish"`);
  ok(await page.$$eval("[data-change]", (b) => b.length === 7), `${label("confirm")}: seven Change links`);
  const briefText = await page.$eval(".obbrief", (n) => n.textContent);
  ok(/trades/i.test(briefText) && /\$95/.test(briefText) && /25%/.test(briefText), `${label("confirm")}: brief carries type, rate and deposit`);
  shots.confirm = await shot(page, `${name}-8-confirm`);
  await page.click("[data-change='week']");
  await page.waitForFunction((t) => document.querySelector("#obtitle")?.textContent.trim() === t, TITLES.week);
  ok(await page.$eval("[data-hon='sat']", (c) => c.checked), `${label("confirm")}: Change → Your week shows Saturday still open`);
  await next(page, "money"); await next(page, "team"); await next(page, "ledger"); await next(page, "confirm");
  await page.waitForSelector("#obflow .obbrief p", { timeout: 10000 });

  // Finish → Home, chat opens with the tailored first line, plan card shows.
  await page.click("#obnext");
  await page.waitForFunction(() => !document.getElementById("obflow") && document.getElementById("chatwrap")?.classList.contains("open"), null, { timeout: 15000 });
  await page.waitForSelector("#setupplan", { timeout: 10000 });
  await page.waitForTimeout(600);
  const st = await (await fetch(`${mock.url}/__mock/state`)).json();
  ok(st.status === "complete", `${label("finish")}: mock status complete`);
  const chat = await page.$eval("#chatwrap", (n) => n.textContent);
  const firstMsg = await page.evaluate(() => [...document.querySelectorAll("#chatwrap .sys, #chatwrap [class*=sys]")].map((n) => n.textContent.trim()));
  ok(firstMsg.some((t) => t.includes(st.answers.business_type === "trades" ? "trades" : "")) && !/🎉/.test(chat), `${label("finish")}: first_message replaces the generic 🎉 line`);
  ok(await page.$eval("#first-steps", (n) => /You said you miss calls/.test(n.textContent)), `${label("finish")}: first-day sheet shows the plan detail lines`);
  ok(await page.$eval("#sheetwrap", (n) => { const a = n.querySelector(".obapplied"); return !!a && /Already set up from your answers/.test(a.textContent) && a.querySelectorAll("li").length === 2 && /Tax set to GST 5% for Alberta/.test(a.textContent) && /Hours saved/.test(a.textContent) && a.nextElementSibling?.id === "first-steps"; }), `${label("finish")}: "Already set up from your answers" lists what onboarding-complete applied, under the intro`);
  ok(await page.$$eval("#sheetwrap .btn[data-plan]", (bs) => bs.length > 0 && bs.every((b) => b.className === "btn wide")), `${label("finish")}: plan steps use the sheet's own "btn wide" row style (base 9e35ebd)`);
  shots.finish = await shot(page, `${name}-9-finish-plan-sheet`);
  // Close the first-day sheet and the chat (Escape closes the top layer) to see the plan on Home.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("sheetwrap"));
  await page.waitForTimeout(300);
  shots.chat = await shot(page, `${name}-9b-chat-first-message`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("chatwrap")?.classList.contains("open"));
  await page.waitForTimeout(300);
  const plan = await page.$$eval("#setupplan [data-plan]", (b) => b.map((x) => x.dataset.plan));
  ok(plan.length >= 3, `${label("home")}: plan card has ${plan.length} actions (${plan.join(", ")})`);
  ok(plan.includes("phone_front_desk"), `${label("home")}: front desk step in the plan (wants_front_desk)`);
  ok(await page.$eval("#setupplan", (n) => /Needs:/.test(n.textContent)), `${label("home")}: a step shows its prerequisite`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label("home")}: no horizontal overflow`);
  shots.home = await shot(page, `${name}-10-home-plan`);

  // Business profile & settings (businessSheet): "What Ledger knows" with Update answers.
  await page.click("#bizsettings");
  await page.waitForSelector("#knowslot .obbrief", { timeout: 10000 });
  await page.waitForTimeout(300);
  ok(await page.$eval("#knowslot", (n) => /Update answers/.test(n.textContent) && !/Finish setup/.test(n.textContent)), `${label("settings")}: What Ledger knows shows Update answers only when complete`);
  // Bring the panel on screen so the shot is evidence of it, not of the rows above it.
  await page.$eval("#knowslot", (n) => (n.previousElementSibling || n).scrollIntoView({ block: "start" }));
  await page.waitForTimeout(150);
  shots.settings = await shot(page, `${name}-11-settings-knows`);
  await page.click("#knowslot button:has-text('Update answers')");
  await page.waitForSelector("#obflow [data-q='business_type'] .chip.on", { timeout: 10000 });
  ok(await page.$eval("#obtitle", (n, t) => n.textContent.trim() === t, TITLES.about), `${label("settings")}: Update answers opens the flow at About`);
  ok(await page.$eval('[data-q="business_type"] .chip[data-v="trades"]', (c) => c.getAttribute("aria-pressed") === "true"), `${label("settings")}: saved answers are pre-picked`);
  await page.click("#oblater");
  await page.waitForFunction(() => !document.getElementById("obflow"));

  // Resume: reload with the in-progress scenario → banner "3 of 7 done" + Resume opens at Your week.
  await fetch(`${mock.url}/__mock/reset`, { method: "POST", body: JSON.stringify({ scenario: "in_progress" }) });
  await page.goto(`${mock.url}/app.html?onboardingPreview=1`);
  await page.waitForSelector("#obflow", { timeout: 15000 });
  await page.waitForFunction((t) => document.querySelector("#obtitle")?.textContent.trim() === t, TITLES.week, { timeout: 10000 });
  await page.waitForTimeout(300);
  ok(await page.$eval("#obstep", (n) => n.textContent.trim() === "Step 4 of 7"), `${label("resume")}: boot resumes at Your week (Step 4 of 7)`);
  shots.resume = await shot(page, `${name}-12-resume-week`);
  await page.click("#oblater");
  await page.waitForFunction(() => !document.getElementById("obflow"));
  await page.waitForSelector("#biztypebanner", { timeout: 10000 });
  ok(await page.$eval("#biztypebanner", (n) => /Finish telling Ledger about your business — 3 of 7 done/.test(n.textContent) && /Resume/.test(n.textContent)), `${label("resume")}: banner reads 3 of 7 done with Resume`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label("resume")}: banner no horizontal overflow`);
  shots.banner = await shot(page, `${name}-13-home-resume-banner`);
  await page.click("#biztypego");
  await page.waitForFunction((t) => document.querySelector("#obtitle")?.textContent.trim() === t, TITLES.week, { timeout: 10000 });
  ok(true, `${label("resume")}: Resume opens the flow at Your week`);
  // Skip for now on Your week moves on without saving hours.
  await page.click("#obskip");
  await page.waitForFunction((t) => document.querySelector("#obtitle")?.textContent.trim() === t && !document.querySelector("#obnext").disabled, TITLES.money);
  const st2 = await (await fetch(`${mock.url}/__mock/state`)).json();
  ok(st2.sections.week?.skipped === true && st2.answers.business_hours == null, `${label("resume")}: Skip for now marks the section skipped and saves nothing`);
  ok(await page.$eval("#obunder", (n) => n.hidden), `${label("resume")}: no understanding line after a skip`);
  ok((await (await fetch(`${mock.url}/__mock/state`)).json()).status === "in_progress", `${label("resume")}: mock status in_progress after the skip`);
  // Finish later on a part-way run → skipped → Home's checklist step 1 opens the profile sheet, as before (round 2, Q1).
  await page.click("#oblater");
  await page.waitForFunction(() => !document.getElementById("obflow"));
  await page.waitForSelector("#setupshop", { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById("biztypebanner"), null, { timeout: 10000 });
  await page.click("#setupshop");
  await page.waitForSelector("#sheetwrap .sheet", { timeout: 10000 });
  ok(!(await page.$("#obflow")), `${label("checklist")}: skipped run → Start opens the profile sheet, not the flow`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("sheetwrap"));
  // A run not yet started → Start opens the flow at About; Finish later keeps it not started, so Start opens the flow again.
  await fetch(`${mock.url}/__mock/reset`, { method: "POST", body: JSON.stringify({ scenario: "fresh" }) });
  await page.goto(`${mock.url}/app.html?onboardingPreview=1`);
  await page.waitForSelector("#setupshop", { timeout: 15000 });
  ok(!(await page.$("#obflow")), `${label("checklist")}: not started → no auto-resume, Home shows the checklist`);
  await page.click("#setupshop");
  await page.waitForSelector("#obflow", { timeout: 10000 });
  await page.waitForFunction((t) => document.querySelector("#obtitle")?.textContent.trim() === t && !document.querySelector("#obnext").disabled, TITLES.about, { timeout: 10000 });
  ok(await page.$eval("#obstep", (n) => n.textContent.trim() === "Step 1 of 7"), `${label("checklist")}: not started → Start opens the flow at About (Step 1 of 7)`);
  shots.checklist = await shot(page, `${name}-14-checklist-start-flow`);
  await page.click("#oblater");
  await page.waitForFunction(() => !document.getElementById("obflow"));
  await page.waitForSelector("#setupshop", { timeout: 10000 });
  await page.click("#setupshop");
  await page.waitForSelector("#obflow", { timeout: 10000 });
  ok(await page.$eval("#obstep", (n) => n.textContent.trim() === "Step 1 of 7"), `${label("checklist")}: Finish later before any answer keeps it not started — Start opens the flow again`);
  await page.click("#oblater");
  await page.waitForFunction(() => !document.getElementById("obflow"));

  const realErrors = errors.filter((e) => !/favicon|manifest|404/.test(e));
  ok(realErrors.length === 0, `${label("console")}: no page errors (${realErrors.slice(0, 3).join(" | ")})`);
  await ctx.close();
  return shots;
}

const { chromium } = await loadPlaywright();
const mock = await startMock({ scenario: "fresh" });
const browser = await chromium.launch({ headless: !process.env.HEADED });
const all = {};
try {
  for (const [name, vp] of VIEWPORTS) all[name] = await walk(browser, name, vp, mock);
} finally {
  await browser.close();
  mock.server.close();
}
for (const [name, shots] of Object.entries(all)) for (const [screen, file] of Object.entries(shots)) console.log(`shot ${name} ${screen}: ${file}`);
console.log(`${checks - failures}/${checks} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
