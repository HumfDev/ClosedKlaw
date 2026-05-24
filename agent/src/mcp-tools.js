import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getTokens } from "./token-store.js";
import { refreshGoogleToken } from "./oauth.js";
import { detectAtsType } from "./job-store.js";

export const MCP_URLS = {
  gmail: "https://gmailmcp.googleapis.com/mcp/v1",
  googleCalendar: "https://calendarmcp.googleapis.com/mcp/v1",
  googleDrive: "https://drivemcp.googleapis.com/mcp/v1",
  indeed: "https://mcp.indeed.com/claude/mcp",
  ziprecruiter: "https://api.ziprecruiter.com/mcp",
  notion: "https://mcp.notion.com/mcp",
  apollo: "https://mcp.apollo.io/mcp",
};

async function callTool(serverUrl, authToken, toolName, toolArgs) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: { headers },
  });
  const client = new Client({ name: "imessage-agent", version: "1.0.0" });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: toolArgs });
    return result;
  } finally {
    await client.close().catch(() => {});
  }
}

function extractText(result) {
  if (!result?.content) return "";
  return result.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function getValidGoogleToken(userKey, tokens) {
  if (!tokens?.access_token) return null;
  if (tokens.expires_at && Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  try {
    return await refreshGoogleToken(userKey);
  } catch (err) {
    console.warn("[mcp] Google token refresh failed:", err.message);
    return tokens.access_token;
  }
}

function looksLikeEmailQuery(text) {
  const lower = text.toLowerCase();
  return /email|gmail|inbox|heard back|response|reply|application|recruiter/.test(lower);
}

function looksLikeCalendarQuery(text) {
  const lower = text.toLowerCase();
  return /schedule|calendar|interview|meeting|remind|deadline|when|date/.test(lower);
}

function looksLikeDriveQuery(text) {
  const lower = text.toLowerCase();
  return /drive|document|file|resume|cover letter/.test(lower);
}

function looksLikeContactQuery(text) {
  const lower = text.toLowerCase();
  return /recruiter|contact|email address|who to|reach out|connect with/.test(lower);
}

async function safeFetch(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[mcp] ${label} failed:`, err.message);
    return null;
  }
}

/**
 * Try to extract a structured job listing array from an MCP tool response.
 * Handles JSON responses from Indeed/ZipRecruiter; returns [] on failure.
 */
function parseJobListings(toolResult) {
  const raw = extractText(toolResult);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : (parsed.jobs ?? parsed.results ?? parsed.data ?? []);
    return arr.slice(0, 10).map((j, i) => ({
      index: i + 1,
      title: j.title ?? j.job_title ?? j.name ?? "Unknown Role",
      company: j.company ?? j.employer_name ?? j.organization ?? "Unknown Company",
      url: j.url ?? j.job_url ?? j.link ?? j.apply_url ?? "",
      atsType: detectAtsType(j.url ?? j.job_url ?? j.link ?? j.apply_url ?? ""),
      location: j.location ?? j.city ?? "",
    }));
  } catch {
    return [];
  }
}

/**
 * Fetches live context from all connected services relevant to the user's query.
 * Returns { text, jobListings } — text is injected into the LLM prompt,
 * jobListings is stored in session so the user can "apply to 1,3".
 */
export async function fetchMcpContext(userKey, query) {
  const parts = [];
  let jobListings = [];

  const tokens = userKey && userKey !== "unknown" ? getTokens(userKey) : {};
  const googleToken =
    tokens.google ? await getValidGoogleToken(userKey, tokens.google) : null;

  // ── Job search (ZipRecruiter always-on + Indeed if connected) ────────────────
  const { text: jobText, listings } = await fetchJobContext(
    query,
    tokens.indeed?.access_token ?? null,
  );
  if (jobText) parts.push(jobText);
  jobListings = listings;

  // ── Gmail ────────────────────────────────────────────────────────────────────
  if (googleToken && looksLikeEmailQuery(query)) {
    const emails = await safeFetch("gmail", () =>
      callTool(MCP_URLS.gmail, googleToken, "search_emails", {
        query: "internship OR interview OR offer OR application",
        max_results: 5,
      }),
    );
    const text = extractText(emails);
    if (text) parts.push(`Recent relevant emails:\n${text}`);
  }

  // ── Google Calendar ──────────────────────────────────────────────────────────
  if (googleToken && looksLikeCalendarQuery(query)) {
    const events = await safeFetch("calendar", () =>
      callTool(MCP_URLS.googleCalendar, googleToken, "list_events", {
        time_min: new Date().toISOString(),
        max_results: 5,
      }),
    );
    const text = extractText(events);
    if (text) parts.push(`Upcoming calendar events:\n${text}`);
  }

  // ── Google Drive ─────────────────────────────────────────────────────────────
  if (googleToken && looksLikeDriveQuery(query)) {
    const files = await safeFetch("drive", () =>
      callTool(MCP_URLS.googleDrive, googleToken, "list_recent_files", { max_results: 5 }),
    );
    const text = extractText(files);
    if (text) parts.push(`Recent Drive files:\n${text}`);
  }

  // ── Notion ───────────────────────────────────────────────────────────────────
  if (tokens.notion?.access_token) {
    const notionCtx = await safeFetch("notion", () =>
      callTool(MCP_URLS.notion, tokens.notion.access_token, "search", {
        query: query.slice(0, 100),
      }),
    );
    const text = extractText(notionCtx);
    if (text) parts.push(`Notion tracker:\n${text}`);
  }

  // ── Apollo (recruiter contacts) ───────────────────────────────────────────────
  if (tokens.apollo?.api_key && looksLikeContactQuery(query)) {
    const people = await safeFetch("apollo", () =>
      callTool(MCP_URLS.apollo, tokens.apollo.api_key, "apollo_search_people", {
        q_keywords: query.slice(0, 80),
        per_page: 3,
      }),
    );
    const text = extractText(people);
    if (text) parts.push(`Recruiter contacts:\n${text}`);
  }

  return { text: parts.join("\n\n"), jobListings };
}

async function fetchJobContext(query, indeedToken) {
  const textParts = [];
  let listings = [];

  const zipResult = await safeFetch("ziprecruiter", () =>
    callTool(MCP_URLS.ziprecruiter, null, "search_jobs", { query, limit: 5 }),
  );
  if (zipResult) {
    const parsed = parseJobListings(zipResult);
    if (parsed.length) {
      listings = parsed;
    } else {
      const text = extractText(zipResult);
      if (text) textParts.push(`ZipRecruiter listings:\n${text}`);
    }
  }

  if (indeedToken) {
    const indeedResult = await safeFetch("indeed", () =>
      callTool(MCP_URLS.indeed, indeedToken, "search_jobs", { q: query, limit: 5 }),
    );
    if (indeedResult) {
      const parsed = parseJobListings(indeedResult);
      if (parsed.length) {
        // Merge, re-index
        listings = [...listings, ...parsed].map((j, i) => ({ ...j, index: i + 1 }));
      } else {
        const text = extractText(indeedResult);
        if (text) textParts.push(`Indeed listings:\n${text}`);
      }
    }
  }

  // Build a numbered listing for the LLM (and user) if we got structured data
  if (listings.length) {
    const numbered = listings
      .map((j) => `${j.index}. ${j.company} — ${j.title}${j.location ? ` (${j.location})` : ""}`)
      .join("\n");
    textParts.unshift(`Job listings:\n${numbered}`);
  }

  return { text: textParts.join("\n\n"), listings };
}
