// Run from this repository: node tests/export-onboarding-copy.mjs
// Writes tests/onboarding-copy.v1.json — every word the sign-up onboarding
// shows — from the live tables in app.js (OB_SECTIONS, OB_Q, OB_COPY) through
// the same vm harness as onboarding-flow.mjs, so the file can never drift
// from the screens. The iPhone app adopts it word for word; the unit test in
// onboarding-flow.mjs asserts the committed file equals a fresh build.
// "{currency}" in a string is the price symbol; "{done}" / "{total}" are counts.
import fs from "node:fs"; import vm from "node:vm"; import { pathToFileURL } from "node:url";

const APP = new URL("../app.js", import.meta.url);
export const OUT = new URL("./onboarding-copy.v1.json", import.meta.url);

export function buildOnboardingCopy() {
  const source = fs.readFileSync(APP, "utf8");
  const slice = (from, to) => { const a = source.indexOf(from); if (a < 0) throw new Error(`missing ${from}`); const b = source.indexOf(to, a); if (b < a) throw new Error(`missing ${to}`); return source.slice(a, b); };
  const types = slice("const BUSINESS_TYPES = [", "\n];") + "\n];";
  const pure = slice("// ---- Onboarding flow (start)", "// ---- Onboarding flow (pure end)");
  const ctx = { Intl, console };
  vm.createContext(ctx);
  vm.runInContext(types + "\n" + pure, ctx);
  const read = (name) => JSON.parse(JSON.stringify(vm.runInContext(name, ctx)));
  const sections = read("OB_SECTIONS"), screen = read("OB_SCREEN"), Q = read("OB_Q"), copy = read("OB_COPY");
  const stepOf = (id) => vm.runInContext(`obStepLabel(${JSON.stringify(id)})`, ctx);
  const options = (opts) => (opts || []).map(([value, label]) => ({ value, label }));
  const question = (key) => {
    const q = Q[key];
    const out = { key, kind: q.kind, question: q.q, help: q.help ?? null, placeholder: q.placeholder ?? null };
    if (q.opts) out.options = options(q.opts);
    if (q.examples) out.examples = q.examples;
    if (q.add) out.add = q.add;
    if (q.sub) out.sub = { question: q.sub.q, help_percent: q.sub.percent, help_fixed: q.sub.fixed, placeholder: q.sub.placeholder };
    return out;
  };
  return {
    version: 1,
    sections: sections.map(([id, title]) => ({ id, title, step: stepOf(id), questions: (screen[id] || []).map(question) })),
    shared: copy,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = JSON.stringify(buildOnboardingCopy(), null, 2) + "\n";
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${OUT.pathname} (${json.length} bytes)`);
}
