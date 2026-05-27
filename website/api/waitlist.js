import { handleWaitlistSignup } from "../lib/waitlist-api.js";

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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed." });
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

  try {
    const result = await handleWaitlistSignup({
      supabaseUrl: process.env.SUPABASE_URL?.trim(),
      supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
      authHeader: req.headers.authorization,
      body,
    });
    json(res, result.status, result.body);
  } catch (err) {
    console.error(err);
    json(res, 500, { ok: false, error: "Something went wrong. Try again." });
  }
}
