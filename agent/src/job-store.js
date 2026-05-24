import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "..", "jobs.db");

let _db;

export function getDb(dbPath = DB_PATH) {
  if (_db) return _db;
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

export function closeDb() {
  _db?.close();
  _db = undefined;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,
      user_key    TEXT NOT NULL,
      job_url     TEXT NOT NULL,
      company     TEXT,
      title       TEXT,
      ats_type    TEXT NOT NULL DEFAULT 'generic',
      status      TEXT NOT NULL DEFAULT 'pending_approval',
      resume_fields TEXT,
      cover_letter  TEXT,
      created_at    INTEGER NOT NULL,
      started_at    INTEGER,
      completed_at  INTEGER,
      result        TEXT,
      error         TEXT
    );

    CREATE TABLE IF NOT EXISTS job_questions (
      id          TEXT PRIMARY KEY,
      job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      question    TEXT NOT NULL,
      answer      TEXT,
      asked_at    INTEGER NOT NULL,
      answered_at INTEGER,
      timeout_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_key, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_questions_job ON job_questions(job_id);
  `);
}

// ── Job CRUD ──────────────────────────────────────────────────────────────────

export function enqueueJob(job) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO jobs (id, user_key, job_url, company, title, ats_type, status,
                      resume_fields, cover_letter, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
  `).run(
    id,
    job.userKey,
    job.jobUrl,
    job.company ?? null,
    job.title ?? null,
    job.atsType ?? detectAtsType(job.jobUrl),
    job.resumeFields ? JSON.stringify(job.resumeFields) : null,
    job.coverLetter ?? null,
    Date.now(),
  );
  return id;
}

export function dequeueNext(userKey) {
  const db = getDb();
  const clause = userKey ? "AND user_key = ?" : "";
  const args = userKey ? [userKey] : [];
  const job = db.prepare(`
    SELECT * FROM jobs WHERE status = 'approved' ${clause}
    ORDER BY created_at ASC LIMIT 1
  `).get(...args);
  if (!job) return null;
  const startedAt = Date.now();
  db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?")
    .run(startedAt, job.id);
  return deserializeJob({ ...job, status: "running", started_at: startedAt });
}

export function updateJobStatus(id, status, patch = {}) {
  const db = getDb();
  const fields = ["status = ?"];
  const values = [status];

  if (status === "running") { fields.push("started_at = ?"); values.push(Date.now()); }
  if (status === "completed" || status === "failed" || status === "skipped") {
    fields.push("completed_at = ?"); values.push(Date.now());
  }
  if (patch.result !== undefined) { fields.push("result = ?"); values.push(JSON.stringify(patch.result)); }
  if (patch.error !== undefined) { fields.push("error = ?"); values.push(patch.error); }

  values.push(id);
  db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function getJob(id) {
  const row = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return row ? deserializeJob(row) : null;
}

export function listJobs(userKey, { status, limit = 20 } = {}) {
  const db = getDb();
  const clauses = ["user_key = ?"];
  const args = [userKey];
  if (status) { clauses.push("status = ?"); args.push(status); }
  return db.prepare(`SELECT * FROM jobs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .all(...args, limit)
    .map(deserializeJob);
}

// ── Question CRUD ─────────────────────────────────────────────────────────────

export function addQuestion(jobId, question, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO job_questions (id, job_id, question, asked_at, timeout_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, jobId, question, now, now + timeoutMs);
  db.prepare("UPDATE jobs SET status = 'needs_input' WHERE id = ?").run(jobId);
  return id;
}

export function answerQuestion(questionId, answer) {
  const db = getDb();
  const q = db.prepare("SELECT * FROM job_questions WHERE id = ?").get(questionId);
  if (!q) return false;
  db.prepare("UPDATE job_questions SET answer = ?, answered_at = ? WHERE id = ?")
    .run(answer, Date.now(), questionId);
  db.prepare("UPDATE jobs SET status = 'approved' WHERE id = ?").run(q.job_id);
  return true;
}

export function getPendingQuestion(jobId) {
  return getDb().prepare(`
    SELECT * FROM job_questions WHERE job_id = ? AND answer IS NULL
    ORDER BY asked_at ASC LIMIT 1
  `).get(jobId) ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function detectAtsType(url) {
  if (!url) return "generic";
  const u = url.toLowerCase();
  if (u.includes("boards.greenhouse.io") || u.includes("greenhouse.io/jobs")) return "greenhouse";
  if (u.includes("jobs.lever.co")) return "lever";
  if (u.includes("jobs.ashbyhq.com") || u.includes("ashby.io")) return "ashby";
  if (/\.wd\d*\.myworkdayjobs\.com/.test(u)) return "workday";
  return "generic";
}

/**
 * Poll the DB until the user answers a question or the timeout expires.
 * Used by the apply worker (separate process) — no shared in-memory state.
 */
export async function pollForAnswer(questionId, timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  const stmt = getDb().prepare(
    "SELECT answer FROM job_questions WHERE id = ? AND answer IS NOT NULL",
  );
  while (Date.now() < deadline) {
    const row = stmt.get(questionId);
    if (row?.answer != null) return row.answer;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error("answer timed out");
}

function deserializeJob(row) {
  return {
    ...row,
    resumeFields: row.resume_fields ? JSON.parse(row.resume_fields) : null,
    result: row.result ? JSON.parse(row.result) : null,
  };
}
