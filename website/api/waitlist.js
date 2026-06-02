import { handleWaitlistSignup } from "../lib/waitlist-api.js";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { Resend } from "resend";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function verifyCaptcha(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: false, error: "CAPTCHA not configured." };
  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = await r.json();
  return { ok: data.success === true, error: data.success ? null : "CAPTCHA verification failed." };
}

async function sendVerificationEmail(email, verificationToken) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return;
  const appUrl = process.env.APP_URL?.trim().replace(/\/$/, "") ?? "https://www.kleoklaw.com";
  const verifyUrl = `${appUrl}/api/verify?token=${verificationToken}`;
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: "KleoKlaw <noreply@kleoklaw.com>",
    to: email,
    subject: "Verify your email, KleoKlaw waitlist",
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f7f8;font-family:Inter,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 24px;"><tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;max-width:480px;"><tr><td>
<h1 style="font-family:Georgia,serif;font-size:26px;color:#1a3a42;margin:0 0 12px;">Verify your email</h1>
<p style="color:#4a6670;font-size:15px;line-height:1.6;margin:0 0 32px;">Thanks for joining the KleoKlaw waitlist. Click below to confirm your email address and secure your spot.</p>
<a href="${verifyUrl}" style="display:inline-block;background:#2a5f6e;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:500;">Verify my email →</a>
<p style="color:#8a9ea6;font-size:13px;margin:32px 0 0;">If you didn't sign up for KleoKlaw, you can safely ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`,
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  let body = req.body ?? {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // Google path — Authorization header present
  if (req.headers.authorization) {
    try {
      const result = await handleWaitlistSignup({
        supabaseUrl: process.env.SUPABASE_URL?.trim(),
        supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
        authHeader: req.headers.authorization,
        body,
      });
      json(res, result.status, result.body);
    } catch (err) {
      console.error(err);
      json(res, 500, { ok: false, error: "Something went wrong. Try again." });
    }
    return;
  }

  // Email path — CAPTCHA + email verification
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceKey) {
    json(res, 500, { ok: false, error: "Server waitlist storage is not configured." });
    return;
  }

  const fullName = String(body.fullName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const gender = String(body.gender ?? "").trim();
  const birthday = String(body.birthday ?? "").trim();
  const rawTypes = Array.isArray(body.jobTypes) ? body.jobTypes : [];
  const jobTypes = rawTypes.map((t) => String(t).trim().toLowerCase()).filter(Boolean);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    json(res, 400, { ok: false, error: "Valid email required." }); return;
  }
  if (jobTypes.length === 0) {
    json(res, 400, { ok: false, error: "Select at least one job type." }); return;
  }
  if (typeof body.activelyApplying !== "boolean") {
    json(res, 400, { ok: false, error: "Indicate whether you are actively applying." }); return;
  }
  if (body.acceptedTerms !== true) {
    json(res, 400, { ok: false, error: "You must accept the Terms of Service." }); return;
  }

  const captchaToken = String(body.captchaToken ?? "").trim();
  if (!captchaToken) {
    json(res, 400, { ok: false, error: "CAPTCHA token missing." }); return;
  }
  const ip = req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress;
  const captcha = await verifyCaptcha(captchaToken, ip).catch(() => ({ ok: false, error: "CAPTCHA check failed." }));
  if (!captcha.ok) {
    json(res, 400, { ok: false, error: captcha.error }); return;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const verificationToken = randomUUID();
    const { error } = await supabase.from("waitlist").insert({
      full_name: fullName, email, gender, birthday, job_type: JSON.stringify(jobTypes),
      actively_applying: body.activelyApplying, accepted_terms: true,
      verified: false, verification_token: verificationToken,
    });
    if (error) {
      if (error.code === "23505") {
        json(res, 409, { ok: false, error: "This email is already on the waitlist." }); return;
      }
      throw error;
    }
    sendVerificationEmail(email, verificationToken).catch(console.error);
    json(res, 201, { ok: true });
  } catch (err) {
    console.error(err);
    json(res, 500, { ok: false, error: "Something went wrong. Try again." });
  }
}
