import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
  const body = (await req.json().catch(() => ({}))) as { confirmation?: string };
  if (body.confirmation !== "RESET") {
    return json({ error: "Explicit reset confirmation is required" }, 400);
  }

  try {
    const { error } = await supabase.rpc("reset_training_account", {
      p_user_id: authData.user.id,
    });
    if (error) throw error;
    return json({ reset: true });
  } catch (error) {
    console.error("reset-account error", error);
    return json(
      { error: "Could not reset your account." },
      500
    );
  }
});
