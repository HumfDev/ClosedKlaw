/**
 * Phone helpers shared by the browser and API handlers.
 * Must stay free of Node-only imports so it can load as an ES module.
 */

const E164_RE = /^\+[1-9]\d{7,14}$/;

export function isE164(value) {
  return E164_RE.test(String(value ?? "").trim());
}

export function normalizeToE164(value, defaultCountry = "1") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (isE164(raw)) return raw;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (raw.startsWith("+")) {
    const e164 = `+${digits}`;
    return isE164(e164) ? e164 : "";
  }

  const country = String(defaultCountry ?? "1").replace(/\D/g, "") || "1";
  if (digits.length === 10) {
    const e164 = `+${country}${digits}`;
    return isE164(e164) ? e164 : "";
  }
  if (digits.length === 11 && digits.startsWith(country)) {
    const e164 = `+${digits}`;
    return isE164(e164) ? e164 : "";
  }
  if (digits.length >= 8 && digits.length <= 15) {
    const e164 = `+${digits}`;
    return isE164(e164) ? e164 : "";
  }
  return "";
}
