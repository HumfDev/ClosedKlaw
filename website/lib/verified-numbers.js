import { createClient } from "@supabase/supabase-js";
import { normalizeToE164 } from "./phone.js";
import { promoIsValid } from "./promo.js";
import {
  billingIdsFromSession,
  checkoutSessionIsPaid,
  retrieveCheckoutSession,
} from "./stripe-checkout.js";
import { normalizeFullName } from "./waitlist-shared.js";

function safeStartCode(value) {
  const code = String(value ?? "").trim().toLowerCase();
  return /^wk_[a-z0-9]{6}$/.test(code) ? code : "";
}

export function parseFullName(value) {
  const fullName = normalizeFullName(value);
  if (!fullName) return "";
  if (fullName.length < 2 || fullName.length > 120) return "";
  return fullName;
}

function supabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceKey) {
    const err = new Error("Supabase is not configured.");
    err.status = 503;
    throw err;
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

export function parseVerifiedNumberPayload(body) {
  const phone = normalizeToE164(body?.phone);
  if (!phone) {
    return { ok: false, error: "Enter the iPhone number you’ll text Kleo from." };
  }
  const rawName = body?.fullName ?? body?.full_name ?? body?.name;
  const fullName = parseFullName(rawName);
  if (rawName != null && String(rawName).trim() && !fullName) {
    return { ok: false, error: "Enter your full name (at least 2 characters)." };
  }
  return {
    ok: true,
    payload: {
      phone,
      fullName,
      sessionId: String(body?.sessionId ?? body?.session_id ?? "").trim(),
      promoCode: String(body?.promoCode ?? body?.promo_code ?? body?.promo ?? "").trim(),
      startCode: safeStartCode(body?.startCode ?? body?.start_code),
    },
  };
}

export async function paidCheckoutIdentity(sessionId) {
  const session = await retrieveCheckoutSession(sessionId);
  if (!checkoutSessionIsPaid(session)) {
    const err = new Error("Payment isn’t complete yet. Finish checkout, then try again.");
    err.status = 402;
    throw err;
  }
  const ids = billingIdsFromSession(session);
  return {
    ok: true,
    paid: true,
    fullName: ids.fullName || "",
  };
}

export async function addVerifiedNumber(body) {
  const parsed = parseVerifiedNumberPayload(body);
  if (!parsed.ok) {
    const err = new Error(parsed.error);
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const row = {
    phone: parsed.payload.phone,
    full_name: parsed.payload.fullName || null,
    email: null,
    start_code: parsed.payload.startCode || null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_session_id: null,
    source: "checkout",
    updated_at: now,
  };

  if (parsed.payload.sessionId) {
    const session = await retrieveCheckoutSession(parsed.payload.sessionId);
    if (!checkoutSessionIsPaid(session)) {
      const err = new Error("Payment isn’t complete yet. Finish checkout, then try again.");
      err.status = 402;
      throw err;
    }
    const ids = billingIdsFromSession(session);
    row.stripe_session_id = session.id || parsed.payload.sessionId;
    row.stripe_customer_id = ids.customerId || null;
    row.stripe_subscription_id = ids.subscriptionId || null;
    row.email = ids.email || null;
    if (!row.full_name) row.full_name = ids.fullName || null;
    if (!row.start_code) row.start_code = safeStartCode(session?.metadata?.start_code) || null;
  } else if (promoIsValid(parsed.payload.promoCode)) {
    row.source = "promo";
  } else {
    const err = new Error("Finish checkout first, then add your number.");
    err.status = 401;
    throw err;
  }

  if (!row.full_name) {
    const err = new Error("Enter your full name.");
    err.status = 400;
    throw err;
  }

  const supabase = supabaseAdmin();

  if (row.stripe_subscription_id) {
    const { error } = await supabase
      .from("verified_numbers")
      .delete()
      .eq("stripe_subscription_id", row.stripe_subscription_id)
      .neq("phone", row.phone);
    if (error) throw error;
  }
  if (row.stripe_customer_id) {
    const { error } = await supabase
      .from("verified_numbers")
      .delete()
      .eq("stripe_customer_id", row.stripe_customer_id)
      .neq("phone", row.phone);
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from("verified_numbers")
    .upsert(row, { onConflict: "phone" })
    .select("phone, full_name")
    .single();

  if (error) throw error;
  return { ok: true, phone: data.phone, fullName: data.full_name || row.full_name };
}

export async function removeVerifiedNumbers({ customerId, subscriptionId } = {}) {
  const customer = String(customerId ?? "").trim();
  const subscription = String(subscriptionId ?? "").trim();
  if (!customer && !subscription) return { ok: true, removed: 0 };

  const supabase = supabaseAdmin();
  let removed = 0;

  if (subscription) {
    const { data, error } = await supabase
      .from("verified_numbers")
      .delete()
      .eq("stripe_subscription_id", subscription)
      .select("phone");
    if (error) throw error;
    removed += data?.length || 0;
  }

  if (customer) {
    const { data, error } = await supabase
      .from("verified_numbers")
      .delete()
      .eq("stripe_customer_id", customer)
      .select("phone");
    if (error) throw error;
    removed += data?.length || 0;
  }

  return { ok: true, removed };
}

export function stripeIdsFromSubscription(obj) {
  const subscriptionId = String(obj?.id ?? "").trim();
  const customer = obj?.customer;
  const customerId = typeof customer === "string"
    ? customer
    : String(customer?.id ?? "").trim();
  return {
    subscriptionId: subscriptionId.startsWith("sub_") ? subscriptionId : "",
    customerId: customerId.startsWith("cus_") ? customerId : "",
  };
}

export async function handleSubscriptionCanceled(obj) {
  const ids = stripeIdsFromSubscription(obj);
  return removeVerifiedNumbers(ids);
}
