import { getKleoPhone } from "../lib/kleo-phone.js";

export default function handler(_req, res) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const kleoPhone = getKleoPhone();

  if (!supabaseUrl || !supabaseAnonKey) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Auth not configured." }));
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end(
    JSON.stringify({
      ok: true,
      supabaseUrl,
      supabaseAnonKey,
      kleoPhone: kleoPhone || undefined,
    }),
  );
}
