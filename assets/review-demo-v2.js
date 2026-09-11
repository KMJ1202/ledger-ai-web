/* Play only while visible. Respect reduced motion, data saving and a viewer's pause. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-review-demo]').forEach(video => {
    let viewerPaused = false;
    let automaticPause = false;
    const pauseAutomatically = () => {
      if (!video.paused) { automaticPause = true; video.pause(); }
    };
    video.addEventListener('pause', () => {
      if (!automaticPause && !video.ended) viewerPaused = true;
      automaticPause = false;
    });
    video.addEventListener('play', () => { viewerPaused = false; });
    const allowed = () => !reduce.matches && !navigator.connection?.saveData && !document.hidden;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
          if (allowed() && !viewerPaused && !video.ended) video.play().catch(() => {});
        } else pauseAutomatically();
      });
    }, { threshold: [0, 0.45] });
    observer.observe(video);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAutomatically(); });
    reduce.addEventListener('change', () => { if (reduce.matches) pauseAutomatically(); });
  });
})();
