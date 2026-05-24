/** Per-chat onboarding state (in-memory; keyed by chat_id or sender). */

const sessions = new Map();

export const STAGES = {
  AWAITING_RESUME: "awaiting_resume",
  INGESTING: "ingesting",
  AWAITING_ACCOUNTS: "awaiting_accounts",
  READY: "ready",
};

function sessionKey(msg) {
  if (msg.chat_id != null) return `chat:${msg.chat_id}`;
  const sender = (msg.sender ?? msg.chat_identifier ?? "").trim();
  return sender ? `sender:${sender}` : "unknown";
}

export function getSession(msg) {
  const key = sessionKey(msg);
  let s = sessions.get(key);
  if (!s) {
    s = {
      key,
      stage: STAGES.AWAITING_RESUME,
      resumeText: null,
      resumeSummary: null,
      resumeSource: null,
      pendingJobList: [],
      pendingWorkerQuestion: null,
      updatedAt: Date.now(),
    };
    sessions.set(key, s);
  }
  return s;
}

export function updateSession(msg, patch) {
  const s = getSession(msg);
  Object.assign(s, patch, { updatedAt: Date.now() });
  sessions.set(s.key, s);
  return s;
}

export function resetSession(msg) {
  sessions.delete(sessionKey(msg));
}

export function clearAllSessions() {
  sessions.clear();
}

export function getSessionForTest(key) {
  return sessions.get(key) ?? null;
}

export function getSenderKey(msg) {
  return (msg.sender ?? msg.chat_identifier ?? "").trim() || "unknown";
}
