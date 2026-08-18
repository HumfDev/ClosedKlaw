const UNLOCK_KEY = "kleoklaw-desktop-unlock";
const API_ORIGIN = window.KLEOKLAW_API_BASE || "https://api.kleoklaw.com";

function gateHref() {
  if (location.pathname.endsWith("install.html")) return "/app.html";
  if (location.hostname === "app.kleoklaw.com") return "/";
  return "/app.html";
}

function readUnlock() {
  try {
    const raw = sessionStorage.getItem(UNLOCK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const unlock = readUnlock();
if (!unlock?.ok || typeof unlock.exp !== "number" || unlock.exp <= Date.now()) {
  location.replace(gateHref());
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
  if (meta) meta.textContent = `The ${label} installer isn’t published yet.`;
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

macBtn.addEventListener("click", () => track("macos"));
winBtn.addEventListener("click", () => track("windows"));

probeInstaller("macos", macBtn, "Mac");
probeInstaller("windows", winBtn, "Windows");
