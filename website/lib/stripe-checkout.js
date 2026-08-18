/** Create a Stripe Checkout Session for the monthly plan (card now, trial, then $29.99/mo). */

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

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
  body.set("metadata[source]", "web");
  body.set("metadata[billing_plan]", "monthly");
  if (code) body.set("metadata[start_code]", code);
  body.set(
    "custom_text[submit][message]",
    "Start your 30-day free trial. After that, $29.99 USD per month until you cancel.",
  );
  if (Number.isFinite(trialDays) && trialDays > 0) {
    body.set("subscription_data[trial_period_days]", String(trialDays));
  }

  const resp = await fetch(STRIPE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
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
