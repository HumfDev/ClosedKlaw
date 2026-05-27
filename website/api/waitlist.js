import { createClient } from "@supabase/supabase-js";

const JOB_TYPES = new Set(["swe", "consulting", "ib", "quant", "other"]);

function normalizeEmail(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function normalizePhone(v) {
  return String(v ?? "").trim();
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceKey) {
    json(res, 500, {
      ok: false,
      error: "Server waitlist storage is not configured. Please try again later.",
    });
    return;
  }

  let body = req.body ?? {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const jobType = String(body.jobType ?? "").trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    json(res, 400, { ok: false, error: "Valid email required." });
    return;
  }
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    json(res, 400, { ok: false, error: "Valid phone number required." });
    return;
  }
  if (!JOB_TYPES.has(jobType)) {
    json(res, 400, { ok: false, error: "Select a job type." });
    return;
  }
  if (body.acceptedTerms !== true) {
    json(res, 400, { ok: false, error: "You must accept the Terms of Service." });
    return;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase.from("waitlist").insert({
      email,
      phone,
      job_type: jobType,
      accepted_terms: true,
    });

    if (error) {
      if (error.code === "23505") {
        json(res, 409, { ok: false, error: "This email is already on the waitlist." });
        return;
      }
      throw error;
    }

    json(res, 201, { ok: true });
  } catch (err) {
    console.error(err);
    json(res, 500, { ok: false, error: "Something went wrong. Try again." });
  }
}

