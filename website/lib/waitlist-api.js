import { createClient } from "@supabase/supabase-js";

export const JOB_TYPES = new Set(["swe", "consulting", "ib", "quant", "other"]);
export const GENDER_VALUES = new Set(["woman", "man", "non_binary", "prefer_not_to_say"]);

function extractBearerToken(authHeader) {
  const raw = String(authHeader ?? "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice(7).trim();
  return token || null;
}

export function normalizeFullName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function parseBirthday(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

export function validateProfileFields(body) {
  const fullName = normalizeFullName(body?.fullName);
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, error: "Enter your full name (at least 2 characters)." };
  }

  const gender = String(body?.gender ?? "").trim();
  if (!GENDER_VALUES.has(gender)) {
    return { ok: false, error: "Select a gender option." };
  }

  const birthday = parseBirthday(body?.birthday);
  if (!birthday) {
    return { ok: false, error: "Enter a valid birthday." };
  }

  const born = new Date(`${birthday}T12:00:00.000Z`);
  const today = new Date();
  const minAge = new Date(
    Date.UTC(today.getUTCFullYear() - 13, today.getUTCMonth(), today.getUTCDate()),
  );
  const maxAge = new Date(
    Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()),
  );

  if (born > minAge) {
    return { ok: false, error: "You must be at least 13 years old to join." };
  }
  if (born < maxAge) {
    return { ok: false, error: "Enter a valid birthday." };
  }

  return { ok: true, fullName, gender, birthday };
}

export async function handleWaitlistSignup({
  supabaseUrl,
  supabaseServiceKey,
  authHeader,
  body,
  sqliteInsert,
}) {
  const jobType = String(body?.jobType ?? "")
    .trim()
    .toLowerCase();
  if (!JOB_TYPES.has(jobType)) {
    return { status: 400, body: { ok: false, error: "Select a job type." } };
  }
  if (body?.acceptedTerms !== true) {
    return {
      status: 400,
      body: { ok: false, error: "You must accept the Terms of Service." },
    };
  }

  const profile = validateProfileFields(body);
  if (!profile.ok) {
    return { status: 400, body: { ok: false, error: profile.error } };
  }

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
          birthday: profile.birthday,
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
    birthday: profile.birthday,
    accepted_terms: true,
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
        birthday: profile.birthday,
        accepted_terms: true,
      })
      .eq("email", email);

    if (updateError) throw updateError;
    return { status: 200, body: { ok: true, updated: true } };
  }

  if (error) throw error;

  return { status: 201, body: { ok: true } };
}
