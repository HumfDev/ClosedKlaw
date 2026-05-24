/**
 * Promise-based registry for worker question round-trips.
 * The apply worker awaits waitForAnswer(); the server resolves it
 * when the user's iMessage reply arrives at POST /worker/answer.
 */

const pending = new Map(); // questionId → { resolve, reject, timer }

export function waitForAnswer(questionId, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(questionId);
      reject(new Error("question timed out"));
    }, timeoutMs);
    pending.set(questionId, { resolve, timer });
  });
}

export function resolveAnswer(questionId, answer) {
  const entry = pending.get(questionId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(questionId);
  entry.resolve(answer);
  return true;
}

export function hasPending(questionId) {
  return pending.has(questionId);
}
