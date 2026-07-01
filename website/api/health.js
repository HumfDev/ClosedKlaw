import { checkSupabaseHealth } from "../lib/supabase-health.js";

export default async function handler(_req, res) {
  const result = await checkSupabaseHealth({
    supabaseUrl: process.env.SUPABASE_URL?.trim(),
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  });

  res.statusCode = result.ok ? 200 : 503;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(result));
}
