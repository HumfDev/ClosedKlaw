/**
 * Runs synchronously in <head>, before first paint.
 *
 * When the visitor arrives from an in-site navigation, the outgoing page has
 * already faded out — so the incoming page must start hidden, otherwise it
 * flashes at full opacity for a frame before transitions.js can take over.
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

  // Never leave the page invisible if the transition module fails to load.
  setTimeout(function () {
    root.classList.remove("page-pre-enter");
  }, 700);
})();
