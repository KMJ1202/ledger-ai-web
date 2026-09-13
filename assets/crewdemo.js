/* Crew Command footage player (2026-09-12).
   Four silent clips recorded from the iPhone app, played back to back in a
   phone frame. Two stacked <video> elements: the hidden one always has the
   next clip loaded, so the hand-off is a crossfade, never a black flash.
   Plays only while on screen; never autoplays for reduced-motion users
   (a tap on any step starts it). */
(function () {
  var roots = document.querySelectorAll('[data-crew-demo]');
  if (!roots.length) return;
  var CLIPS = [
    { k: 'hub',       src: '/assets/video/crew-hub.mp4',       poster: '/assets/video/crew-hub.jpg' },
    { k: 'map',       src: '/assets/video/crew-map.mp4',       poster: '/assets/video/crew-map.jpg' },
    { k: 'timecards', src: '/assets/video/crew-timecards.mp4', poster: '/assets/video/crew-timecards.jpg' },
    { k: 'track',     src: '/assets/video/crew-track.mp4',     poster: '/assets/video/crew-track.jpg' }
  ];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Array.prototype.forEach.call(roots, function (root) {
    var screen = root.querySelector('.cd-screen');
    var steps = Array.prototype.slice.call(root.querySelectorAll('.cd-step'));
    if (!screen || steps.length !== CLIPS.length) return;
    var vids = [0, 1].map(function () {
      var v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
      v.disableRemotePlayback = true;
      screen.insertBefore(v, screen.firstChild);
      return v;
    });
    var cur = 0, active = 0, visible = false, started = !reduce;

    function load(v, i) {
      if (v.dataset.k === CLIPS[i].k) return;
      v.dataset.k = CLIPS[i].k; v.poster = CLIPS[i].poster; v.src = CLIPS[i].src; v.load();
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
      load(vids[1 - cur], (i + 1) % CLIPS.length);
      root.classList.remove('paused');
    }

    vids.forEach(function (v) {
      v.addEventListener('ended', function () {
        if (v === vids[cur] && visible) show((active + 1) % CLIPS.length);
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

    load(vids[0], 0); vids[0].classList.add('on'); load(vids[1], 1); mark(0);
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
