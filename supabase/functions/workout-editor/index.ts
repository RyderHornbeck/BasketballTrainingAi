import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const MODEL = Deno.env.get("OPENAI_WORKOUT_EDITOR_MODEL") ?? "gpt-4.1-mini";
const DAILY_LIMIT = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function userDayStart(timezoneOffsetMinutes: number): string {
  const safeOffset = Number.isFinite(timezoneOffsetMinutes) ? timezoneOffsetMinutes : 0;
  const localNow = new Date(Date.now() - safeOffset * 60_000);
  localNow.setUTCHours(0, 0, 0, 0);
  return new Date(localNow.getTime() + safeOffset * 60_000).toISOString();
}

function prescription(clip: any) {
  const text = `${clip.description ?? ""} ${clip.coaching_notes ?? ""}`;
  const durationMatch = text.match(/(\d+)\s*(?:to\s*\d+\s*)?(second|minute)/i);
  const duration = durationMatch
    ? durationMatch[2].toLowerCase().startsWith("second")
      ? `${Math.max(0.5, Number(durationMatch[1]) / 60)} min`
      : `${Math.max(0.5, Number(durationMatch[1]))} min`
    : "3 min";
  const shooting = clip.category === "shooting";
  const finishing = clip.category === "finishing";
  return {
    sets: "2",
    reps: null,
    duration,
    target_makes: shooting ? 10 : finishing ? 8 : null,
    target_attempts: shooting ? 20 : finishing ? 15 : null,
    log_type: shooting || finishing
      ? "makes_attempts"
      : durationMatch
        ? "minutes"
        : "checkbox",
    set_side_labels: clip.requires_both_sides ? ["left side", "right side"] : null,
  };
}

function candidateScore(clip: any, requestText: string): number {
  const tokens = requestText.toLowerCase().split(/\W+/).filter((token) => token.length > 2);
  if (!tokens.length) return 1;
  const name = String(clip.exercise_name ?? "").toLowerCase();
  const text = [
    name,
    clip.category,
    clip.description,
    clip.coaching_notes,
    clip.difficulty_level,
    clip.source_section,
    ...(clip.goals ?? []),
    ...(clip.weaknesses ?? []),
  ].join(" ").toLowerCase();
  return tokens.reduce((score, token) => {
    if (name.includes(token)) return score + 8;
    if (text.includes(token)) return score + 2;
    return score;
  }, 0);
}

async function refreshEstimate(supabase: any, userId: string, dayId: string) {
  const { data: exercises } = await supabase
    .from("workout_exercises")
    .select("sets, duration")
    .eq("day_id", dayId)
    .eq("user_id", userId);
  const activeMinutes = (exercises ?? []).reduce((sum: number, exercise: any) => {
    const sets = Math.max(1, Number.parseInt(exercise.sets ?? "1", 10) || 1);
    const duration = String(exercise.duration ?? "").match(/(\d+(?:\.\d+)?)\s*min/i);
    return sum + (duration ? Number.parseFloat(duration[1]) : 3) * sets;
  }, 0);
  const estimatedMinutes = Math.max(
    5,
    Math.round(activeMinutes + 5 + (exercises?.length ?? 0) * 1.5)
  );
  await supabase
    .from("workout_days")
    .update({ estimated_minutes: estimatedMinutes })
    .eq("id", dayId)
    .eq("user_id", userId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
  const userId = authData.user.id;

  try {
    const body = await req.json() as {
      day_id?: string;
      message?: string;
      request_id?: string;
      timezone_offset_minutes?: number;
    };
    const dayId = body.day_id;
    const message = body.message?.trim();
    if (!dayId || !message || !body.request_id) {
      return json({ error: "day_id, message, and request_id are required" }, 400);
    }
    if (message.length > 1200) return json({ error: "Message is too long" }, 400);

    const { data: day } = await supabase
      .from("workout_days")
      .select("id, title, completed")
      .eq("id", dayId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!day) return json({ error: "Workout not found" }, 404);
    const { count } = await supabase
      .from("workout_edit_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", userDayStart(Number(body.timezone_offset_minutes ?? 0)));
    if ((count ?? 0) >= DAILY_LIMIT) {
      return json({ error: "Daily workout editor limit reached", code: "daily_limit" }, 429);
    }

    const { data: existingRequest } = await supabase
      .from("workout_edit_messages")
      .select("id")
      .eq("user_id", userId)
      .eq("request_id", body.request_id)
      .maybeSingle();
    if (existingRequest) return json({ error: "This request was already processed" }, 409);

    await supabase.from("workout_edit_messages").insert({
      user_id: userId,
      day_id: dayId,
      role: "user",
      content: message,
      request_id: body.request_id,
    });

    const [{ data: currentExercises }, { data: catalog }, { data: history }] = await Promise.all([
      supabase
        .from("workout_exercises")
        .select("id, video_clip_id, order_index, name, category, instructions, sets, duration")
        .eq("day_id", dayId)
        .eq("user_id", userId)
        .order("order_index"),
      supabase
        .from("exercise_video_clips")
        .select("id, exercise_name, category, difficulty_level, description, coaching_notes, requires_both_sides, goals, weaknesses, source_section")
        .eq("active", true),
      supabase
        .from("workout_edit_messages")
        .select("role, content")
        .eq("day_id", dayId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(16),
    ]);

    const candidates = [...(catalog ?? [])]
      .map((clip) => ({ ...clip, score: candidateScore(clip, message) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 80)
      .map(({ score: _score, ...clip }) => clip);

    const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": userId,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You edit one basketball workout. Return JSON only: {\"reply\":string,\"operations\":[{\"type\":\"add\",\"clip_id\":string}|{\"type\":\"remove\",\"exercise_id\":string}]}. Use only IDs supplied below. Make the smallest changes that satisfy the athlete. Never remove every exercise. Explain the completed changes briefly in reply.",
          },
          ...[...(history ?? [])].reverse().map((entry) => ({
            role: entry.role,
            content: entry.content,
          })),
          {
            role: "user",
            content: JSON.stringify({
              request: message,
              current_exercises: currentExercises ?? [],
              available_catalog_exercises: candidates,
            }),
          },
        ],
        max_completion_tokens: 700,
      }),
    });
    if (!openAIResponse.ok) {
      throw new Error(`OpenAI request failed (${openAIResponse.status})`);
    }
    const completion = await openAIResponse.json();
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}") as {
      reply?: string;
      operations?: Array<{ type?: string; clip_id?: string; exercise_id?: string }>;
    };

    const currentIds = new Set((currentExercises ?? []).map((exercise) => exercise.id));
    const existingClipIds = new Set(
      (currentExercises ?? []).map((exercise) => exercise.video_clip_id).filter(Boolean)
    );
    const candidateById = new Map(candidates.map((clip) => [clip.id, clip]));
    let orderIndex = Math.max(
      0,
      ...(currentExercises ?? []).map((exercise) => exercise.order_index ?? 0)
    );
    const changes: string[] = [];

    for (const operation of parsed.operations ?? []) {
      if (operation.type === "remove" && operation.exercise_id && currentIds.has(operation.exercise_id)) {
        if ((currentExercises?.length ?? 0) - changes.filter((change) => change.startsWith("Removed")).length <= 1) {
          continue;
        }
        const exercise = currentExercises?.find((item) => item.id === operation.exercise_id);
        const { error } = await supabase
          .from("workout_exercises")
          .delete()
          .eq("id", operation.exercise_id)
          .eq("day_id", dayId)
          .eq("user_id", userId);
        if (!error) changes.push(`Removed ${exercise?.name ?? "exercise"}`);
      }
      if (operation.type === "add" && operation.clip_id && candidateById.has(operation.clip_id)) {
        if (existingClipIds.has(operation.clip_id)) continue;
        const clip = candidateById.get(operation.clip_id)!;
        orderIndex += 1;
        const { error } = await supabase.from("workout_exercises").insert({
          day_id: dayId,
          user_id: userId,
          video_clip_id: clip.id,
          order_index: orderIndex,
          name: clip.exercise_name,
          category: clip.category,
          instructions: clip.description ?? clip.coaching_notes,
          ...prescription(clip),
        });
        if (!error) {
          existingClipIds.add(operation.clip_id);
          changes.push(`Added ${clip.exercise_name}`);
        }
      }
    }

    if (changes.length) await refreshEstimate(supabase, userId, dayId);
    const reply = parsed.reply?.trim() || (changes.length ? changes.join(". ") : "I did not make any changes.");
    await supabase.from("workout_edit_messages").insert({
      user_id: userId,
      day_id: dayId,
      role: "assistant",
      content: reply,
    });

    return json({
      reply,
      changes,
      remaining_messages: Math.max(0, DAILY_LIMIT - (count ?? 0) - 1),
    });
  } catch (error) {
    console.error("workout-editor error", error);
    return json({ error: error instanceof Error ? error.message : "Workout editor failed" }, 500);
  }
});
