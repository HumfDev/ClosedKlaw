import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile() {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const port = Number(process.env.PORT ?? 3847);
const demoMode = process.env.DEMO_MODE === "true";
const publicUrlExplicit = (process.env.PUBLIC_URL ?? "").trim().replace(/\/$/, "");

/** OAuth /connect links must be reachable from the user's phone — not localhost. */
export function isLocalhostUrl(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  } catch {
    return true;
  }
}

/** Base URL for /connect/* and OAuth redirect_uri. Demo keeps localhost; live iMessage needs PUBLIC_URL. */
function resolvePublicUrl() {
  if (publicUrlExplicit) return publicUrlExplicit;
  if (demoMode) return `http://localhost:${port}`;
  return `http://localhost:${port}`;
}

const publicUrl = resolvePublicUrl();

export const config = {
  port,
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  allowFrom: (process.env.ALLOW_FROM ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  watchChatId: process.env.WATCH_CHAT_ID
    ? Number(process.env.WATCH_CHAT_ID)
    : null,
  imsgBin: process.env.IMSG_BIN ?? "imsg",
  demoMode,
  autoReply: process.env.AUTO_REPLY === "true",
  backendUrl:
    process.env.BACKEND_URL ?? `http://127.0.0.1:${port}`,
  publicUrl,
  /** True when connector links in iMessage won't work on iPhone until PUBLIC_URL is a tunnel URL. */
  connectLinksNeedTunnel: !demoMode && isLocalhostUrl(publicUrl),

  // AI — any OpenAI-compatible provider (DeepSeek, OpenAI, Ollama, etc.)
  aiEnabled: process.env.AI_ENABLED === "true",
  aiApiKey: process.env.DEEPSEEK_API_KEY ?? process.env.AI_API_KEY ?? "",
  aiBaseUrl: process.env.DEEPSEEK_BASE_URL ?? process.env.AI_BASE_URL ?? "",
  aiModel: process.env.DEEPSEEK_MODEL ?? process.env.AI_MODEL ?? "",
  aiMaxResponses: Number(process.env.AI_MAX_RESPONSES ?? 2),
  aiMinIntervalMs: Number(process.env.AI_MIN_INTERVAL_MS ?? 60_000),
  aiPromptPath: process.env.AI_PROMPT_PATH ?? "prompts/imessage-system.txt",
  aiReplyTag: process.env.AI_REPLY_TAG ?? "",

  // Worker
  workerSecret: process.env.WORKER_SECRET ?? "",

  // OAuth credentials — Google
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",

  // OAuth credentials — Notion
  notionClientId: process.env.NOTION_CLIENT_ID ?? "",
  notionClientSecret: process.env.NOTION_CLIENT_SECRET ?? "",

  // OAuth credentials — Indeed
  indeedClientId: process.env.INDEED_CLIENT_ID ?? "",
  indeedClientSecret: process.env.INDEED_CLIENT_SECRET ?? "",
};

export function isOAuthConfigured(service) {
  switch (service) {
    case "google":
      return Boolean(config.googleClientId && config.googleClientSecret);
    case "notion":
      return Boolean(config.notionClientId && config.notionClientSecret);
    case "indeed":
      return Boolean(config.indeedClientId && config.indeedClientSecret);
    default:
      return false;
  }
}

export function oauthEnvKeys(service) {
  switch (service) {
    case "google":
      return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
    case "notion":
      return ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"];
    case "indeed":
      return ["INDEED_CLIENT_ID", "INDEED_CLIENT_SECRET"];
    default:
      return [];
  }
}
