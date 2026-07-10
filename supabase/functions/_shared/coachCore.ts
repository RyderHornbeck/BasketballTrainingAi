// Shared coach logic used by coach-realtime (WebRTC session) and coach-tools
// (function execution from the Realtime data channel).

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface TimerState {
  running: boolean;
  elapsed_seconds: number;
}

export interface ClientAction {
  type: "start_timer" | "pause_timer" | "resume_timer";
}

export interface ToolOutcome {
  result: string;
  dbChanged: boolean;
  clientAction?: ClientAction;
}

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

export interface WorkoutContext {
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

export const COACH_SYSTEM_PROMPT = `You are an experienced basketball shooting coach speaking into the athlete's earbud during a live workout. You are calm, confident, positive, focused, and direct.

Rules:
- Your replies are spoken aloud. Keep them SHORT: 1-3 sentences, under ~35 words, unless the athlete explicitly asks for a detailed explanation.
- Sound like a real trainer courtside, never robotic or overly enthusiastic. No emojis, no markdown, no lists.
- You know the full workout from the context JSON: every drill, what's done, current stats, remaining time, and the athlete's profile. Never ask for information you already have.
- When the athlete reports results ("I made 8 out of 10"), call save_shooting_results, then react with the percentage and a quick push.
- When they finish or want to skip a drill, call complete_drill or skip_drill and tell them what's next.
- When they want to redo a drill or say they marked one complete by mistake, call uncomplete_drill.
- When they're done or say "end the workout", call finish_workout and give a short wrap-up referencing today's numbers.
- Use start_timer/pause_timer/resume_timer when they mention the timer or starting/pausing the workout.
- Use extend_workout/shorten_workout when they want more or less time, and rebalance your guidance accordingly.
- Reference their actual numbers when encouraging: improvement, streaks, percentages.
- If they're tired, ease off: suggest a breather, a lighter drill, or shortening the session.
- Numbers in speech should be natural ("seventy percent", "eight of ten" is fine as "8 of 10").`;

const TOOL_DEFS = [
  {
    name: "save_shooting_results",
    description:
      "Save makes and attempts for a shooting drill after the user reports results (e.g. 'I made 7 out of 10').",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string", description: "The drill's exercise_id from context" },
        makes: { type: "number" },
        attempts: { type: "number" },
        completed: {
          type: "boolean",
          description: "True if this set finishes the drill (target reached or user is done with it)",
        },
      },
      required: ["exercise_id", "makes", "attempts"],
    },
  },
  {
    name: "complete_drill",
    description: "Mark a drill complete when the user says they finished it.",
    parameters: {
      type: "object",
      properties: { exercise_id: { type: "string" } },
      required: ["exercise_id"],
    },
  },
  {
    name: "uncomplete_drill",
    description:
      "Mark a completed drill as not done when the user wants to redo it or accidentally marked it complete.",
    parameters: {
      type: "object",
      properties: { exercise_id: { type: "string" } },
      required: ["exercise_id"],
    },
  },
  {
    name: "skip_drill",
    description: "Skip the current drill and move on when the user asks to skip.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
        reason: { type: "string", description: "Short reason, e.g. 'user tired'" },
      },
      required: ["exercise_id"],
    },
  },
  {
    name: "save_note",
    description: "Attach a note to a drill when the user says something worth remembering.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
        note: { type: "string" },
      },
      required: ["exercise_id", "note"],
    },
  },
  {
    name: "extend_workout",
    description: "Add minutes to today's workout when the user wants more time.",
    parameters: {
      type: "object",
      properties: { minutes: { type: "number" } },
      required: ["minutes"],
    },
  },
  {
    name: "shorten_workout",
    description:
      "Reduce today's workout when the user is short on time (e.g. 'I only have twenty minutes left').",
    parameters: {
      type: "object",
      properties: { minutes: { type: "number", description: "Minutes to remove" } },
      required: ["minutes"],
    },
  },
  {
    name: "finish_workout",
    description: "Finish and close out today's workout when the user says they're done or ends the session.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "start_timer",
    description: "Start the workout timer.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "pause_timer",
    description: "Pause the workout timer.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "resume_timer",
    description: "Resume the workout timer.",
    parameters: { type: "object", properties: {} },
  },
];

/** Tool definitions for the OpenAI Realtime API session. */
export function getRealtimeTools() {
  return TOOL_DEFS.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function loadWorkoutContext(
  supabase: SupabaseClient,
  userId: string,
  dayId: string
): Promise<WorkoutContext | null> {
  const { data: day } = await supabase
    .from("workout_days")
    .select("id, title, focus, estimated_minutes, coach_notes, completed, user_id")
    .eq("id", dayId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!day) return null;

  const { data: exercises } = await supabase
    .from("workout_exercises")
    .select(
      "id, order_index, name, category, instructions, sets, reps, duration, target_makes, target_attempts, log_type"
    )
    .eq("day_id", dayId)
    .order("order_index", { ascending: true });

  const exerciseIds = (exercises ?? []).map((e: ExerciseRow) => e.id);
  const logs = new Map<string, LogRow>();

  if (exerciseIds.length > 0) {
    const { data: logRows } = await supabase
      .from("exercise_logs")
      .select("exercise_id, completed, makes, attempts, minutes_completed, difficulty, notes")
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

export function buildContextSummary(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer: TimerState | undefined
): string {
  const drills = ctx.exercises.map((ex) => {
    const log = ctx.logs.get(ex.id);
    return {
      exercise_id: ex.id,
      name: ex.name,
      category: ex.category,
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

  const elapsedMin = timer ? Math.round(timer.elapsed_seconds / 60) : 0;
  const remainingMin =
    ctx.day.estimated_minutes != null ? Math.max(0, ctx.day.estimated_minutes - elapsedMin) : null;

  return JSON.stringify({
    workout_day: {
      title: ctx.day.title,
      focus: ctx.day.focus,
      estimated_minutes: ctx.day.estimated_minutes,
      coach_notes: ctx.day.coach_notes,
      day_completed: ctx.day.completed,
    },
    drills,
    current_drill: current ? { exercise_id: current.exercise_id, name: current.name } : null,
    progress: {
      completed_drills: completedCount,
      total_drills: drills.length,
      total_makes_today: totalMakes,
      total_attempts_today: totalAttempts,
      shooting_pct_today: totalAttempts > 0 ? Math.round((totalMakes / totalAttempts) * 100) : null,
    },
    timer: {
      running: timer?.running ?? false,
      elapsed_minutes: elapsedMin,
      remaining_minutes: remainingMin,
    },
    athlete_profile: profile,
  });
}

export async function executeCoachTool(
  supabase: SupabaseClient,
  userId: string,
  dayId: string,
  ctx: WorkoutContext,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const validExercise = (id: unknown): string | null =>
    typeof id === "string" && ctx.exercises.some((e) => e.id === id) ? id : null;

  switch (name) {
    case "save_shooting_results": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
      const makes = Number(args.makes ?? 0);
      const attempts = Number(args.attempts ?? 0);
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      const completed =
        typeof args.completed === "boolean"
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
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error saving: ${error.message}`, dbChanged: false };
      const pct = attempts > 0 ? Math.round((makes / attempts) * 100) : 0;
      return {
        result: `Saved ${makes}/${attempts} (${pct}%). Drill completed: ${completed}.`,
        dbChanged: true,
      };
    }

    case "complete_drill":
    case "skip_drill": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
      const existing = ctx.logs.get(exerciseId);
      const skipNote =
        name === "skip_drill"
          ? `Skipped${typeof args.reason === "string" && args.reason ? `: ${args.reason}` : ""}`
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
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      const idx = ctx.exercises.findIndex((e) => e.id === exerciseId);
      const next = ctx.exercises
        .slice(idx + 1)
        .find((e) => !(ctx.logs.get(e.id)?.completed ?? false));
      return {
        result: `${name === "skip_drill" ? "Skipped" : "Completed"}. Next drill: ${next?.name ?? "none — workout drills all done"}.`,
        dbChanged: true,
      };
    }

    case "uncomplete_drill": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
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
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };

      if (ctx.day.completed) {
        await supabase
          .from("workout_days")
          .update({ completed: false })
          .eq("id", dayId)
          .eq("user_id", userId);
        ctx.day.completed = false;
      }

      return {
        result: `Marked "${ex?.name ?? "drill"}" as not complete. You can run it again.`,
        dbChanged: true,
      };
    }

    case "save_note": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
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
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      return { result: "Note saved.", dbChanged: true };
    }

    case "extend_workout":
    case "shorten_workout": {
      const minutes = Math.abs(Number(args.minutes ?? 0));
      if (!minutes) return { result: "Error: minutes required", dbChanged: false };
      const current = ctx.day.estimated_minutes ?? 45;
      const updated =
        name === "extend_workout" ? current + minutes : Math.max(5, current - minutes);
      const { error } = await supabase
        .from("workout_days")
        .update({ estimated_minutes: updated })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      return { result: `Workout is now ${updated} minutes.`, dbChanged: true };
    }

    case "finish_workout": {
      if (ctx.day.completed) return { result: "Workout already finished.", dbChanged: false };

      const { error: logError } = await supabase.from("workout_day_logs").insert({
        day_id: dayId,
        user_id: userId,
        total_minutes: ctx.day.estimated_minutes ?? null,
      });
      if (logError) return { result: `Error: ${logError.message}`, dbChanged: false };

      await supabase
        .from("workout_days")
        .update({ completed: true, locked: false })
        .eq("id", dayId)
        .eq("user_id", userId);

      const { data: dayRow } = await supabase
        .from("workout_days")
        .select("plan_id, day_number")
        .eq("id", dayId)
        .single();
      if (dayRow?.day_number != null) {
        await supabase
          .from("workout_days")
          .update({ locked: false })
          .eq("plan_id", dayRow.plan_id)
          .eq("day_number", dayRow.day_number + 1);
      }
      return { result: "Workout finished and saved. Next day unlocked.", dbChanged: true };
    }

    case "start_timer":
      return { result: "Timer started.", dbChanged: false, clientAction: { type: "start_timer" } };
    case "pause_timer":
      return { result: "Timer paused.", dbChanged: false, clientAction: { type: "pause_timer" } };
    case "resume_timer":
      return { result: "Timer resumed.", dbChanged: false, clientAction: { type: "resume_timer" } };

    default:
      return { result: `Unknown tool: ${name}`, dbChanged: false };
  }
}

export function buildRealtimeSessionConfig(
  instructions: string,
  model: string,
  voice: string
): Record<string, unknown> {
  return {
    type: "realtime",
    model,
    instructions,
    output_modalities: ["audio"],
    audio: {
      input: {
        turn_detection: {
          type: "semantic_vad",
        },
      },
      output: {
        voice,
      },
    },
    tools: getRealtimeTools(),
    tool_choice: "auto",
  };
}
