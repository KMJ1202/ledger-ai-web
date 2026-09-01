// Hero console demo: three scenes auto-rotate, pausable on hover/focus, tabs clickable.
(function () {
  var root = document.getElementById("heroDemo");
  if (!root) return;
  var stage = document.getElementById("heroStage");
  var labelEl = document.getElementById("heroChLabel");
  var liveEl = document.getElementById("heroChLive");
  var iconEl = document.getElementById("heroChIcon");
  var scenes = Array.prototype.slice.call(root.querySelectorAll(".hscene"));
  var tabs = Array.prototype.slice.call(root.querySelectorAll(".stab"));
  if (!scenes.length || !stage) return;

  var DURATION = 6000;
  var META = [
    { label: "Missed-call feed", live: "Same-second auto-text",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8Z"/></svg>' },
    { label: "Ask Ledger", live: "Live on your books",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10H9l-4 4v-4H4v-10Z"/><path d="M8 10h8M8 13h5"/></svg>' },
    { label: "Receipt Radar", live: "Snap → parsed → posted",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5a1 1 0 0 1 1-1h2.2l1-1.7A1 1 0 0 1 9 5.3h6a1 1 0 0 1 .9.5l1 1.7H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5Z"/><circle cx="12" cy="13" r="3.4"/></svg>' }
  ];

  var idx = 0;
  var timer = null;
  var paused = false;

  function setHeight() {
    var active = scenes[idx];
    if (active) stage.style.height = active.scrollHeight + "px";
  }

  function activate(i) {
    idx = i;
    scenes.forEach(function (s, si) {
      s.classList.toggle("active", si === i);
      s.classList.remove("play");
    });
    tabs.forEach(function (t, ti) {
      t.classList.toggle("active", ti === i);
      t.classList.remove("fill");
    });
    var meta = META[i];
    if (meta && labelEl && liveEl && iconEl) {
      labelEl.textContent = meta.label;
      liveEl.textContent = meta.live;
      iconEl.innerHTML = meta.icon;
    }
    setHeight();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (scenes[i]) scenes[i].classList.add("play");
        if (tabs[i]) tabs[i].classList.add("fill");
      });
    });
  }

  function next() {
    activate((idx + 1) % scenes.length);
  }

  function start() {
    stop();
    timer = setInterval(function () {
      if (!paused) next();
    }, DURATION);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () {
      activate(i);
    });
  });

  root.addEventListener("mouseenter", function () { paused = true; });
  root.addEventListener("mouseleave", function () { paused = false; });
  root.addEventListener("focusin", function () { paused = true; });
  root.addEventListener("focusout", function () { paused = false; });

  window.addEventListener("resize", setHeight);

  root.classList.add("ready");
  activate(0);
  start();
})();
