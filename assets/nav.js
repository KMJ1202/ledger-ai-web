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
