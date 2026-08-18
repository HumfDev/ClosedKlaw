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

function randomMatchCount() {
  return 5 + Math.floor(Math.random() * 5);
}

function ensureMatchCount(draft) {
  const n = Number(draft?.matchCount);
  if (Number.isInteger(n) && n >= 5 && n <= 9) return n;
  return randomMatchCount();
}

const STEPS = [
  {
    title: "Why auto-apply?",
    subtitle: "Kleo can apply for you. Why do you want that?",
  },
  {
    title: "What’s slowest?",
    subtitle: "Where the search actually gets stuck.",
  },
  {
    title: "Where do you look?",
    subtitle: "How you search today — not cities. Those come over iMessage.",
  },
  {
    title: "What does winning look like?",
    subtitle: "What you want out of Kleo.",
  },
  {
    title: "What should Kleo optimize for?",
    subtitle: "Then we’ll show what’s waiting.",
  },
];

const form = document.getElementById("start-form");
const foundView = document.getElementById("start-found");
const unlockView = document.getElementById("start-unlock");
const qrView = document.getElementById("start-qr");
const progressEl = document.getElementById("start-progress");
const titleEl = document.getElementById("start-title");
const subtitleEl = document.getElementById("start-subtitle");
const errorEl = document.getElementById("start-error");
const backBtn = document.getElementById("start-back");
const nextBtn = document.getElementById("start-next");
const foundBackBtn = document.getElementById("start-found-back");
const foundNextBtn = document.getElementById("start-found-next");
const promoInput = document.getElementById("start-promo");
const promoApplyBtn = document.getElementById("start-promo-apply");
const acceptTerms = document.getElementById("start-accept-terms");
const acceptPrivacy = document.getElementById("start-accept-privacy");
const qrImg = document.getElementById("start-qr-img");
const qrNumber = document.getElementById("start-qr-number");
const qrCopy = document.getElementById("start-qr-copy");
const imessageBtn = document.getElementById("start-imessage");

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session_id") || "";
const returnedCode = safeStartCode(params.get("code"));
const usedPromo = params.get("promo") === "1";

let step = 0;
let kleoPhone = KLEO_PHONE_FALLBACK;
let unlockHref = "";
let prefsSavePromise = null;

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

function patchDraft(patch) {
  const next = { ...(loadDraft() || {}), ...patch };
  saveDraft(next);
  return next;
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
  if (step === 1) return Boolean(form.bottleneck.value);
  if (step === 2) return checkedValues("channels").length > 0;
  if (step === 3) return Boolean(form.outcome.value);
  if (step === 4) return Boolean(form.optimize.value);
  return false;
}

function hideViews() {
  form.hidden = true;
  foundView.hidden = true;
  unlockView.hidden = true;
  qrView.hidden = true;
}

function renderStep() {
  hideViews();
  form.hidden = false;
  form.querySelectorAll(".start-step").forEach((fieldset) => {
    fieldset.hidden = Number(fieldset.dataset.step) !== step;
  });
  progressEl.textContent = `${step + 1} of ${STEPS.length}`;
  titleEl.textContent = STEPS[step].title;
  subtitleEl.textContent = STEPS[step].subtitle;
  backBtn.hidden = step === 0;
  nextBtn.textContent = "Continue";
  nextBtn.disabled = false;
  if (!params.get("checkout_error")) showError("");
}

function collectAnswers() {
  return {
    reasons: checkedValues("reasons"),
    bottleneck: form.bottleneck.value,
    searchChannels: checkedValues("channels"),
    outcome: form.outcome.value,
    optimize: form.optimize.value,
  };
}

function restoreAnswers(answers) {
  if (!answers) return;
  setChecked("reasons", answers.reasons);
  if (answers.bottleneck) form.bottleneck.value = answers.bottleneck;
  setChecked("channels", answers.searchChannels);
  if (answers.outcome) form.outcome.value = answers.outcome;
  if (answers.optimize) form.optimize.value = answers.optimize;
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

function hasConsent() {
  return Boolean(acceptTerms?.checked && acceptPrivacy?.checked);
}

function showFound() {
  hideViews();
  foundView.hidden = false;
  const draft = loadDraft() || {};
  const matchCount = ensureMatchCount(draft);
  patchDraft({
    ...draft,
    matchCount,
    view: "found",
  });
  progressEl.textContent = "Ready";
  titleEl.textContent = `We found ${matchCount} roles that fit`;
  subtitleEl.textContent = "Here’s what Kleo can do from here.";
  foundNextBtn.disabled = false;
  promoApplyBtn.disabled = false;
  if (!params.get("checkout_error")) showError("");
}

function showQr(href) {
  qrView.hidden = false;
  qrImg.hidden = false;
  qrImg.src = qrUrl(href);
  qrImg.addEventListener("error", () => {
    qrImg.hidden = true;
  }, { once: true });
  qrNumber.textContent = `Text ${formatPhoneDisplay(kleoPhone)}`;

  if (canOpenIMessage()) {
    qrCopy.textContent = "Scan this with another phone, or open iMessage on this Mac or iPhone.";
    imessageBtn.hidden = false;
    imessageBtn.href = href;
  } else {
    qrCopy.textContent = "You’re not on a Mac or iPhone. Open the Camera app on your iPhone and scan this code.";
    imessageBtn.hidden = true;
  }
}

function syncUnlockQr() {
  if (!hasConsent() || !unlockHref) {
    qrView.hidden = true;
    imessageBtn.hidden = true;
    progressEl.textContent = "Almost";
    titleEl.textContent = "Agree, then text Kleo";
    subtitleEl.textContent = "Kleo is iMessage only. Accept Terms and Privacy to continue.";
    return;
  }
  progressEl.textContent = "Done";
  titleEl.textContent = "Text Kleo";
  subtitleEl.textContent = "Finish setup from your iPhone.";
  showQr(unlockHref);
}

function showUnlock(href) {
  hideViews();
  unlockView.hidden = false;
  unlockHref = href || smsHrefFor(returnedCode || loadDraft()?.startCode);
  acceptTerms.checked = false;
  acceptPrivacy.checked = false;
  showError("");
  syncUnlockQr();
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

async function persistPrefsOnce(answers, checkoutSessionId) {
  const existing = safeStartCode(loadDraft()?.startCode);
  if (existing) {
    const draft = loadDraft() || {};
    return {
      ...draft,
      startCode: existing,
      smsHref: draft.smsHref || smsHrefFor(existing),
    };
  }
  if (!prefsSavePromise) {
    prefsSavePromise = savePrefs(answers, checkoutSessionId)
      .then((saved) => {
        if (!saved.ok || !saved.startCode) {
          prefsSavePromise = null;
          return loadDraft() || {};
        }
        return patchDraft({
          startCode: saved.startCode,
          smsHref: saved.smsHref || smsHrefFor(saved.startCode),
        });
      })
      .catch((err) => {
        prefsSavePromise = null;
        throw err;
      });
  }
  return prefsSavePromise;
}

async function ensureStartCode(draft, checkoutSessionId) {
  const existing = safeStartCode(draft?.startCode);
  if (existing) {
    return {
      ...draft,
      startCode: existing,
      smsHref: draft.smsHref || smsHrefFor(existing),
    };
  }
  const answers = draft?.answers;
  if (!answers) return draft || {};
  return persistPrefsOnce(answers, checkoutSessionId);
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

async function finishQuestions() {
  const answers = collectAnswers();
  const parsed = validateWebOnboarding(answers);
  if (!parsed.ok) {
    showError(parsed.error);
    return;
  }

  const draft = patchDraft({
    answers: parsed.payload,
    matchCount: ensureMatchCount(loadDraft()),
    view: "found",
  });
  showFound();
  persistPrefsOnce(parsed.payload).catch(() => {
    /* Checkout and promo can retry the save. */
  });
  return draft;
}

async function goToPayment() {
  foundNextBtn.disabled = true;
  showError("");
  try {
    const draft = await ensureStartCode(loadDraft() || {});
    await startCheckout(draft.startCode || undefined);
  } catch (err) {
    foundNextBtn.disabled = false;
    showError(err.message || "Could not start checkout.");
  }
}

async function redeemPromo() {
  const promoCode = String(promoInput.value || "").trim();
  if (!promoCode) {
    showError("Enter a promo code.");
    return;
  }
  promoApplyBtn.disabled = true;
  showError("");
  try {
    const draft = loadDraft() || {};
    const existingCode = safeStartCode(draft.startCode);
    const res = await fetch("/api/promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        promoCode,
        startCode: existingCode || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "That code didn’t work.");
    }
    const next = patchDraft({
      paid: true,
      paidViaPromo: true,
      view: "unlock",
    });
    const startCode = safeStartCode(data.start_code || next.startCode);
    history.replaceState(
      {},
      "",
      startCode ? `/start.html?promo=1&code=${startCode}` : "/start.html?promo=1",
    );
    showUnlock(next.smsHref || smsHrefFor(startCode));
    if (next.answers) {
      persistPrefsOnce(next.answers)
        .then((saved) => {
          const code = safeStartCode(saved.startCode);
          if (!code || unlockView.hidden) return;
          unlockHref = saved.smsHref || smsHrefFor(code);
          history.replaceState({}, "", `/start.html?promo=1&code=${code}`);
          if (hasConsent()) showQr(unlockHref);
        })
        .catch(() => {});
    }
  } catch (err) {
    promoApplyBtn.disabled = false;
    showError(err.message || "That code didn’t work.");
  }
}

async function finishPaidReturn(draft) {
  const startCode = returnedCode || safeStartCode(draft?.startCode);
  let next = { ...(draft || {}), paid: true, view: "unlock" };
  if (next.answers && !startCode) {
    try {
      const saved = await savePrefs(next.answers, sessionId);
      if (saved.ok && saved.startCode) {
        next = patchDraft({
          ...next,
          startCode: saved.startCode,
          smsHref: saved.smsHref,
        });
        showUnlock(saved.smsHref || smsHrefFor(saved.startCode));
        return;
      }
    } catch {
      /* fall through to a code-free QR */
    }
  }
  saveDraft(next);
  showUnlock(next.smsHref || smsHrefFor(startCode));
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
  finishQuestions();
});

backBtn.addEventListener("click", () => {
  if (step === 0) return;
  step -= 1;
  renderStep();
});

foundBackBtn.addEventListener("click", () => {
  step = STEPS.length - 1;
  patchDraft({ view: "form" });
  renderStep();
});

foundNextBtn.addEventListener("click", () => {
  goToPayment();
});

promoApplyBtn.addEventListener("click", () => {
  redeemPromo();
});

promoInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    redeemPromo();
  }
});

acceptTerms.addEventListener("change", syncUnlockQr);
acceptPrivacy.addEventListener("change", syncUnlockQr);

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
  const answersOk = draft?.answers && validateWebOnboarding(draft.answers).ok;
  const paid = Boolean(sessionId || usedPromo || draft?.paid);

  if (paid) {
    await finishPaidReturn(draft);
    return;
  }

  if (answersOk && draft?.view !== "form") {
    showFound();
    if (params.get("checkout_error") === "1") {
      showError("Checkout didn’t start. Please try again.");
    }
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
