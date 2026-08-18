import { navigateWithTransition } from "/transitions.js";

const API_ORIGIN = window.KLEOKLAW_API_BASE || "https://api.kleoklaw.com";
const UNLOCK_KEY = "kleoklaw-desktop-unlock";
const UNLOCK_TTL_MS = 2 * 60 * 60 * 1000;
const SEND_CODE_COOLDOWN_MS = 30 * 1000;
const MATCH_ERROR =
  "That didn’t match. Check the number you text Kleo from, and the code we just sent.";
const NOT_LIVE_ERROR = "Download unlock isn’t live yet";

const form = document.getElementById("unlock-form");
const phoneInput = document.getElementById("phone-input");
const codeInput = document.getElementById("code-input");
const unlockBtn = document.getElementById("unlock-btn");
const sendCodeBtn = document.getElementById("send-code-btn");
const statusEl = document.getElementById("status");
const billingDone = document.getElementById("billing-done");

let sendCooldownUntil = 0;
let sendCooldownTimer = null;

function installHref() {
  return location.pathname.endsWith("app.html") ? "/install.html" : "/download";
}

function setStatus(msg, tone) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (tone === "error" ? " error" : tone === "ok" ? " ok" : "");
}

function storeUnlock(payload) {
  try {
    const session = payload?.download_session || null;
    sessionStorage.setItem(
      UNLOCK_KEY,
      JSON.stringify({
        ok: true,
        exp: Date.now() + UNLOCK_TTL_MS,
        session,
      }),
    );
  } catch {
    /* private mode — download page will bounce back */
  }
}

function readUnlock() {
  try {
    const raw = sessionStorage.getItem(UNLOCK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normalizedPhone() {
  return phoneInput.value.trim();
}

function isE164(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function setSendCodeLabel() {
  const remaining = Math.max(0, Math.ceil((sendCooldownUntil - Date.now()) / 1000));
  if (remaining > 0) {
    sendCodeBtn.textContent = `Send code (${remaining}s)`;
    sendCodeBtn.disabled = true;
    return;
  }
  sendCodeBtn.textContent = "Send code";
  sendCodeBtn.disabled = false;
  sendCooldownUntil = 0;
  if (sendCooldownTimer) {
    window.clearInterval(sendCooldownTimer);
    sendCooldownTimer = null;
  }
}

function startSendCooldown() {
  sendCooldownUntil = Date.now() + SEND_CODE_COOLDOWN_MS;
  setSendCodeLabel();
  if (sendCooldownTimer) window.clearInterval(sendCooldownTimer);
  sendCooldownTimer = window.setInterval(setSendCodeLabel, 250);
}

function decodeError(payload, fallback) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  return fallback;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

const params = new URLSearchParams(location.search);
if (params.get("step") === "billing-done") {
  billingDone.hidden = false;
}

const storedUnlock = readUnlock();
if (storedUnlock?.ok && typeof storedUnlock.exp === "number" && storedUnlock.exp > Date.now()) {
  navigateWithTransition(installHref());
}

codeInput.addEventListener("input", () => {
  codeInput.value = normalizeCode(codeInput.value);
});

codeInput.addEventListener("paste", (event) => {
  const digits = normalizeCode(event.clipboardData?.getData("text") || "");
  if (!digits) return;
  event.preventDefault();
  codeInput.value = digits;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const phone = normalizedPhone();
  const code = normalizeCode(codeInput.value);

  if (!isE164(phone)) {
    setStatus("Enter your phone in E.164 format, with country code.", "error");
    phoneInput.focus();
    return;
  }
  if (code.length !== 6) {
    setStatus("Enter the 6-digit code from your text.", "error");
    codeInput.focus();
    return;
  }

  unlockBtn.disabled = true;
  sendCodeBtn.disabled = true;
  setStatus("Checking…");

  try {
    const { res, payload } = await postJson(`${API_ORIGIN}/download/auth/verify`, {
      phone,
      code,
    });

    if (res.status === 404) {
      throw new Error(NOT_LIVE_ERROR);
    }
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410 || res.status === 422
          ? MATCH_ERROR
          : decodeError(payload, MATCH_ERROR),
      );
    }

    storeUnlock(payload);
    if (typeof gtag === "function") gtag("event", "desktop_unlock", { method: "code" });
    navigateWithTransition(installHref());
  } catch (err) {
    setStatus(String(err.message || err), "error");
    unlockBtn.disabled = false;
    setSendCodeLabel();
  }
});

sendCodeBtn.addEventListener("click", async () => {
  const phone = normalizedPhone();

  if (!isE164(phone)) {
    setStatus("Enter your phone in E.164 format, with country code.", "error");
    phoneInput.focus();
    return;
  }
  if (Date.now() < sendCooldownUntil) {
    return;
  }

  startSendCooldown();
  unlockBtn.disabled = true;
  setStatus("Sending…");

  try {
    const { res, payload } = await postJson(`${API_ORIGIN}/download/auth/start`, {
      phone,
    });

    if (res.status === 404) {
      throw new Error(NOT_LIVE_ERROR);
    }
    if (!res.ok) {
      throw new Error(decodeError(payload, "Couldn’t send a code right now. Try again shortly."));
    }

    setStatus("Code sent. Enter the 6-digit code from your text.", "ok");
    codeInput.focus();
    if (typeof gtag === "function") gtag("event", "desktop_send_code");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  } finally {
    unlockBtn.disabled = false;
    setSendCodeLabel();
  }
});

setSendCodeLabel();
