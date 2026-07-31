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
  set_side_labels: string[] | null;
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
- Shooting and finishing drills are NEVER time-based; describe them only with sets, makes, and attempts. Ball-handling, defense, and conditioning drills use minutes per set.
- When the athlete asks about a drill or the current exercise, give the shortest answer that includes its sets and authoritative per-set target.
- For the active set, navigation.current_set_state is the single source of truth. Its progress is what the athlete has actually made and attempted in this set; its target is the prescribed makes and attempts for the whole set; its remaining is what is still required. These are different quantities. Never use progress.attempts as target.attempts, never use the denominator in "X for Y" as the set target, and never recalculate any of these fields yourself.
- Every drill in sequence.drills includes authoritative set_results and logged_totals, including drills other than the current drill. Use those exact values when asked about a named, previous, next, completed, or unfinished drill. Never claim another drill's set results are unavailable from the current view.
- Every set result includes side_label when that set is assigned to the left side or right side. Use the exact label when discussing, saving, completing, reopening, or navigating to that set. A null side_label means the set has no assigned side; never invent one. Resolve requests such as "the left-side set" to the set_number carrying that label.
- If the athlete asks for current makes, misses, attempts, or completion on any drill and the session may have changed since startup, call get_workout_position once and answer from its returned Authoritative workout state. Misses equal attempts minus makes for that same set or drill.
- Evaluate shooting honestly against the drill's makes target, not against the athlete's opinion or a generic percentage. Any result below target needs work; say that directly and never agree that a below-target result is good. At or below half the makes target is significantly below target, so be candid but constructive.
- When a shooting result is below target, briefly identify the exact gap and ask whether the athlete wants you to add a drill focused on that specific weakness. Asking is not permission: do not search for or add an exercise until they clearly say yes.
- After they approve adding weakness work, search using the weak drill's exact shot type, name, category, and useful description terms. The added drill MUST stay in the same category as the weak drill; for example, poor shooting can only add shooting, never finishing. Choose the closest relevant result within that category.
- When asked for recommended drills or what they should add, judge needs using only sets that are complete. A drill is usable evidence as soon as at least one set is complete; ignore every unfinished set rather than requiring the whole drill to be finished. If a completed set missed its target, recommend work matching that exact weakness and category. If all completed sets met their targets, say so and recommend a different focus that adds variety. If no sets are complete, say there is not enough performance data yet.
- Before recommending another drill, inspect the current workout for drills that already address each measured weakness. Think like a real coach: balance how far below target the athlete was against how much focused work is already present. Do not keep stacking near-duplicate drills for one weakness when one focused addition is enough and another weakness or new skill deserves attention. A severe, still-undercovered weakness may justify another complementary drill, but it must use a different movement or variation.
- Asking what you recommend is not permission to edit the workout. Only add after wording that clearly requests the addition, such as "add the recommended drill," or after the athlete accepts your offer.
- "What's next?" always means navigation.next_work_item: the first incomplete set of the current drill. Do not move to another drill until every set in the current drill is complete.
- "What drill/exercise comes after this?" means navigation.next_exercise_after_current. Never treat this as the answer to "what's next?"
- For progress, location, sequence, or next-action questions, call get_workout_position. Never infer a drill number; use the returned drill_position.
- If the athlete says "skip to [drill]," "go to [drill]," "jump to [drill]," or "switch to [drill]," this means navigate only: call set_current_drill.
- If they ask to skip the current drill and go to the next one, call skip_drill. Skipping is navigation only: it MUST leave every set, completion flag, make, attempt, minute, and note on the skipped drill unchanged. Never infer target makes as achieved results.
- For an exact named drill, provide drill_name and only include exercise_id when it is copied directly from current context. A natural drill reference takes precedence if the two conflict. They can return to earlier unfinished drills; never claim that switching is unavailable.
- Exercise IDs are internal implementation details. Never tell the athlete an ID is invalid, ask them to provide an ID, call it a bundle ID, or ask them to name an exercise if their speech already identifies it. Resolve "this," "that," "current," and "it" as the current drill; resolve a spoken drill name against the drill list. Ask only if two or more drills genuinely match.
- For relative references such as "last drill," "first drill," "drill 9," "next drill," "go back," or "previous drill," copy that exact phrase into drill_name and omit exercise_id unless you are certain. The server resolves position relative to the authoritative workout order; never guess an ID.
- Preserve reverse positions exactly too: "fifth to last," "5th to last," and "five from the end" are drill_name values, not failures or requests for clarification. The server counts them from the complete ordered drill list.
- For requests like "go to the last drill and mark both sets as 0 makes," first call set_current_drill with drill_name "last drill," then call set_shooting_total once for each set with 0 makes and the stated or authoritative attempts. Later calls use the newly active drill.
- A single athlete request may require several actions. Make every needed tool call, in dependency order, and wait for each result before the next call so later actions use the latest saved workout state.
- Every tool result includes an Authoritative workout state snapshot. Use that snapshot silently for the rest of the turn. Do not call get_workout_position again after a tool result unless the athlete explicitly asks for a new progress/location check or the returned state is ambiguous.
- For a progress, location, or “what's next” question, call get_workout_position at most once, then answer directly from its result. Never say “let me check the workout state” aloud.
- Use drill_description and coaching_notes from context when the athlete needs a drill explanation. Do not tell them to watch an in-app video.
- For drill-list questions, call list_workout_drills with an optional category (e.g. shooting) if helpful.
- When the athlete asks to add or remove workout exercises, use search_exercise_catalog, add_workout_exercise, and remove_workout_exercise. Search before adding. After editing, briefly name every exercise added or removed; never answer with only "workout updated."
- When they want to remember something about a drill, call save_note with the natural drill reference and note.
- During Realtime, the shooting tracking tools update fast session-local progress first; they do not write to the database until the set reaches its attempt target, the athlete explicitly finishes or moves on, changes drills, or closes the coach.
- Speak about buffered shooting exactly like ordinary workout progress. Never call it unsaved, buffered, local, temporary, session progress, or session-only progress.
- After an ordinary partial make, miss, or shooting total, respond with exactly: "You're X for Y, N shots left." Say nothing before or after it: no acknowledgment, encouragement, praise, reaction, drill name, set number, makes remaining, advice, evaluation, or filler.
- Always say shooting results as "X for Y." Never say "X slash Y," "X over Y," "X comma Y," or read the two numbers without the word "for."
- Use record_make for exactly one made shot and record_miss for exactly one missed shot. These tools hard-code one attempt, so never use a numeric result tool for the single words "make" or "miss."
- "Make," "Made another," "another make," "made one," and "one make" each mean record_make exactly once. "Miss," "Missed another," "another miss," and "missed one" each mean record_miss exactly once.
- For "made N in a row," "made N straight," or another statement that N consecutive shots were made, call record_makes once with count N. This deterministically adds N makes and N attempts to the current set; do not ask for a total.
- For "missed N in a row," "missed N straight," or another statement that N consecutive shots were missed, call record_misses once with count N. This deterministically adds 0 makes and N attempts to the current set; do not ask for a total.
- If one utterance reports a mixed multi-shot result with explicit makes and attempts, such as "2 for 3," use one add_shooting_result call instead of repeating a single-shot tool.
- Use add_shooting_result only when the athlete explicitly gives both makes and attempts, such as "another 2 for 3" or "I just made 2 of 3." Never invent a denominator. Use set_shooting_total only for an absolute cumulative total such as "I'm 6 for 10."
- Keep a partial shooting set current. If asked what's next while buffered shots remain below the attempt target, call get_workout_position and explain the exact shots and makes remaining from its result. Do not advance unless they explicitly ask to move on or finish.
- When saving a shooting set, save only the athlete's actual cumulative makes and actual cumulative attempts for that set. Never save the prescribed target makes, target attempts, remaining makes, remaining attempts, or any other numbers as the result. If the actual result is not known, ask the athlete instead of substituting the target.
- Set completed true only when the athlete explicitly says they are done early. The session automatically recognizes and saves a set when cumulative attempts reach the target.
- After a set saves, say: "Set saved. You shot X for Y. Next up: ..." Use navigation.next_work_item from the post-save state without inference. If it is another set of the same exercise, announce that set; only announce the next exercise after every set in the current exercise is complete. Never skip a set.
- When they complete or reopen one specific set, call set_set_completion. This includes timed ball-handling, defense, and conditioning sets.
- Call complete_drill only when they explicitly say they finished the entire drill. Permission-style wording such as "can I skip this drill and go to the next one?" is a skip, not completion. Call uncomplete_drill when they want to reopen the entire drill. When they want to skip, call skip_drill.
- A workout is complete ONLY when progress.remaining_drills is 0. Never decide it is complete based on the current drill's position, the last chronological drill, or next_exercise_after_current being null. Earlier incomplete drills always remain required.
- Use get_workout_position or get_progress when you need fresh workout state.
- Use extend_workout or shorten_workout to change remaining workout time.
- start_timer starts the current timed set, never the whole workout. When no minutes are specified (for example, "start a timer for that set"), the server uses the active ball-handling, defense, or conditioning set's authoritative per_set_minutes value. Pass minutes only when the athlete explicitly requests a different duration. If the active set is shooting or finishing and no duration was requested, ask for a duration instead of starting a workout-length timer.
- Tool results can contain internal updated_workout_state data. Never mention, summarize, or paraphrase internal state, context, alignment, refreshes, JSON, or tool execution. After a tool runs, say only a brief natural confirmation of the action result (e.g. "Saved 8 of 10 for set one.").`;

const DRILL_REFERENCE_PROPERTIES = {
  exercise_id: {
    type: "string",
    description: "Optional exact internal exercise ID. Omit rather than guessing.",
  },
  drill_name: {
    type: "string",
    description:
      "The athlete's spoken drill reference, preserved naturally: exact name, first drill, last drill, fifth to last, 5th from the end, next drill, previous drill, go back, current drill, or drill number.",
  },
};

const REALTIME_TOOL_DEFS = [
  {
    name: "record_make",
    description:
      "Record exactly one made shot in fast session-local progress. This always adds exactly 1 make and 1 attempt.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: {
          type: "number",
          description: "Optional 1-based set number; defaults to the current set.",
        },
      },
    },
  },
  {
    name: "record_miss",
    description:
      "Record exactly one missed shot in fast session-local progress. This always adds exactly 0 makes and 1 attempt.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: {
          type: "number",
          description: "Optional 1-based set number; defaults to the current set.",
        },
      },
    },
  },
  {
    name: "record_makes",
    description:
      "Record N consecutive made shots in fast session-local progress. This deterministically adds count makes and count attempts.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        count: {
          type: "number",
          description: "The explicit positive whole-number count in 'made N in a row.'",
        },
        set_number: {
          type: "number",
          description: "Optional 1-based set number; defaults to the current set.",
        },
      },
      required: ["count"],
    },
  },
  {
    name: "record_misses",
    description:
      "Record N consecutive missed shots in fast session-local progress. This deterministically adds zero makes and count attempts.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        count: {
          type: "number",
          description: "The explicit positive whole-number count in 'missed N in a row.'",
        },
        set_number: {
          type: "number",
          description: "Optional 1-based set number; defaults to the current set.",
        },
      },
      required: ["count"],
    },
  },
  {
    name: "add_shooting_result",
    description:
      "Add a multi-shot result to existing session progress, such as 'another 2 for 3' or 'I just made 2 of 3.'",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        makes: { type: "number" },
        attempts: { type: "number" },
        set_number: {
          type: "number",
          description:
            "1-based set number; defaults to current set. For a spoken left/right side, use the set_number whose side_label matches.",
        },
      },
      required: ["makes", "attempts"],
    },
  },
  {
    name: "set_shooting_total",
    description:
      "Replace the current set's cumulative progress with an explicitly stated total such as 'I'm 6 for 10.' Never use for make, miss, another, or just made.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        makes: { type: "number" },
        attempts: { type: "number" },
        set_number: {
          type: "number",
          description:
            "1-based set number; defaults to current set. For a spoken left/right side, use the matching set number.",
        },
        completed: {
          type: "boolean",
          description:
            "True only when the athlete explicitly says they are done early. Target attempts complete automatically.",
        },
      },
      required: ["makes", "attempts"],
    },
  },
  {
    name: "set_set_completion",
    description:
      "Mark one specific set complete or incomplete without changing every set in the drill. Use for timed and ball-handling sets.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: {
          type: "number",
          description:
            "The 1-based set number to update. Resolve spoken left/right side from that drill's side_label.",
        },
        completed: { type: "boolean" },
      },
      required: ["set_number", "completed"],
    },
  },
  {
    name: "complete_drill",
    description: "Mark every set in the current drill complete.",
    parameters: {
      type: "object",
      properties: { ...DRILL_REFERENCE_PROPERTIES },
    },
  },
  {
    name: "uncomplete_drill",
    description: "Reopen an entire completed drill and clear all of its completed sets.",
    parameters: {
      type: "object",
      properties: { ...DRILL_REFERENCE_PROPERTIES },
    },
  },
  {
    name: "skip_drill",
    description:
      "Move to the next unfinished drill while leaving the current drill and all of its set results completely unchanged. Skipping never marks completion and never records target makes.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        reason: { type: "string" },
      },
    },
  },
  {
    name: "save_note",
    description: "Save a note on a specific drill when the athlete wants to remember something.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        note: { type: "string", description: "Short note to attach to this drill." },
      },
      required: ["note"],
    },
  },
  {
    name: "search_exercise_catalog",
    description:
      "Search active exercises that can be added to this workout. Weakness results are restricted to the weak drill's exact category; include its shot type or name, not only a broad category. Call only after the athlete approves adding a drill, and always call before add_workout_exercise.",
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
    description:
      "Add one catalog exercise returned by search_exercise_catalog only after the athlete explicitly requested an addition or accepted the coach's immediately preceding offer.",
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
        ...DRILL_REFERENCE_PROPERTIES,
      },
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
      "Fetch authoritative current-set state with explicitly separate progress, target, and remaining values, plus navigation and ordered drills. Use for current totals, targets, where-am-I, what's-next, and workout-sequence questions.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "set_current_drill",
    description:
      "Switch the active workout drill without completing or skipping any other drills. Use the exact exercise_id from workout context and the drill's exact name. The server will resolve the name if the ID is stale or malformed.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
      },
      required: ["drill_name"],
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
      "Start a countdown for the active timed set. With no minutes, the server uses the current set's configured duration; it never defaults to the whole workout. Pass minutes only for an explicit requested duration.",
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
        ...DRILL_REFERENCE_PROPERTIES,
        makes: { type: "number" },
        attempts: { type: "number", description: "Optional; defaults to saved attempts for this set." },
        set_number: {
          type: "number",
          description: "Which set (1-based). Defaults to current_set from context.",
        },
        completed: {
          type: "boolean",
          description: "True if this set finishes the drill (all sets done or user is done with it)",
        },
      },
      required: ["makes"],
    },
  },
  {
    name: "complete_drill",
    description: "Mark a drill complete when the user says they finished it.",
    parameters: {
      type: "object",
      properties: { ...DRILL_REFERENCE_PROPERTIES },
    },
  },
  {
    name: "uncomplete_drill",
    description:
      "Mark a completed drill as not done when the user wants to redo it or accidentally marked it complete.",
    parameters: {
      type: "object",
      properties: { ...DRILL_REFERENCE_PROPERTIES },
    },
  },
  {
    name: "skip_drill",
    description:
      "Move to the next unfinished drill without changing completion or results on the current drill. Never save target makes when skipping.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        reason: { type: "string", description: "Short reason, e.g. 'user tired'" },
      },
    },
  },
  {
    name: "save_note",
    description: "Attach a note to a drill when the user says something worth remembering.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        note: { type: "string" },
      },
      required: ["note"],
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
      "Start a countdown for the active timed set. With no minutes, the server uses the current set's configured duration; it never defaults to the whole workout. Pass minutes only for an explicit requested duration.",
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
      "id, order_index, name, category, instructions, sets, reps, duration, target_makes, target_attempts, log_type, set_side_labels, video_clip:exercise_video_clips(youtube_video_id, description, coaching_notes)"
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

function drillInstructionContext(row: ExerciseRow) {
  const clip = resolveClip(row);
  return {
    drill_description: clip?.description ?? row.instructions ?? null,
    coaching_notes: clip?.coaching_notes ?? null,
  };
}

function setSideLabel(
  exercise: ExerciseRow | null | undefined,
  setNumber: number | null
): string | null {
  if (!exercise || setNumber == null || setNumber < 1) return null;
  const label = exercise.set_side_labels?.[setNumber - 1];
  return typeof label === "string" && label.trim() ? label.trim() : null;
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
    (ex.category === "ball_handling" || ex.category === "defense" || ex.category === "conditioning")
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
    const instructions = drillInstructionContext(ex);

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
      per_set_minutes_override: isTimedExercise(ex)
        ? meta.per_set_minutes_override ?? null
        : null,
      completed: totals.completed,
      logged_makes: totals.makes,
      logged_attempts: totals.attempts,
      current_set: currentSet,
      current_set_side_label: setSideLabel(ex, currentSet),
      set_logs: totals.set_logs.map((set) => {
        const hasProgress = set.makes != null || set.completed;
        const progressMakes = hasProgress ? set.makes ?? 0 : 0;
        const progressAttempts = hasProgress ? set.attempts ?? 0 : 0;
        return {
          set_number: set.set_number,
          side_label: setSideLabel(ex, set.set_number),
          completed: set.completed,
          progress: {
            makes: progressMakes,
            attempts: progressAttempts,
            misses: Math.max(0, progressAttempts - progressMakes),
          },
          target: {
            makes: plan.perSetMakes,
            attempts: plan.perSetAttempts,
          },
          remaining: {
            makes:
              plan.perSetMakes == null ? null : Math.max(0, plan.perSetMakes - progressMakes),
            attempts:
              plan.perSetAttempts == null
                ? null
                : Math.max(0, plan.perSetAttempts - progressAttempts),
          },
          minutes: set.minutes,
        };
      }),
      notes: meta.user_notes ?? null,
      drill_description: instructions.drill_description,
      coaching_notes: instructions.coaching_notes,
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
          current_set_side_label: current.current_set_side_label,
          sets_total: current.sets_total,
          per_set_target_makes: current.per_set_target_makes,
          per_set_target_attempts: current.per_set_target_attempts,
          current_set_state:
            current.set_logs.find((set) => set.set_number === current.current_set) ?? null,
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
  const instructions = drillInstructionContext(ex);
  return {
    sets_total: plan.setCount,
    per_set_target_makes: plan.perSetMakes,
    per_set_target_attempts: plan.perSetAttempts,
    per_set_minutes: isTimedExercise(ex) ? plan.perSetMinutes : null,
    log_type: ex.log_type,
    drill_description: instructions.drill_description,
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
  drill_description: string | null;
} {
  const plan = effectivePlanForExercise(ex, log);
  const meta = decodeExerciseLogMeta(log?.notes ?? null);
  const setLogs = hydrateSetLogs(buildSetPlan(ex), meta, log ?? undefined);
  const totals = aggregateSetLogs(setLogs, plan);
  const instructions = drillInstructionContext(ex);
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
    drill_description: instructions.drill_description,
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
  const from = Math.max(0, startIdx);
  const isOtherIncomplete = (state: OrderedDrillState) =>
    !state.totals.completed && state.exercise.id !== afterId;
  return (
    states.slice(from).find(isOtherIncomplete)?.exercise ??
    states.slice(0, from).find(isOtherIncomplete)?.exercise ??
    null
  );
}

function drillContext(state: OrderedDrillState) {
  const { exercise, position, plan, totals } = state;
  const instructions = drillInstructionContext(exercise);
  const completedSets = totals.set_logs.filter((set) => set.completed).length;
  const nextUnfinishedSet = getCurrentSetNumber(totals.set_logs, plan);
  const setsWithProgress = totals.set_logs.filter(
    (set) => set.makes != null || set.completed
  );
  const actualMakes = setsWithProgress.reduce(
    (sum, set) => sum + (set.makes ?? 0),
    0
  );
  const actualAttempts = setsWithProgress.reduce(
    (sum, set) => sum + (set.attempts ?? 0),
    0
  );
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
    set_results: totals.set_logs.map((set) => {
      const hasProgress = set.makes != null || set.completed;
      const progressMakes = hasProgress ? set.makes ?? 0 : 0;
      const progressAttempts = hasProgress ? set.attempts ?? 0 : 0;
      return {
        set_number: set.set_number,
        side_label: setSideLabel(exercise, set.set_number),
        completed: set.completed,
        makes: progressMakes,
        attempts: progressAttempts,
        misses: Math.max(0, progressAttempts - progressMakes),
        progress: {
          makes: progressMakes,
          attempts: progressAttempts,
          misses: Math.max(0, progressAttempts - progressMakes),
        },
        target: {
          makes: plan.perSetMakes,
          attempts: plan.perSetAttempts,
        },
        remaining: {
          makes:
            plan.perSetMakes == null ? null : Math.max(0, plan.perSetMakes - progressMakes),
          attempts:
            plan.perSetAttempts == null
              ? null
              : Math.max(0, plan.perSetAttempts - progressAttempts),
        },
        minutes: set.minutes,
        target_comparison:
          set.makes == null || plan.perSetMakes == null || plan.perSetMakes <= 0
            ? null
            : {
                status:
                  set.makes >= plan.perSetMakes
                    ? "target_met"
                    : set.makes <= plan.perSetMakes / 2
                      ? "significantly_below_target"
                      : "below_target",
                makes_below_target: Math.max(0, plan.perSetMakes - set.makes),
                percent_of_makes_target: Math.round((set.makes / plan.perSetMakes) * 100),
              },
      };
    }),
    logged_totals: {
      makes: setsWithProgress.length > 0 ? actualMakes : null,
      attempts: setsWithProgress.length > 0 ? actualAttempts : null,
      misses:
        setsWithProgress.length > 0 ? Math.max(0, actualAttempts - actualMakes) : null,
    },
    target: {
      makes: plan.perSetMakes,
      attempts: plan.perSetAttempts,
      minutes: isTimedExercise(exercise) ? plan.perSetMinutes : null,
    },
    log_type: exercise.log_type,
    instructions: (exercise.instructions ?? "").slice(0, 240),
    drill_description: instructions.drill_description,
  };
}

export function buildWorkoutNavigation(ctx: WorkoutContext) {
  const states = orderedDrillStates(ctx);
  const currentIndex = currentDrillIndex(states, ctx.day.active_exercise_id);
  const current = currentIndex >= 0 ? states[currentIndex] : null;
  const nextExercise = current
    ? findNextExercise(ctx, current.exercise.id)
    : states.find((state) => !state.totals.completed)?.exercise ?? null;
  const nextState = nextExercise
    ? states.find((state) => state.exercise.id === nextExercise.id) ?? null
    : null;

  const nextWorkItem = current
    ? {
        kind: "set",
        ...drillContext(current),
        set_number: getCurrentSetNumber(current.totals.set_logs, current.plan),
        set_side_label: setSideLabel(
          current.exercise,
          getCurrentSetNumber(current.totals.set_logs, current.plan)
        ),
      }
    : null;
  const currentSetResult =
    nextWorkItem?.set_number == null
      ? null
      : nextWorkItem.set_results.find(
          (set) => set.set_number === nextWorkItem.set_number
        ) ?? null;
  const currentSetState =
    nextWorkItem && currentSetResult
      ? {
          exercise_id: nextWorkItem.exercise_id,
          drill_name: nextWorkItem.name,
          set_number: nextWorkItem.set_number,
          side_label: nextWorkItem.set_side_label,
          completed: currentSetResult.completed,
          progress: currentSetResult.progress,
          target: currentSetResult.target,
          remaining: currentSetResult.remaining,
        }
      : null;

  return {
    ordering: "category_grouped_display_order",
    drills: states.map(drillContext),
    next_work_item: nextWorkItem,
    current_set_state: currentSetState,
    next_exercise_after_current: nextState
      ? {
          kind: "exercise",
          ...drillContext(nextState),
          first_set_number: getCurrentSetNumber(nextState.totals.set_logs, nextState.plan),
          first_set_side_label: setSideLabel(
            nextState.exercise,
            getCurrentSetNumber(nextState.totals.set_logs, nextState.plan)
          ),
        }
      : null,
    remaining_drills: states
      .filter((state) => !state.totals.completed)
      .map(drillContext),
    workout_complete: states.length > 0 && states.every((state) => state.totals.completed),
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

interface CatalogSearchClip {
  id: string;
  exercise_name: string | null;
  category: string | null;
  difficulty_level: string | null;
  description: string | null;
  coaching_notes: string | null;
  requires_both_sides?: boolean | null;
}

function normalizeCatalogSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b3(?:s|'s)?\b/g, " three ")
    .replace(/\b(?:3|three)[- ]pointer(?:s)?\b/g, " three point ")
    .replace(/\b3[- ]point/g, " three point ")
    .replace(/\bthrees\b/g, " three ")
    .replace(/mid[- ]range/g, " midrange ")
    .replace(/ball[- ]handling/g, " handles ")
    .replace(/free[- ]throws?/g, " free throw ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function meaningfulSearchTokens(value: string): string[] {
  const ignored = new Set([
    "a",
    "add",
    "another",
    "drill",
    "drills",
    "exercise",
    "exercises",
    "focus",
    "focused",
    "for",
    "help",
    "improve",
    "like",
    "me",
    "more",
    "my",
    "on",
    "please",
    "recommend",
    "recommended",
    "recommendation",
    "similar",
    "suggest",
    "suggested",
    "that",
    "the",
    "this",
    "to",
    "weakness",
    "work",
  ]);
  return [...new Set(normalizeCatalogSearchText(value).split(/\s+/).filter(
    (token) => token.length > 1 && !ignored.has(token)
  ))];
}

function weakestScoringFocus(
  ctx: WorkoutContext,
  queryTokens: string[]
): {
  text: string;
  category: string | null;
  overlap: number;
  relatedCoverage: number;
} | null {
  const evaluated = buildWorkoutNavigation(ctx).drills
    .filter((drill) => drill.sets.completed > 0 && isShootingDrill(drill))
    .flatMap((drill) =>
      drill.set_results
        .filter(
          (set) =>
            set.completed &&
            set.makes != null &&
            drill.target.makes != null &&
            drill.target.makes > 0 &&
            set.makes < drill.target.makes
        )
        .map((set) => ({
          ratio: (set.makes ?? 0) / (drill.target.makes ?? 1),
          text: `${drill.name ?? ""} ${drill.category ?? ""} ${drill.instructions ?? ""} ${
            drill.drill_description ?? ""
          }`,
          category: drill.category,
          exerciseId: drill.exercise_id,
        }))
    )
    .map((focus) => ({
      ...focus,
      overlap: queryTokens.filter((token) =>
        meaningfulSearchTokens(focus.text).includes(token)
      ).length,
      relatedCoverage: ctx.exercises.filter((exercise) => {
        if (exercise.id === focus.exerciseId || exercise.category !== focus.category) return false;
        const exerciseTokens = meaningfulSearchTokens(
          `${exercise.name ?? ""} ${exercise.instructions ?? ""}`
        );
        const focusTokens = meaningfulSearchTokens(focus.text);
        return focusTokens.filter((token) => exerciseTokens.includes(token)).length >= 2;
      }).length,
    }))
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        a.ratio + a.relatedCoverage * 0.45 -
          (b.ratio + b.relatedCoverage * 0.45)
    );
  return evaluated[0] ?? null;
}

/** Rank catalog results by the requested skill and the workout's weakest matching shooting result. */
export function rankCatalogExercises(
  rawQuery: string,
  catalog: CatalogSearchClip[],
  ctx: WorkoutContext
): CatalogSearchClip[] {
  const query = normalizeCatalogSearchText(rawQuery);
  const queryTokens = meaningfulSearchTokens(rawQuery);
  const weaknessFocus = weakestScoringFocus(ctx, queryTokens);
  const weaknessTokens = meaningfulSearchTokens(weaknessFocus?.text ?? "");
  const existingNames = new Set(
    ctx.exercises.map((exercise) => normalizeCatalogSearchText(exercise.name ?? "")).filter(Boolean)
  );
  const broadTerms = new Set([
    "basketball",
    "conditioning",
    "defense",
    "finishing",
    "handles",
    "shooting",
  ]);
  const hasSpecificQuery = queryTokens.some((token) => !broadTerms.has(token));
  const useWeaknessFocus =
    weaknessTokens.length > 0 &&
    (!hasSpecificQuery ||
      (weaknessFocus?.overlap ?? 0) > 0 ||
      /\b(?:weak|weakness|similar|like|more)\b/i.test(rawQuery));
  const requestedCategory = queryTokens.includes("shooting")
    ? "shooting"
    : queryTokens.includes("finishing")
      ? "finishing"
      : queryTokens.includes("handles") || queryTokens.includes("dribbling")
        ? "ball_handling"
        : queryTokens.includes("defense")
          ? "defense"
          : queryTokens.includes("conditioning")
            ? "conditioning"
            : null;
  const requiredCategory =
    requestedCategory ?? (useWeaknessFocus ? weaknessFocus?.category ?? null : null);
  const recommendationIntent =
    /\b(?:recommend(?:ed|ation)?|suggest(?:ed|ion)?|what should i add)\b/i.test(rawQuery);
  const completedCategories = buildWorkoutNavigation(ctx).drills
    .filter(
      (drill) =>
        drill.sets.completed > 0 &&
        drill.category != null &&
        !["warmup", "cooldown"].includes(drill.category)
    )
    .map((drill) => drill.category as string);
  const completedCategoryCounts = new Map<string, number>();
  for (const category of completedCategories) {
    completedCategoryCounts.set(category, (completedCategoryCounts.get(category) ?? 0) + 1);
  }
  const workoutCategories = new Set(
    ctx.exercises.map((exercise) => exercise.category).filter(
      (category): category is string => category != null
    )
  );

  return catalog
    .filter((clip) => !requiredCategory || clip.category === requiredCategory)
    .map((clip) => {
      const name = normalizeCatalogSearchText(clip.exercise_name ?? "");
      const category = normalizeCatalogSearchText(clip.category ?? "");
      const details = normalizeCatalogSearchText(
        `${clip.description ?? ""} ${clip.coaching_notes ?? ""}`
      );
      let score = 0;
      for (const token of queryTokens) {
        if (name.includes(token)) score += 10;
        else if (category.includes(token)) score += 7;
        else if (details.includes(token)) score += 3;
      }
      if (query.length >= 4 && name.includes(query)) score += 18;
      if (requestedCategory && clip.category === requestedCategory) score += 12;
      if (useWeaknessFocus) {
        for (const token of weaknessTokens) {
          if (name.includes(token)) score += 5;
          else if (details.includes(token)) score += 2;
        }
      }
      if (
        recommendationIntent &&
        !useWeaknessFocus &&
        completedCategories.length > 0 &&
        clip.category
      ) {
        const completedCount = completedCategoryCounts.get(clip.category) ?? 0;
        score += Math.max(2, 14 - completedCount * 4);
        if (!workoutCategories.has(clip.category)) score += 12;
      }
      return { clip, score };
    })
    .filter(({ clip, score }) => score > 0 && !existingNames.has(
      normalizeCatalogSearchText(clip.exercise_name ?? "")
    ))
    .sort((a, b) =>
      b.score - a.score ||
      String(a.clip.exercise_name ?? "").localeCompare(String(b.clip.exercise_name ?? ""))
    )
    .slice(0, 8)
    .map(({ clip }) => clip);
}

/** Compact context for Realtime sessions — full drill list plus current/next drill. */
export function buildCompactContextSummary(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer: TimerState | undefined,
  conversationSummary?: string | null
): string {
  const navigation = buildWorkoutNavigation(ctx);
  let totalMakes = 0;
  let totalAttempts = 0;
  let completedCount = 0;
  for (const drill of navigation.drills) {
    if (drill.status === "complete") completedCount += 1;
    if (drill.logged_totals.makes != null) totalMakes += drill.logged_totals.makes;
    if (drill.logged_totals.attempts != null) totalAttempts += drill.logged_totals.attempts;
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
      current_set_state: navigation.current_set_state,
      next_exercise_after_current: navigation.next_exercise_after_current,
    },
    progress: {
      completed_drills: completedCount,
      total_drills: navigation.drills.length,
      remaining_drills: navigation.drills.length - completedCount,
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
  conversationSummary?: string | null,
  coachName = "Coach Tyler"
): string {
  return `Your name is ${coachName}. If asked, introduce yourself by that name.

${COACH_SYSTEM_PROMPT}

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
      current_set_state: navigation.current_set_state,
      next_exercise_after_current: navigation.next_exercise_after_current,
    },
    progress: {
      completed_drills: completedDrills,
      total_drills: navigation.drills.length,
      remaining_drills: navigation.remaining_drills.length,
      workout_complete: navigation.workout_complete,
    },
  });
}

export function buildProgressSummary(ctx: WorkoutContext): string {
  let totalMakes = 0;
  let totalAttempts = 0;
  const navigation = buildWorkoutNavigation(ctx);
  for (const drill of navigation.drills) {
    if (drill.logged_totals.makes != null) totalMakes += drill.logged_totals.makes;
    if (drill.logged_totals.attempts != null) totalAttempts += drill.logged_totals.attempts;
  }
  const pct = totalAttempts > 0 ? Math.round((totalMakes / totalAttempts) * 100) : null;
  const completedCount = navigation.drills.filter((drill) => drill.status === "complete").length;
  return `${completedCount}/${navigation.drills.length} drills done, ${totalMakes} for ${totalAttempts} shooting${
    pct != null ? ` (${pct}%)` : ""
  }.`;
}

export function buildWorkoutPositionSummary(ctx: WorkoutContext): string {
  const navigation = buildWorkoutNavigation(ctx);
  const workItem = navigation.next_work_item;
  if (!workItem) return "Workout complete — no unfinished sets remain.";

  const state = navigation.current_set_state;
  const shootingState =
    state?.target.makes != null || state?.target.attempts != null
      ? ` Actual progress: ${state.progress.makes} makes in ${state.progress.attempts} attempts. Prescribed whole-set target: ${state.target.makes ?? "none"} makes in ${state.target.attempts ?? "none"} attempts. Remaining: ${state.remaining.makes ?? "unknown"} makes and ${state.remaining.attempts ?? "unknown"} attempts.`
      : "";
  const timedTarget =
    workItem.target.minutes != null
      ? ` Target: ${workItem.target.minutes} minute${workItem.target.minutes === 1 ? "" : "s"}.`
      : "";
  const after = navigation.next_exercise_after_current;
  return [
    `Current work: drill ${workItem.drill_position} of ${navigation.drills.length}, ${
      workItem.name ?? "unnamed drill"
    }, set ${workItem.set_number} of ${workItem.sets.total}${
      workItem.set_side_label ? ` (${workItem.set_side_label})` : ""
    }.${shootingState}${timedTarget}`,
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
  const normalizeDrillName = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b3(?:s|'s)?\b/g, " three ")
      .replace(/\bthree[- ]pointer(?:s)?\b/g, " three ")
      .replace(/mid[- ]range/g, " midrange ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const resolveWorkoutExercise = (
    id: unknown,
    drillName: unknown
  ): { id: string | null; ambiguous: boolean } => {
    const states = orderedDrillStates(ctx);
    const query = typeof drillName === "string" ? normalizeDrillName(drillName) : "";
    const currentIndex = currentDrillIndex(states, ctx.day.active_exercise_id);
    const activeIndex = ctx.day.active_exercise_id
      ? states.findIndex((state) => state.exercise.id === ctx.day.active_exercise_id)
      : currentIndex;
    const anchorIndex = activeIndex >= 0 ? activeIndex : currentIndex;
    const ordinalWords: Record<string, number> = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
      fifth: 5,
      sixth: 6,
      seventh: 7,
      eighth: 8,
      ninth: 9,
      tenth: 10,
    };
    const ordinalPosition = (value: string): number | null => {
      const numericMatch = value.match(/^(\d+)(?:st|nd|rd|th)?$/);
      if (numericMatch) return Number(numericMatch[1]);
      return ordinalWords[value] ?? null;
    };

    if (query) {
      if (/^(?:the )?(?:current|this|that|it)(?: drill| exercise)?$/.test(query)) {
        return {
          id: currentIndex >= 0 ? states[currentIndex].exercise.id : null,
          ambiguous: false,
        };
      }
      if (/^(?:go )?back$|^(?:the )?(?:previous|prior)(?: drill| exercise)?$/.test(query)) {
        for (let index = anchorIndex - 1; index >= 0; index -= 1) {
          if (!states[index].totals.completed) {
            return { id: states[index].exercise.id, ambiguous: false };
          }
        }
        return { id: null, ambiguous: false };
      }
      if (/^(?:the )?(?:first|beginning)(?: drill| exercise)?$/.test(query)) {
        return { id: states[0]?.exercise.id ?? null, ambiguous: false };
      }
      if (/^(?:the )?(?:last|final)(?: drill| exercise)?$/.test(query)) {
        return { id: states[states.length - 1]?.exercise.id ?? null, ambiguous: false };
      }
      const fromEndMatch = query.match(
        /\b(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:to|from)\s+(?:the )?(?:last|end)(?: drill| exercise)?(?: of (?:the )?workout)?\b/
      );
      if (fromEndMatch) {
        const positionFromEnd = ordinalPosition(fromEndMatch[1]);
        if (positionFromEnd && positionFromEnd <= states.length) {
          return {
            id: states[states.length - positionFromEnd].exercise.id,
            ambiguous: false,
          };
        }
        return { id: null, ambiguous: false };
      }
      if (/^(?:the )?next(?: drill| exercise)?$/.test(query)) {
        const next = findNextExercise(ctx, states[anchorIndex]?.exercise.id);
        return { id: next?.id ?? null, ambiguous: false };
      }
      const ordinalMatch = query.match(
        /^(?:the )?(?:drill|exercise|number|no)?\s*(\d+)(?:st|nd|rd|th)?$/
      );
      if (ordinalMatch) {
        const position = Number(ordinalMatch[1]);
        if (position >= 1 && position <= states.length) {
          return { id: states[position - 1].exercise.id, ambiguous: false };
        }
      }
    }

    const exactId =
      typeof id === "string" && ctx.exercises.some((exercise) => exercise.id === id)
        ? id
        : null;
    if (!query && exactId) return { id: exactId, ambiguous: false };
    const nameQuery = query || (typeof id === "string" ? normalizeDrillName(id) : "");
    if (!nameQuery) return { id: null, ambiguous: false };
    const exactMatches = ctx.exercises.filter(
      (exercise) => normalizeDrillName(exercise.name ?? "") === nameQuery
    );
    if (exactMatches.length === 1) return { id: exactMatches[0].id, ambiguous: false };
    const partialMatches = ctx.exercises.filter((exercise) => {
      const name = normalizeDrillName(exercise.name ?? "");
      return name.includes(nameQuery) || nameQuery.includes(name);
    });
    if (partialMatches.length === 0 && exactId) {
      return { id: exactId, ambiguous: false };
    }
    return {
      id: partialMatches.length === 1 ? partialMatches[0].id : null,
      ambiguous: exactMatches.length > 1 || partialMatches.length > 1,
    };
  };
  const validExercise = (reference: unknown, drillName?: unknown): string | null => {
    const resolved = resolveWorkoutExercise(reference, drillName);
    if (resolved.id) return resolved.id;
    // The tool schema carries an exercise ID, but normal conversational
    // requests often mean "this/current drill." Only use that fallback when
    // no usable reference was provided; a mismatched name must not silently
    // modify the wrong drill.
    if (typeof reference === "string" && reference.trim()) return null;
    return findCurrentDrillState(ctx)?.exercise.id ?? null;
  };
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
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) return { result: "I couldn't uniquely match that workout drill.", dbChanged: false };
      const makes = Number(args.makes ?? 0);
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
      const selectedSet = setLogs.find((set) => set.set_number === setNumber);
      const requestedAttempts = Number(args.attempts);
      const attempts =
        Number.isFinite(requestedAttempts) && requestedAttempts > 0
          ? requestedAttempts
          : selectedSet?.attempts ?? plan.perSetAttempts ?? 0;

      const setCompleted =
        typeof args.completed === "boolean"
          ? args.completed
          : attempts > 0;

      setLogs = updateSetLog(setLogs, plan, setNumber, {
        makes,
        attempts,
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
      const targetResult =
        plan.perSetMakes == null
          ? ""
          : ` Target: ${plan.perSetMakes}${
              plan.perSetAttempts == null ? "" : ` for ${plan.perSetAttempts}`
            }; ${
              makes >= plan.perSetMakes
                ? "target met"
                : makes <= plan.perSetMakes / 2
                  ? "significantly below target and needs work"
                  : "below target and needs work"
            }.`;
      const nextSetNumber = getCurrentSetNumber(totals.set_logs, plan);
      const nextSetResult =
        nextSetNumber == null
          ? ""
          : ` Next up: set ${nextSetNumber}${
              setSideLabel(ex, nextSetNumber)
                ? ` (${setSideLabel(ex, nextSetNumber)})`
                : ""
            } of ${ex.name ?? "this drill"}.`;
      return {
        result: `Saved set ${setNumber}${
          setSideLabel(ex, setNumber) ? ` (${setSideLabel(ex, setNumber)})` : ""
        }: ${makes} for ${attempts}.${targetResult}${nextSetResult}`,
        dbChanged: true,
      };
    }

    case "set_set_completion": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) return { result: "I couldn't uniquely match that workout drill.", dbChanged: false };
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
        result: `Set ${requestedSet}${
          setSideLabel(ex, requestedSet) ? ` (${setSideLabel(ex, requestedSet)})` : ""
        } of ${ex.name ?? "the drill"} marked ${completed ? "complete" : "incomplete"}.`,
        dbChanged: true,
      };
    }

    case "get_workout_position":
    // Retained for an in-flight session that received the prior tool schema.
    case "get_next_drill":
      return { result: buildWorkoutPositionSummary(ctx), dbChanged: false };

    case "set_current_drill": {
      const resolved = resolveWorkoutExercise(args.exercise_id, args.drill_name);
      const exerciseId = resolved.id;
      if (!exerciseId) {
        return {
          result: resolved.ambiguous
            ? "More than one workout drill matches that name. Ask which exact drill they mean."
            : "That drill is not in this workout. Use the exact name from the current workout list.",
          dbChanged: false,
        };
      }
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
      const sideLabel = setSideLabel(targetState.exercise, setNumber);
      return {
        result: `Now on drill ${targetState.position}, ${targetState.exercise.name ?? "unnamed drill"}, set ${
          setNumber ?? 1
        } of ${targetState.plan.setCount}${sideLabel ? ` (${sideLabel})` : ""}.`,
        dbChanged: true,
      };
    }

    case "search_exercise_catalog": {
      const rawQuery = String(args.query ?? "").trim();
      if (!rawQuery) return { result: "Error: search query required", dbChanged: false };
      const { data: catalog, error } = await supabase
        .from("exercise_video_clips")
        .select(
          "id, exercise_name, category, difficulty_level, description, coaching_notes, requires_both_sides"
        )
        .eq("active", true);
      if (error) return { result: `Error searching: ${error.message}`, dbChanged: false };
      const matches = rankCatalogExercises(rawQuery, catalog ?? [], ctx);
      if (!matches.length) {
        return { result: `No catalog exercises matched "${rawQuery}".`, dbChanged: false };
      }
      return {
        result: matches
          .map((clip) =>
            `${clip.exercise_name} [catalog_exercise_id=${clip.id}; ${clip.category}; ${
              clip.difficulty_level
            }${
              clip.description ? `; focus=${String(clip.description).slice(0, 140)}` : ""
            }]`
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
      const categoryIsTimed = ["ball_handling", "defense", "conditioning"].includes(
        clip.category ?? ""
      );
      const extractedMinutes = durationMatch
        ? durationMatch[2].toLowerCase().startsWith("second")
          ? Math.max(0.5, Number(durationMatch[1]) / 60)
          : Math.max(0.5, Number(durationMatch[1]))
        : null;
      const duration = categoryIsTimed
        ? `${Math.max(1, Math.min(3, extractedMinutes ?? 2))} min`
        : extractedMinutes != null
          ? `${extractedMinutes} min`
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
        log_type:
          shooting || finishing
            ? "makes_attempts"
            : categoryIsTimed || durationMatch
              ? "minutes"
              : "checkbox",
        set_side_labels: clip.requires_both_sides ? ["left side", "right side"] : null,
      });
      if (error) return { result: `Error adding: ${error.message}`, dbChanged: false };
      await refreshEstimate();
      return { result: `Added ${clip.exercise_name}.`, dbChanged: true };
    }

    case "remove_workout_exercise": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) return { result: "I couldn't uniquely match that workout drill.", dbChanged: false };
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

    case "skip_drill": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) return { result: "I couldn't uniquely match that workout drill.", dbChanged: false };
      const next = findNextExercise(ctx, exerciseId);
      if (!next) {
        return {
          result: "There are no other unfinished drills to move to. This drill was left unchanged.",
          dbChanged: false,
        };
      }
      const { error } = await supabase
        .from("workout_days")
        .update({ active_exercise_id: next.id })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      ctx.day.active_exercise_id = next.id;
      return {
        result: `Moved to ${next.name ?? "the next drill"}. The previous drill was left unchanged.`,
        dbChanged: true,
      };
    }

    case "complete_drill": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) return { result: "I couldn't uniquely match that workout drill.", dbChanged: false };
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
            user_notes: meta.user_notes ?? null,
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
        result: `Completed. Next: ${nextName}.`,
        dbChanged: true,
      };
    }

    case "uncomplete_drill": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) return { result: "I couldn't uniquely match that workout drill.", dbChanged: false };
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
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) return { result: "I couldn't uniquely match that workout drill.", dbChanged: false };
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
      const hasRequestedDuration = Number.isFinite(requestedMinutes) && requestedMinutes > 0;
      const setDurationMinutes =
        currentExercise && isTimedExercise(currentExercise)
          ? currentPlan?.perSetMinutes ?? null
          : null;
      if (!hasRequestedDuration && setDurationMinutes == null) {
        return {
          result:
            "This set does not have a timed duration. Tell me how many minutes you want.",
          dbChanged: false,
        };
      }
      const durationMinutes = hasRequestedDuration
        ? Math.min(Math.round(requestedMinutes), 180)
        : Math.max(1, Math.round(setDurationMinutes!));
      const durationSeconds = durationMinutes * 60;
      const timerSetNumber =
        currentExercise && currentPlan && setDurationMinutes != null
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
