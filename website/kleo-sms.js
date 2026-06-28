import { KLEO_PHONE_FALLBACK } from "./kleo-config.js";

/** Default SMS body — triggers onboarding or session reset in KleoKlaw. */
export const KLEO_SMS_BODY = "hey Kleo!";

/** iMessage / iOS sms: URL (always &body=). */
export function buildKleoSmsHref(phone, body = KLEO_SMS_BODY) {
  const normalized = String(phone ?? "").trim();
  if (!normalized) return "#";

  const encodedBody = encodeURIComponent(body);
  return `sms:${normalized}&body=${encodedBody}`;
}

let kleoPhone = "";
let modalElements = null;

function createConsentModal() {
  if (document.getElementById("text-kleo-modal")) return;

  const modal = document.createElement("div");
  modal.id = "text-kleo-modal";
  modal.className = "modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal-backdrop" data-close-text-kleo tabindex="-1"></div>
    <div
      class="modal-panel text-kleo-consent-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="text-kleo-modal-title"
    >
      <button type="button" class="modal-close" data-close-text-kleo aria-label="Close">×</button>
      <h2 id="text-kleo-modal-title">Before you text Kleo</h2>
      <p class="modal-sub">Kleo runs over iMessage. Please agree to continue.</p>
      <div class="text-kleo-consent-fields">
        <label class="field field-checkbox">
          <input type="checkbox" id="text-kleo-accept-terms" />
          <span>I agree to the
            <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>
          </span>
        </label>
        <label class="field field-checkbox">
          <input type="checkbox" id="text-kleo-accept-privacy" />
          <span>I agree to the
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          </span>
        </label>
      </div>
      <button type="button" class="btn-submit text-kleo-continue" id="text-kleo-continue" disabled>
        Text Kleo
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  const terms = modal.querySelector("#text-kleo-accept-terms");
  const privacy = modal.querySelector("#text-kleo-accept-privacy");
  const continueBtn = modal.querySelector("#text-kleo-continue");

  function updateContinue() {
    continueBtn.disabled = !(terms.checked && privacy.checked);
  }

  terms.addEventListener("change", updateContinue);
  privacy.addEventListener("change", updateContinue);

  modal.querySelectorAll("[data-close-text-kleo]").forEach((el) => {
    el.addEventListener("click", closeConsentModal);
  });

  continueBtn.addEventListener("click", () => {
    if (continueBtn.disabled) return;
    const href = buildKleoSmsHref(kleoPhone);
    closeConsentModal();
    window.location.href = href;
  });

  modalElements = { modal, terms, privacy, continueBtn };
}

function openConsentModal() {
  if (!modalElements) createConsentModal();

  modalElements.terms.checked = false;
  modalElements.privacy.checked = false;
  modalElements.continueBtn.disabled = true;
  modalElements.modal.hidden = false;
  document.body.style.overflow = "hidden";
  modalElements.terms.focus();
}

function closeConsentModal() {
  if (!modalElements) return;
  modalElements.modal.hidden = true;
  document.body.style.overflow = "";
}

function bindTextKleoLinks() {
  document.querySelectorAll("[data-text-kleo]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openConsentModal();
    });
  });
}

async function initTextKleoLinks() {
  let phone = document.querySelector('meta[name="kleo-phone"]')?.content?.trim();

  if (!phone) {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        phone = data.kleoPhone?.trim();
      }
    } catch {
      /* static fallback below */
    }
  }

  kleoPhone = phone || KLEO_PHONE_FALLBACK;
  createConsentModal();
  bindTextKleoLinks();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalElements && !modalElements.modal.hidden) {
    closeConsentModal();
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTextKleoLinks);
} else {
  initTextKleoLinks();
}
