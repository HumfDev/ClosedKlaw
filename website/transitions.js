/**
 * Cross-page transitions between major site pages.
 *
 * The header stays put. The current page eases out as one, a three-dot
 * loader holds the space, then the next page rises in sequence. Onboarding
 * steps on /start keep their own in-card motion.
 */

const TRANSITION_KEY = "ck-page-transition";
const ENTER_STAGGER_MS = 80;
const ENTER_DURATION_MS = 560;
const EXIT_MS = 280;
const NAV_FALLBACK_MS = 700;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let exiting = false;

function readFlag() {
  try {
    return sessionStorage.getItem(TRANSITION_KEY);
  } catch {
    return null;
  }
}

function setFlag() {
  try {
    sessionStorage.setItem(TRANSITION_KEY, "1");
  } catch {
    /* private mode — transition still runs, incoming page just won't pre-hide */
  }
}

function clearFlag() {
  try {
    sessionStorage.removeItem(TRANSITION_KEY);
  } catch {
    /* ignore */
  }
}

function ensureLoader() {
  let el = document.querySelector(".page-loader");
  if (el) return el;
  el = document.createElement("div");
  el.className = "page-loader";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = "<span></span><span></span><span></span>";
  document.documentElement.appendChild(el);
  return el;
}

export function showPageLoader() {
  ensureLoader();
  document.documentElement.classList.add("page-exiting");
}

function hidePageLoader() {
  document.documentElement.classList.remove("page-exiting");
  const el = document.querySelector(".page-loader");
  if (!el) return;
  window.setTimeout(() => {
    if (document.documentElement.classList.contains("page-pre-enter")) return;
    el.remove();
  }, 600);
}

function normalizePath(pathname) {
  const p = pathname.replace(/\/index\.html$/i, "");
  return p === "" ? "/" : p;
}

function isShown(el) {
  if (!el || el.hidden) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  return true;
}

function addLayer(layers, seen, el) {
  if (!isShown(el) || seen.has(el)) return;
  seen.add(el);
  layers.push(el);
}

/**
 * Pieces that should cascade on a real page change. Onboarding question
 * steps are not listed here — they live inside #start-form and swap in-place.
 */
function collectStaggerLayers() {
  const layers = [];
  const seen = new Set();
  const add = (el) => addLayer(layers, seen, el);
  const lockFrom = (index, els) => {
    els.forEach((el) => {
      add(el);
      if (el && seen.has(el)) {
        el.style.setProperty("--stagger-lock", String(index));
      }
    });
  };

  const heroParts = document.querySelectorAll(".hero-stack > .hero-enter");
  if (heroParts.length) {
    heroParts.forEach(add);
    const rest = [...document.querySelectorAll(".page-content > *")].filter(
      (child) => !child.querySelector(".hero-enter"),
    );
    lockFrom(heroParts.length, rest);
    return layers;
  }

  if (document.body.classList.contains("start-page")) {
    add(document.getElementById("start-progress"));
    add(document.getElementById("start-title"));
    add(document.getElementById("start-form"));
    add(document.getElementById("start-nav"));
    add(document.querySelector(".page-content > .footer, .page-content > footer"));
    return layers;
  }

  const waitlistCard = document.querySelector(".waitlist-card");
  if (waitlistCard) {
    [...waitlistCard.children].forEach(add);
    add(document.querySelector(".page-content > .footer, .page-content > footer"));
    if (layers.length) return layers;
  }

  const termsDoc = document.querySelector(".terms-doc");
  if (termsDoc) {
    const kids = [...termsDoc.children];
    kids.slice(0, 3).forEach(add);
    lockFrom(Math.min(3, kids.length), kids.slice(3));
    add(document.querySelector(".page-content > .footer, .page-content > footer"));
    return layers;
  }

  const card = document.querySelector(".onboarding-card, .app-card");
  if (card) {
    [...card.children].forEach(add);
    add(document.querySelector(".page-content > .footer, .page-content > footer"));
    if (layers.length) return layers;
  }

  add(document.querySelector(".page-content > main"));
  add(document.querySelector(".page-content > .footer, .page-content > footer, footer"));
  return layers;
}

function staggerIndex(el, fallback) {
  const locked = Number(el.style.getPropertyValue("--stagger-lock"));
  if (Number.isFinite(locked) && locked > 0) return locked;
  return fallback;
}

/** True for same-origin navigations to a different page of this site. */
function isInternalPageLink(link) {
  if (link.hasAttribute("download")) return false;
  if (link.target && link.target !== "_self") return false;

  let url;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return false;
  }

  if (url.origin !== location.origin) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  // Same page (including in-page anchors) — section nav / onboarding steps.
  return normalizePath(url.pathname) !== normalizePath(location.pathname);
}

export function navigateWithTransition(url) {
  if (exiting) return;

  if (reduceMotion.matches) {
    location.href = url;
    return;
  }

  exiting = true;
  setFlag();
  showPageLoader();
  document.body.classList.add("page-transition-exit");

  let didNav = false;
  const nav = () => {
    if (didNav) return;
    didNav = true;
    location.href = url;
  };

  window.setTimeout(nav, EXIT_MS);
  window.setTimeout(nav, EXIT_MS + NAV_FALLBACK_MS);
}

/** Delegated so links added later (e.g. injected legal copy) are covered. */
function bindTransitionLinks() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!link) return;
    if (!isInternalPageLink(link)) return;

    e.preventDefault();
    navigateWithTransition(link.href);
  });
}

function clearEnter(el) {
  if (el.classList.contains("hero-enter")) {
    el.classList.add("hero-enter--played");
  }
  el.classList.remove("page-enter-layer", "is-in");
  el.style.removeProperty("--enter-delay");
  el.style.removeProperty("--stagger-lock");
}

function initEnterTransition() {
  const arriving = readFlag();
  clearFlag();

  if (!arriving || reduceMotion.matches) {
    document.documentElement.classList.remove("page-pre-enter");
    hidePageLoader();
    return;
  }

  ensureLoader();

  const layers = collectStaggerLayers();
  if (!layers.length) {
    document.documentElement.classList.remove("page-pre-enter");
    hidePageLoader();
    return;
  }

  layers.forEach((el, i) => {
    el.classList.add("page-enter-layer");
    el.style.setProperty("--enter-delay", `${staggerIndex(el, i) * ENTER_STAGGER_MS}ms`);
  });

  document.documentElement.classList.remove("page-pre-enter");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const el of layers) {
        el.classList.add("is-in");
        if (el.classList.contains("hero-enter")) el.classList.add("hero-enter--played");
      }
      hidePageLoader();
      const last = Math.max(...layers.map((el, i) => staggerIndex(el, i)));
      window.setTimeout(() => {
        layers.forEach(clearEnter);
      }, last * ENTER_STAGGER_MS + ENTER_DURATION_MS);
    });
  });
}

/** Restoring from bfcache must not leave the page stuck mid-fade. */
function initRestoreGuard() {
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    exiting = false;
    clearFlag();
    document.documentElement.classList.remove("page-pre-enter", "page-exiting");
    document.body.classList.remove("page-transition-exit");
    document.querySelectorAll(".page-enter-layer").forEach(clearEnter);
    document.querySelector(".page-loader")?.remove();
  });
}

bindTransitionLinks();
initEnterTransition();
initRestoreGuard();
