import { createClient } from "@supabase/supabase-js";
import { buildConsentMetadata, validateProfileFields } from "./waitlist-shared.js";

export {
  JOB_TYPES,
  GENDER_VALUES,
  TERMS_VERSION,
  PRIVACY_VERSION,
  normalizeFullName,
  isAgeAttested,
  normalizeGender,
  validateConsentFields,
  validateProfileFields,
  buildConsentMetadata,
} from "./waitlist-shared.js";

function extractBearerToken(authHeader) {
  const raw = String(authHeader ?? "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice(7).trim();
  return token || null;
}

export async function handleWaitlistSignup({
  supabaseUrl,
  supabaseServiceKey,
  authHeader,
  body,
  sqliteInsert,
}) {
  const rawTypes = Array.isArray(body?.jobTypes) ? body.jobTypes : [];
  const jobTypes = rawTypes.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  if (jobTypes.length === 0) {
    return { status: 400, body: { ok: false, error: "Select at least one job type." } };
  }
  const jobType = JSON.stringify(jobTypes);
  if (typeof body?.activelyApplying !== "boolean") {
    return { status: 400, body: { ok: false, error: "Indicate whether you are actively applying." } };
  }

  const profile = validateProfileFields(body);
  if (!profile.ok) {
    return { status: 400, body: { ok: false, error: profile.error } };
  }

  const consent = buildConsentMetadata(body);

  const token = extractBearerToken(authHeader);
  if (!token) {
    return { status: 401, body: { ok: false, error: "Sign in with Google to continue." } };
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    if (sqliteInsert) {
      const email = String(body?.email ?? "")
        .trim()
        .toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { status: 400, body: { ok: false, error: "Valid email required." } };
      }
      try {
        sqliteInsert({
          email,
          jobType,
          fullName: profile.fullName,
          gender: profile.gender,
          consent,
        });
        return { status: 201, body: { ok: true } };
      } catch (err) {
        if (err?.code === "SQLITE_CONSTRAINT_UNIQUE") {
          return {
            status: 409,
            body: { ok: false, error: "This email is already on the waitlist." },
          };
        }
        throw err;
      }
    }
    return {
      status: 500,
      body: {
        ok: false,
        error: "Server waitlist storage is not configured. Please try again later.",
      },
    };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      status: 401,
      body: { ok: false, error: "Sign-in expired. Please sign in with Google again." },
    };
  }

  const email = String(user.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    return {
      status: 400,
      body: { ok: false, error: "Your Google account must include an email address." },
    };
  }

  const row = {
    email,
    user_id: user.id,
    job_type: jobType,
    full_name: profile.fullName,
    gender: profile.gender,
    actively_applying: body.activelyApplying,
    ...consent,
  };

  const { error } = await supabase.from("waitlist").insert(row);

  if (error?.code === "23505") {
    const { error: updateError } = await supabase
      .from("waitlist")
      .update({
        user_id: user.id,
        job_type: jobType,
        full_name: profile.fullName,
        gender: profile.gender,
        actively_applying: body.activelyApplying,
        ...consent,
      })
      .eq("email", email);

    if (updateError) throw updateError;
    return { status: 200, body: { ok: true, updated: true } };
  }

  if (error) throw error;

  return { status: 201, body: { ok: true } };
}
