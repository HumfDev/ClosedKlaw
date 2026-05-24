import { config, isOAuthConfigured, oauthEnvKeys } from "./config.js";
import { setTokens, getTokens } from "./token-store.js";

function assertOAuthConfigured(service) {
  if (isOAuthConfigured(service)) return;
  const keys = oauthEnvKeys(service).join(" and ");
  throw new Error(
    `${service} connector is not configured. Add ${keys} to .env on your Mac, register redirect URI ${config.publicUrl}/oauth/callback/${service} in the provider console, then restart npm start.`,
  );
}

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

// ─── Google ───────────────────────────────────────────────────────────────────

export function googleAuthUrl(userKey) {
  assertOAuthConfigured("google");
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.publicUrl}/oauth/callback/google`,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: encodeURIComponent(userKey),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function googleExchangeCode(code, userKey) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${config.publicUrl}/oauth/callback/google`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google OAuth: ${data.error_description ?? data.error}`);
  setTokens(userKey, "google", {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data;
}

export async function refreshGoogleToken(userKey) {
  const g = getTokens(userKey).google;
  if (!g?.refresh_token) throw new Error("No Google refresh token stored");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: g.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google refresh: ${data.error_description ?? data.error}`);
  const updated = {
    access_token: data.access_token,
    refresh_token: g.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  setTokens(userKey, "google", updated);
  return updated.access_token;
}

// ─── Notion ───────────────────────────────────────────────────────────────────

export function notionAuthUrl(userKey) {
  assertOAuthConfigured("notion");
  const params = new URLSearchParams({
    client_id: config.notionClientId,
    redirect_uri: `${config.publicUrl}/oauth/callback/notion`,
    response_type: "code",
    owner: "user",
    state: encodeURIComponent(userKey),
  });
  return `https://api.notion.com/v1/oauth/authorize?${params}`;
}

export async function notionExchangeCode(code, userKey) {
  const creds = Buffer.from(`${config.notionClientId}:${config.notionClientSecret}`).toString(
    "base64",
  );
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${creds}` },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${config.publicUrl}/oauth/callback/notion`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Notion OAuth: ${data.error}`);
  setTokens(userKey, "notion", { access_token: data.access_token });
  return data;
}

// ─── Indeed ───────────────────────────────────────────────────────────────────

export function indeedAuthUrl(userKey) {
  assertOAuthConfigured("indeed");
  const params = new URLSearchParams({
    client_id: config.indeedClientId,
    redirect_uri: `${config.publicUrl}/oauth/callback/indeed`,
    response_type: "code",
    scope: "jobs_read",
    state: encodeURIComponent(userKey),
  });
  return `https://secure.indeed.com/oauth/v2/authorize?${params}`;
}

export async function indeedExchangeCode(code, userKey) {
  const res = await fetch("https://apis.indeed.com/oauth/v2/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.indeedClientId,
      client_secret: config.indeedClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${config.publicUrl}/oauth/callback/indeed`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Indeed OAuth: ${data.error_description ?? data.error}`);
  setTokens(userKey, "indeed", {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data;
}

// ─── Apollo (API key — no OAuth) ──────────────────────────────────────────────

export function setApolloApiKey(userKey, apiKey) {
  setTokens(userKey, "apollo", { api_key: apiKey });
}
