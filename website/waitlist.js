const form = document.getElementById("waitlist-form");
const messageEl = document.getElementById("form-message");
const submitBtn = document.getElementById("submit-btn");
const acceptTerms = document.getElementById("accept-terms");
const openTermsBtn = document.getElementById("open-terms");
const termsModal = document.getElementById("terms-modal");
const closeTermsBtn = document.getElementById("close-terms");
const termsBackdrop = termsModal.querySelector("[data-close-terms]");
const termsBody = document.getElementById("terms-modal-body");

let termsLoaded = false;
let termsFocus = null;

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

function showMessage(text, tone) {
  messageEl.hidden = false;
  messageEl.textContent = text;
  messageEl.dataset.tone = tone;
}

function clearMessage() {
  messageEl.hidden = true;
  messageEl.textContent = "";
  delete messageEl.dataset.tone;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessage();

  const data = new FormData(form);
  const email = String(data.get("email") ?? "").trim();
  const phone = String(data.get("phone") ?? "").trim();
  const jobType = data.get("jobType");
  const termsAccepted = data.get("acceptTerms") === "on";

  if (!email || !phone || !jobType) {
    showMessage("Please fill in all fields and pick a job type.", "error");
    return;
  }
  if (!termsAccepted) {
    showMessage("Please accept the Terms of Service.", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  try {
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        phone,
        jobType,
        acceptedTerms: true,
      }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      showMessage(body.error ?? "Could not join waitlist.", "error");
      if (body?.details) console.error("Waitlist error details:", body.details);
      updateSubmitState();
      return;
    }

    form.reset();
    updateSubmitState();
    showMessage("You're on the list. We'll be in touch.", "success");
  } catch {
    showMessage("Network error. Try again in a moment.", "error");
    updateSubmitState();
  } finally {
    submitBtn.textContent = "Submit";
  }
});

updateSubmitState();
