import { config } from "./config.js";
import { summarizeResume, generateReply } from "./llm.js";
import {
  extractGoogleDriveOrDocsUrl,
  fetchResumeFromGoogleLink,
  extractTextFromBuffer,
  extractTextFromFilePath,
  pickResumeAttachment,
} from "./resume-ingest.js";
import { getSession, updateSession, STAGES, getSenderKey } from "./session.js";
import { getConnectedServices } from "./token-store.js";
import { setApolloApiKey } from "./oauth.js";
import { fetchMcpContext } from "./mcp-tools.js";

/** Static copy — never sent to the LLM. */
export const WELCOME_RESUME_PROMPT = `hey! i'm your job & internship finder 🎯

first step: upload your resume
• attach a PDF (or .txt) directly here in iMessage, or
• paste a Google Drive link (sharing: anyone with the link can view)

once i have it, i'll summarize your background in a few sentences and help you find roles.`;

export const RESUME_REMINDER =
  "still need your resume — attach a PDF here or paste a Google Drive / Google Docs link.";

export const RESUME_FOLLOWUP_PROMPT =
  'what roles are you looking for? (e.g. "summer 2026 swe internships in seattle")';

export const RESUME_AI_DISABLED =
  "i need an API key to summarize your resume — set DEEPSEEK_API_KEY in .env and restart the server.";

function buildAccountsMessage(userKey, connected = []) {
  const base = config.publicUrl.replace(/\/$/, "");
  const enc = encodeURIComponent(userKey);
  const connectedLine =
    connected.length > 0 ? `already connected: ${connected.join(", ")}\n\n` : "";
  const tunnelNote = config.connectLinksNeedTunnel
    ? "note: connector links use localhost — they only work in Safari on this Mac. for iPhone, run `ngrok http 3847`, set PUBLIC_URL to the https URL in .env, restart the server, then ask me to resend links.\n\n"
    : "";
  return `${connectedLine}${tunnelNote}connect your accounts so i can track everything:

1. Google (Gmail + Calendar + Drive)
   ${base}/connect/google?user=${enc}

2. Indeed (job search)
   ${base}/connect/indeed?user=${enc}

3. Notion (application tracker)
   ${base}/connect/notion?user=${enc}

4. ZipRecruiter — already active, no login needed!

5. Apollo (recruiter contacts) — reply: apollo:YOUR_API_KEY

reply "skip" to start searching now, or "done" once you've connected what you want.`;
}

function truncateForLog(s, n = 80) {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

/** Static wrapper around the only AI-generated onboarding text (2–3 sentence summary). */
export function buildResumeReceivedReply(summary) {
  return `got your resume! here's what i picked up:\n\n${summary}\n\n${RESUME_FOLLOWUP_PROMPT}`;
}

export function getResumeWelcomeReply(isFirstTouch) {
  return isFirstTouch ? WELCOME_RESUME_PROMPT : RESUME_REMINDER;
}

async function ingestResumeText(text, source) {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length < 40) {
    throw new Error("couldn't read enough text from that file — try a PDF or a Drive link");
  }
  if (!config.aiApiKey) {
    return {
      resumeText: trimmed,
      resumeSummary: null,
      resumeSource: source,
      aiSkipped: true,
    };
  }
  const summary = await summarizeResume(trimmed);
  return { resumeText: trimmed, resumeSummary: summary, resumeSource: source, aiSkipped: false };
}

export async function tryIngestResumeFromMessage(msg) {
  const attachments = msg.attachments ?? [];
  const att = pickResumeAttachment(attachments);
  if (att?.path || att?.converted_path) {
    const path = att.converted_path ?? att.path;
    const text = await extractTextFromFilePath(path, att);
    const name = att.transfer_name ?? att.filename ?? "attachment";
    return ingestResumeText(text, `iMessage: ${name}`);
  }

  const userText = (msg.text ?? "").trim();
  const driveRef = extractGoogleDriveOrDocsUrl(userText);
  if (driveRef) {
    const { buffer, mime, source } = await fetchResumeFromGoogleLink(userText);
    const text = await extractTextFromBuffer(
      buffer,
      mime,
      driveRef.kind === "google_doc" ? "resume.txt" : "resume.pdf",
    );
    return ingestResumeText(text, `Google Drive: ${source}`);
  }

  return null;
}

export function hasResumePayload(msg) {
  if (pickResumeAttachment(msg.attachments ?? [])) return true;
  return Boolean(extractGoogleDriveOrDocsUrl(msg.text ?? ""));
}

/**
 * Onboarding replies. Static text unless ingesting a resume (then only summarizeResume uses AI).
 */
export async function handleOnboarding(msg) {
  const session = getSession(msg);

  if (session.stage === STAGES.READY) {
    return { handled: false };
  }

  // ── Account connection step ──────────────────────────────────────────────────
  if (session.stage === STAGES.AWAITING_ACCOUNTS) {
    const userKey = getSenderKey(msg);
    const userText = (msg.text ?? "").trim();
    const lower = userText.toLowerCase();

    if (lower.startsWith("apollo:")) {
      const apiKey = userText.slice(7).trim();
      if (apiKey) {
        setApolloApiKey(userKey, apiKey);
        const connected = getConnectedServices(userKey);
        return {
          handled: true,
          reply: `apollo connected! \n\n${buildAccountsMessage(userKey, connected)}`,
          stage: STAGES.AWAITING_ACCOUNTS,
        };
      }
    }

    const connected = getConnectedServices(userKey);
    const done = lower === "skip" || lower === "done" || lower === "connected";

    if (done || connected.length > 0) {
      updateSession(msg, { stage: STAGES.READY });
      const serviceMsg = connected.length > 0 ? `connected: ${connected.join(", ")}. ` : "";
      return {
        handled: true,
        reply: `${serviceMsg}what roles are you looking for? (e.g. "summer 2026 swe internships in seattle")`,
        stage: STAGES.READY,
      };
    }

    return {
      handled: true,
      reply: buildAccountsMessage(userKey, connected),
      stage: STAGES.AWAITING_ACCOUNTS,
    };
  }

  if (session.stage === STAGES.AWAITING_RESUME) {
    if (!hasResumePayload(msg)) {
      const isFirstTouch = !session.prompted;
      updateSession(msg, { prompted: true });
      return {
        handled: true,
        reply: getResumeWelcomeReply(isFirstTouch),
        usesAi: false,
        stage: STAGES.AWAITING_RESUME,
      };
    }

    updateSession(msg, { stage: STAGES.INGESTING });
    try {
      const ingested = await tryIngestResumeFromMessage(msg);
      if (!ingested) {
        updateSession(msg, { stage: STAGES.AWAITING_RESUME });
        return {
          handled: true,
          reply: RESUME_REMINDER,
          usesAi: false,
          stage: STAGES.AWAITING_RESUME,
        };
      }

      if (ingested.aiSkipped) {
        updateSession(msg, { stage: STAGES.AWAITING_RESUME });
        return {
          handled: true,
          reply: RESUME_AI_DISABLED,
          usesAi: false,
          stage: STAGES.AWAITING_RESUME,
        };
      }

      const userKey = getSenderKey(msg);
      updateSession(msg, {
        stage: STAGES.AWAITING_ACCOUNTS,
        resumeText: ingested.resumeText,
        resumeSummary: ingested.resumeSummary,
        resumeSource: ingested.resumeSource,
      });

      console.log(
        `[resume] ingested from ${ingested.resumeSource} (${truncateForLog(ingested.resumeText)})`,
      );

      const connectMsg = buildAccountsMessage(userKey);
      return {
        handled: true,
        reply: `${buildResumeReceivedReply(ingested.resumeSummary)}\n\nnow let's connect your accounts:\n\n${connectMsg}`,
        usesAi: true,
        stage: STAGES.AWAITING_ACCOUNTS,
      };
    } catch (err) {
      console.error("[resume] ingest error:", err.message);
      updateSession(msg, { stage: STAGES.AWAITING_RESUME });
      return {
        handled: true,
        reply: `couldn't read that resume: ${err.message}\n\n${RESUME_REMINDER}`,
        usesAi: false,
        stage: STAGES.AWAITING_RESUME,
      };
    }
  }

  if (session.stage === STAGES.INGESTING) {
    return {
      handled: true,
      reply: "still processing your resume — one sec, then try again if needed.",
      usesAi: false,
      stage: STAGES.INGESTING,
    };
  }

  return { handled: false };
}

export async function generateJobSearchReply(msg, userText) {
  const session = getSession(msg);
  const userKey = getSenderKey(msg);
  const resumeContext = session.resumeSummary
    ? `Candidate resume summary:\n${session.resumeSummary}`
    : "";

  const { text: mcpText, jobListings } = await fetchMcpContext(userKey, userText);
  if (jobListings?.length) {
    updateSession(msg, { pendingJobList: jobListings });
  }

  return generateReply(userText, { resumeContext, mcpContext: mcpText });
}
