import { enqueueJob, getJob, updateJobStatus, addQuestion, answerQuestion } from "./job-store.js";
import { getSession, updateSession } from "./session.js";
import { getTokens } from "./token-store.js";
import { detectAtsType } from "./job-store.js";

const APPLY_NUMBERED_RE = /^apply(?:\s+(?:to\s+)?)?([0-9,\s]+|all)$/i;
const APPLY_URL_RE = /^apply\s+(https?:\/\/\S+)$/i;

/**
 * Parse "apply to 1, 3" / "apply all" / "apply https://..."
 * Returns { jobs: [{...}] } or null if not an apply command.
 */
export function parseApplyCommand(text, pendingJobList) {
  const t = (text ?? "").trim();

  // Direct URL — works even without a pendingJobList
  const urlMatch = t.match(APPLY_URL_RE);
  if (urlMatch) {
    const url = urlMatch[1];
    return { jobs: [{ url, company: null, title: null, atsType: detectAtsType(url) }] };
  }

  if (!pendingJobList?.length) return null;

  const m = t.match(APPLY_NUMBERED_RE);
  if (!m) return null;

  const raw = m[1].trim().toLowerCase();
  if (raw === "all") return { jobs: pendingJobList };

  const indices = raw
    .split(/[\s,]+/)
    .map((s) => parseInt(s, 10) - 1)
    .filter((i) => i >= 0 && i < pendingJobList.length);

  if (!indices.length) return null;
  return { jobs: indices.map((i) => pendingJobList[i]) };
}

/**
 * Write approved jobs to the SQLite queue.
 * Returns count of jobs enqueued.
 */
export async function enqueueApprovedJobs(userKey, jobs) {
  const tokens = getTokens(userKey);
  const profile = tokens._profile ?? null;

  for (const job of jobs) {
    enqueueJob({
      userKey,
      jobUrl: job.url,
      company: job.company,
      title: job.title,
      atsType: job.atsType,
      resumeFields: profile,
    });
  }

  return jobs.length;
}

/**
 * Called by POST /worker/result — updates job status, returns iMessage reply text.
 */
export function handleWorkerResult(payload) {
  const { jobId, success, appId, error, screenshotPath } = payload;
  const job = getJob(jobId);
  if (!job) return null;

  if (success) {
    updateJobStatus(jobId, "completed", { result: { success: true, appId } });
    const ref = appId ? ` (ref: ${appId})` : "";
    return `applied to ${job.company ?? job.job_url}${ref} ✅`;
  } else {
    updateJobStatus(jobId, "failed", { error, result: { success: false, screenshotPath } });
    const note = screenshotPath ? " screenshot saved." : "";
    return `failed on ${job.company ?? job.job_url}: ${error ?? "unknown error"}.${note} want me to retry?`;
  }
}

/**
 * Called by POST /worker/question — stores the questionId in the user's session
 * and returns the iMessage text to send them.
 */
export function handleWorkerQuestion(payload, msg) {
  const { jobId, questionId, question } = payload;
  const job = getJob(jobId);
  if (!job) return null;

  const msgOrFallback = msg ?? { sender: job.user_key };
  updateSession(msgOrFallback, {
    pendingWorkerQuestion: { jobId, questionId, text: question },
  });

  const company = job.company ?? "the company";
  return `${company} asks: ${question}\n(reply to answer and i'll continue the application)`;
}

/**
 * Called from handlers.js when the user replies while pendingWorkerQuestion is set.
 * Writes the answer to SQLite so the worker's pollForAnswer loop picks it up.
 */
export function forwardAnswerToWorker(msg, userText) {
  const session = getSession(msg);
  const q = session.pendingWorkerQuestion;
  if (!q) return false;

  answerQuestion(q.questionId, userText);
  updateSession(msg, { pendingWorkerQuestion: null });
  return true;
}
