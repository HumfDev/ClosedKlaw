import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { handleWaitlistSignup, validateProfileFields, buildConsentMetadata } from "./lib/waitlist-api.js";
import { getKleoPhone } from "./lib/kleo-phone.js";
import { checkSupabaseHealth } from "./lib/supabase-health.js";
import { createMonthlyCheckoutSession, requestOrigin } from "./lib/stripe-checkout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
loadEnv({ path: path.join(ROOT, ".env") });

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";
const APP_URL = process.env.APP_URL?.trim().replace(/\/$/, "")
  ?? (isProd ? "https://www.kleoklaw.com" : `http://localhost:${PORT}`);
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (isProd && (!supabaseUrl || !supabaseServiceKey)) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Refusing to start in production without Supabase configured.",
  );
}

const allowSqliteFallback =
  !isProd &&
  String(process.env.WAITLIST_STORAGE ?? "").trim().toLowerCase() === "sqlite";

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const testMode = process.env.TEST_MODE === "true";
const testTokenStore = new Map();

if (supabase) {
  console.log("Waitlist storage: Supabase");
} else {
  console.log(
    allowSqliteFallback
      ? "Waitlist storage: SQLite (website/waitlist.db)"
      : "Waitlist storage: DISABLED (missing Supabase env; SQLite fallback not enabled)",
  );
}

let db = null;
if (!supabase && allowSqliteFallback) {
  const { default: Database } = await import("better-sqlite3");
  db = new Database(path.join(ROOT, "waitlist.db"));
}

if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      job_type TEXT NOT NULL,
      accepted_terms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_idx ON waitlist(email);
  `);
  try { db.exec("ALTER TABLE waitlist ADD COLUMN accepted_terms INTEGER NOT NULL DEFAULT 0"); } catch { /* exists */ }
  for (const col of [
    "full_name TEXT",
    "gender TEXT",
    "phone TEXT",
    "verified INTEGER DEFAULT 0",
    "verification_token TEXT",
    "accepted_privacy INTEGER DEFAULT 0",
    "terms_version TEXT",
    "privacy_version TEXT",
    "accepted_at TEXT",
    "age_attested INTEGER DEFAULT 0",
  ]) {
    try { db.exec(`ALTER TABLE waitlist ADD COLUMN ${col}`); } catch { /* exists */ }
  }
}

const insertStmt = db?.prepare(
  "INSERT INTO waitlist (email, job_type, full_name, gender, accepted_terms, accepted_privacy, terms_version, privacy_version, accepted_at, age_attested) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
);

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
  if (!resend) return;
  const verifyUrl = `${APP_URL}/api/verify?token=${verificationToken}`;
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

async function saveEmailSignup({ fullName, email, gender, jobType, activelyApplying, verificationToken, consent }) {
  if (testMode) {
    testTokenStore.set(verificationToken, email);
    console.log(`[TEST MODE] signup: ${email} | verify: ${APP_URL}/api/verify?token=${verificationToken}`);
    return;
  }
  if (supabase) {
    const { error } = await supabase.from("waitlist").insert({
      full_name: fullName,
      email,
      gender,
      job_type: jobType,
      actively_applying: activelyApplying,
      verified: false,
      verification_token: verificationToken,
      ...consent,
    });
    if (error) {
      if (error.code === "23505") { const e = new Error("duplicate"); e.code = "DUPLICATE_EMAIL"; throw e; }
      throw error;
    }
    return;
  }
  throw Object.assign(new Error("Storage not configured."), { code: "WAITLIST_STORAGE_NOT_CONFIGURED" });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(fs.readFileSync(filePath));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS" && url.pathname === "/api/waitlist") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const result = await checkSupabaseHealth({ supabaseUrl, supabaseServiceKey });
    json(res, result.ok ? 200 : 503, result);
    return;
  }

  if (req.method === "OPTIONS" && url.pathname === "/api/onboarding-prefs") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/onboarding-prefs") {
    try {
      const { saveWebOnboardingPrefs } = await import("./api/onboarding-prefs.js");
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await saveWebOnboardingPrefs(body);
      json(res, 200, result);
    } catch (err) {
      console.error(err);
      json(res, err.status || 500, { ok: false, error: err.message || "Could not save preferences." });
    }
    return;
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/checkout") {
    const origin = requestOrigin(req) || `http://${req.headers.host}`;
    let startCode = url.searchParams.get("start_code") || url.searchParams.get("startCode") || "";
    if (req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        startCode = body.startCode || body.start_code || startCode;
      } catch {
        /* ignore invalid JSON; checkout can still start without a start code */
      }
    }
    try {
      const checkoutUrl = await createMonthlyCheckoutSession({ origin, startCode });
      if (req.method === "GET") {
        res.writeHead(302, { Location: checkoutUrl, "Cache-Control": "no-store" });
        res.end();
        return;
      }
      json(res, 200, { ok: true, checkout_url: checkoutUrl });
    } catch (err) {
      console.error(err);
      if (req.method === "GET") {
        res.writeHead(302, { Location: `${origin}/start?checkout_error=1`, "Cache-Control": "no-store" });
        res.end();
        return;
      }
      json(res, err.status || 500, { ok: false, error: err.message || "Could not start checkout." });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    if (!supabaseUrl || !supabaseAnonKey) { json(res, 503, { ok: false, error: "Auth not configured." }); return; }
    const kleoPhone = getKleoPhone();
    json(res, 200, { ok: true, supabaseUrl, supabaseAnonKey, kleoPhone: kleoPhone || undefined });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/waitlist") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}");

      // Google path — signed in with OAuth
      if (req.headers.authorization) {
        const result = await handleWaitlistSignup({
          supabaseUrl,
          supabaseServiceKey,
          authHeader: req.headers.authorization,
          body,
          sqliteInsert: insertStmt
            ? ({ email, jobType, fullName, gender, consent }) => {
                insertStmt.run(
                  email,
                  jobType,
                  fullName,
                  gender,
                  1,
                  1,
                  consent.terms_version,
                  consent.privacy_version,
                  consent.accepted_at,
                  1,
                );
              }
            : null,
        });
        json(res, result.status, result.body);
        return;
      }

      // Email path — CAPTCHA + email verification
      const email = String(body.email ?? "").trim().toLowerCase();
      const rawTypes = Array.isArray(body.jobTypes) ? body.jobTypes : [];
      const jobTypes = rawTypes.map((t) => String(t).trim().toLowerCase()).filter(Boolean);

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { json(res, 400, { ok: false, error: "Valid email required." }); return; }
      if (jobTypes.length === 0) { json(res, 400, { ok: false, error: "Select at least one job type." }); return; }
      if (typeof body.activelyApplying !== "boolean") { json(res, 400, { ok: false, error: "Indicate whether you are actively applying." }); return; }

      const profile = validateProfileFields(body);
      if (!profile.ok) { json(res, 400, { ok: false, error: profile.error }); return; }
      const consent = buildConsentMetadata(body);

      const captchaToken = String(body.captchaToken ?? "").trim();
      if (!captchaToken) { json(res, 400, { ok: false, error: "CAPTCHA token missing." }); return; }
      const ip = req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress;
      const captcha = await verifyCaptcha(captchaToken, ip).catch(() => ({ ok: false, error: "CAPTCHA check failed." }));
      if (!captcha.ok) { json(res, 400, { ok: false, error: captcha.error }); return; }

      const verificationToken = randomUUID();
      await saveEmailSignup({
        fullName: profile.fullName,
        email,
        gender: profile.gender,
        jobType: JSON.stringify(jobTypes),
        activelyApplying: body.activelyApplying,
        verificationToken,
        consent,
      });
      sendVerificationEmail(email, verificationToken).catch(console.error);
      json(res, 201, { ok: true });
    } catch (err) {
      if (err?.code === "DUPLICATE_EMAIL") { json(res, 409, { ok: false, error: "This email is already on the waitlist." }); return; }
      console.error(err);
      json(res, 500, { ok: false, error: "Something went wrong. Try again." });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/verify") {
    const token = url.searchParams.get("token");
    if (!token) { res.writeHead(302, { Location: "/waitlist.html?waitlist_error=invalid-token" }); res.end(); return; }
    if (testMode) {
      const email = testTokenStore.get(token);
      if (!email) { res.writeHead(302, { Location: "/waitlist.html?waitlist_error=invalid-token" }); res.end(); return; }
      testTokenStore.delete(token);
      console.log(`[TEST MODE] verified: ${email}`);
      res.writeHead(302, { Location: "/verify-success.html" }); res.end(); return;
    }
    if (!supabase) { res.writeHead(302, { Location: "/waitlist.html?waitlist_error=invalid-token" }); res.end(); return; }
    const { data, error } = await supabase
      .from("waitlist")
      .update({ verified: true, verification_token: null })
      .eq("verification_token", token)
      .select("email")
      .single();
    if (error || !data) { res.writeHead(302, { Location: "/waitlist.html?waitlist_error=invalid-token" }); res.end(); return; }
    res.writeHead(302, { Location: "/verify-success.html" }); res.end(); return;
  }

  if (url.pathname.startsWith("/api/")) {
    json(res, 404, { ok: false, error: "API route not found." });
    return;
  }

  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  if (!rel || rel.includes("..") || path.basename(rel).startsWith(".")) { res.writeHead(404); res.end(); return; }
  let filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (url.pathname === "/terms.html") {
    const termsPath = path.join(ROOT, "terms.html");
    if (!fs.existsSync(termsPath)) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Terms not found"); return; }
    serveStatic(res, termsPath); return;
  }
  const cleanUrlMap = {
    "/support": "support.html",
    "/privacy": "privacy.html",
    "/terms": "terms.html",
    "/app": "app.html",
    "/download": "install.html",
    "/start": "start.html",
  };
  const cleanPath = url.pathname.replace(/\/$/, "") || "/";
  if (cleanUrlMap[cleanPath]) {
    const mappedPath = path.join(ROOT, cleanUrlMap[cleanPath]);
    if (!fs.existsSync(mappedPath)) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Page not found"); return; }
    serveStatic(res, mappedPath); return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, "index.html");
  }
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`KleoKlaw → http://localhost:${PORT}`);
});
