// Dropdown works on touch and click, not just hover.
document.querySelectorAll("nav.sitenav .drop").forEach((drop) => {
  const trigger = drop.querySelector("span");
  if (!trigger) return;
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    drop.classList.toggle("open");
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll("nav.sitenav .drop.open").forEach((d) => d.classList.remove("open"));
});

document.querySelectorAll("nav.sitenav .brand").forEach((brand) => {
  brand.addEventListener("click", (e) => {
    if (!window.matchMedia("(max-width:780px)").matches) return;
    e.preventDefault();
    e.stopPropagation();
    brand.closest("nav").classList.toggle("mopen");
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll("nav.sitenav.mopen").forEach((n) => n.classList.remove("mopen"));
});

// Scroll reveal: stagger cards/steps/stats up as they enter the viewport.
(function () {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;
  var sel = ".grid > .card, .grid > .intcard, .steps .step, .caplist .capitem, .price, .datapanel, .ctaband, .proofband, .proofband .stat, .phoneframe";
  var els = Array.prototype.slice.call(document.querySelectorAll(sel));
  if (!els.length) return;
  var perParent = {};
  els.forEach(function (el) {
    el.classList.add("sr");
    var k = el.parentNode ? Array.prototype.indexOf.call(document.querySelectorAll("*"), el.parentNode) : 0;
    perParent[k] = (perParent[k] || 0);
    el.style.transitionDelay = Math.min(perParent[k] * 70, 420) + "ms";
    perParent[k]++;
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("srin"); io.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -30px 0px" });
  els.forEach(function (el) { io.observe(el); });
})();
