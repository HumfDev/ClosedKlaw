import { createClient } from "@supabase/supabase-js";

export async function checkSupabaseHealth({ supabaseUrl, supabaseServiceKey }) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      ok: false,
      connected: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase.from("waitlist").select("id", { head: true, count: "exact" });

    if (error) {
      return {
        ok: false,
        connected: false,
        projectUrl: supabaseUrl,
        error: error.message,
      };
    }

    return {
      ok: true,
      connected: true,
      projectUrl: supabaseUrl,
      waitlistTable: "ok",
    };
  } catch (err) {
    return {
      ok: false,
      connected: false,
      projectUrl: supabaseUrl,
      error: err?.message ?? "Supabase health check failed.",
    };
  }
}
