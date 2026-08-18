import crypto from "node:crypto";
import { handleSubscriptionCanceled } from "./verified-numbers.js";

const SIGNATURE_TOLERANCE_SEC = 300;
const CANCEL_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

function headerMap(header) {
  const map = { t: "", v1: [] };
  for (const part of String(header ?? "").split(",")) {
    const [key, ...rest] = part.trim().split("=");
    const value = rest.join("=");
    if (key === "t") map.t = value;
    if (key === "v1" && value) map.v1.push(value);
  }
  return map;
}

function timingSafeEqualHex(left, right) {
  const a = Buffer.from(String(left), "utf8");
  const b = Buffer.from(String(right), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const payload = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody || "").toString("utf8");
  const parts = headerMap(signatureHeader);
  const timestamp = Number.parseInt(parts.t, 10);
  if (!payload || !secret || !Number.isFinite(timestamp) || parts.v1.length === 0) {
    const err = new Error("Invalid Stripe signature.");
    err.status = 400;
    throw err;
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > SIGNATURE_TOLERANCE_SEC) {
    const err = new Error("Stripe signature expired.");
    err.status = 400;
    throw err;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");

  if (!parts.v1.some((sig) => timingSafeEqualHex(expected, sig))) {
    const err = new Error("Invalid Stripe signature.");
    err.status = 400;
    throw err;
  }

  try {
    return JSON.parse(payload);
  } catch {
    const err = new Error("Invalid Stripe payload.");
    err.status = 400;
    throw err;
  }
}

export async function handleStripeWebhookEvent(event) {
  const type = String(event?.type ?? "");
  const obj = event?.data?.object || {};

  if (type === "customer.subscription.deleted") {
    const result = await handleSubscriptionCanceled(obj);
    return { ok: true, action: "removed", removed: result.removed };
  }

  if (type === "customer.subscription.updated") {
    const status = String(obj.status ?? "");
    if (CANCEL_STATUSES.has(status)) {
      const result = await handleSubscriptionCanceled(obj);
      return { ok: true, action: "removed", removed: result.removed };
    }
  }

  return { ok: true, action: "ignored" };
}

export async function readRawBody(req) {
  if (typeof req.rawBody === "string") return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString("utf8");
  if (typeof req.body === "string") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
