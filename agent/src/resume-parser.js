import { config } from "./config.js";

const SYSTEM_PROMPT = `Extract structured fields from this resume text. Return ONLY valid JSON — no markdown, no prose.

Schema:
{
  "firstName": string,
  "lastName": string,
  "email": string,
  "phone": string,
  "address": { "city": string, "state": string, "country": string } | null,
  "education": [{ "school": string, "degree": string, "major": string, "gpa": number | null, "gradYear": number | null }],
  "experience": [{ "company": string, "title": string, "start": "YYYY-MM", "end": "YYYY-MM" | "present", "bullets": [string] }],
  "skills": [string],
  "links": { "github": string | null, "linkedin": string | null, "portfolio": string | null }
}

Rules:
- Use null for any field you cannot determine — do not guess.
- gpa must be a number (e.g. 3.9) or null.
- gradYear must be a 4-digit integer or null.
- skills should be individual technologies/tools, not phrases.
- Return the raw JSON object only.`;

export async function parseStructuredProfile(resumeText) {
  if (!config.aiApiKey || !config.aiBaseUrl) {
    return null;
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
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Resume:\n\n${resumeText.slice(0, 12000)}` },
      ],
      max_tokens: 800,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    console.warn("[resume-parser] LLM error:", res.status);
    return null;
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(cleaned);
  } catch {
    console.warn("[resume-parser] JSON parse failed, raw:", raw.slice(0, 200));
    return null;
  }
}
