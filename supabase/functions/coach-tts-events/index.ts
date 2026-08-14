import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SAFE_EVENT = /^inworld_tts_[a-z_]{3,64}$/;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData?.user) return jsonResponse({ error: "Invalid session" }, 401);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const dayId = typeof body?.day_id === "string" ? body.day_id : "";
  const sessionKey = typeof body?.session_key === "string" ? body.session_key : "";
  const events = Array.isArray(body?.events) ? body.events : [];
  if (!dayId || dayId.length > 64 || sessionKey.length < 16 || sessionKey.length > 128 ||
    events.length === 0 || events.length > 50) {
    return jsonResponse({ error: "Invalid TTS event batch" }, 400);
  }
  const userId = userData.user.id;
  const { data: session } = await supabase
    .from("coach_sessions")
    .select("id, day_id")
    .eq("session_key", sessionKey)
    .eq("user_id", userId)
    .maybeSingle();
  if (!session || session.day_id !== dayId) {
    return jsonResponse({ error: "Coach session was not found" }, 404);
  }

  const rows = events.map((event) => {
    const raw = event as Record<string, unknown>;
    const eventType = typeof raw.event_type === "string" ? raw.event_type : "";
    const requestId = typeof raw.provider_request_id === "string"
      ? raw.provider_request_id.slice(0, 160)
      : null;
    const details = raw.details && typeof raw.details === "object" &&
        !Array.isArray(raw.details)
      ? raw.details
      : {};
    if (!SAFE_EVENT.test(eventType) || JSON.stringify(details).length > 2_000) {
      throw new Error("Invalid TTS lifecycle event");
    }
    return {
      session_id: session.id,
      user_id: userId,
      day_id: dayId,
      provider: "inworld_tts",
      event_type: eventType,
      provider_request_id: requestId,
      details,
    };
  });
  try {
    const { error } = await supabase.from("coach_session_events").insert(rows);
    if (error) throw error;
  } catch (error) {
    console.error("coach-tts-events error:", error);
    return jsonResponse({ error: "Could not record TTS events" }, 500);
  }
  return jsonResponse({ recorded: rows.length });
});
