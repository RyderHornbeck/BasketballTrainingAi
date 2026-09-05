import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildWorkoutEditorSnapshot } from "../_shared/workoutEditorContext.ts";
import {
  validateWorkoutEditorOperations,
} from "../_shared/workoutEditorOperations.ts";
import {
  aiDataConsentRequiredBody,
  hasCurrentAIDataConsent,
} from "../_shared/aiDataConsent.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const MODEL = Deno.env.get("OPENAI_WORKOUT_EDITOR_MODEL") ?? "gpt-5.6-terra";
const WORKOUT_MESSAGE_LIMIT = 30;
const DEBUG_EDITOR_TRACE = Deno.env.get("WORKOUT_EDITOR_DEBUG_TRACE") === "true";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function appliedReply(changes: string[], fallback: string): string {
  if (!changes.length) return fallback || "I did not make any changes.";
  return `**Workout updated**\n${changes.map((change) => `- ${change}`).join("\n")}`;
}

async function applyReorders(
  supabase: any,
  userId: string,
  dayId: string,
  exercises: any[],
  operations: Array<{ type?: string; exercise_id?: string; position?: number }>,
) {
  const reorderOperations = operations.filter((operation) =>
    operation.type === "reorder" &&
    operation.exercise_id &&
    Number.isInteger(operation.position) &&
    operation.position! > 0 &&
    exercises.find((exercise) => exercise.id === operation.exercise_id)?.category !== "shooting"
  );
  const reorderedIds = new Set(reorderOperations.map((operation) => operation.exercise_id!));
  const categories = new Set(
    exercises
      .filter((exercise) => reorderedIds.has(exercise.id))
      .map((exercise) => String(exercise.category ?? "")),
  );
  const changes: Array<{ exercise: any; previousOrderIndex: number; nextOrderIndex: number }> = [];

  for (const category of categories) {
    const categoryExercises = exercises
      .filter((exercise) => String(exercise.category ?? "") === category)
      .sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0));
    const originalOrderIndexes = categoryExercises.map((exercise) => Number(exercise.order_index ?? 0));
    for (const operation of reorderOperations) {
      const sourceIndex = categoryExercises.findIndex((exercise) => exercise.id === operation.exercise_id);
      if (sourceIndex < 0) continue;
      const [exercise] = categoryExercises.splice(sourceIndex, 1);
      const targetIndex = Math.min(categoryExercises.length, operation.position! - 1);
      categoryExercises.splice(targetIndex, 0, exercise);
    }
    for (const [index, exercise] of categoryExercises.entries()) {
      const nextOrderIndex = originalOrderIndexes[index];
      const previousOrderIndex = Number(exercise.order_index ?? 0);
      if (previousOrderIndex === nextOrderIndex) continue;
      const { error } = await supabase
        .from("workout_exercises")
        .update({ order_index: nextOrderIndex })
        .eq("id", exercise.id)
        .eq("day_id", dayId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      changes.push({ exercise, previousOrderIndex, nextOrderIndex });
    }
  }
  return changes;
}

function shootingRangeRank(exercise: any): number {
  const text = `${exercise.name ?? ""} ${exercise.instructions ?? ""}`.toLowerCase();
  if (/\b(form|single arm|one arm)\b/.test(text)) return 0;
  if (/\b(close|short|inside|paint|restricted|layup)\b/.test(text)) return 1;
  if (/\b(free throw|foul line)\b/.test(text)) return 2;
  if (/\b(mid[\s-]?range|elbow)\b/.test(text)) return 3;
  if (/\b(three|3[\s-]?(?:point|pt)|corner 3|wing 3|top of key 3)\b/.test(text)) return 5;
  return 4;
}

async function normalizeShootingRangeOrder(
  supabase: any,
  userId: string,
  dayId: string,
  exercises: any[],
) {
  const shooting = exercises
    .filter((exercise) => exercise.category === "shooting")
    .sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0));
  const sorted = [...shooting].sort((a, b) =>
    shootingRangeRank(a) - shootingRangeRank(b) ||
    Number(a.order_index ?? 0) - Number(b.order_index ?? 0)
  );
  const orderIndexes = shooting.map((exercise) => Number(exercise.order_index ?? 0));
  const changes: Array<{ exercise: any; previousOrderIndex: number; nextOrderIndex: number }> = [];

  for (const [index, exercise] of sorted.entries()) {
    const nextOrderIndex = orderIndexes[index];
    const previousOrderIndex = Number(exercise.order_index ?? 0);
    if (previousOrderIndex === nextOrderIndex) continue;
    const { error } = await supabase
      .from("workout_exercises")
      .update({ order_index: nextOrderIndex })
      .eq("id", exercise.id)
      .eq("day_id", dayId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    changes.push({ exercise, previousOrderIndex, nextOrderIndex });
  }
  return changes;
}

function prescription(clip: any) {
  const text = `${clip.description ?? ""} ${clip.coaching_notes ?? ""}`;
  const durationMatch = text.match(/(\d+)\s*(?:to\s*\d+\s*)?(second|minute)/i);
  const categoryIsTimed = ["ball_handling", "defense", "conditioning"].includes(
    clip.category,
  );
  const extractedMinutes = durationMatch
    ? durationMatch[2].toLowerCase().startsWith("second")
      ? `${Math.max(0.5, Number(durationMatch[1]) / 60)} min`
      : `${Math.max(0.5, Number(durationMatch[1]))} min`
    : null;
  const durationMinutes = extractedMinutes
    ? Number.parseFloat(extractedMinutes)
    : null;
  const duration = categoryIsTimed
    ? `${Math.max(1, Math.min(3, durationMinutes ?? 2))} min`
    : extractedMinutes ?? "3 min";
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
      : categoryIsTimed || durationMatch
      ? "minutes"
      : "checkbox",
    set_side_labels: clip.requires_both_sides
      ? ["right side", "left side"]
      : null,
  };
}

function candidateScore(clip: any, requestText: string): number {
  const tokens = requestText.toLowerCase().split(/\W+/).filter((token) =>
    token.length > 2
  );
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

async function loadWorkoutState(supabase: any, userId: string, day: any) {
  const { data: exercises, error: exercisesError } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("day_id", day.id)
    .eq("user_id", userId)
    .order("order_index");
  if (exercisesError) throw new Error(exercisesError.message);

  const exerciseIds = (exercises ?? []).map((exercise: any) => exercise.id);
  let logs: any[] = [];
  if (exerciseIds.length) {
    const { data, error } = await supabase
      .from("exercise_logs")
      .select("*")
      .eq("day_id", day.id)
      .eq("user_id", userId)
      .in("exercise_id", exerciseIds);
    if (error) throw new Error(error.message);
    logs = data ?? [];
  }

  return {
    exercises: exercises ?? [],
    logs,
    snapshot: buildWorkoutEditorSnapshot(day, exercises ?? [], logs),
  };
}

async function refreshEstimate(supabase: any, userId: string, dayId: string) {
  const { data: exercises } = await supabase
    .from("workout_exercises")
    .select("sets, duration")
    .eq("day_id", dayId)
    .eq("user_id", userId);
  const activeMinutes = (exercises ?? []).reduce(
    (sum: number, exercise: any) => {
      const sets = Math.max(1, Number.parseInt(exercise.sets ?? "1", 10) || 1);
      const duration = String(exercise.duration ?? "").match(
        /(\d+(?:\.\d+)?)\s*min/i,
      );
      return sum + (duration ? Number.parseFloat(duration[1]) : 3) * sets;
    },
    0,
  );
  const estimatedMinutes = Math.max(
    5,
    Math.round(activeMinutes + 5 + (exercises?.length ?? 0) * 1.5),
  );
  await supabase
    .from("workout_days")
    .update({ estimated_minutes: estimatedMinutes })
    .eq("id", dayId)
    .eq("user_id", userId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!OPENAI_API_KEY) {
    return json({ error: "OPENAI_API_KEY is not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !authData.user) {
    return json({ error: "Invalid session" }, 401);
  }
  const userId = authData.user.id;

  try {
    const body = await req.json() as {
      action?: "edit" | "undo" | "status";
      day_id?: string;
      message?: string;
      request_id?: string;
      timezone_offset_minutes?: number;
    };
    const dayId = body.day_id;
    const message = body.message?.trim();
    const action = body.action ?? "edit";
    const trace = async (stage: string, payload: Record<string, unknown>) => {
      if (!DEBUG_EDITOR_TRACE || !dayId || !body.request_id) return;
      const entry = {
        user_id: userId,
        day_id: dayId,
        request_id: body.request_id,
        stage,
        payload,
      };
      console.log("[WorkoutEditorTrace]", JSON.stringify(entry));
      await supabase
        .from("workout_editor_debug_traces")
        .insert(entry)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error("workout-editor trace write failed", error.message);
        });
    };
    if (!["edit", "undo", "status"].includes(action)) {
      return json({ error: "Invalid action" }, 400);
    }
    if (!dayId) {
      return json({ error: "day_id is required" }, 400);
    }
    if (dayId.length > 64 || (body.request_id?.length ?? 0) > 200) {
      return json({ error: "Invalid request identifiers" }, 400);
    }
    if (action === "edit" && (!message || !body.request_id)) {
      return json(
        { error: "message and request_id are required for edits" },
        400,
      );
    }
    if (message && message.length > 1200) {
      return json({ error: "Message is too long" }, 400);
    }

    const { data: day } = await supabase
      .from("workout_days")
      .select("id, title, focus, coach_notes, estimated_minutes, completed, active_exercise_id, active_set_number")
      .eq("id", dayId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!day) return json({ error: "Workout not found" }, 404);

    if (action === "status") {
      const [
        { count: undoCount, error: undoError },
        { count: messageCount, error: countError },
      ] = await Promise.all([
        supabase
          .from("workout_edit_revisions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("day_id", dayId)
          .is("undone_at", null),
        supabase
          .from("workout_edit_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("day_id", dayId)
          .eq("role", "user"),
      ]);
      if (undoError) throw undoError;
      if (countError) throw countError;
      return json({
        can_undo: (undoCount ?? 0) > 0,
        remaining_messages: Math.max(
          0,
          WORKOUT_MESSAGE_LIMIT - (messageCount ?? 0),
        ),
      });
    }

    if (action === "undo") {
      const { data: undone, error: undoError } = await supabase.rpc(
        "undo_workout_edit_revision",
        { p_user_id: userId, p_day_id: dayId },
      );
      if (undoError) throw undoError;
      const revision = Array.isArray(undone) ? undone[0] : undone;
      if (!revision) {
        return json({
          error: "There are no AI edits left to undo.",
          code: "nothing_to_undo",
        }, 409);
      }
      const changes = Array.isArray(revision.changes) ? revision.changes : [];
      const reply = changes.length
        ? `Undid: ${changes.join(", ")}.`
        : "Undid the last AI workout edit.";
      await supabase.from("workout_edit_messages").insert({
        user_id: userId,
        day_id: dayId,
        role: "assistant",
        content: reply,
      });
      return json({
        reply,
        changes,
        can_undo: Boolean(revision.can_undo),
        undone_revision_id: revision.revision_id,
      });
    }

    if (!(await hasCurrentAIDataConsent(supabase, userId))) {
      return json(aiDataConsentRequiredBody(), 403);
    }

    const { data: reservation, error: reservationError } = await supabase.rpc(
      "reserve_workout_editor_request",
      {
        p_user_id: userId,
        p_day_id: dayId,
        p_request_id: body.request_id,
        p_message: message,
      },
    );
    if (reservationError) throw reservationError;
    const reservationResult = reservation as {
      status?: "accepted" | "duplicate" | "limit";
      remaining?: number;
    } | null;
    if (reservationResult?.status === "limit") {
      return json({
        error: "Workout editor limit reached",
        code: "workout_limit",
      }, 429);
    }
    if (reservationResult?.status === "duplicate") {
      return json({ error: "This request was already processed" }, 409);
    }
    if (reservationResult?.status !== "accepted") {
      throw new Error("Unable to reserve workout editor request");
    }

    const [
      workoutState,
      { data: catalog },
      { data: history },
      { data: revisions },
    ] = await Promise.all([
      loadWorkoutState(supabase, userId, day),
      supabase
        .from("exercise_video_clips")
        .select(
          "id, exercise_name, category, difficulty_level, description, coaching_notes, requires_both_sides, goals, weaknesses, source_section",
        )
        .eq("active", true),
      supabase
        .from("workout_edit_messages")
        .select("role, content")
        .eq("day_id", dayId)
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      supabase
        .from("workout_edit_revisions")
        .select(
          "request_message, assistant_reply, changes, before_snapshot, after_snapshot, applied_at, undone_at",
        )
        .eq("day_id", dayId)
        .eq("user_id", userId)
        .order("applied_at", { ascending: true }),
    ]);
    const currentExercises = workoutState.exercises;
    const currentLogs = workoutState.logs;
    const beforeSnapshot = workoutState.snapshot;
    await trace("authoritative_context_loaded", {
      request: message,
      exercise_count: currentExercises.length,
      workout_snapshot: beforeSnapshot,
      exercise_rows: currentExercises,
      exercise_logs: currentLogs,
      conversation_history: history ?? [],
      edit_history: revisions ?? [],
    });
    const existingWorkoutClipIds = new Set<string>(
      currentExercises
        .map((exercise: any) => exercise.video_clip_id)
        .filter((id: unknown): id is string => typeof id === "string"),
    );
    const candidates = [...(catalog ?? [])]
      .map((clip) => ({ ...clip, score: candidateScore(clip, message!) }))
      .sort((a, b) => b.score - a.score)
      .filter((clip) => !existingWorkoutClipIds.has(clip.id))
      .map(({ score: _score, ...clip }) => clip);

    const openAIResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
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
                'You are a precise basketball workout editor. Return JSON only: {"intent":"edit"|"answer","reply":string,"operations":[{"type":"add","clip_id":string}|{"type":"remove","exercise_id":string}|{"type":"reorder","exercise_id":string,"position":number}]}. Use the current request, full workout context, and conversation history to infer naturally what the athlete wants—do not demand special phrasing, internal fields, or a perfectly stated number. If the athlete wants a workout changed, return intent "edit" and the complete operation list required to make that change. Never claim that a drill was added, removed, or reordered unless that operation is included. If the athlete is asking only a question, return intent "answer" and an empty operations list. authoritative_workout_snapshot and authoritative_exercise_rows are the sole authority for the current workout state. Consider every exercise in available_catalog_exercises when selecting drills. A reorder position is one-based within the drill’s existing category only: never move a drill across category groups or mix their ordering. “Shooting” means only exercises whose category is exactly "shooting", never finishing. For shooting-focused workouts, order shooting drills close-range to midrange to threes, and do not place shooting ahead of ball handling. Use only supplied IDs and never remove every exercise.',
            },
            {
              role: "user",
              content: JSON.stringify({
                request: message,
                authoritative_drill_count: currentExercises.length,
                workout_context: {
                  title: day.title ?? null,
                  focus: day.focus ?? null,
                  coach_notes: day.coach_notes ?? null,
                  workout_time_budget_minutes: day.estimated_minutes ?? null,
                },
                current_workout_drills: currentExercises.map((exercise: any) => ({
                  exercise_id: exercise.id,
                  name: exercise.name ?? exercise.drill_name,
                  category: exercise.category,
                  order_index: exercise.order_index,
                })),
                authoritative_workout_snapshot: beforeSnapshot,
                authoritative_exercise_rows: currentExercises,
                authoritative_exercise_logs: currentLogs,
                conversation_history: history ?? [],
                edit_history: revisions ?? [],
                available_catalog_exercises: candidates,
              }),
            },
          ],
          max_completion_tokens: 700,
        }),
      },
    );
    if (!openAIResponse.ok) {
      throw new Error(`OpenAI request failed (${openAIResponse.status})`);
    }
    const completion = await openAIResponse.json();
    await trace("model_response_received", {
      model: MODEL,
      response: completion.choices?.[0]?.message?.content ?? null,
    });
    const parsed = JSON.parse(
      completion.choices?.[0]?.message?.content ?? "{}",
    ) as {
      intent?: "edit" | "answer";
      reply?: string;
      operations?: Array<
        { type?: string; clip_id?: string; exercise_id?: string; position?: number }
      >;
    };

    const currentIds = new Set<string>(
      (currentExercises ?? [])
        .map((exercise: any) => exercise.id)
        .filter((id: unknown): id is string => typeof id === "string"),
    );
    const existingClipIds = new Set<string>(existingWorkoutClipIds);
    const candidateById = new Map(candidates.map((clip) => [clip.id, clip]));
    let orderIndex = Math.max(
      0,
      ...(currentExercises ?? []).map((exercise: any) =>
        exercise.order_index ?? 0
      ),
    );
    const changes: string[] = [];
    const revisionOperations: Array<{
      operation_index: number;
      operation_type: "add" | "remove" | "reorder";
      exercise_id: string;
      exercise_snapshot?: Record<string, unknown> | null;
      exercise_log_snapshot?: Record<string, unknown> | null;
    }> = [];
    const logsByExercise = new Map(
      currentLogs.map((log: any) => [log.exercise_id, log]),
    );
    const validated = validateWorkoutEditorOperations(
      parsed.operations ?? [],
      new Set(candidateById.keys()),
      currentIds,
      new Map(currentExercises.map((exercise: any) => [
        String(exercise.id),
        String(exercise.category ?? ""),
      ])),
      { addCount: null, removeCount: null, targetCount: null, error: null },
    );
    if (validated.error) {
      await trace("operation_validation_failed", {
        model_operations: parsed.operations ?? [],
        error: validated.error,
      });
      const reply = validated.error;
      await supabase.from("workout_edit_messages").insert({
        user_id: userId,
        day_id: dayId,
        role: "assistant",
        content: reply,
      });
      return json({
        reply,
        changes: [],
        remaining_messages: Math.max(
          0,
          Number(reservationResult.remaining ?? WORKOUT_MESSAGE_LIMIT - 1),
        ),
        can_undo: false,
      });
    }
    const operations = validated.operations;
    if (parsed.intent === "edit" && operations.length === 0) {
      const reply = "I couldn't identify the workout changes to apply. Please try again.";
      await supabase.from("workout_edit_messages").insert({
        user_id: userId,
        day_id: dayId,
        role: "assistant",
        content: reply,
      });
      return json({ reply, changes: [], can_undo: false });
    }
    await trace("operations_validated", {
      model_operations: parsed.operations ?? [],
      operations,
    });

    // workout_days.active_exercise_id references workout_exercises. A valid
    // editor request can remove the active drill, so switch the active pointer
    // before its row is deleted instead of letting the foreign-key violation
    // abort the entire edit.
    const removalIds = new Set(
      operations
        .filter((operation) =>
          operation.type === "remove" && operation.exercise_id &&
          currentIds.has(operation.exercise_id)
        )
        .map((operation) => operation.exercise_id!),
    );
    if (day.active_exercise_id && removalIds.has(day.active_exercise_id)) {
      const removedActiveExerciseId = day.active_exercise_id;
      const replacement = currentExercises
        .filter((exercise: any) => !removalIds.has(exercise.id))
        .sort((a: any, b: any) =>
          Number(a.order_index ?? 0) - Number(b.order_index ?? 0)
        )[0];
      if (!replacement) {
        throw new Error("The edit cannot remove every drill in the workout.");
      }
      const { error: activeExerciseError } = await supabase
        .from("workout_days")
        .update({
          active_exercise_id: replacement.id,
          active_set_number: 1,
          completed: false,
        })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (activeExerciseError) throw new Error(activeExerciseError.message);
      day.active_exercise_id = replacement.id;
      day.active_set_number = 1;
      await trace("active_exercise_reassigned", {
        removed_active_exercise_id: removedActiveExerciseId,
        replacement_exercise_id: replacement.id,
      });
    }

    for (const operation of operations) {
      if (
        operation.type === "remove" && operation.exercise_id &&
        currentIds.has(operation.exercise_id)
      ) {
        if (currentIds.size <= 1) {
          continue;
        }
        const exercise = currentExercises?.find((item: any) =>
          item.id === operation.exercise_id
        );
        const { data: deletedExercise, error } = await supabase
          .from("workout_exercises")
          .delete()
          .eq("id", operation.exercise_id)
          .eq("day_id", dayId)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!deletedExercise || !exercise) throw new Error("The requested drill was not removed.");
        currentIds.delete(operation.exercise_id);
        changes.push(`Removed ${exercise.name ?? "exercise"}`);
        revisionOperations.push({
          operation_index: revisionOperations.length,
          operation_type: "remove",
          exercise_id: exercise.id,
          exercise_snapshot: exercise as Record<string, unknown>,
          exercise_log_snapshot: logsByExercise.get(exercise.id) ?? null,
        });
      }
      if (
        operation.type === "add" && operation.clip_id &&
        candidateById.has(operation.clip_id)
      ) {
        if (existingClipIds.has(operation.clip_id)) continue;
        const clip = candidateById.get(operation.clip_id)!;
        orderIndex += 1;
        const { data: addedExercise, error } = await supabase
          .from("workout_exercises")
          .insert({
            day_id: dayId,
            user_id: userId,
            video_clip_id: clip.id,
            order_index: orderIndex,
            name: clip.exercise_name,
            category: clip.category,
            instructions: clip.description ?? clip.coaching_notes,
            ...prescription(clip),
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        if (!addedExercise) throw new Error("The requested drill was not added.");
        existingClipIds.add(operation.clip_id);
        changes.push(`Added ${clip.exercise_name}`);
        revisionOperations.push({
          operation_index: revisionOperations.length,
          operation_type: "add",
          exercise_id: addedExercise.id,
          exercise_snapshot: addedExercise,
        });
      }
    }
    const reorderChanges = await applyReorders(
      supabase,
      userId,
      dayId,
      currentExercises.filter((exercise: any) => currentIds.has(exercise.id)),
      operations,
    );
    for (const { exercise, previousOrderIndex, nextOrderIndex } of reorderChanges) {
      changes.push(`Moved ${exercise.name ?? "exercise"} within ${exercise.category ?? "its"} drills`);
      revisionOperations.push({
        operation_index: revisionOperations.length,
        operation_type: "reorder",
        exercise_id: exercise.id,
        exercise_snapshot: {
          ...(exercise as Record<string, unknown>),
          order_index: previousOrderIndex,
        },
      });
    }

    // Shooting is always ordered locally by distance. This intentionally
    // supersedes model reorder suggestions for shooting drills.
    const exercisesAfterOperations = (
      await loadWorkoutState(supabase, userId, day)
    ).exercises;
    const shootingRangeChanges = await normalizeShootingRangeOrder(
      supabase,
      userId,
      dayId,
      exercisesAfterOperations,
    );
    for (const { exercise, previousOrderIndex, nextOrderIndex } of shootingRangeChanges) {
      changes.push(`Moved ${exercise.name ?? "exercise"} into shooting range order`);
      revisionOperations.push({
        operation_index: revisionOperations.length,
        operation_type: "reorder",
        exercise_id: exercise.id,
        exercise_snapshot: {
          ...(exercise as Record<string, unknown>),
          order_index: previousOrderIndex,
        },
      });
    }

    let canUndo = false;
    let verifiedExerciseCount = currentExercises.length;
    if (changes.length) {
      await refreshEstimate(supabase, userId, dayId);
      const afterState = await loadWorkoutState(supabase, userId, day);
      verifiedExerciseCount = afterState.exercises.length;
      await trace("database_write_completed", {
        changes,
        verified_exercise_count: verifiedExerciseCount,
        workout_snapshot: afterState.snapshot,
      });
      const replyForRevision = `${appliedReply(changes, parsed.reply?.trim() ?? "")}\n\nYour workout now has ${verifiedExerciseCount} ${verifiedExerciseCount === 1 ? "exercise" : "exercises"}.`;
      const { data: revision, error: revisionError } = await supabase
        .from("workout_edit_revisions")
        .insert({
          user_id: userId,
          day_id: dayId,
          request_message: message,
          assistant_reply: replyForRevision,
          changes,
          before_snapshot: beforeSnapshot,
          after_snapshot: afterState.snapshot,
        })
        .select("id")
        .single();
      if (revisionError || !revision) {
        throw new Error(
          revisionError?.message ?? "Could not save workout edit history",
        );
      }
      const { error: operationsError } = await supabase
        .from("workout_edit_operations")
        .insert(revisionOperations.map((operation) => ({
          revision_id: revision.id,
          ...operation,
        })));
      if (operationsError) throw new Error(operationsError.message);
      canUndo = true;
    }
    const reply = changes.length
      ? `${appliedReply(changes, parsed.reply?.trim() ?? "")}\n\nYour workout now has ${verifiedExerciseCount} ${verifiedExerciseCount === 1 ? "exercise" : "exercises"}.`
      : parsed.intent === "answer"
      ? parsed.reply?.trim() || "I couldn't answer that right now."
      : "I couldn't identify a workout change to apply. Please try again.";
    await supabase.from("workout_edit_messages").insert({
      user_id: userId,
      day_id: dayId,
      role: "assistant",
      content: reply,
    });

    return json({
      reply,
      changes,
      remaining_messages: Math.max(
        0,
        Number(reservationResult.remaining ?? WORKOUT_MESSAGE_LIMIT - 1),
      ),
      can_undo: canUndo,
    });
  } catch (error) {
    console.error("workout-editor error", {
      message: error instanceof Error ? error.message : String(error),
      user_id: userId,
    });
    // A model or database fault must be presented as a recoverable chat
    // response. Returning an HTTP 500 makes the mobile client discard the
    // safe explanation and display only a generic Edge Function error.
    return json({
      reply: "I couldn't update your workout just now. Please try again.",
      changes: [],
      can_undo: false,
    });
  }
});
