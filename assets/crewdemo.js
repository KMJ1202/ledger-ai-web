/* Real-app footage player (2026-09-12, generalised 2026-09-13).
   Silent clips recorded from the shipping app, played back to back in a
   phone frame. Each step button carries its own clip (data-src / data-poster);
   a block with no data-src on its steps falls back to the four Crew clips.
   Two stacked <video> elements: the hidden one always has the next clip
   loaded, so the hand-off is a crossfade, never a black flash. Plays only
   while on screen; never autoplays for reduced-motion users (a tap on any
   step starts it). Steps without a clip are informational and not clickable. */
(function () {
  var roots = document.querySelectorAll('[data-crew-demo],[data-app-demo]');
  if (!roots.length) return;
  var CREW = {
    hub:       { src: '/assets/video/crew-hub.mp4',       poster: '/assets/video/crew-hub.jpg' },
    map:       { src: '/assets/video/crew-map.mp4',       poster: '/assets/video/crew-map.jpg' },
    timecards: { src: '/assets/video/crew-timecards.mp4', poster: '/assets/video/crew-timecards.jpg' },
    track:     { src: '/assets/video/crew-track.mp4',     poster: '/assets/video/crew-track.jpg' }
  };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Array.prototype.forEach.call(roots, function (root) {
    var screen = root.querySelector('.cd-screen');
    var allSteps = Array.prototype.slice.call(root.querySelectorAll('.cd-step'));
    var steps = allSteps.filter(function (s) { return s.dataset.src || CREW[s.dataset.clip]; });
    allSteps.forEach(function (s) { if (steps.indexOf(s) < 0) { s.classList.add('static'); s.setAttribute('aria-pressed', 'false'); s.tabIndex = -1; } });
    if (!screen || !steps.length) return;
    var clips = steps.map(function (s) {
      var c = CREW[s.dataset.clip] || {};
      return { k: s.dataset.clip || s.dataset.src, src: s.dataset.src || c.src, poster: s.dataset.poster || c.poster };
    });
    var vids = [0, 1].map(function () {
      var v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'metadata';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
      v.disableRemotePlayback = true;
      screen.insertBefore(v, screen.firstChild);
      return v;
    });
    var cur = 0, active = 0, visible = false, started = !reduce;

    function load(v, i) {
      if (v.dataset.k === clips[i].k) return;
      v.dataset.k = clips[i].k; v.poster = clips[i].poster; v.src = clips[i].src; v.load();
    }
    function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    function mark(i) {
      steps.forEach(function (s, j) {
        s.classList.toggle('active', j === i);
        s.setAttribute('aria-pressed', j === i ? 'true' : 'false');
        s.style.setProperty('--p', 0);
      });
    }
    function show(i) {
      var next = vids[1 - cur], prev = vids[cur];
      load(next, i); active = i; mark(i);
      next.currentTime = 0;
      play(next);
      next.classList.add('on'); prev.classList.remove('on'); prev.pause();
      cur = 1 - cur;
      if (clips.length > 1) load(vids[1 - cur], (i + 1) % clips.length);
      root.classList.remove('paused');
    }

    vids.forEach(function (v) {
      v.addEventListener('ended', function () {
        if (v !== vids[cur] || !visible) return;
        if (clips.length === 1) { v.currentTime = 0; play(v); return; }
        show((active + 1) % clips.length);
      });
      v.addEventListener('timeupdate', function () {
        if (v !== vids[cur] || !v.duration) return;
        steps[active].style.setProperty('--p', Math.min(1, v.currentTime / v.duration));
      });
    });
    steps.forEach(function (s, i) {
      s.addEventListener('click', function () { started = true; show(i); });
    });
    screen.addEventListener('click', function () {
      started = true;
      var v = vids[cur];
      if (v.paused) { play(v); root.classList.remove('paused'); }
      else { v.pause(); root.classList.add('paused'); }
    });

    load(vids[0], 0); vids[0].classList.add('on'); if (clips.length > 1) load(vids[1], 1); mark(0);
    if (reduce) root.classList.add('paused');

    function sync() {
      var v = vids[cur];
      if (visible && started) { if (v.paused && !root.classList.contains('paused')) play(v); }
      else if (!visible) v.pause();
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { visible = e.isIntersecting && e.intersectionRatio >= 0.3; });
        sync();
      }, { threshold: [0, 0.3, 0.6, 1] }).observe(root);
    } else { visible = true; sync(); }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) vids[cur].pause(); else sync();
    });
  });
})();
