const JOB_CATEGORIES = new Set([
  "SWE",
  "PM",
  "Data Science",
  "ML/AI",
  "Engineering",
  "Marketing",
  "Sales",
  "Finance",
]);

const REASONS = new Set(["save_time", "more_roles", "dont_miss", "busy", "hate_forms"]);
const WORK_TYPES = new Set(["internship", "full_time", "both"]);
const AUTO_APPLY_MODES = new Set(["ask", "strong", "open"]);

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [];
}

export function parseLocations(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function validateWebOnboarding(body) {
  const reasons = asList(body?.reasons).filter((item) => REASONS.has(item));
  const jobCategories = asList(body?.jobCategories).filter((item) => JOB_CATEGORIES.has(item));
  const workType = String(body?.workType ?? "").trim();
  const autoApplyMode = String(body?.autoApplyMode ?? "").trim();
  const remoteOk = body?.remoteOk !== false;
  const locations = parseLocations(body?.locations);
  const sessionId = String(body?.sessionId ?? "").trim();

  if (reasons.length === 0) {
    return { ok: false, error: "Pick at least one reason for auto-apply." };
  }
  if (jobCategories.length === 0) {
    return { ok: false, error: "Pick at least one role type." };
  }
  if (!WORK_TYPES.has(workType)) {
    return { ok: false, error: "Choose internship, full-time, or both." };
  }
  if (!AUTO_APPLY_MODES.has(autoApplyMode)) {
    return { ok: false, error: "Choose how auto-apply should work." };
  }
  if (!remoteOk && locations.length === 0) {
    return { ok: false, error: "Add a location, or keep remote on." };
  }

  return {
    ok: true,
    payload: {
      sessionId: sessionId || undefined,
      reasons,
      jobCategories,
      workType,
      remoteOk,
      locations,
      autoApplyMode,
    },
  };
}
