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
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };

// ---- CONTRACT §2 / §3 -------------------------------------------------------
export const SECTIONS = [
  ["about", "About your business"], ["offer", "What you offer"], ["customers", "Your customers and how work comes in"],
  ["week", "Your week"], ["money", "Getting paid"], ["team", "Your team and tools"], ["ledger", "How Ledger should work for you"],
];
const ORDER = SECTIONS.map(([id]) => id);
const KEYS = {
  about: ["business_type", "business_description", "business_stage", "team_size", "region_code", "timezone"],
  offer: ["services", "remove_service_ids", "pricing_model", "hourly_rate", "quotes_first"],
  customers: ["customer_mix", "intake_channels", "job_location", "service_area", "typical_job_length", "repeat_business"],
  week: ["business_hours", "after_hours", "booking_lead"],
  money: ["payment_methods", "payment_terms_days", "deposit"],
  team: ["team_roles", "wants_front_desk", "uses_quickbooks", "uses_google_calendar"],
  ledger: ["ai_tone", "goals", "rules", "autonomy"],
};
const VOCAB = {
  business_type: ["automotive", "trades", "beauty", "health", "home", "professional", "fitness", "pets", "other"],
  business_stage: ["starting", "growing", "established"], team_size: ["solo", "small", "large"],
  pricing_model: ["flat", "hourly", "mix"], customer_mix: ["individuals", "businesses", "both"],
  intake_channels: ["phone", "text", "online", "walkin", "email", "social", "referral"],
  job_location: ["my_place", "customer_place", "both", "remote"], typical_job_length: ["under_1h", "1_3h", "half_day", "full_day", "multi_day"],
  repeat_business: ["one_off", "recurring", "both"], after_hours: ["voicemail", "text_back", "emergency", "closed"],
  booking_lead: ["same_day", "next_day", "two_plus_days"], payment_methods: ["cash", "card", "etransfer", "cheque", "financing", "online"],
  team_roles: ["field_crew", "front_desk", "admin", "other_owners"], ai_tone: ["friendly", "professional", "brief"],
  goals: ["more_bookings", "get_paid_faster", "fewer_missed_calls", "less_admin", "better_reviews", "grow_team"],
};
const SETS = ["intake_channels", "payment_methods", "team_roles", "goals"];

// Server-owned example copy (CONTRACT onboarding-get.suggestions). Examples,
// never defaults: the app labels every one "example — change it".
const S = (name, price, duration_minutes) => ({ name, price, duration_minutes });
export const SUGGESTIONS = {
  services: {
    automotive: [S("Oil change", 89, 45), S("Tire swap", 79, 60), S("Brake inspection", 60, 45), S("Wheel alignment", 129, 60), S("Battery replacement", 199, 30), S("Diagnostic scan", 99, 60)],
    trades: [S("Service call", 120, 60), S("Emergency call-out", 220, 60), S("Panel inspection", 150, 90), S("Fixture install", 180, 120), S("Leak repair", 160, 90)],
    beauty: [S("Haircut", 45, 45), S("Colour", 120, 120), S("Blow-dry", 40, 30), S("Manicure", 35, 45), S("Facial", 90, 60), S("Waxing", 30, 30)],
    health: [S("Initial assessment", 110, 60), S("Follow-up session", 85, 45), S("Massage — 60 min", 100, 60), S("Consultation", 75, 30), S("Treatment plan review", 60, 30)],
    home: [S("Standard clean", 140, 120), S("Deep clean", 260, 240), S("Lawn cut", 55, 45), S("Window wash", 120, 90), S("Move-out clean", 320, 300), S("Gutter clean", 150, 90)],
    professional: [S("Consultation", 150, 60), S("Monthly bookkeeping", 300, null), S("Tax return", 250, null), S("Document review", 120, 60), S("Strategy session", 200, 90)],
    fitness: [S("Personal training", 70, 60), S("Group class", 25, 60), S("Assessment", 60, 45), S("10-session pack", 600, null), S("Nutrition check-in", 50, 30)],
    pets: [S("Full groom", 85, 120), S("Bath and brush", 45, 60), S("Nail trim", 20, 15), S("Daycare — full day", 40, null), S("Dog walk — 30 min", 25, 30), S("Boarding — per night", 55, null)],
    other: [S("Standard service", 100, 60), S("Consultation", 60, 30), S("Hourly work", 80, 60), S("Rush service", 150, 60), S("Follow-up", 50, 30)],
  },
  descriptions: {
    automotive: "Repairs, tires and maintenance for cars and light trucks in <your town>",
    trades: "Licensed electrical work for homes and small businesses in <your town>",
    beauty: "Cuts, colour and styling for women and men in <your town>",
    health: "Registered massage therapy and injury recovery in <your town>",
    home: "Residential cleaning and yard care in <your town>",
    professional: "Bookkeeping and tax for small businesses in <your town>",
    fitness: "Personal training and small group classes in <your town>",
    pets: "Dog grooming and daycare in <your town>",
    other: "What you do, for whom, and where",
  },
  rules: {
    automotive: ["Always get approval before work over $200", "We don't work on diesel trucks", "Loaner cars are first come, first served"],
    trades: ["Emergency calls after 8 pm cost the after-hours rate", "We don't quote over the phone — site visit first", "Permits are the customer's cost"],
    beauty: ["Colour appointments need a patch test 48 hours before", "Late more than 15 minutes means rebooking", "No kids under 5 in the chair"],
    health: ["New clients fill in the intake form before the first visit", "24-hour notice to cancel or the session is charged", "We don't bill insurance directly"],
    home: ["We bring our own supplies", "Pets must be put away during the visit", "Cancel by 6 pm the day before"],
    professional: ["Retainer is billed on the 1st of each month", "We don't give tax advice by text", "All documents through the client portal"],
    fitness: ["Sessions expire 90 days after purchase", "Cancel 12 hours ahead or lose the session", "First session is always an assessment"],
    pets: ["Vaccination records before the first visit", "Matted coats may need a shave — we call first", "Pickup by 6 pm or a late fee applies"],
    other: ["We confirm every booking by text the day before", "Rush jobs cost 50% more", "No refunds once work has started"],
  },
};

// ---- Understanding lines (CONTRACT §8 examples + one per other key) ---------
const LABEL = {
  business_type: { automotive: "an automotive shop", trades: "a trades business", beauty: "a beauty business", health: "a health practice", home: "a home services business", professional: "a professional services business", fitness: "a fitness business", pets: "a pet business", other: "your business" },
  job_location: { my_place: "at your place", customer_place: "at the customer's place", both: "at your place and the customer's", remote: "remotely" },
  after_hours: { voicemail: "voicemail", text_back: "a text back", emergency: "an emergency line", closed: "closed" },
  ai_tone: { friendly: "friendly", professional: "professional", brief: "brief" },
  team_size: { solo: "just you", small: "a small team", large: "a bigger team" },
};
const money = (n, cur) => `${cur}${Number(n) % 1 ? Number(n).toFixed(2) : Number(n)}`;
function understanding(section, a, all, cur) {
  const has = (k) => a[k] != null && a[k] !== "" && !(Array.isArray(a[k]) && !a[k].length);
  if (has("rules")) return "Noted, word for word. I'll follow these every time.";
  if (has("business_type")) {
    if (a.business_type === "trades") return "Got it — a trades business. Jobs at the customer's place, no vehicle questions.";
    if (a.business_type === "automotive") return "Got it — an automotive shop. Bookings will ask for the vehicle.";
    return `Got it — ${LABEL.business_type[a.business_type]}. No vehicle questions.`;
  }
  if (has("job_location") && a.job_location === "customer_place") return "Got it — jobs happen at the customer's place, so bookings will ask for an address.";
  if (a.pricing_model === "hourly" && has("hourly_rate")) return `Hourly plus parts at ${money(a.hourly_rate, cur)}/h — your invoices will show hours × rate.`;
  if (a.pricing_model === "mix" && has("hourly_rate")) return `Flat where you can, ${money(a.hourly_rate, cur)}/h where you can't — invoices will show both.`;
  if (has("pricing_model")) return a.pricing_model === "flat" ? "Flat, per job — quotes and invoices will show one price." : "Hourly — invoices will show hours × rate.";
  if (has("services")) return `${a.services.length} service${a.services.length === 1 ? "" : "s"} saved — bookings and invoices can use them now.`;
  if (has("after_hours") && a.after_hours === "text_back") return "After hours, Ledger can text back so nobody waits until morning.";
  if (has("business_hours")) return "Hours saved — bookings and the Front Desk will keep to them.";
  if (a.deposit?.type === "percent" && a.deposit.value != null) return `A ${a.deposit.value}% deposit — I'll mention it on quotes and bookings.`;
  if (a.deposit?.type === "fixed" && a.deposit.value != null) return `A ${money(a.deposit.value, cur)} deposit — I'll mention it on quotes and bookings.`;
  if (has("payment_terms_days")) return Number(a.payment_terms_days) === 0 ? "Due on receipt — invoices will say so." : `Net ${a.payment_terms_days} — invoices will carry that due date.`;
  if (a.wants_front_desk === true) return "Ledger can answer what you miss — that's a next step once you have a number.";
  if (has("team_roles")) return "Got it — I'll keep the team in mind when work comes in.";
  if (has("job_location")) return `Got it — work happens ${LABEL.job_location[a.job_location]}.`;
  if (has("ai_tone")) return `${LABEL.ai_tone[a.ai_tone][0].toUpperCase()}${LABEL.ai_tone[a.ai_tone].slice(1)} it is — that's how I'll sound to your customers.`;
  if (section === "team") return "Got it — just you for now.";
  return "Saved. You can change any of this later in Settings.";
}

// ---- Owner brief, first message, plan (CONTRACT §5–§7, owner voice) --------
const WORD = {
  business_stage: { starting: "just starting out", growing: "growing", established: "established" },
  customer_mix: { individuals: "individuals", businesses: "businesses", both: "individuals and businesses" },
  intake_channels: { phone: "phone", text: "text", online: "online booking", walkin: "walk-ins", email: "email", social: "social media", referral: "referrals" },
  typical_job_length: { under_1h: "under an hour", "1_3h": "one to three hours", half_day: "half a day", full_day: "a full day", multi_day: "several days" },
  repeat_business: { one_off: "mostly one-off jobs", recurring: "mostly repeat customers", both: "a mix of one-off and repeat" },
  booking_lead: { same_day: "same day", next_day: "next day", two_plus_days: "two or more days out" },
  payment_methods: { cash: "cash", card: "card", etransfer: "e-transfer", cheque: "cheque", financing: "financing", online: "online payment" },
  team_roles: { field_crew: "field crew", front_desk: "front desk", admin: "admin", other_owners: "other owners" },
  goals: { more_bookings: "more bookings", get_paid_faster: "getting paid faster", fewer_missed_calls: "fewer missed calls", less_admin: "less admin", better_reviews: "better reviews", grow_team: "growing the team" },
};
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], DAYL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const pretty = (t) => { const [h, m] = t.split(":").map(Number); const s = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, "0")} ${s}` : `${h12} ${s}`; };
function describeHours(h) {
  if (!h || !DAYS.some((d) => h[d])) return "";
  const groups = [];
  for (const d of DAYS) { const t = h[d] ? `${pretty(h[d].open)}–${pretty(h[d].close)}` : "closed"; const last = groups[groups.length - 1]; if (last && last.text === t) last.days.push(d); else groups.push({ days: [d], text: t }); }
  return groups.map((g) => `${g.days.length > 2 ? `${DAYL[g.days[0]]}–${DAYL[g.days[g.days.length - 1]]}` : g.days.map((d) => DAYL[d]).join("/")} ${g.text}`).join(" · ");
}
const list = (arr, map) => (arr || []).map((v) => map[v] || v).join(", ").replace(/, ([^,]*)$/, " and $1");
function brief(st) {
  const a = st.answers, cur = st.currency_symbol, out = [];
  const g1 = [];
  if (a.business_type) g1.push(`You run ${st.name ? `${st.name}, ` : ""}${a.team_size === "solo" ? "a one-person " : ""}${LABEL.business_type[a.business_type].replace(/^(a|an|your) /, "")}${a.region_code ? ` in ${a.region_code}` : ""}.`);
  if (a.business_description) g1.push(a.business_description);
  if (a.business_stage) g1.push(`You're ${WORD.business_stage[a.business_stage]}.`);
  if (a.team_size && a.team_size !== "solo") g1.push(`You have ${LABEL.team_size[a.team_size]}${a.team_roles?.length ? `: ${list(a.team_roles, WORD.team_roles)}` : ""}.`);
  if (g1.length) out.push(g1.join("\n"));
  const g2 = [];
  if (a.services?.length) g2.push(`You offer ${a.services.slice(0, 4).map((s) => s.name).join(", ")}${a.services.length > 4 ? ` and ${a.services.length - 4} more` : ""}.`);
  if (a.pricing_model) g2.push(a.pricing_model === "flat" ? "You charge flat, per job." : a.pricing_model === "hourly" ? `You charge by the hour${a.hourly_rate != null ? ` at ${money(a.hourly_rate, cur)}/h` : ""}.` : `You charge flat where you can and by the hour${a.hourly_rate != null ? ` at ${money(a.hourly_rate, cur)}/h` : ""} otherwise.`);
  if (a.quotes_first === true) g2.push("You quote before starting work."); else if (a.quotes_first === false) g2.push("You rarely quote first.");
  if (g2.length) out.push(g2.join("\n"));
  const g3 = [];
  if (a.customer_mix) g3.push(`Your customers are ${WORD.customer_mix[a.customer_mix]}${a.intake_channels?.length ? `, reaching you by ${list(a.intake_channels, WORD.intake_channels)}` : ""}.`);
  if (a.job_location) g3.push(`Work happens ${LABEL.job_location[a.job_location]}${a.service_area && (a.job_location === "customer_place" || a.job_location === "both") ? ` — ${a.service_area}` : ""}.`);
  if (a.typical_job_length) g3.push(`A typical job takes ${WORD.typical_job_length[a.typical_job_length]}${a.repeat_business ? `, ${WORD.repeat_business[a.repeat_business]}` : ""}.`);
  if (g3.length) out.push(g3.join("\n"));
  const g4 = [];
  const hrs = describeHours(a.business_hours); if (hrs) g4.push(`You're open ${hrs}.`);
  if (a.after_hours) g4.push(a.after_hours === "closed" ? "After hours you're closed." : `After hours, customers get ${LABEL.after_hours[a.after_hours]}.`);
  if (a.booking_lead) g4.push(`Bookings usually land ${WORD.booking_lead[a.booking_lead]}.`);
  if (g4.length) out.push(g4.join("\n"));
  const g5 = [];
  if (a.payment_methods?.length) g5.push(`You take ${list(a.payment_methods, WORD.payment_methods)}.`);
  if (a.payment_terms_days != null) g5.push(Number(a.payment_terms_days) === 0 ? "Invoices are due on receipt." : `Invoices are due in ${a.payment_terms_days} days.`);
  if (a.deposit?.type === "percent" && a.deposit.value != null) g5.push(`You ask for a ${a.deposit.value}% deposit.`);
  if (a.deposit?.type === "fixed" && a.deposit.value != null) g5.push(`You ask for a ${money(a.deposit.value, cur)} deposit.`);
  if (a.deposit?.type === "none") g5.push("No deposit.");
  if (g5.length) out.push(g5.join("\n"));
  const g6 = [];
  if (a.ai_tone) g6.push(`Ledger sounds ${LABEL.ai_tone[a.ai_tone]} with your customers.`);
  if (a.goals?.length) g6.push(`You want ${list(a.goals, WORD.goals)}.`);
  if (a.rules?.length) g6.push(`Your rules:\n${a.rules.map((r) => `“${r}”`).join("\n")}`);
  if (g6.length) out.push(g6.join("\n"));
  return out.join("\n\n");
}
function firstMessage(st) {
  const a = st.answers;
  if (!a.business_type) return "";
  const bits = [];
  bits.push(`${a.team_size === "solo" ? "a solo " : a.team_size ? `${a.team_size === "small" ? "a small-team" : "a larger"} ` : "an "}${LABEL.business_type[a.business_type].replace(/^(a|an|your) /, "")}${a.region_code ? ` in ${a.region_code}` : ""}`);
  const hrs = describeHours(a.business_hours); if (hrs) bits.push(`open ${hrs.split(" · ")[0]}`);
  if (a.pricing_model) bits.push(a.pricing_model === "flat" ? "charging flat per job" : a.pricing_model === "hourly" ? `charging ${a.hourly_rate != null ? money(a.hourly_rate, st.currency_symbol) + "/h" : "by the hour"}` : "charging flat or hourly");
  if (a.deposit?.type === "percent" && a.deposit.value != null) bits.push(`with a ${a.deposit.value}% deposit`);
  if (a.deposit?.type === "fixed" && a.deposit.value != null) bits.push(`with a ${money(a.deposit.value, st.currency_symbol)} deposit`);
  const name = st.call_me && st.call_me !== "Boss" ? `Hi ${st.call_me} — ` : "";
  let m = `${name}${st.name || "Your business"} is set up. I know you're ${bits.join(", ")}. Ask me anything, or tap a next step below.`;
  if (m.length > 280) m = m.slice(0, 277) + "…";
  return m;
}
function setupPlan(st) {
  const a = st.answers, g = a.goals || [], ch = a.intake_channels || [], plan = [];
  const cust = a.job_location === "customer_place" || a.job_location === "both";
  const add = (id, title, detail, extra = {}) => { if (!plan.some((p) => p.id === id)) plan.push({ id, title, detail, done: false, action: id, ...extra }); };
  if (a.uses_quickbooks === true) add("books_choice", "Choose your books", "Connect QuickBooks");
  if (a.wants_front_desk === true || g.includes("fewer_missed_calls") || ch.includes("phone")) add("phone_front_desk", "Let Ledger answer missed calls and texts", "You said you miss calls. Front Desk texts back, books and takes messages.", { needs: "A Ledger business number (Pro)." });
  if (a.uses_quickbooks === false) add("books_choice", "Choose your books", "Built-in books are ready");
  if (a.uses_quickbooks == null) add("books_choice", "Choose your books", "Already on QuickBooks? Connect it. Otherwise built-in books handle invoices and payments.");
  if (!a.services?.length) add("services_import", "Add your services", "Names, prices and how long each takes — bookings and invoices use them.");
  if (!describeHours(a.business_hours)) add("hours", cust ? "Set your hours at the customer's place" : "Set your hours", "Bookings and the Front Desk keep to them.");
  if (ch.includes("online") || g.includes("more_bookings")) add("booking_link", cust ? "Share your booking link — jobs at the customer's place" : "Share your booking link", "Customers book themselves; you approve.");
  if (g.includes("better_reviews") || g.includes("more_bookings")) add("google_business", "Connect Google Business Profile", "Reviews and posts from one place.");
  if (g.includes("get_paid_faster")) { add("first_invoice", "Send your first invoice", "See exactly what customers get."); add("add_card", "Add a card so nothing stops on day 15", "Your trial runs 14 days.", { needs: "A payment card." }); }
  if (g.includes("less_admin")) add("reminders", "Turn on appointment reminders", "Ledger texts customers before the visit.", { needs: "A Ledger business number." });
  if ((g.includes("grow_team") || a.team_size === "large") && a.team_size !== "solo") add("team_invite", "Invite your team", "They see the calendar and jobs, not your money.");
  if (a.uses_google_calendar === true) add("google_calendar", "Connect Google Calendar", "Your appointments show up there too.");
  add("first_booking", "Make your first booking", "Check the customer, service and price look right.");
  return plan.slice(0, 7);
}

// ---- State ------------------------------------------------------------------
export function freshState(scenario = "fresh") {
  const st = {
    workspace_id: "ws_preview", name: "Preview Business", call_me: "Boss", currency_code: "CAD", currency_symbol: "$", timezone: "America/Edmonton",
    status: "not_started", current_section: "about", schema_version: 1,
    sections: Object.fromEntries(ORDER.map((id) => [id, { done: false, skipped: false }])),
    answers: {}, started_at: null, completed_at: null, seq: 0, log: [],
  };
  if (scenario === "in_progress" || scenario === "complete") {
    Object.assign(st.answers, { business_type: "trades", business_description: "Licensed electrical work for homes in Red Deer", business_stage: "growing", team_size: "solo", region_code: "AB", timezone: "America/Edmonton",
      services: [{ id: "svc_1", name: "Service call", price: 120, duration_minutes: 60 }, { id: "svc_2", name: "Panel inspection", price: 150, duration_minutes: 90 }], pricing_model: "hourly", hourly_rate: 95, quotes_first: true,
      customer_mix: "both", intake_channels: ["phone", "text", "referral"], job_location: "customer_place", service_area: "Red Deer and 40 km around", typical_job_length: "1_3h", repeat_business: "both" });
    for (const id of ["about", "offer", "customers"]) st.sections[id].done = true;
    st.status = "in_progress"; st.current_section = "week"; st.started_at = new Date().toISOString();
  }
  if (scenario === "complete") {
    Object.assign(st.answers, { business_hours: { mon: { open: "08:00", close: "17:00" }, tue: { open: "08:00", close: "17:00" }, wed: { open: "08:00", close: "17:00" }, thu: { open: "08:00", close: "17:00" }, fri: { open: "08:00", close: "17:00" }, sat: null, sun: null },
      after_hours: "text_back", booking_lead: "next_day", payment_methods: ["etransfer", "card"], payment_terms_days: 0, deposit: { type: "percent", value: 25 }, team_roles: [], wants_front_desk: true, uses_quickbooks: false, uses_google_calendar: null,
      ai_tone: "friendly", goals: ["fewer_missed_calls", "get_paid_faster"], rules: ["Emergency calls after 8 pm cost the after-hours rate"], autonomy: { reminders: true, review_replies: null, after_hours_texts: true } });
    for (const id of ORDER) st.sections[id].done = true;
    st.status = "complete"; st.current_section = "confirm"; st.completed_at = new Date().toISOString();
  }
  return st;
}
const sectionsOut = (st) => SECTIONS.map(([id, title]) => ({ id, title, done: st.sections[id].done, skipped: st.sections[id].skipped }));
const onboardingOut = (st) => ({ status: st.status, current_section: st.current_section, done_count: ORDER.filter((id) => st.sections[id].done).length, total: 7 });
const shopProfile = (st) => { const a = st.answers; return {
  business_type: a.business_type ?? null, business_description: a.business_description ?? null, service_area: a.service_area ?? null, business_hours: a.business_hours ?? null,
  hours_text: describeHours(a.business_hours), timezone: a.timezone ?? st.timezone, pricing_model: a.pricing_model ?? null, customer_mix: a.customer_mix ?? null, team_size: a.team_size ?? null,
  intake_channels: a.intake_channels || [], region_code: a.region_code ?? null, services: a.services || [], completed: !!st.completed_at }; };
const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
function validate(section, answers, st) {
  const keys = KEYS[section]; if (!keys) throw bad("Unknown section.");
  const out = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (!keys.includes(k)) throw bad(`Unknown key ${k} for ${section}.`);
    if (v === null || v === "") { out[k] = null; continue; }
    if (VOCAB[k] && !SETS.includes(k) && !VOCAB[k].includes(v)) throw bad(`${k}: not a value Ledger knows.`);
    if (SETS.includes(k)) { if (!Array.isArray(v)) throw bad(`${k}: send a list.`); const set = [...new Set(v.map((x) => String(x).toLowerCase()))]; if (set.some((x) => !VOCAB[k].includes(x))) throw bad(`${k}: not a value Ledger knows.`); if (k === "goals" && set.length > 3) throw bad("Pick up to three goals."); out[k] = set; continue; }
    if (k === "hourly_rate") { if (!Number.isFinite(Number(v)) || Number(v) < 0) throw bad("Hourly rate must be a number."); out[k] = Number(v); continue; }
    if (k === "payment_terms_days") { if (![0, 7, 15, 30].includes(Number(v))) throw bad("Payment terms must be 0, 7, 15 or 30 days."); out[k] = Number(v); continue; }
    if (["quotes_first", "wants_front_desk", "uses_quickbooks", "uses_google_calendar"].includes(k)) { if (typeof v !== "boolean") throw bad(`${k}: yes or no.`); out[k] = v; continue; }
    if (k === "services") { if (!Array.isArray(v) || v.length > 40) throw bad("Up to 40 services."); out[k] = v.map((s, i) => ({ id: s.id || `svc_${++st.seq}`, name: String(s.name || "").trim().slice(0, 80), price: Number(s.price) || 0, duration_minutes: s.duration_minutes == null ? null : Number(s.duration_minutes) })).filter((s) => s.name); continue; }
    if (k === "remove_service_ids") { out[k] = Array.isArray(v) ? v.map(String) : []; continue; }
    if (k === "rules") { if (!Array.isArray(v) || v.length > 5) throw bad("Up to five rules."); out[k] = v.map((r) => String(r).trim().replace(/\s+/g, " ")).filter(Boolean).map((r) => r.slice(0, 160)); continue; }
    if (k === "deposit") { if (typeof v !== "object" || !["none", "percent", "fixed"].includes(v.type)) throw bad("Deposit: none, percent or fixed."); out[k] = { type: v.type, value: v.type === "none" || v.value == null ? null : Number(v.value) }; continue; }
    if (k === "autonomy") { out[k] = { reminders: v.reminders ?? null, review_replies: v.review_replies ?? null, after_hours_texts: v.after_hours_texts ?? null }; continue; }
    if (k === "business_hours") { const h = {}; for (const d of DAYS) { const day = v[d]; if (!day) { h[d] = null; continue; } if (!/^\d\d:\d\d$/.test(day.open) || !/^\d\d:\d\d$/.test(day.close)) throw bad(`${DAYL[d]}: times must look like 08:00 and 17:00.`); if (day.open >= day.close) throw bad(`${DAYL[d]}: closing time must be after opening time.`); h[d] = { open: day.open, close: day.close }; } out[k] = DAYS.some((d) => h[d]) ? h : null; continue; }
    if (typeof v === "string") { out[k] = v.trim().replace(/\s+/g, " ").slice(0, k === "business_description" ? 240 : 200); continue; }
    out[k] = v;
  }
  return out;
}

export function handleProfile(st, body) {
  const action = body?.action;
  if (action === "bootstrap") return { created: false, needs_setup: false, workspace_id: st.workspace_id, name: st.name, subscription_status: "trialing", trial_ends_at: new Date(Date.now() + 12 * 864e5).toISOString(), shop_profile: shopProfile(st), role: "owner", currency_code: st.currency_code };
  if (action === "get") return { name: st.name, address: "", logo_url: null, member_since: new Date(Date.now() - 3600e3).toISOString(), call_me: st.call_me, shop_profile: shopProfile(st), onboarding: onboardingOut(st) };
  if (action === "readiness") { const a = st.answers; return { provider: "native", steps: [
    { id: "profile", title: "Review business details, time zone and hours", done: !!a.business_type && !!describeHours(a.business_hours) },
    { id: "customers", title: "Bring customers and check saved details", done: false },
    { id: "services", title: "Review service prices and booking durations", done: !!a.services?.some((s) => s.duration_minutes > 0) },
    { id: "tax", title: "Review tax registration and rates", done: false },
    { id: "invoice", title: "Create and review your first invoice", done: false },
    { id: "booking", title: "Create and review your first appointment", done: false },
  ], note: "Checks show saved records, not independent verification that their details are correct.", onboarding: onboardingOut(st) }; }
  if (action === "onboarding-get") { const answers = {}; for (const [k, v] of Object.entries(st.answers)) if (v != null && !(Array.isArray(v) && !v.length)) answers[k] = v;
    return { status: st.status, schema_version: 1, current_section: st.current_section, sections: sectionsOut(st), answers, suggestions: SUGGESTIONS, started_at: st.started_at, completed_at: st.completed_at }; }
  if (action === "onboarding-save") {
    const section = body.section; if (!KEYS[section]) throw bad("Unknown section.");
    const clean = validate(section, body.answers, st);
    st.log.push({ action, section, keys: Object.keys(clean), skip: !!body.skip });
    if (clean.remove_service_ids) { st.answers.services = (st.answers.services || []).filter((s) => !clean.remove_service_ids.includes(s.id)); delete clean.remove_service_ids; }
    if (clean.services) { const cur = st.answers.services || []; const byId = new Map(cur.map((s) => [s.id, s])); for (const s of clean.services) byId.set(s.id, s); clean.services = [...byId.values()]; }
    for (const [k, v] of Object.entries(clean)) { if (v === null) delete st.answers[k]; else st.answers[k] = v; }
    const sent = Object.keys(clean).length > 0;
    if (body.skip && !sent) st.sections[section].skipped = true; else if (sent) { st.sections[section].done = true; st.sections[section].skipped = false; }
    if (st.status === "not_started" || st.status === "skipped") { st.status = "in_progress"; st.started_at = st.started_at || new Date().toISOString(); }
    const i = ORDER.indexOf(section); const next = i < ORDER.length - 1 ? ORDER[i + 1] : "confirm";
    st.current_section = next;
    return { saved: true, section, next_section: next, understanding: body.skip && !sent ? "No problem — skipped for now. You can come back any time." : understanding(section, clean, st.answers, st.currency_symbol).slice(0, 140), sections: sectionsOut(st) };
  }
  if (action === "onboarding-complete") {
    if (!st.answers.business_type) { const e = new Error("Pick what kind of business you run first."); e.status = 409; throw e; }
    st.status = "complete"; st.completed_at = new Date().toISOString(); st.current_section = "confirm";
    st.log.push({ action });
    const applied = [];
    if (st.answers.region_code === "AB") applied.push("Tax set to GST 5% for Alberta");
    if (st.answers.payment_terms_days === 0) applied.push("Payment terms: due on receipt");
    if (describeHours(st.answers.business_hours)) applied.push("Hours saved — Front Desk and bookings use them");
    return { status: "complete", brief: brief(st), first_message: firstMessage(st), setup_plan: setupPlan(st), applied };
  }
  if (action === "onboarding-skip") { st.status = "skipped"; st.log.push({ action }); return { status: "skipped" }; }
  if (action === "onboarding-summary") return { status: st.status, brief: brief(st), first_message: firstMessage(st), setup_plan: setupPlan(st) };
  if (action === "shop-profile-save") { const clean = {}; for (const [k, v] of Object.entries(body)) if (k !== "action") clean[k] = v; Object.assign(st.answers, clean); st.completed_at = st.completed_at || new Date().toISOString(); return { saved: true, shop_profile: shopProfile(st) }; }
  const e = new Error(`Unknown action ${action}`); e.status = 404; throw e;
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
    if (url.pathname === "/__mock/reset") { const b = await readBody(); st = freshState(b.scenario || "fresh"); return send(res, 200, { ok: true, scenario: b.scenario || "fresh" }); }
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
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ server, port: server.address().port, url: `http://localhost:${server.address().port}`, state: () => st, reset: (s) => { st = freshState(s); return st; } })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 4173;
  const scenario = process.argv[3] || "fresh";
  startMock({ port, scenario }).then((m) => {
    console.log(`onboarding mock on ${m.url}/app.html?onboardingPreview=1  (scenario: ${scenario}; add &scenario=firstrun for the sign-up path)`);
    console.log(`reset: curl -X POST ${m.url}/__mock/reset -d '{"scenario":"in_progress"}'`);
  });
}
