import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { recordOnboardingFunnel } from "../lib/onboarding-funnel.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(ROOT, "..", ".env") });

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const visitorId = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
await supabase.from("onboarding_funnel").delete().eq("visitor_id", visitorId);

const events = [
  { event: "homepage", path: "/", referrer: "https://test.kleoklaw.local/" },
  { event: "onboarding_why", path: "/start", answers: { reasons: ["save_time", "busy"] } },
  { event: "onboarding_bottleneck", path: "/start", answers: { bottleneck: "forms" } },
  { event: "onboarding_channels", path: "/start", answers: { searchChannels: ["linkedin", "handshake"] } },
  { event: "onboarding_outcome", path: "/start", answers: { outcome: "interviews" } },
  { event: "onboarding_optimize", path: "/start", answers: { optimize: "fit" } },
  { event: "found", path: "/start" },
  { event: "checkout", path: "/start", startCode: "wk_test1" },
  { event: "paid", path: "/start", stripeSessionId: "cs_test_funnel", usedPromo: false },
  { event: "unlock", path: "/start" },
];

for (const body of events) {
  const result = await recordOnboardingFunnel({
    supabaseUrl,
    supabaseServiceKey,
    body: { visitorId, ...body },
  });
  if (!result.ok) {
    console.error("Event failed:", body.event, result);
    process.exit(1);
  }
}

const { data, error } = await supabase
  .from("onboarding_funnel")
  .select(
    "visitor_id, homepage_at, onboarding_step_why_at, onboarding_step_bottleneck_at, onboarding_step_channels_at, onboarding_step_outcome_at, onboarding_step_optimize_at, found_at, checkout_at, paid_at, unlock_at, reasons, bottleneck, search_channels, outcome, optimize, start_code, stripe_session_id, last_event",
  )
  .eq("visitor_id", visitorId)
  .single();

if (error || !data) {
  console.error("Could not read test row:", error?.message);
  process.exit(1);
}

const requiredTimes = [
  "homepage_at",
  "onboarding_step_why_at",
  "onboarding_step_bottleneck_at",
  "onboarding_step_channels_at",
  "onboarding_step_outcome_at",
  "onboarding_step_optimize_at",
  "found_at",
  "checkout_at",
  "paid_at",
  "unlock_at",
];
const missingTimes = requiredTimes.filter((col) => !data[col]);
if (missingTimes.length) {
  console.error("Missing timestamps:", missingTimes.join(", "));
  process.exit(1);
}

const reasonsOk = Array.isArray(data.reasons) && data.reasons.includes("save_time") && data.reasons.includes("busy");
const channelsOk = Array.isArray(data.search_channels)
  && data.search_channels.includes("linkedin")
  && data.search_channels.includes("handshake");
if (!reasonsOk || data.bottleneck !== "forms" || !channelsOk || data.outcome !== "interviews" || data.optimize !== "fit") {
  console.error("Selected options did not persist:", {
    reasons: data.reasons,
    bottleneck: data.bottleneck,
    search_channels: data.search_channels,
    outcome: data.outcome,
    optimize: data.optimize,
  });
  process.exit(1);
}

const { data: counts, error: countError } = await supabase
  .from("onboarding_funnel")
  .select("homepage_at, paid_at");

if (countError) {
  console.error("Count query failed:", countError.message);
  process.exit(1);
}

const homepage = counts.filter((row) => row.homepage_at).length;
const paid = counts.filter((row) => row.paid_at).length;

await supabase.from("onboarding_funnel").delete().eq("visitor_id", visitorId);

console.log("onboarding_funnel collection test passed");
console.log(JSON.stringify({
  last_event: data.last_event,
  options: {
    reasons: data.reasons,
    bottleneck: data.bottleneck,
    search_channels: data.search_channels,
    outcome: data.outcome,
    optimize: data.optimize,
  },
  funnel_counts_after_test_row: { homepage, paid },
}, null, 2));
