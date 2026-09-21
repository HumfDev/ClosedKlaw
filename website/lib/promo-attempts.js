import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const MAX_FAILED_ATTEMPTS = 2;

function attemptKey({ startCode, clientIp }) {
  const identity = String(startCode || clientIp || "unknown").trim();
  return createHash("sha256").update(identity).digest("hex");
}

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    const err = new Error("Promo attempt limiting is not configured.");
    err.status = 503;
    throw err;
  }
  return createClient(url, key);
}

export async function recordFailedPromoAttempt({ startCode, clientIp }) {
  const supabase = supabaseAdmin();
  const key = attemptKey({ startCode, clientIp });
  const { data: existing, error: readError } = await supabase
    .from("promo_code_attempts")
    .select("failed_attempts")
    .eq("attempt_key", key)
    .maybeSingle();
  if (readError) throw readError;

  const previous = Number(existing?.failed_attempts || 0);
  if (previous >= MAX_FAILED_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }

  const failedAttempts = previous + 1;
  const { error: writeError } = await supabase
    .from("promo_code_attempts")
    .upsert({
      attempt_key: key,
      failed_attempts: failedAttempts,
      updated_at: new Date().toISOString(),
    }, { onConflict: "attempt_key" });
  if (writeError) throw writeError;

  return { allowed: true, remaining: MAX_FAILED_ATTEMPTS - failedAttempts };
}
