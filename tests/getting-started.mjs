// Run from this repository: node tests/getting-started.mjs
// Static proofs for the "Getting started" page lane (CONTRACT §7): every contract string in
// tests/getting-started-copy.v1.json is in the built HTML/JS, all sitenav pages carry exactly one
// Platform-menu entry and one footer link, the seven step titles equal the wording file, the
// published wording copy is byte-identical, the sitemap lists the page, and app.js / app.html /
// sw.js are untouched since the base commit. Plain node, no browser, no deps.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const COPY = JSON.parse(read("tests/getting-started-copy.v1.json"));
const WORDING = JSON.parse(read("tests/onboarding-copy.v1.json"));
const BASE = process.env.GS_BASE_COMMIT || "6b69ef2";

let checks = 0, failures = 0;
const check = (ok, name, detail) => { checks++; if (ok) console.log("PASS", name); else { failures++; console.log("FAIL", name, detail ? `— ${detail}` : ""); } };
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const count = (hay, needle) => hay.split(needle).length - 1;
const has = (html, s) => html.includes(s) || text(html).includes(s);

// (a) The wording file the preview fetches is the canonical copy, byte for byte.
check(fs.readFileSync(path.join(ROOT, "assets/onboarding-copy.v1.json")).equals(fs.readFileSync(path.join(ROOT, "tests/onboarding-copy.v1.json"))),
  "assets/onboarding-copy.v1.json is byte-identical to tests/onboarding-copy.v1.json");

// (b) Every page with the shared nav: one menu entry (first in the Platform menu) and one footer link, before /features/ai/.
const pages = execFileSync("git", ["ls-files", "*.html", "**/*.html"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean)
  .filter((p) => read(p).includes('<nav class="sitenav"'));
check(pages.length >= 18, `${pages.length} pages carry <nav class="sitenav"> (17 existing + the new page)`, pages.join(", "));
for (const p of pages) {
  const html = read(p);
  const menu = html.slice(html.indexOf('<nav class="sitenav"'), html.indexOf("</nav>"));
  const footAt = html.indexOf('<footer class="site"');
  const foot = html.slice(footAt, html.indexOf("</footer>", footAt));
  const firstInMenu = (() => { const drop = menu.indexOf(COPY.nav.menu_entry); const ai = menu.indexOf('href="/features/ai/"'); return drop > 0 && ai > drop && !/<a [^>]*href="\/features\/[^"]*"/.test(menu.slice(menu.indexOf("<div class=\"menu\""), drop).replace(/<a [^>]*class="brand"[^>]*>/, "")); })();
  check(count(menu, COPY.nav.menu_entry) === 1 && firstInMenu, `${p}: Platform menu has the §2 entry exactly once, first`);
  const fi = foot.indexOf(COPY.nav.footer_link), ai = foot.indexOf(`href="${COPY.nav.footer_before}"`);
  check(count(foot, COPY.nav.footer_link) === 1 && fi > 0 && ai > fi, `${p}: footer has the Getting started link exactly once, before ${COPY.nav.footer_before}`);
  check(count(html, 'href="/features/getting-started/"') === 2 || p === "index.html" || p === "features/getting-started/index.html",
    `${p}: exactly two links to the page (nav + footer)`, `${count(html, 'href="/features/getting-started/"')} found`);
}

// (c) The new page: head, hero, join, steps, try, closing — every string from the fixture.
const page = read("features/getting-started/index.html");
check(page.includes(`<title>${COPY.page.title}</title>`), "page <title>");
check(page.includes(`<meta name="description" content="${COPY.page.meta_description}">`), "page meta description");
check(page.includes(`<link rel="canonical" href="${COPY.page.canonical}">`), "page canonical");
for (const [k, v] of Object.entries(COPY.page)) {
  if (/_href$|^url$|^title$|^meta_description$|^canonical$/.test(k)) continue;
  check(has(page, v), `page string ${k}`, JSON.stringify(v));
}
check(/<h1>Set up Ledger in <span class="grad"[^>]*#2fe0a0[^>]*#3ac8f5[^>]*>seven short steps\.<\/span><\/h1>/.test(page), "hero H1 gradient span (#2fe0a0 → #3ac8f5) on \"seven short steps.\"");
check(page.includes(`<a class="btn primary" href="${COPY.page.cta_primary_href}">${COPY.page.cta_primary}</a>`), "hero primary button → /app.html?signup=1");
check(page.includes(`<a class="btn ghost" href="${COPY.page.cta_ghost_href}">${COPY.page.cta_ghost}</a>`), "hero ghost button → #try");
for (const id of ["join", "steps", "try"]) check(page.includes(`<section id="${id}"`), `<section id="${id}">`);
check(page.includes(`<section class="gs-preview" aria-label="${COPY.page.try_frame_label}">`) && page.includes("data-gs-root"), "preview frame section with aria-label and data-gs-root");
check(page.includes('assets/getting-started.css') && page.includes('assets/getting-started.js') && !/<script(?![^>]*src=)[^>]*>(?!\s*<\/script>)/.test(page.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")), "page links getting-started.css/.js, no inline script");

// Footage block: four steps with the contract titles, descriptions and clip names (page and home).
const home = read("index.html");
for (const [label, html] of [["page", page], ["home", home]]) {
  for (let i = 1; i <= 4; i++) {
    const t = COPY.footage[`${i}_title`], d = COPY.footage[`${i}_desc`], c = COPY.footage[`${i}_clip`];
    check(html.includes(`<span class="cd-title">${t}</span><span class="cd-desc">${d}</span>`) && html.includes(`data-src="/assets/video/${c}.mp4"`) && html.includes(`data-poster="/assets/video/${c}.jpg"`),
      `${label} footage step 0${i}: "${t}" + clip ${c}`);
  }
  const block = label === "home" ? html.slice(html.indexOf('<section id="getting-started"'), html.indexOf("</section>", html.indexOf('<section id="getting-started"'))) : html;
  const tones = [...block.matchAll(/data-clip="[a-z]+"[^>]*data-tone="([a-z]+)"/g)].map((m) => m[1]);
  const css = read("assets/crewdemo.css");
  check(tones.length === 4 && tones.every((t) => css.includes(`[data-tone="${t}"]`) || css.includes(`data-tone=${t}`)), `${label} footage uses only data-tone values that exist in crewdemo.css`, tones.join(","));
}

// (d) The seven step titles are EXACTLY the wording file's section titles, in order.
const sections = WORDING.sections.filter((s) => s.id !== "confirm");
const stepsBlock = page.slice(page.indexOf('<section id="steps"'), page.indexOf("</section>", page.indexOf('<section id="steps"')));
const h4s = [...stepsBlock.matchAll(/<h4>([^<]*)<\/h4>/g)].map((m) => decode(m[1]));
check(sections.length === 7 && h4s.length === 7 && h4s.every((t, i) => t === sections[i].title), "#steps titles equal wording sections[i].title in order", JSON.stringify(h4s));
for (let i = 1; i <= 7; i++) check(stepsBlock.includes(`<h4>${sections[i - 1].title}</h4>`) && text(stepsBlock).includes(COPY.page[`steps_${i}_text`]), `#steps item ${i} title + one-liner`);

// (e) Home page block (§5): after the hero, before #platform, with the contract strings and links; Day 1 sentence.
const gsAt = home.indexOf('<section id="getting-started" class="tight">'), heroAt = home.indexOf('<div class="hero'), platAt = home.indexOf('<section id="platform"');
check(heroAt > 0 && gsAt > heroAt && platAt > gsAt && !home.slice(heroAt, gsAt).includes("<section"), "home #getting-started is the first section after the hero and sits before #platform");
const homeBlock = home.slice(gsAt, home.indexOf("</section>", gsAt));
for (const k of ["eyebrow", "h2", "p", "link_try", "cta_primary"]) check(has(homeBlock, COPY.home[k]), `home string ${k}`, JSON.stringify(COPY.home[k]));
check(homeBlock.includes(`<a class="btn ghost" href="${COPY.home.link_try_href}">${COPY.home.link_try}</a>`), "home Try the seven steps → /features/getting-started/#try");
check(homeBlock.includes(`<a class="btn primary" href="${COPY.home.cta_primary_href}">${COPY.home.cta_primary}</a>`), "home Start free → /app.html?signup=1");
check(homeBlock.includes('class="crewdemo stack"'), "home block carries a crewdemo stack footage block");
const firstWeek = home.slice(home.indexOf('id="first-week"'), home.indexOf("</section>", home.indexOf('id="first-week"')));
check(text(firstWeek).includes(COPY.home.day1_new) && !text(firstWeek).includes(COPY.home.day1_old), "#first-week Day 1 sentence replaced");

// Redirect stub, sitemap.
check(read("features/getting-started.html").includes('url=/features/getting-started/') && read("features/getting-started.html").includes(COPY.page.canonical), "features/getting-started.html redirects to the folder URL");
check(read("sitemap.xml").includes(`<loc>${COPY.page.canonical}</loc>`), "sitemap.xml lists the page");

// (f) Preview strings live in the script (rendered strings are proved by the e2e), and the JS is dependency-free.
const js = read("assets/getting-started.js");
for (const k of ["done_h3", "done_p", "done_primary", "done_primary_href", "done_ghost", "load_fail", "wording_url"]) check(js.includes(COPY.preview[k]), `preview string ${k} in getting-started.js`, JSON.stringify(COPY.preview[k]));
check(!/\bimport\b|\brequire\(/.test(js) && !/https?:\/\//.test(js), "getting-started.js has no imports and no absolute URLs");
check(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(js), "getting-started.js keeps state in memory only");
check(fs.statSync(path.join(ROOT, "assets/getting-started.js")).size <= 60 * 1024, "getting-started.js ≤ 60 KB");
const cssRules = read("assets/getting-started.css").replace(/\/\*[\s\S]*?\*\//g, "");
check(!/position:\s*fixed|100dvh/.test(cssRules) && /\.gs-preview \.obflow\{position:absolute/.test(cssRules), "getting-started.css: .obflow is absolute in the frame box, no fixed positioning / 100dvh");
check(cssRules.split("\n").filter((l) => /^[^@\s}].*\{/.test(l)).every((l) => l.startsWith(".gs-preview") || l.startsWith("@")), "getting-started.css: every top-level rule is scoped under .gs-preview");

// No time claims and no real names in anything new. (The JS's only "minutes" is inside a rule example ported
// word for word from the server schema, so the script is checked with the schema tables removed.)
const jsOwn = js.slice(0, js.indexOf("const SUGGESTED_SERVICES"));
for (const [label, s] of [["page", text(page)], ["home block", text(homeBlock)], ["js (outside schema tables)", jsOwn], ["fixture", JSON.stringify(COPY)]]) {
  check(!/\b\d+\s*minutes?\b|in an afternoon|KMJ/i.test(s), `${label}: no time claims, no KMJ`);
}

// (g) The app is frozen: app.js, app.html, sw.js are untouched since the base commit.
let frozen = true, why = "";
try { execFileSync("git", ["diff", "--quiet", BASE, "--", "app.js", "app.html", "sw.js"], { cwd: ROOT, stdio: "pipe" }); } catch (e) { frozen = false; why = `git diff exit ${e.status}`; }
check(frozen, `app.js, app.html, sw.js unchanged since ${BASE}`, why);

console.log(`${checks - failures}/${checks} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
