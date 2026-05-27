import { navigateWithTransition } from "./transitions.js";
import { getSupabase } from "./supabase-client.js";

const WAITLIST_SUBMITTED_KEY = "ck_waitlist_submitted";
/** Set when user clicks Continue with Google; cleared after successful session. */
const WAITLIST_AUTH_PENDING_KEY = "ck_waitlist_google_pending";
/** Set after OAuth completes on the waitlist page. */
const WAITLIST_AUTH_OK_KEY = "ck_waitlist_google_auth";

function waitlistRedirectTo() {
  return `${window.location.origin}/waitlist.html`;
}

function authFlag(key) {
  return localStorage.getItem(key) === "1";
}

function setAuthFlag(key) {
  localStorage.setItem(key, "1");
}

function clearAuthFlag(key) {
  localStorage.removeItem(key);
}

function clearWaitlistAuthFlags() {
  clearAuthFlag(WAITLIST_AUTH_OK_KEY);
  clearAuthFlag(WAITLIST_AUTH_PENDING_KEY);
}

function markWaitlistAuthSuccess() {
  setAuthFlag(WAITLIST_AUTH_OK_KEY);
  clearAuthFlag(WAITLIST_AUTH_PENDING_KEY);
}

/** PKCE / OAuth return — Supabase redirects here with ?code= or ?error= */
function isOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("code") || params.has("error") || params.has("error_description")) {
    return true;
  }
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const hashParams = new URLSearchParams(hash);
  return hashParams.has("access_token") || hashParams.has("code");
}

function cleanOAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  url.hash = "";
  history.replaceState({}, "", `${url.pathname}${url.search}`);
}

/** User clicked Google or is finishing OAuth on this page. */
function shouldUseSession() {
  return (
    authFlag(WAITLIST_AUTH_OK_KEY) ||
    authFlag(WAITLIST_AUTH_PENDING_KEY) ||
    isOAuthCallback()
  );
}

const authStep = document.getElementById("auth-step");
const authLoading = document.getElementById("auth-loading");
const googleSignInBtn = document.getElementById("google-sign-in");
const form = document.getElementById("waitlist-form");
const signedInEmail = document.getElementById("signed-in-email");
const signOutBtn = document.getElementById("sign-out-btn");
const messageEl = document.getElementById("form-message");
const authMessageEl = document.getElementById("auth-message");
const submitBtn = document.getElementById("submit-btn");
const acceptTerms = document.getElementById("accept-terms");
const openTermsBtn = document.getElementById("open-terms");
const termsModal = document.getElementById("terms-modal");
const closeTermsBtn = document.getElementById("close-terms");
const termsBackdrop = termsModal.querySelector("[data-close-terms]");
const termsBody = document.getElementById("terms-modal-body");

let termsLoaded = false;
let termsFocus = null;
let supabase = null;
let session = null;
let userRequestedSignOut = false;

function updateSubmitState() {
  submitBtn.disabled = !acceptTerms.checked;
}

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
    termsBody.innerHTML =
      '<p class="form-message" data-tone="error">Could not load terms. Try again later.</p>';
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

openTermsBtn.addEventListener("click", (e) => {
  e.preventDefault();
  openTermsModal();
});

closeTermsBtn.addEventListener("click", closeTermsModal);
termsBackdrop.addEventListener("click", closeTermsModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !termsModal.hidden) closeTermsModal();
});

acceptTerms.addEventListener("change", updateSubmitState);

function showMessage(text, tone, target = "form") {
  const el = target === "auth" ? authMessageEl : messageEl;
  el.hidden = false;
  el.textContent = text;
  el.dataset.tone = tone;
}

function clearMessage() {
  for (const el of [messageEl, authMessageEl]) {
    el.hidden = true;
    el.textContent = "";
    delete el.dataset.tone;
  }
}

function goToSuccessPage() {
  sessionStorage.setItem(WAITLIST_SUBMITTED_KEY, "1");
  navigateWithTransition("/waitlist-success.html");
}

function setUiState(state) {
  authLoading.hidden = state !== "loading";
  authStep.hidden = state !== "signed-out";
  form.hidden = state !== "signed-in";
}

function setBirthdayBounds() {
  const input = form.querySelector('[name="birthday"]');
  if (!input) return;
  const today = new Date();
  const max = new Date(
    Date.UTC(today.getUTCFullYear() - 13, today.getUTCMonth(), today.getUTCDate()),
  );
  const min = new Date(
    Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()),
  );
  input.max = max.toISOString().slice(0, 10);
  input.min = min.toISOString().slice(0, 10);
}

function prefillFromGoogle(user) {
  const meta = user.user_metadata ?? {};
  const name = String(meta.full_name ?? meta.name ?? "").trim();
  const fullNameInput = form.querySelector('[name="fullName"]');
  if (fullNameInput && name && !fullNameInput.value) {
    fullNameInput.value = name;
  }
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
  setUiState("signed-out");
}

async function applySession(user, { fromOAuth = false } = {}) {
  if (!user) {
    await showSignedOut();
    return;
  }
  markWaitlistAuthSuccess();
  if (fromOAuth) cleanOAuthParamsFromUrl();
  await showSignedIn(user);
}

async function clearUninvitedSession() {
  if (!supabase) return;
  const {
    data: { session: existing },
  } = await supabase.auth.getSession();
  if (existing) {
    await supabase.auth.signOut({ scope: "local" });
  }
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
  setUiState("loading");

  try {
    supabase = await getSupabase();
  } catch (err) {
    authLoading.hidden = true;
    setUiState("signed-out");
    showMessage(err.message || "Sign-in is unavailable right now.", "error", "auth");
    return;
  }

  const oauthReturn = isOAuthCallback();
  const params = new URLSearchParams(window.location.search);

  if (oauthReturn && params.get("error")) {
    clearWaitlistAuthFlags();
    showMessage(
      params.get("error_description") ?? "Google sign-in was cancelled.",
      "error",
      "auth",
    );
    cleanOAuthParamsFromUrl();
    await showSignedOut();
    supabase.auth.onAuthStateChange(handleAuthStateChange);
    return;
  }

  supabase.auth.onAuthStateChange(handleAuthStateChange);

  // PKCE: detectSessionInUrl exchanges ?code= on getSession (see Supabase OAuth docs).
  const {
    data: { session: current },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    showMessage(sessionError.message ?? "Could not load sign-in state.", "error", "auth");
    await showSignedOut();
    return;
  }

  if (current?.user && shouldUseSession()) {
    await applySession(current.user, { fromOAuth: oauthReturn });
    return;
  }

  if (oauthReturn && !current?.user) {
    showMessage("Sign-in did not complete. Try again.", "error", "auth");
    cleanOAuthParamsFromUrl();
    clearWaitlistAuthFlags();
    await showSignedOut();
    return;
  }

  if (!shouldUseSession()) {
    await clearUninvitedSession();
    return;
  }

  await showSignedOut();
}

googleSignInBtn.addEventListener("click", async () => {
  clearMessage();
  if (!supabase) return;

  googleSignInBtn.disabled = true;
  setAuthFlag(WAITLIST_AUTH_PENDING_KEY);

  try {
    const redirectTo = waitlistRedirectTo();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          prompt: "select_account",
        },
      },
    });

    if (error) throw error;

    // Browser flow: follow the authorize URL (Supabase → Google → back to redirectTo).
    if (data?.url) {
      window.location.assign(data.url);
    }
  } catch (err) {
    clearAuthFlag(WAITLIST_AUTH_PENDING_KEY);
    showMessage(err?.message ?? "Could not start Google sign-in. Try again.", "error", "auth");
    googleSignInBtn.disabled = false;
  }
});

signOutBtn.addEventListener("click", async () => {
  if (!supabase) return;
  userRequestedSignOut = true;
  clearWaitlistAuthFlags();
  await supabase.auth.signOut({ scope: "local" });
  form.reset();
  clearMessage();
  updateSubmitState();
  await showSignedOut();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const data = new FormData(form);
  const fullName = String(data.get("fullName") ?? "").trim();
  const gender = String(data.get("gender") ?? "").trim();
  const birthday = String(data.get("birthday") ?? "").trim();
  const jobType = data.get("jobType");
  const termsAccepted = data.get("acceptTerms") === "on";

  if (!session?.user) {
    showMessage("Sign in with Google to continue.", "error");
    return;
  }
  if (!fullName || fullName.length < 2) {
    showMessage("Enter your full name.", "error");
    return;
  }
  if (!gender) {
    showMessage("Select a gender option.", "error");
    return;
  }
  if (!birthday) {
    showMessage("Enter your birthday.", "error");
    return;
  }
  if (!jobType) {
    showMessage("Pick a job type.", "error");
    return;
  }
  if (!termsAccepted) {
    showMessage("Please accept the Terms of Service.", "error");
    return;
  }

  const {
    data: { session: freshSession },
  } = await supabase.auth.getSession();
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        fullName,
        gender,
        birthday,
        jobType,
        acceptedTerms: true,
      }),
    });
    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await res.json().catch(() => ({}))
      : await res
          .text()
          .then((t) => ({ error: t?.slice?.(0, 300) || undefined }))
          .catch(() => ({}));

    if (!res.ok) {
      const fallback =
        res.status === 404
          ? "Waitlist endpoint not found (404). Is the server running in this environment?"
          : `Request failed (${res.status}).`;
      showMessage(body.error ?? fallback, "error");
      updateSubmitState();
      return;
    }

    goToSuccessPage();
  } catch {
    showMessage("Network error. Try again in a moment.", "error");
    updateSubmitState();
  } finally {
    submitBtn.textContent = "Join waitlist";
  }
});

initAuth();
