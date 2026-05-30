import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.106.1/+esm";

let clientPromise;

async function loadConfig() {
  const res = await fetch("/api/config");
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "Auth API returned HTML instead of JSON. Restart the site with: cd website && npm run dev",
    );
  }
  const cfg = await res.json();
  if (!res.ok || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error(cfg.error ?? "Auth is not configured on this server.");
  }
  return cfg;
}

/**
 * Supabase client for waitlist Google OAuth (PKCE).
 * @see https://supabase.com/docs/guides/auth/social-login/auth-google
 */
export async function getSupabase() {
  if (!clientPromise) {
    clientPromise = loadConfig().then((cfg) =>
      createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          storage: window.localStorage,
        },
      }),
    );
  }
  return clientPromise;
}
