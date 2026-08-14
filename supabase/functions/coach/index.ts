// Supabase Edge Function: coach
// ----------------------------------------------------------------------------
// Real-time AI voice basketball coach.
//
// Pipeline per request:
//   1. (optional) Transcribe the user's recorded audio with OpenAI STT.
//   2. Build fresh workout context from Postgres (today's day, drills, logs,
//      stats, user profile) plus the client-provided timer state.
//   3. Run a fast GPT chat completion with tool calling. DB tools (saving
//      results, completing/skipping drills, finishing the workout, extending
//      time) execute here with the service role; timer tools are returned to
//      the client as actions.
//   4. Synthesize the final reply with ElevenLabs (low-latency turbo model)
//      and return base64 MP3 plus the text and any client actions.
//
// Deploy with:
//   supabase functions deploy coach
//
// Required secrets:
//   OPENAI_API_KEY
//   ELEVENLABS_API_KEY
//   ELEVENLABS_VOICE_ID   (optional, defaults to Rachel)
//   OPENAI_COACH_MODEL    (optional, defaults to "gpt-4o-mini" for speed)
//   OPENAI_TRANSCRIBE_MODEL (optional, defaults to "gpt-4o-mini-transcribe")
// ----------------------------------------------------------------------------

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  aiDataConsentRequiredBody,
  hasCurrentAIDataConsent,
} from "../_shared/aiDataConsent.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const COACH_MODEL = Deno.env.get("OPENAI_COACH_MODEL") ?? "gpt-4o-mini";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") ??
  "gpt-4o-mini-transcribe";
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
const ELEVENLABS_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") ??
  "21m00Tcm4TlvDq8ikWAM";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface TimerState {
  running: boolean;
  elapsed_seconds: number;
}

interface CoachRequest {
  day_id: string;
  audio_base64?: string;
  audio_mime?: string;
  text?: string;
  conversation?: ConversationMessage[];
  timer?: TimerState;
}

interface ClientAction {
  type: "start_timer" | "pause_timer" | "resume_timer";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

async function transcribeAudio(
  audioBase64: string,
  mime: string,
): Promise<string> {
  const bytes = base64ToBytes(audioBase64);
  const ext = mime.includes("wav")
    ? "wav"
    : mime.includes("mp3")
    ? "mp3"
    : "m4a";

  const form = new FormData();
  form.append(
    "file",
    new File([bytes.buffer as ArrayBuffer], `speech.${ext}`, { type: mime }),
  );
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "en");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Transcription failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  return (data.text ?? "").trim();
}

// ---------------------------------------------------------------------------
// Workout context
// ---------------------------------------------------------------------------

interface ExerciseRow {
  id: string;
  order_index: number | null;
  name: string | null;
  category: string | null;
  instructions: string | null;
  sets: string | null;
  reps: string | null;
  duration: string | null;
  target_makes: number | null;
  target_attempts: number | null;
  log_type: string | null;
}

interface LogRow {
  exercise_id: string;
  completed: boolean;
  makes: number | null;
  attempts: number | null;
  minutes_completed: number | null;
  difficulty: number | null;
  notes: string | null;
}

interface WorkoutContext {
  day: {
    id: string;
    title: string | null;
    focus: string | null;
    estimated_minutes: number | null;
    coach_notes: string | null;
    completed: boolean;
  };
  exercises: ExerciseRow[];
  logs: Map<string, LogRow>;
}

async function loadWorkoutContext(
  supabase: SupabaseClient,
  userId: string,
  dayId: string,
): Promise<WorkoutContext | null> {
  const { data: day } = await supabase
    .from("workout_days")
    .select(
      "id, title, focus, estimated_minutes, coach_notes, completed, user_id",
    )
    .eq("id", dayId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!day) return null;

  const { data: exercises } = await supabase
    .from("workout_exercises")
    .select(
      "id, order_index, name, category, instructions, sets, reps, duration, target_makes, target_attempts, log_type",
    )
    .eq("day_id", dayId)
    .order("order_index", { ascending: true });

  const exerciseIds = (exercises ?? []).map((e: ExerciseRow) => e.id);
  const logs = new Map<string, LogRow>();

  if (exerciseIds.length > 0) {
    const { data: logRows } = await supabase
      .from("exercise_logs")
      .select(
        "exercise_id, completed, makes, attempts, minutes_completed, difficulty, notes",
      )
      .in("exercise_id", exerciseIds);
    for (const log of (logRows ?? []) as LogRow[]) {
      logs.set(log.exercise_id, log);
    }
  }

  return {
    day: day as WorkoutContext["day"],
    exercises: (exercises ?? []) as ExerciseRow[],
    logs,
  };
}

function buildContextSummary(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer: TimerState | undefined,
): string {
  const drills = ctx.exercises.map((ex) => {
    const log = ctx.logs.get(ex.id);
    return {
      exercise_id: ex.id,
      name: ex.name,
      category: ex.category,
      instructions: ex.instructions,
      sets: ex.sets,
      reps: ex.reps,
      duration: ex.duration,
      target_makes: ex.target_makes,
      target_attempts: ex.target_attempts,
      log_type: ex.log_type,
      completed: log?.completed ?? false,
      logged_makes: log?.makes ?? null,
      logged_attempts: log?.attempts ?? null,
      notes: log?.notes ?? null,
    };
  });

  const current = drills.find((d) => !d.completed) ?? null;
  const completedCount = drills.filter((d) => d.completed).length;

  let totalMakes = 0;
  let totalAttempts = 0;
  for (const d of drills) {
    if (d.logged_makes != null) totalMakes += d.logged_makes;
    if (d.logged_attempts != null) totalAttempts += d.logged_attempts;
  }

  return JSON.stringify({
    workout_day: {
      title: ctx.day.title,
      focus: ctx.day.focus,
      coach_notes: ctx.day.coach_notes,
      day_completed: ctx.day.completed,
    },
    drills,
    current_drill: current
      ? { exercise_id: current.exercise_id, name: current.name }
      : null,
    progress: {
      completed_drills: completedCount,
      total_drills: drills.length,
      total_makes_today: totalMakes,
      total_attempts_today: totalAttempts,
      shooting_pct_today: totalAttempts > 0
        ? Math.round((totalMakes / totalAttempts) * 100)
        : null,
    },
    timer: {
      running: timer?.running ?? false,
    },
    athlete_profile: profile,
  });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    type: "function",
    function: {
      name: "save_shooting_results",
      description:
        "Save makes and attempts for a shooting drill after the user reports results (e.g. 'I made 7 out of 10').",
      parameters: {
        type: "object",
        properties: {
          exercise_id: {
            type: "string",
            description: "The drill's exercise_id from context",
          },
          makes: { type: "number" },
          attempts: { type: "number" },
          completed: {
            type: "boolean",
            description:
              "True if this set finishes the drill (target reached or user is done with it)",
          },
        },
        required: ["exercise_id", "makes", "attempts"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_drill",
      description: "Mark a drill complete when the user says they finished it.",
      parameters: {
        type: "object",
        properties: { exercise_id: { type: "string" } },
        required: ["exercise_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "uncomplete_drill",
      description:
        "Mark a completed drill as not done when the user wants to redo it or accidentally marked it complete.",
      parameters: {
        type: "object",
        properties: { exercise_id: { type: "string" } },
        required: ["exercise_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skip_drill",
      description:
        "Skip the current drill and move on when the user asks to skip.",
      parameters: {
        type: "object",
        properties: {
          exercise_id: { type: "string" },
          reason: {
            type: "string",
            description: "Short reason, e.g. 'user tired'",
          },
        },
        required: ["exercise_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_note",
      description:
        "Attach a note to a drill when the user says something worth remembering.",
      parameters: {
        type: "object",
        properties: {
          exercise_id: { type: "string" },
          note: { type: "string" },
        },
        required: ["exercise_id", "note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_timer",
      description: "Start the workout timer.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_timer",
      description: "Pause the workout timer.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "resume_timer",
      description: "Resume the workout timer.",
      parameters: { type: "object", properties: {} },
    },
  },
];

interface ToolOutcome {
  result: string;
  dbChanged: boolean;
  clientAction?: ClientAction;
}

async function executeTool(
  supabase: SupabaseClient,
  userId: string,
  dayId: string,
  ctx: WorkoutContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const validExercise = (id: unknown): string | null =>
    typeof id === "string" && ctx.exercises.some((e) => e.id === id)
      ? id
      : null;

  switch (name) {
    case "save_shooting_results": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) {
        return { result: "Error: unknown exercise_id", dbChanged: false };
      }
      const makes = Number(args.makes ?? 0);
      const attempts = Number(args.attempts ?? 0);
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      const completed = typeof args.completed === "boolean"
        ? args.completed
        : ex?.target_makes != null
        ? makes >= ex.target_makes
        : false;

      const { error } = await supabase.from("exercise_logs").upsert(
        {
          exercise_id: exerciseId,
          day_id: dayId,
          user_id: userId,
          completed: completed || (existing?.completed ?? false),
          makes,
          attempts,
          minutes_completed: existing?.minutes_completed ?? null,
          difficulty: existing?.difficulty ?? null,
          notes: existing?.notes ?? null,
        },
        { onConflict: "exercise_id" },
      );
      if (error) {
        return { result: `Error saving: ${error.message}`, dbChanged: false };
      }
      const pct = attempts > 0 ? Math.round((makes / attempts) * 100) : 0;
      return {
        result:
          `Saved ${makes}/${attempts} (${pct}%). Drill completed: ${completed}.`,
        dbChanged: true,
      };
    }

    case "complete_drill":
    case "skip_drill": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) {
        return { result: "Error: unknown exercise_id", dbChanged: false };
      }
      const existing = ctx.logs.get(exerciseId);
      const skipNote = name === "skip_drill"
        ? `Skipped${
          typeof args.reason === "string" && args.reason
            ? `: ${args.reason}`
            : ""
        }`
        : null;
      const { error } = await supabase.from("exercise_logs").upsert(
        {
          exercise_id: exerciseId,
          day_id: dayId,
          user_id: userId,
          completed: true,
          makes: existing?.makes ?? null,
          attempts: existing?.attempts ?? null,
          minutes_completed: existing?.minutes_completed ?? null,
          difficulty: existing?.difficulty ?? null,
          notes: skipNote ?? existing?.notes ?? null,
        },
        { onConflict: "exercise_id" },
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      const idx = ctx.exercises.findIndex((e) => e.id === exerciseId);
      const next = ctx.exercises
        .slice(idx + 1)
        .find((e) => !(ctx.logs.get(e.id)?.completed ?? false));
      return {
        result: `${
          name === "skip_drill" ? "Skipped" : "Completed"
        }. Next drill: ${next?.name ?? "none — workout drills all done"}.`,
        dbChanged: true,
      };
    }

    case "uncomplete_drill": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) {
        return { result: "Error: unknown exercise_id", dbChanged: false };
      }
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);

      const { error } = await supabase.from("exercise_logs").upsert(
        {
          exercise_id: exerciseId,
          day_id: dayId,
          user_id: userId,
          completed: false,
          makes: existing?.makes ?? null,
          attempts: existing?.attempts ?? null,
          minutes_completed: existing?.minutes_completed ?? null,
          difficulty: existing?.difficulty ?? null,
          notes: existing?.notes ?? null,
        },
        { onConflict: "exercise_id" },
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };

      // If the whole day was marked finished, reopen it so they can keep going.
      if (ctx.day.completed) {
        await supabase
          .from("workout_days")
          .update({ completed: false })
          .eq("id", dayId)
          .eq("user_id", userId);
        ctx.day.completed = false;
      }

      return {
        result: `Marked "${
          ex?.name ?? "drill"
        }" as not complete. You can run it again.`,
        dbChanged: true,
      };
    }

    case "save_note": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) {
        return { result: "Error: unknown exercise_id", dbChanged: false };
      }
      const existing = ctx.logs.get(exerciseId);
      const note = String(args.note ?? "").slice(0, 500);
      const merged = existing?.notes ? `${existing.notes}\n${note}` : note;
      const { error } = await supabase.from("exercise_logs").upsert(
        {
          exercise_id: exerciseId,
          day_id: dayId,
          user_id: userId,
          completed: existing?.completed ?? false,
          makes: existing?.makes ?? null,
          attempts: existing?.attempts ?? null,
          minutes_completed: existing?.minutes_completed ?? null,
          difficulty: existing?.difficulty ?? null,
          notes: merged,
        },
        { onConflict: "exercise_id" },
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      return { result: "Note saved.", dbChanged: true };
    }

    case "start_timer":
      return {
        result: "Timer started.",
        dbChanged: false,
        clientAction: { type: "start_timer" },
      };
    case "pause_timer":
      return {
        result: "Timer paused.",
        dbChanged: false,
        clientAction: { type: "pause_timer" },
      };
    case "resume_timer":
      return {
        result: "Timer resumed.",
        dbChanged: false,
        clientAction: { type: "resume_timer" },
      };

    default:
      return { result: `Unknown tool: ${name}`, dbChanged: false };
  }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  `You are an experienced basketball shooting coach speaking into the athlete's earbud during a live workout. You are calm, confident, positive, focused, and direct.

Rules:
- Your replies are spoken aloud. Keep them SHORT: 1-3 sentences, under ~35 words, unless the athlete explicitly asks for a detailed explanation.
- Sound like a real trainer courtside, never robotic or overly enthusiastic. No emojis, no markdown, no lists.
- You know the full workout from the context JSON: every drill, what's done, current stats, remaining time, and the athlete's profile. Never ask for information you already have.
- When the athlete reports results ("I made 8 out of 10"), call save_shooting_results, then react with the percentage and a quick push.
- When they finish or want to skip a drill, call complete_drill or skip_drill and tell them what's next.
- When they want to redo a drill or say they marked one complete by mistake, call uncomplete_drill.
- Use start_timer/pause_timer/resume_timer when they mention the timer or starting/pausing the workout.
- You do not know the workout's total duration, time remaining, or elapsed workout time. Discuss time only for a specific drill or active drill timer.
- Reference their actual numbers when encouraging: improvement, streaks, percentages.
- If they're tired, ease off: suggest a breather, a lighter drill, or shortening the session.
- Numbers in speech should be natural ("seventy percent", "eight of ten" is fine as "8 of 10").`;

interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

async function chatCompletion(
  messages: ChatMessage[],
  useTools: boolean,
): Promise<{
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: COACH_MODEL,
      messages,
      max_completion_tokens: 300,
      ...(useTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Chat completion failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map(
    (tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }),
  );

  return { content: message?.content ?? null, toolCalls };
}

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

async function synthesizeSpeech(text: string): Promise<string | null> {
  if (!ELEVENLABS_API_KEY) return null;
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_64`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: 1.05,
          },
        }),
      },
    );
    if (!res.ok) {
      console.error(
        `ElevenLabs TTS failed (${res.status}): ${
          (await res.text()).slice(0, 200)
        }`,
      );
      return null;
    }
    return bytesToBase64(await res.arrayBuffer());
  } catch (err) {
    console.error("ElevenLabs TTS error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(
      jwt,
    );
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;
    if (!(await hasCurrentAIDataConsent(supabase, userId))) {
      return jsonResponse(aiDataConsentRequiredBody(), 403);
    }

    const body = (await req.json().catch(() => ({}))) as CoachRequest;
    if (!body.day_id) return jsonResponse({ error: "day_id is required" }, 400);
    if (body.day_id.length > 64) {
      return jsonResponse({ error: "Invalid day_id" }, 400);
    }
    if ((body.text?.length ?? 0) > 4_000) {
      return jsonResponse({ error: "Text is too long" }, 413);
    }
    if ((body.audio_base64?.length ?? 0) > 20_000_000) {
      return jsonResponse({ error: "Audio payload is too large" }, 413);
    }
    if ((body.conversation?.length ?? 0) > 32) {
      return jsonResponse({ error: "Conversation is too large" }, 413);
    }

    const ctx = await loadWorkoutContext(supabase, userId, body.day_id);
    if (!ctx) return jsonResponse({ error: "Workout day not found" }, 404);
    const { data: reservationRows, error: reservationError } = await supabase
      .rpc(
        "reserve_coach_session_usage",
        {
          p_user_id: userId,
          p_session_key: `legacy-${crypto.randomUUID()}`,
          p_day_id: body.day_id,
          p_model: COACH_MODEL,
          p_reservation_usd: 0.01,
        },
      );
    if (reservationError) throw reservationError;
    const reservation = Array.isArray(reservationRows)
      ? reservationRows[0]
      : reservationRows;
    if (!reservation?.allowed) {
      return jsonResponse({
        error: "Daily coach credit is used up.",
        code: "daily_budget_exhausted",
      }, 429);
    }

    // 1. Get the user's words: either raw text or transcribed audio.
    let userText = (body.text ?? "").trim();
    if (!userText && body.audio_base64) {
      userText = await transcribeAudio(
        body.audio_base64,
        body.audio_mime ?? "audio/mp4",
      );
    }
    if (!userText) {
      return jsonResponse({
        transcript: "",
        reply: null,
        audio_base64: null,
        actions: [],
        db_changed: false,
      });
    }

    // 2. Fresh athlete profile.
    const { data: answers } = await supabase
      .from("onboarding_answers")
      .select(
        "overall_skill_level, main_goal, position, strengths, weaknesses, preferred_intensity, minutes_per_workout",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const contextJson = buildContextSummary(ctx, answers ?? null, body.timer);

    // 3. Build the conversation and run the tool loop.
    const history = (body.conversation ?? []).slice(-16).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 4_000),
    }));

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `Current workout context:\n${contextJson}` },
      ...history,
      { role: "user", content: userText },
    ];

    const actions: ClientAction[] = [];
    let dbChanged = false;
    let reply: string | null = null;

    for (let round = 0; round < 4; round++) {
      const { content, toolCalls } = await chatCompletion(messages, round < 3);

      if (toolCalls.length === 0) {
        reply = content;
        break;
      }

      messages.push({
        role: "assistant",
        content: content,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments || "{}");
        } catch {
          // fall through with empty args; the tool will report the error
        }
        const outcome = await executeTool(
          supabase,
          userId,
          body.day_id,
          ctx,
          tc.name,
          args,
        );
        if (outcome.dbChanged) dbChanged = true;
        if (outcome.clientAction) actions.push(outcome.clientAction);
        messages.push({
          role: "tool",
          content: outcome.result,
          tool_call_id: tc.id,
        });
      }

      // Refresh context after DB writes so follow-up rounds see new state.
      if (dbChanged) {
        const freshCtx = await loadWorkoutContext(
          supabase,
          userId,
          body.day_id,
        );
        if (freshCtx) {
          ctx.logs = freshCtx.logs;
          ctx.day = freshCtx.day;
        }
      }
    }

    if (!reply) {
      reply = "Got it.";
    }

    // 4. Speak it.
    const audioBase64 = await synthesizeSpeech(reply);

    return jsonResponse({
      transcript: userText,
      reply,
      audio_base64: audioBase64,
      actions,
      db_changed: dbChanged,
    });
  } catch (err) {
    console.error("coach error:", err);
    return jsonResponse({ error: "Coach request failed" }, 500);
  }
});
