const UNLOCK_KEY = "kleoklaw-desktop-unlock";
const MAC_SETUP_URL_KEY = "kleoklaw-mac-setup-url";
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
const winBtn = document.getElementById("win-btn");
const osNote = document.getElementById("os-note");
const openKleoBtn = document.getElementById("open-kleo-btn");
const macSetupNote = document.getElementById("mac-setup-note");

macBtn.href = `${API_ORIGIN}/download/desktop/macos`;
winBtn.href = `${API_ORIGIN}/download/desktop/windows`;

if (platform === "macos") {
  macBtn.classList.add("download-btn--primary");
  winBtn.classList.add("download-btn--secondary");
} else if (platform === "windows") {
  winBtn.classList.add("download-btn--primary");
  macBtn.classList.add("download-btn--secondary");
} else {
  macBtn.classList.add("download-btn--primary");
  winBtn.classList.add("download-btn--primary");
  osNote.hidden = false;
  osNote.textContent = "KleoKlaw runs on Mac and Windows only.";
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
      credentials: "include",
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

function revealMacEnrollment() {
  if (!unlockIsValid()) {
    clearUnlock();
    location.replace("/download");
    return;
  }
  if (!readMacSetupUrl()) {
    clearUnlock();
    return;
  }
  openKleoBtn.hidden = false;
  macSetupNote.hidden = false;
}

macBtn.addEventListener("click", () => {
  track("macos");
  revealMacEnrollment();
});
winBtn.addEventListener("click", () => track("windows"));

openKleoBtn.addEventListener("click", (event) => {
  event.preventDefault();
  if (!unlockIsValid()) {
    clearUnlock();
    location.replace("/download");
    return;
  }
  const setupUrl = readMacSetupUrl();
  if (!setupUrl) return;
  // Do not put the URL into markup or leave it in storage after activation.
  sessionStorage.removeItem(MAC_SETUP_URL_KEY);
  openKleoBtn.hidden = true;
  macSetupNote.hidden = true;
  window.location.assign(setupUrl);
});

probeInstaller("macos", macBtn, "Mac");
probeInstaller("windows", winBtn, "Windows");
