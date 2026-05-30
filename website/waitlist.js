import { navigateWithTransition } from "./transitions.js";

const WAITLIST_SUBMITTED_KEY = "ck_waitlist_submitted";
const WAITLIST_AUTH_PENDING_KEY = "ck_waitlist_google_pending";
const WAITLIST_AUTH_OK_KEY = "ck_waitlist_google_auth";

function waitlistRedirectTo() {
  return `${window.location.origin}/waitlist.html`;
}

function getWaitlistErrorMessage() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("waitlist_error") || params.get("error");
  if (code === "invalid-token") {
    return "That verification link is invalid or expired.";
  }
  return null;
}

function cleanWaitlistErrorFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("waitlist_error");
  if (url.searchParams.get("error") === "invalid-token") {
    url.searchParams.delete("error");
  }
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function isOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("code")) return true;

  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const hashParams = new URLSearchParams(hash);
  return hashParams.has("access_token") || hashParams.has("code");
}

function getOAuthErrorMessage() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("error_description")) return params.get("error_description");
  const error = params.get("error");
  if (error && error !== "invalid-token") return "Google sign-in was cancelled.";
  return null;
}

function authFlag(key) {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
function setAuthFlag(key) {
  try { localStorage.setItem(key, "1"); } catch {}
}
function clearAuthFlag(key) {
  try { localStorage.removeItem(key); } catch {}
}

function clearWaitlistAuthFlags() {
  clearAuthFlag(WAITLIST_AUTH_OK_KEY);
  clearAuthFlag(WAITLIST_AUTH_PENDING_KEY);
}

function markWaitlistAuthSuccess() {
  setAuthFlag(WAITLIST_AUTH_OK_KEY);
  clearAuthFlag(WAITLIST_AUTH_PENDING_KEY);
}

function cleanOAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  url.hash = "";
  history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function shouldUseSession() {
  return authFlag(WAITLIST_AUTH_OK_KEY) || authFlag(WAITLIST_AUTH_PENDING_KEY) || isOAuthCallback();
}

async function getSessionWithTimeout(client, ms = 8000) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(
      () => resolve({ data: { session: null }, error: new Error("Session check timed out") }),
      ms,
    );
  });
  try {
    return await Promise.race([client.auth.getSession(), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

// --- DOM refs ---
const methodStep = document.getElementById("method-step");
const authLoading = document.getElementById("auth-loading");
const googleSignInBtn = document.getElementById("google-sign-in");
const emailSignInBtn = document.getElementById("email-sign-in");
const emailBackBtn = document.getElementById("email-back");
const waitlistBackHome = document.getElementById("waitlist-back-home");
const form = document.getElementById("waitlist-form");
const signedInEmail = document.getElementById("signed-in-email");
const signOutBtn = document.getElementById("sign-out-btn");
const messageEl = document.getElementById("form-message");
const authMessageEl = document.getElementById("auth-message");
const submitBtn = document.getElementById("submit-btn");
const acceptTerms = document.getElementById("accept-terms");

const emailForm = document.getElementById("email-form");
const emailSubmitBtn = document.getElementById("email-submit-btn");
const emailAcceptTerms = document.getElementById("email-accept-terms");
const emailMessageEl = document.getElementById("email-form-message");

const termsModal = document.getElementById("terms-modal");
const closeTermsBtn = document.getElementById("close-terms");
const termsBackdrop = termsModal.querySelector("[data-close-terms]");
const termsBody = document.getElementById("terms-modal-body");

// --- State ---
let termsLoaded = false;
let termsFocus = null;
let captchaToken = null;
let turnstileWidgetId = null;
let supabase = null;
let supabaseInitPromise = null;
let authListenerRegistered = false;
let session = null;
let userRequestedSignOut = false;

async function ensureSupabase() {
  if (supabase) return supabase;
  if (!supabaseInitPromise) {
    const initTimeout = new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Auth client timed out. Try again.")), 10000);
    });
    supabaseInitPromise = Promise.race([
      import("./supabase-client.js").then((mod) => mod.getSupabase()),
      initTimeout,
    ])
      .then((client) => {
        supabase = client;
        if (!authListenerRegistered) {
          supabase.auth.onAuthStateChange(handleAuthStateChange);
          authListenerRegistered = true;
        }
        return supabase;
      })
      .catch((err) => {
        supabaseInitPromise = null;
        throw err;
      });
  }
  return supabaseInitPromise;
}

// --- Other text box show/hide ---
function setupOtherToggle(checkboxName, wrapperId) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  document.querySelectorAll(`input[name="${checkboxName}"][value="other"]`).forEach((cb) => {
    cb.addEventListener("change", () => { wrap.hidden = !cb.checked; });
  });
}
setupOtherToggle("jobTypes", "job-other-wrap");
setupOtherToggle("emailJobTypes", "email-job-other-wrap");

// Set birthday bounds for email form
(function() {
  const input = document.getElementById("email-birthday");
  if (!input) return;
  const today = new Date();
  input.max = new Date(Date.UTC(today.getUTCFullYear() - 13, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10);
  input.min = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate())).toISOString().slice(0, 10);
})();

function collectJobTypes(formEl, checkboxName, otherInputName) {
  const checked = [...formEl.querySelectorAll(`input[name="${checkboxName}"]:checked`)].map((cb) => cb.value);
  const otherText = String(formEl.querySelector(`[name="${otherInputName}"]`)?.value ?? "").trim();
  return checked.map((t) => (t === "other" && otherText ? `other: ${otherText}` : t));
}

// --- Turnstile (bridge handles race condition with async script load) ---
window._onTurnstileReady = (token) => {
  captchaToken = token;
  updateEmailSubmitState();
};
// If Turnstile already fired before this module loaded, pick up the token now
if (window._turnstileToken) {
  captchaToken = window._turnstileToken;
}

function updateSubmitState() {
  submitBtn.disabled = !acceptTerms.checked;
}

function ensureTurnstile() {
  if (!window.turnstile) return;
  const container = document.getElementById("turnstile-container");
  if (!container) return;
  if (turnstileWidgetId != null) {
    window.turnstile.reset(turnstileWidgetId);
    return;
  }
  turnstileWidgetId = window.turnstile.render(container, {
    sitekey: container.dataset.sitekey,
    theme: "light",
    callback: (token) => {
      window.onTurnstileSuccess(token);
    },
    "expired-callback": () => {
      window.onTurnstileExpired();
    },
  });
}

function resetTurnstile() {
  captchaToken = null;
  if (window.turnstile && turnstileWidgetId != null) {
    window.turnstile.reset(turnstileWidgetId);
  }
  updateEmailSubmitState();
}

function updateEmailSubmitState() {
  emailSubmitBtn.disabled = !emailAcceptTerms.checked || !captchaToken;
}

// --- Terms modal ---
async function loadTermsContent() {
  if (termsLoaded) return;
  const res = await fetch("/terms-fragment.html");
  if (!res.ok) throw new Error("Could not load terms");
  termsBody.innerHTML = await res.text();
  termsLoaded = true;
}

async function openTermsModal() {
  termsFocus = document.activeElement;
  try {
    await loadTermsContent();
  } catch {
    termsBody.innerHTML = '<p class="form-message" data-tone="error">Could not load terms. Try again later.</p>';
  }
  termsModal.hidden = false;
  document.body.style.overflow = "hidden";
  closeTermsBtn.focus();
}

function closeTermsModal() {
  termsModal.hidden = true;
  document.body.style.overflow = "";
  if (termsFocus?.focus) termsFocus.focus();
}

document.querySelectorAll(".open-terms-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => { e.preventDefault(); openTermsModal(); });
});
closeTermsBtn.addEventListener("click", closeTermsModal);
termsBackdrop.addEventListener("click", closeTermsModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !termsModal.hidden) closeTermsModal(); });

acceptTerms.addEventListener("change", updateSubmitState);
emailAcceptTerms.addEventListener("change", updateEmailSubmitState);

// --- Messages ---
function showMessage(text, tone, target = "form") {
  const el = target === "auth" ? authMessageEl : messageEl;
  el.hidden = false;
  el.textContent = text;
  el.dataset.tone = tone;
}

function showEmailMessage(text, tone) {
  emailMessageEl.hidden = false;
  emailMessageEl.textContent = text;
  emailMessageEl.dataset.tone = tone;
}

function clearMessage() {
  for (const el of [messageEl, authMessageEl, emailMessageEl]) {
    el.hidden = true;
    el.textContent = "";
    delete el.dataset.tone;
  }
}

function goToSuccessPage(via = "google") {
  sessionStorage.setItem(WAITLIST_SUBMITTED_KEY, "1");
  navigateWithTransition(`/waitlist-success.html${via === "email" ? "?via=email" : ""}`);
}

// --- UI state ---
function setUiState(state) {
  if (authLoading) authLoading.hidden = state !== "loading";
  methodStep.hidden = state !== "choose-method";
  emailForm.hidden = state !== "email-form";
  form.hidden = state !== "signed-in";
  if (waitlistBackHome) {
    waitlistBackHome.hidden = state === "email-form";
  }
  if (state === "choose-method") {
    resetTurnstile();
  }
}

function showChooseMethod() {
  setUiState("choose-method");
}

function showEmailForm() {
  clearMessage();
  setUiState("email-form");
  updateEmailSubmitState();
  requestAnimationFrame(() => ensureTurnstile());
}

function setBirthdayBounds() {
  const input = form.querySelector('[name="birthday"]');
  if (!input) return;
  const today = new Date();
  const max = new Date(Date.UTC(today.getUTCFullYear() - 13, today.getUTCMonth(), today.getUTCDate()));
  const min = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()));
  input.max = max.toISOString().slice(0, 10);
  input.min = min.toISOString().slice(0, 10);
}

function prefillFromGoogle(user) {
  const meta = user.user_metadata ?? {};
  const name = String(meta.full_name ?? meta.name ?? "").trim();
  const fullNameInput = form.querySelector('[name="fullName"]');
  if (fullNameInput && name && !fullNameInput.value) fullNameInput.value = name;
}

async function showSignedIn(user) {
  session = { user };
  signedInEmail.textContent = user.email ?? "your Google account";
  setUiState("signed-in");
  setBirthdayBounds();
  prefillFromGoogle(user);
  updateSubmitState();
}

async function showSignedOut() {
  session = null;
  clearWaitlistAuthFlags();
  showChooseMethod();
}

async function applySession(user, { fromOAuth = false } = {}) {
  if (!user) { await showSignedOut(); return; }
  markWaitlistAuthSuccess();
  if (fromOAuth) cleanOAuthParamsFromUrl();
  await showSignedIn(user);
}

async function clearUninvitedSession() {
  const client = await ensureSupabase().catch(() => null);
  if (!client) {
    clearWaitlistAuthFlags();
    await showSignedOut();
    return;
  }
  const { data: { session: existing } } = await client.auth.getSession();
  if (existing) await client.auth.signOut({ scope: "local" });
  clearWaitlistAuthFlags();
  await showSignedOut();
}

function handleAuthStateChange(event, nextSession) {
  const user = nextSession?.user ?? null;
  if (user && shouldUseSession()) {
    applySession(user, { fromOAuth: isOAuthCallback() });
    return;
  }
  if (event === "SIGNED_OUT" && userRequestedSignOut) {
    userRequestedSignOut = false;
    clearWaitlistAuthFlags();
    showSignedOut();
  }
}

async function initAuth() {
  if (authFlag(WAITLIST_AUTH_PENDING_KEY) && !isOAuthCallback()) {
    clearAuthFlag(WAITLIST_AUTH_PENDING_KEY);
  }

  const waitlistError = getWaitlistErrorMessage();
  if (waitlistError) {
    showChooseMethod();
    showMessage(waitlistError, "error", "auth");
    cleanWaitlistErrorFromUrl();
    return;
  }

  const oauthError = getOAuthErrorMessage();
  if (oauthError) {
    showChooseMethod();
    showMessage(oauthError, "error", "auth");
    cleanOAuthParamsFromUrl();
    clearWaitlistAuthFlags();
    return;
  }

  // Always show sign-in options immediately; never load Supabase until Google is clicked.
  showChooseMethod();

  if (!isOAuthCallback()) {
    return;
  }

  setUiState("loading");

  try {
    await ensureSupabase();

    const params = new URLSearchParams(window.location.search);

    const authCode = params.get("code");
    let { data: { session: current }, error: sessionError } = await getSessionWithTimeout(supabase);

    if (!current?.user && authCode) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
      if (exchangeError) throw exchangeError;
      ({ data: { session: current }, error: sessionError } = await getSessionWithTimeout(supabase));
    }

    if (sessionError) {
      showMessage(sessionError.message ?? "Could not load sign-in state.", "error", "auth");
      await showSignedOut();
      return;
    }

    if (current?.user) {
      await applySession(current.user, { fromOAuth: true });
      return;
    }

    showMessage("Sign-in did not complete. Try again.", "error", "auth");
    cleanOAuthParamsFromUrl();
    clearWaitlistAuthFlags();
    await showSignedOut();
  } catch (err) {
    clearWaitlistAuthFlags();
    showMessage(err.message || "Sign-in is unavailable right now.", "error", "auth");
    showChooseMethod();
  }
}

// --- Method selection ---
emailSignInBtn.addEventListener("click", () => {
  showEmailForm();
});

emailBackBtn.addEventListener("click", () => {
  emailForm.reset();
  clearMessage();
  showChooseMethod();
});

// --- Google Sign In button ---
googleSignInBtn.addEventListener("click", async () => {
  clearMessage();
  googleSignInBtn.disabled = true;
  setAuthFlag(WAITLIST_AUTH_PENDING_KEY);
  try {
    const client = await ensureSupabase();
    const { data: { session: existing } } = await getSessionWithTimeout(client);
    if (existing?.user) {
      clearAuthFlag(WAITLIST_AUTH_PENDING_KEY);
      await applySession(existing.user);
      googleSignInBtn.disabled = false;
      return;
    }
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: waitlistRedirectTo(), queryParams: { prompt: "select_account" } },
    });
    if (error) throw error;
    if (data?.url) window.location.assign(data.url);
  } catch (err) {
    clearAuthFlag(WAITLIST_AUTH_PENDING_KEY);
    showMessage(err?.message ?? "Could not start Google sign-in. Try again.", "error", "auth");
    googleSignInBtn.disabled = false;
  }
});

// --- Sign out ---
signOutBtn.addEventListener("click", async () => {
  const client = await ensureSupabase().catch(() => null);
  if (!client) return;
  userRequestedSignOut = true;
  clearWaitlistAuthFlags();
  await client.auth.signOut({ scope: "local" });
  form.reset();
  clearMessage();
  updateSubmitState();
  await showSignedOut();
});

// --- Google form submit ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const data = new FormData(form);
  const fullName = String(data.get("fullName") ?? "").trim();
  const gender = String(data.get("gender") ?? "").trim();
  const birthday = String(data.get("birthday") ?? "").trim();
  const jobTypes = collectJobTypes(form, "jobTypes", "jobTypeOther");
  const activelyApplying = data.get("activelyApplying");
  const termsAccepted = data.get("acceptTerms") === "on";

  if (!session?.user) { showMessage("Sign in with Google to continue.", "error"); return; }
  if (!fullName || fullName.length < 2) { showMessage("Enter your full name.", "error"); return; }
  if (!gender) { showMessage("Select a gender option.", "error"); return; }
  if (!birthday) { showMessage("Enter your birthday.", "error"); return; }
  if (jobTypes.length === 0) { showMessage("Select at least one job type.", "error"); return; }
  if (!activelyApplying) { showMessage("Select yes or no for actively applying.", "error"); return; }
  if (!termsAccepted) { showMessage("Please accept the Terms of Service.", "error"); return; }

  const { data: { session: freshSession } } = await (await ensureSupabase()).auth.getSession();
  const accessToken = freshSession?.access_token;
  if (!accessToken) {
    showMessage("Sign-in expired. Please sign in with Google again.", "error");
    await showSignedOut();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  try {
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ fullName, gender, birthday, jobTypes, activelyApplying: activelyApplying === "yes", acceptedTerms: true }),
    });
    const body = res.headers.get("content-type")?.includes("application/json")
      ? await res.json().catch(() => ({}))
      : await res.text().then((t) => ({ error: t?.slice?.(0, 300) || undefined })).catch(() => ({}));

    if (!res.ok) {
      showMessage(body.error ?? `Request failed (${res.status}).`, "error");
      updateSubmitState();
      return;
    }
    goToSuccessPage("google");
  } catch {
    showMessage("Network error. Try again in a moment.", "error");
    updateSubmitState();
  } finally {
    submitBtn.textContent = "Join waitlist";
  }
});

// --- Email form submit ---
emailForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const data = new FormData(emailForm);
  const fullName = String(data.get("emailFullName") ?? "").trim();
  const email = String(data.get("email") ?? "").trim();
  const gender = String(data.get("emailGender") ?? "").trim();
  const birthday = String(data.get("emailBirthday") ?? "").trim();
  const jobTypes = collectJobTypes(emailForm, "emailJobTypes", "emailJobTypeOther");
  const activelyApplying = data.get("emailActivelyApplying");
  const termsAccepted = data.get("emailAcceptTerms") === "on";

  if (!fullName || fullName.length < 2) { showEmailMessage("Enter your full name.", "error"); return; }
  if (!email) { showEmailMessage("Enter your email.", "error"); return; }
  if (!gender) { showEmailMessage("Select a gender option.", "error"); return; }
  if (!birthday) { showEmailMessage("Enter your birthday.", "error"); return; }
  if (jobTypes.length === 0) { showEmailMessage("Select at least one job type.", "error"); return; }
  if (!activelyApplying) { showEmailMessage("Select yes or no for actively applying.", "error"); return; }
  if (!termsAccepted) { showEmailMessage("Please accept the Terms of Service.", "error"); return; }
  if (!captchaToken) { showEmailMessage("Please complete the CAPTCHA.", "error"); return; }

  emailSubmitBtn.disabled = true;
  emailSubmitBtn.textContent = "Submitting…";

  try {
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, gender, birthday, jobTypes, activelyApplying: activelyApplying === "yes", acceptedTerms: true, captchaToken }),
    });
    const body = res.headers.get("content-type")?.includes("application/json")
      ? await res.json().catch(() => ({}))
      : await res.text().then((t) => ({ error: t?.slice?.(0, 300) || undefined })).catch(() => ({}));

    if (!res.ok) {
      if (res.status === 409) { goToSuccessPage("email"); return; }
      showEmailMessage(body.error ?? `Request failed (${res.status}).`, "error");
      updateEmailSubmitState();
      return;
    }
    goToSuccessPage("email");
  } catch {
    showEmailMessage("Network error. Try again in a moment.", "error");
    updateEmailSubmitState();
  } finally {
    emailSubmitBtn.textContent = "Join waitlist";
  }
});

// Kick off Supabase init immediately so Safari doesn't stall on dynamic import during user gesture
ensureSupabase().catch(() => {});

initAuth().catch((err) => {
  console.error(err);
  showMessage("Could not load the waitlist. Refresh and try again.", "error", "auth");
  showChooseMethod();
});
