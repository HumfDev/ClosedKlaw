import {
  handleStripeWebhookEvent,
  readRawBody,
  verifyStripeSignature,
} from "../lib/stripe-webhook.js";

export const config = { api: { bodyParser: false } };

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Stripe-Signature, Content-Type");
    res.end();
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    json(res, 503, { ok: false, error: "Stripe webhook is not configured." });
    return;
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"] || req.headers["Stripe-Signature"];
    const event = verifyStripeSignature(rawBody, signature, secret);
    const result = await handleStripeWebhookEvent(event);
    json(res, 200, result);
  } catch (err) {
    console.error(err);
    json(res, err.status || 400, {
      ok: false,
      error: err.message || "Webhook failed.",
    });
  }
}
