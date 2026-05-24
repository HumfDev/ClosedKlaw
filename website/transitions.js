const TRANSITION_KEY = "ck-page-transition";
const DURATION_MS = 200;

let exiting = false;

function normalizePath(pathname) {
  const p = pathname.replace(/\/index\.html$/i, "");
  return p === "" ? "/" : p;
}

function isCrossPageLink(link) {
  if (link.target === "_blank") return false;

  let url;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return false;
  }

  if (url.origin !== location.origin) return false;

  const dest = normalizePath(url.pathname);
  const here = normalizePath(location.pathname);
  if (dest === here) return false;

  return dest === "/" || dest === "/waitlist.html";
}

export function navigateWithTransition(url) {
  if (exiting) return;
  exiting = true;
  sessionStorage.setItem(TRANSITION_KEY, "1");
  document.body.classList.add("page-transition-exit");
  window.setTimeout(() => {
    location.href = url;
  }, DURATION_MS);
}

function bindTransitionLinks() {
  document.querySelectorAll("a[href]").forEach((link) => {
    link.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!isCrossPageLink(link)) return;
      e.preventDefault();
      navigateWithTransition(link.href);
    });
  });
}

function initEnterTransition() {
  if (!sessionStorage.getItem(TRANSITION_KEY)) return;

  sessionStorage.removeItem(TRANSITION_KEY);
  const content = document.querySelector(".page-content");
  if (!content) return;

  content.classList.add("page-content--enter-start");
  document.documentElement.classList.remove("page-pre-enter");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      content.classList.add("page-content--enter-active");
    });
  });
}

bindTransitionLinks();
initEnterTransition();
