/**
 * Waitlist validation shared by the browser and the API handlers.
 * Must stay free of Node-only and bare-specifier imports so it can be
 * loaded directly as an ES module in the browser.
 */

export const JOB_TYPES = new Set(["swe", "pm", "data_science", "consulting", "accounting_finance", "marketing", "sales", "engineering", "other"]);
export const GENDER_VALUES = new Set(["woman", "man", "non_binary", "prefer_not_to_say"]);

export const TERMS_VERSION = "2026-08-05";
export const PRIVACY_VERSION = "2026-08-05";

export function normalizeFullName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function isAgeAttested(value) {
  return value === true;
}

export function normalizeGender(value) {
  const gender = String(value ?? "").trim();
  if (!gender) return null;
  if (!GENDER_VALUES.has(gender)) return undefined;
  return gender;
}

export function validateConsentFields(body) {
  if (body?.acceptedTerms !== true) {
    return { ok: false, error: "You must accept the Terms of Service." };
  }
  if (body?.acceptedPrivacy !== true) {
    return { ok: false, error: "You must acknowledge the Privacy Policy." };
  }
  if (!isAgeAttested(body?.ageAttested)) {
    return { ok: false, error: "You must be 18 or older to join KleoKlaw." };
  }
  return { ok: true };
}

export function validateProfileFields(body) {
  const fullName = normalizeFullName(body?.fullName);
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, error: "Enter your full name (at least 2 characters)." };
  }

  const gender = normalizeGender(body?.gender);
  if (gender === undefined) {
    return { ok: false, error: "Select a valid gender option." };
  }

  const consent = validateConsentFields(body);
  if (!consent.ok) return consent;

  return { ok: true, fullName, gender };
}

export function buildConsentMetadata(body) {
  return {
    accepted_terms: true,
    accepted_privacy: true,
    terms_version: String(body?.termsVersion ?? TERMS_VERSION).trim() || TERMS_VERSION,
    privacy_version: String(body?.privacyVersion ?? PRIVACY_VERSION).trim() || PRIVACY_VERSION,
    accepted_at: String(body?.acceptedAt ?? new Date().toISOString()),
    age_attested: true,
  };
}
