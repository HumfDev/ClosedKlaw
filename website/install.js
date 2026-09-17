const UNLOCK_KEY = "kleoklaw-desktop-unlock";
const MAC_SETUP_URL_KEY = "kleoklaw-mac-setup-url";
const SETUP_SESSION_KEY = "kleoklaw-desktop-setup-session";
const API_ORIGIN = window.KLEOKLAW_API_BASE || "https://api.kleoklaw.com";

function readUnlock() {
  try {
    const raw = sessionStorage.getItem(UNLOCK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const unlock = readUnlock();
function clearUnlock() {
  sessionStorage.removeItem(UNLOCK_KEY);
  sessionStorage.removeItem(MAC_SETUP_URL_KEY);
  sessionStorage.removeItem(SETUP_SESSION_KEY);
}

function unlockIsValid() {
  return unlock?.ok && typeof unlock.exp === "number" && unlock.exp > Date.now();
}

if (!unlockIsValid()) {
  clearUnlock();
  location.replace("/download");
} else {
  window.setTimeout(() => {
    clearUnlock();
    location.replace("/download");
  }, unlock.exp - Date.now());
}

function detectPlatform() {
  const ua = navigator.userAgent || "";
  const ch = navigator.userAgentData?.platform || "";
  const hay = `${ch} ${ua} ${navigator.platform || ""}`;
  if (/iPhone|iPad|iPod|Macintosh|Mac OS/i.test(hay)) return "macos";
  if (/Win/i.test(hay)) return "windows";
  return "other";
}

const platform = detectPlatform();
const macBtn = document.getElementById("mac-btn");
const osNote = document.getElementById("os-note");
const openKleoBtn = document.getElementById("open-kleo-btn");
const macSetupNote = document.getElementById("mac-setup-note");

macBtn.href = `${API_ORIGIN}/download/desktop/macos`;
macBtn.classList.add("download-btn--primary");

// Mac only for now — a product decision, not a missing build. Measured on live
// api.kleoklaw.com 2026-09-17: GET /download/desktop/windows answers 302 to a published
// windows 1.1.9 installer (unsigned; SmartScreen warns). Restore the button and its
// probeInstaller("windows", ...) call to ship Windows again.
if (platform !== "macos") {
  osNote.hidden = false;
  osNote.textContent = "KleoKlaw is Mac only right now. Windows is coming.";
}

function track(platformName) {
  if (typeof gtag === "function") {
    gtag("event", "desktop_download", { platform: platformName });
  }
}

function disableButton(el, label) {
  el.classList.remove("download-btn--primary");
  el.classList.add("download-btn--secondary", "is-disabled");
  el.setAttribute("aria-disabled", "true");
  el.removeAttribute("href");
  const meta = el.querySelector(".download-btn-meta");
  if (meta) meta.textContent = `The ${label} installer is not published yet. Please try again shortly.`;
}

async function probeInstaller(platformName, button, label) {
  try {
    const res = await fetch(`${API_ORIGIN}/download/desktop/${platformName}`, {
      method: "HEAD",
      credentials: "omit",
      redirect: "manual",
    });
    if (res.status === 404) disableButton(button, label);
  } catch {
    /* Ignore probe failures; direct download links still work. */
  }
}

function readMacSetupUrl() {
  try {
    const value = sessionStorage.getItem(MAC_SETUP_URL_KEY);
    if (!value || new URL(value).protocol !== "https:") return null;
    return value;
  } catch {
    return null;
  }
}

function readSetupSession() {
  try {
    return sessionStorage.getItem(SETUP_SESSION_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Ask the API, at the click, for a connection link minted right now.
 *
 * The enrollment ticket inside it lives five minutes. Minting it when the code was
 * verified — before a multi-hundred-megabyte download, an install and a first launch —
 * means it is structurally dead by the time anyone can spend it, which the customer sees
 * as "Enrollment link is invalid or expired" on a connection they did nothing wrong to
 * earn.
 *
 * Prefers `enroll_url` — the `kleoklaw://` deep link — over `mac_setup_url`, and that
 * preference is the fix, not a detail. `mac_setup_url` is an https page on the API that
 * holds the ticket while telling the customer to go download and install; landing there
 * before installing reproduces the original bug exactly. Firing the scheme spends the
 * ticket seconds after minting it, whichever order the customer works in.
 *
 * Returns:
 *   {url}      spend it
 *   {stale}    a session exists but the mint did not answer — say so, never navigate:
 *              a stored URL cannot be proved fresh, and during a partial rollout the
 *              un-deployed route answers 405, not 401
 *   {expired}  the session is spent; only a new unlock helps
 *   {legacy}   no session at all (an API that predates this route) — old behaviour
 */
async function freshMacEnrollTarget() {
  const session = readSetupSession();
  if (!session) {
    const stored = readMacSetupUrl();
    return stored ? { url: stored, legacy: true } : { expired: true };
  }
  try {
    const res = await fetch(`${API_ORIGIN}/download/auth/mac-setup-url`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_session: session }),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok && payload?.ok === true) {
      if (typeof payload.enroll_url === "string" && payload.enroll_url.startsWith("kleoklaw://")) {
        return { url: payload.enroll_url };
      }
      if (typeof payload.mac_setup_url === "string") {
        try {
          if (new URL(payload.mac_setup_url).protocol === "https:") {
            return { url: payload.mac_setup_url };
          }
        } catch {
          /* fall through to stale */
        }
      }
    }
    if (res.status === 401) return { expired: true };
  } catch {
    /* Network, CORS or parse failure — indistinguishable from a missing route here. */
  }
  return { stale: true };
}

function canEnrollMac() {
  return Boolean(readSetupSession() || readMacSetupUrl());
}

function revealMacEnrollment({ clearWhenUnusable = true } = {}) {
  if (!unlockIsValid()) {
    clearUnlock();
    location.replace("/download");
    return;
  }
  if (!canEnrollMac()) {
    // Only on a deliberate click. On page load an unusable state must not silently throw
    // away a gate the customer may still be using in another way.
    if (clearWhenUnusable) clearUnlock();
    return;
  }
  openKleoBtn.hidden = false;
  macSetupNote.hidden = false;
}

macBtn.addEventListener("click", () => {
  // A disabled button has had its href removed; it must not act as a working control.
  if (macBtn.getAttribute("aria-disabled") === "true") return;
  track("macos");
  revealMacEnrollment();
});

// Also on load, not only after a download click: a customer who already has the DMG from
// an earlier visit, or who downloaded it from the API's own install page, would otherwise
// never be offered "Open Kleo" at all.
revealMacEnrollment({ clearWhenUnusable: false });

let openKleoInFlight = false;

openKleoBtn.addEventListener("click", async (event) => {
  event.preventDefault();
  if (!unlockIsValid()) {
    clearUnlock();
    location.replace("/download");
    return;
  }
  // A second click during the await would mint a second ticket; aria-disabled alone does
  // not stop one.
  if (openKleoInFlight) return;
  openKleoInFlight = true;
  openKleoBtn.setAttribute("aria-disabled", "true");
  macSetupNote.hidden = false;
  macSetupNote.textContent = "Connecting this Mac…";

  const target = await freshMacEnrollTarget();
  openKleoInFlight = false;
  openKleoBtn.removeAttribute("aria-disabled");

  if (target.expired) {
    // Clear the gate before sending them back. Without this, app.js bounces any live
    // unlock straight to /install, so "unlock again" is advice the site itself refuses
    // to let them follow.
    clearUnlock();
    macSetupNote.textContent =
      "This setup session expired. Taking you back to enter a new code…";
    window.setTimeout(() => location.replace("/download"), 1200);
    return;
  }
  if (target.stale) {
    // Never navigate to a link we cannot prove is fresh: it would land on the same
    // "invalid or expired" screen this whole path exists to remove.
    macSetupNote.textContent =
      "Couldn’t reach Kleo to set up this Mac. Check your connection and click Open Kleo again.";
    return;
  }

  // Nothing about this credential stays behind once it is spent.
  try {
    sessionStorage.removeItem(MAC_SETUP_URL_KEY);
    sessionStorage.removeItem(SETUP_SESSION_KEY);
  } catch {
    /* Storage already unavailable; the credential expires on its own either way. */
  }
  openKleoBtn.hidden = true;
  // A custom scheme fails silently when the app is not installed yet, so leave standing
  // instructions rather than a spinner that never resolves.
  macSetupNote.textContent =
    "If nothing opened, install KleoKlaw first, then unlock the download page again to connect.";
  window.location.assign(target.url);
});

probeInstaller("macos", macBtn, "Mac");
