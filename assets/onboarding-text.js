/* Onboarding text — a line-by-line port of the server modules that produce every string the sign-up
   onboarding shows (2026-09-19):
     supabase/functions/_shared/onboarding_schema.ts   sections, vocabulary, validation, LABEL / REGION tables,
                                                       understanding lines, suggestions, setup plan
     supabase/functions/_shared/business_brief.ts      briefInput, the owner-voice brief, the first message
     supabase/functions/workspace-profile/onboarding.ts answersOf, mergeAnswers, rowAfterSave, planFacts,
                                                       appliedList, doneMap, sectionsOf
   Used by the website preview (assets/getting-started.js) and the recording mock (tests/onboarding-mock.mjs)
   so both say exactly what production says; tests/onboarding-text.mjs proves it against the oracle fixture.
   Classic script, no dependencies, no I/O: it only assigns globalThis.LedgerOnboardingText.
   Ported, not paraphrased — if a string reads wrong here it reads wrong on the server; fix it there.
   Two things are NOT in the port set and are reproduced from their observed output instead:
     hours.ts  normalizeHours / describeHours ("Mon–Fri 8 AM–5 PM · Sat/Sun closed")
     plan.ts   planAllows(plan, "frontdesk") — the fixture (plan null) shows Front Desk and team seats need
               no plan line, so `pro` is true here. */
(function () {
"use strict";

// =====================================================================================================
// onboarding_schema.ts
// =====================================================================================================
const SCHEMA_VERSION = 1;
const BUSINESS_TYPES = ["automotive", "trades", "beauty", "health", "home", "professional", "fitness", "pets", "other"];

// ---- Sections: fixed ids, order, titles and question counts (CONTRACT §2).
const CONFIRM_SECTION = "confirm";
const STEP_SECTIONS = [
  { id: "about", title: "About your business", questions: 6, keys: ["business_type", "business_description", "business_stage", "team_size", "region_code", "timezone"] },
  { id: "offer", title: "What you offer", questions: 4, keys: ["services", "remove_service_ids", "pricing_model", "hourly_rate", "quotes_first"] },
  { id: "customers", title: "Your customers and how work comes in", questions: 6, keys: ["customer_mix", "intake_channels", "job_location", "service_area", "typical_job_length", "repeat_business"] },
  { id: "week", title: "Your week", questions: 3, keys: ["business_hours", "after_hours", "booking_lead"] },
  { id: "money", title: "Getting paid", questions: 3, keys: ["payment_methods", "payment_terms_days", "deposit"] },
  { id: "team", title: "Your team and tools", questions: 4, keys: ["team_roles", "wants_front_desk", "uses_quickbooks", "uses_google_calendar"] },
  { id: "ledger", title: "How Ledger should work for you", questions: 4, keys: ["ai_tone", "goals", "rules", "autonomy"] },
];
const STEP_IDS = STEP_SECTIONS.map((s) => s.id);
const TOTAL_STEPS = STEP_SECTIONS.length;
const CONFIRM_TITLE = "Here's what Ledger understands";
function isStepId(value) { return STEP_IDS.includes(value); }
function sectionOf(key) { return STEP_SECTIONS.find((s) => s.keys.includes(key))?.id ?? null; }
/// After `ledger` comes `confirm`; `confirm` stays `confirm`.
function nextSection(id) {
  const i = STEP_IDS.indexOf(id);
  return i < 0 || i === STEP_IDS.length - 1 ? CONFIRM_SECTION : STEP_IDS[i + 1];
}

// ---- Vocabulary (CONTRACT §3). Single-value keys, set keys and the rest.
const VOCAB = {
  business_type: BUSINESS_TYPES,
  business_stage: ["starting", "growing", "established"],
  team_size: ["solo", "small", "large"],
  pricing_model: ["flat", "hourly", "mix"],
  customer_mix: ["individuals", "businesses", "both"],
  job_location: ["my_place", "customer_place", "both", "remote"],
  typical_job_length: ["under_1h", "1_3h", "half_day", "full_day", "multi_day"],
  repeat_business: ["one_off", "recurring", "both"],
  after_hours: ["voicemail", "text_back", "emergency", "closed"],
  booking_lead: ["same_day", "next_day", "two_plus_days"],
  ai_tone: ["friendly", "professional", "brief"],
};
const SET_VOCAB = {
  intake_channels: ["phone", "text", "online", "walkin", "email", "social", "referral"],
  payment_methods: ["cash", "card", "etransfer", "cheque", "financing", "online"],
  team_roles: ["field_crew", "front_desk", "admin", "other_owners"],
  goals: ["more_bookings", "get_paid_faster", "fewer_missed_calls", "less_admin", "better_reviews", "grow_team"],
};
const INTAKE_VOCAB = SET_VOCAB.intake_channels;
const TRI_STATE_KEYS = ["quotes_first", "wants_front_desk", "uses_quickbooks", "uses_google_calendar"];
const AUTONOMY_KEYS = ["reminders", "review_replies", "after_hours_texts"];
const PAYMENT_TERMS = [0, 7, 15, 30];
const DEPOSIT_TYPES = ["none", "percent", "fixed"];
const CAPS = {
  business_description: 240, service_area: 200, services: 40, service_name: 80, rules: 5, rule_length: 160, rule_min: 3, goals: 3, timezone: 64,
  duration_min: 5, duration_max: 1440,
};

// Where each key is the truth. workspace = a workspaces column written through
// the shop-profile rules; services = books_item_shortcuts; books = the
// books_default_terms_days column; answers = workspace_onboarding.answers.
const STORE = {
  business_type: "workspace", business_description: "workspace", business_stage: "answers", team_size: "workspace", region_code: "workspace", timezone: "workspace",
  services: "services", remove_service_ids: "services", pricing_model: "workspace", hourly_rate: "answers", quotes_first: "answers",
  customer_mix: "workspace", intake_channels: "workspace", job_location: "workspace", service_area: "workspace", typical_job_length: "answers", repeat_business: "answers",
  business_hours: "workspace", after_hours: "answers", booking_lead: "answers",
  payment_methods: "answers", payment_terms_days: "books", deposit: "answers",
  team_roles: "answers", wants_front_desk: "answers", uses_quickbooks: "answers", uses_google_calendar: "answers",
  ai_tone: "workspace", goals: "answers", rules: "answers", autonomy: "answers",
};
const ANSWER_KEYS = Object.keys(STORE);
const ANSWERS_JSON_KEYS = ANSWER_KEYS.filter((k) => STORE[k] === "answers");
/// The keys applyShopProfile writes (workspace columns, services, terms).
function splitByStore(normalized) {
  const profile = {};
  const answers = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (STORE[key] === "answers") answers[key] = value; else profile[key] = value;
  }
  return { profile, answers };
}

// ---- Plain-English names. FIELD_LABEL names the question in an error;
// LABEL turns a vocab value into the words the owner and the model read.
const FIELD_LABEL = {
  business_type: "Business type", business_description: "Your one-line description", business_stage: "Business stage", team_size: "Team size", region_code: "Region", timezone: "Time zone",
  services: "Services", remove_service_ids: "Services to remove", pricing_model: "How you charge", hourly_rate: "Hourly rate", quotes_first: "Quote first",
  customer_mix: "Who you serve", intake_channels: "How work comes in", job_location: "Where work happens", service_area: "Service area", typical_job_length: "Typical job length", repeat_business: "Repeat business",
  business_hours: "Business hours", after_hours: "After hours", booking_lead: "Booking notice",
  payment_methods: "Payment methods", payment_terms_days: "Payment terms", deposit: "Deposit",
  team_roles: "Team roles", wants_front_desk: "Front Desk", uses_quickbooks: "QuickBooks", uses_google_calendar: "Google Calendar",
  ai_tone: "Ledger's tone", goals: "Goals", rules: "Your rules", autonomy: "What Ledger may do on its own",
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
function regionName(code) { return REGION_NAME[String(code ?? "").toUpperCase()] ?? String(code ?? ""); }

// Canadian sales tax by province — the one default we can set correctly.
// HST provinces get one combined rate. GST+PST provinces (BC, SK, MB, QC)
// carry the provincial tax as a SEPARATE second line — those provinces
// require it shown on its own, and PST does not apply to most services, so
// every invoice line can switch it off (sim bug 14, 2026-09-06). US states
// are never guessed: the tax profile stays at 0% and the app says so.
const REGION_TAX = {
  AB: { name: "GST", rate: 0.05 }, NT: { name: "GST", rate: 0.05 }, NU: { name: "GST", rate: 0.05 }, YT: { name: "GST", rate: 0.05 },
  BC: { name: "GST", rate: 0.05, second_name: "PST", second_rate: 0.07 },
  SK: { name: "GST", rate: 0.05, second_name: "PST", second_rate: 0.06 },
  MB: { name: "GST", rate: 0.05, second_name: "RST", second_rate: 0.07 },
  QC: { name: "GST", rate: 0.05, second_name: "QST", second_rate: 0.09975 },
  ON: { name: "HST", rate: 0.13 }, NB: { name: "HST", rate: 0.15 }, NL: { name: "HST", rate: 0.15 }, PE: { name: "HST", rate: 0.15 }, NS: { name: "HST", rate: 0.14 },
};
const CA_REGIONS = Object.keys(REGION_TAX);
const pct = (r) => `${Math.round(r * 10000) / 100}%`;
function describeTax(tax) {
  return `${tax.name} ${pct(tax.rate)}${tax.second_name ? ` + ${tax.second_name} ${pct(tax.second_rate ?? 0)}` : ""}`;
}

// ---- Normalizing helpers shared by validation and the brief.
const cleanText = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
function currencySymbol(code) {
  const c = String(code ?? "").toUpperCase();
  return !c || c === "CAD" || c === "USD" ? "$" : `${c} `;
}
function money(n, code) {
  const sym = currencySymbol(code);
  return Number.isInteger(n) ? `${sym}${n}` : `${sym}${n.toFixed(2)}`;
}
function joinWords(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const labelList = (key, values) => joinWords(values.map((v) => LABEL[key]?.[v] ?? v));

// ---- Validation (CONTRACT §3). Only the keys sent are checked; the result
// carries normalized values, with null meaning "clear this".
const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const fail = (error) => ({ ok: false, error });

function triState(key, v) {
  if (isBlank(v)) return null;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "yes") return true;
  if (v === "false" || v === "no") return false;
  return fail(`${FIELD_LABEL[key]} must be yes or no.`);
}
function oneOf(key, v) {
  if (isBlank(v)) return null;
  const s = cleanText(v).toLowerCase();
  const vocab = VOCAB[key];
  if (!vocab.includes(s)) return fail(`${FIELD_LABEL[key]} must be one of: ${vocab.join(", ")}.`);
  return s;
}
function setOf(key, v) {
  if (isBlank(v)) return [];
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : null;
  if (!list) return fail(`${FIELD_LABEL[key]} must be a list.`);
  const out = [...new Set(list.map((x) => cleanText(x).toLowerCase()).filter(Boolean))];
  const vocab = SET_VOCAB[key];
  const bad = out.find((x) => !vocab.includes(x));
  if (bad) return fail(`${FIELD_LABEL[key]} can only include: ${vocab.join(", ")}.`);
  return out;
}
function nonNegative(key, v) {
  if (isBlank(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fail(`${FIELD_LABEL[key]} must be a number, 0 or more.`);
  return Math.round(n * 100) / 100;
}
const isValidation = (v) => !!v && typeof v === "object" && "ok" in v;

function validateSection(section, raw, ctx = {}) {
  const spec = STEP_SECTIONS.find((s) => s.id === section);
  if (!spec) return fail(section === CONFIRM_SECTION ? "The last step has nothing to save — finish instead." : "That section does not exist.");
  if (raw === undefined || raw === null) return { ok: true, answers: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return fail("Answers must be an object of question keys.");
  const out = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!spec.keys.includes(key)) return fail(`"${key}" is not a question in ${spec.title}.`);
    if (v === undefined) continue;
    if (VOCAB[key]) { const r = oneOf(key, v); if (isValidation(r)) return r; out[key] = r; continue; }
    if (SET_VOCAB[key]) {
      const r = setOf(key, v); if (isValidation(r)) return r;
      if (key === "goals" && r.length > CAPS.goals) return fail(`Pick up to ${CAPS.goals} goals.`);
      out[key] = key === "team_roles" && ctx.team_size === "solo" ? [] : r;
      continue;
    }
    if (TRI_STATE_KEYS.includes(key)) { const r = triState(key, v); if (isValidation(r)) return r; out[key] = r; continue; }
    switch (key) {
      case "business_description": out[key] = cleanText(v).slice(0, CAPS.business_description) || null; break;
      case "service_area": out[key] = cleanText(v).slice(0, CAPS.service_area) || null; break;
      case "region_code": {
        if (isBlank(v)) { out[key] = null; break; }
        const rc = cleanText(v).toUpperCase();
        if (!/^[A-Z]{2}$/.test(rc)) return fail("Region must be a two-letter province or state code, like AB or TX.");
        out[key] = rc; break;
      }
      case "timezone": {
        // The zone cannot be cleared — bootstrap always sets one — so blank leaves it alone.
        if (isBlank(v)) break;
        const tz = cleanText(v);
        if (tz.length > CAPS.timezone) return fail("Choose a valid business timezone.");
        try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); } catch { return fail("Choose a valid business timezone."); }
        out[key] = tz; break;
      }
      case "hourly_rate": { const r = nonNegative(key, v); if (isValidation(r)) return r; out[key] = r; break; }
      case "services": {
        if (isBlank(v)) { out[key] = []; break; }
        if (!Array.isArray(v)) return fail("Services must be a list.");
        if (v.length > CAPS.services) return fail(`Up to ${CAPS.services} services at a time.`);
        const list = [];
        for (const item of v) {
          if (!item || typeof item !== "object") return fail("Each service needs a name and a price.");
          const r = item;
          const name = cleanText(r.name);
          if (!name) continue;
          if (name.length > CAPS.service_name) return fail(`Service names must be ${CAPS.service_name} characters or fewer.`);
          const price = Number(r.price ?? 0);
          if (!Number.isFinite(price) || price < 0) return fail(`Prices must be a number, 0 or more — check "${name}".`);
          let duration = null;
          if (!isBlank(r.duration_minutes)) {
            const d = Number(r.duration_minutes);
            if (!Number.isInteger(d) || d < CAPS.duration_min || d > CAPS.duration_max) return fail(`Durations must be whole minutes between ${CAPS.duration_min} and ${CAPS.duration_max} — check "${name}".`);
            duration = d;
          }
          list.push({ ...(typeof r.id === "string" && r.id ? { id: r.id } : {}), name, price: Math.round(price * 100) / 100, duration_minutes: duration });
        }
        out[key] = list; break;
      }
      case "remove_service_ids": {
        if (isBlank(v)) { out[key] = []; break; }
        if (!Array.isArray(v)) return fail("Services to remove must be a list of ids.");
        out[key] = [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))]; break;
      }
      case "business_hours": {
        if (isBlank(v)) { out[key] = null; break; }
        try { out[key] = normalizeHours(v); } catch (e) { return fail(e instanceof Error ? e.message : "Business hours must be a list of days."); }
        break;
      }
      case "payment_terms_days": {
        if (isBlank(v)) { out[key] = 0; break; }
        const n = Number(v);
        if (!PAYMENT_TERMS.includes(n)) return fail(`Payment terms must be ${PAYMENT_TERMS.slice(0, -1).join(", ")} or ${PAYMENT_TERMS[PAYMENT_TERMS.length - 1]} days.`);
        out[key] = n; break;
      }
      case "deposit": {
        if (isBlank(v)) { out[key] = null; break; }
        if (typeof v !== "object") return fail("Deposit must say a type and an amount.");
        const d = v;
        const type = cleanText(d.type).toLowerCase();
        if (!DEPOSIT_TYPES.includes(type)) return fail(`Deposit type must be one of: ${DEPOSIT_TYPES.join(", ")}.`);
        if (type === "none") { out[key] = { type, value: null }; break; }
        const value = nonNegative("deposit", d.value); if (isValidation(value)) return value;
        if (type === "percent" && value != null && value > 100) return fail("A percent deposit must be between 0 and 100.");
        out[key] = { type, value }; break;
      }
      case "rules": {
        if (isBlank(v)) { out[key] = []; break; }
        if (!Array.isArray(v)) return fail("Your rules must be a list of short sentences.");
        const rules = v.map(cleanText).filter(Boolean);
        if (rules.length > CAPS.rules) return fail(`Up to ${CAPS.rules} rules — keep the ones that matter most.`);
        const long = rules.find((r) => r.length > CAPS.rule_length);
        if (long) return fail(`Each rule must be ${CAPS.rule_length} characters or fewer.`);
        const short = rules.find((r) => r.length < CAPS.rule_min);
        if (short) return fail(`Each rule needs at least ${CAPS.rule_min} characters.`);
        out[key] = [...new Set(rules)]; break;
      }
      case "autonomy": {
        if (isBlank(v)) { out[key] = null; break; }
        if (typeof v !== "object" || Array.isArray(v)) return fail("What Ledger may do on its own must be a set of yes/no answers.");
        const a = {};
        for (const [k, val] of Object.entries(v)) {
          if (!AUTONOMY_KEYS.includes(k)) return fail(`"${k}" is not one of the things Ledger can do on its own.`);
          const r = triState("autonomy", val); if (isValidation(r)) return r;
          a[k] = r;
        }
        out[key] = a; break;
      }
      default: return fail(`"${key}" is not a question in ${spec.title}.`);
    }
  }
  return { ok: true, answers: out };
}

// ---- Understanding lines (CONTRACT §8): one ≤140-char line in Ledger's voice
// for what was just saved. Deterministic; combined by priority when a save
// carries several keys.
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
// Which key speaks first when a save carries several.
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
function understandingLineFor(key, value, all, ctx = {}) {
  const entry = UNDERSTANDING[key];
  if (!entry || value === null || value === undefined) return "";
  if (typeof entry === "function") return entry(value, all, ctx);
  return entry[String(value)] ?? "";
}
function understandingFor(section, answers, ctx = {}) {
  const keys = UNDERSTANDING_PRIORITY[section] ?? [];
  const lines = keys.filter((k) => k in answers).map((k) => understandingLineFor(k, answers[k], answers, ctx)).filter(Boolean);
  if (!lines.length) return Object.keys(answers).length ? UNDERSTANDING_SAVED : UNDERSTANDING_SKIPPED;
  let out = lines[0];
  for (const next of lines.slice(1)) { if (`${out} ${next}`.length <= UNDERSTANDING_MAX) out = `${out} ${next}`; else break; }
  return clip(out, UNDERSTANDING_MAX);
}
/// Cuts at a word boundary and closes with an ellipsis when it had to cut.
function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, "")}…`;
}

// ---- Suggestions (CONTRACT §4): server-owned examples so both clients say
// the same thing. Prices are examples in the workspace currency; clients label
// them "example — change it". Durations are booking slots, null = not booked
// by the minute (a package, a month, an overnight).
const SUGGESTED_SERVICES = {
  automotive: [
    { name: "Oil change", price: 80, duration_minutes: 45 },
    { name: "Seasonal tire swap", price: 60, duration_minutes: 45 },
    { name: "Mount and balance (4 tires)", price: 120, duration_minutes: 60 },
    { name: "Flat repair", price: 35, duration_minutes: 30 },
    { name: "Brake pads and rotors (per axle)", price: 350, duration_minutes: 120 },
    { name: "Wheel alignment", price: 120, duration_minutes: 60 },
    { name: "Battery replacement", price: 190, duration_minutes: 30 },
    { name: "Full detail", price: 200, duration_minutes: 180 },
  ],
  trades: [
    { name: "Service call and diagnosis", price: 130, duration_minutes: 60 },
    { name: "Furnace tune-up", price: 150, duration_minutes: 90 },
    { name: "AC tune-up", price: 150, duration_minutes: 90 },
    { name: "Hot water tank replacement", price: 1850, duration_minutes: 240 },
    { name: "Drain cleaning", price: 200, duration_minutes: 90 },
    { name: "Thermostat install", price: 250, duration_minutes: 60 },
    { name: "After-hours emergency call", price: 250, duration_minutes: 60 },
  ],
  beauty: [
    { name: "Haircut", price: 45, duration_minutes: 45 },
    { name: "Cut and blow-dry", price: 65, duration_minutes: 60 },
    { name: "Root colour", price: 95, duration_minutes: 90 },
    { name: "Full highlights", price: 165, duration_minutes: 150 },
    { name: "Balayage", price: 220, duration_minutes: 180 },
    { name: "Beard trim", price: 25, duration_minutes: 20 },
    { name: "Blow-dry", price: 40, duration_minutes: 40 },
    { name: "Gel manicure", price: 55, duration_minutes: 60 },
  ],
  health: [
    { name: "Initial assessment", price: 120, duration_minutes: 60 },
    { name: "Follow-up visit", price: 85, duration_minutes: 45 },
    { name: "60-minute massage", price: 110, duration_minutes: 60 },
    { name: "90-minute massage", price: 150, duration_minutes: 90 },
    { name: "Adjustment", price: 65, duration_minutes: 20 },
    { name: "Extended visit", price: 130, duration_minutes: 60 },
  ],
  home: [
    { name: "Standard clean", price: 160, duration_minutes: 120 },
    { name: "Deep clean", price: 280, duration_minutes: 240 },
    { name: "Move-out clean", price: 350, duration_minutes: 300 },
    { name: "Lawn cut", price: 45, duration_minutes: 30 },
    { name: "Spring yard clean-up", price: 220, duration_minutes: 180 },
    { name: "Gutter cleaning", price: 180, duration_minutes: 90 },
    { name: "Handyman hour", price: 85, duration_minutes: 60 },
    { name: "Exterior window cleaning", price: 150, duration_minutes: 120 },
  ],
  professional: [
    { name: "Initial consultation", price: 150, duration_minutes: 60 },
    { name: "Hourly consulting", price: 175, duration_minutes: 60 },
    { name: "Monthly bookkeeping", price: 350, duration_minutes: null },
    { name: "Personal tax return", price: 180, duration_minutes: 60 },
    { name: "Half-day photo session", price: 650, duration_minutes: 240 },
    { name: "Logo and brand package", price: 1200, duration_minutes: null },
    { name: "Document review", price: 220, duration_minutes: 90 },
  ],
  fitness: [
    { name: "Personal training session", price: 75, duration_minutes: 60 },
    { name: "30-minute session", price: 45, duration_minutes: 30 },
    { name: "10-session pack", price: 650, duration_minutes: 60 },
    { name: "Small group session", price: 30, duration_minutes: 60 },
    { name: "Nutrition consultation", price: 90, duration_minutes: 45 },
    { name: "Monthly membership", price: 120, duration_minutes: null },
    { name: "Assessment and program", price: 110, duration_minutes: 60 },
  ],
  pets: [
    { name: "Full groom (small dog)", price: 75, duration_minutes: 90 },
    { name: "Full groom (large dog)", price: 110, duration_minutes: 150 },
    { name: "Bath and brush", price: 45, duration_minutes: 60 },
    { name: "Nail trim", price: 18, duration_minutes: 15 },
    { name: "Teeth brushing add-on", price: 12, duration_minutes: 10 },
    { name: "30-minute dog walk", price: 25, duration_minutes: 30 },
    { name: "Overnight boarding", price: 55, duration_minutes: null },
    { name: "Puppy training session", price: 80, duration_minutes: 60 },
  ],
  other: [
    { name: "Consultation", price: 100, duration_minutes: 60 },
    { name: "Standard service", price: 150, duration_minutes: 90 },
    { name: "Hourly work", price: 85, duration_minutes: 60 },
    { name: "Small job", price: 75, duration_minutes: 45 },
    { name: "Large job", price: 450, duration_minutes: 240 },
    { name: "Follow-up visit", price: 60, duration_minutes: 30 },
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
function suggestions() {
  return { services: SUGGESTED_SERVICES, descriptions: SUGGESTED_DESCRIPTIONS, rules: SUGGESTED_RULES };
}

// ---- Setup plan (CONTRACT §6–7). The brain computes; clients only render.
const PLAN_ACTIONS = ["services_import", "books_choice", "tax_review", "hours", "phone_front_desk", "reminders", "google_calendar", "google_business", "team_invite", "add_card", "booking_link", "first_invoice", "first_booking"];
const SETUP_PLAN_MAX = 7;
// plan.ts is not in the port set. PLANS.pro is Ledger Pro at $699/month on the site; planAllows(null, "frontdesk")
// is true in the fixture (no plan line on Front Desk or team seats), so `pro` is always true here.
const PRO = "Ledger Pro ($699/month)";
const PLAN_NEEDS = {
  number: "A Ledger business number.",
  number_and_pro: `A Ledger business number and ${PRO}.`,
  pro_seats: `${PRO} for teammate logins — crew and customers are always free.`,
};
const planAllows = (_plan, _feature) => true;
function setupPlan(input) {
  const a = input.answers ?? {};
  const done = input.done ?? {};
  const goals = new Set(Array.isArray(a.goals) ? a.goals : []);
  const intake = new Set(Array.isArray(a.intake_channels) ? a.intake_channels : []);
  const services = Array.isArray(a.services) ? a.services : [];
  const solo = a.team_size === "solo";
  const atCustomer = a.job_location === "customer_place" || a.job_location === "both";
  const pro = planAllows(input.plan, "frontdesk");
  const hasNumber = input.has_business_number === true;
  const region = typeof a.region_code === "string" ? a.region_code : "";
  const tax = REGION_TAX[region];
  const candidates = [];
  const add = (item) => candidates.push(item);

  const booksDetail = a.uses_quickbooks === true ? "Connect QuickBooks."
    : a.uses_quickbooks === false ? "Built-in books are ready."
    : "Already on QuickBooks? Connect it. Otherwise the built-in books handle invoices, estimates and payment links.";
  add({ id: "books_choice", action: "books_choice", title: "Choose your books", detail: booksDetail, done: done.books_choice === true, score: a.uses_quickbooks === true ? 100 : 60 });

  if (a.wants_front_desk === true || goals.has("fewer_missed_calls") || intake.has("phone")) {
    const detail = a.wants_front_desk === true ? "You said you want Ledger to answer what you miss. Front Desk texts back, books and takes messages."
      : goals.has("fewer_missed_calls") ? "You said you miss calls. Front Desk texts back, books and takes messages."
      : "Work comes in by phone. Front Desk texts back, books and takes messages.";
    const needs = !hasNumber && !pro ? PLAN_NEEDS.number_and_pro : !hasNumber ? PLAN_NEEDS.number : !pro ? `${PRO}.` : undefined;
    add({ id: "phone_front_desk", action: "phone_front_desk", title: "Let Ledger answer missed calls and texts", detail, done: done.phone_front_desk === true, ...(needs ? { needs } : {}),
      score: a.wants_front_desk === true ? 95 : goals.has("fewer_missed_calls") ? 90 : 85 });
  }
  if (goals.has("more_bookings") || intake.has("online")) {
    add({ id: "booking_link", action: "booking_link", title: "Share your booking link",
      detail: atCustomer ? "Customers pick a time and give the address where the work happens — at the customer's place." : "Customers pick a service and a time from a link you share.",
      done: done.booking_link === true, score: goals.has("more_bookings") ? 80 : 75 });
  }
  if (goals.has("get_paid_faster")) {
    add({ id: "first_invoice", action: "first_invoice", title: "Send your first invoice", detail: "Create one real invoice and check it before sending — payment links get you paid faster.", done: done.first_invoice === true, score: 78 });
    if (!input.card_on_file) add({ id: "add_card", action: "add_card", title: "Add a card", detail: "Keep Ledger running after your trial so invoices and payment links keep going out.", done: false, score: 70 });
  } else {
    add({ id: "first_invoice", action: "first_invoice", title: "Send your first invoice", detail: "Create one real invoice and check it before sending.", done: done.first_invoice === true, score: 30 });
  }
  if (goals.has("less_admin")) {
    add({ id: "reminders", action: "reminders", title: "Turn on appointment reminders", detail: "Ledger texts customers the day before so fewer people forget.", done: done.reminders === true, ...(hasNumber ? {} : { needs: PLAN_NEEDS.number }), score: 68 });
  }
  if (goals.has("better_reviews") || goals.has("more_bookings")) {
    add({ id: "google_business", action: "google_business", title: "Connect your Google Business Profile", detail: goals.has("better_reviews") ? "Reply to reviews and post updates from Ledger." : "Post updates and reply to reviews so new customers find you.", done: done.google_business === true, score: goals.has("better_reviews") ? 65 : 62 });
  }
  if (!solo && (goals.has("grow_team") || a.team_size === "large")) {
    add({ id: "team_invite", action: "team_invite", title: "Add your team", detail: "Crew get free logins for jobs and time; teammates who run the business need a seat.", done: done.team_invite === true, ...(pro ? {} : { needs: PLAN_NEEDS.pro_seats }), score: 66 });
  }
  if (a.uses_google_calendar === true) {
    add({ id: "google_calendar", action: "google_calendar", title: "Connect Google Calendar", detail: "Ledger has its own calendar; connect Google so appointments show up there too.", done: done.google_calendar === true, score: 58 });
  }
  if (!services.length) {
    add({ id: "services_import", action: "services_import", title: "Add your services and prices", detail: "Your price list drives quotes, invoices and bookings.", done: done.services_import === true, score: 55 });
  }
  add({ id: "hours", action: "hours", title: "Set your hours", detail: atCustomer ? "Bookings at the customer's place, your booking page and your phone line all follow them." : "Bookings, your booking page and your phone line all follow them.", done: done.hours === true, score: 50 });
  add({ id: "tax_review", action: "tax_review", title: "Review your tax setup", detail: tax ? `${describeTax(tax)} is set as a starting point for ${regionName(region)} — check it before your first invoice.` : "Check registration, rates and exemptions before your first invoice.", done: done.tax_review === true, score: 45 });
  add({ id: "first_booking", action: "first_booking", title: "Book your first appointment", detail: atCustomer ? "Create one appointment at the customer's place and check the reminder and the calendar." : "Create one appointment and check the reminder and the calendar.", done: done.first_booking === true, score: 28 });

  // Relevance first, then the things already done sink to the end.
  candidates.sort((x, y) => Number(x.done) - Number(y.done) || y.score - x.score);
  return candidates.slice(0, SETUP_PLAN_MAX).map(({ score: _score, ...item }) => item);
}

// =====================================================================================================
// hours.ts — not in the port set. Reproduced from what the server stores and prints:
//   business_hours is an object keyed mon..sun, each { open: "HH:MM", close: "HH:MM" } or null;
//   describeHours → "Mon–Fri 8 AM–5 PM · Sat/Sun closed" / "Mon–Fri 7 AM–6 PM · Sat 9 AM–1 PM · Sun closed".
// =====================================================================================================
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAYL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
function normalizeHours(v) {
  const src = Array.isArray(v) ? Object.fromEntries(v.map((d) => [String(d?.day ?? "").toLowerCase(), d])) : v;
  if (!src || typeof src !== "object") throw new Error("Business hours must be a list of days.");
  const h = {};
  for (const d of DAYS) {
    const day = src[d];
    if (!day || (day.open == null && day.close == null)) { h[d] = null; continue; }
    if (!/^\d\d:\d\d$/.test(String(day.open)) || !/^\d\d:\d\d$/.test(String(day.close))) throw new Error(`${DAYL[d]}: times must look like 08:00 and 17:00.`);
    if (day.open >= day.close) throw new Error(`${DAYL[d]}: closing time must be after opening time.`);
    h[d] = { open: day.open, close: day.close };
  }
  return DAYS.some((d) => h[d]) ? h : null;
}
const prettyTime = (t) => { const [h, m] = t.split(":").map(Number); const s = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, "0")} ${s}` : `${h12} ${s}`; };
function describeHours(h) {
  if (!h || !DAYS.some((d) => h[d])) return "";
  const groups = [];
  for (const d of DAYS) { const t = h[d] ? `${prettyTime(h[d].open)}–${prettyTime(h[d].close)}` : "closed"; const last = groups[groups.length - 1]; if (last && last.text === t) last.days.push(d); else groups.push({ days: [d], text: t }); }
  return groups.map((g) => `${g.days.length > 2 ? `${DAYL[g.days[0]]}–${DAYL[g.days[g.days.length - 1]]}` : g.days.map((d) => DAYL[d]).join("/")} ${g.text}`).join(" · ");
}

// =====================================================================================================
// business_brief.ts (owner voice and the first message)
// =====================================================================================================
/// Folds a workspaces row, the onboarding row and the service list into one
/// flat input. Columns win over answers for the keys they own. Payment terms
/// come from the books column, which defaults to 0: that only counts as an
/// answer once it is non-zero or the owner has been through "Getting paid".
function briefInput(ws, onboarding, services) {
  const a = onboarding?.answers ?? {};
  const s = (k) => (typeof ws[k] === "string" && ws[k].trim() ? ws[k] : null);
  const list = (k) => (Array.isArray(ws[k]) ? ws[k].filter(Boolean) : null);
  const moneyDone = (onboarding?.sections_done ?? []).includes("money");
  const rawTerms = typeof ws.books_default_terms_days === "number" ? ws.books_default_terms_days : null;
  const terms = rawTerms != null && (rawTerms !== 0 || moneyDone) ? rawTerms : null;
  return {
    name: String(ws.name ?? ""),
    currency_code: s("currency_code"),
    ai_call_me: s("ai_call_me"),
    business_type: s("business_type"),
    business_description: s("business_description"),
    team_size: s("team_size"),
    region_code: s("region_code"),
    timezone: s("timezone"),
    pricing_model: s("pricing_model"),
    customer_mix: s("customer_mix"),
    intake_channels: list("intake_channels"),
    job_location: s("job_location"),
    service_area: s("service_area"),
    business_hours: ws.business_hours ?? null,
    ai_tone: s("ai_tone"),
    services: services ?? null,
    payment_terms_days: terms,
    business_stage: str(a.business_stage), hourly_rate: num(a.hourly_rate), quotes_first: bool(a.quotes_first),
    typical_job_length: str(a.typical_job_length), repeat_business: str(a.repeat_business),
    after_hours: str(a.after_hours), booking_lead: str(a.booking_lead),
    payment_methods: strs(a.payment_methods), deposit: (a.deposit && typeof a.deposit === "object" ? a.deposit : null),
    team_roles: strs(a.team_roles), wants_front_desk: bool(a.wants_front_desk), uses_quickbooks: bool(a.uses_quickbooks), uses_google_calendar: bool(a.uses_google_calendar),
    goals: strs(a.goals), rules: strs(a.rules), autonomy: (a.autonomy && typeof a.autonomy === "object" ? a.autonomy : null),
  };
}
const str = (v) => (typeof v === "string" && v.trim() ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v) => (typeof v === "boolean" ? v : null);
const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : null);

const OWNER_IDENTITY = {
  automotive: "You run an automotive business.",
  trades: "You run a trades business.",
  beauty: "You run a beauty and personal-care business.",
  health: "You run a health and wellness practice.",
  home: "You run a home and property services business.",
  professional: "You run a professional services business.",
  fitness: "You run a fitness and coaching business.",
  pets: "You run a pet-care business.",
  other: "You run a service business.",
  unset: "You have not said what kind of business you run yet.",
};
const OWNER_STAGE = { starting: "You're just getting started.", growing: "You're growing.", established: "You're well established." };
const OWNER_TEAM = { solo: "It's just you.", small: "You have a small team of 2–5.", large: "You have a team of 6 or more." };
const OWNER_PRICING = { flat: "You charge flat, per job.", hourly: "You charge hourly plus parts.", mix: "You charge a mix of flat and hourly." };
const OWNER_MIX = { individuals: "Your customers are mostly individuals.", businesses: "Your customers are mostly businesses.", both: "Your customers are a mix of individuals and businesses." };
const OWNER_LOCATION = { my_place: "Customers come to you.", customer_place: "You work at the customer's place.", both: "Some jobs at your place, some at theirs.", remote: "You work remotely." };
const OWNER_LENGTH = { under_1h: "A typical job is under an hour.", "1_3h": "A typical job runs 1–3 hours.", half_day: "A typical job takes half a day.", full_day: "A typical job takes a full day.", multi_day: "A typical job runs several days." };
const OWNER_REPEAT = { one_off: "Mostly one-off jobs.", recurring: "Mostly repeat customers.", both: "A mix of one-off and repeat work." };
const OWNER_AFTER_HOURS = { voicemail: "After hours, calls go to voicemail.", text_back: "After hours, Ledger can text back.", emergency: "Emergencies get through after hours.", closed: "You're closed after hours." };
const OWNER_LEAD = { same_day: "Same-day bookings are fine.", next_day: "Bookings need a day's notice.", two_plus_days: "Bookings need two or more days' notice." };
const OWNER_TONE = { friendly: "Ledger will sound friendly.", professional: "Ledger will sound professional.", brief: "Ledger will keep it brief." };
const OWNER_TOOLS = {
  uses_quickbooks: { true: "Your books are in QuickBooks.", false: "You use the built-in books." },
  uses_google_calendar: { true: "You also use Google Calendar.", false: "" },
  wants_front_desk: { true: "You want Ledger to answer what you miss.", false: "" },
  quotes_first: { true: "You quote before you book.", false: "No quote step — straight to booking." },
};

const pick = (table, v) => (v ? table[v] ?? "" : "");
const tri = (table, key, v) => (v === true || v === false ? table[key]?.[String(v)] ?? "" : "");
const hoursText = (h) => { try { return describeHours(h ?? null); } catch { return ""; } };
const quote = (s) => `"${s.replace(/"/g, "'")}"`;

function depositLine(d, cur, voice) {
  if (!d || !d.type) return "";
  if (d.type === "none") return voice === "ai" ? "No deposit is taken." : "No deposit.";
  const amount = d.type === "percent" && d.value != null ? `${d.value}%` : d.type === "fixed" && d.value != null ? money(d.value, cur) : "";
  if (!amount) return voice === "ai" ? "A deposit is taken up front — mention it on quotes and bookings." : "You take a deposit up front.";
  return voice === "ai" ? `A ${amount} deposit is taken up front — mention it on quotes and bookings.` : `You take a ${amount} deposit up front.`;
}
function termsLine(days, voice) {
  if (days == null) return "";
  const label = LABEL.payment_terms_days[String(days)] ?? `due in ${days} days`;
  return voice === "ai" ? `Invoices are ${label}.` : `Your invoices are ${label}.`;
}
function pricingLine(input, voice) {
  const base = pick(OWNER_PRICING, input.pricing_model);
  const rate = input.hourly_rate != null ? money(input.hourly_rate, input.currency_code) : "";
  if (!rate) return base;
  return base ? `${base.replace(/\.$/, "")} at ${rate}/h.` : `Your hourly rate is ${rate}/h.`;
}
const RULES_LINE_OWNER = "Your rules:";

function renderBusinessBrief(input, opts) {
  if (opts.voice !== "owner") throw new Error("Only the owner voice is ported.");
  return renderOwner(input);
}

function renderOwner(input) {
  const cur = input.currency_code;
  const type = input.business_type ?? "unset";
  const description = cleanText(input.business_description);
  const area = cleanText(input.service_area);
  const hours = hoursText(input.business_hours);
  const services = (input.services ?? []).filter((s) => s && s.name);
  const sentence = (parts) => parts.filter(Boolean).join(" ");
  // Ten lines at most before the rules, grouped: who / words / offer / customers / week / money / team / Ledger.
  const groups = [
    [sentence([
      (OWNER_IDENTITY[type] ?? OWNER_IDENTITY.other).replace(/\.$/, input.region_code ? ` in ${regionName(input.region_code)}.` : "."),
      pick(OWNER_TEAM, input.team_size), pick(OWNER_STAGE, input.business_stage),
    ])],
    [description ? `In your words: ${quote(description)}` : ""],
    [
      services.length ? `${services.length} service${services.length === 1 ? "" : "s"} on your price list${services.length <= 3 ? `: ${joinWords(services.map((s) => s.name))}` : ""}.` : "",
      sentence([pricingLine(input, "owner"), tri(OWNER_TOOLS, "quotes_first", input.quotes_first)]),
    ],
    [
      sentence([pick(OWNER_MIX, input.customer_mix), input.intake_channels?.length ? `Work comes in by ${labelList("intake_channels", input.intake_channels)}.` : ""]),
      sentence([pick(OWNER_LOCATION, input.job_location), area ? `Service area: ${area}.` : "", pick(OWNER_LENGTH, input.typical_job_length), pick(OWNER_REPEAT, input.repeat_business)]),
    ],
    [sentence([hours ? `Hours: ${hours}.` : "", pick(OWNER_AFTER_HOURS, input.after_hours), pick(OWNER_LEAD, input.booking_lead)])],
    [sentence([
      input.payment_methods?.length ? `You take ${labelList("payment_methods", input.payment_methods)}.` : "",
      termsLine(input.payment_terms_days, "owner"), depositLine(input.deposit, cur, "owner"),
    ])],
    [sentence([
      input.team_roles?.length ? `Your team: ${labelList("team_roles", input.team_roles)}.` : "",
      tri(OWNER_TOOLS, "uses_quickbooks", input.uses_quickbooks), tri(OWNER_TOOLS, "uses_google_calendar", input.uses_google_calendar), tri(OWNER_TOOLS, "wants_front_desk", input.wants_front_desk),
    ])],
    [sentence([pick(OWNER_TONE, input.ai_tone), input.goals?.length ? `Your goals: ${labelList("goals", input.goals)}.` : ""])],
  ];
  const rules = (input.rules ?? []).map(cleanText).filter(Boolean);
  if (rules.length) groups.push([RULES_LINE_OWNER, ...rules.map(quote)]);
  return groups.map((g) => g.filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
}

const FIRST_MESSAGE_MAX = 280;
const FIRST_TYPE = {
  automotive: "an automotive business", trades: "a trades business", beauty: "a beauty and personal-care business", health: "a health and wellness practice",
  home: "a home and property services business", professional: "a professional services business", fitness: "a fitness and coaching business", pets: "a pet-care business", other: "a service business",
};
const FIRST_LOCATION = { my_place: "with customers coming to you", customer_place: "working at the customer's place", both: "working at your place or theirs", remote: "working remotely" };
const FIRST_PRICING = { flat: "charging flat per job", hourly: "charging hourly plus parts", mix: "charging a mix of flat and hourly" };
const FIRST_MIX = { individuals: "mostly for individuals", businesses: "mostly for businesses", both: "for individuals and businesses" };
const FIRST_TAIL = "Ask me anything, or tap a next step below.";
function renderFirstMessage(input) {
  const callMe = cleanText(input.ai_call_me);
  const greet = callMe && callMe.toLowerCase() !== "boss" ? `Hi ${callMe} — ` : "";
  const biz = cleanText(input.name) || "Your business";
  const known = [pick(FIRST_TYPE, input.business_type), pick(FIRST_LOCATION, input.job_location), pick(FIRST_PRICING, input.pricing_model), pick(FIRST_MIX, input.customer_mix)].filter(Boolean);
  const build = (facts) => `${greet}${biz} is set up.${facts.length ? ` I know you're ${facts.join(", ")}.` : ""} ${FIRST_TAIL}`;
  let facts = known;
  let text = build(facts);
  while (text.length > FIRST_MESSAGE_MAX && facts.length) { facts = facts.slice(0, -1); text = build(facts); }
  return text.length > FIRST_MESSAGE_MAX ? clip(text, FIRST_MESSAGE_MAX) : text;
}

// =====================================================================================================
// workspace-profile/onboarding.ts
// =====================================================================================================
function sectionsOf(row) {
  const done = new Set(row?.sections_done ?? []);
  const skipped = new Set(row?.sections_skipped ?? []);
  return STEP_SECTIONS.map((s) => ({ id: s.id, title: s.title, done: done.has(s.id), skipped: !done.has(s.id) && skipped.has(s.id) }));
}
function statusOf(row, legacyProfileDone = false) { return row?.status ?? (legacyProfileDone ? "skipped" : "not_started"); }
function currentSectionOf(row) {
  const cur = row?.current_section;
  return cur && [...STEP_IDS, CONFIRM_SECTION].includes(cur) ? cur : STEP_IDS[0];
}
/// The `onboarding` object `get` and `readiness` carry.
function onboardingSummary(row, legacyProfileDone = false) {
  return { status: statusOf(row, legacyProfileDone), current_section: currentSectionOf(row), done_count: sectionsOf(row).filter((s) => s.done).length, total: TOTAL_STEPS };
}

/// The answers view: workspace columns and the service list for the keys they
/// own, the answers json for the rest. Only answered keys appear.
function answersOf(ws, services, row) {
  const out = {};
  const put = (key, value) => {
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value) && !value.length) return;
    if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) return;
    out[key] = value;
  };
  for (const key of ["business_type", "business_description", "team_size", "region_code", "timezone", "pricing_model", "customer_mix", "intake_channels", "job_location", "service_area", "business_hours", "ai_tone"]) put(key, ws[key]);
  put("services", services.map((s) => ({ ...("id" in s && s.id ? { id: s.id } : {}), name: s.name, price: s.price, duration_minutes: s.duration_minutes ?? null })));
  // Terms default to 0 on every workspace, so 0 only counts once the money step was answered.
  const terms = typeof ws.books_default_terms_days === "number" ? ws.books_default_terms_days : null;
  if (terms != null && (terms !== 0 || (row?.sections_done ?? []).includes("money"))) out.payment_terms_days = terms;
  const json = row?.answers ?? {};
  for (const key of ANSWERS_JSON_KEYS) put(key, json[key]);
  return out;
}

/// Merges one validated save into the stored json: null and empty clear.
function mergeAnswers(existing, incoming) {
  const out = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) delete out[key];
    else out[key] = value;
  }
  return out;
}

/// The next onboarding row after a save. `skip` without answers marks the
/// section skipped instead of done; either way the cursor moves on.
function rowAfterSave(row, section, next, answered, skip, now) {
  const done = new Set(row?.sections_done ?? []);
  const skipped = new Set(row?.sections_skipped ?? []);
  if (answered || !skip) { done.add(section); skipped.delete(section); } else { skipped.add(section); done.delete(section); }
  return {
    schema_version: SCHEMA_VERSION,
    status: row?.status === "complete" ? "complete" : "in_progress",
    current_section: next,
    sections_done: STEP_IDS.filter((id) => done.has(id)),
    sections_skipped: STEP_IDS.filter((id) => skipped.has(id)),
    started_at: row?.started_at ?? now,
    updated_at: now,
  };
}

// ---- Memory facts (CONTRACT §4 complete). Rules become pinned owner facts;
// goals become one pinned fact updated in place. The key is stable per rule
// text so re-completing neither duplicates nor loses anything.
// The server keys a rule by a SHA-256 of its normalized text (async); this port has no memory rows to
// match against, so the normalized text itself is the key — the counts come out the same.
const MEMORY_MAX_PER_WORKSPACE = 400;
const GOALS_FACT_KEY = "onb:goals";
const RULE_FACT_PREFIX = "onb:rule:";
const MAX_ONBOARDING_FACTS = 6;
const normalizeRuleText = (text) => cleanText(text).toLowerCase().replace(/[.\s]+$/, "");
const ruleFactKey = (text) => `${RULE_FACT_PREFIX}${normalizeRuleText(text)}`;
const goalsFactText = (goals) => `Owner's goals: ${labelList("goals", goals)}.`;
/// Decides what to write given the rules and goals answered, the onboarding
/// facts already active and how many active facts the workspace holds.
function planFacts(rules, goals, existing, activeCount, maxPerWorkspace) {
  const wanted = [];
  for (const rule of rules.map(cleanText).filter((r) => r.length >= 3).slice(0, MAX_ONBOARDING_FACTS)) wanted.push({ fact: rule.slice(0, 500), fact_key: ruleFactKey(rule) });
  if (goals.length && wanted.length < MAX_ONBOARDING_FACTS) wanted.push({ fact: goalsFactText(goals), fact_key: GOALS_FACT_KEY });
  const wantedKeys = new Set(wanted.map((w) => w.fact_key));
  const byKey = new Map(existing.map((f) => [f.fact_key, f]));
  const archiveIds = existing.filter((f) => f.fact_key.startsWith(RULE_FACT_PREFIX) && !wantedKeys.has(f.fact_key)).map((f) => f.id);
  const goalsRow = byKey.get(GOALS_FACT_KEY);
  if (goalsRow && !wantedKeys.has(GOALS_FACT_KEY)) archiveIds.push(goalsRow.id);
  const plan = { inserts: [], updates: [], archiveIds, keep: [], skipped: 0 };
  let room = maxPerWorkspace - (activeCount - archiveIds.length);
  for (const w of wanted) {
    const row = byKey.get(w.fact_key);
    if (row) {
      if (row.fact !== w.fact) plan.updates.push({ id: row.id, fact: w.fact }); else plan.keep.push(row.id);
      continue;
    }
    if (room <= 0) { plan.skipped++; continue; }
    plan.inserts.push({ fact: w.fact, fact_key: w.fact_key, category: "policy", source: "owner", confidence: 0.95, pinned: true });
    room--;
  }
  return plan;
}

// ---- The "applied" list: what onboarding switched on, in plain English.
function appliedList(input) {
  const { ws, answers, tax } = input;
  const out = [];
  const region = typeof ws.region_code === "string" ? ws.region_code : "";
  const expected = REGION_TAX[region];
  if (expected && tax && tax.name === expected.name && Number(tax.rate) === expected.rate && String(tax.second_name ?? "") === (expected.second_name ?? "") && !tax.reviewed_at) {
    out.push(`Tax set to ${describeTax(expected)} for ${regionName(region)}`);
  }
  if (typeof ws.timezone === "string" && ws.timezone && ws.timezone !== "UTC") out.push(`Times are read in ${ws.timezone.replace(/_/g, " ")}`);
  if (ws.business_hours && Object.keys(ws.business_hours).length) out.push("Hours saved — Front Desk and bookings use them");
  if (input.servicesCount) out.push(`${input.servicesCount} service${input.servicesCount === 1 ? "" : "s"} on your price list`);
  if (typeof answers.payment_terms_days === "number") out.push(`Payment terms: ${LABEL.payment_terms_days[String(answers.payment_terms_days)] ?? `due in ${answers.payment_terms_days} days`}`);
  const deposit = answers.deposit;
  if (deposit?.type === "percent" && deposit.value != null) out.push(`Deposit policy: ${deposit.value}% up front`);
  else if (deposit?.type === "fixed" && deposit.value != null) out.push(`Deposit policy: ${money(deposit.value, ws.currency_code)} up front`);
  else if (deposit?.type === "none") out.push("Deposit policy: none");
  if (typeof ws.job_location === "string" && LABEL.job_location[ws.job_location]) out.push(`Where work happens: ${LABEL.job_location[ws.job_location]}`);
  if (Array.isArray(ws.intake_channels) && ws.intake_channels.length) out.push(`Watching for work by ${labelList("intake_channels", ws.intake_channels)}`);
  if (typeof ws.ai_tone === "string" && LABEL.ai_tone[ws.ai_tone]) out.push(`Ledger will sound ${LABEL.ai_tone[ws.ai_tone]}`);
  if (input.factsWritten) out.push(`${input.factsWritten} of your rules and goals pinned for the copilot`);
  if (input.factsSkipped) out.push(`Memory is full: ${input.factsSkipped} rule${input.factsSkipped === 1 ? "" : "s"} not pinned — the copilot still reads them from your brief`);
  return out;
}

// ---- What readiness data already shows done, keyed by setup-plan action.
function doneMap(input) {
  const { ws } = input;
  const connected = new Set(input.connectors.filter((c) => c.status === "connected").map((c) => c.connector));
  return {
    services_import: input.servicesCount > 0,
    books_choice: connected.has("quickbooks") || !!ws.books_chosen_at,
    tax_review: input.taxRequiresReview === false,
    hours: !!ws.business_hours && Object.keys(ws.business_hours).length > 0,
    phone_front_desk: ws.phone_frontdesk_enabled === true,
    reminders: ws.phone_reminder_enabled === true,
    google_calendar: connected.has("google_calendar"),
    google_business: connected.has("google_business_profile"),
    team_invite: input.members > 1,
    booking_link: ws.booking_enabled === true,
    first_invoice: input.invoices > 0,
    first_booking: input.appointments > 0,
  };
}

// =====================================================================================================
// The page / mock API. Both hold the normalized answers view (fixture `answers`, what onboarding-get
// returns) plus the workspace bootstrap columns { name, currency_code, timezone, ai_call_me? }; the
// server reads the workspace row, the service list and the onboarding row. `stateOf` rebuilds those
// three the way applyShopProfile and rowAfterSave leave them so briefInput / answersOf / doneMap run
// unchanged. Fresh-workspace evidence for the plan and the applied list is what the oracle used:
// no connectors, owner is the only member, nothing booked or invoiced, no business number, no card,
// no plan; the regional tax profile inserted (requires_review, never reviewed); rules + goals pinned
// into an empty memory.
// =====================================================================================================
const WORKSPACE_KEYS = ANSWER_KEYS.filter((k) => STORE[k] === "workspace");
function stateOf(answers, ws) {
  const a = answers ?? {};
  const w = {
    name: ws?.name ?? "", currency_code: ws?.currency_code ?? null, ai_call_me: ws?.ai_call_me ?? null, plan: ws?.plan ?? null, phone_number: null,
    books_default_terms_days: typeof a.payment_terms_days === "number" ? a.payment_terms_days : 0, timezone: ws?.timezone ?? null,
  };
  for (const key of WORKSPACE_KEYS) if (key in a) w[key] = a[key];
  const services = Array.isArray(a.services) ? a.services.map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name, price: s.price, duration_minutes: s.duration_minutes ?? null })) : [];
  const json = {};
  for (const key of ANSWERS_JSON_KEYS) if (key in a) json[key] = a[key];
  const row = { answers: json, sections_done: typeof a.payment_terms_days === "number" ? ["money"] : [] };
  return { ws: w, services, row };
}
function freshEvidence(answers, ws) {
  const s = stateOf(answers, ws);
  const region = typeof s.ws.region_code === "string" ? s.ws.region_code : "";
  const rt = REGION_TAX[region];
  const tax = rt ? { name: rt.name, rate: rt.rate, second_name: rt.second_name ?? null, second_rate: rt.second_rate ?? 0, reviewed_at: null, requires_review: true } : null;
  const done = doneMap({ ws: s.ws, connectors: [], servicesCount: s.services.length, taxRequiresReview: tax ? (tax.requires_review !== false ? true : false) : null, invoices: 0, appointments: 0, members: 1 });
  return { ...s, tax, done, view: answersOf(s.ws, s.services, s.row) };
}

const api = {
  /// onboarding-save's `understanding`: the section just saved, its validated answers ({} when skipped).
  understanding: (section, answers, ctx) => understandingFor(section, answers ?? {}, ctx ?? {}),
  /// The confirm recap and the "What Ledger knows" card (owner voice). No business name in it.
  brief: (answers, ws) => { const s = stateOf(answers, ws); return renderBusinessBrief(briefInput(s.ws, s.row, s.services), { voice: "owner" }); },
  /// The chat's first line after Finish.
  firstMessage: (answers, ws) => { const s = stateOf(answers, ws); return renderFirstMessage(briefInput(s.ws, s.row, s.services)); },
  /// onboarding-summary / -complete `setup_plan` on a fresh workspace.
  setupPlan: (answers, ws) => { const e = freshEvidence(answers, ws); return setupPlan({ answers: e.view, plan: null, has_business_number: false, card_on_file: false, done: e.done }); },
  /// onboarding-complete `applied` on a fresh workspace.
  applied: (answers, ws) => {
    const e = freshEvidence(answers, ws);
    const rules = Array.isArray(e.view.rules) ? e.view.rules : [];
    const goals = Array.isArray(e.view.goals) ? e.view.goals : [];
    const facts = planFacts(rules, goals, [], 0, MEMORY_MAX_PER_WORKSPACE);
    return appliedList({ ws: e.ws, answers: e.view, tax: e.tax, servicesCount: e.services.length, factsWritten: facts.inserts.length + facts.updates.length, factsSkipped: facts.skipped });
  },
  /// onboarding-get `suggestions`.
  suggestions: suggestions(),
  constants: { UNDERSTANDING_MAX, UNDERSTANDING_SKIPPED, CONFIRM_TITLE, REGION_NAME, LABEL },
  // The server functions themselves, for the mock and the tests.
  schema: {
    SCHEMA_VERSION, BUSINESS_TYPES, CONFIRM_SECTION, STEP_SECTIONS, STEP_IDS, TOTAL_STEPS, CONFIRM_TITLE, isStepId, sectionOf, nextSection,
    VOCAB, SET_VOCAB, INTAKE_VOCAB, TRI_STATE_KEYS, AUTONOMY_KEYS, PAYMENT_TERMS, DEPOSIT_TYPES, CAPS, STORE, ANSWER_KEYS, ANSWERS_JSON_KEYS, splitByStore,
    FIELD_LABEL, LABEL, REGION_NAME, regionName, REGION_TAX, CA_REGIONS, describeTax, cleanText, currencySymbol, money, joinWords, labelList,
    validateSection, UNDERSTANDING_MAX, UNDERSTANDING, UNDERSTANDING_SKIPPED, UNDERSTANDING_SAVED, understandingLineFor, understandingFor, clip,
    SUGGESTED_SERVICES, SUGGESTED_DESCRIPTIONS, SUGGESTED_RULES, suggestions, PLAN_ACTIONS, SETUP_PLAN_MAX, PLAN_NEEDS, setupPlan,
  },
  hours: { normalizeHours, describeHours },
  brief_: { briefInput, renderBusinessBrief, renderFirstMessage, FIRST_MESSAGE_MAX },
  onboarding: { sectionsOf, statusOf, currentSectionOf, onboardingSummary, answersOf, mergeAnswers, rowAfterSave, MEMORY_MAX_PER_WORKSPACE, planFacts, appliedList, doneMap },
  stateOf, freshEvidence,
};
globalThis.LedgerOnboardingText = api;
})();
