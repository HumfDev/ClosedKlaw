import { createClient } from "@supabase/supabase-js";
import { REASONS, BOTTLENECKS, CHANNELS, OUTCOMES, OPTIMIZE } from "./web-onboarding.js";

export const FUNNEL_EVENTS = {
  homepage: "homepage_at",
  onboarding_why: "onboarding_step_why_at",
  onboarding_bottleneck: "onboarding_step_bottleneck_at",
  onboarding_channels: "onboarding_step_channels_at",
  onboarding_outcome: "onboarding_step_outcome_at",
  onboarding_optimize: "onboarding_step_optimize_at",
  found: "found_at",
  checkout: "checkout_at",
  paid: "paid_at",
  unlock: "unlock_at",
};

const VISITOR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [];
}

function clip(value, max) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

export function parseFunnelPayload(body) {
  const visitorId = String(body?.visitorId ?? body?.visitor_id ?? "").trim();
  if (!VISITOR_ID_RE.test(visitorId)) {
    return { ok: false, error: "Valid visitorId is required." };
  }

  const event = String(body?.event ?? "").trim();
  if (!Object.hasOwn(FUNNEL_EVENTS, event)) {
    return { ok: false, error: "Unknown funnel event." };
  }

  const answers = body?.answers && typeof body.answers === "object" ? body.answers : body;
  const reasons = asList(answers?.reasons).filter((item) => REASONS.has(item));
  const bottleneck = String(answers?.bottleneck ?? "").trim();
  const searchChannels = asList(answers?.searchChannels ?? answers?.search_channels)
    .filter((item) => CHANNELS.has(item));
  const outcome = String(answers?.outcome ?? "").trim();
  const optimize = String(answers?.optimize ?? "").trim();

  return {
    ok: true,
    payload: {
      visitorId,
      event,
      reasons,
      bottleneck: BOTTLENECKS.has(bottleneck) ? bottleneck : undefined,
      searchChannels,
      outcome: OUTCOMES.has(outcome) ? outcome : undefined,
      optimize: OPTIMIZE.has(optimize) ? optimize : undefined,
      startCode: clip(body?.startCode ?? body?.start_code, 32),
      stripeSessionId: clip(body?.stripeSessionId ?? body?.stripe_session_id, 200),
      usedPromo: body?.usedPromo === true || body?.used_promo === true || body?.promo === true,
      referrer: clip(body?.referrer, 500),
      path: clip(body?.path ?? body?.landing_path, 200),
    },
  };
}

export function mergeFunnelRow(existing, payload, nowIso) {
  const now = nowIso || new Date().toISOString();
  const column = FUNNEL_EVENTS[payload.event];
  const row = existing
    ? { ...existing }
    : {
        visitor_id: payload.visitorId,
        reasons: [],
        search_channels: [],
        used_promo: false,
        created_at: now,
      };

  if (column && !row[column]) row[column] = now;

  if (payload.reasons?.length) row.reasons = payload.reasons;
  if (payload.bottleneck) row.bottleneck = payload.bottleneck;
  if (payload.searchChannels?.length) row.search_channels = payload.searchChannels;
  if (payload.outcome) row.outcome = payload.outcome;
  if (payload.optimize) row.optimize = payload.optimize;
  if (payload.startCode) row.start_code = payload.startCode;
  if (payload.stripeSessionId) row.stripe_session_id = payload.stripeSessionId;
  if (payload.usedPromo) row.used_promo = true;
  if (payload.referrer && !row.referrer) row.referrer = payload.referrer;
  if (payload.path && !row.landing_path) row.landing_path = payload.path;

  row.visitor_id = payload.visitorId;
  row.last_event = payload.event;
  row.last_page = payload.path || row.last_page || null;
  row.updated_at = now;
  delete row.id;
  return row;
}

export async function recordOnboardingFunnel({ supabaseUrl, supabaseServiceKey, body }) {
  if (!supabaseUrl || !supabaseServiceKey) {
    const err = new Error("Supabase is not configured.");
    err.status = 503;
    throw err;
  }

  const parsed = parseFunnelPayload(body);
  if (!parsed.ok) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: existing, error: readError } = await supabase
    .from("onboarding_funnel")
    .select("*")
    .eq("visitor_id", parsed.payload.visitorId)
    .maybeSingle();

  if (readError) throw readError;

  const row = mergeFunnelRow(existing, parsed.payload);
  const { data, error } = await supabase
    .from("onboarding_funnel")
    .upsert(row, { onConflict: "visitor_id" })
    .select("visitor_id, last_event, homepage_at, paid_at")
    .single();

  if (error) throw error;
  return { ok: true, visitorId: data.visitor_id, event: data.last_event };
}
