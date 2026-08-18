/** Create a Stripe Checkout Session for the monthly plan (card now, trial, then $29.99/mo). */

import { promoIsValid } from "./promo.js";

const STRIPE_API = "https://api.stripe.com/v1";

export function requestOrigin(req) {
  const protoHeader = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const hostHeader = String(
    req.headers["x-forwarded-host"] ?? req.headers.host ?? "",
  )
    .split(",")[0]
    .trim();
  const proto = protoHeader || "https";
  if (!hostHeader) return "";
  return `${proto}://${hostHeader}`;
}

function safeStartCode(value) {
  const code = String(value ?? "").trim().toLowerCase();
  return /^wk_[a-z0-9]{6}$/.test(code) ? code : "";
}

function stripeHeaders(secret) {
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

function promoCodes() {
  return String(process.env.KLEO_PROMO_CODES || "asdfs7")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => promoIsValid(item));
}

async function ensureStripePromotionCodes(secret) {
  for (const code of promoCodes()) {
    const listed = await fetch(
      `${STRIPE_API}/promotion_codes?code=${encodeURIComponent(code)}&active=true&limit=1`,
      { headers: stripeHeaders(secret) },
    );
    const existing = await listed.json().catch(() => ({}));
    if (existing?.data?.length) continue;

    const couponBody = new URLSearchParams();
    couponBody.set("percent_off", "100");
    couponBody.set("duration", "forever");
    couponBody.set("name", "Kleo website promo");
    const couponResp = await fetch(`${STRIPE_API}/coupons`, {
      method: "POST",
      headers: stripeHeaders(secret),
      body: couponBody,
    });
    const coupon = await couponResp.json().catch(() => ({}));
    if (!couponResp.ok || !coupon.id) continue;

    const promoBody = new URLSearchParams();
    promoBody.set("coupon", coupon.id);
    promoBody.set("code", code);
    await fetch(`${STRIPE_API}/promotion_codes`, {
      method: "POST",
      headers: stripeHeaders(secret),
      body: promoBody,
    });
  }
}

export async function createMonthlyCheckoutSession({ origin, startCode } = {}) {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env.STRIPE_PRICE_ID_MONTHLY?.trim();
  const trialDays = Number.parseInt(
    String(process.env.STRIPE_MONTHLY_TRIAL_DAYS ?? "30").trim() || "0",
    10,
  );

  if (!secret || !priceId) {
    const err = new Error("Stripe is not configured.");
    err.status = 503;
    throw err;
  }

  try {
    await ensureStripePromotionCodes(secret);
  } catch {
    /* Checkout still starts; promo field works for codes already in Stripe. */
  }

  const base = String(origin || "").replace(/\/$/, "");
  const code = safeStartCode(startCode);
  let successUrl =
    process.env.STRIPE_SUCCESS_URL?.trim() ||
    `${base}/start.html?session_id={CHECKOUT_SESSION_ID}`;
  if (code && !/[?&]code=/.test(successUrl)) {
    successUrl += `${successUrl.includes("?") ? "&" : "?"}code=${code}`;
  }
  const cancelUrl = process.env.STRIPE_CANCEL_URL?.trim() || `${base}/start`;

  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("payment_method_collection", "always");
  body.set("payment_method_types[0]", "card");
  body.set("line_items[0][price]", priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", successUrl);
  body.set("cancel_url", cancelUrl);
  body.set("allow_promotion_codes", "true");
  body.set("metadata[source]", "web");
  body.set("metadata[billing_plan]", "monthly");
  if (code) body.set("metadata[start_code]", code);
  body.set(
    "custom_text[submit][message]",
    "Start your 30-day free trial. After that, $29.99 USD per month until you cancel. Add a promo code on this page if you have one.",
  );
  if (Number.isFinite(trialDays) && trialDays > 0) {
    body.set("subscription_data[trial_period_days]", String(trialDays));
  }

  const resp = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: stripeHeaders(secret),
    body,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.url) {
    const err = new Error(data?.error?.message || "Could not start checkout.");
    err.status = 502;
    throw err;
  }
  return data.url;
}
