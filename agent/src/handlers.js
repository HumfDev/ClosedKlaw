import { spawn } from "node:child_process";
import { config } from "./config.js";
import { checkAiLimits, recordAiResponse, getAiSessionState } from "./ai-limits.js";
import { handleOnboarding, generateJobSearchReply } from "./onboarding.js";
import { STAGES, getSession, getSenderKey } from "./session.js";
import { parseApplyCommand, enqueueApprovedJobs, forwardAnswerToWorker } from "./apply-queue.js";

const recentEvents = [];
const MAX_EVENTS = 50;
const processedIds = new Set();
const recentBotTexts = new Set();
const recentUserTexts = new Map();

const LEGACY_DEMO_PREFIX = "✅ Agent got your message";

function isBotMessage(msg) {
  const text = (msg.text ?? "").trim();
  if (text.startsWith(LEGACY_DEMO_PREFIX)) return true;
  if (config.aiReplyTag && text.startsWith(config.aiReplyTag)) return true;
  if (recentBotTexts.has(text)) return true;
  return false;
}

function normalizeHandle(handle) {
  if (!handle) return "";
  const digits = handle.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return handle.trim().toLowerCase();
}

export function isAllowedSender(sender, msg = {}) {
  if (!config.allowFrom.length) return true;

  const candidates = [
    normalizeHandle(sender),
    normalizeHandle(msg.chat_identifier),
    ...(msg.participants ?? []).map(normalizeHandle),
  ].filter(Boolean);

  return config.allowFrom.some((allowed) => {
    const a = normalizeHandle(allowed);
    const aDigits = a.replace(/\D/g, "");
    return candidates.some(
      (c) => c === a || c.replace(/\D/g, "").endsWith(aDigits) || aDigits.endsWith(c.replace(/\D/g, "")),
    );
  });
}

function rememberUserText(text) {
  recentUserTexts.set(text, Date.now());
  if (recentUserTexts.size > 30) {
    const oldest = [...recentUserTexts.entries()].sort((a, b) => a[1] - b[1])[0];
    recentUserTexts.delete(oldest[0]);
  }
}

function isSelfChatEcho(msg) {
  const text = (msg.text ?? "").trim();
  if (!text || (config.aiReplyTag && text.startsWith(config.aiReplyTag))) return false;
  const sentAt = recentUserTexts.get(text);
  return sentAt != null && Date.now() - sentAt < 20_000;
}

function pushEvent(event) {
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_EVENTS) recentEvents.pop();
}

export function getRecentEvents() {
  return [...recentEvents];
}

function rememberBotText(text) {
  recentBotTexts.add(text);
  if (recentBotTexts.size > 20) {
    const first = recentBotTexts.values().next().value;
    recentBotTexts.delete(first);
  }
}

function sendViaImsg({ chatId, to, text }) {
  return new Promise((resolve, reject) => {
    const args = ["send", "--text", text];
    if (chatId != null) args.push("--chat-id", String(chatId));
    else if (to) args.push("--to", to);
    else return reject(new Error("send requires chat-id or to"));

    const child = spawn(config.imsgBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `imsg send exited ${code}`));
    });
  });
}

function tagReply(text) {
  return config.aiReplyTag ? `${config.aiReplyTag} ${text}`.trim() : text;
}

async function deliverReply(msg, reply, { recordAi = true, logTag = "[ai]" } = {}) {
  const tagged = tagReply(reply);
  if (!config.demoMode && !msg._demo) {
    await sendViaImsg({ chatId: msg.chat_id, to: msg.sender, text: tagged });
    rememberBotText(tagged);
    if (recordAi) recordAiResponse();
    console.log(`${logTag} reply sent:`, tagged.slice(0, 60) + "…");
  } else {
    console.log(`${logTag} demo reply (not sent):`, tagged);
  }
  return tagged;
}

/** Static resume ask first; DeepSeek only for 2–3 sentence summary on upload. */
async function handleAgentReply(msg) {
  const onboarding = await handleOnboarding(msg);
  if (onboarding.handled) {
    const reply = await deliverReply(msg, onboarding.reply, {
      recordAi: false,
      logTag: onboarding.usesAi ? "[resume+ai]" : "[onboarding]",
    });
    return {
      sent: true,
      reply,
      onboarding: true,
      usesAi: onboarding.usesAi,
      stage: onboarding.stage,
      session: getAiSessionState(),
    };
  }

  if (!config.aiEnabled) {
    return { skipped: true, reason: "ai disabled (job search)" };
  }

  const chatSession = getSession(msg);
  if (chatSession.stage !== STAGES.READY) {
    return { skipped: true, reason: "awaiting onboarding", stage: chatSession.stage };
  }

  // ── Apply command routing (before rate-limiting AI path) ───────────────────
  const userText = (msg.text ?? "").trim();
  const userKey = getSenderKey(msg);

  if (chatSession.pendingWorkerQuestion) {
    const forwarded = forwardAnswerToWorker(msg, userText);
    if (forwarded) {
      const reply = await deliverReply(msg, "got it — resuming application...", { recordAi: false });
      return { sent: true, reply, workerAnswer: true };
    }
  }

  const applyCmd = parseApplyCommand(userText, chatSession.pendingJobList ?? []);
  if (applyCmd?.jobs?.length) {
    const n = await enqueueApprovedJobs(userKey, applyCmd.jobs);
    const names = applyCmd.jobs.map((j) => j.company ?? j.title ?? j.url).join(", ");
    const reply = await deliverReply(
      msg,
      `on it — applying to ${names} (${n} role${n !== 1 ? "s" : ""}), i'll text you when done`,
      { recordAi: false },
    );
    return { sent: true, reply, queued: n };
  }

  const limits = checkAiLimits();
  if (!limits.allowed) {
    console.log(`[ai] not replying: ${limits.reason}`);
    return { skipped: true, reason: limits.reason, session: getAiSessionState() };
  }

  const raw = await generateJobSearchReply(msg, msg.text ?? "");
  const reply = await deliverReply(msg, raw);

  return { sent: true, reply, session: getAiSessionState() };
}

export async function handleIncomingMessage(msg) {
  if (msg.is_from_me) {
    return { ignored: true, reason: "outbound" };
  }

  if (isBotMessage(msg)) {
    return { ignored: true, reason: "bot echo" };
  }

  if (isSelfChatEcho(msg)) {
    return { ignored: true, reason: "self-chat sync echo" };
  }

  if (msg.id != null && processedIds.has(msg.id)) {
    return { ignored: true, reason: "duplicate" };
  }
  if (msg.id != null) processedIds.add(msg.id);

  if (!isAllowedSender(msg.sender, msg)) {
    console.log(
      `[handler] blocked sender=${msg.sender ?? "(empty)"} chat=${msg.chat_identifier ?? "?"}`,
    );
    return { ignored: true, reason: "sender not in ALLOW_FROM" };
  }

  const userText = (msg.text ?? "").trim();
  if (userText) rememberUserText(userText);

  const event = {
    receivedAt: new Date().toISOString(),
    id: msg.id,
    chatId: msg.chat_id,
    sender: msg.sender,
    text: msg.text,
    demo: Boolean(msg._demo),
  };

  pushEvent(event);

  console.log("\n--- iMessage received ---");
  console.log(`  from:   ${msg.sender ?? msg.sender_name ?? "(empty)"}`);
  console.log(`  chat:   ${msg.chat_id} (${msg.chat_identifier ?? ""})`);
  console.log(`  text:   ${msg.text ?? ""}`);
  console.log(`  rowid:  ${msg.id}`);
  console.log("-------------------------\n");

  let reply;
  let ai;

  if (config.autoReply) {
    reply = `${LEGACY_DEMO_PREFIX} at ${new Date().toLocaleTimeString()}: "${userText.slice(0, 80)}"`;
    if (!config.demoMode && !msg._demo) {
      try {
        await sendViaImsg({ chatId: msg.chat_id, to: msg.sender, text: reply });
        rememberBotText(reply);
        console.log("[handler] auto-reply sent via imsg");
      } catch (err) {
        console.warn("[handler] auto-reply failed:", err.message);
        reply = null;
      }
    }
  } else if (!config.autoReply) {
    try {
      ai = await handleAgentReply(msg);
      reply = ai.reply ?? null;
    } catch (err) {
      console.error("[agent] error:", err.message);
      ai = { error: err.message };
    }
  }

  return { ok: true, event, reply, ai };
}
