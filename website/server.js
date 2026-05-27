import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { config as loadEnv } from "dotenv";
import { handleWaitlistSignup } from "./lib/waitlist-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
loadEnv({ path: path.join(ROOT, ".env") });

const PORT = Number(process.env.PORT) || 3000;
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
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

if (supabaseUrl && supabaseServiceKey) {
  console.log("Waitlist storage: Supabase");
} else {
  console.log(
    allowSqliteFallback
      ? "Waitlist storage: SQLite (website/waitlist.db)"
      : "Waitlist storage: DISABLED (missing Supabase env; SQLite fallback not enabled)",
  );
}

const db =
  supabaseUrl && supabaseServiceKey
    ? null
    : allowSqliteFallback
      ? new Database(path.join(ROOT, "waitlist.db"))
      : null;

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

  try {
    db.exec("ALTER TABLE waitlist ADD COLUMN accepted_terms INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* column exists */
  }
  for (const col of ["full_name TEXT", "gender TEXT", "birthday TEXT"]) {
    try {
      db.exec(`ALTER TABLE waitlist ADD COLUMN ${col}`);
    } catch {
      /* column exists */
    }
  }
}

const insertStmt = db?.prepare(
  "INSERT INTO waitlist (email, job_type, full_name, gender, birthday, accepted_terms) VALUES (?, ?, ?, ?, ?, ?)",
);

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

  if (req.method === "GET" && url.pathname === "/api/config") {
    if (!supabaseUrl || !supabaseAnonKey) {
      json(res, 503, { ok: false, error: "Auth not configured." });
      return;
    }
    json(res, 200, { ok: true, supabaseUrl, supabaseAnonKey });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/waitlist") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await handleWaitlistSignup({
        supabaseUrl,
        supabaseServiceKey,
        authHeader: req.headers.authorization,
        body,
        sqliteInsert: insertStmt
          ? ({ email, jobType, fullName, gender, birthday }) => {
              insertStmt.run(email, jobType, fullName, gender, birthday, 1);
            }
          : null,
      });
      json(res, result.status, result.body);
    } catch (err) {
      console.error(err);
      json(res, 500, { ok: false, error: "Something went wrong. Try again." });
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    json(res, 404, { ok: false, error: "API route not found." });
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
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`KleoKlaw → http://localhost:${PORT}`);
});
