import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildWorkoutEditorSnapshot } from "../_shared/workoutEditorContext.ts";
import {
  aiDataConsentRequiredBody,
  hasCurrentAIDataConsent,
} from "../_shared/aiDataConsent.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const MODEL = Deno.env.get("OPENAI_WORKOUT_EDITOR_MODEL") ?? "gpt-4.1-mini";
const WORKOUT_MESSAGE_LIMIT = 30;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requestedAddCount(message: string): number | null {
  if (!/\b(?:drill|exercise|workout)\b/i.test(message)) return null;
  const match = /\badd\s+(?:(\d+)|(one|two|three|four|five|six|seven|eight|nine|ten))\b/i.exec(
    message,
  );
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : NUMBER_WORDS[match[2].toLowerCase()];
  return Number.isInteger(count) && count > 0 && count <= 10 ? count : null;
}

function appliedReply(changes: string[], fallback: string): string {
  if (!changes.length) return fallback || "I did not make any changes.";
  return `**Workout updated**\n${changes.map((change) => `- ${change}`).join("\n")}`;
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
      ? ["left side", "right side"]
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
      .select("id, title, completed, active_exercise_id, active_set_number")
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
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("workout_edit_revisions")
        .select(
          "request_message, assistant_reply, changes, before_snapshot, after_snapshot, applied_at, undone_at",
        )
        .eq("day_id", dayId)
        .eq("user_id", userId)
        .order("applied_at", { ascending: true })
        .limit(50),
    ]);
    const currentExercises = workoutState.exercises;
    const currentLogs = workoutState.logs;
    const beforeSnapshot = workoutState.snapshot;
    const existingWorkoutClipIds = new Set(
      currentExercises.map((exercise: any) => exercise.video_clip_id).filter(Boolean),
    );
    const requestedAdds = requestedAddCount(message!);

    const candidates = [...(catalog ?? [])]
      .map((clip) => ({ ...clip, score: candidateScore(clip, message!) }))
      .sort((a, b) => b.score - a.score)
      .filter((clip) => !existingWorkoutClipIds.has(clip.id))
      .slice(0, 80)
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
                'You are a friendly basketball workout editor. Return JSON only: {"reply":string,"operations":[{"type":"add","clip_id":string}|{"type":"remove","exercise_id":string}]}. The reply may use Markdown bold with **text** and bullet lines beginning with "- ". current_workout is authoritative and includes every drill\'s exact prescription, aggregate log, and per-set makes, attempts, minutes, and completion. edit_history records every prior AI edit with timestamps and before/after workout snapshots. Use only IDs supplied below. Make the smallest changes that satisfy the athlete. Never remove every exercise. Every add must use a distinct clip_id that is not already in the workout. If the athlete requests a number of drills to add, return exactly that many distinct add operations. For greetings or general conversation, reply naturally and warmly with an empty operations array; for example, greet the athlete and ask what they would like to change about their workout. Explain completed changes briefly in reply.',
            },
            ...[...(history ?? [])].reverse().map((entry) => ({
              role: entry.role,
              content: entry.content,
            })),
            {
              role: "user",
              content: JSON.stringify({
                request: message,
                requested_add_count: requestedAdds,
                current_workout: beforeSnapshot,
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
    const parsed = JSON.parse(
      completion.choices?.[0]?.message?.content ?? "{}",
    ) as {
      reply?: string;
      operations?: Array<
        { type?: string; clip_id?: string; exercise_id?: string }
      >;
    };

    const currentIds = new Set(
      (currentExercises ?? []).map((exercise: any) => exercise.id),
    );
    const existingClipIds = new Set(existingWorkoutClipIds);
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
      operation_type: "add" | "remove";
      exercise_id: string;
      exercise_snapshot?: Record<string, unknown> | null;
      exercise_log_snapshot?: Record<string, unknown> | null;
    }> = [];
    const logsByExercise = new Map(
      currentLogs.map((log: any) => [log.exercise_id, log]),
    );
    const operations = [...(parsed.operations ?? [])];
    if (requestedAdds != null) {
      const uniqueAdds = new Set<string>();
      const exactAddOperations = operations.filter((operation) => {
        if (operation.type !== "add") return true;
        if (!operation.clip_id || uniqueAdds.has(operation.clip_id)) return false;
        if (uniqueAdds.size >= requestedAdds) return false;
        uniqueAdds.add(operation.clip_id);
        return true;
      });
      operations.splice(0, operations.length, ...exactAddOperations);
    }
    const plannedAddIds = new Set(
      operations
        .filter((operation) => operation.type === "add" && operation.clip_id)
        .map((operation) => operation.clip_id!),
    );
    if (requestedAdds != null && plannedAddIds.size < requestedAdds) {
      for (const clip of candidates) {
        if (plannedAddIds.size >= requestedAdds) break;
        if (plannedAddIds.has(clip.id)) continue;
        plannedAddIds.add(clip.id);
        operations.push({ type: "add", clip_id: clip.id });
      }
    }

    for (const operation of operations) {
      if (
        operation.type === "remove" && operation.exercise_id &&
        currentIds.has(operation.exercise_id)
      ) {
        if (
          (currentExercises?.length ?? 0) -
              changes.filter((change) => change.startsWith("Removed")).length <=
            1
        ) {
          continue;
        }
        const exercise = currentExercises?.find((item: any) =>
          item.id === operation.exercise_id
        );
        const { error } = await supabase
          .from("workout_exercises")
          .delete()
          .eq("id", operation.exercise_id)
          .eq("day_id", dayId)
          .eq("user_id", userId);
        if (!error && exercise) {
          changes.push(`Removed ${exercise.name ?? "exercise"}`);
          revisionOperations.push({
            operation_index: revisionOperations.length,
            operation_type: "remove",
            exercise_id: exercise.id,
            exercise_snapshot: exercise,
            exercise_log_snapshot: logsByExercise.get(exercise.id) ?? null,
          });
        }
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
        if (!error && addedExercise) {
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
    }

    let canUndo = false;
    if (changes.length) {
      await refreshEstimate(supabase, userId, dayId);
      const afterState = await loadWorkoutState(supabase, userId, day);
      const replyForRevision = appliedReply(changes, parsed.reply?.trim() ?? "");
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
    const reply = appliedReply(changes, parsed.reply?.trim() ?? "");
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
    console.error("workout-editor error", error);
    return json({ error: "Workout editor failed" }, 500);
  }
});
