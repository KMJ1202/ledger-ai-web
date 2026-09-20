/* Try-it preview for /features/getting-started/ (2026-09-19).
   The app's sign-up onboarding (onboardingFlow() in app.js) in a phone-sized
   frame with no account: same markup, classes, question logic and wording
   (fetched from /assets/onboarding-copy.v1.json); the server's save / summary /
   complete are an in-memory stand-in that answers like the real one. Nothing
   typed leaves the page; no storage; no analytics; no dependencies. */
(() => {
"use strict";
const mount = document.querySelector("[data-gs-root]");
if (!mount) return;
const esc = (s) => { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
const obFill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const currency = "$";

// ---- Tables from app.js (values only; every label comes from the wording file) ----
const BUSINESS_TYPES = [
  ["automotive", "e.g. Mobile tire shop in south Calgary — passenger and light truck"],
  ["trades", "e.g. Residential HVAC — furnaces, AC and hot water tanks, 24-hour service"],
  ["beauty", "e.g. Hair salon — colour, cuts and extensions, four stylists"],
  ["health", "e.g. Physiotherapy clinic — sports injuries and post-surgery rehab"],
  ["home", "e.g. Residential cleaning — weekly and move-out cleans, Calgary NW"],
  ["professional", "e.g. Bookkeeping for small trades businesses — monthly packages"],
  ["fitness", "e.g. Personal training studio — one-on-one and small group"],
  ["pets", "e.g. Dog grooming — full grooms, baths and nail trims, by appointment"],
  ["other", "What you do, in one line"],
];
const placeholderForType = (t) => (BUSINESS_TYPES.find(([v]) => v === t) || BUSINESS_TYPES[BUSINESS_TYPES.length - 1])[1];
const REGIONS = [["", "Choose…"], ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"], ["US", "United States"]];
const SHOP_TZ_FALLBACK = ["America/St_Johns", "America/Halifax", "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC"];
const HOUR_DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const OB_STEPS = 7;
const OB_SCREEN = {
  about: ["business_type", "business_description", "business_stage", "team_size", "region_code", "timezone"],
  offer: ["services", "pricing_model", "hourly_rate", "quotes_first"],
  customers: ["customer_mix", "intake_channels", "job_location", "service_area", "typical_job_length", "repeat_business"],
  week: ["business_hours", "after_hours", "booking_lead"],
  money: ["payment_methods", "payment_terms_days", "deposit"],
  team: ["team_roles", "wants_front_desk", "uses_quickbooks", "uses_google_calendar"],
  ledger: ["ai_tone", "goals", "rules", "autonomy"],
};
// The question logic that is not wording (OB_Q in app.js): reveals, single vs
// multi, limits and how a chip value is typed on the wire.
const OB_META = {
  business_description: { max: 240 },
  hourly_rate: { when: (a) => a.pricing_model === "hourly" || a.pricing_model === "mix" },
  quotes_first: { bool: true },
  intake_channels: { multi: true },
  service_area: { max: 200, when: (a) => a.job_location === "customer_place" || a.job_location === "both" },
  payment_methods: { multi: true },
  payment_terms_days: { numeric: true },
  team_roles: { multi: true, when: (a) => a.team_size !== "solo" },
  wants_front_desk: { bool: true }, uses_quickbooks: { bool: true }, uses_google_calendar: { bool: true },
  goals: { multi: true, max: 3 },
  autonomy: { multi: true },
};
// Filled from the wording file on load.
let OB_ORDER = [], OB_TITLE = {}, OB_STEP = {}, OB_Q = {}, OB_COPY = {};
function adoptWording(w) {
  OB_ORDER = w.sections.map((s) => s.id);
  OB_TITLE = Object.fromEntries(w.sections.map((s) => [s.id, s.title]));
  OB_STEP = Object.fromEntries(w.sections.map((s) => [s.id, s.step]));
  OB_COPY = w.shared;
  for (const s of w.sections) for (const q of s.questions || []) {
    OB_Q[q.key] = { kind: q.kind, q: q.question, help: q.help, placeholder: q.placeholder, examples: q.examples, add: q.add,
      opts: (q.options || []).map((o) => [o.value, o.label]),
      sub: q.sub ? { q: q.sub.question, percent: q.sub.help_percent, fixed: q.sub.help_fixed, placeholder: q.sub.placeholder } : undefined,
      ...(OB_META[q.key] || {}) };
  }
}
const blankService = () => ({ name: "", price: "", duration_minutes: "" });
function shopTimezoneOptions(current) {
  let zones = [];
  try { zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []; } catch { zones = []; }
  if (!zones.length) zones = SHOP_TZ_FALLBACK;
  const device = obDeviceZone();
  const all = [...new Set([current || "", device, ...zones].filter(Boolean))];
  const label = (z) => {
    let off = "";
    try { off = new Intl.DateTimeFormat("en-CA", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || ""; } catch {}
    return `${z.replace(/_/g, " ")}${off ? ` (${off})` : ""}${z === device ? " · this device" : ""}`;
  };
  return all.sort((a, b) => a.localeCompare(b)).map((z) => [z, label(z)]);
}
const obDeviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
function timezoneSelect(id, current) {
  return `<select id="${esc(id)}" class="cmpinput">${shopTimezoneOptions(current).map(([v, l]) => `<option value="${esc(v)}"${v === (current || "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}
function regionSelect(id, current) {
  return `<select id="${esc(id)}" class="cmpinput">${REGIONS.map(([v, l]) => `<option value="${v}"${(current || "") === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}

// ---- Shared business-profile editors (app.js) ----
function chipsField(key, q, picked) {
  const val = picked[key];
  const on = (v) => q.multi ? (Array.isArray(val) && val.includes(v)) : val === v;
  return `<div class="cmpsect" data-q="${esc(key)}"${q.multi ? " data-multi" : ""}${q.max ? ` data-max="${q.max}"` : ""}>
      <label class="fld" id="q-${esc(key)}">${esc(q.q)}</label>
      ${q.help ? `<p class="note qhelp">${esc(q.help)}</p>` : ""}
      <div class="chips" role="group" aria-labelledby="q-${esc(key)}">${q.opts.map(([v, l]) =>
        `<button type="button" class="chip${on(v) ? " on" : ""}" data-v="${esc(v)}" aria-pressed="${on(v) ? "true" : "false"}">${esc(l)}</button>`).join("")}</div>
    </div>`;
}
function wireChips(root, picked, onPick) {
  root.querySelectorAll("[data-q] .chip").forEach((c) => c.onclick = () => {
    const sect = c.closest("[data-q]"), key = sect.dataset.q, v = c.dataset.v;
    if (sect.hasAttribute("data-multi")) {
      const cur = Array.isArray(picked[key]) ? [...picked[key]] : [];
      const max = Number(sect.dataset.max) || 0;
      if (cur.includes(v)) picked[key] = cur.filter((x) => x !== v);
      else if (max && cur.length >= max) { if (onPick) onPick(key, v, picked, { limited: max }); return; }
      else picked[key] = [...cur, v];
      const now = picked[key].includes(v);
      c.classList.toggle("on", now); c.setAttribute("aria-pressed", now ? "true" : "false");
    } else {
      sect.querySelectorAll(".chip").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
      c.classList.add("on"); c.setAttribute("aria-pressed", "true"); picked[key] = v;
    }
    if (onPick) onPick(key, v, picked, {});
  });
}
function servicesEditor(initial, opts = {}) {
  const rows = (initial || []).map((s) => ({ id: s.id, name: s.name || "", price: s.price ?? "", duration_minutes: s.duration_minutes ?? "" }));
  while (rows.length < (opts.minRows ?? 3)) rows.push(blankService());
  const removed = [];
  let box = null;
  const row = (s, i) => `<div class="svcrow" data-i="${i}">
      <input class="cmpinput" data-sn placeholder="Service or product" aria-label="Service or product" maxlength="200" value="${esc(String(s.name ?? ""))}">
      <input class="cmpinput" data-sp type="number" min="0" step="0.01" inputmode="decimal" placeholder="Price" aria-label="Price before tax" value="${esc(String(s.price ?? ""))}">
      <input class="cmpinput" data-sd type="number" min="5" max="1440" step="5" inputmode="numeric" placeholder="Min" aria-label="Minutes it takes" value="${esc(String(s.duration_minutes ?? ""))}">
      <button type="button" class="linkbtn svcx" data-sx title="Remove" aria-label="Remove this line">&times;</button></div>`;
  const read = () => { if (box) [...box.querySelectorAll(".svcrow")].forEach((el) => {
    const s = rows[Number(el.dataset.i)]; if (!s) return;
    s.name = el.querySelector("[data-sn]").value; s.price = el.querySelector("[data-sp]").value; s.duration_minutes = el.querySelector("[data-sd]").value;
  }); };
  const paint = () => {
    box.innerHTML = rows.map(row).join("");
    box.querySelectorAll("[data-sx]").forEach((x) => x.onclick = () => {
      read();
      const i = Number(x.closest(".svcrow").dataset.i);
      if (rows[i]?.id) removed.push(rows[i].id);
      rows.splice(i, 1); if (!rows.length) rows.push(blankService());
      paint();
    });
  };
  const ed = {
    html: () => `<div class="svchead" aria-hidden="true"><span>Service</span><span>Price ${esc(opts.currency || "$")}</span><span>Minutes</span><span></span></div>
      <div data-svcbox>${rows.map(row).join("")}</div>
      <button type="button" class="linkbtn" data-svcadd style="margin-top:8px">+ Add another</button>`,
    wire(root) {
      box = root.querySelector("[data-svcbox]"); paint();
      root.querySelector("[data-svcadd]").onclick = () => { ed.add(blankService(), true); box.querySelector(".svcrow:last-child [data-sn]")?.focus(); };
    },
    add(s, append) {
      read();
      const empty = append ? -1 : rows.findIndex((r) => !r.id && !String(r.name).trim());
      if (empty >= 0) rows[empty] = { ...rows[empty], ...s }; else rows.push({ ...blankService(), ...s });
      paint();
    },
    names() { read(); return rows.map((r) => String(r.name).trim().toLowerCase()).filter(Boolean); },
    services() {
      read();
      return rows.filter((s) => String(s.name).trim()).map((s) => ({
        id: s.id, name: String(s.name).trim(), price: Number(s.price) || 0, duration_minutes: s.duration_minutes ? Number(s.duration_minutes) : null,
      }));
    },
    removed: () => removed,
    sync() { read(); box = null; },
  };
  return ed;
}
function hoursEditor(initial) {
  const hours = initial && Object.values(initial).some(Boolean) ? { ...initial }
    : Object.fromEntries(HOUR_DAYS.map(([k]) => [k, k === "sat" || k === "sun" ? null : { open: "08:00", close: "17:00" }]));
  let root = null;
  return {
    html: () => HOUR_DAYS.map(([k, l]) => { const h = hours[k]; return `<div class="hourrow" data-hday="${k}">
        <label class="hourtoggle"><input type="checkbox" data-hon="${k}" ${h ? "checked" : ""}> <b>${l}</b></label>
        <span class="hourtimes" ${h ? "" : "hidden"}><input type="time" data-hopen="${k}" aria-label="${l} opens at" value="${esc(h?.open || "08:00")}"> <em>to</em> <input type="time" data-hclose="${k}" aria-label="${l} closes at" value="${esc(h?.close || "17:00")}"></span>
      </div>`; }).join(""),
    wire(el) {
      root = el;
      root.querySelectorAll("[data-hon]").forEach((c) => c.onchange = () => {
        root.querySelector(`.hourrow[data-hday="${c.dataset.hon}"] .hourtimes`).hidden = !c.checked;
      });
    },
    read() {
      const out = {};
      for (const [k] of HOUR_DAYS) {
        if (!root) { out[k] = hours[k] || null; continue; }
        const on = root.querySelector(`[data-hon="${k}"]`).checked;
        out[k] = on ? { open: root.querySelector(`[data-hopen="${k}"]`).value || "08:00", close: root.querySelector(`[data-hclose="${k}"]`).value || "17:00" } : null;
      }
      return Object.values(out).some(Boolean) ? out : null;
    },
    sync() { if (!root) return; const now = this.read() || {}; for (const [k] of HOUR_DAYS) hours[k] = now[k] || null; root = null; },
  };
}

// ---- Pure helpers (app.js) ----
function obVisibleQuestions(section, answers) {
  const a = answers || {};
  return (OB_SCREEN[section] || []).filter((k) => !OB_Q[k].when || OB_Q[k].when(a));
}
function obNextSection(current, serverNext) {
  if (serverNext && OB_ORDER.includes(serverNext)) return serverNext;
  const i = OB_ORDER.indexOf(current);
  return OB_ORDER[Math.min(i + 1, OB_ORDER.length - 1)];
}
const obCanSkip = (section) => OB_ORDER.includes(section) && section !== "about" && section !== "confirm";
function obPrevSection(current) {
  const i = OB_ORDER.indexOf(current);
  return i > 0 ? OB_ORDER[i - 1] : null;
}
function obValues(section, picked, editors = {}) {
  const v = {};
  for (const k of OB_SCREEN[section] || []) {
    const q = OB_Q[k], raw = picked[k];
    if (k === "autonomy") { if (Array.isArray(raw)) v.autonomy = Object.fromEntries(q.opts.map(([o]) => [o, raw.includes(o)])); continue; }
    switch (q.kind) {
      case "chips":
        if (q.multi) { if (Array.isArray(raw)) v[k] = q.opts.map(([o]) => o).filter((o) => raw.includes(o)); }
        else if (raw == null || raw === "") break;
        else if (q.bool) v[k] = raw === "true";
        else if (q.numeric) v[k] = Number(raw);
        else v[k] = raw;
        break;
      case "text": if (raw != null) v[k] = String(raw).trim().replace(/\s+/g, " ").slice(0, q.max || 240); break;
      case "number": if (raw != null && raw !== "") v[k] = Math.max(0, Number(raw) || 0); break;
      case "timezone": case "region": v[k] = raw ? String(raw) : ""; break;
      case "services": if (editors.services) { v.services = editors.services.services(); v.remove_service_ids = editors.services.removed(); } break;
      case "hours": if (editors.hours) v.business_hours = editors.hours.read(); break;
      case "deposit": {
        const type = picked.deposit_type;
        if (type === "none" || type === "percent" || type === "fixed") {
          const n = picked.deposit_value == null || picked.deposit_value === "" ? null : Math.max(0, Number(picked.deposit_value) || 0);
          v.deposit = { type, value: type === "none" ? null : n };
        }
        break;
      }
      case "rules": if (Array.isArray(raw)) v.rules = raw.map((r) => String(r).trim().replace(/\s+/g, " ").slice(0, 160)).filter(Boolean).slice(0, 5); break;
    }
  }
  return v;
}
function obPayload(section, values, prev, touched, visible) {
  const out = {};
  const seen = touched instanceof Set ? touched : new Set(touched || []);
  const had = (k) => prev && prev[k] != null;
  for (const k of OB_SCREEN[section] || []) {
    const v = values[k];
    if (!visible.includes(k)) { if (had(k)) out[k] = null; continue; }
    if (k === "services") { if (Array.isArray(v) && v.length) out.services = v; continue; }
    if (k === "business_hours") { if (v !== undefined) out.business_hours = v; continue; }
    if (k === "timezone" || k === "region_code") { if (v && v !== (prev?.[k] || "")) out[k] = v; continue; }
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) { if (seen.has(k) && had(k)) out[k] = null; continue; }
    out[k] = v;
  }
  return out;
}
function obSeed(section, answers) {
  const p = {};
  const a = answers || {};
  for (const k of OB_SCREEN[section] || []) {
    const q = OB_Q[k], val = a[k];
    if (val == null) continue;
    if (k === "autonomy") { p.autonomy = Object.entries(val).filter(([, on]) => on === true).map(([o]) => o); continue; }
    switch (q.kind) {
      case "chips": p[k] = q.multi ? (Array.isArray(val) ? [...val] : []) : String(val); break;
      case "text": case "number": case "timezone": case "region": p[k] = String(val); break;
      case "deposit": p.deposit_type = val.type || ""; p.deposit_value = val.value == null ? "" : String(val.value); break;
      case "rules": p.rules = Array.isArray(val) ? val.map(String) : []; break;
    }
  }
  return p;
}
const obStepLabel = (section) => section === "confirm" ? OB_COPY.confirm_step : OB_STEP[section];
function obProgressPct(section) {
  const i = OB_ORDER.indexOf(section);
  return section === "confirm" ? 100 : Math.round((i / OB_STEPS) * 100);
}
const obBriefHtml = (brief) => String(brief || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  .map((g) => `<p>${g.split("\n").map((l) => esc(l.trim())).filter(Boolean).join("<br>")}</p>`).join("");

// ---- Screen markup (app.js) ----
function obQuestionHtml(key, ctx) {
  const q = OB_Q[key], picked = ctx.picked, id = `ob-${key}`;
  const help = q.help ? `<p class="note qhelp">${esc(q.help)}</p>` : "";
  const lab = `<label class="fld" for="${id}">${esc(q.q)}</label>`;
  const wrap = (inner) => `<div class="cmpsect" data-q="${esc(key)}">${inner}</div>`;
  switch (q.kind) {
    case "chips": return chipsField(key, q, picked);
    case "text": {
      const type = ctx.answers?.business_type;
      const ph = key === "business_description" ? (ctx.suggestions?.descriptions?.[type] || placeholderForType(type))
        : q.placeholder || "";
      return wrap(`${lab}${help}<input id="${id}" class="cmpinput" maxlength="${q.max || 240}" value="${esc(picked[key] ?? "")}" placeholder="${esc(ph)}" autocomplete="off">`);
    }
    case "number":
      return wrap(`${lab}<p class="note qhelp">${esc(obFill(q.help, { currency: ctx.currency }))}</p><input id="${id}" class="cmpinput" type="number" min="0" step="1" inputmode="decimal" value="${esc(picked[key] ?? "")}" placeholder="${esc(q.placeholder || "")}">`);
    case "region": return wrap(`${lab}${help}${regionSelect(id, picked[key] || "")}`);
    case "timezone": return wrap(`${lab}${help}${timezoneSelect(id, picked[key] || ctx.timezone || "")}`);
    case "services": {
      const type = ctx.answers?.business_type;
      const ex = (ctx.suggestions?.services?.[type] || []).slice(0, 8);
      const chips = ex.length ? `<div class="obex"><p class="note" id="q-services-ex">${esc(q.examples)}</p>
          <div class="chips" role="group" aria-labelledby="q-services-ex">${ex.map((s, i) => `<button type="button" class="chip" data-ex="${i}" aria-pressed="false" title="${esc(OB_COPY.example)}">${esc(s.name)}${s.price != null ? ` · ${esc(ctx.currency)}${esc(String(s.price))}` : ""}</button>`).join("")}</div></div>` : "";
      return wrap(`<label class="fld" id="q-services">${esc(q.q)}</label>${help}${chips}<div data-svced role="group" aria-labelledby="q-services">${ctx.editors.services.html()}</div>`);
    }
    case "hours":
      return wrap(`<label class="fld" id="q-business_hours">${esc(q.q)}</label>${help}<div data-hrsed role="group" aria-labelledby="q-business_hours">${ctx.editors.hours.html()}</div>`);
    case "deposit": {
      const t = picked.deposit_type;
      const askValue = t === "percent" || t === "fixed";
      return chipsField("deposit_type", { q: q.q, opts: q.opts }, picked)
        + `<div class="cmpsect" data-q="deposit_value" ${askValue ? "" : "hidden"}><label class="fld" for="ob-deposit_value">${esc(q.sub.q)}</label>
          <p class="note qhelp" data-dephint>${esc(obDepositHint(t, ctx.currency))}</p>
          <input id="ob-deposit_value" class="cmpinput" type="number" min="0" step="1" inputmode="decimal" value="${esc(picked.deposit_value ?? "")}" placeholder="${esc(q.sub.placeholder)}"></div>`;
    }
    case "rules": {
      const type = ctx.answers?.business_type;
      const ex = (ctx.suggestions?.rules?.[type] || []).slice(0, 3);
      const rules = Array.isArray(picked.rules) && picked.rules.length ? picked.rules : [""];
      const chips = ex.length ? `<div class="obex"><p class="note" id="q-rules-ex">${esc(q.examples)}</p>
          <div class="chips" role="group" aria-labelledby="q-rules-ex">${ex.map((r, i) => `<button type="button" class="chip" data-rex="${i}" aria-pressed="false">${esc(r)}</button>`).join("")}</div></div>` : "";
      return wrap(`<label class="fld" id="q-rules">${esc(q.q)}</label>${help}${chips}<div data-rulesbox role="group" aria-labelledby="q-rules">${rules.map((r, i) => obRuleRow(r, i)).join("")}</div>
        <button type="button" class="linkbtn" data-ruleadd style="margin-top:8px" ${rules.length >= 5 ? "hidden" : ""}>${esc(q.add)}</button>`);
    }
    default: return "";
  }
}
const obRuleRow = (r, i) => `<input class="cmpinput" data-rule="${i}" maxlength="160" aria-label="Rule ${i + 1}" value="${esc(r)}" placeholder="${esc(OB_Q.rules.placeholder)}" autocomplete="off" style="margin-top:${i ? 6 : 0}px">`;
const obDepositHint = (type, currency) => type === "percent" ? OB_Q.deposit.sub.percent : obFill(OB_Q.deposit.sub.fixed, { currency });
function obConfirmHtml(summary, sections) {
  const brief = obBriefHtml(summary?.brief);
  const rows = (sections || OB_ORDER.slice(0, 7).map((id) => ({ id, title: OB_TITLE[id] }))).filter((s) => s.id !== "confirm").map((s) =>
    `<div class="obrow"><span class="m"><b>${esc(OB_TITLE[s.id] || s.title)}</b><small>${esc(s.done ? OB_COPY.row_done : s.skipped ? OB_COPY.row_skipped : OB_COPY.row_todo)}</small></span>
      <button type="button" class="linkbtn" data-change="${esc(s.id)}" aria-label="${esc(OB_COPY.change)} ${esc(OB_TITLE[s.id] || s.title)}">${esc(OB_COPY.change)}</button></div>`).join("");
  return `<div class="obbrief">${brief || `<p class="note">${esc(OB_COPY.summary_empty)}</p>`}</div>
    <div class="obrows">${rows}</div>`;
}

// ---- The server, in memory. Answers the way workspace-profile's onboarding
// actions do (onboarding-app-CONTRACT.md): a save marks the section done, or
// skipped when skip is true and nothing is sent; done_count counts done
// sections only; understanding is one line for the keys just saved; the
// summary carries only what was answered; complete needs a business type. ----
const SRV = {
  answers: {}, status: "not_started", current_section: "about", sections: [], svcSeq: 0,
  reset() { this.answers = {}; this.status = "not_started"; this.current_section = "about"; this.svcSeq = 0;
    this.sections = OB_ORDER.slice(0, 7).map((id) => ({ id, title: OB_TITLE[id], done: false, skipped: false })); },
  snapshot() { return this.sections.map((s) => ({ ...s })); },
  doneCount() { return this.sections.filter((s) => s.done).length; },
  get() { return { status: this.status, current_section: this.current_section, done_count: this.doneCount(), total: OB_STEPS, sections: this.snapshot(), answers: { ...this.answers },
    currency: "CAD", suggestions: { services: SUGGESTED_SERVICES, descriptions: SUGGESTED_DESCRIPTIONS, rules: SUGGESTED_RULES } }; },
  save(section, answers, skip) {
    const sent = Object.keys(answers).length;
    for (const [k, v] of Object.entries(answers)) {
      if (v === null) { delete this.answers[k]; continue; }
      if (k === "remove_service_ids") continue;
      if (k === "services") { this.answers.services = v.map((s) => ({ ...s, id: s.id || `svc-${++this.svcSeq}` })); continue; }
      this.answers[k] = v;
    }
    const s = this.sections.find((x) => x.id === section);
    if (s) { if (skip && !sent) { s.skipped = true; s.done = false; } else { s.done = true; s.skipped = false; } }
    this.status = "in_progress";
    const next = obNextSection(section);
    this.current_section = next;
    return { saved: true, section, sections: this.snapshot(), next_section: next, status: this.status, understanding: skip && !sent ? "" : understandingFor(section, answers) };
  },
  summary() {
    const brief = this.sections.filter((s) => s.done).map((s) => {
      const mine = Object.fromEntries(Object.entries(this.answers).filter(([k]) => OB_SCREEN[s.id].includes(k)));
      return understandingLines(s.id, mine).join("\n");
    }).filter(Boolean).join("\n\n");
    return { brief };
  },
  complete() {
    if (!this.answers.business_type) { const e = new Error(OB_COPY.note_409); e.status = 409; throw e; }
    this.status = "complete"; this.current_section = "confirm";
    return { status: "complete" };
  },
  skipAll() { if (this.status !== "complete" && this.status !== "not_started") this.status = "skipped"; },
};

// ---- The flow itself (onboardingFlow() in app.js, minus the account) ----
// Answers live in F until the visitor leaves the screen; Back/forward keep
// what was typed. One instance per preview; "Start over" builds a new one.
function onboardingFlow(opts = {}) {
  mount.querySelector("#obflow")?.remove();
  const F = { get: null, answers: {}, picked: {}, touched: {}, editors: {}, section: null, status: "not_started", suggestions: {}, sections: null, saving: false, summary: null };
  const el = document.createElement("div");
  el.id = "obflow"; el.className = "obflow";
  el.innerHTML = `<div class="obcol">
<div class="obtop">
<div class="obprog" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="${OB_STEPS}" aria-valuenow="0"><i style="width:0%"></i></div>
<div class="obtoprow"><span class="obstep" id="obstep">${esc(OB_STEP.about)}</span><button type="button" class="linkbtn" id="oblater">${esc(OB_COPY.later)}</button></div>
<p class="obunder" id="obunder" aria-live="polite" hidden></p>
</div>
<div class="obbody" id="obbody"><h1 id="obtitle" tabindex="-1">${esc(OB_TITLE.about)}</h1><div id="obqs"><p class="note" role="status">${esc(OB_COPY.loading)}</p></div></div>
<div class="obfoot"><p class="note obnote" id="obnote" role="alert" hidden></p><div class="obbtns"><button type="button" class="btn ghost" id="obback" hidden>${esc(OB_COPY.back)}</button><button type="button" class="btn primary" id="obnext" disabled>${esc(OB_COPY.continue)}</button></div>
<button type="button" class="linkbtn obskip" id="obskip" hidden>${esc(OB_COPY.skip)}</button></div>
</div>`;
  mount.appendChild(el);
  const q = (sel) => el.querySelector(sel);
  const note = (msg, retry) => {
    const n = q("#obnote"); n.hidden = !msg; n.innerHTML = msg ? esc(msg) : "";
    if (msg && retry) { const b = document.createElement("button"); b.type = "button"; b.className = "linkbtn"; b.style.marginLeft = "8px"; b.textContent = retry.label; b.onclick = retry.run; n.appendChild(b); }
  };
  const busy = (on, label) => {
    const btn = q("#obnext"); btn.disabled = on; btn.textContent = on ? OB_COPY.saving : label;
    q("#obskip").disabled = on; q("#obback").disabled = on; q("#oblater").disabled = on;
  };
  function close() {
    if (el.contains(document.activeElement)) { try { document.activeElement.blur(); } catch {} }
    el.remove();
  }
  const motion = () => matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const coarse = matchMedia("(pointer: coarse)").matches;
  const isField = (n) => !!n && typeof n.matches === "function" && n.matches("input:not([type=checkbox]), select, textarea");
  q("#obbody").addEventListener("focusin", (e) => {
    if (!coarse || !isField(e.target)) return;
    q("#obbody").classList.add("kb");
    requestAnimationFrame(() => { try { e.target.scrollIntoView({ block: "center", behavior: motion() }); } catch {} });
  });
  q("#obbody").addEventListener("focusout", () => {
    setTimeout(() => { const b = q("#obbody"); if (b && !isField(document.activeElement)) b.classList.remove("kb"); }, 300);
  });
  const reveal = (box) => {
    if (!box || box.hidden) return;
    const f = box.querySelector("input:not([type=checkbox]), select, textarea");
    if (f) { try { f.focus({ preventScroll: true }); } catch {} }
    try { (f || box).scrollIntoView({ block: coarse && f ? "center" : "nearest", behavior: motion() }); } catch {}
  };
  // The page version moves focus to the step title on every step change
  // (CONTRACT §4) instead of the first control — but not on page load, where
  // nobody asked for the preview yet.
  let quiet = !!opts.quiet;
  const focusTitle = () => { if (quiet) { quiet = false; return; } try { q("#obtitle").focus({ preventScroll: true }); } catch {} };
  const applyVisibility = (section) => {
    const vis = obVisibleQuestions(section, { ...F.answers, ...(F.picked[section] || {}) });
    const shown = [];
    q("#obqs").querySelectorAll("[data-q]").forEach((box) => {
      const k = box.dataset.q;
      if (k === "deposit_type" || k === "deposit_value") return;
      const hide = !vis.includes(k);
      if (box.hidden && !hide) shown.push(box);
      box.hidden = hide;
    });
    return shown;
  };

  // ---- one screen ----
  function show(section, extra = {}) {
    F.section = section;
    const i = OB_ORDER.indexOf(section);
    q("#obtitle").textContent = OB_TITLE[section];
    q("#obstep").textContent = obStepLabel(section);
    const prog = q(".obprog"); prog.setAttribute("aria-valuenow", section === "confirm" ? OB_STEPS : i + 1); prog.firstElementChild.style.width = obProgressPct(section) + "%";
    const under = q("#obunder");
    under.hidden = !extra.under; under.textContent = extra.under || "";
    if (extra.under) { under.classList.remove("obin"); void under.offsetWidth; under.classList.add("obin"); }
    note("");
    q("#obback").hidden = i === 0;
    q("#obskip").hidden = !obCanSkip(section);
    busy(false, section === "confirm" ? OB_COPY.finish : OB_COPY.continue);
    q("#obbody").scrollTop = 0;
    if (section === "confirm") { showConfirm(); return; }
    if (!F.picked[section]) F.picked[section] = obSeed(section, F.answers);
    if (!F.touched[section]) F.touched[section] = new Set();
    const picked = F.picked[section];
    if (section === "about" && !picked.timezone) picked.timezone = F.answers.timezone || obDeviceZone();
    const ed = F.editors[section] || (F.editors[section] = {});
    if (section === "offer" && !ed.services) ed.services = servicesEditor(F.answers.services, { currency });
    if (section === "week" && !ed.hours) ed.hours = hoursEditor(F.answers.business_hours);
    const ctx = { picked, answers: F.answers, editors: ed, suggestions: F.suggestions, currency, timezone: F.answers.timezone || obDeviceZone() };
    q("#obqs").innerHTML = OB_SCREEN[section].map((k) => obQuestionHtml(k, ctx)).join("");
    const root = q("#obqs");
    const touch = (k) => F.touched[section].add(k);
    wireChips(root, picked, (key, v, p, info) => {
      touch(key === "deposit_type" ? "deposit" : key);
      if (info.limited) { note(`Up to ${info.limited} — unpick one to change it.`); return; }
      note("");
      if (key === "business_type") { const d = root.querySelector("#ob-business_description"); if (d && !d.value) d.placeholder = F.suggestions?.descriptions?.[v] || placeholderForType(v); }
      if (key === "deposit_type") {
        const box = root.querySelector('[data-q="deposit_value"]');
        const was = box.hidden;
        box.hidden = !(v === "percent" || v === "fixed");
        box.querySelector("[data-dephint]").textContent = obDepositHint(v, currency);
        if (was && !box.hidden) reveal(box);
      }
      applyVisibility(section).forEach((box) => reveal(box));
    });
    root.querySelectorAll("input[id^='ob-'], select[id^='ob-']").forEach((inp) => {
      const key = inp.id.slice(3);
      inp.addEventListener("input", () => { picked[key] = inp.value; touch(key === "deposit_value" ? "deposit" : key); });
      inp.addEventListener("change", () => { picked[key] = inp.value; touch(key === "deposit_value" ? "deposit" : key); });
    });
    if (ed.services) {
      ed.services.wire(root.querySelector("[data-svced]"));
      root.querySelectorAll("[data-ex]").forEach((c) => c.onclick = () => {
        const s = (F.suggestions?.services?.[F.answers.business_type] || [])[Number(c.dataset.ex)];
        if (!s) return;
        if (ed.services.names().includes(String(s.name).trim().toLowerCase())) { c.setAttribute("aria-pressed", "true"); c.classList.add("on"); return; }
        ed.services.add({ name: s.name, price: s.price ?? "", duration_minutes: s.duration_minutes ?? "" });
        c.setAttribute("aria-pressed", "true"); c.classList.add("on"); touch("services");
      });
      root.querySelector("[data-svced]").addEventListener("input", () => touch("services"));
    }
    if (ed.hours) { ed.hours.wire(root.querySelector("[data-hrsed]")); root.querySelector("[data-hrsed]").addEventListener("change", () => touch("business_hours")); }
    if (section === "ledger") wireRules(root, picked, touch);
    applyVisibility(section);
    focusTitle();
  }
  function wireRules(root, picked, touch) {
    const box = root.querySelector("[data-rulesbox]"); if (!box) return;
    const read = () => { picked.rules = [...box.querySelectorAll("[data-rule]")].map((i) => i.value); };
    const paint = () => {
      box.innerHTML = (picked.rules || [""]).map((r, i) => obRuleRow(r, i)).join("");
      box.querySelectorAll("[data-rule]").forEach((i) => i.addEventListener("input", () => { read(); touch("rules"); }));
      root.querySelector("[data-ruleadd]").hidden = (picked.rules || []).length >= 5;
    };
    box.querySelectorAll("[data-rule]").forEach((i) => i.addEventListener("input", () => { read(); touch("rules"); }));
    root.querySelector("[data-ruleadd]").onclick = () => { read(); if (picked.rules.length >= 5) return; picked.rules.push(""); paint(); box.querySelector("[data-rule]:last-child")?.focus(); };
    root.querySelectorAll("[data-rex]").forEach((c) => c.onclick = () => {
      const ex = (F.suggestions?.rules?.[F.answers.business_type] || [])[Number(c.dataset.rex)]; if (!ex) return;
      read();
      const cur = picked.rules || [""];
      if (cur.includes(ex)) { c.setAttribute("aria-pressed", "true"); c.classList.add("on"); return; }
      const empty = cur.findIndex((r) => !r.trim());
      if (empty >= 0) cur[empty] = ex; else if (cur.length < 5) cur.push(ex); else { note("Up to five rules — change one instead."); return; }
      picked.rules = cur; c.setAttribute("aria-pressed", "true"); c.classList.add("on"); touch("rules"); paint();
    });
  }

  // ---- save & move ----
  function next() {
    const section = F.section;
    if (F.saving) return;
    if (section === "confirm") { finish(); return; }
    const picked = F.picked[section] || {};
    if (section === "about" && !picked.business_type) { note(OB_COPY.note_type_first); q('[data-q="business_type"] .chip')?.focus(); return; }
    const values = obValues(section, picked, F.editors[section] || {});
    const visible = obVisibleQuestions(section, { ...F.answers, ...picked });
    const answers = obPayload(section, values, F.answers, F.touched[section], visible);
    save(section, answers, false);
  }
  function skip() {
    if (F.saving || !obCanSkip(F.section)) return;
    save(F.section, {}, true);
  }
  function save(section, answers, skipping) {
    F.saving = true; busy(true); note("");
    const r = SRV.save(section, answers, skipping);
    F.saving = false;
    for (const [k, v] of Object.entries(answers)) { if (v === null) delete F.answers[k]; else if (k !== "remove_service_ids") F.answers[k] = v; }
    if (r.sections) F.sections = r.sections;
    F.status = r.status;
    if (!skipping) F.editors[section]?.services?.sync?.();
    if (!skipping) F.editors[section]?.hours?.sync?.();
    if (section === "offer" && answers.services) { F.answers.services = SRV.get().answers.services; if (F.editors.offer) F.editors.offer.services = null; }
    show(obNextSection(section, r.next_section), { under: skipping ? "" : String(r.understanding || "").trim() });
  }
  // ---- confirm & finish ----
  function showConfirm() {
    q("#obqs").innerHTML = `<p class="note" role="status">${esc(OB_COPY.summary_loading)}</p>`;
    q("#obnext").disabled = true;
    F.summary = SRV.summary();
    q("#obqs").innerHTML = obConfirmHtml(F.summary, F.sections);
    q("#obqs").querySelectorAll("[data-change]").forEach((b) => b.onclick = () => show(b.dataset.change));
    busy(false, OB_COPY.finish);
    focusTitle();
  }
  function finish() {
    if (F.saving) return;
    F.saving = true; busy(true); note("");
    try { SRV.complete(); }
    catch (e) {
      F.saving = false; busy(false, OB_COPY.finish);
      if (e.status === 409) { note(e.message || OB_COPY.note_409, { label: OB_COPY.go_about, run: () => show("about") }); return; }
      throw e;
    }
    F.saving = false; F.status = "complete";
    close();
    if (opts.onDone) opts.onDone("complete");
  }
  // "Finish later": keep every answer, back to Home (the banner).
  function later() {
    if (F.saving) return;
    close();
    SRV.skipAll();
    if (opts.onDone) opts.onDone(null);
  }
  // ---- wiring ----
  q("#obnext").onclick = () => next();
  q("#obskip").onclick = () => skip();
  q("#obback").onclick = () => { const p = obPrevSection(F.section); if (p && !F.saving) show(p); };
  q("#oblater").onclick = () => later();
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.defaultPrevented) return;
    const t = e.target;
    if (t.tagName === "INPUT" && !["checkbox", "radio", "time"].includes(t.type)) { e.preventDefault(); next(); }
  });
  // ---- load ----
  F.get = SRV.get();
  F.answers = F.get.answers || {};
  F.status = F.get.status;
  F.suggestions = F.get.suggestions || {};
  F.sections = F.get.sections || null;
  const start = opts.section && OB_ORDER.includes(opts.section) ? opts.section
    : (F.status === "in_progress" || F.status === "skipped") && OB_ORDER.includes(F.get.current_section) ? F.get.current_section : "about";
  show(start);
}

// ---- What the frame shows outside the flow ----
// Home with the app's resume banner (drawBusinessTypeBanner in app.js) after
// "Finish later"; the What-Ledger-knows card's button once the banner is hidden.
function homeScreen() {
  const ob = SRV.get();
  const home = document.createElement("div");
  home.className = "gs-home";
  const paint = (banner) => {
    home.innerHTML = banner ? `<div class="hbanner" id="biztypebanner" style="margin-bottom:10px;flex-wrap:wrap">
<span class="ic">&#9889;</span>
<span class="m" style="flex:1 1 200px;min-width:min(100%,200px)"><b>${esc(obFill(OB_COPY.banner_title, { done: Number(ob.done_count) || 0, total: Number(ob.total) || OB_STEPS }))}</b>
<small style="white-space:normal;line-height:1.35;margin-top:2px">${esc(OB_COPY.banner_sub)}</small></span>
<span style="display:flex;gap:8px;flex:0 0 auto;margin-left:auto">
<button class="retry" id="biztypego">${esc(OB_COPY.resume)}</button>
<button class="retry" id="biztypehide" aria-label="Hide this for now">${esc(OB_COPY.banner_later)}</button></span></div>`
  : `<p class="note">${esc(OB_COPY.knows_empty)}</p><div style="margin-top:12px"><button class="btn primary" id="knowfinish" style="width:100%">${esc(OB_COPY.finish_setup)}</button></div>`;
    const go = () => { home.remove(); onboardingFlow({ section: ob.current_section, onDone: afterFlow }); };
    if (banner) { home.querySelector("#biztypego").onclick = go; home.querySelector("#biztypehide").onclick = () => paint(false); }
    else home.querySelector("#knowfinish").onclick = go;
  };
  paint(true);
  mount.appendChild(home);
  requestAnimationFrame(() => { try { home.querySelector("button")?.focus({ preventScroll: true }); } catch {} });
}
// After "Looks right — finish" (CONTRACT §4).
function finishPanel() {
  const p = document.createElement("div");
  p.className = "gs-panel";
  p.innerHTML = `<h3 tabindex="-1">That's the whole setup.</h3>
<p>In the app, Ledger turns these answers into your price list, your hours and your first working day. Sign up and you'll answer for real — it takes the same seven steps.</p>
<a class="btn primary" href="/app.html?signup=1">Start free — 14 days →</a>
<button type="button" class="btn ghost" id="gsrestart">Start over</button>`;
  p.querySelector("#gsrestart").onclick = () => { p.remove(); SRV.reset(); onboardingFlow({ onDone: afterFlow }); };
  mount.appendChild(p);
  requestAnimationFrame(() => { try { p.querySelector("h3").focus({ preventScroll: true }); } catch {} });
}
const afterFlow = (r) => { if (r === "complete") finishPanel(); else homeScreen(); };

// ---- Boot: the one network request the preview makes ----
fetch("/assets/onboarding-copy.v1.json", { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
  .then((w) => {
    if (!w || !Array.isArray(w.sections) || !w.shared) throw new Error("bad wording file");
    adoptWording(w);
    SRV.reset();
    mount.innerHTML = "";
    onboardingFlow({ onDone: afterFlow, quiet: true });
  })
  .catch(() => { mount.innerHTML = `<p class="note err gs-fail" role="alert">Couldn't load the preview. Refresh to try again.</p>`; });

// ---- Ported verbatim from _shared/onboarding_schema.ts (server-owned text) ----
// Rows are { name, price, duration_minutes } exactly as in the schema.
const svc = (name, price, duration_minutes) => ({ name, price, duration_minutes });
const SUGGESTED_SERVICES = {
  automotive: [
    svc("Oil change", 80, 45),
    svc("Seasonal tire swap", 60, 45),
    svc("Mount and balance (4 tires)", 120, 60),
    svc("Flat repair", 35, 30),
    svc("Brake pads and rotors (per axle)", 350, 120),
    svc("Wheel alignment", 120, 60),
    svc("Battery replacement", 190, 30),
    svc("Full detail", 200, 180),
  ],
  trades: [
    svc("Service call and diagnosis", 130, 60),
    svc("Furnace tune-up", 150, 90),
    svc("AC tune-up", 150, 90),
    svc("Hot water tank replacement", 1850, 240),
    svc("Drain cleaning", 200, 90),
    svc("Thermostat install", 250, 60),
    svc("After-hours emergency call", 250, 60),
  ],
  beauty: [
    svc("Haircut", 45, 45),
    svc("Cut and blow-dry", 65, 60),
    svc("Root colour", 95, 90),
    svc("Full highlights", 165, 150),
    svc("Balayage", 220, 180),
    svc("Beard trim", 25, 20),
    svc("Blow-dry", 40, 40),
    svc("Gel manicure", 55, 60),
  ],
  health: [
    svc("Initial assessment", 120, 60),
    svc("Follow-up visit", 85, 45),
    svc("60-minute massage", 110, 60),
    svc("90-minute massage", 150, 90),
    svc("Adjustment", 65, 20),
    svc("Extended visit", 130, 60),
  ],
  home: [
    svc("Standard clean", 160, 120),
    svc("Deep clean", 280, 240),
    svc("Move-out clean", 350, 300),
    svc("Lawn cut", 45, 30),
    svc("Spring yard clean-up", 220, 180),
    svc("Gutter cleaning", 180, 90),
    svc("Handyman hour", 85, 60),
    svc("Exterior window cleaning", 150, 120),
  ],
  professional: [
    svc("Initial consultation", 150, 60),
    svc("Hourly consulting", 175, 60),
    svc("Monthly bookkeeping", 350, null),
    svc("Personal tax return", 180, 60),
    svc("Half-day photo session", 650, 240),
    svc("Logo and brand package", 1200, null),
    svc("Document review", 220, 90),
  ],
  fitness: [
    svc("Personal training session", 75, 60),
    svc("30-minute session", 45, 30),
    svc("10-session pack", 650, 60),
    svc("Small group session", 30, 60),
    svc("Nutrition consultation", 90, 45),
    svc("Monthly membership", 120, null),
    svc("Assessment and program", 110, 60),
  ],
  pets: [
    svc("Full groom (small dog)", 75, 90),
    svc("Full groom (large dog)", 110, 150),
    svc("Bath and brush", 45, 60),
    svc("Nail trim", 18, 15),
    svc("Teeth brushing add-on", 12, 10),
    svc("30-minute dog walk", 25, 30),
    svc("Overnight boarding", 55, null),
    svc("Puppy training session", 80, 60),
  ],
  other: [
    svc("Consultation", 100, 60),
    svc("Standard service", 150, 90),
    svc("Hourly work", 85, 60),
    svc("Small job", 75, 45),
    svc("Large job", 450, 240),
    svc("Follow-up visit", 60, 30),
  ],
};
const SUGGESTED_DESCRIPTIONS = {
  automotive: "Tires, oil changes and brakes for cars and light trucks in <your town>",
  trades: "Residential heating, cooling and hot water — repairs, installs and 24-hour service in <your town>",
  beauty: "Cuts, colour and styling for women and men in <your town>",
  health: "Physiotherapy and massage for sports injuries and everyday pain in <your town>",
  home: "Weekly, deep and move-out cleaning for homes in <your town>",
  professional: "Bookkeeping and tax for small businesses in <your town>, in plain English",
  fitness: "One-on-one and small-group training in <your town>, for beginners and athletes",
  pets: "Dog grooming, baths and nail trims by appointment in <your town>",
  other: "What you do, who it is for and where, in one line",
};
const SUGGESTED_RULES = {
  automotive: ["Tire installs need the vehicle here for at least an hour", "Quote parts and labour separately on every job", "No same-day bookings after 3 PM"],
  trades: ["Every job starts with a written quote the customer approves", "Calls after 6 PM carry an after-hours fee", "Payment is due when the job is done, not later"],
  beauty: ["Colour appointments need a patch test 48 hours before", "Cancellations under 24 hours are charged half the service", "New clients book a consultation before colour work"],
  health: ["First visits are 60 minutes and need the intake form first", "Missed appointments without 24 hours notice are billed in full", "Direct billing to insurance is available on request"],
  home: ["Recurring cleans get 10% off the standard price", "Pets stay in a separate room during the clean", "Cancellations need 48 hours notice"],
  professional: ["Every engagement starts with a signed engagement letter", "Invoices are due in 15 days", "Work outside the retainer is billed by the hour"],
  fitness: ["Sessions cancelled under 12 hours before are charged", "Packages expire 90 days after purchase", "New clients start with an assessment session"],
  pets: ["Vaccination records are needed before the first visit", "Matted coats may need a shave-down at an extra charge", "Pickup is within one hour of the finish text"],
  other: ["Every job gets a written quote before work starts", "Payment is due when the work is done", "Cancellations need 24 hours notice"],
};
const LABEL = {
  business_type: { automotive: "automotive", trades: "trades", beauty: "beauty and personal care", health: "health and wellness", home: "home and property services", professional: "professional services", fitness: "fitness and coaching", pets: "pet care", other: "service" },
  business_stage: { starting: "just getting started", growing: "growing", established: "well established" },
  team_size: { solo: "one-person", small: "small team of 2–5", large: "team of 6 or more" },
  pricing_model: { flat: "flat, per job", hourly: "hourly plus parts", mix: "a mix of flat and hourly" },
  customer_mix: { individuals: "mostly individuals", businesses: "mostly businesses", both: "a mix of individuals and businesses" },
  intake_channels: { phone: "phone calls", text: "texts", online: "online bookings", walkin: "walk-ins", email: "email", social: "social media", referral: "referrals" },
  job_location: { my_place: "at your place", customer_place: "at the customer's place", both: "at your place or the customer's", remote: "remotely" },
  typical_job_length: { under_1h: "under an hour", "1_3h": "1–3 hours", half_day: "half a day", full_day: "a full day", multi_day: "several days" },
  repeat_business: { one_off: "mostly one-off jobs", recurring: "mostly repeat customers", both: "a mix of one-off and repeat work" },
  after_hours: { voicemail: "calls go to voicemail", text_back: "Ledger can text back", emergency: "emergency calls get through", closed: "closed, nothing is answered" },
  booking_lead: { same_day: "same-day bookings are fine", next_day: "bookings need a day's notice", two_plus_days: "bookings need two or more days' notice" },
  payment_methods: { cash: "cash", card: "card", etransfer: "e-transfer", cheque: "cheque", financing: "financing", online: "online payment" },
  payment_terms_days: { "0": "due on receipt", "7": "due in 7 days", "15": "due in 15 days", "30": "due in 30 days" },
  team_roles: { field_crew: "field crew", front_desk: "a front desk", admin: "admin help", other_owners: "other owners" },
  ai_tone: { friendly: "friendly", professional: "professional", brief: "brief and to the point" },
  goals: { more_bookings: "more bookings", get_paid_faster: "get paid faster", fewer_missed_calls: "fewer missed calls", less_admin: "less admin", better_reviews: "better reviews", grow_team: "grow the team" },
};
const REGION_NAME = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
const REGION_TAX = {
  AB: { name: "GST", rate: 0.05 }, NT: { name: "GST", rate: 0.05 }, NU: { name: "GST", rate: 0.05 }, YT: { name: "GST", rate: 0.05 },
  BC: { name: "GST", rate: 0.05, second_name: "PST", second_rate: 0.07 },
  SK: { name: "GST", rate: 0.05, second_name: "PST", second_rate: 0.06 },
  MB: { name: "GST", rate: 0.05, second_name: "RST", second_rate: 0.07 },
  QC: { name: "GST", rate: 0.05, second_name: "QST", second_rate: 0.09975 },
  ON: { name: "HST", rate: 0.13 }, NB: { name: "HST", rate: 0.15 }, NL: { name: "HST", rate: 0.15 }, PE: { name: "HST", rate: 0.15 }, NS: { name: "HST", rate: 0.14 },
};
const regionName = (code) => REGION_NAME[String(code ?? "").toUpperCase()] ?? String(code ?? "");
const pct = (r) => `${Math.round(r * 10000) / 100}%`;
const describeTax = (tax) => `${tax.name} ${pct(tax.rate)}${tax.second_name ? ` + ${tax.second_name} ${pct(tax.second_rate ?? 0)}` : ""}`;
// Currency is "$" in the preview (the mock's choice), so money() is the schema's with the symbol fixed.
const money = (n) => Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
function joinWords(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const labelList = (key, values) => joinWords(values.map((v) => LABEL[key]?.[v] ?? v));
const UNDERSTANDING_MAX = 140;
const typeLines = {
  automotive: "Got it — an automotive business. Vehicles are the unit of work, so bookings will ask which one.",
  trades: "Got it — a trades business. Jobs at the customer's place, no vehicle questions.",
  beauty: "Got it — beauty and personal care. Appointments for a named service, no vehicle questions.",
  health: "Got it — a health and wellness practice. Appointments for a named service, discreet by default.",
  home: "Got it — home and property services. Jobs at the customer's place, often recurring.",
  professional: "Got it — professional services. Appointments, engagements and projects, billed flat or hourly.",
  fitness: "Got it — fitness and coaching. Sessions, classes and memberships.",
  pets: "Got it — pet care. Appointments for a named pet and service.",
  other: "Got it — a service business. Jobs, appointments, customers and invoices, nothing assumed.",
};
const UNDERSTANDING = {
  business_type: typeLines,
  business_stage: {
    starting: "Just getting started — I'll keep setup light and skip anything you don't need yet.",
    growing: "Growing — I'll point you at the steps that bring in more work.",
    established: "Well established — I'll fit around how you already run things.",
  },
  team_size: {
    solo: "Just you — I'll keep admin to a minimum.",
    small: "A team of 2–5 — I'll keep you in the loop on every job.",
    large: "A team of 6 or more — crews, dispatch and oversight are in play.",
  },
  region_code: (v) => {
    const rc = String(v);
    const tax = REGION_TAX[rc];
    return tax ? `${regionName(rc)} — ${describeTax(tax)} is set as a starting point; review it before your first invoice.`
      : `${rc} — no tax rate is set; add yours in Books settings before your first invoice.`;
  },
  timezone: (v) => `Times are read in ${String(v).replace(/_/g, " ")} — hours, bookings and reminders all use it.`,
  business_description: () => "Noted, in your words. I'll describe you to customers from this.",
  services: (v) => { const n = Array.isArray(v) ? v.length : 0; return n ? `${n} service${n === 1 ? "" : "s"} saved — quotes, invoices and bookings use these names and prices.` : ""; },
  pricing_model: (v, all, ctx) => {
    const rate = typeof all.hourly_rate === "number" ? all.hourly_rate : null;
    if (v === "hourly") return rate != null ? `Hourly plus parts at ${money(rate, ctx.currency_code)}/h — your invoices will show hours × rate.` : "Hourly plus parts — your invoices will show hours × rate.";
    if (v === "mix") return rate != null ? `A mix of flat and hourly at ${money(rate, ctx.currency_code)}/h — I'll ask which when it's not obvious.` : "A mix of flat and hourly — I'll ask which when it's not obvious.";
    return "Flat, per job — one price for the work, parts folded in or listed plainly.";
  },
  hourly_rate: (v, all, ctx) => all.pricing_model || typeof v !== "number" ? "" : `${money(v, ctx.currency_code)}/h noted — hourly lines will use it.`,
  quotes_first: (v) => v === true ? "You quote first — I'll draft the quote before a job is booked as work." : v === false ? "No quote step — jobs go straight to booking and invoice." : "",
  job_location: {
    customer_place: "Got it — jobs happen at the customer's place, so bookings will ask for an address.",
    my_place: "Got it — customers come to you, so bookings won't ask for an address.",
    both: "Got it — some jobs at your place, some at theirs; bookings will ask where.",
    remote: "Got it — the work is remote, so bookings won't ask for an address.",
  },
  customer_mix: {
    individuals: "Mostly individuals — plain invoices, payment links and quick turnarounds.",
    businesses: "Mostly businesses — PO numbers, terms and statements are in play.",
    both: "Individuals and businesses — I'll read which one each job is.",
  },
  intake_channels: (v) => Array.isArray(v) && v.length ? `Work comes in by ${labelList("intake_channels", v)} — I'll watch those first.` : "",
  service_area: () => "Service area noted — I'll say where you work when customers ask.",
  typical_job_length: {
    under_1h: "Quick jobs, under an hour — bookings will be short slots.",
    "1_3h": "Jobs run 1–3 hours — bookings will leave room for that.",
    half_day: "Half-day jobs — I'll book each one as one block.",
    full_day: "Full-day jobs — one job takes the day.",
    multi_day: "Multi-day jobs — I'll treat each one as a project, not a slot.",
  },
  repeat_business: {
    one_off: "Mostly one-off jobs — every customer is a fresh start.",
    recurring: "Mostly repeat customers — I'll suggest rebooking and reminders.",
    both: "One-off and repeat — I'll notice who comes back.",
  },
  business_hours: (v) => v ? "Hours saved — bookings, your booking page and your phone line follow them." : "Hours cleared — bookings stay open until you set them.",
  after_hours: {
    voicemail: "After hours, calls go to voicemail — I'll pick them up in the morning.",
    text_back: "After hours, Ledger can text back so nobody waits until morning.",
    emergency: "Emergencies get through after hours — I'll flag those first.",
    closed: "Closed after hours — nothing gets booked or answered until you're open.",
  },
  booking_lead: {
    same_day: "Same-day bookings are fine — I'll offer today's open slots.",
    next_day: "Bookings need a day's notice — I'll offer tomorrow onward.",
    two_plus_days: "Bookings need two days or more — I'll offer from the day after tomorrow.",
  },
  payment_methods: (v) => Array.isArray(v) && v.length ? `You take ${labelList("payment_methods", v)} — I'll say so on invoices.` : "",
  payment_terms_days: (v) => Number(v) === 0 ? "Due on receipt — invoices will say so." : `Due in ${v} days — invoices will show the due date.`,
  deposit: (v, _all, ctx) => {
    const d = v;
    if (!d || d.type === "none") return d ? "No deposit — jobs book without one." : "";
    if (d.type === "percent" && d.value != null) return `A ${d.value}% deposit — I'll mention it on quotes and bookings.`;
    if (d.type === "fixed" && d.value != null) return `A ${money(d.value, ctx.currency_code)} deposit — I'll mention it on quotes and bookings.`;
    return "A deposit up front — I'll mention it on quotes and bookings.";
  },
  team_roles: (v) => Array.isArray(v) && v.length ? `Your team: ${labelList("team_roles", v)} — I'll route work with that in mind.` : "",
  wants_front_desk: (v) => v === true ? "Front Desk is on your list — it needs a Ledger number, and the setup plan shows the step." : v === false ? "No Front Desk for now — you can switch it on later." : "",
  uses_quickbooks: (v) => v === true ? "QuickBooks — connect it from the setup plan and your books stay there." : v === false ? "Built-in books — invoices, estimates and payment links are ready." : "",
  uses_google_calendar: (v) => v === true ? "Google Calendar — connect it and appointments show up there too." : v === false ? "Ledger's own calendar it is — nothing to connect." : "",
  rules: (v) => Array.isArray(v) && v.length ? "Noted, word for word. I'll follow these every time." : "",
  ai_tone: {
    friendly: "Friendly it is — warm and plain, like a good front desk.",
    professional: "Professional — polite, precise, no chit-chat.",
    brief: "Brief — short answers, no filler.",
  },
  goals: (v) => Array.isArray(v) && v.length ? `Your goals: ${labelList("goals", v)} — the setup plan starts there.` : "",
  autonomy: (v) => v ? "Preferences saved — nothing runs on its own until you switch it on." : "",
};
const UNDERSTANDING_PRIORITY = {
  about: ["business_type", "business_stage", "region_code", "team_size", "business_description", "timezone"],
  offer: ["pricing_model", "services", "quotes_first", "hourly_rate"],
  customers: ["job_location", "intake_channels", "customer_mix", "typical_job_length", "repeat_business", "service_area"],
  week: ["after_hours", "business_hours", "booking_lead"],
  money: ["deposit", "payment_terms_days", "payment_methods"],
  team: ["wants_front_desk", "uses_quickbooks", "team_roles", "uses_google_calendar"],
  ledger: ["rules", "goals", "ai_tone", "autonomy"],
};
const UNDERSTANDING_SKIPPED = "Skipped for now — you can come back to it any time from Settings.";
const UNDERSTANDING_SAVED = "Saved.";
function understandingLineFor(key, value, all) {
  const entry = UNDERSTANDING[key];
  if (!entry || value === null || value === undefined) return "";
  if (typeof entry === "function") return entry(value, all, {});
  return entry[String(value)] ?? "";
}
function understandingFor(section, answers) {
  const keys = UNDERSTANDING_PRIORITY[section] ?? [];
  const lines = keys.filter((k) => k in answers).map((k) => understandingLineFor(k, answers[k], answers)).filter(Boolean);
  if (!lines.length) return Object.keys(answers).length ? UNDERSTANDING_SAVED : UNDERSTANDING_SKIPPED;
  let out = lines[0];
  for (const next of lines.slice(1)) { if (`${out} ${next}`.length <= UNDERSTANDING_MAX) out = `${out} ${next}`; else break; }
  return clip(out, UNDERSTANDING_MAX);
}
// Every line for one section, in priority order — the confirm recap shows them all.
function understandingLines(section, answers) {
  return (UNDERSTANDING_PRIORITY[section] ?? []).filter((k) => k in answers).map((k) => understandingLineFor(k, answers[k], answers)).filter(Boolean);
}
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, "")}…`;
}
})();
