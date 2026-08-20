import { addVerifiedNumber, paidCheckoutIdentity } from "../lib/verified-numbers.js";

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

function sessionIdFrom(req) {
  const fromQuery = req.query?.session_id || req.query?.sessionId;
  if (fromQuery) return String(fromQuery).trim();
  try {
    const url = new URL(req.url, "http://localhost");
    return String(url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "").trim();
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
  if (req.method === "GET") {
    const sessionId = sessionIdFrom(req);
    if (!sessionId) {
      json(res, 400, { ok: false, error: "Checkout session is missing." });
      return;
    }
    try {
      const result = await paidCheckoutIdentity(sessionId);
      json(res, 200, result);
    } catch (err) {
      console.error(err);
      json(res, err.status || 500, {
        ok: false,
        error: err.message || "Could not confirm checkout.",
      });
    }
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  try {
    const body = await readJson(req);
    const result = await addVerifiedNumber(body);
    json(res, 200, result);
  } catch (err) {
    console.error(err);
    json(res, err.status || 500, {
      ok: false,
      error: err.message || "Could not save your number.",
    });
  }
}
