import { KLEO_PHONE_FALLBACK } from "./kleo-config.js";
import { normalizeToE164 } from "./lib/phone.js";
import { isPronounPreset, parsePronouns } from "./lib/pronouns.js";
import { validateWebOnboarding } from "./lib/web-onboarding.js";
import { getFunnelVisitorId, trackFunnel, trackOnboardingStep } from "./funnel-track.js";

const STORAGE_KEY = "kleo-web-onboarding";

function buildKleoSmsHref(phone, body = "Hey Kleo!") {
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
  { title: "Why auto-apply?" },
  { title: "What’s slowest?" },
  { title: "Where do you look?" },
  { title: "What does winning look like?" },
  { title: "What should Kleo optimize for?" },
];

const card = document.getElementById("start-card");
const pane = document.getElementById("start-pane");
const nav = document.getElementById("start-nav");
const form = document.getElementById("start-form");
const foundView = document.getElementById("start-found");
const promoInput = document.getElementById("start-promo-input");
const searchingView = document.getElementById("start-searching");
const phoneForm = document.getElementById("start-phone-form");
const phoneInput = document.getElementById("start-phone-input");
const phoneField = document.getElementById("start-phone-field");
const phoneHint = document.getElementById("start-phone-hint");
const nameInput = document.getElementById("start-name-input");
const nameField = document.getElementById("start-name-field");
const pronounsField = document.getElementById("start-pronouns-field");
const pronounsOtherWrap = document.getElementById("start-pronouns-other-wrap");
const pronounsOtherInput = document.getElementById("start-pronouns-other");
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
const consentView = document.getElementById("start-consent");
const qrImg = document.getElementById("start-qr-img");
const qrNumber = document.getElementById("start-qr-number");
const qrCopy = document.getElementById("start-qr-copy");
const imessageBtn = document.getElementById("start-imessage");

const params = new URLSearchParams(window.location.search);
const returnedCode = safeStartCode(params.get("code"));
let usedPromo = params.get("promo") === "1";
let promoCode = (() => {
  const raw = String(params.get("promo_code") || params.get("promo") || "").trim();
  return raw && raw !== "1" ? raw : "";
})();

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

function setHeading(title, subtitle = "") {
  titleEl.textContent = title;
  subtitleEl.hidden = !subtitle;
  subtitleEl.textContent = subtitle || "";
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
  if (phoneForm) phoneForm.hidden = true;
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
  nextBtn.type = "submit";
  nextBtn.textContent = "Continue";
  nextBtn.setAttribute("form", phoneForm && !phoneForm.hidden ? "start-phone-form" : "start-form");
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
    setHeading(STEPS[step].title);
    syncNav({ placeholderBack: step === 0 });
    showError("");
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

function hasFullName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 120;
}

function knownFullName(draft = loadDraft()) {
  return hasFullName(draft?.fullName) ? String(draft.fullName).trim().replace(/\s+/g, " ") : "";
}

function knownPronouns(draft = loadDraft()) {
  return parsePronouns(draft?.pronouns);
}

function selectedPronounChoice() {
  return phoneForm?.querySelector('input[name="pronouns"]:checked')?.value || "";
}

function syncPronounOther() {
  const other = selectedPronounChoice() === "other";
  if (pronounsOtherWrap) pronounsOtherWrap.hidden = !other;
}

function restorePronouns(value) {
  const pronouns = parsePronouns(value);
  if (!phoneForm) return;
  phoneForm.querySelectorAll('input[name="pronouns"]').forEach((el) => {
    el.checked = false;
  });
  if (!pronouns) {
    syncPronounOther();
    return;
  }
  if (isPronounPreset(pronouns)) {
    const preset = phoneForm.querySelector(`input[name="pronouns"][value="${pronouns}"]`);
    if (preset) preset.checked = true;
    if (pronounsOtherInput) pronounsOtherInput.value = "";
  } else {
    const other = phoneForm.querySelector('input[name="pronouns"][value="other"]');
    if (other) other.checked = true;
    if (pronounsOtherInput) pronounsOtherInput.value = pronouns;
  }
  syncPronounOther();
}

function collectedPronouns() {
  const choice = selectedPronounChoice();
  if (choice === "other") return parsePronouns(pronounsOtherInput?.value);
  return parsePronouns(choice);
}

function qrUrl(href) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=2&ecc=M&data=${encodeURIComponent(href)}`;
}

function smsHrefFor() {
  return buildKleoSmsHref(kleoPhone);
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
    setHeading("Finding roles that fit…", "Matching your answers to open roles.");
    syncNav({ placeholderBack: false });
    nextBtn.disabled = true;
    nextBtn.classList.add("is-placeholder");
    showError("");
  };
  transitionView(apply, { animated, direction, settle: false });
}

function showCode({ animated = false, direction = "forward" } = {}) {
  const apply = () => {
    hideViews();
    clearSearchTimer();
    document.body.classList.remove(
      "start-page--searching",
      "start-page--found",
      "start-page--found-enter",
    );
    foundView.hidden = false;
    const list = foundView.querySelector(".start-found-list");
    if (list) list.hidden = true;
    if (progressEl) progressEl.hidden = true;
    setHeading("Enter your code", "Enter the code you were given.");
    syncNav({ placeholderBack: true });
    nextBtn.type = "button";
    nextBtn.removeAttribute("form");
    nextBtn.textContent = "Continue";
    nextBtn.classList.remove("is-placeholder");
    nextBtn.disabled = false;
    showError("");
    promoInput?.focus();
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
  qrNumber.textContent = `• Text Kleo at ${formatPhoneDisplay(kleoPhone)}`;

  if (canOpenIMessage()) {
    qrCopy.textContent = "Scan this with another phone, or open iMessage on this Mac or iPhone.";
    imessageBtn.hidden = false;
    imessageBtn.href = href;
  } else {
    qrCopy.textContent = "You’re not on a Mac or iPhone. Open the Camera app on your iPhone and scan this code.";
    imessageBtn.hidden = true;
  }
}

function syncConsentContinue() {
  nextBtn.disabled = !hasConsent() || !unlockHref;
}

function showQrStep() {
  if (!hasConsent() || !unlockHref) return;
  consentView.hidden = true;
  progressEl.textContent = "Done";
  setHeading("Text Kleo", "Finish setup from your iPhone.");
  showQr(unlockHref);
  syncNav({ hidden: true });
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
    unlockHref = href || smsHrefFor();
    acceptTerms.checked = false;
    acceptPrivacy.checked = false;
    consentView.hidden = false;
    qrView.hidden = true;
    imessageBtn.hidden = true;
    showError("");
    progressEl.textContent = "Almost";
    setHeading("Agree to continue", "Accept Terms and Privacy before we show Kleo’s number.");
    syncNav({ placeholderBack: true });
    syncConsentContinue();
    const draft = loadDraft() || {};
    trackFunnel("unlock", {
      answers: draft.answers,
      startCode: returnedCode || draft.startCode,
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
      smsHref: draft.smsHref || smsHrefFor(),
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
          smsHref: saved.smsHref || smsHrefFor(),
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
      smsHref: draft.smsHref || smsHrefFor(),
    };
  }
  const answers = draft?.answers;
  if (!answers) return draft || {};
  return persistPrefsOnce(answers, checkoutSessionId);
}

async function redeemPromo(code, startCode) {
  const res = await fetch("/api/promo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      promoCode: code,
      startCode: startCode || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.bypass) {
    throw new Error(data.error || "That code didn’t work.");
  }

  promoCode = String(code).trim();
  usedPromo = true;
  const destination = new URL("/start", window.location.origin);
  destination.searchParams.set("promo", "1");
  destination.searchParams.set("promo_code", promoCode);
  if (startCode) destination.searchParams.set("code", startCode);
  history.replaceState(null, "", `${destination.pathname}${destination.search}`);
  patchDraft({ paid: true, view: "phone" });
  trackFunnel("paid", {
    answers: loadDraft()?.answers,
    startCode,
    usedPromo: true,
  });
  showPhone({ animated: true });
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
    showCode({ animated: true, direction: "forward" });
  }, revealDelay);
  return draft;
}

async function checkoutStartCode() {
  let draft = loadDraft() || {};
  try {
    draft = await ensureStartCode(draft);
  } catch {
    /* Paywall still works if the prefs API is down. */
  }
  return { draft, startCode: draft.startCode };
}

let codeSubmitPending = false;

async function submitCode() {
  const promoCode = promoInput?.value.trim();
  if (!promoCode) {
    showError("Enter your code.");
    promoInput?.focus();
    return;
  }
  if (codeSubmitPending) return;
  codeSubmitPending = true;
  showError("");
  try {
    const { startCode } = await checkoutStartCode();
    await redeemPromo(promoCode, startCode);
  } catch (err) {
    codeSubmitPending = false;
    showError(err.message || "That code didn’t work.");
  }
}

function showPhone({ animated = false, direction = "forward" } = {}) {
  const apply = () => {
    hideViews();
    clearSearchTimer();
    document.body.classList.remove(
      "start-page--found",
      "start-page--found-enter",
      "start-page--searching",
    );
    phoneForm.hidden = false;
    const draft = patchDraft({
      ...(loadDraft() || {}),
      paid: true,
      view: "phone",
    });
    const needName = !knownFullName(draft);
    const needPronouns = !knownPronouns(draft);
    const needPhone = !(draft.phoneVerified && draft.phone);
    if (nameField) nameField.hidden = !needName;
    if (pronounsField) pronounsField.hidden = !needPronouns;
    if (phoneField) phoneField.hidden = !needPhone;
    if (phoneHint) phoneHint.hidden = !needPhone;
    if (needName && needPhone) {
      progressEl.textContent = "Almost";
      setHeading("What’s your name and number?", "We’ll only text this iPhone. Then you’ll get Kleo’s number.");
    } else if (needName) {
      progressEl.textContent = "Almost";
      setHeading("What’s your full name?", "Kleo uses this when applying for you.");
    } else if (needPronouns && !needPhone) {
      progressEl.textContent = "Almost";
      setHeading("What are your pronouns?", "Kleo uses this when applying for you.");
    } else if (needPronouns) {
      progressEl.textContent = "Almost";
      setHeading("What’s your iPhone number?", "We’ll only text this number. Then you’ll get Kleo’s number.");
    } else {
      progressEl.textContent = "Almost";
      setHeading("What’s your iPhone number?", "We’ll only text this number. Then you’ll get Kleo’s number.");
    }
    syncNav({ placeholderBack: true });
    showError("");
    const storedName = knownFullName(draft);
    if (storedName && nameInput && !nameInput.value) nameInput.value = storedName;
    restorePronouns(draft.pronouns);
    const storedPhone = loadDraft()?.phone || "";
    if (storedPhone && phoneInput && !phoneInput.value) phoneInput.value = storedPhone;
    if (needName) nameInput?.focus();
    else if (needPronouns) {
      const checked = phoneForm?.querySelector('input[name="pronouns"]:checked');
      if (checked?.value === "other") pronounsOtherInput?.focus();
      else phoneForm?.querySelector('input[name="pronouns"]')?.focus();
    } else phoneInput?.focus();
  };
  transitionView(apply, { animated, direction });
}

async function goToUnlock(draft, { animated = true } = {}) {
  const startCode = returnedCode || safeStartCode(draft?.startCode);
  let next = { ...(draft || {}), paid: true, phoneVerified: true, view: "unlock" };
  if (next.answers && !startCode) {
    try {
      const saved = await savePrefs(next.answers);
      if (saved.ok && saved.startCode) {
        next = patchDraft({
          ...next,
          startCode: saved.startCode,
          smsHref: saved.smsHref,
        });
        showUnlock(saved.smsHref || smsHrefFor(), { animated });
        return;
      }
    } catch {
      /* fall through to a code-free QR */
    }
  }
  saveDraft(next);
  showUnlock(next.smsHref || smsHrefFor(), { animated });
}

async function submitPhone() {
  const draft = loadDraft() || {};
  const phone = normalizeToE164(phoneInput?.value || draft.phone);
  if (!phone) {
    showError("Enter the iPhone number you’ll text Kleo from.");
    phoneInput?.focus();
    return;
  }

  const typedName = String(nameInput?.value ?? "").trim().replace(/\s+/g, " ");
  const fullName = hasFullName(typedName) ? typedName : knownFullName(draft);
  if (!fullName) {
    showError("Enter your full name.");
    nameInput?.focus();
    return;
  }

  const pronouns = collectedPronouns() || knownPronouns(draft);
  nextBtn.disabled = true;
  showError("");
  try {
    const res = await fetch("/api/verified-numbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        fullName,
        pronouns,
        promoCode: promoCode || undefined,
        startCode: returnedCode || loadDraft()?.startCode || undefined,
        visitorId: getFunnelVisitorId(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.phone) {
      throw new Error(data.error || "Could not save your number.");
    }
    const next = patchDraft({
      paid: true,
      phone: data.phone,
      fullName: data.fullName || fullName,
      pronouns: data.pronouns || pronouns,
      phoneVerified: true,
      view: "unlock",
    });
    await goToUnlock(next);
  } catch (err) {
    nextBtn.disabled = false;
    showError(err.message || "Could not save your number.");
    if (!knownFullName()) nameInput?.focus();
    else if (!knownPronouns()) {
      if (selectedPronounChoice() === "other") pronounsOtherInput?.focus();
    } else phoneInput?.focus();
  }
}

async function finishPaidReturn(draft) {
  const startCode = returnedCode || safeStartCode(draft?.startCode);
  trackFunnel("paid", {
    answers: draft?.answers,
    startCode,
    usedPromo,
  });
  const next = { ...(loadDraft() || draft || {}), paid: true };
  saveDraft(next);
  if (next.phoneVerified && next.phone && knownFullName(next) && knownPronouns(next)) {
    await goToUnlock(next, { animated: false });
    return;
  }
  showPhone({ animated: true });
}

nextBtn.addEventListener("click", () => {
  if (nextBtn.type === "button" && foundView && !foundView.hidden) {
    submitCode();
  }
});

promoInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  submitCode();
});

promoInput?.addEventListener("input", () => {
  const digits = promoInput.value.replace(/\D/g, "");
  if (digits !== promoInput.value) promoInput.value = digits;
  if (digits.length === 6) submitCode();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (form.hidden) {
    if (!consentView.hidden) showQrStep();
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

phoneForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPhone();
});

phoneForm?.querySelectorAll('input[name="pronouns"]').forEach((el) => {
  el.addEventListener("change", () => {
    syncPronounOther();
    if (el.value === "other") pronounsOtherInput?.focus();
  });
});

backBtn.addEventListener("click", () => {
  if (!foundView.hidden || !searchingView.hidden) {
    return;
  }
  if (step === 0) return;
  step -= 1;
  renderStep({ animated: true, direction: "back" });
});

acceptTerms.addEventListener("change", syncConsentContinue);
acceptPrivacy.addEventListener("change", syncConsentContinue);

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
  const paid = Boolean(usedPromo || draft?.phoneVerified);

  if (paid) {
    await finishPaidReturn(draft);
    return;
  }

  showCode();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
