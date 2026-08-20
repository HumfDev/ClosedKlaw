import crypto from "node:crypto";
import { verifyStripeSignature } from "../lib/stripe-webhook.js";
import { parsePronouns } from "../lib/pronouns.js";
import { parseVerifiedNumberPayload } from "../lib/verified-numbers.js";

const secret = "whsec_test";
const payload = JSON.stringify({
  type: "customer.subscription.deleted",
  data: { object: { id: "sub_test", customer: "cus_test", status: "canceled" } },
});
const timestamp = Math.floor(Date.now() / 1000);
const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
const event = verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret);
if (event.type !== "customer.subscription.deleted") {
  console.error("Webhook signature verification failed.");
  process.exit(1);
}

try {
  verifyStripeSignature(payload, `t=${timestamp},v1=deadbeef`, secret);
  console.error("Invalid signature was accepted.");
  process.exit(1);
} catch {
  /* expected */
}

const parsed = parseVerifiedNumberPayload({
  phone: "(555) 123-4567",
  fullName: "Jane Chen",
  pronouns: "she/her",
});
if (
  !parsed.ok
  || parsed.payload.phone !== "+15551234567"
  || parsed.payload.fullName !== "Jane Chen"
  || parsed.payload.pronouns !== "she/her"
) {
  console.error("Phone payload parse failed:", parsed);
  process.exit(1);
}

const customPronouns = parseVerifiedNumberPayload({
  phone: "(555) 123-4567",
  fullName: "Alex Kim",
  pronouns: "They / Them",
});
if (!customPronouns.ok || customPronouns.payload.pronouns !== "they/them") {
  console.error("Custom pronouns should normalize to they/them:", customPronouns);
  process.exit(1);
}

const badPronouns = parseVerifiedNumberPayload({
  phone: "(555) 123-4567",
  fullName: "Alex Kim",
  pronouns: "they",
});
if (badPronouns.ok) {
  console.error("Single-word pronouns should be rejected.");
  process.exit(1);
}

const missingName = parseVerifiedNumberPayload({ phone: "(555) 123-4567" });
if (!missingName.ok || missingName.payload.fullName !== "") {
  console.error("Missing name should parse as empty so Stripe can fill it:", missingName);
  process.exit(1);
}

const badName = parseVerifiedNumberPayload({ phone: "(555) 123-4567", fullName: "J" });
if (badName.ok) {
  console.error("One-letter name should be rejected.");
  process.exit(1);
}

const bad = parseVerifiedNumberPayload({ phone: "12" });
if (bad.ok) {
  console.error("Short phone should be rejected.");
  process.exit(1);
}

if (parsePronouns("he/him") !== "he/him" || parsePronouns("SHE / HER") !== "she/her") {
  console.error("Preset pronouns should normalize.");
  process.exit(1);
}

if (parsePronouns("xe/xem") !== "xe/xem" || parsePronouns("they") !== "") {
  console.error("Custom pronoun pair checks failed.");
  process.exit(1);
}

console.log("stripe webhook + verified-number payload tests passed");
