import { config } from "../src/config.js";

const FACTUAL_RE = /\b(authorized|sponsorship|salary|compensation|start date|gpa|citizen|visa|clearance)\b/i;

/**
 * Generate an answer to a custom application question using the LLM.
 * Falls back to askQuestion() (iMessage round-trip) for factual questions
 * where the LLM cannot reliably answer without user input.
 *
 * @param {string} question - The question text from the form
 * @param {object} profile - Structured resume profile
 * @param {string} resumeSummary - 2-3 sentence summary
 * @param {(q: string) => Promise<string>} askQuestion - Round-trip iMessage callback
 */
export async function generateAnswer(question, profile, resumeSummary, askQuestion) {
  // Route factual questions (work auth, salary, etc.) straight to the user
  if (FACTUAL_RE.test(question)) {
    return askQuestion(question);
  }

  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "the candidate";

  try {
    const answer = await llmCall(
      `You are helping ${name} fill out a job application. Answer the following question
using their resume. Keep the answer concise and honest (1-3 sentences).
Do NOT make up facts. If you cannot determine the answer from the resume, say "N/A".`,
      `Question: ${question}\n\nResume summary: ${resumeSummary ?? "N/A"}`,
    );
    return answer;
  } catch {
    // On LLM failure, ask the user rather than leave blank
    return askQuestion(question);
  }
}

async function llmCall(system, user) {
  const url = `${config.aiBaseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 150,
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}
