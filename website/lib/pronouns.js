/**
 * Pronoun helpers shared by the browser and API handlers.
 * Must stay free of Node-only imports so it can load as an ES module.
 */

const PRESETS = new Set(["he/him", "she/her"]);
const PAIR_RE = /^[a-z][a-z'-]{0,19}\/[a-z][a-z'-]{0,19}$/;

export function normalizePronouns(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, "");
}

export function parsePronouns(value) {
  const pronouns = normalizePronouns(value);
  if (PRESETS.has(pronouns)) return pronouns;
  if (PAIR_RE.test(pronouns)) return pronouns;
  return "";
}

export function isPronounPreset(value) {
  return PRESETS.has(normalizePronouns(value));
}
