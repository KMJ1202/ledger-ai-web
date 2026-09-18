/* Real recordings, user-controlled chapters, zero dependencies. */
(() => {
  'use strict';
  const root = document.querySelector('[data-showcase]');
  if (!root) return;
  const chapters = [
  {
    "id": "showcase-copilot",
    "name": "Ask Ledger",
    "tone": "#3ac8f5",
    "kicker": "Your AI copilot",
    "title": "Big questions.<br><em>Clear answers.</em>",
    "desc": "\u201cHow did we do this month?\u201d Ask in plain English. Ledger reads your connected books and brings back the numbers that matter.",
    "result": "Your business, on speaking terms.",
    "link": "/features/ai/",
    "clips": [
      [
        "app-ask",
        "Ask about your sales"
      ]
    ]
  },
  {
    "id": "inventory",
    "name": "Inventory",
    "tone": "#42dbcb",
    "kicker": "Inventory & pricing",
    "title": "Your prices.<br><em>Ready to quote.</em>",
    "desc": "Bring your price list. Review the import. Then ask what\u2019s in stock and what it sells for \u2014 without hunting through a spreadsheet.",
    "result": "Answers from the list you reviewed.",
    "link": "/features/invoicing/",
    "clips": [
      [
        "app-stock",
        "Find stock & pricing"
      ],
      [
        "app-pricelist",
        "Import a price list"
      ]
    ]
  },
  {
    "id": "invoicing",
    "name": "Finance",
    "tone": "#2fe0a0",
    "kicker": "Invoices & getting paid",
    "title": "From the job<br><em>to the bottom line.</em>",
    "desc": "See your books, review a quote and understand your profit. QuickBooks or Ledger\u2019s built-in books \u2014 you stay in control.",
    "result": "Drafted by Ledger. Confirmed by you.",
    "link": "/features/invoicing/",
    "clips": [
      [
        "app-finance",
        "See your books"
      ],
      [
        "app-estimate",
        "Accept a quote"
      ],
      [
        "app-profit",
        "Check profit"
      ],
      [
        "app-receipts",
        "Review receipts"
      ]
    ]
  },
  {
    "id": "booking",
    "name": "Booking",
    "tone": "#ffb768",
    "kicker": "Booking & calendar",
    "title": "A full day.<br><em>A clearer picture.</em>",
    "desc": "See what\u2019s next, check the day\u2019s jobs and let customers request a time from their own phone. No app download needed.",
    "result": "One calendar. Less back-and-forth.",
    "link": "/features/booking/",
    "clips": [
      [
        "app-calendar",
        "See the day"
      ],
      [
        "app-booking",
        "Request a booking"
      ]
    ]
  },
  {
    "id": "phone",
    "name": "Business phone",
    "tone": "#83a8ff",
    "kicker": "Business phone",
    "title": "Miss the call.<br><em>Keep the conversation.</em>",
    "desc": "When you enable text-back, a missed call gets a reply. Voicemails, messages and new leads come together in one place.",
    "result": "Automatic lanes you choose to switch on.",
    "link": "/features/phone/",
    "clips": [
      [
        "app-phone",
        "Follow a missed call"
      ]
    ]
  },
  {
    "id": "crew-live",
    "name": "Your crew",
    "tone": "#51dcff",
    "kicker": "Crew command",
    "title": "Out on the job.<br><em>Still in the picture.</em>",
    "desc": "See who\u2019s clocked in, open the crew map and review their time cards. A clearer view of the team, wherever the day takes you.",
    "result": "Worker links included with Pro.",
    "link": "/features/crew/",
    "clips": [
      [
        "crew-map",
        "Open the crew map"
      ],
      [
        "crew-hub",
        "Meet the team"
      ],
      [
        "crew-timecards",
        "Review time cards"
      ],
      [
        "crew-track",
        "See completed jobs"
      ]
    ]
  },
  {
    "id": "client-hub",
    "name": "Customers",
    "tone": "#c3a0ff",
    "kicker": "Client hub",
    "title": "One simple link.<br><em>Their whole story.</em>",
    "desc": "Customers can see invoices, respond to quotes and request their next service. You see the same relationship from your side.",
    "result": "No customer app. No customer seat fee.",
    "link": "/features/client-hub/",
    "clips": [
      [
        "app-clienthub",
        "Open a customer portal"
      ],
      [
        "app-customers",
        "See your directory"
      ]
    ]
  },
  {
    "id": "reviews",
    "name": "Reviews",
    "tone": "#f08cce",
    "kicker": "Reviews & reputation",
    "title": "Their feedback.<br><em>Your voice.</em>",
    "desc": "Read the review. Check Ledger\u2019s suggested reply. Make it yours, then approve it for Google \u2014 every word stays in your hands.",
    "result": "Review first. Publish when you\u2019re ready.",
    "link": "/integrations/google-business/",
    "clips": [
      [
        "app-reviews",
        "Review a reply"
      ]
    ]
  }
];
  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];
  const cards = $$('.sc-card'), stories = $$('.sc-story'), topics = $$('.sc-topic');
  const viewport = $('.sc-viewport'), stage = $('.sc-stage'), dialog = $('.sc-dialog');
  const modalVideo = dialog.querySelector('video');
  const mediaQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  let selected = 0, clipIndex = 0, visible = false, pausedByUser = false, explicitPlay = false;
  let drag = null, suppressClickUntil = 0, openTrigger = null, modalWasPlaying = false;
  const videos = cards.map(c => c.querySelector('video'));
  const clipSelections = chapters.map(() => 0);
  const shouldAutoPlay = () => !mediaQuery.matches && !connection?.saveData && !/^(slow-)?2g$/.test(connection?.effectiveType || '');
  const currentClip = () => chapters[selected].clips[clipIndex];
  const currentVideo = () => videos[selected];
  const status = text => { $('.sc-status').textContent = text; };
  const pad = n => String(n).padStart(2, '0');

  function updatePlayControl() {
    const playing = !currentVideo().paused && !currentVideo().ended;
    const failed = currentVideo().error;
    $('.sc-play').innerHTML = (playing ? 'Ⅱ <span>Pause</span>' : '▶ <span>Play</span>');
    $('.sc-play').setAttribute('aria-label', playing ? 'Pause recording' : 'Play recording');
    $('.sc-media-note').textContent = failed ? 'Recording unavailable' : 'Real app footage · silent';
  }
  function configureVideo(i, clip) {
    const v = videos[i];
    if (v.dataset.clip === clip) return v;
    v.pause(); v.classList.remove('has-frame');
    v.dataset.clip = clip; v.poster = `/assets/video/${clip}.jpg`;
    v.src = `/assets/video/${clip}.mp4`; v.load();
    return v;
  }
  function syncPlayback() {
    videos.forEach((v, i) => { if (i !== selected || !visible || document.hidden || dialog.open) v.pause(); });
    if (!visible || document.hidden || dialog.open) { updatePlayControl(); return; }
    if (pausedByUser || (!explicitPlay && !shouldAutoPlay())) { currentVideo().pause(); updatePlayControl(); return; }
    const v = configureVideo(selected, currentClip()[0]);
    if (v.ended) { updatePlayControl(); return; }
    const request = v.play();
    if (request?.catch) request.catch(() => { if (v === currentVideo()) updatePlayControl(); });
  }
  function placeCards() {
    cards.forEach((card, i) => {
      let offset = i - selected;
      if (offset > chapters.length / 2) offset -= chapters.length;
      if (offset < -chapters.length / 2) offset += chapters.length;
      const active = offset === 0;
      const shown = Math.abs(offset) <= 1;
      card.dataset.position = shown ? String(offset) : 'hidden';
      card.style.setProperty('--sc-offset', offset);
      card.style.setProperty('--sc-y', active ? '0px' : '28px');
      card.style.setProperty('--sc-angle', `${offset < 0 ? 18 : offset > 0 ? -18 : 0}deg`);
      card.style.setProperty('--sc-tilt', `${offset < 0 ? -5 : offset > 0 ? 5 : 0}deg`);
      card.style.setProperty('--sc-scale', active ? '1' : '.83');
      card.style.setProperty('--sc-opacity', active ? '1' : shown ? '.40' : '0');
      card.style.setProperty('--sc-z', active ? '3' : '1');
      card.setAttribute('aria-hidden', String(!active));
      card.querySelector('.sc-expand').tabIndex = active ? 0 : -1;
    });
  }
  function selectChapter(index, announce = true) {
    selected = (index + chapters.length) % chapters.length;
    clipIndex = clipSelections[selected];
    const data = chapters[selected];
    root.dataset.selected = String(selected);
    root.style.setProperty('--sc-accent', data.tone);
    stories.forEach((s, i) => { s.hidden = i !== selected; });
    topics.forEach((t, i) => { t.setAttribute('aria-pressed', String(i === selected)); });
    $('.sc-count b').textContent = pad(selected + 1);
    placeCards();
    // Scroll only the horizontal topic rail, never the page.
    const topic = topics[selected], rail = $('.sc-topics');
    const left = topic.offsetLeft - rail.offsetLeft;
    if (left < rail.scrollLeft || left + topic.offsetWidth > rail.scrollLeft + rail.clientWidth) {
      rail.scrollTo({ left: left - (rail.clientWidth - topic.offsetWidth) / 2, behavior: mediaQuery.matches ? 'instant' : 'smooth' });
    }
    syncPlayback();
    if (announce) status(`${selected + 1} of ${chapters.length}: ${data.name}. ${stories[selected].querySelector('.sc-description').textContent}`);
  }
  function selectClip(index) {
    clipIndex = index; clipSelections[selected] = index;
    const [clip, label] = currentClip();
    const card = cards[selected];
    card.querySelector('img').src = `/assets/video/${clip}.jpg`;
    card.querySelector('img').alt = `Ledger AI: ${label}, recorded with demo data`;
    const v = currentVideo();
    v.pause(); v.classList.remove('has-frame'); v.poster = `/assets/video/${clip}.jpg`;
    if (v.dataset.clip !== clip) { v.removeAttribute('src'); delete v.dataset.clip; v.load(); }
    stories[selected].querySelectorAll('.sc-clip').forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    syncPlayback(); status(`${chapters[selected].name}: ${label}`);
  }
  function togglePlay() {
    const v = currentVideo();
    if (!v.paused && !v.ended) { pausedByUser = true; v.pause(); }
    else { pausedByUser = false; explicitPlay = true; if (v.ended) v.currentTime = 0; syncPlayback(); }
    updatePlayControl();
  }
  function expand(proof = false, trigger = document.activeElement) {
    openTrigger = trigger;
    const v = currentVideo();
    modalWasPlaying = !v.paused;
    v.pause();
    dialog.classList.toggle('is-wide', proof);
    $('#sc-dialog-title').textContent = proof ? 'A real review. A real reply.' : currentClip()[1];
    $('#sc-dialog-desc').textContent = proof ? 'Recorded at the founder’s own shop · 29 seconds · silent, captioned' : 'Real Ledger AI recording · fictional demo business · silent';
    const source = proof ? 'ledger-google-reviews-v2' : currentClip()[0];
    modalVideo.poster = `/assets/video/${source}.jpg`;
    modalVideo.src = `/assets/video/${source}.mp4`;
    modalVideo.load();
    if (!proof && Number.isFinite(v.currentTime)) {
      const seek = v.currentTime;
      modalVideo.addEventListener('loadedmetadata', () => { modalVideo.currentTime = Math.min(seek, modalVideo.duration || seek); }, { once: true });
    }
    dialog.showModal(); document.body.classList.add('sc-modal-open');
    $('.sc-close').focus({ preventScroll: true });
    // Opening is explicit intent to watch. Native controls remain available if playback is denied.
    modalVideo.play().catch(() => {});
    status(proof ? 'Expanded real shop review recording.' : `Expanded ${currentClip()[1]}.`);
  }
  function closeDialog() { dialog.close(); }
  dialog.addEventListener('close', () => {
    modalVideo.pause(); modalVideo.removeAttribute('src'); modalVideo.load();
    document.body.classList.remove('sc-modal-open');
    if (openTrigger?.isConnected) openTrigger.focus({ preventScroll: true });
    if (modalWasPlaying) syncPlayback(); else updatePlayControl();
  });
  $('.sc-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', e => { if (e.target === dialog) {
    const b = dialog.getBoundingClientRect();
    if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) closeDialog();
  }});
  $('.sc-larger').addEventListener('click', e => expand(false, e.currentTarget));
  $('.sc-real-proof').addEventListener('click', e => expand(true, e.currentTarget));
  $('.sc-play').addEventListener('click', togglePlay);
  $('.sc-prev').addEventListener('click', () => selectChapter(selected - 1));
  $('.sc-next').addEventListener('click', () => selectChapter(selected + 1));
  topics.forEach((b, i) => b.addEventListener('click', () => selectChapter(i)));
  stories.forEach(s => s.querySelectorAll('.sc-clip').forEach((b, i) => b.addEventListener('click', () => selectClip(i))));
  cards.forEach((card, i) => card.addEventListener('click', e => {
    if (performance.now() < suppressClickUntil) { e.preventDefault(); return; }
    if (i === selected) expand(false, card.querySelector('.sc-expand')); else selectChapter(i);
  }));
  root.addEventListener('keydown', e => {
    if (dialog.open || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const supported = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!supported.includes(e.key)) return;
    if (!e.target.closest('.sc-topics,.sc-viewport,.sc-pagination')) return;
    e.preventDefault();
    const target = e.key === 'Home' ? 0 : e.key === 'End' ? chapters.length - 1 : selected + (e.key === 'ArrowRight' ? 1 : -1);
    selectChapter(target);
    if (e.target.closest('.sc-topics')) topics[selected].focus({ preventScroll: true });
  });
  viewport.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, started: performance.now(), horizontal: false };
  });
  viewport.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.horizontal && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
    if (!drag.horizontal && Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      drag.horizontal = true; viewport.setPointerCapture(e.pointerId); viewport.classList.add('is-dragging');
    }
    if (!drag.horizontal) return;
    e.preventDefault(); drag.dx = dx;
    viewport.style.setProperty('--sc-drag', `${Math.max(-300, Math.min(300, dx))}px`);
  });
  function finishDrag(e) {
    // A touch starts with implicit capture on the screen button. Its bubbling
    // lost-capture event must not cancel transfer to the gallery.
    if (e.type === 'lostpointercapture' && e.target !== viewport) return;
    if (!drag || drag.id !== e.pointerId) return;
    const finished = drag; drag = null;
    viewport.classList.remove('is-dragging'); viewport.style.setProperty('--sc-drag', '0px');
    if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    if (!finished.horizontal) return;
    suppressClickUntil = performance.now() + 350;
    if (e.type === 'pointerup' && (Math.abs(finished.dx) > 50 || (Math.abs(finished.dx) > 18 && Math.abs(finished.dx) / (performance.now() - finished.started) > .45))) {
      selectChapter(selected + (finished.dx < 0 ? 1 : -1));
    }
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => viewport.addEventListener(t, finishDrag));
  viewport.addEventListener('dragstart', e => e.preventDefault());
  videos.forEach(v => {
    ['play','pause','ended'].forEach(t => v.addEventListener(t, () => { if (v === currentVideo()) updatePlayControl(); }));
    v.addEventListener('play', () => { if (v !== currentVideo() || !visible || document.hidden || dialog.open) v.pause(); });
    v.addEventListener('loadeddata', () => v.classList.add('has-frame'));
    v.addEventListener('error', () => { if (v === currentVideo()) { updatePlayControl(); status('This recording could not load. You can still read the example or open its feature page.'); } });
  });
  function handleHash() {
    const hash = location.hash.slice(1);
    const index = chapters.findIndex(c => c.id === hash);
    if (index >= 0) { selectChapter(index, false); root.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  }
  root.classList.add('sc-enhanced');
  selectChapter(0, false); handleHash();
  addEventListener('hashchange', handleHash);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { videos.forEach(v => v.pause()); modalVideo.pause(); } else syncPlayback();
  });
  mediaQuery.addEventListener('change', () => { explicitPlay = false; syncPlayback(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .25; syncPlayback(); }, { threshold: [0,.25,.6] }).observe(viewport);
  } else { visible = true; syncPlayback(); }
})();
