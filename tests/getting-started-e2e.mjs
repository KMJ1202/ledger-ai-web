// Playwright walk of the public "Getting started" page and its try-it preview (CONTRACT §7),
// at 390×844 and 1280×800 against a local static server — nothing leaves localhost.
//
//   node tests/getting-started-e2e.mjs
//   npx -y -p playwright@1.60.0 -c 'node tests/getting-started-e2e.mjs'
//
// Proves: zero console errors / page errors on the page and the home page (the only tolerated
// 404s are the eight app-onboarding-* clips/posters that arrive at merge), no request off
// localhost, no horizontal overflow, the phone menu shows "Getting started", every section's
// title / step / questions / chip labels equal tests/onboarding-copy.v1.json, Skip / Back /
// Continue / required type / Finish later → banner → Resume / confirm rows + Change / finish
// panel / Start over, one step keyboard-only, focus on the step title after each change. The
// fixed walk answers are exactly the "northside" set of tests/onboarding-text-fixture.v1.json
// (what the server modules render, saved by the foreman's oracle): the confirm recap equals that
// set's brief word for word, every #obunder line equals its understanding for the section, and
// the "What Ledger knows" card equals the port's brief for the sections answered so far; #obunder
// holds one line after Continue and is cleared by Back and Change (app.js show()).
// Env: SHOTS_DIR (default ./tests/getting-started-shots), PORT (default 4182), HEADED=1.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process"; import net from "node:net"; import vm from "node:vm";

async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  const cands = [];
  for (const p of (process.env.PATH || "").split(path.delimiter)) if (p.endsWith(path.join("node_modules", ".bin"))) cands.push(path.join(p, "..", "playwright", "index.mjs"));
  const npx = path.join(os.homedir(), ".npm", "_npx");
  try { for (const d of fs.readdirSync(npx)) cands.push(path.join(npx, d, "node_modules", "playwright", "index.mjs")); } catch {}
  const found = cands.filter((f) => fs.existsSync(f)).map((f) => ({ f, v: JSON.parse(fs.readFileSync(path.join(path.dirname(f), "package.json"), "utf8")).version }))
    .sort((a, b) => b.v.localeCompare(a.v, undefined, { numeric: true }));
  if (!found.length) { console.error("Playwright not found. Run: npx -y -p playwright@1.60.0 -c 'node tests/getting-started-e2e.mjs'"); process.exit(2); }
  return import(pathToFileURL(found[0].f).href);
}

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SHOTS = path.resolve(process.env.SHOTS_DIR || path.join(ROOT, "tests", "getting-started-shots"));
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = Number(process.env.PORT || 4182);
const BASE = `http://127.0.0.1:${PORT}`;
const W = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/onboarding-copy.v1.json"), "utf8"));
const COPY = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/getting-started-copy.v1.json"), "utf8"));
const SEC = Object.fromEntries(W.sections.map((s) => [s.id, s]));
const SH = W.shared;
const ORDER = ["about", "offer", "customers", "week", "money", "team", "ledger", "confirm"];
const MEDIA_404 = /\/assets\/video\/app-onboarding-(about|offer|confirm|firstday)\.(mp4|jpg)$/;
const VIEWPORTS = [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]];
// The truth: the server modules' output for the fixed answer sets (see the fixture's generated_by),
// and the page's port of those modules, loaded the way the page loads it.
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/onboarding-text-fixture.v1.json"), "utf8"));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "assets/onboarding-text.js"), "utf8"), { filename: "onboarding-text.js" });
const PORT_TEXT = globalThis.LedgerOnboardingText;
// The fixed answers the walk gives are exactly the fixture's northside set (chip values, not
// labels), as the server stores them: the price of the "Seasonal tire swap" example is changed
// to 85, the rule is typed. NS.input.sections is what the set was saved with; NS.answers is the
// server's normalized view (services carry ids) that the brief is rendered from.
const NS = FX.sets.northside;
const ANSWERS = NS.input.sections;
const WS = { name: NS.input.name, currency_code: NS.input.currency_code, timezone: NS.input.timezone };
// The brief for the sections answered so far: the normalized view restricted to those sections'
// keys (services keep the ids the server hands out), rendered by the port.
const expectBrief = (...sections) => {
  const keys = new Set(sections.flatMap((id) => Object.keys(ANSWERS[id])));
  return PORT_TEXT.brief(Object.fromEntries(Object.entries(NS.answers).filter(([k]) => keys.has(k))), WS);
};

let checks = 0, failures = 0;
const check = (ok, name, detail) => { checks++; if (ok) console.log("PASS", name); else { failures++; console.log("FAIL", name, detail !== undefined ? `— ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""); } };
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Static server: reuse one already on PORT (any server rooted at the repo), else start python's.
const portOpen = (port) => new Promise((res) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.end(); res(true); }); s.once("error", () => res(false)); });
let server = null;
if (!(await portOpen(PORT))) {
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 50 && !(await portOpen(PORT)); i++) await new Promise((r) => setTimeout(r, 100));
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: !process.env.HEADED });

for (const [name, vp] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, timezoneId: "America/Edmonton" });
  const page = await ctx.newPage();
  const errors = [], off = [], media404 = [];
  page.on("console", (m) => { if (m.type() === "error" && !MEDIA_404.test(m.location()?.url || "") && !/app-onboarding-/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("request", (r) => { const u = new URL(r.url()); if (!["localhost", "127.0.0.1"].includes(u.hostname)) off.push(r.url()); });
  page.on("response", (r) => { if (r.status() >= 400) (MEDIA_404.test(r.url()) ? media404 : errors).push(`HTTP ${r.status()} ${r.url()}`); });
  let n = 0;
  const file = (state) => path.join(SHOTS, `${name}-${String(++n).padStart(2, "0")}-${state}.png`);
  const shotView = async (state) => { await page.waitForTimeout(300); const f = file(state); await page.screenshot({ path: f }); console.log("shot", path.basename(f)); };
  // Whole-page and frame shots go through reduced-motion emulation: Chromium's beyond-viewport capture
  // renders the app's `obfade … both` entry animation as a blank frame; the copied reduced-motion rule
  // turns it off and the page looks exactly as it does with the animation finished.
  const shotFull = async (state) => {
    await page.waitForTimeout(300); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); await page.waitForTimeout(100);
    const f = file(state); await page.screenshot({ path: f, fullPage: true }); console.log("shot", path.basename(f));
    await page.emulateMedia({ reducedMotion: "no-preference" });
  };
  const shotFrame = async (state) => {
    await page.waitForTimeout(350); await page.emulateMedia({ reducedMotion: "reduce" });
    // Scroll to the top first: the sticky site header draws at the live scroll offset in a
    // beyond-viewport capture, so at scrollY 0 it stays out of the frame's clip.
    const b = await page.evaluate(() => { const y = scrollY; window.scrollTo({ top: 0, behavior: "instant" }); const r = document.querySelector(".gs-preview .phoneframe").getBoundingClientRect(); return { top: r.top + scrollY, h: r.height, y }; });
    await page.waitForTimeout(100);
    const f = file(state);
    await page.screenshot({ path: f, fullPage: true, clip: { x: 0, y: Math.max(0, b.top - 90), width: vp.width, height: b.h + 110 } });
    console.log("shot", path.basename(f));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), b.y);
  };
  const noOverflow = async (label) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: ${label} has no horizontal overflow`, await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
  const T = (sel) => page.locator(sel).first().textContent().then(norm);
  const pick = async (key, ...values) => { for (const v of values) await page.click(`[data-q="${key}"] .chip[data-v="${v}"]`); };
  // The brief as painted: obBriefHtml() makes one <p> per paragraph with <br> between lines.
  const briefText = (scope) => page.locator(`${scope} .obbrief p`).evaluateAll((ps) => ps.map((p) => p.innerText.replace(/\u00a0/g, " ")).join("\n\n"));
  const underLine = async (label) => {
    const u = page.locator("#obunder");
    const raw = await u.evaluate((el) => el.hidden ? null : el.textContent);
    check(raw !== null && raw.trim().length > 0 && !raw.includes("\n") && raw.length <= 140 && await u.locator("br, p, div").count() === 0, `${name}: ${label}: #obunder holds exactly one understanding line`, raw);
    return raw;
  };
  const underCleared = async (label) => check(await page.locator("#obunder").evaluate((el) => el.hidden && el.textContent === ""), `${name}: ${label}: #obunder is cleared and hidden`);
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}` : "none"; });

  // ---- The page ----
  await page.goto(`${BASE}${COPY.page.url}`, { waitUntil: "networkidle" });
  check(norm(await page.title()) === COPY.page.title, `${name}: document title`, await page.title());
  check(norm(await T("h1")) === COPY.page.hero_h1, `${name}: hero H1`, await T("h1"));
  await shotView("page-top");
  await noOverflow("page");
  check(await page.locator("#join h2").first().textContent().then(norm) === COPY.page.join_h2 && await T("#steps h2") === COPY.page.steps_h2 && await T("#try h2") === COPY.page.try_h2, `${name}: #join / #steps / #try headings`);
  const stepTitles = await page.locator("#steps h4").allTextContents();
  check(stepTitles.length === 7 && stepTitles.every((t, i) => norm(t) === SEC[ORDER[i]].title), `${name}: #steps titles equal the wording file`, stepTitles);
  check(await page.locator(".site.footer, footer.site").first().locator(`a[href="${COPY.page.url}"]`).count() === 1, `${name}: footer link to the page`);
  await page.waitForSelector("#obflow #obtitle");
  await page.waitForTimeout(400);
  await shotFull("page-full");

  // Navigation: phone menu at 390 must show "Getting started"; desktop Platform dropdown lists it first.
  await page.evaluate(() => window.scrollTo(0, 0));
  if (name === "phone") {
    await page.click("nav.sitenav .brand");
    await page.waitForTimeout(300);
    const link = page.locator(`nav.sitenav .menu a[href="${COPY.page.url}"]`).first();
    check(await page.locator("nav.sitenav.mopen").count() === 1 && await link.isVisible() && norm(await link.textContent()) === "Getting started", `${name}: phone menu opens and shows "Getting started"`, await link.textContent());
    await shotView("menu-open");
    await page.click("nav.sitenav .brand"); await page.waitForTimeout(200);
  } else {
    await page.click("nav.sitenav .drop > span");
    await page.waitForTimeout(300);
    const first = page.locator("nav.sitenav .drop.open .menu a").first();
    check(await first.getAttribute("href") === COPY.page.url && norm(await first.textContent()) === "Getting started" && await first.isVisible(), `${name}: Platform menu opens with "Getting started" first`, await first.textContent());
    await shotView("menu-open");
    await page.mouse.click(5, vp.height - 5); await page.waitForTimeout(200);
  }
  check(await page.locator(`nav.sitenav .menu a[href="${COPY.page.url}"]`).count() === 1, `${name}: exactly one nav entry`);

  // ---- The preview: About ----
  const frame = page.locator(".gs-preview");
  await frame.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  check(await page.getAttribute(".gs-preview", "aria-label") === COPY.page.try_frame_label, `${name}: frame section aria-label`);
  const screenBox = await page.locator(".gs-preview .gs-screen").boundingBox();
  check(Math.abs(screenBox.width / screenBox.height - 390 / 847) < 0.01, `${name}: frame keeps the 390/847 aspect`, screenBox);
  if (name === "phone") check(Math.round(screenBox.width) === 390, `${name}: frame fills the content width (390 = the app's width)`, screenBox.width);
  else check(Math.abs(screenBox.x + screenBox.width / 2 - vp.width / 2) < 2, `${name}: frame is centred`, screenBox);
  // The app draws at 390×847 and is scaled into the screen (like the clips), so the stage covers the screen exactly.
  const stage = await page.evaluate(() => { const st = document.querySelector(".gs-preview .gs-stage"); const r = st.getBoundingClientRect(); return { w: st.clientWidth, h: st.clientHeight, box: { width: r.width, height: r.height }, scale: getComputedStyle(st.parentElement).getPropertyValue("--gs-scale").trim() }; });
  check(stage.w === 390 && stage.h === 847, `${name}: stage is the app's 390×847 viewport`, stage);
  check(Math.abs(stage.box.width - screenBox.width) < 1 && Math.abs(stage.box.height - screenBox.height) < 1.5 && Math.abs(Number(stage.scale) - screenBox.width / 390) < 0.001, `${name}: stage scales to the screen (--gs-scale = width / 390)`, stage);
  const expectSection = async (id, label) => {
    const s = SEC[id];
    const title = await T("#obtitle"), step = await T("#obstep");
    check(title === (id === "confirm" ? SH.confirm_title : s.title) && step === (id === "confirm" ? SH.confirm_step : s.step), `${name}: ${label} shows "${s.title}" / "${s.step}"`, [title, step]);
    check(await page.locator("#obnext").textContent().then(norm) === (id === "confirm" ? SH.finish : SH.continue), `${name}: ${label} primary button label`);
    const i = ORDER.indexOf(id);
    check(await page.locator("#obback").isHidden() === (i === 0) && await T("#obback") === SH.back, `${name}: ${label} Back ${i === 0 ? "hidden" : "shown"}`);
    const canSkip = id !== "about" && id !== "confirm"; // obCanSkip in app.js: the required type can't be skipped
    check(await page.locator("#obskip").isHidden() === !canSkip && await T("#obskip") === SH.skip, `${name}: ${label} Skip for now ${canSkip ? "shown" : "hidden"}`);
    check(await T("#oblater") === SH.later, `${name}: ${label} Finish later`);
    check(await page.getAttribute(".obprog[role=progressbar]", "aria-valuenow") === String(id === "confirm" ? 7 : i + 1) && await page.getAttribute(".obprog", "aria-valuemax") === "7", `${name}: ${label} progress bar aria-valuenow ${id === "confirm" ? 7 : i + 1} of 7`);
    for (const q of s.questions || []) {
      const box = page.locator(`[data-q="${q.key === "deposit" ? "deposit_type" : q.key}"]`).first();
      const vis = await box.count() ? await box.isVisible() : false;
      if (["hourly_rate", "service_area", "deposit_value"].includes(q.key)) continue; // reveals, asserted where they are opened
      check(vis && norm(await box.locator("label.fld").first().textContent()) === q.question, `${name}: ${label} question "${q.question}"`, vis ? await box.locator("label.fld").first().textContent() : "not visible");
      if (q.options?.length) {
        const labels = (await box.locator(".chips .chip").allTextContents()).map(norm);
        check(labels.join("|") === q.options.map((o) => o.label).join("|"), `${name}: ${label} chips for ${q.key} equal the wording file`, labels);
        check((await box.locator(".chip[aria-pressed]").count()) === q.options.length, `${name}: ${label} ${q.key} chips are buttons with aria-pressed`);
      }
      if (q.kind === "text" || q.kind === "number" || q.kind === "region" || q.kind === "timezone") check(await page.locator(`label[for="ob-${q.key}"]`).count() === 1 && await page.locator(`#ob-${q.key}`).count() === 1, `${name}: ${label} ${q.key} input has a label`);
    }
  };
  await expectSection("about", "About");
  check(await page.evaluate(() => getComputedStyle(document.querySelector(".gs-preview .obflow")).lineHeight) === "normal", `${name}: frame uses app.html's line-height (normal), not the site body's 1.6`);
  check(await page.evaluate(() => document.querySelector(".obprog i").style.width) === "0%", `${name}: progress bar 0% wide on step 1 (as app.js computes)`);
  check(await focused() !== "h1#obtitle", `${name}: page load does not steal focus into the frame`, await focused());
  await shotFrame("about");
  // Required type: Continue without a kind of business.
  await page.click("#obnext"); await page.waitForTimeout(200);
  check(await T("#obnote") === SH.note_type_first && await T("#obtitle") === SEC.about.title, `${name}: Continue without a type shows note_type_first and stays on About`, await T("#obnote"));
  check(await focused() === "button", `${name}: focus moves to the first business type chip`, await focused());
  await shotFrame("about-note");
  const auto = SEC.about.questions[0].options[0];
  await page.click(`[data-q="business_type"] .chip:has-text("${auto.label}")`);
  check(await page.getAttribute(`[data-q="business_type"] .chip[data-v="${auto.value}"]`, "aria-pressed") === "true" && await page.locator('[data-q="business_type"] .chip[aria-pressed="true"]').count() === 1, `${name}: business type is single-select with aria-pressed`);
  check((await page.getAttribute("#ob-business_description", "placeholder") || "").length > 0, `${name}: description placeholder follows the type`, await page.getAttribute("#ob-business_description", "placeholder"));
  check(await page.getAttribute("#ob-business_description", "placeholder") === FX.suggestions.descriptions.automotive, `${name}: the placeholder is the server's description suggestion for automotive (fixture)`, await page.getAttribute("#ob-business_description", "placeholder"));
  await page.fill("#ob-business_description", ANSWERS.about.business_description);
  await pick("business_stage", ANSWERS.about.business_stage);
  await pick("team_size", ANSWERS.about.team_size);
  await page.selectOption("#ob-region_code", ANSWERS.about.region_code);
  check(await page.inputValue("#ob-timezone") === "America/Edmonton", `${name}: time zone defaults to the browser zone`, await page.inputValue("#ob-timezone"));
  await shotFrame("about-filled");
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("offer", "What you offer");
  await shotFrame("offer");
  check(await focused() === "h1#obtitle", `${name}: focus moves to the step title after Continue`, await focused());
  const under = await underLine("after Continue from About");
  check(under === NS.understanding.about, `${name}: the line is the server's understanding for About (fixture northside, one string, capped at 140)`, { got: under, want: NS.understanding.about });
  check(await page.evaluate(() => document.querySelector(".obprog i").style.width) === `${Math.round(100 / 7)}%`, `${name}: progress bar ${Math.round(100 / 7)}% wide on step 2`);

  // ---- Offer: services editor with per-type examples ----
  const ex = await page.locator("[data-ex]").allTextContents();
  check(ex.length === 8 && ex.every((t) => /·\s*\$\d+/.test(t)), `${name}: eight example services for the type with "$" prices`, ex);
  const exWant = FX.suggestions.services.automotive.map((s) => `${s.name} · $${s.price}`);
  check(ex.map(norm).join("|") === exWant.join("|"), `${name}: the example services are the server's suggestions for automotive (fixture)`, { got: ex.map(norm), want: exWant });
  // The set's two services are examples 1 and 5; the tire swap's example price (60) is changed to the set's 85.
  const exIdx = ANSWERS.offer.services.map((s) => FX.suggestions.services.automotive.findIndex((x) => x.name === s.name));
  check(exIdx.every((i) => i >= 0), `${name}: the set's services are among the example chips`, exIdx);
  for (const i of exIdx) await page.click(`[data-ex] >> nth=${i}`);
  const rows = await page.locator("[data-svced] .svcrow").count();
  check(rows >= 2, `${name}: picked examples become service rows`, rows);
  const rowVals = await page.locator("[data-svced] .svcrow").evaluateAll((els) => els.map((el) => [el.querySelector("[data-sn]").value, el.querySelector("[data-sp]").value, el.querySelector("[data-sd]").value]));
  check(rowVals[0][0] === ANSWERS.offer.services[0].name && rowVals[0][1] === "60" && rowVals[0][2] === "45" && rowVals[1][0] === ANSWERS.offer.services[1].name && rowVals[1][1] === "120" && rowVals[1][2] === "60", `${name}: the rows carry the examples' names, prices and minutes`, rowVals);
  await page.fill('[data-svced] .svcrow[data-i="0"] [data-sp]', String(ANSWERS.offer.services[0].price));
  // Hourly first (the rate reveals), then the set's flat pricing (it hides again and no rate is sent).
  await pick("pricing_model", "hourly");
  check(await page.locator('[data-q="hourly_rate"]').isVisible(), `${name}: hourly rate reveals for hourly pricing`);
  check(norm(await page.locator('[data-q="hourly_rate"] label.fld').textContent()) === SEC.offer.questions.find((q) => q.key === "hourly_rate").question, `${name}: hourly rate question text`);
  await pick("pricing_model", ANSWERS.offer.pricing_model);
  check(await page.locator('[data-q="hourly_rate"]').isHidden(), `${name}: hourly rate hides again for flat pricing`);
  await pick("quotes_first", String(ANSWERS.offer.quotes_first));
  await shotFrame("offer-filled");
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("customers", "Customers");
  const underOffer = await underLine("after Continue from What you offer");
  check(underOffer === NS.understanding.offer, `${name}: the line is the server's understanding for What you offer (fixture northside)`, { got: underOffer, want: NS.understanding.offer });
  await shotFrame("customers");

  // ---- Skip / Back ----
  await page.click("#obskip"); await page.waitForTimeout(250);
  await expectSection("week", "Your week (after Skip)");
  check(await T("#obunder") === "", `${name}: no understanding line after Skip`);
  check(await page.locator("[data-hrsed] .hourrow").count() === 7, `${name}: hours editor shows the app's default week`, await page.locator("[data-hrsed] .hourrow").count());
  await shotFrame("week-after-skip");
  await page.click("#obback"); await page.waitForTimeout(250);
  await expectSection("customers", "Back to Customers");
  await underCleared("after Back");
  const C = ANSWERS.customers;
  await pick("job_location", C.job_location); await pick("customer_mix", C.customer_mix); await pick("intake_channels", ...C.intake_channels);
  await pick("typical_job_length", C.typical_job_length); await pick("repeat_business", C.repeat_business);
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("week", "Your week");
  const underCust = await underLine("after Continue from Customers");
  check(underCust === NS.understanding.customers, `${name}: the line is the server's understanding for Customers (fixture northside)`, { got: underCust, want: NS.understanding.customers });
  // The set's week is the editor's default (Mon–Fri 8–5, Sat/Sun closed): assert it, leave it.
  const hoursNow = await page.locator("[data-hrsed] .hourrow").evaluateAll((els) => Object.fromEntries(els.map((el) => [el.dataset.hday, el.querySelector("[data-hon]").checked ? { open: el.querySelector("[data-hopen]").value, close: el.querySelector("[data-hclose]").value } : null])));
  check(JSON.stringify(hoursNow) === JSON.stringify(ANSWERS.week.business_hours), `${name}: the default week equals the set's business_hours`, hoursNow);
  await pick("after_hours", ANSWERS.week.after_hours); await pick("booking_lead", ANSWERS.week.booking_lead);
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("money", "Getting paid");
  const underWeek = await underLine("after Continue from Your week");
  check(underWeek === NS.understanding.week, `${name}: the line is the server's understanding for Your week (fixture northside)`, { got: underWeek, want: NS.understanding.week });
  await pick("payment_methods", ...ANSWERS.money.payment_methods); await pick("payment_terms_days", String(ANSWERS.money.payment_terms_days));
  // Percent first (the value reveals), then the set's "no deposit" (it hides again, value dropped).
  await pick("deposit_type", "percent");
  check(await page.locator('[data-q="deposit_value"]').isVisible(), `${name}: deposit value reveals for a percent deposit`);
  await page.fill("#ob-deposit_value", "25");
  await shotFrame("money-deposit");
  await pick("deposit_type", ANSWERS.money.deposit.type);
  check(await page.locator('[data-q="deposit_value"]').isHidden(), `${name}: deposit value hides again for no deposit`);
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("team", "Your team and tools");
  const underMoney = await underLine("after Continue from Getting paid");
  check(underMoney === NS.understanding.money, `${name}: the line is the server's understanding for Getting paid (fixture northside)`, { got: underMoney, want: NS.understanding.money });

  // ---- Finish later → banner with real counts → hide → Finish setup resumes ----
  await page.click("#oblater"); await page.waitForTimeout(300);
  const banner = await page.locator(".gs-preview .hbanner").innerText().then(norm);
  const expectTitle = SH.banner_title.replace("{done}", "5").replace("{total}", "7");
  check(banner.includes(expectTitle) && banner.includes(SH.banner_sub), `${name}: Finish later shows the banner with real counts (5 of 7)`, banner);
  check(await T("#biztypego") === SH.resume && await T("#biztypehide") === SH.banner_later, `${name}: banner buttons "${SH.resume}" / "${SH.banner_later}"`);
  await shotFrame("banner");
  await page.click("#biztypehide"); await page.waitForTimeout(250);
  const knows = await page.locator(".gs-home").innerText().then(norm);
  check(knows.startsWith(SH.knows_title.toUpperCase()) && await page.locator(".gs-home .panel.obknows").count() === 1, `${name}: Later shows the "${SH.knows_title}" card`, knows);
  const knowsBrief = await briefText(".gs-home");
  const knowsWant = expectBrief("about", "offer", "customers", "week", "money");
  check(knowsBrief === knowsWant && !knows.includes(SH.knows_empty), `${name}: the card shows the owner brief of what was answered so far (= the port's brief for those answers)`, { got: knowsBrief, want: knowsWant });
  check(knowsBrief.startsWith(NS.brief.split("\n\n").slice(0, 6).join("\n\n")) && !/Your team|Ledger will sound|Your rules/.test(knowsBrief), `${name}: the card holds the fixture brief's first six groups and nothing from the unanswered sections`, knowsBrief);
  check(await T("#knowfinish") === SH.finish_setup && await T("#knowupdate") === SH.update, `${name}: card buttons "${SH.finish_setup}" + "${SH.update}"`);
  await shotFrame("knows");
  await page.click("#knowupdate"); await page.waitForTimeout(250);
  await expectSection("about", "Update answers reopens About");
  check(await page.locator('[data-q="business_type"] .chip[aria-pressed="true"]').count() === 1 && await page.inputValue("#ob-business_description") === ANSWERS.about.business_description, `${name}: reopened About still holds the answers`);
  await page.click("#oblater"); await page.waitForTimeout(250);
  await page.click("#biztypehide"); await page.waitForTimeout(250);
  await page.click("#knowfinish"); await page.waitForTimeout(250);
  await expectSection("team", "Resumed at Your team and tools");
  await shotFrame("resumed");
  await page.click("#oblater"); await page.waitForTimeout(250);
  await page.click("#biztypego"); await page.waitForTimeout(250);
  await expectSection("team", "Resume from the banner");
  await underCleared("after Resume");
  await pick("wants_front_desk", String(ANSWERS.team.wants_front_desk));
  await pick("uses_quickbooks", String(ANSWERS.team.uses_quickbooks)); await pick("uses_google_calendar", String(ANSWERS.team.uses_google_calendar));

  // ---- Keyboard only: pick a chip and continue with Tab / Space / Enter ----
  await page.focus(`[data-q="team_roles"] .chip[data-v="${ANSWERS.team.team_roles[0]}"]`);
  await page.keyboard.press("Space");
  check(await page.getAttribute(`[data-q="team_roles"] .chip[data-v="${ANSWERS.team.team_roles[0]}"]`, "aria-pressed") === "true", `${name}: keyboard Space toggles a chip`);
  let hops = 0;
  while ((await focused()) !== "button#obnext" && hops < 40) { await page.keyboard.press("Tab"); hops++; }
  check(await focused() === "button#obnext", `${name}: Tab reaches Continue`, hops);
  await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  await expectSection("ledger", "How Ledger should work for you (keyboard)");
  check(await focused() === "h1#obtitle", `${name}: focus on the title after keyboard Continue`, await focused());
  const underTeam = await underLine("after keyboard Continue from Your team and tools");
  check(underTeam === NS.understanding.team, `${name}: the line is the server's understanding for Your team and tools (fixture northside)`, { got: underTeam, want: NS.understanding.team });
  const rex = await page.locator("[data-rex]").allTextContents();
  check(rex.length === 3, `${name}: three rule examples for the type`, rex);
  check(rex.map(norm).join("|") === FX.suggestions.rules.automotive.join("|"), `${name}: the rule examples are the server's suggestions for automotive (fixture)`, rex);
  await page.click("[data-rex] >> nth=0");
  check((await page.locator("[data-rulesbox] input").evaluateAll((els) => els.map((e) => e.value))).includes(norm(rex[0])), `${name}: picked rule example becomes a rule row`, await page.locator("[data-rulesbox] input").evaluateAll((els) => els.map((e) => e.value)));
  // The set's rule is the owner's own words, not an example: type it over the picked one.
  await page.fill('[data-rulesbox] [data-rule="0"]', ANSWERS.ledger.rules[0]);
  check((await page.locator("[data-rulesbox] input").evaluateAll((els) => els.map((e) => e.value).filter(Boolean))).join("|") === ANSWERS.ledger.rules.join("|"), `${name}: the rule row holds the set's rule`, ANSWERS.ledger.rules);
  await pick("ai_tone", ANSWERS.ledger.ai_tone); await pick("goals", ...ANSWERS.ledger.goals);
  await pick("autonomy", ...Object.entries(ANSWERS.ledger.autonomy).filter(([, on]) => on).map(([k]) => k));
  await shotFrame("ledger-rule");
  await page.keyboard.press("Tab");
  await page.click("#obnext"); await page.waitForTimeout(300);

  // ---- Confirm ----
  await expectSection("confirm", "Confirm");
  const rowsText = (await page.locator(".obrow").allInnerTexts()).map(norm);
  const expectRows = { about: SH.row_done, offer: SH.row_done, customers: SH.row_done, week: SH.row_done, money: SH.row_done, team: SH.row_done, ledger: SH.row_done };
  check(rowsText.length === 7 && ORDER.slice(0, 7).every((id, i) => rowsText[i].startsWith(SEC[id].title) && rowsText[i].includes(expectRows[id]) && rowsText[i].endsWith(SH.change)), `${name}: confirm lists seven rows with status + Change`, rowsText);
  const underLedger = await underLine("after Continue from How Ledger should work for you (confirm screen)");
  check(underLedger === NS.understanding.ledger, `${name}: the line is the server's understanding for How Ledger should work for you (fixture northside)`, { got: underLedger, want: NS.understanding.ledger });
  const recap = await briefText("#obqs");
  const recapWant = NS.brief;
  check(recap === recapWant, `${name}: confirm recap equals the fixture brief for northside word for word (what the server renders)`, { got: recap, want: recapWant });
  check(expectBrief(...ORDER.slice(0, 7)) === NS.brief, `${name}: the port renders the fixture brief for the full set (the card expectation above is built the same way)`);
  const groups = NS.brief.split("\n\n").length;
  check(await page.locator("#obqs .obbrief p").count() === groups && recap.split("\n\n").length === groups, `${name}: recap is ${groups} paragraphs, one per group, rendered like obBriefHtml()`, await page.locator("#obqs .obbrief p").count());
  check(!/Northside|KMJ|Got it|I'll/.test(recap), `${name}: recap holds only answered facts in the owner voice (no name, no understanding lines)`);
  await shotFrame("confirm");
  await page.click('[data-change="week"]'); await page.waitForTimeout(250);
  await expectSection("week", "Change → Your week");
  await underCleared("after Change");
  await page.click("#obskip"); await page.waitForTimeout(250);
  await expectSection("money", "after skipping week again");
  for (let i = 0; i < 3; i++) { await page.click("#obnext"); await page.waitForTimeout(200); }
  await expectSection("confirm", "Confirm again");
  const rows2 = (await page.locator(".obrow").allInnerTexts()).map(norm);
  check(rows2[3].includes(SH.row_skipped), `${name}: skipped section shows "${SH.row_skipped}"`, rows2[3]);
  check(await briefText("#obqs") === recapWant, `${name}: skipping a section again leaves its saved answers in the recap (as the server keeps them)`);
  await shotFrame("confirm-skipped");

  // ---- Finish → panel → Start over ----
  await page.click("#obnext"); await page.waitForTimeout(300);
  const panel = page.locator(".gs-preview .gs-panel");
  check(await panel.locator("h3").textContent().then(norm) === COPY.preview.done_h3 && (await panel.innerText().then(norm)).includes(COPY.preview.done_p), `${name}: finish panel text`, await panel.innerText());
  check(await panel.locator(`a.btn.primary[href="${COPY.preview.done_primary_href}"]`).textContent().then(norm) === COPY.preview.done_primary && await panel.locator("#gsrestart").textContent().then(norm) === COPY.preview.done_ghost, `${name}: finish panel buttons`);
  check(await focused() === "h3", `${name}: focus on the panel heading`, await focused());
  await shotFrame("finish");
  await page.click("#gsrestart"); await page.waitForTimeout(300);
  await expectSection("about", "Start over");
  check(await page.locator('[data-q="business_type"] .chip[aria-pressed="true"]').count() === 0 && await page.inputValue("#ob-business_description") === "", `${name}: Start over clears every answer`);
  await shotFrame("restart");

  // Nothing persisted, nothing off-host.
  check(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ""), `${name}: no localStorage / sessionStorage / cookies`);
  check(errors.length === 0, `${name}: page has zero console errors / page errors / non-media HTTP errors`, errors);
  check(off.length === 0, `${name}: page made no request off localhost`, off);
  check(media404.every((u) => MEDIA_404.test(u.replace(/^HTTP \d+ /, ""))), `${name}: only app-onboarding-* media 404 locally (${media404.length})`);
  await page.close();

  // ---- Home page ----
  const home = await ctx.newPage();
  const herr = [], hoff = [];
  home.on("console", (m) => { if (m.type() === "error" && !/app-onboarding-/.test(m.text() + (m.location()?.url || ""))) herr.push(m.text()); });
  home.on("pageerror", (e) => herr.push("pageerror: " + e.message));
  home.on("request", (r) => { const u = new URL(r.url()); if (!["localhost", "127.0.0.1"].includes(u.hostname)) hoff.push(r.url()); });
  home.on("response", (r) => { if (r.status() >= 400 && !MEDIA_404.test(r.url())) herr.push(`HTTP ${r.status()} ${r.url()}`); });
  await home.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const gs = home.locator("#getting-started");
  check(await gs.count() === 1 && await gs.locator("h2").textContent().then(norm) === COPY.home.h2, `${name}: home #getting-started block with H2`, await gs.locator("h2").textContent());
  check(await gs.locator(`a[href="${COPY.home.link_try_href}"]`).textContent().then(norm) === COPY.home.link_try && await gs.locator(`a[href="${COPY.home.cta_primary_href}"]`).textContent().then(norm) === COPY.home.cta_primary, `${name}: home block links`);
  check(await home.evaluate(() => { const a = document.querySelector("#getting-started"), b = document.querySelector("#platform"); return a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING && a.getBoundingClientRect().top < b.getBoundingClientRect().top; }), `${name}: home block sits before #platform`);
  check(await gs.locator(".cd-step").count() === 4 && (await gs.locator(".cd-title").allTextContents()).map(norm).join("|") === [1, 2, 3, 4].map((i) => COPY.footage[`${i}_title`]).join("|"), `${name}: home footage block has the four steps`);
  check((await home.locator("#first-week").innerText().then(norm)).includes(COPY.home.day1_new), `${name}: home Day 1 sentence`);
  check(await home.locator(`nav.sitenav .menu a[href="${COPY.page.url}"]`).count() === 1 && await home.locator(`footer.site a[href="${COPY.page.url}"]`).count() === 1, `${name}: home nav + footer entries`);
  check(await home.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: home has no horizontal overflow`);
  const hf = file("home-top"); await home.screenshot({ path: hf }); console.log("shot", path.basename(hf));
  // The site's scroll-reveal (nav.js: .phoneframe gets .sr until it scrolls into view) must have run
  // for the footage frame, so scroll through the block first; then the same sticky-header rule as
  // shotFrame: capture with the page scrolled to the top.
  await gs.locator(".phoneframe").scrollIntoViewIfNeeded(); await home.waitForTimeout(900);
  check(await gs.locator(".phoneframe").evaluate((el) => !el.classList.contains("sr") || el.classList.contains("srin")), `${name}: home footage frame revealed`);
  const hb = await home.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); const r = document.querySelector("#getting-started").getBoundingClientRect(); return { y: r.top + scrollY, height: r.height }; });
  await home.waitForTimeout(300);
  const hf2 = file("home-getting-started"); await home.screenshot({ path: hf2, fullPage: true, clip: { x: 0, y: hb.y - 8, width: vp.width, height: hb.height + 16 } }); console.log("shot", path.basename(hf2));
  check(herr.length === 0, `${name}: home has zero console errors / page errors`, herr);
  check(hoff.length === 0, `${name}: home made no request off localhost`, hoff);
  await home.close();
  await ctx.close();
}

await browser.close();
if (server) server.kill();
console.log(`shots in ${SHOTS}`);
console.log(`${checks - failures}/${checks} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
