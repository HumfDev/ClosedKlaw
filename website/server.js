import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
loadEnv({ path: path.join(ROOT, ".env") });

const PORT = Number(process.env.PORT) || 3000;
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const isProd = process.env.NODE_ENV === "production";

if (isProd && (!supabaseUrl || !supabaseServiceKey)) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Refusing to start in production without Supabase configured.",
  );
}

const allowSqliteFallback =
  !isProd &&
  String(process.env.WAITLIST_STORAGE ?? "")
    .trim()
    .toLowerCase() === "sqlite";

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

if (supabase) {
  console.log("Waitlist storage: Supabase");
} else {
  console.log(
    allowSqliteFallback
      ? "Waitlist storage: SQLite (website/waitlist.db)"
      : "Waitlist storage: DISABLED (missing Supabase env; SQLite fallback not enabled)",
  );
}

const db =
  supabase || !allowSqliteFallback ? null : new Database(path.join(ROOT, "waitlist.db"));

if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      job_type TEXT NOT NULL,
      accepted_terms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_idx ON waitlist(email);
  `);

  try {
    db.exec("ALTER TABLE waitlist ADD COLUMN accepted_terms INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* column exists */
  }
}

const insertStmt = db?.prepare(
  "INSERT INTO waitlist (email, phone, job_type, accepted_terms) VALUES (?, ?, ?, ?)",
);

async function saveWaitlistSignup({ email, phone, jobType }) {
  if (supabase) {
    const { error } = await supabase.from("waitlist").insert({
      email,
      phone,
      job_type: jobType,
      accepted_terms: true,
    });
    if (error) {
      if (error.code === "23505") {
        const err = new Error("duplicate");
        err.code = "DUPLICATE_EMAIL";
        throw err;
      }
      throw error;
    }
    return;
  }
  if (!db) {
    const err = new Error("Waitlist storage not configured.");
    err.code = "WAITLIST_STORAGE_NOT_CONFIGURED";
    throw err;
  }
  insertStmt.run(email, phone, jobType, 1);
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
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(fs.readFileSync(filePath));
}

const JOB_TYPES = new Set(["swe", "consulting", "ib", "quant", "other"]);

function normalizeEmail(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function normalizePhone(v) {
  return String(v ?? "").trim();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS" && url.pathname === "/api/waitlist") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/waitlist") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      const email = normalizeEmail(body.email);
      const phone = normalizePhone(body.phone);
      const jobType = String(body.jobType ?? "").trim().toLowerCase();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        json(res, 400, { ok: false, error: "Valid email required." });
        return;
      }
      if (!phone || phone.replace(/\D/g, "").length < 10) {
        json(res, 400, { ok: false, error: "Valid phone number required." });
        return;
      }
      if (!JOB_TYPES.has(jobType)) {
        json(res, 400, { ok: false, error: "Select a job type." });
        return;
      }
      if (body.acceptedTerms !== true) {
        json(res, 400, { ok: false, error: "You must accept the Terms of Service." });
        return;
      }

      await saveWaitlistSignup({ email, phone, jobType });
      json(res, 201, { ok: true });
    } catch (err) {
      if (err?.code === "SQLITE_CONSTRAINT_UNIQUE" || err?.code === "DUPLICATE_EMAIL") {
        json(res, 409, { ok: false, error: "This email is already on the waitlist." });
        return;
      }
      if (err?.code === "WAITLIST_STORAGE_NOT_CONFIGURED") {
        json(res, 500, {
          ok: false,
          error:
            "Server waitlist storage is not configured. Please try again later.",
        });
        return;
      }
      console.error(err);
      json(res, 500, { ok: false, error: "Something went wrong. Try again." });
    }
    return;
  }

  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  if (!rel || rel.includes("..") || path.basename(rel).startsWith(".")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (url.pathname === "/terms.html") {
    const termsPath = path.join(ROOT, "terms.html");
    if (!fs.existsSync(termsPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Terms not found");
      return;
    }
    serveStatic(res, termsPath);
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, "index.html");
  }
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`KleoKlaw → http://localhost:${PORT}`);
});
