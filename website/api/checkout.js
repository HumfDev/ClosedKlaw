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
  try {
    const checkoutUrl = await createMonthlyCheckoutSession({ origin });
    if (req.method === "GET") {
      redirectTo(res, checkoutUrl);
      return;
    }
    json(res, 200, { ok: true, checkout_url: checkoutUrl });
  } catch (err) {
    console.error(err);
    const home = `${origin || ""}/?checkout_error=1`;
    if (req.method === "GET") {
      redirectTo(res, home);
      return;
    }
    json(res, err.status || 500, {
      ok: false,
      error: err.message || "Could not start checkout.",
    });
  }
}
