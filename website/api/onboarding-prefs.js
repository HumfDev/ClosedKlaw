import { validateWebOnboarding } from "../lib/web-onboarding.js";
import { getKleoPhone } from "../lib/kleo-phone.js";
import { KLEO_PHONE_FALLBACK } from "../kleo-config.js";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
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

export async function saveWebOnboardingPrefs(body) {
  const parsed = validateWebOnboarding(body);
  if (!parsed.ok) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }

  const apiBase = (process.env.KLEOKLAW_API_URL || "https://api.kleoklaw.com").replace(/\/$/, "");
  const resp = await fetch(`${apiBase}/onboarding/web-prefs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detail = String(data.detail || data.error || "").trim();
    const err = new Error(
      resp.status === 404 || resp.status === 405
        ? "Could not save preferences yet. Scan the code — Kleo will ask these over iMessage."
        : (detail || "Could not save preferences."),
    );
    err.status = resp.status >= 400 && resp.status < 500 ? resp.status : 502;
    throw err;
  }

  const phone = getKleoPhone() || KLEO_PHONE_FALLBACK;
  const startCode = String(data.start_code || "").trim();
  const smsBody = startCode ? `hey Kleo! ${startCode}` : "hey Kleo!";
  const smsHref = phone
    ? `sms:${phone}&body=${encodeURIComponent(smsBody)}`
    : "#";
  return { ok: true, start_code: startCode || undefined, sms_href: smsHref };
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
    const result = await saveWebOnboardingPrefs(body);
    json(res, 200, result);
  } catch (err) {
    console.error(err);
    json(res, err.status || 500, { ok: false, error: err.message || "Could not save preferences." });
  }
}
