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

async function stripeForm(secret, path, { method = "GET", body } = {}) {
  const resp = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: stripeHeaders(secret),
    body,
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, data };
}

async function ensureWebsitePromoCoupon(secret) {
  const couponId = "kleo_web_promo";
  const existing = await stripeForm(secret, `/coupons/${encodeURIComponent(couponId)}`);
  if (existing.ok && existing.data?.id) return existing.data.id;

  const couponBody = new URLSearchParams();
  couponBody.set("id", couponId);
  couponBody.set("percent_off", "100");
  couponBody.set("duration", "forever");
  couponBody.set("name", "Kleo website promo");
  const created = await stripeForm(secret, "/coupons", { method: "POST", body: couponBody });
  if (created.ok && created.data?.id) return created.data.id;

  const listed = await stripeForm(secret, "/coupons?limit=20");
  const match = (listed.data?.data || []).find(
    (item) => item?.percent_off === 100 && item?.duration === "forever" && item?.valid,
  );
  return match?.id || "";
}

async function createPromotionCode(secret, couponId, code) {
  const currentApi = new URLSearchParams();
  currentApi.set("promotion[type]", "coupon");
  currentApi.set("promotion[coupon]", couponId);
  currentApi.set("code", code);
  currentApi.set("active", "true");
  const created = await stripeForm(secret, "/promotion_codes", {
    method: "POST",
    body: currentApi,
  });
  if (created.ok && created.data?.id) return created.data;

  const legacy = new URLSearchParams();
  legacy.set("coupon", couponId);
  legacy.set("code", code);
  legacy.set("active", "true");
  const fallback = await stripeForm(secret, "/promotion_codes", {
    method: "POST",
    body: legacy,
  });
  return fallback.data;
}

async function ensureStripePromotionCodes(secret) {
  const couponId = await ensureWebsitePromoCoupon(secret);
  if (!couponId) {
    console.error("Could not create Stripe coupon for website promo codes.");
    return;
  }

  for (const code of promoCodes()) {
    const listed = await stripeForm(
      secret,
      `/promotion_codes?code=${encodeURIComponent(code)}&active=true&limit=1`,
    );
    if (listed.data?.data?.length) continue;

    const created = await createPromotionCode(secret, couponId, code);
    if (!created?.id) {
      console.error("Could not create Stripe promotion code", code, created?.error || created);
    }
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
  const cancelUrl = process.env.STRIPE_CANCEL_URL?.trim() || `${base}/start?resume=1`;

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

export async function retrieveCheckoutSession(sessionId) {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  const id = String(sessionId ?? "").trim();
  if (!secret) {
    const err = new Error("Stripe is not configured.");
    err.status = 503;
    throw err;
  }
  if (!/^cs_(test|live)_/.test(id) || id.length > 200) {
    const err = new Error("Checkout session is missing.");
    err.status = 400;
    throw err;
  }

  const { ok, data } = await stripeForm(
    secret,
    `/checkout/sessions/${encodeURIComponent(id)}?expand[]=subscription`,
  );
  if (!ok || !data?.id) {
    const err = new Error(data?.error?.message || "Could not confirm checkout.");
    err.status = 402;
    throw err;
  }
  return data;
}

export function checkoutSessionIsPaid(session) {
  if (!session || session.status !== "complete") return false;
  if (session.mode && session.mode !== "subscription") return false;
  const payment = String(session.payment_status || "");
  return payment === "paid" || payment === "no_payment_required";
}

export function billingIdsFromSession(session) {
  const subscription = session?.subscription;
  const subscriptionId = typeof subscription === "string"
    ? subscription
    : String(subscription?.id ?? "").trim();
  const customer = session?.customer ?? (
    typeof subscription === "object" ? subscription?.customer : ""
  );
  const customerId = typeof customer === "string"
    ? customer
    : String(customer?.id ?? "").trim();
  const email = String(
    session?.customer_details?.email || session?.customer_email || "",
  ).trim();
  return {
    subscriptionId: subscriptionId.startsWith("sub_") ? subscriptionId : "",
    customerId: customerId.startsWith("cus_") ? customerId : "",
    email: email || "",
  };
}
