import { promoIsValid } from "../lib/promo.js";

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

function safeStartCode(value) {
  const code = String(value ?? "").trim().toLowerCase();
  return /^wk_[a-z0-9]{6}$/.test(code) ? code : "";
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
  const body = await readJson(req);
  if (!promoIsValid(body.promoCode || body.promo || body.code)) {
    json(res, 400, { ok: false, error: "That code didn’t work." });
    return;
  }

  const startCode = safeStartCode(body.startCode || body.start_code);
  if (startCode) {
    const apiBase = (process.env.KLEOKLAW_API_URL || "https://api.kleoklaw.com").replace(/\/$/, "");
    try {
      await fetch(`${apiBase}/onboarding/web-promo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startCode,
          promoCode: String(body.promoCode || body.promo || body.code || "").trim(),
        }),
      });
    } catch {
      /* Website bypass still stands if the SMS API is unreachable. */
    }
  }

  json(res, 200, { ok: true, bypass: true, start_code: startCode || undefined });
}
