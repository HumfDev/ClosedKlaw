import { KLEO_PHONE_FALLBACK } from "./kleo-config.js";
import { validateWebOnboarding } from "./lib/web-onboarding.js";
import { trackFunnel, trackOnboardingStep } from "./funnel-track.js";

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

const card = document.getElementById("start-card");
const pane = document.getElementById("start-pane");
const nav = document.getElementById("start-nav");
const form = document.getElementById("start-form");
const foundView = document.getElementById("start-found");
const searchingView = document.getElementById("start-searching");
const unlockView = document.getElementById("start-unlock");
const qrView = document.getElementById("start-qr");
const stepReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const STEP_EXIT_MS = 200;
const STEP_SETTLE_MS = 420;
const SEARCH_MS_MIN = 2000;
const SEARCH_MS_MAX = 3000;
const FOUND_COUNT_MIN = 11;
const FOUND_COUNT_MAX = 18;
let stepExitTimer = 0;
let stepSettleTimer = 0;
let searchTimer = 0;
let searchPending = false;
const progressEl = document.getElementById("start-progress");
const titleEl = document.getElementById("start-title");
const subtitleEl = document.getElementById("start-subtitle");
const errorEl = document.getElementById("start-error");
const backBtn = document.getElementById("start-back");
const nextBtn = document.getElementById("start-next");
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
  searchingView.hidden = true;
  foundView.hidden = true;
  unlockView.hidden = true;
  qrView.hidden = true;
}

function clearSearchTimer() {
  window.clearTimeout(searchTimer);
  searchTimer = 0;
  searchPending = false;
}

function searchDelayMs() {
  return SEARCH_MS_MIN + Math.random() * (SEARCH_MS_MAX - SEARCH_MS_MIN);
}

function foundRoleCount() {
  const stored = Number(loadDraft()?.foundCount);
  if (
    Number.isInteger(stored)
    && stored >= FOUND_COUNT_MIN
    && stored <= FOUND_COUNT_MAX
  ) {
    return stored;
  }
  const count = FOUND_COUNT_MIN
    + Math.floor(Math.random() * (FOUND_COUNT_MAX - FOUND_COUNT_MIN + 1));
  patchDraft({ foundCount: count });
  return count;
}

function syncNav({ placeholderBack = false, hidden = false } = {}) {
  if (nav) nav.hidden = hidden;
  card?.classList.toggle("start-card--nav-hidden", hidden);
  backBtn.classList.toggle("is-placeholder", placeholderBack);
  backBtn.disabled = placeholderBack;
  backBtn.tabIndex = placeholderBack ? -1 : 0;
  backBtn.setAttribute("aria-hidden", placeholderBack ? "true" : "false");
  nextBtn.disabled = false;
  nextBtn.classList.remove("is-placeholder");
  nextBtn.textContent = "Continue";
}

function playFoundReveal() {
  document.body.classList.remove("start-page--found-enter");
  if (stepReduceMotion.matches) return;
  void document.body.offsetWidth;
  document.body.classList.add("start-page--found-enter");
}

/**
 * Fade the questions out, swap the step, then fade the next page in.
 * The Back/Continue bar stays put so it doesn't jump with the copy.
 */
function transitionView(apply, { animated = true, direction = "forward", settle = true } = {}) {
  if (!animated || !pane || stepReduceMotion.matches) {
    apply();
    return;
  }

  window.clearTimeout(stepExitTimer);
  window.clearTimeout(stepSettleTimer);

  pane.dataset.dir = direction;
  pane.classList.add("is-step-changing");
  pane.classList.remove("is-step-settling");

  stepExitTimer = window.setTimeout(() => {
    apply();
    pane.classList.remove("is-step-changing");
    if (!settle) {
      delete pane.dataset.dir;
      return;
    }
    pane.classList.add("is-step-settling");
    stepSettleTimer = window.setTimeout(() => {
      pane.classList.remove("is-step-settling");
      delete pane.dataset.dir;
    }, STEP_SETTLE_MS);
  }, STEP_EXIT_MS);
}

function renderStep({ animated = false, direction = "forward" } = {}) {
  const apply = () => {
    hideViews();
    clearSearchTimer();
    document.body.classList.remove(
      "start-page--found",
      "start-page--found-enter",
      "start-page--searching",
    );
    form.hidden = false;
    form.querySelectorAll(".start-step").forEach((fieldset) => {
      fieldset.hidden = Number(fieldset.dataset.step) !== step;
    });
    progressEl.textContent = `${step + 1} of ${STEPS.length}`;
    titleEl.textContent = STEPS[step].title;
    subtitleEl.textContent = STEPS[step].subtitle;
    syncNav({ placeholderBack: step === 0 });
    if (!params.get("checkout_error")) showError("");
    trackOnboardingStep(step, { answers: collectAnswers() });
  };
  transitionView(apply, { animated, direction });
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

function showSearching({ animated = false, direction = "forward" } = {}) {
  const apply = () => {
    hideViews();
    document.body.classList.remove("start-page--found", "start-page--found-enter");
    document.body.classList.add("start-page--searching");
    searchingView.hidden = false;
    patchDraft({
      ...(loadDraft() || {}),
      view: "searching",
    });
    progressEl.textContent = "Searching";
    titleEl.textContent = "Finding roles that fit…";
    subtitleEl.textContent = "Matching your answers to open roles.";
    syncNav({ placeholderBack: false });
    nextBtn.disabled = true;
    nextBtn.classList.add("is-placeholder");
    if (!params.get("checkout_error")) showError("");
  };
  transitionView(apply, { animated, direction, settle: false });
}

function showFound({ animated = false, direction = "forward" } = {}) {
  const apply = () => {
    hideViews();
    clearSearchTimer();
    document.body.classList.remove("start-page--searching");
    document.body.classList.add("start-page--found");
    foundView.hidden = false;
    const count = foundRoleCount();
    patchDraft({
      ...(loadDraft() || {}),
      view: "found",
      foundCount: count,
    });
    progressEl.textContent = "Ready";
    titleEl.textContent = `We found ${count}+ roles that fit`;
    subtitleEl.textContent = "Here’s what Kleo can do from here.";
    syncNav({ placeholderBack: false });
    nextBtn.classList.remove("is-placeholder");
    if (!params.get("checkout_error")) showError("");
    trackFunnel("found", { answers: collectAnswers() });
    playFoundReveal();
  };
  transitionView(apply, { animated, direction, settle: false });
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

function showUnlock(href, { animated = false, direction = "forward" } = {}) {
  const apply = () => {
    hideViews();
    clearSearchTimer();
    document.body.classList.remove(
      "start-page--found",
      "start-page--found-enter",
      "start-page--searching",
    );
    unlockView.hidden = false;
    unlockHref = href || smsHrefFor(returnedCode || loadDraft()?.startCode);
    acceptTerms.checked = false;
    acceptPrivacy.checked = false;
    showError("");
    syncUnlockQr();
    syncNav({ hidden: true });
    const draft = loadDraft() || {};
    trackFunnel("unlock", {
      answers: draft.answers,
      startCode: returnedCode || draft.startCode,
      stripeSessionId: sessionId || undefined,
      usedPromo,
    });
  };
  transitionView(apply, { animated, direction });
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
  const checkoutUrl = data.checkout_url;
  if (stepReduceMotion.matches) {
    window.location.href = checkoutUrl;
    return;
  }
  document.body.classList.add("page-transition-exit");
  window.setTimeout(() => {
    window.location.href = checkoutUrl;
  }, STEP_EXIT_MS);
}

async function finishQuestions() {
  if (searchPending || searchTimer) return;
  const answers = collectAnswers();
  const parsed = validateWebOnboarding(answers);
  if (!parsed.ok) {
    showError(parsed.error);
    return;
  }

  searchPending = true;
  nextBtn.disabled = true;
  const draft = patchDraft({
    answers: parsed.payload,
    view: "searching",
    foundCount: foundRoleCount(),
  });
  showSearching({ animated: true, direction: "forward" });
  persistPrefsOnce(parsed.payload).catch(() => {
    /* Checkout can retry the save. */
  });
  const revealDelay = searchDelayMs() + (stepReduceMotion.matches ? 0 : STEP_EXIT_MS);
  searchTimer = window.setTimeout(() => {
    showFound({ animated: true, direction: "forward" });
  }, revealDelay);
  return draft;
}

async function goToPayment() {
  nextBtn.disabled = true;
  showError("");
  let startCode;
  let draft = loadDraft() || {};
  try {
    draft = await ensureStartCode(draft);
    startCode = draft.startCode;
  } catch {
    /* Paywall still works if the prefs API is down. */
  }
  trackFunnel("checkout", {
    answers: draft.answers,
    startCode,
  });
  try {
    await startCheckout(startCode);
  } catch (err) {
    nextBtn.disabled = false;
    showError(err.message || "Could not start checkout.");
  }
}

async function finishPaidReturn(draft) {
  const startCode = returnedCode || safeStartCode(draft?.startCode);
  trackFunnel("paid", {
    answers: draft?.answers,
    startCode,
    stripeSessionId: sessionId || undefined,
    usedPromo,
  });
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
  if (form.hidden) {
    if (!foundView.hidden) goToPayment();
    return;
  }
  if (!currentStepValid()) {
    showError("Pick an option to continue.");
    return;
  }
  if (step < STEPS.length - 1) {
    step += 1;
    renderStep({ animated: true, direction: "forward" });
    return;
  }
  finishQuestions();
});

backBtn.addEventListener("click", () => {
  if (!foundView.hidden || !searchingView.hidden) {
    clearSearchTimer();
    step = STEPS.length - 1;
    patchDraft({ view: "form" });
    renderStep({ animated: true, direction: "back" });
    return;
  }
  if (step === 0) return;
  step -= 1;
  renderStep({ animated: true, direction: "back" });
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
  const paid = Boolean(sessionId || usedPromo);
  const resumeFound = params.get("resume") === "1" || params.get("checkout_error") === "1";

  if (paid) {
    await finishPaidReturn(draft);
    return;
  }

  if (resumeFound && answersOk) {
    showFound();
    if (params.get("checkout_error") === "1") {
      showError("Checkout didn’t start. Please try again.");
    }
    return;
  }

  step = 0;
  renderStep();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
