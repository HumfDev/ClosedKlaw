import { KLEO_PHONE_FALLBACK } from "./kleo-config.js";
import { validateWebOnboarding } from "./lib/web-onboarding.js";

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
    subtitle: "You can change this later by texting Kleo.",
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

let step = 0;
let kleoPhone = KLEO_PHONE_FALLBACK;

function checkedValues(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
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
  form.querySelectorAll(".start-step").forEach((fieldset) => {
    fieldset.hidden = Number(fieldset.dataset.step) !== step;
  });
  progressEl.textContent = `${step + 1} of ${STEPS.length}`;
  titleEl.textContent = STEPS[step].title;
  subtitleEl.textContent = STEPS[step].subtitle;
  backBtn.hidden = step === 0;
  nextBtn.textContent = step === STEPS.length - 1 ? "Finish" : "Continue";
  nextBtn.disabled = false;
  showError("");
}

function collectAnswers() {
  return {
    sessionId,
    reasons: checkedValues("reasons"),
    jobCategories: checkedValues("categories"),
    workType: form.workType.value,
    remoteOk: form.remoteOk.checked,
    locations: form.locations.value,
    autoApplyMode: form.autoApplyMode.value,
  };
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

function showQr(smsHref) {
  form.hidden = true;
  qrView.hidden = false;
  progressEl.textContent = "Done";
  titleEl.textContent = "Scan to text Kleo";
  subtitleEl.textContent = "Kleo is iMessage only. Finish setup from your iPhone.";
  qrImg.src = qrUrl(smsHref);
  qrImg.addEventListener("error", () => {
    qrImg.hidden = true;
  }, { once: true });
  qrNumber.textContent = `Text ${formatPhoneDisplay(kleoPhone)}`;

  if (canOpenIMessage()) {
    qrCopy.textContent = "Scan this with another phone, or open iMessage on this Mac or iPhone.";
    imessageBtn.hidden = false;
    imessageBtn.href = smsHref;
  } else {
    qrCopy.textContent = "You’re not on a Mac or iPhone. Open the Camera app on your iPhone and scan this code.";
    imessageBtn.hidden = true;
  }
}

async function saveAndShowQr() {
  const parsed = validateWebOnboarding(collectAnswers());
  if (!parsed.ok) {
    showError(parsed.error);
    return;
  }

  nextBtn.disabled = true;
  nextBtn.textContent = "Saving…";
  try {
    const res = await fetch("/api/onboarding-prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.sms_href) {
      throw new Error(data.error || "Could not save your preferences.");
    }
    showQr(data.sms_href);
  } catch (err) {
    showQr(buildKleoSmsHref(kleoPhone, "hey Kleo!"));
    qrCopy.textContent =
      "Scan this with your iPhone Camera to text Kleo. Preferences weren’t saved from the site, so Kleo will ask them over iMessage.";
  }
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
  saveAndShowQr();
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
  renderStep();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
