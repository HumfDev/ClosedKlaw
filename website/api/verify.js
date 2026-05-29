import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }

  const token = req.query?.token;
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!token || !supabaseUrl || !supabaseServiceKey) {
    res.writeHead(302, { Location: "/waitlist.html?error=invalid-token" });
    res.end();
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from("waitlist")
    .update({ verified: true, verification_token: null })
    .eq("verification_token", token)
    .select("email")
    .single();

  if (error || !data) {
    res.writeHead(302, { Location: "/waitlist.html?error=invalid-token" });
    res.end();
    return;
  }

  res.writeHead(302, { Location: "/verify-success.html" });
  res.end();
}
