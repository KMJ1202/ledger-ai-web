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

document.querySelectorAll("nav.sitenav .navburger").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    btn.closest("nav").classList.toggle("mopen");
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll("nav.sitenav.mopen").forEach((n) => n.classList.remove("mopen"));
});
