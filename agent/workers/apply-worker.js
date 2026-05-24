/**
 * Apply worker — runs as a separate Node process.
 * Polls the SQLite job queue, launches Playwright for each approved job,
 * fills ATS forms, and posts results back to the iMessage server.
 *
 * Usage:
 *   node workers/apply-worker.js
 *   node workers/apply-worker.js --dry-run   (fill but don't submit)
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env before importing config
const rootDir = join(__dirname, "..");
process.env.NODE_PATH = join(rootDir, "node_modules");

import { config } from "../src/config.js";
import { dequeueNext, addQuestion, pollForAnswer } from "../src/job-store.js";
import { launchBrowser, getProfilesDir } from "./browser.js";
import { fill as fillGreenhouse } from "./ats/greenhouse.js";
import { fill as fillLever } from "./ats/lever.js";
import { fill as fillAshby } from "./ats/ashby.js";

const DRY_RUN = process.argv.includes("--dry-run");
const POLL_MS = 5_000;
const SERVER_URL = config.backendUrl ?? "http://127.0.0.1:3847";
const WORKER_SECRET = config.workerSecret ?? "";

// ── ATS dispatch ──────────────────────────────────────────────────────────────

const ATS_SCRIPTS = {
  greenhouse: fillGreenhouse,
  lever: fillLever,
  ashby: fillAshby,
};

async function runAts(page, job, { askQuestion, dryRun }) {
  const script = ATS_SCRIPTS[job.ats_type] ?? null;
  if (!script) {
    throw new Error(`no ATS script for type "${job.ats_type}" — needs generic fallback`);
  }
  return script(page, job.resumeFields ?? {}, {
    resumeSummary: job.resumeFields?.summary ?? "",
    askQuestion,
    dryRun,
  });
}

// ── Server communication ──────────────────────────────────────────────────────

async function postToServer(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (WORKER_SECRET) headers["x-worker-secret"] = WORKER_SECRET;
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) console.warn(`[worker] POST ${path} returned ${res.status}`);
  return res;
}

async function reportResult(jobId, { success, appId, error, screenshotPath }) {
  await postToServer("/worker/result", { jobId, success, appId, error, screenshotPath }).catch(
    (e) => console.warn("[worker] result post failed:", e.message),
  );
}

async function askQuestionViaImessage(jobId, question) {
  const questionId = addQuestion(jobId, question);

  await postToServer("/worker/question", { jobId, questionId, question }).catch(
    (e) => console.warn("[worker] question post failed:", e.message),
  );

  try {
    const answer = await pollForAnswer(questionId, 5 * 60 * 1000);
    return answer;
  } catch {
    console.log(`[worker] question timed out: "${question}" — using default`);
    return "yes";
  }
}

// ── Job runner ────────────────────────────────────────────────────────────────

async function processJob(job) {
  const { id: jobId, user_key: userKey, job_url: jobUrl, ats_type: atsType } = job;

  console.log(`[worker] processing job ${jobId} (${atsType}) → ${jobUrl}`);

  let context;
  let page;
  const screenshotDir = join(getProfilesDir(), userKey.replace(/[^a-zA-Z0-9]/g, "_"));
  mkdirSync(screenshotDir, { recursive: true });

  try {
    context = await launchBrowser(userKey, { ats: atsType });
    page = await context.newPage();
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const askQuestion = (q) => askQuestionViaImessage(jobId, q);

    const result = await runAts(page, job, { askQuestion, dryRun: DRY_RUN });

    await reportResult(jobId, { success: true, appId: result?.appId ?? null });
    console.log(`[worker] ✓ job ${jobId} completed (appId: ${result?.appId ?? "none"})`);
  } catch (err) {
    console.error(`[worker] ✗ job ${jobId} failed:`, err.message);

    let screenshotPath = null;
    if (page) {
      screenshotPath = join(screenshotDir, `fail-${jobId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }

    await reportResult(jobId, { success: false, error: err.message, screenshotPath });
  } finally {
    await context?.close().catch(() => {});
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function poll() {
  const job = dequeueNext();
  if (job) {
    await processJob(job);
  }
  setTimeout(poll, POLL_MS);
}

console.log(`[worker] starting — server=${SERVER_URL} dry-run=${DRY_RUN}`);
poll();
