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
