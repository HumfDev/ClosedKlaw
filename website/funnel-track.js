const STORAGE_KEY = "kleo-funnel-visitor";
const STEP_EVENTS = [
  "onboarding_why",
  "onboarding_bottleneck",
  "onboarding_channels",
  "onboarding_outcome",
  "onboarding_optimize",
];

function getVisitorId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function trackFunnel(event, extra = {}) {
  const visitorId = getVisitorId();
  if (!visitorId || !event) return;

  const body = JSON.stringify({
    visitorId,
    event,
    path: window.location.pathname,
    referrer: document.referrer || undefined,
    ...extra,
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/onboarding-funnel", blob)) return;
    }
  } catch {
    /* fall through to fetch */
  }

  fetch("/api/onboarding-funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function trackOnboardingStep(stepIndex, extra = {}) {
  const event = STEP_EVENTS[stepIndex];
  if (event) trackFunnel(event, extra);
}

const path = (window.location.pathname || "/").replace(/\/$/, "") || "/";
if (path === "/" || path === "/index.html") {
  trackFunnel("homepage");
}
