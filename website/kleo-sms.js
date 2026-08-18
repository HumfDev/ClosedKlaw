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

function getClientPlatform() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const maxTouch = navigator.maxTouchPoints || 0;
  const isIPad = /iPad/.test(ua) || (platform === "MacIntel" && maxTouch > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  const isMac = /Macintosh|Mac OS X/.test(ua) && !isIPad;
  const isAndroid = /Android/.test(ua);
  return { isIPad, isIPhone, isMac, isAndroid };
}

export function canOpenIMessage() {
  const { isIPhone, isIPad, isMac } = getClientPlatform();
  return isIPhone || isIPad || isMac;
}

function formatPhoneDisplay(e164) {
  const digits = String(e164 ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return String(e164 ?? "").trim();
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

      <div id="text-kleo-consent-view">
        <h2 id="text-kleo-modal-title">Before you text Kleo</h2>
        <p class="modal-sub">Kleo is iMessage only. Please agree to continue.</p>
        <div class="text-kleo-consent-fields">
          <label class="field field-checkbox">
            <input type="checkbox" id="text-kleo-accept-terms" />
            <span>I agree to the
              <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            </span>
          </label>
          <label class="field field-checkbox">
            <input type="checkbox" id="text-kleo-accept-privacy" />
            <span>I agree to the
              <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </span>
          </label>
        </div>
        <button type="button" class="btn-submit text-kleo-continue" id="text-kleo-continue" disabled>
          Text Kleo
        </button>
      </div>

      <div id="text-kleo-iphone-view" hidden>
        <h2 id="text-kleo-iphone-title">Use your iPhone</h2>
        <p class="modal-sub" id="text-kleo-iphone-copy">Kleo is iMessage only. Please open this on your iPhone to text Kleo.</p>
        <p class="text-kleo-iphone-number" id="text-kleo-iphone-number" hidden></p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const terms = modal.querySelector("#text-kleo-accept-terms");
  const privacy = modal.querySelector("#text-kleo-accept-privacy");
  const continueBtn = modal.querySelector("#text-kleo-continue");
  const consentView = modal.querySelector("#text-kleo-consent-view");
  const iphoneView = modal.querySelector("#text-kleo-iphone-view");
  const iphoneTitle = modal.querySelector("#text-kleo-iphone-title");
  const iphoneCopy = modal.querySelector("#text-kleo-iphone-copy");
  const iphoneNumber = modal.querySelector("#text-kleo-iphone-number");
  const dialog = modal.querySelector("[role='dialog']");

  function updateContinue() {
    continueBtn.disabled = !(terms.checked && privacy.checked);
  }

  terms.addEventListener("change", updateContinue);
  privacy.addEventListener("change", updateContinue);

  modal.querySelectorAll(".text-kleo-consent-fields a").forEach((link) => {
    link.addEventListener("click", (e) => e.stopPropagation());
  });

  modal.querySelectorAll("[data-close-text-kleo]").forEach((el) => {
    el.addEventListener("click", closeConsentModal);
  });

  continueBtn.addEventListener("click", () => {
    if (continueBtn.disabled) return;
    if (!canOpenIMessage()) {
      showIphoneOnlyView();
      return;
    }
    const href = buildKleoSmsHref(kleoPhone);
    closeConsentModal();
    window.location.href = href;
  });

  modalElements = {
    modal,
    dialog,
    terms,
    privacy,
    continueBtn,
    consentView,
    iphoneView,
    iphoneTitle,
    iphoneCopy,
    iphoneNumber,
  };
}

function showIphoneOnlyView() {
  if (!modalElements) return;
  const { isAndroid } = getClientPlatform();
  modalElements.consentView.hidden = true;
  modalElements.iphoneView.hidden = false;
  modalElements.dialog.setAttribute("aria-labelledby", "text-kleo-iphone-title");

  if (isAndroid) {
    modalElements.iphoneTitle.textContent = "You can’t text Kleo from Android";
    modalElements.iphoneCopy.textContent =
      "Kleo is iMessage only, so it doesn’t work on Android phones or Android messages. Please use an iPhone.";
  } else {
    modalElements.iphoneTitle.textContent = "Use your iPhone";
    modalElements.iphoneCopy.textContent =
      "Kleo is iMessage only. Please open this on your iPhone to text Kleo.";
  }

  const display = formatPhoneDisplay(kleoPhone);
  if (display) {
    modalElements.iphoneNumber.hidden = false;
    modalElements.iphoneNumber.textContent = `Text ${display} from your iPhone.`;
  } else {
    modalElements.iphoneNumber.hidden = true;
  }
}

function showConsentView() {
  if (!modalElements) return;
  modalElements.consentView.hidden = false;
  modalElements.iphoneView.hidden = true;
  modalElements.dialog.setAttribute("aria-labelledby", "text-kleo-modal-title");
  modalElements.terms.checked = false;
  modalElements.privacy.checked = false;
  modalElements.continueBtn.disabled = true;
}

function openConsentModal() {
  if (!modalElements) createConsentModal();

  if (!canOpenIMessage()) {
    showIphoneOnlyView();
  } else {
    showConsentView();
  }

  modalElements.modal.hidden = false;
  document.body.style.overflow = "hidden";
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

  if (document.body?.dataset?.openTextKleo === "1") {
    openConsentModal();
  }
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
