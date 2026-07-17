// Shared coach logic used by coach-realtime (WebRTC session) and coach-tools
// (function execution from the Realtime data channel).

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  aggregateSetLogs,
  applyAttemptsOverride,
  applyMinutesOverride,
  buildSetPlan,
  decodeExerciseLogMeta,
  encodeExerciseLogMeta,
  getCurrentSetNumber,
  hydrateSetLogs,
  markAllSetsComplete,
  clearSetLogs,
  updateSetLog,
  resolveAttemptsOverride,
  resolveMinutesOverride,
} from "./exerciseSetLogs.ts";
import { hasVideoDemoFromClip, isCatalogOnlyVideoId } from "./exerciseClip.ts";
import { sortWorkoutExercisesForDisplay } from "./workoutOrder.ts";

export interface TimerState {
  running: boolean;
  elapsed_seconds: number;
  duration_seconds?: number | null;
}

export interface ClientAction {
  type: "start_timer" | "pause_timer" | "resume_timer" | "stop_timer";
  duration_seconds?: number | null;
  timer_exercise_id?: string | null;
  timer_set_number?: number | null;
}

export interface ToolOutcome {
  result: string;
  dbChanged: boolean;
  clientAction?: ClientAction;
  localConfirmation?: string;
  skipModelResponse?: boolean;
}

interface ClipInfo {
  youtube_video_id: string | null;
  description: string | null;
  coaching_notes: string | null;
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
  video_clip?: ClipInfo | ClipInfo[] | null;
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
    active_exercise_id: string | null;
  };
  exercises: ExerciseRow[];
  logs: Map<string, LogRow>;
}

export const COACH_SYSTEM_PROMPT = `You are Court Coach's live basketball coach. Be as concise as possible. Keep every reply as short as you can while still fully answering the athlete's question — one short sentence is ideal; two at most unless they asked for detail.

Rules:
- Replies are spoken aloud. No emojis or markdown. No filler, preamble, or repetition. Say only what they need.
- Workout context contains one category-grouped drill sequence plus authoritative navigation. You MUST read and use this data. When asked about drills, name them in a brief spoken answer.
- Do not dump the entire workout unprompted or read raw JSON. Listing drill names when asked is allowed and expected.
- Shooting and finishing drills are NEVER time-based; describe them only with sets, makes, and attempts. Only ball-handling and conditioning drills may use minutes per set.
- When the athlete asks about a drill or the current exercise, give the shortest answer that includes its sets and authoritative per-set target.
- "What's next?" always means navigation.next_work_item: the first incomplete set of the current drill. Do not move to another drill until every set in the current drill is complete.
- "What drill/exercise comes after this?" means navigation.next_exercise_after_current. Never treat this as the answer to "what's next?"
- For progress, location, sequence, or next-action questions, call get_workout_position. Never infer a drill number; use the returned drill_position.
- If the athlete asks to switch or go to another drill, call set_current_drill. They can return to earlier unfinished drills; never claim that switching is unavailable.
- Context includes has_video_demo per drill. Video drills have an in-app demo on the exercise card; text-only drills do not. For text-only drills, use drill_description and coaching_notes from context instead of telling them to watch a video.
- For video drills, if they seem confused by your verbal description, briefly tell them to watch the video demo on that exercise card.
- For drill-list questions, call list_workout_drills with an optional category (e.g. shooting) if helpful.
- When the athlete asks to add or remove workout exercises, use search_exercise_catalog, add_workout_exercise, and remove_workout_exercise. Search before adding. After editing, briefly name every exercise added or removed; never answer with only "workout updated."
- When they want to remember something about a drill, call save_note with exercise_id and note.
- When the athlete reports shooting results, call save_shooting_results with exercise_id, makes, attempts, and set_number when mentioned. If they say only how many shots they made (for example, "I made 8") and do not state attempts, use the saved attempts for that specific set from workout context. Do not ask a follow-up just for attempts.
- When they complete or reopen one specific set, call set_set_completion. This includes timed ball-handling sets.
- Call complete_drill only when they explicitly finish the entire drill. Call uncomplete_drill when they want to reopen the entire drill. When they want to skip, call skip_drill.
- Use get_workout_position or get_progress when you need fresh workout state.
- Use extend_workout or shorten_workout to change remaining workout time.
- start_timer can use a requested number of minutes; The requested duration is usually the duration for the set of the user's current drill. If that set doesn't have use time, like finishing or shooting ask the user for clarification. Use resume_timer for a paused timer, and stop_timer to reset it.
- Tool results can contain internal updated_workout_state data. Never mention, summarize, or paraphrase internal state, context, alignment, refreshes, JSON, or tool execution. After a tool runs, say only a brief natural confirmation of the action result (e.g. "Saved 8 of 10 for set one.").`;

const REALTIME_TOOL_DEFS = [
  {
    name: "save_shooting_results",
    description:
      "Save makes and attempts for the current shooting drill. If the athlete reports makes without attempts, use the saved attempts for that specific set from workout context.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
        makes: { type: "number" },
        attempts: { type: "number" },
        set_number: { type: "number", description: "1-based set number; defaults to current set." },
        completed: { type: "boolean", description: "Whether this reported set is complete; defaults to true." },
      },
      required: ["exercise_id", "makes", "attempts"],
    },
  },
  {
    name: "set_set_completion",
    description:
      "Mark one specific set complete or incomplete without changing every set in the drill. Use for timed and ball-handling sets.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
        set_number: { type: "number", description: "The 1-based set number to update." },
        completed: { type: "boolean" },
      },
      required: ["exercise_id", "set_number", "completed"],
    },
  },
  {
    name: "complete_drill",
    description: "Mark every set in the current drill complete.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
      },
      required: ["exercise_id"],
    },
  },
  {
    name: "uncomplete_drill",
    description: "Reopen an entire completed drill and clear all of its completed sets.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
      },
      required: ["exercise_id"],
    },
  },
  {
    name: "skip_drill",
    description: "Skip the current drill and move on.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["exercise_id"],
    },
  },
  {
    name: "save_note",
    description: "Save a note on a specific drill when the athlete wants to remember something.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
        note: { type: "string", description: "Short note to attach to this drill." },
      },
      required: ["exercise_id", "note"],
    },
  },
  {
    name: "search_exercise_catalog",
    description:
      "Search active exercises that can be added to this workout. Call before add_workout_exercise.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural search such as corner threes, easier ball handling, or conditioning.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "add_workout_exercise",
    description: "Add one catalog exercise returned by search_exercise_catalog to today's workout.",
    parameters: {
      type: "object",
      properties: {
        catalog_exercise_id: { type: "string" },
      },
      required: ["catalog_exercise_id"],
    },
  },
  {
    name: "remove_workout_exercise",
    description:
      "Remove one exercise from today's workout, including its logged analytics. Use the exercise_id from workout context.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
      },
      required: ["exercise_id"],
    },
  },
  {
    name: "list_workout_drills",
    description:
      "List drills in today's workout. Use when the athlete asks what drills they have, e.g. all shooting drills.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional filter: shooting, ball_handling, finishing, defense, conditioning, etc.",
        },
      },
    },
  },
  {
    name: "get_workout_position",
    description:
      "Fetch the authoritative current set, next work item, next exercise, ordered drill list, and progress. Use for where-am-I, what's-next, and workout-sequence questions.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "set_current_drill",
    description:
      "Switch the active workout drill without completing or skipping any other drills. Use when the athlete asks to go to, switch to, or return to a specific drill.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string" },
      },
      required: ["exercise_id"],
    },
  },
  {
    name: "get_progress",
    description: "Fetch today's workout progress summary when needed.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "extend_workout",
    description: "Add minutes to today's workout.",
    parameters: {
      type: "object",
      properties: {
        minutes: { type: "number" },
      },
      required: ["minutes"],
    },
  },
  {
    name: "shorten_workout",
    description: "Reduce remaining workout time.",
    parameters: {
      type: "object",
      properties: {
        minutes: { type: "number" },
      },
      required: ["minutes"],
    },
  },
  {
    name: "finish_workout",
    description: "Finish the workout when the athlete explicitly says they are done, even if they leave drills unfinished. This unlocks the next workout.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "start_timer",
    description:
      "Start a countdown timer. Pass minutes when the athlete requests a specific duration; otherwise it uses the workout duration.",
    parameters: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "Optional requested timer duration in minutes." },
      },
    },
  },
  {
    name: "pause_timer",
    description: "Pause the workout timer.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "resume_timer",
    description: "Resume the paused workout timer.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "stop_timer",
    description: "Stop and reset the workout timer.",
    parameters: { type: "object", properties: {} },
  },
];

const TOOL_DEFS = [
  {
    name: "save_shooting_results",
    description:
      "Save shooting results after the athlete reports them (e.g. 'I made 7 out of 10 on set 2'). If they report only makes, use the saved attempts for that specific set from workout context.",
    parameters: {
      type: "object",
      properties: {
        exercise_id: { type: "string", description: "The drill's exercise_id from context" },
        makes: { type: "number" },
        attempts: { type: "number" },
        set_number: {
          type: "number",
          description: "Which set (1-based). Defaults to current_set from context.",
        },
        completed: {
          type: "boolean",
          description: "True if this set finishes the drill (all sets done or user is done with it)",
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
    description: "Finish and close out today's workout when the user says they're done, even if drills remain unfinished.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "start_timer",
    description:
      "Start a countdown timer. Pass minutes when the athlete requests a specific duration; otherwise it uses the workout duration.",
    parameters: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "Optional requested timer duration in minutes." },
      },
    },
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
  return REALTIME_TOOL_DEFS.map((t) => ({
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
    .select("id, title, focus, estimated_minutes, coach_notes, completed, active_exercise_id, user_id")
    .eq("id", dayId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!day) return null;

  const { data: exercises } = await supabase
    .from("workout_exercises")
    .select(
      "id, order_index, name, category, instructions, sets, reps, duration, target_makes, target_attempts, log_type, video_clip:exercise_video_clips(youtube_video_id, description, coaching_notes)"
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

function resolveClip(row: ExerciseRow): ClipInfo | null {
  const raw = row.video_clip;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

function videoDemoContext(row: ExerciseRow) {
  const clip = resolveClip(row);
  const catalogOnly = clip ? isCatalogOnlyVideoId(clip.youtube_video_id) : true;
  return {
    has_video_demo: hasVideoDemoFromClip(clip),
    drill_description: catalogOnly ? (clip?.description ?? row.instructions) : null,
    coaching_notes: clip?.coaching_notes ?? null,
  };
}

function effectivePlanForExercise(ex: ExerciseRow, log?: LogRow) {
  const plan = buildSetPlan(ex);
  const meta = decodeExerciseLogMeta(log?.notes ?? null);
  const setLogs = hydrateSetLogs(plan, meta, log ?? undefined);
  const attemptsOverride = resolveAttemptsOverride(meta, setLogs);
  const minutesOverride = resolveMinutesOverride(meta);
  return applyMinutesOverride(applyAttemptsOverride(plan, attemptsOverride), minutesOverride);
}

function isTimedExercise(ex: ExerciseRow): boolean {
  return (
    ex.log_type === "minutes" &&
    (ex.category === "ball_handling" || ex.category === "conditioning")
  );
}

export function buildContextSummary(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer: TimerState | undefined
): string {
  const drills = ctx.exercises.map((ex) => {
    const log = ctx.logs.get(ex.id);
    const plan = effectivePlanForExercise(ex, log);
    const meta = decodeExerciseLogMeta(log?.notes ?? null);
    const setLogs = hydrateSetLogs(buildSetPlan(ex), meta, log ?? undefined);
    const totals = aggregateSetLogs(setLogs, plan);
    const currentSet = getCurrentSetNumber(setLogs, plan);
    const video = videoDemoContext(ex);

    return {
      exercise_id: ex.id,
      name: ex.name,
      category: ex.category,
      sets: ex.sets,
      reps: ex.reps,
      duration: isTimedExercise(ex) ? ex.duration : null,
      target_makes: ex.target_makes,
      target_attempts: ex.target_attempts,
      log_type: ex.log_type,
      sets_total: plan.setCount,
      per_set_target_makes: plan.perSetMakes,
      per_set_target_attempts: plan.perSetAttempts,
      per_set_minutes: isTimedExercise(ex) ? plan.perSetMinutes : null,
      per_set_attempts_override: meta.per_set_attempts_override ?? null,
      per_set_minutes_override: isTimedExercise(ex)
        ? meta.per_set_minutes_override ?? null
        : null,
      completed: totals.completed,
      logged_makes: totals.makes,
      logged_attempts: totals.attempts,
      current_set: currentSet,
      set_logs: totals.set_logs,
      notes: meta.user_notes ?? null,
      has_video_demo: video.has_video_demo,
      drill_description: video.drill_description,
      coaching_notes: video.coaching_notes,
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
    current_drill: current
      ? {
          exercise_id: current.exercise_id,
          name: current.name,
          current_set: current.current_set,
          sets_total: current.sets_total,
          per_set_target_makes: current.per_set_target_makes,
          per_set_target_attempts: current.per_set_target_attempts,
          per_set_attempts_override: current.per_set_attempts_override,
          has_video_demo: current.has_video_demo,
          drill_description: current.drill_description,
        }
      : null,
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

function drillPlanFields(ex: ExerciseRow, log?: LogRow) {
  const plan = effectivePlanForExercise(ex, log);
  const video = videoDemoContext(ex);
  return {
    sets_total: plan.setCount,
    per_set_target_makes: plan.perSetMakes,
    per_set_target_attempts: plan.perSetAttempts,
    per_set_minutes: isTimedExercise(ex) ? plan.perSetMinutes : null,
    log_type: ex.log_type,
    has_video_demo: video.has_video_demo,
    drill_description: video.drill_description,
  };
}

function summarizeDrill(
  ex: ExerciseRow,
  log: LogRow | undefined
): {
  exercise_id: string;
  name: string | null;
  current_set: number | null;
  sets_total: number;
  makes: number | null;
  attempts: number | null;
  completed: boolean;
  target_makes: number | null;
  target_attempts: number | null;
  per_set_minutes: number | null;
  log_type: string | null;
  has_video_demo: boolean;
  drill_description: string | null;
} {
  const plan = effectivePlanForExercise(ex, log);
  const meta = decodeExerciseLogMeta(log?.notes ?? null);
  const setLogs = hydrateSetLogs(buildSetPlan(ex), meta, log ?? undefined);
  const totals = aggregateSetLogs(setLogs, plan);
  const video = videoDemoContext(ex);
  return {
    exercise_id: ex.id,
    name: ex.name,
    current_set: getCurrentSetNumber(setLogs, plan),
    sets_total: plan.setCount,
    makes: totals.makes,
    attempts: totals.attempts,
    completed: totals.completed,
    target_makes: plan.perSetMakes,
    target_attempts: plan.perSetAttempts,
    per_set_minutes: isTimedExercise(ex) ? plan.perSetMinutes : null,
    log_type: ex.log_type,
    has_video_demo: video.has_video_demo,
    drill_description: video.drill_description,
  };
}

interface OrderedDrillState {
  exercise: ExerciseRow;
  log: LogRow | undefined;
  position: number;
  plan: ReturnType<typeof effectivePlanForExercise>;
  setLogs: ReturnType<typeof hydrateSetLogs>;
  totals: ReturnType<typeof aggregateSetLogs>;
}

function orderedDrillStates(ctx: WorkoutContext): OrderedDrillState[] {
  return sortWorkoutExercisesForDisplay(ctx.exercises).map((exercise, index) => {
    const log = ctx.logs.get(exercise.id);
    const plan = effectivePlanForExercise(exercise, log);
    const meta = decodeExerciseLogMeta(log?.notes ?? null);
    const setLogs = hydrateSetLogs(buildSetPlan(exercise), meta, log ?? undefined);
    return {
      exercise,
      log,
      position: index + 1,
      plan,
      setLogs,
      totals: aggregateSetLogs(setLogs, plan),
    };
  });
}

function currentDrillIndex(states: OrderedDrillState[], activeExerciseId: string | null): number {
  const activeIndex = activeExerciseId
    ? states.findIndex((state) => state.exercise.id === activeExerciseId)
    : -1;
  if (activeIndex >= 0 && !states[activeIndex].totals.completed) return activeIndex;

  // When the active drill just finished, continue forward before wrapping to
  // earlier drills the athlete intentionally left available.
  if (activeIndex >= 0) {
    const nextIndex = states.findIndex(
      (state, index) => index > activeIndex && !state.totals.completed
    );
    if (nextIndex >= 0) return nextIndex;
  }
  return states.findIndex((state) => !state.totals.completed);
}

function findCurrentDrillState(ctx: WorkoutContext): OrderedDrillState | null {
  const states = orderedDrillStates(ctx);
  const index = currentDrillIndex(states, ctx.day.active_exercise_id);
  return index >= 0 ? states[index] : null;
}

function findCurrentExercise(ctx: WorkoutContext): ExerciseRow | null {
  return findCurrentDrillState(ctx)?.exercise ?? null;
}

function findNextExercise(ctx: WorkoutContext, afterId?: string): ExerciseRow | null {
  const states = orderedDrillStates(ctx);
  const startIdx = afterId ? states.findIndex((state) => state.exercise.id === afterId) + 1 : 0;
  return (
    states.slice(Math.max(0, startIdx)).find((state) => !state.totals.completed)?.exercise ?? null
  );
}

function drillContext(state: OrderedDrillState) {
  const { exercise, position, plan, totals } = state;
  const video = videoDemoContext(exercise);
  const completedSets = totals.set_logs.filter((set) => set.completed).length;
  const nextUnfinishedSet = getCurrentSetNumber(totals.set_logs, plan);
  return {
    drill_position: position,
    exercise_id: exercise.id,
    name: exercise.name,
    category: exercise.category,
    status: totals.completed ? "complete" : completedSets > 0 ? "in_progress" : "not_started",
    sets: {
      total: plan.setCount,
      completed: completedSets,
      next_unfinished: nextUnfinishedSet,
    },
    target: {
      makes: plan.perSetMakes,
      attempts: plan.perSetAttempts,
      minutes: isTimedExercise(exercise) ? plan.perSetMinutes : null,
    },
    log_type: exercise.log_type,
    instructions: (exercise.instructions ?? "").slice(0, 240),
    has_video_demo: video.has_video_demo,
    drill_description: video.drill_description,
  };
}

export function buildWorkoutNavigation(ctx: WorkoutContext) {
  const states = orderedDrillStates(ctx);
  const currentIndex = currentDrillIndex(states, ctx.day.active_exercise_id);
  const current = currentIndex >= 0 ? states[currentIndex] : null;
  const nextExercise =
    currentIndex >= 0
      ? states.slice(currentIndex + 1).find((state) => !state.totals.completed) ?? null
      : null;

  const nextWorkItem = current
    ? {
        kind: "set",
        ...drillContext(current),
        set_number: getCurrentSetNumber(current.totals.set_logs, current.plan),
      }
    : null;

  return {
    ordering: "category_grouped_display_order",
    drills: states.map(drillContext),
    next_work_item: nextWorkItem,
    next_exercise_after_current: nextExercise
      ? {
          kind: "exercise",
          ...drillContext(nextExercise),
          first_set_number: getCurrentSetNumber(nextExercise.totals.set_logs, nextExercise.plan),
        }
      : null,
  };
}

function buildCompactDrillList(ctx: WorkoutContext) {
  return buildWorkoutNavigation(ctx).drills;
}

function isShootingDrill(drill: {
  category: string | null;
  log_type: string | null;
}): boolean {
  return drill.category === "shooting" || drill.log_type === "makes_attempts";
}

/** Compact context for Realtime sessions — full drill list plus current/next drill. */
export function buildCompactContextSummary(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer: TimerState | undefined,
  conversationSummary?: string | null
): string {
  const navigation = buildWorkoutNavigation(ctx);
  const states = orderedDrillStates(ctx);

  let totalMakes = 0;
  let totalAttempts = 0;
  let completedCount = 0;
  for (const state of states) {
    if (state.totals.completed) completedCount += 1;
    if (state.totals.makes != null) totalMakes += state.totals.makes;
    if (state.totals.attempts != null) totalAttempts += state.totals.attempts;
  }

  const elapsedMin = timer ? Math.round(timer.elapsed_seconds / 60) : 0;
  const remainingMin =
    ctx.day.estimated_minutes != null ? Math.max(0, ctx.day.estimated_minutes - elapsedMin) : null;

  const goal =
    typeof profile?.main_goal === "string" ? profile.main_goal.slice(0, 120) : null;

  return JSON.stringify({
    workout_day: {
      title: ctx.day.title,
      focus: ctx.day.focus,
    },
    sequence: {
      ordering: navigation.ordering,
      drills: navigation.drills,
    },
    navigation: {
      next_work_item: navigation.next_work_item,
      next_exercise_after_current: navigation.next_exercise_after_current,
    },
    progress: {
      completed_drills: completedCount,
      total_drills: states.length,
      makes_today: totalMakes,
      attempts_today: totalAttempts,
      shooting_pct: totalAttempts > 0 ? Math.round((totalMakes / totalAttempts) * 100) : null,
    },
    remaining_minutes: remainingMin,
    goal,
    prior_coach_summary: (conversationSummary ?? "").slice(0, 200) || null,
  });
}

export function buildRealtimeInstructions(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer?: TimerState,
  conversationSummary?: string | null
): string {
  return `${COACH_SYSTEM_PROMPT}

Authoritative workout state follows. Use it silently and prefer newer state from tool results:
${buildCompactContextSummary(ctx, profile, timer, conversationSummary)}`;
}

/** Small current-state payload injected after every state-changing tool call. */
export function buildRealtimeNavigationUpdate(ctx: WorkoutContext): string {
  const navigation = buildWorkoutNavigation(ctx);
  const completedDrills = navigation.drills.filter((drill) => drill.status === "complete").length;
  return JSON.stringify({
    type: "workout_state_update",
    sequence: {
      ordering: navigation.ordering,
      drills: navigation.drills,
    },
    navigation: {
      next_work_item: navigation.next_work_item,
      next_exercise_after_current: navigation.next_exercise_after_current,
    },
    progress: {
      completed_drills: completedDrills,
      total_drills: navigation.drills.length,
    },
  });
}

export function buildProgressSummary(ctx: WorkoutContext): string {
  let totalMakes = 0;
  let totalAttempts = 0;
  const states = orderedDrillStates(ctx);
  for (const state of states) {
    if (state.totals.makes != null) totalMakes += state.totals.makes;
    if (state.totals.attempts != null) totalAttempts += state.totals.attempts;
  }
  const pct = totalAttempts > 0 ? Math.round((totalMakes / totalAttempts) * 100) : null;
  const completedCount = states.filter((state) => state.totals.completed).length;
  return `${completedCount}/${states.length} drills done, ${totalMakes}/${totalAttempts} shooting${
    pct != null ? ` (${pct}%)` : ""
  }.`;
}

export function buildWorkoutPositionSummary(ctx: WorkoutContext): string {
  const navigation = buildWorkoutNavigation(ctx);
  const workItem = navigation.next_work_item;
  if (!workItem) return "Workout complete — no unfinished sets remain.";

  const target =
    workItem.target.minutes != null
      ? `${workItem.target.minutes} minute${workItem.target.minutes === 1 ? "" : "s"}`
      : workItem.target.makes != null || workItem.target.attempts != null
        ? `${workItem.target.makes ?? workItem.target.attempts} of ${
            workItem.target.attempts ?? workItem.target.makes
          }`
        : null;
  const after = navigation.next_exercise_after_current;
  return [
    `Current work: drill ${workItem.drill_position} of ${navigation.drills.length}, ${
      workItem.name ?? "unnamed drill"
    }, set ${workItem.set_number} of ${workItem.sets.total}${target ? `, target ${target}` : ""}.`,
    after ? `After this drill: ${after.name ?? "unnamed drill"}.` : "This is the last drill.",
  ].join(" ");
}

export function buildWorkoutDrillListSummary(
  ctx: WorkoutContext,
  categoryFilter?: string | null
): string {
  const drills = buildCompactDrillList(ctx);
  const normalizedFilter = categoryFilter?.trim().toLowerCase().replace(/\s+/g, "_") ?? null;

  const filtered = normalizedFilter
    ? drills.filter((d) => {
        const cat = (d.category ?? "").toLowerCase();
        if (cat === normalizedFilter) return true;
        if (normalizedFilter === "shooting" && isShootingDrill(d)) return true;
        return cat.includes(normalizedFilter) || normalizedFilter.includes(cat);
      })
    : drills;

  if (filtered.length === 0) {
    return normalizedFilter
      ? `No ${categoryFilter} drills in today's workout.`
      : "No drills in today's workout.";
  }

  const names = filtered.map((d) => {
    const label = d.name ?? "Unnamed drill";
    return d.status === "complete" ? `${label} (done)` : label;
  });
  const doneCount = filtered.filter((d) => d.status === "complete").length;
  const prefix = normalizedFilter ? `${categoryFilter} drills` : "Today's drills";
  return `${prefix} (${doneCount}/${filtered.length} done): ${names.join(", ")}.`;
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
  const refreshEstimate = async (): Promise<void> => {
    const { data: rows } = await supabase
      .from("workout_exercises")
      .select("sets, duration")
      .eq("day_id", dayId)
      .eq("user_id", userId);
    const plannedMinutes = (rows ?? []).reduce((sum: number, row: any) => {
      const sets = Math.max(1, Number.parseInt(String(row.sets ?? "1"), 10) || 1);
      const duration = String(row.duration ?? "").match(/(\d+(?:\.\d+)?)\s*min/i);
      return sum + (duration ? Number.parseFloat(duration[1]) : 3) * sets;
    }, 0);
    const estimate = Math.max(5, Math.round(plannedMinutes + 5 + (rows?.length ?? 0) * 1.5));
    await supabase
      .from("workout_days")
      .update({ estimated_minutes: estimate })
      .eq("id", dayId)
      .eq("user_id", userId);
  };

  switch (name) {
    case "save_shooting_results": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
      const makes = Number(args.makes ?? 0);
      const attempts = Number(args.attempts ?? 0);
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };

      const plan = effectivePlanForExercise(ex, existing);
      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      let setLogs = hydrateSetLogs(buildSetPlan(ex), meta, existing ?? undefined);
      const currentSet = getCurrentSetNumber(setLogs, plan);
      const setNumber =
        typeof args.set_number === "number" && args.set_number > 0
          ? Math.min(args.set_number, plan.setCount)
          : currentSet ?? 1;

      const setCompleted =
        typeof args.completed === "boolean"
          ? args.completed
          : attempts > 0;

      setLogs = updateSetLog(setLogs, plan, setNumber, {
        makes,
        attempts: attempts || plan.perSetAttempts,
        completed: setCompleted,
      });

      const totals = aggregateSetLogs(setLogs, plan);
      const drillCompleted = totals.completed;

      const { error } = await supabase.from("exercise_logs").upsert(
        {
          exercise_id: exerciseId,
          day_id: dayId,
          user_id: userId,
          completed: drillCompleted,
          makes: totals.makes,
          attempts: totals.attempts,
          minutes_completed: existing?.minutes_completed ?? null,
          difficulty: existing?.difficulty ?? null,
          notes: encodeExerciseLogMeta({
            set_logs: totals.set_logs,
            user_notes: meta.user_notes ?? null,
            per_set_attempts_override: meta.per_set_attempts_override ?? null,
            per_set_minutes_override: meta.per_set_minutes_override ?? null,
          }),
        },
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error saving: ${error.message}`, dbChanged: false };
      return {
        result: `Saved set ${setNumber}: ${makes}/${attempts}.`,
        dbChanged: true,
      };
    }

    case "set_set_completion": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
      const ex = ctx.exercises.find((exercise) => exercise.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };
      const requestedSet = Number(args.set_number);
      if (!Number.isInteger(requestedSet)) {
        return { result: "Error: a valid set_number is required", dbChanged: false };
      }
      if (typeof args.completed !== "boolean") {
        return { result: "Error: completed must be true or false", dbChanged: false };
      }

      const existing = ctx.logs.get(exerciseId);
      const plan = effectivePlanForExercise(ex, existing);
      if (requestedSet < 1 || requestedSet > plan.setCount) {
        return {
          result: `Error: set_number must be between 1 and ${plan.setCount}`,
          dbChanged: false,
        };
      }

      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      let setLogs = hydrateSetLogs(buildSetPlan(ex), meta, existing ?? undefined);
      const current = setLogs.find((set) => set.set_number === requestedSet);
      const completed = args.completed;

      if (completed && plan.logType === "makes_attempts" && current?.makes == null) {
        return {
          result: `Tell me the makes and attempts for set ${requestedSet} so I can complete it.`,
          dbChanged: false,
        };
      }

      setLogs = updateSetLog(setLogs, plan, requestedSet, {
        completed,
        makes: completed || plan.logType !== "makes_attempts" ? current?.makes ?? null : null,
        attempts: current?.attempts ?? plan.perSetAttempts,
        minutes: completed
          ? current?.minutes ?? plan.perSetMinutes
          : null,
      });
      const totals = aggregateSetLogs(setLogs, plan);

      const { error } = await supabase.from("exercise_logs").upsert(
        {
          exercise_id: exerciseId,
          day_id: dayId,
          user_id: userId,
          completed: totals.completed,
          makes: totals.makes,
          attempts: totals.attempts,
          minutes_completed: totals.minutes_completed,
          difficulty: existing?.difficulty ?? null,
          notes: encodeExerciseLogMeta({
            set_logs: totals.set_logs,
            user_notes: meta.user_notes ?? null,
            per_set_attempts_override: meta.per_set_attempts_override ?? null,
            per_set_minutes_override: meta.per_set_minutes_override ?? null,
          }),
        },
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };

      if (!completed && ctx.day.completed) {
        await Promise.all([
          supabase
            .from("workout_days")
            .update({ completed: false })
            .eq("id", dayId)
            .eq("user_id", userId),
          supabase
            .from("workout_day_logs")
            .delete()
            .eq("day_id", dayId)
            .eq("user_id", userId),
        ]);
        ctx.day.completed = false;
      }

      return {
        result: `Set ${requestedSet} of ${ex.name ?? "the drill"} marked ${
          completed ? "complete" : "incomplete"
        }.`,
        dbChanged: true,
      };
    }

    case "get_workout_position":
    // Retained for an in-flight session that received the prior tool schema.
    case "get_next_drill":
      return { result: buildWorkoutPositionSummary(ctx), dbChanged: false };

    case "set_current_drill": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
      const targetState = orderedDrillStates(ctx).find(
        (state) => state.exercise.id === exerciseId
      );
      if (!targetState || targetState.totals.completed) {
        return {
          result: "That drill is already complete. Choose an unfinished drill instead.",
          dbChanged: false,
        };
      }
      const { error } = await supabase
        .from("workout_days")
        .update({ active_exercise_id: exerciseId })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      ctx.day.active_exercise_id = exerciseId;
      const setNumber = getCurrentSetNumber(targetState.totals.set_logs, targetState.plan);
      return {
        result: `Now on drill ${targetState.position}, ${targetState.exercise.name ?? "unnamed drill"}, set ${
          setNumber ?? 1
        } of ${targetState.plan.setCount}.`,
        dbChanged: true,
      };
    }

    case "search_exercise_catalog": {
      const rawQuery = String(args.query ?? "").trim();
      if (!rawQuery) return { result: "Error: search query required", dbChanged: false };
      const normalize = (value: string) =>
        value
          .toLowerCase()
          .replace(/\b3(?:s|'s)?\b/g, " three ")
          .replace(/\bthree[- ]pointer(?:s)?\b/g, " three ")
          .replace(/mid[- ]range/g, " midrange ")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      const query = normalize(rawQuery);
      const tokens = query.split(/\s+/).filter(Boolean);
      const { data: catalog, error } = await supabase
        .from("exercise_video_clips")
        .select(
          "id, exercise_name, category, difficulty_level, description, coaching_notes, requires_both_sides"
        )
        .eq("active", true);
      if (error) return { result: `Error searching: ${error.message}`, dbChanged: false };
      const matches = (catalog ?? [])
        .map((clip: any) => {
          const exerciseName = normalize(String(clip.exercise_name ?? ""));
          const text = normalize(
            `${clip.exercise_name ?? ""} ${clip.category ?? ""} ${clip.difficulty_level ?? ""} ${clip.description ?? ""} ${clip.coaching_notes ?? ""}`
          );
          const score = tokens.reduce(
            (total, token) =>
              total + (exerciseName.includes(token) ? 8 : text.includes(token) ? 2 : 0),
            0
          );
          return { clip, score };
        })
        .filter(({ score }: { score: number }) => score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 8);
      if (!matches.length) {
        return { result: `No catalog exercises matched "${rawQuery}".`, dbChanged: false };
      }
      return {
        result: matches
          .map(
            ({ clip }: any) =>
              `${clip.exercise_name} [catalog_exercise_id=${clip.id}; ${clip.category}; ${clip.difficulty_level}]`
          )
          .join("\n"),
        dbChanged: false,
      };
    }

    case "add_workout_exercise": {
      const catalogId =
        typeof args.catalog_exercise_id === "string" ? args.catalog_exercise_id : null;
      if (!catalogId) {
        return { result: "Error: catalog_exercise_id required", dbChanged: false };
      }
      const { data: clip, error: clipError } = await supabase
        .from("exercise_video_clips")
        .select(
          "id, exercise_name, category, description, coaching_notes, requires_both_sides"
        )
        .eq("id", catalogId)
        .eq("active", true)
        .maybeSingle();
      if (clipError || !clip) {
        return { result: "Error: catalog exercise not found", dbChanged: false };
      }
      const { data: duplicate } = await supabase
        .from("workout_exercises")
        .select("id")
        .eq("day_id", dayId)
        .eq("user_id", userId)
        .eq("video_clip_id", catalogId)
        .limit(1)
        .maybeSingle();
      if (duplicate) {
        return { result: `${clip.exercise_name} is already in this workout.`, dbChanged: false };
      }
      const [{ data: lastExercise }, durationMatch] = await Promise.all([
        supabase
          .from("workout_exercises")
          .select("order_index")
          .eq("day_id", dayId)
          .eq("user_id", userId)
          .order("order_index", { ascending: false })
          .limit(1)
          .maybeSingle(),
        Promise.resolve(
          `${clip.description ?? ""} ${clip.coaching_notes ?? ""}`.match(
            /(\d+)\s*(?:to\s*\d+\s*)?(second|minute)/i
          )
        ),
      ]);
      const shooting = clip.category === "shooting";
      const finishing = clip.category === "finishing";
      const duration = durationMatch
        ? durationMatch[2].toLowerCase().startsWith("second")
          ? `${Math.max(0.5, Number(durationMatch[1]) / 60)} min`
          : `${Math.max(0.5, Number(durationMatch[1]))} min`
        : "3 min";
      const { error } = await supabase.from("workout_exercises").insert({
        day_id: dayId,
        user_id: userId,
        video_clip_id: clip.id,
        order_index: (lastExercise?.order_index ?? -1) + 1,
        name: clip.exercise_name,
        category: clip.category,
        instructions: clip.description ?? clip.coaching_notes,
        sets: "2",
        reps: null,
        duration,
        target_makes: shooting ? 10 : finishing ? 8 : null,
        target_attempts: shooting ? 20 : finishing ? 15 : null,
        log_type: shooting || finishing ? "makes_attempts" : durationMatch ? "minutes" : "checkbox",
        set_side_labels: clip.requires_both_sides ? ["left side", "right side"] : null,
      });
      if (error) return { result: `Error adding: ${error.message}`, dbChanged: false };
      await refreshEstimate();
      return { result: `Added ${clip.exercise_name}.`, dbChanged: true };
    }

    case "remove_workout_exercise": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
      const exercise = ctx.exercises.find((candidate) => candidate.id === exerciseId);
      const exerciseName = exercise?.name ?? "the exercise";
      const { error } = await supabase
        .from("workout_exercises")
        .delete()
        .eq("id", exerciseId)
        .eq("day_id", dayId)
        .eq("user_id", userId);
      if (error) return { result: `Error removing: ${error.message}`, dbChanged: false };
      await supabase
        .from("workout_days")
        .update({ active_exercise_id: null })
        .eq("id", dayId)
        .eq("user_id", userId)
        .eq("active_exercise_id", exerciseId);
      await refreshEstimate();
      return {
        result: `Removed ${exerciseName}; its logged results no longer count in analytics.`,
        dbChanged: true,
      };
    }

    case "list_workout_drills": {
      const category =
        typeof args.category === "string" && args.category.trim() ? args.category.trim() : null;
      return { result: buildWorkoutDrillListSummary(ctx, category), dbChanged: false };
    }

    case "get_progress":
      return { result: buildProgressSummary(ctx), dbChanged: false };

    case "complete_drill":
    case "skip_drill": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };

      const plan = effectivePlanForExercise(ex, existing);
      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      const setLogs = markAllSetsComplete(
        hydrateSetLogs(buildSetPlan(ex), meta, existing ?? undefined),
        plan
      );
      const totals = aggregateSetLogs(setLogs, plan);
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
          makes: totals.makes,
          attempts: totals.attempts,
          minutes_completed: totals.minutes_completed ?? existing?.minutes_completed ?? null,
          difficulty: existing?.difficulty ?? null,
          notes: encodeExerciseLogMeta({
            set_logs: totals.set_logs,
            user_notes: skipNote ?? meta.user_notes ?? null,
            per_set_attempts_override: meta.per_set_attempts_override ?? null,
            per_set_minutes_override: meta.per_set_minutes_override ?? null,
          }),
        },
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      const next = findNextExercise(ctx, exerciseId);
      const nextName = next?.name ?? "workout complete";
      return {
        result: `${name === "skip_drill" ? "Skipped" : "Completed"}. Next: ${nextName}.`,
        dbChanged: true,
      };
    }

    case "uncomplete_drill": {
      const exerciseId = validExercise(args.exercise_id);
      if (!exerciseId) return { result: "Error: unknown exercise_id", dbChanged: false };
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };

      const plan = buildSetPlan(ex);
      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      const cleared = clearSetLogs(plan);

      const { error } = await supabase.from("exercise_logs").upsert(
        {
          exercise_id: exerciseId,
          day_id: dayId,
          user_id: userId,
          completed: false,
          makes: null,
          attempts: null,
          minutes_completed: null,
          difficulty: existing?.difficulty ?? null,
          notes: encodeExerciseLogMeta({
            set_logs: cleared,
            user_notes: meta.user_notes ?? null,
            per_set_attempts_override: meta.per_set_attempts_override ?? null,
            per_set_minutes_override: meta.per_set_minutes_override ?? null,
          }),
        },
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };

      if (ctx.day.completed) {
        await Promise.all([
          supabase
            .from("workout_days")
            .update({ completed: false })
            .eq("id", dayId)
            .eq("user_id", userId),
          supabase
            .from("workout_day_logs")
            .delete()
            .eq("day_id", dayId)
            .eq("user_id", userId),
        ]);
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
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };

      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      const note = String(args.note ?? "").trim().slice(0, 500);
      if (!note) return { result: "Error: note required", dbChanged: false };

      const userNotes = meta.user_notes?.trim() ? `${meta.user_notes}\n${note}` : note;
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
          notes: encodeExerciseLogMeta({
            set_logs: meta.set_logs,
            user_notes: userNotes,
            per_set_attempts_override: meta.per_set_attempts_override ?? null,
            per_set_minutes_override: meta.per_set_minutes_override ?? null,
          }),
        },
        { onConflict: "exercise_id" }
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      return { result: `Note saved on ${ex.name ?? "drill"}.`, dbChanged: true };
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
      const completionKind =
        ctx.exercises.length > 0 &&
        ctx.exercises.every((exercise) => ctx.logs.get(exercise.id)?.completed === true)
          ? "full"
          : "partial";
      const completedMinutes = [...ctx.logs.values()].reduce(
        (total, log) => total + (log.minutes_completed ?? 0),
        0
      );

      const { error: logError } = await supabase.from("workout_day_logs").upsert(
        {
          day_id: dayId,
          user_id: userId,
          total_minutes: completedMinutes || ctx.day.estimated_minutes || null,
        },
        { onConflict: "day_id" }
      );
      if (logError) return { result: `Error: ${logError.message}`, dbChanged: false };

      await supabase
        .from("workout_days")
        .update({
          completed: true,
          locked: false,
          completion_kind: completionKind,
          finalized_at: new Date().toISOString(),
        })
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
          .update({ locked: false, scheduled_date: null })
          .eq("plan_id", dayRow.plan_id)
          .eq("day_number", dayRow.day_number + 1);
      }
      return {
        result: "Workout finished and saved. Your next workout is unlocked.",
        dbChanged: true,
      };
    }

    case "start_timer": {
      const requestedMinutes = Number(args.minutes);
      const durationMinutes =
        Number.isFinite(requestedMinutes) && requestedMinutes > 0
          ? Math.min(Math.round(requestedMinutes), 180)
          : Math.max(1, ctx.day.estimated_minutes ?? 45);
      const durationSeconds = durationMinutes * 60;
      const currentExercise = findCurrentExercise(ctx);
      const currentLog = currentExercise ? ctx.logs.get(currentExercise.id) : undefined;
      const currentPlan = currentExercise ? effectivePlanForExercise(currentExercise, currentLog) : null;
      const currentSetLogs = currentExercise
        ? hydrateSetLogs(
            buildSetPlan(currentExercise),
            decodeExerciseLogMeta(currentLog?.notes ?? null),
            currentLog ?? undefined
          )
        : [];
      const timerSetNumber =
        currentExercise && currentPlan?.perSetMinutes != null
          ? getCurrentSetNumber(currentSetLogs, currentPlan)
          : null;
      return {
        result: `Timer started for ${durationMinutes} minutes.`,
        dbChanged: false,
        clientAction: {
          type: "start_timer",
          duration_seconds: durationSeconds,
          timer_exercise_id: timerSetNumber != null ? currentExercise?.id ?? null : null,
          timer_set_number: timerSetNumber,
        },
      };
    }
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
    case "stop_timer":
      return {
        result: "Timer stopped.",
        dbChanged: false,
        clientAction: { type: "stop_timer" },
      };

    default:
      return { result: `Unknown tool: ${name}`, dbChanged: false };
  }
}

export function buildRealtimeSessionConfig(
  instructions: string,
  model: string,
  voice: string,
  audioProfile: "bluetooth" | "speaker" = "bluetooth"
): Record<string, unknown> {
  return {
    type: "realtime",
    model,
    instructions,
    // Static instructions + retention_ratio truncation maximize implicit prompt cache hits.
    output_modalities: ["audio"],
    truncation: {
      type: "retention_ratio",
      retention_ratio: 0.8,
      token_limits: {
        post_instructions: 4000,
      },
    },
    audio: {
      input: {
        noise_reduction: { type: audioProfile === "bluetooth" ? "near_field" : "far_field" },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "medium",
          create_response: true,
          interrupt_response: true,
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
