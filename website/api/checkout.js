import { createMonthlyCheckoutSession, requestOrigin } from "../lib/stripe-checkout.js";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function redirectTo(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
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

function startCodeFrom(req, body, originUrl) {
  const fromBody = body?.startCode || body?.start_code;
  if (fromBody) return String(fromBody);
  try {
    const url = new URL(req.url, originUrl || "http://localhost");
    return url.searchParams.get("start_code") || url.searchParams.get("startCode") || "";
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const origin = requestOrigin(req);
  const body = req.method === "POST" ? await readJson(req) : {};
  const startCode = startCodeFrom(req, body, origin);
  try {
    const checkoutUrl = await createMonthlyCheckoutSession({ origin, startCode });
    if (req.method === "GET") {
      redirectTo(res, checkoutUrl);
      return;
    }
    json(res, 200, { ok: true, checkout_url: checkoutUrl });
  } catch (err) {
    console.error(err);
    const fallback = `${origin || ""}/start?checkout_error=1`;
    if (req.method === "GET") {
      redirectTo(res, fallback);
      return;
    }
    json(res, err.status || 500, {
      ok: false,
      error: err.message || "Could not start checkout.",
    });
  }
}
