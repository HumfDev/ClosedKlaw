/**
 * Cross-page fade transitions.
 *
 * The header is a sibling of .page-content, so it stays put while the content
 * beneath it cross-fades — the chrome reads as persistent across navigation.
 * Exit is quicker than entrance so a click feels answered immediately.
 */

const TRANSITION_KEY = "ck-page-transition";
const EXIT_MS = 220;
const NAV_FALLBACK_MS = 600;

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

function normalizePath(pathname) {
  const p = pathname.replace(/\/index\.html$/i, "");
  return p === "" ? "/" : p;
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

  // Same page (including in-page anchors) — section nav handles those.
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
  document.body.classList.add("page-transition-exit");

  const nav = () => {
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

function initEnterTransition() {
  const arriving = readFlag();
  clearFlag();

  const content = document.querySelector(".page-content");
  if (!content) {
    document.documentElement.classList.remove("page-pre-enter");
    return;
  }

  if (!arriving || reduceMotion.matches) {
    document.documentElement.classList.remove("page-pre-enter");
    return;
  }

  content.classList.add("page-content--enter-start");
  document.documentElement.classList.remove("page-pre-enter");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      content.classList.add("page-content--enter-active");
    });
  });
}

/** Restoring from bfcache must not leave the page stuck mid-fade. */
function initRestoreGuard() {
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    exiting = false;
    clearFlag();
    document.documentElement.classList.remove("page-pre-enter");
    document.body.classList.remove("page-transition-exit");
    const content = document.querySelector(".page-content");
    content?.classList.remove("page-content--enter-start", "page-content--enter-active");
  });
}

bindTransitionLinks();
initEnterTransition();
initRestoreGuard();
