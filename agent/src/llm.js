import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

let cachedSystemPrompt;

export function loadSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const path = resolve(root, config.aiPromptPath);
  if (!existsSync(path)) throw new Error(`prompt file not found: ${path}`);
  cachedSystemPrompt = readFileSync(path, "utf8").trim();
  return cachedSystemPrompt;
}

export function clearPromptCache() {
  cachedSystemPrompt = undefined;
}

async function chatCompletion(messages, { maxTokens = 300, temperature = 0.7 } = {}) {
  if (!config.aiApiKey) {
    throw new Error("API key missing — add AI_API_KEY (or DEEPSEEK_API_KEY) to .env");
  }

  const url = `${config.aiBaseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LLM ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("empty model response");
  return content;
}

export async function summarizeResume(resumeText) {
  return chatCompletion(
    [
      {
        role: "system",
        content:
          "You summarize resumes for a job-matching assistant. Output exactly 2-3 short sentences in plain text. No markdown, no bullet points, no em dashes. Focus on education, experience, skills, and target role if stated. Use lowercase.",
      },
      { role: "user", content: `Resume text:\n\n${resumeText.slice(0, 12000)}` },
    ],
    { maxTokens: 180, temperature: 0.3 },
  );
}

export async function generateReply(userText, { resumeContext = "", mcpContext = "" } = {}) {
  const system = loadSystemPrompt();

  const parts = [system];
  if (resumeContext) parts.push(resumeContext);
  if (mcpContext) parts.push(`Live data from connected services:\n${mcpContext}`);

  return chatCompletion(
    [
      { role: "system", content: parts.join("\n\n") },
      { role: "user", content: userText ?? "" },
    ],
    { maxTokens: 300, temperature: 0.7 },
  );
}
