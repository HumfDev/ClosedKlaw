/**
 * Runs synchronously in <head>, before first paint.
 *
 * When the visitor arrives from an in-site navigation, the outgoing page has
 * already eased out — keep the header, hide the content, and show the dots
 * so there is no empty flash before transitions.js stages the incoming page.
 */
(function () {
  var KEY = "ck-page-transition";

  try {
    if (!sessionStorage.getItem(KEY)) return;
  } catch (err) {
    return;
  }

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    try {
      sessionStorage.removeItem(KEY);
    } catch (err) {
      /* ignore */
    }
    return;
  }

  var root = document.documentElement;
  root.classList.add("page-pre-enter");

  if (!root.querySelector(".page-loader")) {
    var loader = document.createElement("div");
    loader.className = "page-loader";
    loader.setAttribute("aria-hidden", "true");
    loader.innerHTML = "<span></span><span></span><span></span>";
    root.appendChild(loader);
  }

  // Never leave the page invisible if the transition module fails to load.
  setTimeout(function () {
    root.classList.remove("page-pre-enter");
  }, 1400);
})();
