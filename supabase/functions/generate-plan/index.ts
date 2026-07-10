// Supabase Edge Function: generate-plan
// ----------------------------------------------------------------------------
// Generates a personalized 4-week basketball workout plan using GPT-5,
// constrained to only use exercises from the `exercise_video_clips` catalog.
//
// Deploy with:
//   supabase functions deploy generate-plan
//
// Required secrets (set with `supabase secrets set`):
//   OPENAI_API_KEY
//   OPENAI_MODEL (optional, defaults to "gpt-5")
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatically provided by
// the Edge Function runtime -- do not set them manually.
// ----------------------------------------------------------------------------

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendExpoPushNotification } from "../_shared/expo-push.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced", "elite"];

const DIFFICULTY_ALLOWANCE: Record<string, string[]> = {
  beginner: ["beginner", "intermediate"],
  intermediate: ["beginner", "intermediate", "advanced"],
  advanced: ["intermediate", "advanced"],
  elite: ["advanced", "elite"],
};

const GOAL_CATEGORY_MAP: Record<string, string[]> = {
  "make the team": ["shooting", "ball_handling", "finishing", "defense", "conditioning"],
  "improve shooting": ["shooting"],
  "improve handles": ["ball_handling"],
  "improve finishing": ["finishing"],
  "improve defense": ["defense"],
  "get faster": ["conditioning", "footwork"],
  "improve conditioning": ["conditioning"],
  "become stronger": ["strength"],
  "become an all-around better player": [
    "shooting",
    "ball_handling",
    "finishing",
    "defense",
    "conditioning",
  ],
};

const WEAKNESS_KEYWORD_CATEGORY: Array<[RegExp, string]> = [
  [/shoot/i, "shooting"],
  [/handl|dribbl/i, "ball_handling"],
  [/finish|layup|mikan|floater/i, "finishing"],
  [/defen/i, "defense"],
  [/condition|cardio|stamina|gas/i, "conditioning"],
  [/strength|weak|weight/i, "strength"],
  [/footwork|foot work/i, "footwork"],
  [/mobil|flexib/i, "mobility"],
  [/iq|decision/i, "basketball_iq"],
];

interface OnboardingAnswers {
  id: string;
  user_id: string;
  overall_skill_level: string | null;
  main_goal: string | null;
  position: string | null;
  strengths: string | null;
  weaknesses: string | null;
  shooting_level: string | null;
  ball_handling_level: string | null;
  finishing_level: string | null;
  defense_level: string | null;
  basketball_iq_level: string | null;
  conditioning_level: string | null;
  athleticism_level: string | null;
  strength_level: string | null;
  days_per_week: number | null;
  minutes_per_workout: number | null;
  has_court_access: boolean | null;
  equipment: string[] | null;
  injuries_limitations: string | null;
  preferred_intensity: string | null;
}

interface VideoClip {
  id: string;
  exercise_name: string;
  category: string;
  difficulty_level: string | null;
  description: string | null;
  coaching_notes: string | null;
  source_section: string | null;
}

interface GeneratedExercise {
  order_index: number;
  video_clip_id: string;
  name: string;
  category: string;
  instructions: string;
  sets?: string | null;
  reps?: string | null;
  duration?: string | null;
  target_makes?: number | null;
  target_attempts?: number | null;
  log_type: string;
}

interface GeneratedDay {
  day_number: number;
  title: string;
  focus: string;
  estimated_minutes: number;
  coach_notes: string;
  exercises: GeneratedExercise[];
}

interface GeneratedPlan {
  title: string;
  summary: string;
  duration_weeks: number;
  days_per_week: number;
  days: GeneratedDay[];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function scoreClip(clip: VideoClip, answers: OnboardingAnswers): number {
  let score = 0;

  const goalCategories = GOAL_CATEGORY_MAP[(answers.main_goal ?? "").toLowerCase()] ?? [];
  if (goalCategories.includes(clip.category)) score += 3;

  const weaknessText = (answers.weaknesses ?? "").toLowerCase();
  for (const [regex, category] of WEAKNESS_KEYWORD_CATEGORY) {
    if (regex.test(weaknessText) && clip.category === category) {
      score += 2;
      break;
    }
  }

  const userLevel = (answers.overall_skill_level ?? "beginner").toLowerCase();
  if (clip.difficulty_level === userLevel) score += 1;

  if (!answers.has_court_access) {
    if (["ball_handling", "footwork", "strength", "mobility", "conditioning"].includes(clip.category)) {
      score += 1;
    }
    if (clip.category === "shooting") score -= 1;
  }

  return score;
}

function filterAndRankClips(clips: VideoClip[], answers: OnboardingAnswers, limit = 140): VideoClip[] {
  const level = (answers.overall_skill_level ?? "beginner").toLowerCase();
  const allowedDifficulties = DIFFICULTY_ALLOWANCE[level] ?? DIFFICULTY_ORDER;

  const filtered = clips.filter((c) => {
    if (!c.difficulty_level) return true;
    return allowedDifficulties.includes(c.difficulty_level);
  });

  const pool = filtered.length > 0 ? filtered : clips;

  const ranked = [...pool].sort((a, b) => scoreClip(b, answers) - scoreClip(a, answers));
  return ranked.slice(0, limit);
}

function buildSystemPrompt(): string {
  return `You are an elite basketball performance coach and program designer.

You must only use exercises from the provided exercise catalog.
Every exercise in the plan must include a valid video_clip_id from the catalog.
Do not invent exercise names.
Do not invent YouTube URLs.
Do not invent video IDs.
Return strict JSON only. Do not include markdown, backticks, or any commentary outside the JSON object.

Follow these rules:
- Generate a 4-week basketball training plan (duration_weeks should be 4 unless the user's schedule clearly calls for something else).
- Use the user's "days_per_week" answer for how many training days appear per week.
- Personalize heavily based on skill level, goal, position, strengths, weaknesses, equipment, court access, injuries, and preferred intensity.
- Beginner users should mostly receive beginner-difficulty clips with a few intermediate progressions. Intermediate users can receive beginner warmups, intermediate main drills, and occasional advanced challenges. Advanced users can receive intermediate and advanced drills. Elite users can receive advanced and elite drills.
- Never place elite-level clips on Day 1 for a beginner.
- The plan should progress in difficulty over the 4 weeks -- later days/weeks should be harder than earlier ones.
- If the user has no hoop/court access, favor ball handling, footwork, strength, mobility, and conditioning drills over shooting drills.
- Number days sequentially across the whole plan (day_number 1, 2, 3, ... continuing across weeks, not resetting each week).
- Each day must include a warmup, main drills relevant to the day's focus, conditioning, and cooldown where the catalog allows it, plus short "coach_notes" with practical advice for that day.
- Each exercise needs a "log_type" of one of: "checkbox", "makes_attempts", "minutes", "difficulty_rating", "notes". Use "makes_attempts" for shooting drills whenever possible, and set target_makes/target_attempts. Use "minutes" for conditioning drills. Use "checkbox" for simple completion drills. You may combine intents by choosing the single most relevant log_type.

Return JSON matching exactly this shape:
{
  "title": string,
  "summary": string,
  "duration_weeks": number,
  "days_per_week": number,
  "days": [
    {
      "day_number": number,
      "title": string,
      "focus": string,
      "estimated_minutes": number,
      "coach_notes": string,
      "exercises": [
        {
          "order_index": number,
          "video_clip_id": string,
          "name": string,
          "category": string,
          "instructions": string,
          "sets": string | null,
          "reps": string | null,
          "duration": string | null,
          "target_makes": number | null,
          "target_attempts": number | null,
          "log_type": "checkbox" | "makes_attempts" | "minutes" | "difficulty_rating" | "notes"
        }
      ]
    }
  ]
}`;
}

function buildUserPrompt(answers: OnboardingAnswers, clips: VideoClip[]): string {
  const catalog = clips.map((c) => ({
    id: c.id,
    name: c.exercise_name,
    category: c.category,
    difficulty: c.difficulty_level,
    notes: c.coaching_notes ?? c.description ?? undefined,
  }));

  // Strip internal ids before handing the answers to the model -- GPT only
  // needs the actual preferences, not database identifiers.
  const { id: _id, user_id: _userId, ...userPreferences } = answers;

  return JSON.stringify({
    user_preferences: userPreferences,
    exercise_catalog: catalog,
  });
}

function validatePlan(plan: unknown, validClipIds: Set<string>): { valid: true; plan: GeneratedPlan } | { valid: false; error: string } {
  if (!plan || typeof plan !== "object") return { valid: false, error: "Plan is not an object." };
  const p = plan as Record<string, unknown>;

  if (typeof p.title !== "string" || !p.title.trim()) return { valid: false, error: "Missing title." };
  if (typeof p.summary !== "string") return { valid: false, error: "Missing summary." };
  if (typeof p.duration_weeks !== "number") return { valid: false, error: "Missing duration_weeks." };
  if (typeof p.days_per_week !== "number") return { valid: false, error: "Missing days_per_week." };
  if (!Array.isArray(p.days) || p.days.length === 0) return { valid: false, error: "Missing days array." };

  for (const day of p.days as unknown[]) {
    if (!day || typeof day !== "object") return { valid: false, error: "Invalid day entry." };
    const d = day as Record<string, unknown>;
    if (typeof d.day_number !== "number") return { valid: false, error: "Day missing day_number." };
    if (!Array.isArray(d.exercises) || d.exercises.length === 0) {
      return { valid: false, error: `Day ${d.day_number} has no exercises.` };
    }
    for (const ex of d.exercises as unknown[]) {
      if (!ex || typeof ex !== "object") return { valid: false, error: "Invalid exercise entry." };
      const e = ex as Record<string, unknown>;
      if (typeof e.video_clip_id !== "string" || !validClipIds.has(e.video_clip_id)) {
        return {
          valid: false,
          error: `Exercise "${e.name ?? "unknown"}" has an invalid or invented video_clip_id.`,
        };
      }
      if (typeof e.name !== "string" || !e.name.trim()) {
        return { valid: false, error: "Exercise missing name." };
      }
    }
  }

  return { valid: true, plan: p as unknown as GeneratedPlan };
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<unknown> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY secret is not configured.");

  const timeoutMs = 240_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    console.log(`[generate-plan] Calling OpenAI model=${OPENAI_MODEL}, prompt length=${userPrompt.length}`);
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        // gpt-5 is a reasoning model; without capping reasoning effort it can
        // spend minutes "thinking" before producing output, which blows past
        // any reasonable HTTP/edge-function timeout. "low" keeps latency in
        // the ~60-100s range for a full 4-week plan while still producing a
        // coherent, well-structured result.
        reasoning_effort: "low",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenAI request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw new Error(`OpenAI request failed to send: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  console.log(`[generate-plan] OpenAI responded with status ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI response did not include message content.");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("OpenAI response was not valid JSON.");
  }
}

function computeScheduledDate(dayIndexZeroBased: number, daysPerWeek: number): string {
  const week = Math.floor(dayIndexZeroBased / daysPerWeek);
  const dayInWeek = dayIndexZeroBased % daysPerWeek;
  const offsetDays = week * 7 + Math.round((dayInWeek * 7) / Math.max(daysPerWeek, 1));
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function markRequestFailed(supabase: SupabaseClient, requestId: string, message: string) {
  await supabase
    .from("plan_generation_requests")
    .update({ status: "failed", error_message: message.slice(0, 2000) })
    .eq("id", requestId);
}

// Supabase-specific global available in the Edge Function (Deno Deploy)
// runtime. Declared here since it isn't part of the standard Deno types.
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void } | undefined;

/**
 * Does the actual (slow) work: calls OpenAI, validates the plan, and writes
 * everything to Postgres. This runs as a background task via
 * `EdgeRuntime.waitUntil` so the HTTP response to the client can return as
 * soon as the request is marked "generating" -- GPT-5 can legitimately take
 * well over a minute to produce a full 4-week plan, and the client is
 * already polling `plan_generation_requests` for the final status instead
 * of waiting on this response body.
 */
async function runGeneration(
  supabase: SupabaseClient,
  requestId: string,
  userId: string,
  answers: OnboardingAnswers
): Promise<void> {
  try {
    // 5. Load active video clips from exercise_video_clips.
    const { data: allClips, error: clipsError } = await supabase
      .from("exercise_video_clips")
      .select("id, exercise_name, category, difficulty_level, description, coaching_notes, source_section")
      .eq("active", true);

    if (clipsError || !allClips || allClips.length === 0) {
      await markRequestFailed(supabase, requestId, "No active exercise video clips available.");
      return;
    }

    // 6. Filter clips to a reasonable number before sending to GPT (keeps the
    // prompt -- and therefore generation latency -- manageable).
    const rankedClips = filterAndRankClips(allClips as VideoClip[], answers, 90);
    const validClipIds = new Set(rankedClips.map((c) => c.id));

    // 8-11. Call OpenAI, validate JSON. Only retry (once) when GPT actually
    // responded but produced invalid JSON/ids -- never retry after a
    // network/timeout error, since that would just double the risk of
    // running past the background task's own execution budget.
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(answers, rankedClips);

    let validatedPlan: GeneratedPlan | null = null;
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      let raw: unknown;
      try {
        raw = await callOpenAI(
          systemPrompt,
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\nIMPORTANT: Your previous response was invalid (${lastError}). Every video_clip_id MUST exactly match an "id" from exercise_catalog. Return corrected strict JSON only.`
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        break;
      }
      const result = validatePlan(raw, validClipIds);
      if (result.valid) {
        validatedPlan = result.plan;
        break;
      }
      lastError = result.error;
    }

    if (!validatedPlan) {
      await markRequestFailed(supabase, requestId, `Plan generation failed: ${lastError}`);
      return;
    }

    // 12. Mark previous active workout plans as inactive.
    await supabase.from("workout_plans").update({ active: false }).eq("user_id", userId).eq("active", true);

    // 13. Insert the new workout plan.
    const { data: planRow, error: planInsertError } = await supabase
      .from("workout_plans")
      .insert({
        user_id: userId,
        title: validatedPlan.title,
        summary: validatedPlan.summary,
        duration_weeks: validatedPlan.duration_weeks,
        days_per_week: validatedPlan.days_per_week,
        active: true,
      })
      .select()
      .single();

    if (planInsertError || !planRow) {
      await markRequestFailed(supabase, requestId, `Failed to insert workout plan: ${planInsertError?.message}`);
      return;
    }

    // 14-16. Insert workout days + exercises. Unlock Day 1, lock the rest.
    const sortedDays = [...validatedPlan.days].sort((a, b) => a.day_number - b.day_number);
    const daysPerWeek = validatedPlan.days_per_week || answers.days_per_week || 3;

    for (let i = 0; i < sortedDays.length; i++) {
      const day = sortedDays[i];
      const scheduledDate = computeScheduledDate(i, daysPerWeek);

      const { data: dayRow, error: dayInsertError } = await supabase
        .from("workout_days")
        .insert({
          plan_id: planRow.id,
          user_id: userId,
          day_number: day.day_number,
          title: day.title,
          focus: day.focus,
          estimated_minutes: day.estimated_minutes,
          coach_notes: day.coach_notes,
          locked: day.day_number !== 1,
          completed: false,
          scheduled_date: scheduledDate,
        })
        .select()
        .single();

      if (dayInsertError || !dayRow) {
        await markRequestFailed(supabase, requestId, `Failed to insert workout day: ${dayInsertError?.message}`);
        return;
      }

      const exerciseRows = day.exercises.map((ex) => ({
        day_id: dayRow.id,
        user_id: userId,
        video_clip_id: ex.video_clip_id,
        order_index: ex.order_index,
        name: ex.name,
        category: ex.category,
        instructions: ex.instructions,
        sets: ex.sets ?? null,
        reps: ex.reps ?? null,
        duration: ex.duration ?? null,
        target_makes: ex.target_makes ?? null,
        target_attempts: ex.target_attempts ?? null,
        log_type: ex.log_type,
      }));

      const { error: exercisesInsertError } = await supabase.from("workout_exercises").insert(exerciseRows);
      if (exercisesInsertError) {
        await markRequestFailed(supabase, requestId, `Failed to insert workout exercises: ${exercisesInsertError.message}`);
        return;
      }
    }

    // 17-18. Mark the generation request as completed, save completed_at.
    await supabase
      .from("plan_generation_requests")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", requestId);

    // 19. Send an Expo push notification if the user has a push token.
    const { data: profile } = await supabase.from("profiles").select("push_token").eq("id", userId).single();
    if (profile?.push_token) {
      await sendExpoPushNotification(profile.push_token, "HoopPlan", "Your basketball plan is ready 🏀", {
        plan_id: planRow.id,
        screen: "days",
      });
    }

    console.log(`[generate-plan] Completed request ${requestId} -> plan ${planRow.id}`);
  } catch (err) {
    console.error("generate-plan background task error:", err);
    await markRequestFailed(supabase, requestId, err instanceof Error ? err.message : String(err));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Verify the authenticated user from the request.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;

    // 2. Accept a request_id.
    const body = await req.json().catch(() => ({}));
    const requestId: string | undefined = body.request_id;
    if (!requestId) return jsonResponse({ error: "request_id is required" }, 400);

    // 3. Load the matching generation request (must belong to this user).
    const { data: genRequest, error: genRequestError } = await supabase
      .from("plan_generation_requests")
      .select("*")
      .eq("id", requestId)
      .eq("user_id", userId)
      .single();

    if (genRequestError || !genRequest) {
      return jsonResponse({ error: "Generation request not found" }, 404);
    }

    // 4. Load the user's latest onboarding answers.
    const { data: answersRows, error: answersError } = await supabase
      .from("onboarding_answers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (answersError || !answersRows || answersRows.length === 0) {
      await markRequestFailed(supabase, requestId, "No onboarding answers found for user.");
      return jsonResponse({ error: "No onboarding answers found" }, 400);
    }
    const answers = answersRows[0] as OnboardingAnswers;

    // 7. Mark the generation request as "generating".
    await supabase.from("plan_generation_requests").update({ status: "generating" }).eq("id", requestId);

    const backgroundTask = runGeneration(supabase, requestId, userId, answers);

    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(backgroundTask);
    } else {
      // Local `supabase functions serve` doesn't provide EdgeRuntime -- just
      // await it directly so local dev still works end to end.
      await backgroundTask;
    }

    return jsonResponse({ success: true, status: "generating" });
  } catch (err) {
    console.error("generate-plan error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
