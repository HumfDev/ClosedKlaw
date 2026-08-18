import { recordOnboardingFunnel } from "../lib/onboarding-funnel.js";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
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
  try {
    const body = await readJson(req);
    const result = await recordOnboardingFunnel({
      supabaseUrl: process.env.SUPABASE_URL?.trim(),
      supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
      body,
    });
    json(res, 200, result);
  } catch (err) {
    console.error(err);
    json(res, err.status || 500, { ok: false, error: err.message || "Could not record funnel event." });
  }
}
