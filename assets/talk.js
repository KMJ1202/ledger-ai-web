// Founder scheduler — heyledger.ai/talk/ (2026-09-05).
// Three steps on one page: session type → open time → details. Times come
// from the founder-booking function (the founder's real calendar minus what's
// already on it) and render in the visitor's own time zone.
(function () {
  var FN = "https://lbzkyyehmgudlxmfpzzh.supabase.co/functions/v1/founder-booking";
  var tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "America/Edmonton";
  var state = { type: "", slots: [], byDay: {}, day: "", start: "", minutes: 0 };
  var $ = function (id) { return document.getElementById(id); };
  var s1 = $("s1"), s2 = $("s2"), s3 = $("s3"), done = $("done");

  var dayKey = function (iso) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  };
  var fmt = function (iso, opts) { return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: tz }, opts)).format(new Date(iso)); };
  var tzLabel = function () {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date());
    var abbr = (parts.filter(function (p) { return p.type === "timeZoneName"; })[0] || {}).value || "";
    return tz.replace(/_/g, " ").split("/").pop() + (abbr ? " (" + abbr + ")" : "");
  };
  $("tzname").textContent = tzLabel();

  function setStep(n) {
    [s1, s2, s3].forEach(function (el, i) {
      var idx = i + 1;
      el.classList.toggle("locked", idx > n);
      el.classList.toggle("done", idx < n);
    });
    var target = n === 2 ? s2 : n === 3 ? s3 : null;
    if (target) setTimeout(function () { target.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
  }

  // ---- Step 1: type ----
  document.querySelectorAll(".type").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".type").forEach(function (b) { b.classList.toggle("on", b === btn); });
      state.type = btn.getAttribute("data-type");
      state.day = ""; state.start = "";
      setStep(2);
      loadSlots();
    });
  });
  document.querySelectorAll(".chg").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var n = Number(btn.getAttribute("data-reset"));
      if (n === 1) { state.type = ""; state.start = ""; document.querySelectorAll(".type").forEach(function (b) { b.classList.remove("on"); }); setStep(1); }
      if (n === 2) { state.start = ""; setStep(2); renderTimes(); }
    });
  });

  // ---- Step 2: slots ----
  function loadSlots() {
    $("slotsbox").innerHTML = '<div class="loading"><i></i> Checking the calendar…</div>';
    fetch(FN + "/slots?type=" + encodeURIComponent(state.type))
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Could not load times"); return d; }); })
      .then(function (d) {
        state.slots = d.slots || []; state.minutes = d.minutes || 0; state.byDay = {};
        state.slots.forEach(function (iso) { var k = dayKey(iso); (state.byDay[k] = state.byDay[k] || []).push(iso); });
        $("dur").textContent = state.minutes ? state.minutes + " minutes · free" : "";
        var days = Object.keys(state.byDay).sort();
        if (!days.length) { $("slotsbox").innerHTML = '<div class="empty">No open times in the next three weeks. Email <a href="mailto:supportteam@heyledger.ai">supportteam@heyledger.ai</a> and we\'ll set one by hand.</div>'; return; }
        if (!state.day || !state.byDay[state.day]) state.day = days[0];
        renderDays(days); renderTimes();
      })
      .catch(function (e) { $("slotsbox").innerHTML = '<div class="empty">' + escapeHtml(e.message) + "</div>"; });
  }

  function renderDays(days) {
    var strip = document.createElement("div"); strip.className = "days"; strip.id = "days";
    days.forEach(function (k) {
      var iso = state.byDay[k][0];
      var b = document.createElement("button"); b.type = "button"; b.className = "day" + (k === state.day ? " on" : "");
      b.innerHTML = "<small>" + fmt(iso, { weekday: "short" }) + "</small><b>" + fmt(iso, { day: "numeric" }) + "</b><span>" + fmt(iso, { month: "short" }) + "</span>";
      b.addEventListener("click", function () { state.day = k; state.start = ""; strip.querySelectorAll(".day").forEach(function (x) { x.classList.toggle("on", x === b); }); renderTimes(); });
      strip.appendChild(b);
    });
    var box = $("slotsbox"); box.innerHTML = ""; box.appendChild(strip);
    var times = document.createElement("div"); times.className = "times"; times.id = "times"; box.appendChild(times);
  }

  function renderTimes() {
    var times = $("times"); if (!times) return;
    times.innerHTML = "";
    (state.byDay[state.day] || []).forEach(function (iso) {
      var b = document.createElement("button"); b.type = "button"; b.className = "time" + (iso === state.start ? " on" : "");
      b.textContent = fmt(iso, { hour: "numeric", minute: "2-digit" });
      b.addEventListener("click", function () {
        state.start = iso;
        times.querySelectorAll(".time").forEach(function (x) { x.classList.toggle("on", x === b); });
        var label = state.type === "onboarding" ? "Onboarding session" : "Consultation";
        $("summary").innerHTML = '<div class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></div><div><b>' + label + " · " + state.minutes + " min with Kyle</b><span>" + escapeHtml(fmt(iso, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })) + " · " + escapeHtml(tzLabel()) + "</span></div>";
        setStep(3);
        setTimeout(function () { $("fname").focus({ preventScroll: true }); }, 400);
      });
      times.appendChild(b);
    });
  }

  // ---- Step 3: book ----
  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("err"); err.classList.remove("show");
    var name = $("fname").value.trim(), email = $("femail").value.trim();
    if (name.length < 2) return showErr("Please tell us your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showErr("Enter a valid email — that's where the invite goes.");
    if (!state.start) return showErr("Pick a time first.");
    var btn = $("submit"); btn.disabled = true; btn.textContent = "Booking…";
    fetch(FN, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "book", type: state.type, start: state.start, name: name, email: email, business: $("fbiz").value, phone: $("fphone").value, notes: $("fnotes").value, tz: tz, website: document.querySelector(".hp").value }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
      .then(function (res) {
        btn.disabled = false; btn.textContent = "Confirm booking →";
        if (!res.ok) {
          if (res.d && res.d.error === "slot_taken") { state.start = ""; setStep(2); loadSlots(); return showErr(res.d.message); }
          return showErr((res.d && (res.d.message || res.d.error)) || "Something went wrong — please try again.");
        }
        var d = res.d;
        $("donewhen").innerHTML = "<b>" + escapeHtml(d.title) + "</b> · " + escapeHtml(fmt(d.start, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })) + " · " + escapeHtml(tzLabel());
        $("donetext").textContent = (d.emailed ? "A confirmation is in your inbox" : "Your booking is confirmed") + " and a calendar invitation with the Google Meet link is on its way from Kyle's calendar. Need to move it? Reply to the email.";
        var meet = $("meetlink"); if (d.meet) { meet.href = d.meet; meet.style.display = ""; } else { meet.style.display = "none"; }
        [s1, s2, s3].forEach(function (el) { el.style.display = "none"; });
        done.classList.add("show");
        setTimeout(function () { done.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60);
      })
      .catch(function () { btn.disabled = false; btn.textContent = "Confirm booking →"; showErr("Couldn't reach the calendar — check your connection and try again."); });
  });
  function showErr(msg) { var err = $("err"); err.textContent = msg; err.classList.add("show"); return false; }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Deep link: /talk/?type=onboarding|consult pre-selects the session type.
  var pre = new URLSearchParams(location.search).get("type");
  if (pre === "onboarding" || pre === "consult") { var b = document.querySelector('.type[data-type="' + pre + '"]'); if (b) b.click(); }
})();
