const REASONS = new Set(["save_time", "more_roles", "dont_miss", "busy", "hate_forms"]);
const BOTTLENECKS = new Set(["finding", "forms", "tracking", "replies"]);
const CHANNELS = new Set(["linkedin", "company_sites", "handshake", "referrals", "not_yet"]);
const OUTCOMES = new Set(["interviews", "land_role", "time_back", "deadlines"]);
const OPTIMIZE = new Set(["fit", "volume", "quiet"]);

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [];
}

export function validateWebOnboarding(body) {
  const reasons = asList(body?.reasons).filter((item) => REASONS.has(item));
  const bottleneck = String(body?.bottleneck ?? "").trim();
  const searchChannels = asList(body?.searchChannels).filter((item) => CHANNELS.has(item));
  const outcome = String(body?.outcome ?? "").trim();
  const optimize = String(body?.optimize ?? "").trim();
  const sessionId = String(body?.sessionId ?? "").trim();

  if (reasons.length === 0) {
    return { ok: false, error: "Pick at least one reason for auto-apply." };
  }
  if (!BOTTLENECKS.has(bottleneck)) {
    return { ok: false, error: "Choose what’s slowest about applying right now." };
  }
  if (searchChannels.length === 0) {
    return { ok: false, error: "Pick where you look for jobs today." };
  }
  if (!OUTCOMES.has(outcome)) {
    return { ok: false, error: "Choose what a good outcome looks like." };
  }
  if (!OPTIMIZE.has(optimize)) {
    return { ok: false, error: "Choose what Kleo should optimize for." };
  }

  return {
    ok: true,
    payload: {
      sessionId: sessionId || undefined,
      reasons,
      bottleneck,
      searchChannels,
      outcome,
      optimize,
    },
  };
}
