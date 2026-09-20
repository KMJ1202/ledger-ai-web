// Production text, held to the foreman's oracle (node tests/onboarding-text.mjs; no deps).
//
// tests/onboarding-text-fixture.v1.json is what the REAL server modules
// (_shared/onboarding_schema.ts, _shared/business_brief.ts, workspace-profile/onboarding.ts)
// returned for four fixed answer sets (northside, salon, generic_min, hvac_remote), produced
// by eval/oracle.ts. Two layers, every set:
//   1. the port assets/onboarding-text.js, called the way the oracle called the server:
//      understanding per section (skipped ones included), brief, firstMessage, setupPlan,
//      applied, the answersOf round trip, then the top-level suggestions and constants;
//   2. the mock tests/onboarding-mock.mjs booted in-process: reset fresh, replay the set's
//      input.sections through onboarding-save (skips as { skip: true }) and hold the HTTP
//      understanding per save, the onboarding-summary brief and the onboarding-complete
//      brief / first_message / setup_plan / applied to the fixture.
// Prints counts; exits 1 on any mismatch.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startMock } from "./onboarding-mock.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const FX = JSON.parse(fs.readFileSync(path.join(HERE, "onboarding-text-fixture.v1.json"), "utf8"));
const T = globalThis.LedgerOnboardingText ?? (vm.runInThisContext(fs.readFileSync(path.join(ROOT, "assets/onboarding-text.js"), "utf8"), { filename: "assets/onboarding-text.js" }), globalThis.LedgerOnboardingText);

let ok = 0, bad = 0;
const eq = (label, got, want) => {
  try { assert.deepStrictEqual(got, want); ok++; }
  catch { bad++; console.log(`MISMATCH ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ids = Object.keys(FX.sets);

// ---- 1. The port, as the oracle called the server ----
for (const id of ids) {
  const set = FX.sets[id];
  const ws = { name: set.input.name, currency_code: set.input.currency_code, timezone: set.input.timezone };
  const wsx = { ...ws, ai_call_me: null, plan: null, phone_number: null, books_default_terms_days: 0 };
  for (const section of T.schema.STEP_IDS) {
    const skip = (set.input.skip ?? []).includes(section);
    const sent = skip ? {} : (set.input.sections[section] ?? {});
    const teamSize = typeof sent.team_size === "string" ? sent.team_size : wsx.team_size ?? null;
    const v = T.schema.validateSection(section, sent, { team_size: teamSize });
    if (!v.ok) { bad++; console.log(`VALIDATE FAIL port ${id}/${section}: ${v.error}`); continue; }
    const { profile } = T.schema.splitByStore(v.answers);
    for (const [k, val] of Object.entries(profile)) if (k !== "services" && k !== "remove_service_ids" && k !== "payment_terms_days") wsx[k] = val;
    const answered = Object.keys(v.answers).length > 0;
    eq(`port ${id}/understanding/${section}${skip ? " (skipped)" : ""}`, answered ? T.understanding(section, v.answers, { currency_code: wsx.currency_code }) : T.understanding(section, {}, {}), set.understanding[section]);
  }
  eq(`port ${id}/brief`, T.brief(set.answers, ws), set.brief);
  eq(`port ${id}/firstMessage`, T.firstMessage(set.answers, ws), set.first_message);
  eq(`port ${id}/setupPlan`, T.setupPlan(set.answers, ws), set.setup_plan);
  eq(`port ${id}/applied`, T.applied(set.answers, ws), set.applied);
  eq(`port ${id}/answersOf round trip`, T.freshEvidence(set.answers, ws).view, set.answers);
}
eq("port suggestions", T.suggestions, FX.suggestions);
eq("port constants", T.constants, FX.constants);

// ---- 2. The mock over HTTP ----
const mock = await startMock({ scenario: "fresh" });
const post = async (body) => {
  const r = await fetch(`${mock.url}/functions/v1/workspace-profile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
for (const id of ids) {
  const set = FX.sets[id];
  // Fresh, on the set's workspace (name, currency, zone; nothing else known), as the oracle's was.
  const r0 = await fetch(`${mock.url}/__mock/reset`, { method: "POST", body: JSON.stringify({ scenario: "fresh", name: set.input.name, currency_code: set.input.currency_code, timezone: set.input.timezone, call_me: null }) });
  eq(`mock ${id}/reset`, r0.status, 200);
  eq(`mock ${id}/reset state`, [mock.state().status, mock.state().ws.name, mock.state().ws.currency_code, mock.state().ws.timezone], ["not_started", set.input.name, set.input.currency_code, set.input.timezone]);
  for (const section of T.schema.STEP_IDS) {
    const skip = (set.input.skip ?? []).includes(section);
    const r = await post(skip ? { action: "onboarding-save", section, answers: {}, skip: true } : { action: "onboarding-save", section, answers: set.input.sections[section] ?? {} });
    eq(`mock ${id}/save/${section} status`, r.status, 200);
    eq(`mock ${id}/save/${section} understanding${skip ? " (skipped)" : ""}`, r.body.understanding, set.understanding[section]);
  }
  const g = await post({ action: "onboarding-get" });
  eq(`mock ${id}/get answers`, g.body.answers, set.answers);
  eq(`mock ${id}/get sections`, g.body.sections, set.sections);
  eq(`mock ${id}/get suggestions`, g.body.suggestions, FX.suggestions);
  const s = await post({ action: "onboarding-summary" });
  eq(`mock ${id}/summary brief`, s.body.brief, set.brief);
  eq(`mock ${id}/summary first_message`, s.body.first_message, set.first_message);
  eq(`mock ${id}/summary setup_plan`, s.body.setup_plan, set.setup_plan);
  const c = await post({ action: "onboarding-complete" });
  eq(`mock ${id}/complete status`, [c.status, c.body.status], [200, "complete"]);
  eq(`mock ${id}/complete brief`, c.body.brief, set.brief);
  eq(`mock ${id}/complete first_message`, c.body.first_message, set.first_message);
  eq(`mock ${id}/complete setup_plan`, c.body.setup_plan, set.setup_plan);
  eq(`mock ${id}/complete applied`, c.body.applied, set.applied);
}
mock.server.close();

console.log(`${ok}/${ok + bad} checks passed, ${bad} failed (${ids.length} sets: ${ids.join(", ")}; port + mock)`);
process.exit(bad ? 1 : 0);
