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
// panel / Start over, one step keyboard-only, focus on the step title after each change.
// Env: SHOTS_DIR (default ./tests/getting-started-shots), PORT (default 4182), HEADED=1.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process"; import net from "node:net";

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
  await page.fill("#ob-business_description", "Tire shop with two bays");
  await page.click('[data-q="business_stage"] .chip >> nth=1');
  await page.click('[data-q="team_size"] .chip >> nth=1');
  check(await page.inputValue("#ob-timezone") === "America/Edmonton", `${name}: time zone defaults to the browser zone`, await page.inputValue("#ob-timezone"));
  await shotFrame("about-filled");
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("offer", "What you offer");
  await shotFrame("offer");
  check(await focused() === "h1#obtitle", `${name}: focus moves to the step title after Continue`, await focused());
  const under = await T("#obunder");
  check(under.length > 0 && under.length <= 140, `${name}: understanding line shown after Continue`, under);
  check(await page.evaluate(() => document.querySelector(".obprog i").style.width) === `${Math.round(100 / 7)}%`, `${name}: progress bar ${Math.round(100 / 7)}% wide on step 2`);

  // ---- Offer: services editor with per-type examples ----
  const ex = await page.locator("[data-ex]").allTextContents();
  check(ex.length === 8 && ex.every((t) => /·\s*\$\d+/.test(t)), `${name}: eight example services for the type with "$" prices`, ex);
  await page.click("[data-ex] >> nth=0"); await page.click("[data-ex] >> nth=2");
  const rows = await page.locator("[data-svced] .svcrow").count();
  check(rows >= 2, `${name}: picked examples become service rows`, rows);
  await page.click('[data-q="pricing_model"] .chip[data-v="hourly"]');
  check(await page.locator('[data-q="hourly_rate"]').isVisible(), `${name}: hourly rate reveals for hourly pricing`);
  check(norm(await page.locator('[data-q="hourly_rate"] label.fld').textContent()) === SEC.offer.questions.find((q) => q.key === "hourly_rate").question, `${name}: hourly rate question text`);
  await page.fill("#ob-hourly_rate", "120");
  await page.click('[data-q="quotes_first"] .chip >> nth=0');
  await shotFrame("offer-filled");
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("customers", "Customers");
  await shotFrame("customers");

  // ---- Skip / Back ----
  await page.click("#obskip"); await page.waitForTimeout(250);
  await expectSection("week", "Your week (after Skip)");
  check(await T("#obunder") === "", `${name}: no understanding line after Skip`);
  check(await page.locator("[data-hrsed] .hourrow").count() === 7, `${name}: hours editor shows the app's default week`, await page.locator("[data-hrsed] .hourrow").count());
  await shotFrame("week-after-skip");
  await page.click("#obback"); await page.waitForTimeout(250);
  await expectSection("customers", "Back to Customers");
  await page.click('[data-q="job_location"] .chip >> nth=0');
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("week", "Your week");
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("money", "Getting paid");
  await page.click('[data-q="deposit_type"] .chip[data-v="percent"]');
  check(await page.locator('[data-q="deposit_value"]').isVisible(), `${name}: deposit value reveals for a percent deposit`);
  await page.fill("#ob-deposit_value", "25");
  await shotFrame("money-deposit");
  await page.click("#obnext"); await page.waitForTimeout(250);
  await expectSection("team", "Your team and tools");

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
  const briefLines = await page.locator(".gs-home .obbrief p").allTextContents();
  check(briefLines.length >= 3 && !knows.includes(SH.knows_empty) && briefLines.some((l) => l.includes("$120")), `${name}: the card carries the brief of what was answered so far (not knows_empty)`, briefLines);
  check(await T("#knowfinish") === SH.finish_setup && await T("#knowupdate") === SH.update, `${name}: card buttons "${SH.finish_setup}" + "${SH.update}"`);
  await shotFrame("knows");
  await page.click("#knowupdate"); await page.waitForTimeout(250);
  await expectSection("about", "Update answers reopens About");
  check(await page.locator('[data-q="business_type"] .chip[aria-pressed="true"]').count() === 1 && await page.inputValue("#ob-business_description") === "Tire shop with two bays", `${name}: reopened About still holds the answers`);
  await page.click("#oblater"); await page.waitForTimeout(250);
  await page.click("#biztypehide"); await page.waitForTimeout(250);
  await page.click("#knowfinish"); await page.waitForTimeout(250);
  await expectSection("team", "Resumed at Your team and tools");
  await shotFrame("resumed");
  await page.click("#oblater"); await page.waitForTimeout(250);
  await page.click("#biztypego"); await page.waitForTimeout(250);
  await expectSection("team", "Resume from the banner");
  await page.click('[data-q="wants_front_desk"] .chip >> nth=0');

  // ---- Keyboard only: pick a chip and continue with Tab / Space / Enter ----
  await page.focus('[data-q="team_roles"] .chip >> nth=0');
  await page.keyboard.press("Space");
  check(await page.getAttribute('[data-q="team_roles"] .chip >> nth=0', "aria-pressed") === "true", `${name}: keyboard Space toggles a chip`);
  let hops = 0;
  while ((await focused()) !== "button#obnext" && hops < 40) { await page.keyboard.press("Tab"); hops++; }
  check(await focused() === "button#obnext", `${name}: Tab reaches Continue`, hops);
  await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  await expectSection("ledger", "How Ledger should work for you (keyboard)");
  check(await focused() === "h1#obtitle", `${name}: focus on the title after keyboard Continue`, await focused());
  const rex = await page.locator("[data-rex]").allTextContents();
  check(rex.length === 3, `${name}: three rule examples for the type`, rex);
  await page.click("[data-rex] >> nth=0");
  check((await page.locator("[data-rulesbox] input").evaluateAll((els) => els.map((e) => e.value))).includes(norm(rex[0])), `${name}: picked rule example becomes a rule row`, await page.locator("[data-rulesbox] input").evaluateAll((els) => els.map((e) => e.value)));
  await page.click('[data-q="ai_tone"] .chip >> nth=0');
  await shotFrame("ledger-rule");
  await page.keyboard.press("Tab");
  await page.click("#obnext"); await page.waitForTimeout(300);

  // ---- Confirm ----
  await expectSection("confirm", "Confirm");
  const rowsText = (await page.locator(".obrow").allInnerTexts()).map(norm);
  const expectRows = { about: SH.row_done, offer: SH.row_done, customers: SH.row_done, week: SH.row_done, money: SH.row_done, team: SH.row_done, ledger: SH.row_done };
  check(rowsText.length === 7 && ORDER.slice(0, 7).every((id, i) => rowsText[i].startsWith(SEC[id].title) && rowsText[i].includes(expectRows[id]) && rowsText[i].endsWith(SH.change)), `${name}: confirm lists seven rows with status + Change`, rowsText);
  const brief = await page.locator("#obqs").innerText().then(norm);
  check(brief.includes(SEC.about.questions[0].options[0].label) || /automotive|tire/i.test(brief), `${name}: confirm brief reflects the picked type`, brief.slice(0, 200));
  check(!/Northside|KMJ/.test(brief), `${name}: confirm brief contains only what was answered`);
  await shotFrame("confirm");
  await page.click('[data-change="week"]'); await page.waitForTimeout(250);
  await expectSection("week", "Change → Your week");
  await page.click("#obskip"); await page.waitForTimeout(250);
  await expectSection("money", "after skipping week again");
  for (let i = 0; i < 3; i++) { await page.click("#obnext"); await page.waitForTimeout(200); }
  await expectSection("confirm", "Confirm again");
  const rows2 = (await page.locator(".obrow").allInnerTexts()).map(norm);
  check(rows2[3].includes(SH.row_skipped), `${name}: skipped section shows "${SH.row_skipped}"`, rows2[3]);
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
