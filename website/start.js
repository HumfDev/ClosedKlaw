import { KLEO_PHONE_FALLBACK } from "./kleo-config.js";
import { validateWebOnboarding } from "./lib/web-onboarding.js";

const STORAGE_KEY = "kleo-web-onboarding";

function buildKleoSmsHref(phone, body = "hey Kleo!") {
  const normalized = String(phone ?? "").trim();
  if (!normalized) return "#";
  return `sms:${normalized}&body=${encodeURIComponent(body)}`;
}

function canOpenIMessage() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const maxTouch = navigator.maxTouchPoints || 0;
  const isIPad = /iPad/.test(ua) || (platform === "MacIntel" && maxTouch > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  const isMac = /Macintosh|Mac OS X/.test(ua) && !isIPad;
  return isIPhone || isIPad || isMac;
}

function safeStartCode(value) {
  const code = String(value ?? "").trim().toLowerCase();
  return /^wk_[a-z0-9]{6}$/.test(code) ? code : "";
}

const STEPS = [
  {
    title: "Why auto-apply?",
    subtitle: "Kleo can apply to strong matches for you. Why do you want that?",
  },
  {
    title: "What roles?",
    subtitle: "Kleo will look for roles in these areas.",
  },
  {
    title: "What kind of work?",
    subtitle: "Internship, full-time, or both.",
  },
  {
    title: "Where should Kleo look?",
    subtitle: "Cities or regions you want — not your home address.",
  },
  {
    title: "How should auto-apply work?",
    subtitle: "Next you’ll add a card for the 30-day free trial.",
  },
];

const form = document.getElementById("start-form");
const qrView = document.getElementById("start-qr");
const progressEl = document.getElementById("start-progress");
const titleEl = document.getElementById("start-title");
const subtitleEl = document.getElementById("start-subtitle");
const errorEl = document.getElementById("start-error");
const backBtn = document.getElementById("start-back");
const nextBtn = document.getElementById("start-next");
const qrImg = document.getElementById("start-qr-img");
const qrNumber = document.getElementById("start-qr-number");
const qrCopy = document.getElementById("start-qr-copy");
const imessageBtn = document.getElementById("start-imessage");

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session_id") || "";
const returnedCode = safeStartCode(params.get("code"));

let step = 0;
let kleoPhone = KLEO_PHONE_FALLBACK;

function loadDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveDraft(data) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function checkedValues(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
}

function setChecked(name, values) {
  const wanted = new Set((values || []).map((item) => String(item)));
  form.querySelectorAll(`input[name="${name}"]`).forEach((el) => {
    el.checked = wanted.has(el.value);
  });
}

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function currentStepValid() {
  if (step === 0) return checkedValues("reasons").length > 0;
  if (step === 1) return checkedValues("categories").length > 0;
  if (step === 2) return Boolean(form.workType.value);
  if (step === 3) {
    const remoteOk = form.remoteOk.checked;
    const locations = form.locations.value.trim();
    return remoteOk || Boolean(locations);
  }
  if (step === 4) return Boolean(form.autoApplyMode.value);
  return false;
}

function renderStep() {
  form.hidden = false;
  qrView.hidden = true;
  form.querySelectorAll(".start-step").forEach((fieldset) => {
    fieldset.hidden = Number(fieldset.dataset.step) !== step;
  });
  progressEl.textContent = `${step + 1} of ${STEPS.length}`;
  titleEl.textContent = STEPS[step].title;
  subtitleEl.textContent = STEPS[step].subtitle;
  backBtn.hidden = step === 0;
  nextBtn.textContent = step === STEPS.length - 1 ? "Start 30-day trial" : "Continue";
  nextBtn.disabled = false;
  if (!params.get("checkout_error")) showError("");
}

function collectAnswers() {
  return {
    reasons: checkedValues("reasons"),
    jobCategories: checkedValues("categories"),
    workType: form.workType.value,
    remoteOk: form.remoteOk.checked,
    locations: form.locations.value,
    autoApplyMode: form.autoApplyMode.value,
  };
}

function restoreAnswers(answers) {
  if (!answers) return;
  setChecked("reasons", answers.reasons);
  setChecked("categories", answers.jobCategories);
  if (answers.workType) form.workType.value = answers.workType;
  form.remoteOk.checked = answers.remoteOk !== false;
  if (Array.isArray(answers.locations)) {
    form.locations.value = answers.locations.join(", ");
  } else if (answers.locations != null) {
    form.locations.value = String(answers.locations);
  }
  if (answers.autoApplyMode) form.autoApplyMode.value = answers.autoApplyMode;
}

function formatPhoneDisplay(e164) {
  const digits = String(e164 ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return String(e164 ?? "").trim();
}

function qrUrl(href) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=2&ecc=M&data=${encodeURIComponent(href)}`;
}

function smsHrefFor(startCode) {
  const code = safeStartCode(startCode);
  return buildKleoSmsHref(kleoPhone, code ? `hey Kleo! ${code}` : "hey Kleo!");
}

function showQr(href) {
  form.hidden = true;
  qrView.hidden = false;
  progressEl.textContent = "Done";
  titleEl.textContent = "Scan to text Kleo";
  subtitleEl.textContent = "Kleo is iMessage only. Finish setup from your iPhone.";
  qrImg.hidden = false;
  qrImg.src = qrUrl(href);
  qrImg.addEventListener("error", () => {
    qrImg.hidden = true;
  }, { once: true });
  qrNumber.textContent = `Text ${formatPhoneDisplay(kleoPhone)}`;
  showError("");

  if (canOpenIMessage()) {
    qrCopy.textContent = "Scan this with another phone, or open iMessage on this Mac or iPhone.";
    imessageBtn.hidden = false;
    imessageBtn.href = href;
  } else {
    qrCopy.textContent = "You’re not on a Mac or iPhone. Open the Camera app on your iPhone and scan this code.";
    imessageBtn.hidden = true;
  }
}

async function savePrefs(answers, checkoutSessionId) {
  const parsed = validateWebOnboarding({
    ...answers,
    sessionId: checkoutSessionId || "",
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const res = await fetch("/api/onboarding-prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error || "Could not save your preferences." };
  }
  return {
    ok: true,
    startCode: safeStartCode(data.start_code),
    smsHref: data.sms_href,
  };
}

async function startCheckout(startCode) {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startCode: startCode || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.checkout_url) {
    throw new Error(data.error || "Could not start checkout.");
  }
  window.location.href = data.checkout_url;
}

async function finishQuestionsThenCheckout() {
  const answers = collectAnswers();
  const parsed = validateWebOnboarding(answers);
  if (!parsed.ok) {
    showError(parsed.error);
    return;
  }

  nextBtn.disabled = true;
  nextBtn.textContent = "Saving…";
  const draft = { answers: parsed.payload };
  saveDraft(draft);

  try {
    const saved = await savePrefs(parsed.payload);
    if (saved.ok && saved.startCode) {
      draft.startCode = saved.startCode;
      draft.smsHref = saved.smsHref;
      saveDraft(draft);
    }
    nextBtn.textContent = "Redirecting…";
    await startCheckout(draft.startCode);
  } catch (err) {
    nextBtn.disabled = false;
    nextBtn.textContent = "Start 30-day trial";
    showError(err.message || "Could not start checkout.");
  }
}

async function finishPaidReturn(draft) {
  const startCode = returnedCode || safeStartCode(draft?.startCode);
  const answers = draft?.answers;
  if (answers && !startCode) {
    try {
      const saved = await savePrefs(answers, sessionId);
      if (saved.ok && saved.startCode) {
        saveDraft({ ...draft, answers, startCode: saved.startCode, smsHref: saved.smsHref });
        showQr(saved.smsHref || smsHrefFor(saved.startCode));
        return;
      }
    } catch {
      /* fall through to a code-free QR */
    }
  }
  showQr(draft?.smsHref || smsHrefFor(startCode));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentStepValid()) {
    showError("Pick an option to continue.");
    return;
  }
  if (step < STEPS.length - 1) {
    step += 1;
    renderStep();
    return;
  }
  finishQuestionsThenCheckout();
});

backBtn.addEventListener("click", () => {
  if (step === 0) return;
  step -= 1;
  renderStep();
});

async function init() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      if (data.kleoPhone) kleoPhone = data.kleoPhone;
    }
  } catch {
    /* fallback already set */
  }

  const draft = loadDraft();
  restoreAnswers(draft?.answers);

  if (sessionId) {
    await finishPaidReturn(draft);
    return;
  }

  if (draft?.answers) step = STEPS.length - 1;
  renderStep();
  if (params.get("checkout_error") === "1") {
    showError("Checkout didn’t start. Please try again.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
