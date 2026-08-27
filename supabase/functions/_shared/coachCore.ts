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
  resolveAttemptsOverride,
  resolveMinutesOverride,
  targetAttemptsForSet,
  targetMakesForSet,
  updateSetLog,
} from "./exerciseSetLogs.ts";
import { sortWorkoutExercisesForDisplay } from "./workoutOrder.ts";

export interface TimerState {
  running: boolean;
  elapsed_seconds: number;
  duration_seconds?: number | null;
  remaining_seconds?: number | null;
}

export interface ClientAction {
  type:
    | "start_timer"
    | "pause_timer"
    | "resume_timer"
    | "stop_timer"
    | "get_timer_status"
    | "set_shooting_total";
  duration_seconds?: number | null;
  timer_exercise_id?: string | null;
  timer_set_number?: number | null;
  makes?: number;
  attempts?: number;
}

export interface ToolOutcome {
  result: string;
  dbChanged: boolean;
  stateVersion?: number;
  authoritativeCursor?: {
    exerciseId: string | null;
    setNumber: number | null;
    status: "applied" | "stale";
  };
  clientAction?: ClientAction;
  localConfirmation?: string;
  skipModelResponse?: boolean;
  incompleteCompletionConfirmation?: {
    exerciseId: string;
    drillName: string | null;
    setNumber: number;
  };
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
    active_set_number?: number | null;
  };
  exercises: ExerciseRow[];
  logs: Map<string, LogRow>;
}

export const COACH_SYSTEM_PROMPT = `You are Court Coach's live basketball coach.

Be direct and concise. Never praise, react, acknowledge, restate the request, introduce the response, or add a closing.
Use natural contractions and complete conversational sentences. Never sound robotic.

CONVERSATION
- Use recent_conversation's User/Coach turns to resolve follow-ups and intent.
- A standalone "yes," "yeah," or similar answer accepts the latest unanswered Coach question. If there is no pending question, ask what they are agreeing to.
- GREETINGS: For a standalone greeting addressed to Coach—"hey coach," "hi coach," "hello coach," or equivalent—reply warmly, use the athlete's preferred name when one is supplied, and ask whether they are ready to start their workout. Do not answer with only "yeah?" or another fragment, and do not call a tool for a greeting.
- If the athlete asks how to interrupt Coach or stop Coach from talking, say: "Say stop to interrupt me."
- Continue from the latest action. Never repeat a sentence or meaning just spoken.
- Questions about you: answer truthfully in a warm, happy, expressive tone, concisely.

SPEECH OUTPUT
- Write only natural, speakable plain English. Use words instead of markdown, equations, JSON, slashes, equals signs, symbols, labels, or UI-style notation.

Never start with phrases such as:
- "Nice."
- "Sounds good."
- "Got it."
- "Okay."
- "Sure."
- "Let's do it."
- "Let's start."
- "Great."
- "Absolutely."

No extra explanation, markdown, emojis, filler, repetition, raw JSON, tool names, internal-state language, or offers.
- Follow the athlete's stated intent exactly. Answer only the question or perform only the requested workout action; do not substitute a related goal, add unsolicited coaching, or broaden the request. When the request is possible and unambiguous, carry it out directly.
- CONTEXTUAL REPLIES: Resolve short replies from the immediately preceding athlete/Coach exchange before treating them as standalone conversation. “Okay,” “yes,” “yeah,” “yep,” “sure,” “sounds good,” “do it,” and equivalents affirm the exact action or question Coach just offered and must perform that action through its required tool. “No,” “nope,” “not yet,” “never mind,” and “yeah, no” decline it; “no, yeah” affirms it. Preserve the referenced drill, set, timer, duration, catalog choice, or edit from that exchange. Never claim to lack context or ask what they mean when the preceding offer is unambiguous.

The only permitted follow-up questions are:
- The required timed-set timer question.
- A necessary ambiguity question.
- Confirmation before adding or making a requested workout change that is not already in the workout.
- A necessary question for missing actual shot results or timer duration.

TOOL SPEECH
- Never announce, narrate, or repeat a planned tool action before or between tools.
- Speak only after every required tool succeeds. For an obvious requested change, say "Done."
- For search or list requests, present the result naturally, beginning with "Here are".
- Never mention catalogs, tools, databases, IDs, or internal state.

MISSING WORKOUT DRILL
- For a requested drill outside the workout, search for the closest match, then ask: "[X] isn't in this workout. Do you want me to add it?" Do not edit yet.
- After yes, add the offered catalog result without another confirmation.
- When search presents several options, the athlete naming an option or choosing its number is both the selection and add permission. Call add_workout_exercise for that exact displayed name immediately. Do not search again and do not ask another add question.
- Never speak/request catalog IDs. Show names only.

STATE
- Read authoritative state, including client-handled omitted turns. drills has order, status, results, totals, targets, sides, and explanation; current_set has progress, target, and remaining. Never recalculate or swap them; "X for Y" uses progress. A delta update replaces only listed drills and removed IDs; retain all others.
- Use exact set values for any current, named, previous, next, complete, or incomplete drill. Never claim another drill's results are unavailable. An absent/null side_label means no side; otherwise preserve it and resolve "left-side set" by that label.
- For fresh progress, position, sequence, next action, makes, misses, attempts, or completion, call get_workout_position once. Use its drill_position; never infer it. Misses are same-set/drill attempts minus makes.
- CATEGORY MEANING: ball handling, shooting, and finishing are separate drill categories. When the athlete says "shooting," "shooting drills," "shooting percentage," or asks to add/find shooting work, they mean category=shooting only—never finishing. Finishing is included only when the athlete explicitly says finishing, layups, rim finishes, or asks for overall/combined shooting. Overall shooting percentage includes shooting plus finishing; shooting-only excludes finishing. TIMED SET RULE: only minute-based ball_handling, defense, and conditioning drills get a duration or timer question. For a current/upcoming timed set, say: "You're on set N in [drill]. It's a X-minute timed set. Would you like me to start the X-minute timer?" Never ask or offer timers for shooting/finishing. For a current or newly selected shooting/finishing set, say: "You're on set N in [drill]. You're X for Y so far. Start shooting." when attempts are zero, or "You're on set N in [drill]. You're X for Y so far. Keep shooting." when attempts are above zero.
- Coach never receives live timer state in context. For any direct question about time left, current timer time, or whether a timer is running or paused, ALWAYS call get_timer_status and do not speak before its result. The athlete's device returns the exact response. Never call get_timer_status for a question about how to start, complete, do, or finish a timed, ball-handling, defense, or conditioning drill; give the drill-completion guidance instead. Do not volunteer timer status in response to “yes,” “okay,” “sure,” or unrelated speech.
- POSITION-ONLY RULE: Treat every natural-language request for current work—“what drill am I on?”, “what are we doing?”, “where are we?”, “remind me what I’m on”, “what set is this?”, “what’s going on?”, or equivalent—as drill/set only. Call get_workout_position if its position is not already authoritative, then state only the drill and set. Never offer to start a timer, never imply whether a timer is running, and never mention timer state in a position-only reply. Mention timer state only when the athlete directly asks about the timer and get_timer_status was called in that same turn.

COACHING AND RECOMMENDATIONS
- Judge shooting against its makes target. Below target needs work; never agree that a below-target result is good. At/below half is significantly low. Be candid.
- Recommend from completed sets only; one is enough. Match the exact weakness/category and avoid duplicates. An offer is not add permission. After acceptance, search that category. If all met target suggest another focus; if none are complete say evidence is insufficient.

NAVIGATION AND EDITS
- "Let's start this workout," "start the workout," or equivalent kickoff language is a read-only request. Without calling any tool or changing state, state the current drill and set from the provided workout context in one concise sentence.
- DEFAULT NEXT RULE: Every natural-language next question—"what's next?", "what is next?", "so what is next?", "what's next bro?", or equivalent—means the authoritative next incomplete SET, never the next drill. Call get_workout_position when needed and answer current_set if it is incomplete (including an unstarted set 1). If the current drill is complete, answer the first incomplete set of the next unfinished drill. Never skip an incomplete set or volunteer the drill after the current drill. Discuss the next drill only when the athlete explicitly asks "what drill/exercise comes next?" or explicitly asks for the set after the current one.
- STRICT DRILL BOUNDARY: “What’s next?”, "Let's move on", "Let's continue", "Let's now continue," and equivalent continuation phrasing are information-only requests. Give the same next-set response as “What’s next?” and never change position, completion, or the active drill. Do not ask whether to skip an incomplete set. Only explicit “next set,” “next drill,” “move to set N,” “move to [drill],” or “skip” requests may navigate.
- Use set_current_position for every explicit navigation action: moving to a drill, a set, next/previous/first/last, going back, and skipping a drill or set. It is the only navigation tool. It never changes completion, makes, attempts, or minutes. When an athlete moves to a drill without naming a set, omit set_number so it selects that drill's next incomplete set (set 2 when set 1 is complete, for example). Never mark a set complete for moving on. Mark completion only after explicit completion language such as "I'm done with that set," "I'm done," or "I'm finished."
- NAVIGATION TIMER RULE: Changing drills or sets ends any running timer from the prior location. After navigation, never offer or say that you will resume a timer. For a timed destination set, offer only to start that set's timer; for shooting/finishing, state its target and tell the athlete to start or keep shooting.
- NEW DRILL SET PRIORITY: When moving to a different drill, select set 1 whenever it is incomplete or unstarted; select another set only when the athlete explicitly requests that set or set 1 is already complete.
- Put natural references in drill_name: first/last, number, next/previous, go back, or Nth from end. Omit exercise_id unless state supplies it; never discuss IDs. Resolve this/that/current/it to current; ask only for ambiguous matches.
- Multi-action requests require all tools in dependency order, awaiting each result. Example: navigate to "last drill," then set each requested shooting set. Use each returned state silently; do not re-fetch unless asked for a fresh check or state is ambiguous.
- List with list_workout_drills. Add by catalog search then add after permission; every added drill immediately becomes the current drill at set 1. Remove with remove_workout_exercise; save notes with save_note. Name edits afterward.
- Any first request involving a drill/type/change not in the workout—including "add," "can I do/start," or "make/change my workout"—requires confirmation before mutation. Check drills; one match=use it, several=ask which, none search the catalog and offer the closest matching name before asking: "[X] isn't in this workout. Do you want me to add it/make that change?" A clear yes confirms; then add/edit immediately without asking again.

SHOT TRACKING
- If the athlete asks how to track shots, how Coach knows what happens after a shot, or an equivalent question, say: "Say make or miss, and I'll track each shot."
- If the athlete asks how to complete a drill or how drill completion works, say: "For shooting drills, log makes and misses for each set. For timed drills, say start the set timer and I'll start it. When the timer finishes, that set is marked complete."
- set_shooting_set_targets changes one set's shot targets, never results. An explicit request to change how many shots a set has—"I actually want to shoot 50 shots," "can we shoot 50," or "make this 50 shots"—is a clear mutation request: call set_shooting_set_targets with target_attempts=50 immediately. Preserve target_makes when the athlete did not name a new makes target. Never answer with an updated progress sentence, say it is done, or leave the old attempt target unchanged instead of calling this tool.
- For more work on a completed shooting drill, offer: add another [drill], or extend a completed set. Ask for set and new total attempts if missing. To extend, call set_shooting_set_targets once; a higher target reopens and activates that set without changing its score.
- Going back to extend a completed shooting/finishing set is normal and allowed. When an athlete asks to keep shooting a completed drill without naming a set and new total, first say its planned sets are complete and ask whether they would like to extend a completed set and go back to it. Only after a clear yes, or an explicit set and new total, call set_shooting_set_targets.
- Shot tools update current progress immediately and persist at target attempts, explicit finish/move, drill change, or coach close. Describe it only as progress—never unsaved, buffered, local, temporary, or session-only.
- After an ordinary partial make, miss, or shooting total, respond with exactly: "You're X for Y, N shots left." Say nothing before or after it—no acknowledgment, praise, reaction, advice, drill/set label, makes remaining, or filler.
- Always say "X for Y." Never say "X slash Y," "X over Y," "X comma Y," or omit "for."
- Ordinary make/miss commands are handled locally before they reach you. Never call a tool to add an incremental result.
- correct_current_shooting_total is the only tool you may use to change session shooting totals. Use it only for an explicit correction. Calculate its absolute makes and attempts from LIVE DEVICE SHOOTING STATE and recent local conversation; never guess or use target values.
- For "I missed the last one instead of make," change the live total by replacing the last recorded make with a miss: makes minus 1, attempts unchanged. For "you marked the last miss as a make," add 1 make, attempts unchanged. Then call correct_current_shooting_total once.
- The athlete device applies a correction and plays the exact prerecorded progress reply. Do not speak a confirmation or progress sentence after that tool.
- Keep partial sets current. On "what's next?" below target attempts, get position and give exact remaining shots/makes; advance only on explicit move/finish.
- For reported shooting results, save only the athlete's actual cumulative makes and actual cumulative attempts. Never save the prescribed target makes, target attempts, remaining numbers, or substitutes. Explicit set completion keeps current progress; do not ask for makes or attempts. Ask only for an ambiguous set or timer.
- After a completed shooting/finishing set, lead the athlete into the next set rather than saying "Set saved." Say: "You shot X for Y. You're on set N in [drill]. You're 0 for 0 so far. Start shooting." If the next set already has attempts, say "You shot X for Y. You're on set N in [drill]. You're A for B so far. Keep shooting." Use authoritative post-save state and never skip a set. This announcement is the current conversational context for the athlete's next request.


TIMED SET DURATION OVERRIDE
- If the athlete asks how to start a timer or an equivalent question, say: "Say start the set timer and I'll start it."
- If the athlete asks how to complete, do, or finish timed, ball-handling, defense, or conditioning drills, say: "Just say start the set timer, and I'll run it. When the timer finishes, it will be marked complete."
- If the athlete says "start a [X]-second/minute timer for this set" or equivalent, first call set_timed_set_duration for the referenced set using the exact value and unit spoken.
- Await that result, then call start_timer for the same set using its newly saved duration.
- Never start the timer before changing the set duration, and never skip set_timed_set_duration for this request.
- After a set_timed_set_duration call succeeds without starting the timer, say: "The set is now [duration]. Would you like me to start the set timer?" Keep that question as the active conversational context so a clear affirmative starts the timer.
- Preserve units exactly: seconds remain seconds and minutes remain minutes.


COMPLETION, TIME, OUTPUT
- set_set_completion completes/reopens one set, including timed sets. complete_drill requires explicit whole-drill completion; uncomplete_drill reopens it. "Can I skip?" is skip, not completion.
- Before completing a shooting/finishing set with attempts remaining, state progress and ask whether to start or mark it complete as is.
- After that question, treat any contextual clear finish wording as confirmation: call set_set_completion for that set with completed=true and confirmed_incomplete=true. Do not repeat. Only a clear refusal/keep-shooting intent leaves it incomplete.
- Honor an explicit request to go back and reopen an earlier completed set: call set_set_completion with completed=false; never claim past sets cannot be reopened.
- Coach is not aware of total workout duration, workout minutes remaining, or elapsed workout time. Judge workout progress only from drill and set completion. start_timer targets the named/current timed set and includes its reference; omit duration for saved time. Preserve seconds/minutes. After success say "A X-minute/second timer has been started." Ask duration for untimed drills. set_timed_set_duration applies to any drill configured with minute-based sets. When a timed set ends, its local announcement is: "Time's up. You're now on set N of [drill], [left/right side if any]. Would you like me to start the timer?" Treat that exact offer as active context: a clear “yeah,” “yes,” “sure,” “okay,” or “start it” means call start_timer for that announced set. “Stop the timer,” “end the timer,” “cancel the timer,” or a break means pause and preserve the remaining time. Resume when the athlete says “start it back up,” “resume,” “continue the timer,” or equivalent. Reset/restart only when they explicitly say reset, restart, start over, or restart the timer.
`;

// Keep the proven, detailed coaching policy in the cacheable prefix. Workout
// facts remain in the bounded dynamic block supplied for each turn.
export const COACH_TURN_STABLE_SYSTEM_PROMPT = `${COACH_SYSTEM_PROMPT}

ANTHROPIC TOOL CONTRACT
- Use the supplied native tool blocks for every workout action or state lookup. Never write a tool call, function call, JSON, arguments, query, or tool name as ordinary text.
- Never mention a query, command, tool, catalog, database, request mode, parameter, ID, or internal process.
- Exact make and miss commands are handled before a turn reaches you. For a clear current-score or last-shot correction, use only correct_current_shooting_total with absolute totals calculated from LIVE DEVICE SHOOTING STATE. Otherwise ask for clarification.
- You can start, pause, resume, and reset timers. Treat stop/end/cancel/break as pause; only reset or restart when explicitly requested. Never tell the athlete to operate a timer themselves.
- For a drill absent from the workout, search once before offering the closest match. After a clear yes or a selection from offered options, call add_workout_exercise with that exact displayed name. Never re-search or ask a second confirmation.
- Do not claim a workout fact or completed change until its tool succeeds.
- Speak only natural athlete-facing language after tool results.

TOOL EXECUTION EXAMPLES AND EDGE CASES
- For "go to the next drill," use the navigation action first. After its result, state the new drill and set only if useful; never say you moved the athlete before the result arrives.
- For "start a five-minute timer for this set," first save the exact set duration, then start the timer for that same set. Do not reverse those actions or replace minutes with seconds in speech.
- For "I actually want to shoot 50 shots" or "can we shoot 50 shots," call set_shooting_set_targets for the current shooting/finishing set with target_attempts=50 before replying. This is a requested workout edit, not a shot result or a question about remaining shots.
- For "start the timer," use the saved timed-set duration when one exists. If the current drill is not timed and no duration was given, ask for a duration instead of inventing one.
- After Coach asks whether to start a set timer, any clear affirmative—"yes," "yeah," "sure," "okay," "do it," "start it," or equivalent—MUST call start_timer for that referenced set before speaking. Never claim a timer is starting or has started without the successful start_timer result.
- For "add V dribbles," first search. Present the closest matching option(s) and ask permission once. A later clear yes or named/numbered option selection is permission for that exact match; add it directly without another search or question.
- For a completed drill or workout that the athlete wants to revisit, reopen the requested scope without erasing actual makes, attempts, or completed minutes.
- When a reference can resolve to exactly one workout drill, act on it. When it can resolve to several drills, ask one concise disambiguation question; never guess.
- Use the post-tool workout result as authoritative. A tool result may change active drill, set, targets, timer duration, completion, or totals; do not repeat stale facts from an earlier message.
- Never perform a destructive workout mutation merely because it was discussed. Add, remove, target, duration, and completion changes require the athlete's clear request or a valid confirmation of the immediately preceding offer.
- Keep tool chains minimal. Use a second tool only when the first result makes it necessary, such as setting a duration before starting that timer or searching before adding a drill.
- If a tool reports that a drill is absent, complete, ambiguous, or untimed, explain that athlete-facing result naturally and do not retry the same tool with invented data.
- Tool outputs are private working context. The final sentence must describe the outcome, not the implementation.

CACHEABLE POLICY EXAMPLES
- History is authoritative for short follow-ups: "yes" accepts only the most recent unanswered coach question; "that one" refers to the most recently discussed drill or set.
- Preserve the order of the conversation. Do not reinterpret an earlier request after a newer correction.
- If the athlete says "make it shorter" immediately after a timer duration discussion, change that same timed set; otherwise ask which set or duration they mean.
- If the athlete asks "what's next" after a tool changes the active drill, answer from the updated active drill rather than the drill that was active before the change.
- A concise result is better than a status narration. One natural sentence is enough after a simple action; use two only when the athlete needs a result and the next relevant step.`;

const DRILL_REFERENCE_PROPERTIES = {
  exercise_id: {
    type: "string",
    description:
      "Optional exact internal exercise ID. Omit rather than guessing.",
  },
  drill_name: {
    type: "string",
    description:
      "The athlete's spoken drill reference, preserved naturally: exact name, first drill, last drill, fifth to last, 5th from the end, next drill, previous drill, go back, current drill, or drill number.",
  },
};

const REALTIME_TOOL_DEFS = [
  {
    name: "set_set_completion",
    description:
      "Mark one specific set complete or incomplete without changing every set in the drill. Use for any drill category; completing a shooting or finishing set keeps its existing recorded progress.",
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
    description:
      "Reopen an entire completed drill and clear all of its completed sets.",
    parameters: {
      type: "object",
      properties: { ...DRILL_REFERENCE_PROPERTIES },
    },
  },
  {
    name: "save_note",
    description:
      "Save a note on a specific drill when the athlete wants to remember something.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        note: {
          type: "string",
          description: "Short note to attach to this drill.",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "search_exercise_catalog",
    description:
      "Search active exercises to offer drill options. Catalog IDs are internal: present names only and never ask the athlete for one. After the athlete clearly accepts or selects a displayed option, call add_workout_exercise directly with that exact name—do not search again or ask another confirmation. Weakness results are restricted to the weak drill's exact category; include its shot type or name, not only a broad category.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural search such as corner threes, easier ball handling, or conditioning.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "add_workout_exercise",
    description:
      "Add one exact displayed catalog exercise after the athlete accepts it or selects it by name/number. Do not re-search or ask another confirmation. Never ask the athlete for a catalog ID.",
    parameters: {
      type: "object",
      properties: {
        exercise_name: { type: "string" },
        catalog_exercise_id: { type: "string" },
      },
      required: ["exercise_name"],
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
          description:
            "Optional filter: shooting, ball_handling, finishing, defense, conditioning, etc.",
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
    name: "set_current_position",
    description:
      "The only navigation tool. Select a drill and optionally an unfinished set without changing completion or results. Omit set_number to select the drill's next incomplete set. Use for moving, skipping, and forward/back navigation.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: {
          type: "number",
          description: "Optional 1-based unfinished set number within the selected drill.",
        },
      },
    },
  },
  {
    name: "get_progress",
    description: "Fetch today's workout progress summary when needed.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "start_timer",
    description:
      "Start a countdown bound to the named set or active timed set. Include its exercise and set reference. Omit duration for its saved time and preserve units.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: { type: "integer", minimum: 1 },
        minutes: {
          type: "number",
          description: "Optional requested timer duration in minutes.",
        },
        seconds: {
          type: "number",
          description: "Optional requested timer duration in seconds.",
        },
      },
    },
  },
  {
    name: "set_timed_set_duration",
    description:
      "Save a new prescribed duration for one ball-handling, defense, or conditioning set. Use for a changed set time, not a one-off timer.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: {
          type: "number",
          description:
            "Set whose prescribed duration should change; defaults to current.",
        },
        duration_seconds: {
          type: "number",
          description: "Requested set duration in seconds.",
        },
      },
      required: ["duration_seconds"],
    },
  },
  {
    name: "set_shooting_set_targets",
    description:
      "Change one shooting/finishing set's prescribed makes or attempts without changing its results. Increasing attempts beyond a completed set's recorded attempts reopens and activates that set.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: {
          type: "number",
          description: "Set; defaults to current.",
        },
        target_makes: {
          type: "number",
          description: "Optional prescribed makes.",
        },
        target_attempts: {
          type: "number",
          description: "Optional prescribed attempts.",
        },
      },
    },
  },
  {
    name: "get_timer_status",
    description: "Get exact live timer status from the athlete's device.",
    parameters: { type: "object", properties: {} },
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
        attempts: {
          type: "number",
          description: "Optional; defaults to saved attempts for this set.",
        },
        set_number: {
          type: "number",
          description:
            "Which set (1-based). Defaults to current_set from context.",
        },
        completed: {
          type: "boolean",
          description:
            "True if this set finishes the drill (all sets done or user is done with it)",
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
    name: "save_note",
    description:
      "Attach a note to a drill when the user says something worth remembering.",
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
    name: "start_timer",
    description:
      "Start a countdown bound to the named set or active timed set. Include its exercise and set reference. Omit duration for its saved time and preserve units.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: {
          type: "number",
          description: "Set; defaults to current.",
        },
        minutes: {
          type: "number",
          description: "Optional requested timer duration in minutes.",
        },
        seconds: {
          type: "number",
          description: "Optional requested timer duration in seconds.",
        },
      },
    },
  },
  {
    name: "set_shooting_set_targets",
    description:
      "Change one shooting/finishing set's prescribed makes or attempts.",
    parameters: {
      type: "object",
      properties: {
        ...DRILL_REFERENCE_PROPERTIES,
        set_number: {
          type: "number",
          description: "Set; defaults to current.",
        },
        target_makes: {
          type: "number",
          description: "Optional prescribed makes.",
        },
        target_attempts: {
          type: "number",
          description: "Optional prescribed attempts.",
        },
      },
    },
  },
  {
    name: "get_timer_status",
    description: "Get exact live timer status from the athlete's device.",
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

const REALTIME_TOOL_DESCRIPTIONS: Record<string, string> = {
  record_make: "One make; never use when N>1.",
  record_miss: "One miss; never use when N>1.",
  record_makes: "Add N makes and N attempts.",
  record_misses: "Add N misses and N attempts.",
  add_shooting_result: "Add an incremental X-for-Y result.",
  set_shooting_total:
    "Replace any set's makes/attempts (attempts=makes+misses), including completed; no navigation.",
  set_set_completion: "Complete or reopen one set.",
  complete_drill: "Complete all drill sets.",
  uncomplete_drill: "Reopen a drill and its sets.",
  save_note: "Save a drill note.",
  search_exercise_catalog:
    "Search drills; IDs are internal and only names are spoken.",
  add_workout_exercise:
    "Add by exact searched name only after the athlete confirms; never ask for an ID.",
  remove_workout_exercise: "Remove a drill and its logs.",
  list_workout_drills: "List drills, optionally by category.",
  get_workout_position: "Fetch current set, progress, targets, and order.",
  set_current_position: "Select a drill and set without changing completion.",
  get_progress: "Fetch workout progress.",
  start_timer:
    "Start a timer bound to a workout exercise/set; seconds and minutes keep their units.",
  get_timer_status: "Get exact live timer status from the athlete device.",
  set_timed_set_duration:
    "Save one timed set's new duration; not a one-off timer.",
  set_shooting_set_targets: "Change one set's shot targets, not its results.",
  pause_timer: "Pause timer.",
  resume_timer: "Resume timer.",
  stop_timer: "Stop and reset timer.",
};

const REALTIME_PARAMETER_DESCRIPTIONS: Record<string, string> = {
  exercise_id: "Exact ID; omit if uncertain.",
  drill_name: "Name or relative reference.",
  set_number: "1-based set; defaults current.",
  count: "Positive shot count.",
  makes: "Actual makes.",
  attempts: "Actual attempts.",
  completed: "Complete or reopen.",
  reason: "Short reason.",
  note: "Short note.",
  query: "Skill, shot, or weakness.",
  category: "Category filter.",
  minutes: "Minutes.",
  seconds: "Seconds.",
  duration_seconds: "Set seconds.",
  target_makes: "Target makes.",
  target_attempts: "Target attempts.",
  catalog_exercise_id: "Catalog result ID.",
};

function compactRealtimeParameters(parameters: {
  type: string;
  properties: object;
  required?: string[];
}) {
  const properties = parameters.properties as Record<
    string,
    Record<string, unknown>
  >;
  return {
    ...parameters,
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, schema]) => [
        name,
        {
          ...schema,
          ...(REALTIME_PARAMETER_DESCRIPTIONS[name]
            ? { description: REALTIME_PARAMETER_DESCRIPTIONS[name] }
            : {}),
        },
      ]),
    ),
  };
}

/** Stable tool names/fields with compact descriptions for the Realtime API. */
export function getRealtimeTools() {
  return REALTIME_TOOL_DEFS.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: REALTIME_TOOL_DESCRIPTIONS[t.name] ?? t.description,
    parameters: compactRealtimeParameters(t.parameters),
  }));
}

export async function loadWorkoutContext(
  supabase: SupabaseClient,
  userId: string,
  dayId: string,
): Promise<WorkoutContext | null> {
  const { data: day, error: dayError } = await supabase
    .from("workout_days")
    .select(
      "id, title, focus, estimated_minutes, coach_notes, completed, active_exercise_id, active_set_number, user_id",
    )
    .eq("id", dayId)
    .eq("user_id", userId)
    .maybeSingle();

  if (dayError) throw dayError;
  if (!day) return null;

  const { data: exercises, error: exercisesError } = await supabase
    .from("workout_exercises")
    .select(
      "id, order_index, name, category, instructions, sets, reps, duration, target_makes, target_attempts, log_type, set_side_labels, video_clip:exercise_video_clips(youtube_video_id, description, coaching_notes)",
    )
    .eq("day_id", dayId)
    .order("order_index", { ascending: true });
  if (exercisesError) throw exercisesError;

  const exerciseIds = (exercises ?? []).map((e: ExerciseRow) => e.id);
  const logs = new Map<string, LogRow>();

  if (exerciseIds.length > 0) {
    const { data: logRows, error: logsError } = await supabase
      .from("exercise_logs")
      .select(
        "exercise_id, completed, makes, attempts, minutes_completed, difficulty, notes",
      )
      .in("exercise_id", exerciseIds);
    if (logsError) throw logsError;
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
  setNumber: number | null,
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
  return applyMinutesOverride(
    applyAttemptsOverride(plan, attemptsOverride),
    minutesOverride,
  );
}

function isTimedExercise(ex: ExerciseRow): boolean {
  return ex.log_type === "minutes" &&
    ex.category !== "shooting" &&
    ex.category !== "finishing";
}

export function buildContextSummary(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer: TimerState | undefined,
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
        const targetMakes = targetMakesForSet(set, plan);
        const targetAttempts = targetAttemptsForSet(set, plan);
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
            makes: targetMakes,
            attempts: targetAttempts,
            minutes: set.duration_seconds_override != null
              ? set.duration_seconds_override / 60
              : isTimedExercise(ex)
              ? plan.perSetMinutes
              : null,
          },
          remaining: {
            makes: targetMakes == null
              ? null
              : Math.max(0, targetMakes - progressMakes),
            attempts: targetAttempts == null
              ? null
              : Math.max(0, targetAttempts - progressAttempts),
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

  return JSON.stringify({
    workout_day: {
      title: ctx.day.title,
      focus: ctx.day.focus,
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
        current_set_state: current.set_logs.find((set) =>
          set.set_number === current.current_set
        ) ?? null,
        drill_description: current.drill_description,
      }
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
  log: LogRow | undefined,
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
  return sortWorkoutExercisesForDisplay(ctx.exercises).map(
    (exercise, index) => {
      const log = ctx.logs.get(exercise.id);
      const plan = effectivePlanForExercise(exercise, log);
      const meta = decodeExerciseLogMeta(log?.notes ?? null);
      const setLogs = hydrateSetLogs(
        buildSetPlan(exercise),
        meta,
        log ?? undefined,
      );
      return {
        exercise,
        log,
        position: index + 1,
        plan,
        setLogs,
        totals: aggregateSetLogs(setLogs, plan),
      };
    },
  );
}

function currentDrillIndex(
  states: OrderedDrillState[],
  activeExerciseId: string | null,
): number {
  const activeIndex = activeExerciseId
    ? states.findIndex((state) => state.exercise.id === activeExerciseId)
    : -1;
  if (activeIndex >= 0 && !states[activeIndex].totals.completed) {
    return activeIndex;
  }

  // When the active drill just finished, continue forward before wrapping to
  // earlier drills the athlete intentionally left available.
  if (activeIndex >= 0) {
    const nextIndex = states.findIndex(
      (state, index) => index > activeIndex && !state.totals.completed,
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

function findNextExercise(
  ctx: WorkoutContext,
  afterId?: string,
): ExerciseRow | null {
  const states = orderedDrillStates(ctx);
  const startIdx = afterId
    ? states.findIndex((state) => state.exercise.id === afterId) + 1
    : 0;
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
    (set) => set.makes != null || set.completed,
  );
  const actualMakes = setsWithProgress.reduce(
    (sum, set) => sum + (set.makes ?? 0),
    0,
  );
  const actualAttempts = setsWithProgress.reduce(
    (sum, set) => sum + (set.attempts ?? 0),
    0,
  );
  return {
    drill_position: position,
    exercise_id: exercise.id,
    name: exercise.name,
    category: exercise.category,
    status: totals.completed
      ? "complete"
      : completedSets > 0
      ? "in_progress"
      : "not_started",
    sets: {
      total: plan.setCount,
      completed: completedSets,
      next_unfinished: nextUnfinishedSet,
    },
    set_results: totals.set_logs.map((set) => {
      const hasProgress = set.makes != null || set.completed;
      const progressMakes = hasProgress ? set.makes ?? 0 : 0;
      const progressAttempts = hasProgress ? set.attempts ?? 0 : 0;
      const targetMakes = targetMakesForSet(set, plan);
      const targetAttempts = targetAttemptsForSet(set, plan);
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
          makes: targetMakes,
          attempts: targetAttempts,
          minutes: set.duration_seconds_override != null
            ? set.duration_seconds_override / 60
            : isTimedExercise(exercise)
            ? plan.perSetMinutes
            : null,
        },
        remaining: {
          makes: targetMakes == null
            ? null
            : Math.max(0, targetMakes - progressMakes),
          attempts: targetAttempts == null
            ? null
            : Math.max(0, targetAttempts - progressAttempts),
        },
        minutes: set.minutes,
        target_comparison:
          set.makes == null || targetMakes == null || targetMakes <= 0
            ? null
            : {
              status: set.makes >= targetMakes
                ? "target_met"
                : set.makes <= targetMakes / 2
                ? "significantly_below_target"
                : "below_target",
              makes_below_target: Math.max(0, targetMakes - set.makes),
              percent_of_makes_target: Math.round(
                (set.makes / targetMakes) * 100,
              ),
            },
      };
    }),
    logged_totals: {
      makes: setsWithProgress.length > 0 ? actualMakes : null,
      attempts: setsWithProgress.length > 0 ? actualAttempts : null,
      misses: setsWithProgress.length > 0
        ? Math.max(0, actualAttempts - actualMakes)
        : null,
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

  const defaultCurrentSet = current
    ? getCurrentSetNumber(current.totals.set_logs, current.plan)
    : null;
  const selectedActiveSet = current &&
    current.exercise.id === ctx.day.active_exercise_id &&
    ctx.day.active_set_number != null &&
    ctx.day.active_set_number >= 1 &&
    ctx.day.active_set_number <= current.plan.setCount
    ? ctx.day.active_set_number
    : null;
  const selectedSetLog = selectedActiveSet == null
    ? null
    : current?.totals.set_logs.find((set) => set.set_number === selectedActiveSet) ?? null;
  // Keep an explicitly selected incomplete set active even if an earlier set
  // remains incomplete. Completion still advances to the first incomplete set.
  const currentSetNumber = selectedSetLog && !selectedSetLog.completed
    ? selectedActiveSet
    : defaultCurrentSet;
  const nextWorkItem = current
    ? {
      kind: "set",
      ...drillContext(current),
      set_number: currentSetNumber,
      set_side_label: setSideLabel(
        current.exercise,
        currentSetNumber,
      ),
    }
    : null;
  const currentSetResult = nextWorkItem?.set_number == null
    ? null
    : nextWorkItem.set_results.find(
      (set) => set.set_number === nextWorkItem.set_number,
    ) ?? null;
  const currentSetState = nextWorkItem && currentSetResult
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
        first_set_number: getCurrentSetNumber(
          nextState.totals.set_logs,
          nextState.plan,
        ),
        first_set_side_label: setSideLabel(
          nextState.exercise,
          getCurrentSetNumber(nextState.totals.set_logs, nextState.plan),
        ),
      }
      : null,
    remaining_drills: states
      .filter((state) => !state.totals.completed)
      .map(drillContext),
    workout_complete: states.length > 0 &&
      states.every((state) => state.totals.completed),
  };
}

function buildCompactDrillList(ctx: WorkoutContext) {
  return buildWorkoutNavigation(ctx).drills;
}

function isShootingDrill(drill: {
  category: string | null;
}): boolean {
  return drill.category === "shooting" || drill.category === "finishing";
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
  return [
    ...new Set(
      normalizeCatalogSearchText(value).split(/\s+/).filter(
        (token) => token.length > 1 && !ignored.has(token),
      ),
    ),
  ];
}

function weakestScoringFocus(
  ctx: WorkoutContext,
  queryTokens: string[],
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
            set.makes < drill.target.makes,
        )
        .map((set) => ({
          ratio: (set.makes ?? 0) / (drill.target.makes ?? 1),
          text: `${drill.name ?? ""} ${drill.category ?? ""} ${
            drill.instructions ?? ""
          } ${drill.drill_description ?? ""}`,
          category: drill.category,
          exerciseId: drill.exercise_id,
        }))
    )
    .map((focus) => ({
      ...focus,
      overlap:
        queryTokens.filter((token) =>
          meaningfulSearchTokens(focus.text).includes(token)
        ).length,
      relatedCoverage: ctx.exercises.filter((exercise) => {
        if (
          exercise.id === focus.exerciseId ||
          exercise.category !== focus.category
        ) return false;
        const exerciseTokens = meaningfulSearchTokens(
          `${exercise.name ?? ""} ${exercise.instructions ?? ""}`,
        );
        const focusTokens = meaningfulSearchTokens(focus.text);
        return focusTokens.filter((token) => exerciseTokens.includes(token))
          .length >= 2;
      }).length,
    }))
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        a.ratio + a.relatedCoverage * 0.45 -
          (b.ratio + b.relatedCoverage * 0.45),
    );
  return evaluated[0] ?? null;
}

/** Rank catalog results by the requested skill and the workout's weakest matching shooting result. */
export function rankCatalogExercises(
  rawQuery: string,
  catalog: CatalogSearchClip[],
  ctx: WorkoutContext,
): CatalogSearchClip[] {
  const query = normalizeCatalogSearchText(rawQuery);
  const queryTokens = meaningfulSearchTokens(rawQuery);
  const weaknessFocus = weakestScoringFocus(ctx, queryTokens);
  const weaknessTokens = meaningfulSearchTokens(weaknessFocus?.text ?? "");
  const existingNames = new Set(
    ctx.exercises.map((exercise) =>
      normalizeCatalogSearchText(exercise.name ?? "")
    ).filter(Boolean),
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
  const useWeaknessFocus = weaknessTokens.length > 0 &&
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
  const requiredCategory = requestedCategory ??
    (useWeaknessFocus ? weaknessFocus?.category ?? null : null);
  const recommendationIntent =
    /\b(?:recommend(?:ed|ation)?|suggest(?:ed|ion)?|what should i add)\b/i.test(
      rawQuery,
    );
  const completedCategories = buildWorkoutNavigation(ctx).drills
    .filter(
      (drill) =>
        drill.sets.completed > 0 &&
        drill.category != null &&
        !["warmup", "cooldown"].includes(drill.category),
    )
    .map((drill) => drill.category as string);
  const completedCategoryCounts = new Map<string, number>();
  for (const category of completedCategories) {
    completedCategoryCounts.set(
      category,
      (completedCategoryCounts.get(category) ?? 0) + 1,
    );
  }
  const workoutCategories = new Set(
    ctx.exercises.map((exercise) => exercise.category).filter(
      (category): category is string => category != null,
    ),
  );

  return catalog
    .filter((clip) => !requiredCategory || clip.category === requiredCategory)
    .map((clip) => {
      const name = normalizeCatalogSearchText(clip.exercise_name ?? "");
      const category = normalizeCatalogSearchText(clip.category ?? "");
      const details = normalizeCatalogSearchText(
        `${clip.description ?? ""} ${clip.coaching_notes ?? ""}`,
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
    .filter(({ clip, score }) =>
      score > 0 && !existingNames.has(
        normalizeCatalogSearchText(clip.exercise_name ?? ""),
      )
    )
    .sort((a, b) =>
      b.score - a.score ||
      String(a.clip.exercise_name ?? "").localeCompare(
        String(b.clip.exercise_name ?? ""),
      )
    )
    .slice(0, 8)
    .map(({ clip }) => clip);
}

/** Compact context for Realtime sessions — full drill list plus current/next drill. */
export function buildCompactContextSummary(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer: TimerState | undefined,
  conversationSummary?: string | null,
): string {
  const navigation = buildWorkoutNavigation(ctx);
  let totalMakes = 0;
  let totalAttempts = 0;
  let completedCount = 0;
  for (const drill of navigation.drills) {
    if (drill.status === "complete") completedCount += 1;
    if (drill.logged_totals.makes != null) {
      totalMakes += drill.logged_totals.makes;
    }
    if (drill.logged_totals.attempts != null) {
      totalAttempts += drill.logged_totals.attempts;
    }
  }

  const goal = typeof profile?.main_goal === "string"
    ? profile.main_goal.slice(0, 120)
    : null;

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
      shooting_pct: totalAttempts > 0
        ? Math.round((totalMakes / totalAttempts) * 100)
        : null,
    },
    goal,
    recent_conversation: (conversationSummary ?? "").slice(-1_200) || null,
  });
}

type RealtimeNavigation = ReturnType<typeof buildWorkoutNavigation>;
type RealtimeDrill = RealtimeNavigation["drills"][number];

function compactRealtimeDrill(drill: RealtimeDrill) {
  const instructions = drill.instructions?.slice(0, 240) || undefined;
  const description =
    drill.drill_description && drill.drill_description !== drill.instructions
      ? drill.drill_description.slice(0, 240)
      : undefined;
  return {
    drill_position: drill.drill_position,
    exercise_id: drill.exercise_id,
    name: drill.name,
    category: drill.category,
    status: drill.status,
    sets: drill.sets,
    set_results: drill.set_results.map((set) => ({
      set_number: set.set_number,
      side_label: set.side_label ?? undefined,
      completed: set.completed,
      makes: set.makes,
      attempts: set.attempts,
      misses: set.misses,
      minutes: set.minutes ?? undefined,
      target_status: set.target_comparison?.status,
      makes_below_target: set.target_comparison?.makes_below_target,
    })),
    logged_totals: drill.logged_totals,
    target_per_set: drill.target,
    log_type: drill.log_type,
    instructions,
    drill_description: description,
  };
}

/**
 * Normalized model-facing state. The client keeps the legacy expanded state
 * for local shot buffering, while the model receives each fact only once.
 */
export function buildRealtimeModelContext(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer: TimerState | undefined,
  conversationSummary?: string | null,
): string {
  const navigation = buildWorkoutNavigation(ctx);
  const allDrills = navigation.drills.map(compactRealtimeDrill);
  const drills = allDrills.slice(0, 24);
  const completedDrills =
    allDrills.filter((drill) => drill.status === "complete").length;
  const makes = allDrills.reduce(
    (sum, drill) => sum + (drill.logged_totals.makes ?? 0),
    0,
  );
  const attempts = allDrills.reduce(
    (sum, drill) => sum + (drill.logged_totals.attempts ?? 0),
    0,
  );
  return JSON.stringify({
    workout: {
      title: ctx.day.title,
      focus: ctx.day.focus,
      goal: typeof profile?.main_goal === "string"
        ? profile.main_goal.slice(0, 120)
        : null,
    },
    drills,
    current_set: navigation.current_set_state,
    next_exercise: navigation.next_exercise_after_current
      ? {
        exercise_id: navigation.next_exercise_after_current.exercise_id,
        name: navigation.next_exercise_after_current.name,
        drill_position: navigation.next_exercise_after_current.drill_position,
        first_set_number:
          navigation.next_exercise_after_current.first_set_number,
        first_set_side_label:
          navigation.next_exercise_after_current.first_set_side_label,
      }
      : null,
    totals: {
      completed_drills: completedDrills,
      total_drills: allDrills.length,
      remaining_drills: allDrills.length - completedDrills,
      omitted_drills: Math.max(0, allDrills.length - drills.length),
      makes,
      attempts,
      misses: Math.max(0, attempts - makes),
      shooting_pct: attempts > 0 ? Math.round((makes / attempts) * 100) : null,
      workout_complete: navigation.workout_complete,
    },
    recent_conversation: (conversationSummary ?? "").slice(-800) || null,
  });
}

/** Dynamic coach-turn state kept separate from the cacheable policy prefix. */
export function buildCoachTurnDynamicContext(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  conversationSummary: string | null | undefined,
  coachName: string,
  timer?: TimerState,
  _speculativeReadOnly = false,
  includeWorkoutState = true,
): string {
  const preferredName = typeof profile?.preferred_name === "string"
    ? profile.preferred_name.slice(0, 80)
    : null;
  const identity =
    `Your name is ${coachName}. If asked, introduce yourself by that name.${
      preferredName ? ` The athlete's preferred name is ${preferredName}; use it naturally.` : ""
    }`;
  if (!includeWorkoutState) return identity;
  return `${identity}
Authoritative workout state follows. Use it silently and prefer newer state from tool results:
${buildRealtimeModelContext(ctx, profile, timer, conversationSummary)}`;
}

export function buildRealtimeInstructions(
  ctx: WorkoutContext,
  profile: Record<string, unknown> | null,
  timer?: TimerState,
  conversationSummary?: string | null,
  coachName = "Coach Tyler",
): string {
  return `Your name is ${coachName}. If asked, introduce yourself by that name.

${COACH_SYSTEM_PROMPT}

Authoritative workout state follows. Use it silently and prefer newer state from tool results:
${buildRealtimeModelContext(ctx, profile, timer, conversationSummary)}`;
}

/** Full state for reads; changed drills plus navigation/totals after mutations. */
export function buildRealtimeNavigationUpdate(
  ctx: WorkoutContext,
  previousContext?: WorkoutContext,
): string {
  const navigation = buildWorkoutNavigation(ctx);
  const compactDrills = navigation.drills.map(compactRealtimeDrill);
  const previousDrills = previousContext
    ? buildWorkoutNavigation(previousContext).drills.map(compactRealtimeDrill)
    : [];
  const previousById = new Map(
    previousDrills.map((drill) => [drill.exercise_id, JSON.stringify(drill)]),
  );
  const changedDrills = previousContext
    ? compactDrills.filter(
      (drill) => previousById.get(drill.exercise_id) !== JSON.stringify(drill),
    )
    : compactDrills;
  const currentIds = new Set(compactDrills.map((drill) => drill.exercise_id));
  const completedDrills =
    navigation.drills.filter((drill) => drill.status === "complete").length;
  return JSON.stringify({
    type: "workout_state_update",
    state_scope: previousContext ? "delta" : "full",
    drills: changedDrills,
    removed_exercise_ids: previousContext
      ? previousDrills
        .filter((drill) => !currentIds.has(drill.exercise_id))
        .map((drill) => drill.exercise_id)
      : [],
    current_set: navigation.current_set_state,
    next_exercise: navigation.next_exercise_after_current
      ? {
        exercise_id: navigation.next_exercise_after_current.exercise_id,
        name: navigation.next_exercise_after_current.name,
        drill_position: navigation.next_exercise_after_current.drill_position,
        first_set_number:
          navigation.next_exercise_after_current.first_set_number,
        first_set_side_label:
          navigation.next_exercise_after_current.first_set_side_label,
      }
      : null,
    totals: {
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
    if (drill.logged_totals.makes != null) {
      totalMakes += drill.logged_totals.makes;
    }
    if (drill.logged_totals.attempts != null) {
      totalAttempts += drill.logged_totals.attempts;
    }
  }
  const pct = totalAttempts > 0
    ? Math.round((totalMakes / totalAttempts) * 100)
    : null;
  const completedCount =
    navigation.drills.filter((drill) => drill.status === "complete").length;
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
      ? ` Actual progress: ${state.progress.makes} makes in ${state.progress.attempts} attempts. Prescribed whole-set target: ${
        state.target.makes ?? "none"
      } makes in ${state.target.attempts ?? "none"} attempts. Remaining: ${
        state.remaining.makes ?? "unknown"
      } makes and ${state.remaining.attempts ?? "unknown"} attempts.`
      : "";
  const timedTarget = workItem.target.minutes != null
    ? ` Target: ${workItem.target.minutes} minute${
      workItem.target.minutes === 1 ? "" : "s"
    }.`
    : "";
  const after = navigation.next_exercise_after_current;
  return [
    `Current work: drill ${workItem.drill_position} of ${navigation.drills.length}, ${
      workItem.name ?? "unnamed drill"
    }, set ${workItem.set_number} of ${workItem.sets.total}${
      workItem.set_side_label ? ` (${workItem.set_side_label})` : ""
    }.${shootingState}${timedTarget}`,
    after
      ? `After this drill: ${after.name ?? "unnamed drill"}.`
      : "This is the last drill.",
  ].join(" ");
}

export function buildWorkoutDrillListSummary(
  ctx: WorkoutContext,
  categoryFilter?: string | null,
): string {
  const drills = buildCompactDrillList(ctx);
  const normalizedFilter =
    categoryFilter?.trim().toLowerCase().replace(/\s+/g, "_") ?? null;

  const filtered = normalizedFilter
    ? drills.filter((d) => {
      const cat = (d.category ?? "").toLowerCase();
      if (cat === normalizedFilter) return true;
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
  const prefix = normalizedFilter
    ? `${categoryFilter} drills`
    : "Today's drills";
  return `${prefix} (${doneCount}/${filtered.length} done): ${
    names.join(", ")
  }.`;
}

export async function executeCoachTool(
  supabase: SupabaseClient,
  userId: string,
  dayId: string,
  ctx: WorkoutContext,
  name: string,
  args: Record<string, unknown>,
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
    drillName: unknown,
  ): { id: string | null; ambiguous: boolean } => {
    const states = orderedDrillStates(ctx);
    const query = typeof drillName === "string"
      ? normalizeDrillName(drillName)
      : "";
    const currentIndex = currentDrillIndex(states, ctx.day.active_exercise_id);
    const activeIndex = ctx.day.active_exercise_id
      ? states.findIndex((state) =>
        state.exercise.id === ctx.day.active_exercise_id
      )
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
      if (
        /^(?:the )?(?:current|this|that|it)(?: drill| exercise)?$/.test(query)
      ) {
        return {
          id: currentIndex >= 0 ? states[currentIndex].exercise.id : null,
          ambiguous: false,
        };
      }
      if (
        /^(?:go )?back$|^(?:the )?(?:previous|prior)(?: drill| exercise)?$/
          .test(query)
      ) {
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
        return {
          id: states[states.length - 1]?.exercise.id ?? null,
          ambiguous: false,
        };
      }
      const fromEndMatch = query.match(
        /\b(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:to|from)\s+(?:the )?(?:last|end)(?: drill| exercise)?(?: of (?:the )?workout)?\b/,
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
        /^(?:the )?(?:drill|exercise|number|no)?\s*(\d+)(?:st|nd|rd|th)?$/,
      );
      if (ordinalMatch) {
        const position = Number(ordinalMatch[1]);
        if (position >= 1 && position <= states.length) {
          return { id: states[position - 1].exercise.id, ambiguous: false };
        }
      }
    }

    const exactId = typeof id === "string" &&
        ctx.exercises.some((exercise) => exercise.id === id)
      ? id
      : null;
    if (!query && exactId) return { id: exactId, ambiguous: false };
    const nameQuery = query ||
      (typeof id === "string" ? normalizeDrillName(id) : "");
    if (!nameQuery) return { id: null, ambiguous: false };
    const exactMatches = ctx.exercises.filter(
      (exercise) => normalizeDrillName(exercise.name ?? "") === nameQuery,
    );
    if (exactMatches.length === 1) {
      return { id: exactMatches[0].id, ambiguous: false };
    }
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
  const validExercise = (
    reference: unknown,
    drillName?: unknown,
  ): string | null => {
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
      const sets = Math.max(
        1,
        Number.parseInt(String(row.sets ?? "1"), 10) || 1,
      );
      const duration = String(row.duration ?? "").match(
        /(\d+(?:\.\d+)?)\s*min/i,
      );
      return sum + (duration ? Number.parseFloat(duration[1]) : 3) * sets;
    }, 0);
    const estimate = Math.max(
      5,
      Math.round(plannedMinutes + 5 + (rows?.length ?? 0) * 1.5),
    );
    await supabase
      .from("workout_days")
      .update({ estimated_minutes: estimate })
      .eq("id", dayId)
      .eq("user_id", userId);
  };

  switch (name) {
    case "save_shooting_results": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const makes = Number(args.makes ?? 0);
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };
      if (!isShootingDrill(ex)) {
        return {
          result: `You're not on a shooting or finishing drill. You're on ${
            ex.name ?? "the current drill"
          }.`,
          dbChanged: false,
        };
      }

      // The latency-critical shot path is a single database transaction. It
      // locks the day cursor and log, applies the result, advances the next
      // set when appropriate, and advances Coach state before returning.
      const { data: mutationRows, error: mutationError } = await supabase.rpc(
        "apply_coach_shooting_set_result_v2",
        {
          p_user_id: userId,
          p_day_id: dayId,
          p_exercise_id: exerciseId,
          p_set_number: Number(args.set_number),
          p_makes: Number(args.makes ?? 0),
          p_attempts: Number(args.attempts ?? 0),
          p_expected_exercise_id: typeof args.expected_exercise_id === "string"
            ? args.expected_exercise_id
            : exerciseId,
          p_expected_set_number: Number.isInteger(args.expected_set_number)
            ? args.expected_set_number
            : Number(args.set_number),
        },
      );
      if (mutationError) {
        return { result: `Error saving: ${mutationError.message}`, dbChanged: false };
      }
      const mutation = Array.isArray(mutationRows) ? mutationRows[0] : mutationRows;
      if (!mutation) return { result: "Error saving: empty shooting result", dbChanged: false };
      const cursor = {
        exerciseId: mutation.active_exercise_id ?? null,
        setNumber: mutation.active_set_number ?? null,
        status: mutation.status === "stale" ? "stale" as const : "applied" as const,
      };
      if (cursor.status === "stale") {
        return {
          result: "Stale shooting position.",
          dbChanged: false,
          stateVersion: Number(mutation.state_version ?? 0),
          authoritativeCursor: cursor,
        };
      }
      ctx.day.active_exercise_id = cursor.exerciseId;
      ctx.day.active_set_number = cursor.setNumber;
      return {
        result: `Saved set ${Number(args.set_number)}: ${
          Number(mutation.saved_set_makes ?? args.makes ?? 0)
        } for ${
          Number(mutation.saved_set_attempts ?? args.attempts ?? 0)
        }.`,
        dbChanged: true,
        stateVersion: Number(mutation.state_version ?? 0),
        authoritativeCursor: cursor,
      };

      /*
      const plan = effectivePlanForExercise(ex, existing);
      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      let setLogs = hydrateSetLogs(
        buildSetPlan(ex),
        meta,
        existing ?? undefined,
      );
      const currentSet = getCurrentSetNumber(setLogs, plan);
      const setNumber =
        typeof args.set_number === "number" && args.set_number > 0
          ? Math.min(args.set_number, plan.setCount)
          : currentSet ?? 1;
      const selectedSet = setLogs.find((set) => set.set_number === setNumber);
      // Bare local make/miss commands are only valid for the active,
      // incomplete set. This rejects an out-of-order client retry before it
      // can overwrite the completed prior set's cumulative totals.
      if (
        args.enforce_current_position === true &&
        (
          ctx.day.active_exercise_id !== exerciseId ||
          ctx.day.active_set_number !== setNumber ||
          selectedSet?.completed === true
        )
      ) {
        const current = buildWorkoutNavigation(ctx).current_set_state;
        return {
          result: `Stale shooting position. Current set is ${
            current?.set_number ?? "unavailable"
          } of ${current?.drill_name ?? "the workout"}.`,
          dbChanged: false,
        };
      }
      const requestedAttempts = Number(args.attempts);
      const attempts =
        Number.isFinite(requestedAttempts) && requestedAttempts >= 0
          ? requestedAttempts
          : selectedSet?.attempts ?? plan.perSetAttempts ?? 0;

      const setCompleted = typeof args.completed === "boolean"
        ? args.completed
        : attempts > 0;

      setLogs = updateSetLog(setLogs, plan, setNumber, {
        makes,
        attempts,
        completed: setCompleted,
        force_incomplete: false,
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
        { onConflict: "exercise_id" },
      );
      if (error) {
        return { result: `Error saving: ${error.message}`, dbChanged: false };
      }
      // Keep the persisted Coach cursor in lockstep with a completed shooting
      // set. Without this, the next bare "make" can resolve against the just
      // finished set while the completion narration already describes the next
      // one.
      if (setCompleted) {
        ctx.logs.set(exerciseId, {
          exercise_id: exerciseId,
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
        });
        const nextWork = buildWorkoutNavigation(ctx).next_work_item;
        const { error: cursorError } = await supabase
          .from("workout_days")
          .update({
            active_exercise_id: nextWork?.exercise_id ?? null,
            active_set_number: nextWork?.set_number ?? null,
          })
          .eq("id", dayId)
          .eq("user_id", userId);
        if (cursorError) {
          return { result: `Error updating workout position: ${cursorError.message}`, dbChanged: false };
        }
        ctx.day.active_exercise_id = nextWork?.exercise_id ?? null;
        ctx.day.active_set_number = nextWork?.set_number ?? null;
      }
      const selectedTargetMakes = selectedSet
        ? targetMakesForSet(selectedSet, plan)
        : plan.perSetMakes;
      const selectedTargetAttempts = selectedSet
        ? targetAttemptsForSet(selectedSet, plan)
        : plan.perSetAttempts;
      const targetResult = selectedTargetMakes == null
        ? ""
        : ` Target: ${selectedTargetMakes}${
          selectedTargetAttempts == null ? "" : ` for ${selectedTargetAttempts}`
        }; ${
          makes >= selectedTargetMakes
            ? "target met"
            : makes <= selectedTargetMakes / 2
            ? "significantly below target and needs work"
            : "below target and needs work"
        }.`;
      const nextSetNumber = getCurrentSetNumber(totals.set_logs, plan);
      const nextSetResult = nextSetNumber == null
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
      */
    }

    case "set_set_completion": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const ex = ctx.exercises.find((exercise) => exercise.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };
      const requestedSet = Number(args.set_number);
      if (!Number.isInteger(requestedSet)) {
        return {
          result: "Error: a valid set_number is required",
          dbChanged: false,
        };
      }
      if (typeof args.completed !== "boolean") {
        return {
          result: "Error: completed must be true or false",
          dbChanged: false,
        };
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
      let setLogs = hydrateSetLogs(
        buildSetPlan(ex),
        meta,
        existing ?? undefined,
      );
      const current = setLogs.find((set) => set.set_number === requestedSet);
      const completed = args.completed;
      const targetAttempts = current
        ? targetAttemptsForSet(current, plan)
        : plan.perSetAttempts;
      const attempts = current?.attempts ?? 0;
      if (
        completed &&
        isShootingDrill(ex) &&
        targetAttempts != null &&
        attempts < targetAttempts &&
        args.confirmed_incomplete !== true
      ) {
        return {
          result: `You're ${current?.makes ?? 0} for ${attempts}, ${
            targetAttempts - attempts
          } shots left. Would you like to start this set or mark it complete as is?`,
          dbChanged: false,
          incompleteCompletionConfirmation: {
            exerciseId,
            drillName: ex.name,
            setNumber: requestedSet,
          },
        };
      }

      setLogs = updateSetLog(setLogs, plan, requestedSet, {
        completed,
        force_incomplete: !completed,
        makes: current?.makes ?? null,
        attempts: current?.attempts ??
          (current ? targetAttemptsForSet(current, plan) : plan.perSetAttempts),
        minutes: current?.minutes ??
          (completed
            ? current?.duration_seconds_override != null
              ? current.duration_seconds_override / 60
              : plan.perSetMinutes
            : null),
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
        { onConflict: "exercise_id" },
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
          setSideLabel(ex, requestedSet)
            ? ` (${setSideLabel(ex, requestedSet)})`
            : ""
        } of ${ex.name ?? "the drill"} marked ${
          completed ? "complete" : "incomplete"
        }.`,
        dbChanged: true,
      };
    }

    case "get_workout_position":
    // Retained for an in-flight session that received the prior tool schema.
    case "get_next_drill":
      return { result: buildWorkoutPositionSummary(ctx), dbChanged: false };

    case "set_current_position": {
      const resolved = resolveWorkoutExercise(args.exercise_id, args.drill_name);
      const exerciseId = resolved.id;
      const suppliedSet = args.set_number == null ? null : Number(args.set_number);
      if (
        !exerciseId ||
        (suppliedSet != null &&
          (!Number.isInteger(suppliedSet) || suppliedSet < 1))
      ) {
        return {
          result: "Choose one workout drill and, if supplied, a valid set number.",
          dbChanged: false,
        };
      }
      const targetState = orderedDrillStates(ctx).find(
        (state) => state.exercise.id === exerciseId,
      );
      const requestedSet = suppliedSet ??
        (targetState
          ? getCurrentSetNumber(targetState.totals.set_logs, targetState.plan)
          : null);
      const targetSet = targetState?.totals.set_logs.find(
        (set) => set.set_number === requestedSet,
      );
      if (
        !targetState ||
        targetState.totals.completed ||
        requestedSet == null ||
        requestedSet > targetState.plan.setCount ||
        targetSet?.completed
      ) {
        return {
          result: "That drill or set is not available. Use an unfinished set from the workout context.",
          dbChanged: false,
        };
      }
      const { error } = await supabase
        .from("workout_days")
        .update({
          active_exercise_id: exerciseId,
          active_set_number: requestedSet,
        })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      ctx.day.active_exercise_id = exerciseId;
      ctx.day.active_set_number = requestedSet;
      const sideLabel = setSideLabel(targetState.exercise, requestedSet);
      return {
        result: `Now on ${targetState.exercise.name ?? "the drill"}, set ${requestedSet} of ${
          targetState.plan.setCount
        }${sideLabel ? ` (${sideLabel})` : ""}.`,
        dbChanged: true,
      };
    }

    case "set_current_drill": {
      const resolved = resolveWorkoutExercise(
        args.exercise_id,
        args.drill_name,
      );
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
        (state) => state.exercise.id === exerciseId,
      );
      if (!targetState || targetState.totals.completed) {
        return {
          result:
            "That drill is already complete. Choose an unfinished drill instead.",
          dbChanged: false,
        };
      }
      const { error } = await supabase
        .from("workout_days")
        .update({
          active_exercise_id: exerciseId,
          active_set_number: getCurrentSetNumber(
            targetState.totals.set_logs,
            targetState.plan,
          ),
        })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      ctx.day.active_exercise_id = exerciseId;
      const setNumber = getCurrentSetNumber(
        targetState.totals.set_logs,
        targetState.plan,
      );
      ctx.day.active_set_number = setNumber;
      const sideLabel = setSideLabel(targetState.exercise, setNumber);
      return {
        result: `Now on drill ${targetState.position}, ${
          targetState.exercise.name ?? "unnamed drill"
        }, set ${setNumber ?? 1} of ${targetState.plan.setCount}${
          sideLabel ? ` (${sideLabel})` : ""
        }.`,
        dbChanged: true,
      };
    }

    case "search_exercise_catalog": {
      const rawQuery = String(args.query ?? "").trim();
      if (!rawQuery) {
        return { result: "Error: search query required", dbChanged: false };
      }
      const { data: catalog, error } = await supabase
        .from("exercise_video_clips")
        .select(
          "id, exercise_name, category, difficulty_level, description, coaching_notes, requires_both_sides",
        )
        .eq("active", true);
      if (error) {
        return {
          result: `Error searching: ${error.message}`,
          dbChanged: false,
        };
      }
      const matches = rankCatalogExercises(rawQuery, catalog ?? [], ctx);
      if (!matches.length) {
        return {
          result: `No catalog exercises matched "${rawQuery}".`,
          dbChanged: false,
        };
      }
      return {
        result: JSON.stringify({
          instruction:
            "Speak exercise names only. If the athlete already authorized an addition, choose the best match and call add_workout_exercise with its exact exercise_name. Never request or invent a catalog ID.",
          matches: matches.map((clip) => ({
            exercise_name: clip.exercise_name,
            category: clip.category,
            difficulty: clip.difficulty_level,
            focus: clip.description
              ? String(clip.description).slice(0, 140)
              : null,
          })),
        }),
        dbChanged: false,
      };
    }

    case "add_workout_exercise": {
      const catalogId = typeof args.catalog_exercise_id === "string"
        ? args.catalog_exercise_id
        : null;
      const exerciseName = typeof args.exercise_name === "string"
        ? args.exercise_name.trim()
        : "";
      if (!catalogId && !exerciseName) {
        return {
          result: "Search for the drill again, then add it by its exact name.",
          dbChanged: false,
        };
      }
      const { data: activeCatalog, error: clipError } = await supabase
        .from("exercise_video_clips")
        .select(
          "id, exercise_name, category, description, coaching_notes, requires_both_sides",
        )
        .eq("active", true);
      const clip = (activeCatalog ?? []).find(
        (candidate: { id: string; exercise_name: string | null }) =>
          catalogId
            ? candidate.id === catalogId
            : normalizeCatalogSearchText(candidate.exercise_name ?? "") ===
              normalizeCatalogSearchText(exerciseName),
      );
      if (clipError || !clip) {
        return {
          result:
            "That drill was not in the latest search results. Search its name again.",
          dbChanged: false,
        };
      }
      const { data: duplicate } = await supabase
        .from("workout_exercises")
        .select("id")
        .eq("day_id", dayId)
        .eq("user_id", userId)
        .eq("video_clip_id", clip.id)
        .limit(1)
        .maybeSingle();
      if (duplicate) {
        return {
          result: `${clip.exercise_name} is already in this workout.`,
          dbChanged: false,
        };
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
            /(\d+)\s*(?:to\s*\d+\s*)?(second|minute)/i,
          ),
        ),
      ]);
      const shooting = clip.category === "shooting";
      const finishing = clip.category === "finishing";
      const categoryIsTimed = ["ball_handling", "defense", "conditioning"]
        .includes(
          clip.category ?? "",
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
      const { data: addedExercise, error } = await supabase
        .from("workout_exercises")
        .insert({
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
          log_type: shooting || finishing
            ? "makes_attempts"
            : categoryIsTimed || durationMatch
            ? "minutes"
            : "checkbox",
          set_side_labels: clip.requires_both_sides
            ? ["left side", "right side"]
            : null,
        })
        .select("id")
        .single();
      if (error || !addedExercise) {
        return {
          result: `Error adding: ${error?.message ?? "the new drill could not be created"}`,
          dbChanged: false,
        };
      }
      const { error: activateError } = await supabase
        .from("workout_days")
        .update({ active_exercise_id: addedExercise.id, active_set_number: 1 })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (activateError) {
        return {
          result: `Added ${clip.exercise_name}, but could not make it current: ${activateError.message}`,
          dbChanged: true,
        };
      }
      ctx.day.active_exercise_id = addedExercise.id;
      ctx.day.active_set_number = 1;
      await refreshEstimate();
      return {
        result: `Added ${clip.exercise_name} and moved to set 1.`,
        dbChanged: true,
      };
    }

    case "remove_workout_exercise": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const exercise = ctx.exercises.find((candidate) =>
        candidate.id === exerciseId
      );
      const exerciseName = exercise?.name ?? "the exercise";
      const { error } = await supabase
        .from("workout_exercises")
        .delete()
        .eq("id", exerciseId)
        .eq("day_id", dayId)
        .eq("user_id", userId);
      if (error) {
        return { result: `Error removing: ${error.message}`, dbChanged: false };
      }
      await supabase
        .from("workout_days")
        .update({ active_exercise_id: null, active_set_number: null })
        .eq("id", dayId)
        .eq("user_id", userId)
        .eq("active_exercise_id", exerciseId);
      await refreshEstimate();
      return {
        result:
          `Removed ${exerciseName}; its logged results no longer count in analytics.`,
        dbChanged: true,
      };
    }

    case "list_workout_drills": {
      const category = typeof args.category === "string" && args.category.trim()
        ? args.category.trim()
        : null;
      return {
        result: buildWorkoutDrillListSummary(ctx, category),
        dbChanged: false,
      };
    }

    case "get_progress":
      return { result: buildProgressSummary(ctx), dbChanged: false };

    case "skip_drill": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const next = findNextExercise(ctx, exerciseId);
      if (!next) {
        return {
          result:
            "There are no other unfinished drills to move to. This drill was left unchanged.",
          dbChanged: false,
        };
      }
      const nextState = orderedDrillStates(ctx).find(
        (state) => state.exercise.id === next.id,
      );
      const nextSetNumber = nextState
        ? getCurrentSetNumber(nextState.totals.set_logs, nextState.plan)
        : 1;
      const { error } = await supabase
        .from("workout_days")
        .update({ active_exercise_id: next.id, active_set_number: nextSetNumber })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      ctx.day.active_exercise_id = next.id;
      ctx.day.active_set_number = nextSetNumber;
      return {
        result: `Moved to ${
          next.name ?? "the next drill"
        }. The previous drill was left unchanged.`,
        dbChanged: true,
      };
    }

    case "complete_drill": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };

      const plan = effectivePlanForExercise(ex, existing);
      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      const setLogs = markAllSetsComplete(
        hydrateSetLogs(buildSetPlan(ex), meta, existing ?? undefined),
        plan,
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
          minutes_completed: totals.minutes_completed ??
            existing?.minutes_completed ?? null,
          difficulty: existing?.difficulty ?? null,
          notes: encodeExerciseLogMeta({
            set_logs: totals.set_logs,
            user_notes: meta.user_notes ?? null,
            per_set_attempts_override: meta.per_set_attempts_override ?? null,
            per_set_minutes_override: meta.per_set_minutes_override ?? null,
          }),
        },
        { onConflict: "exercise_id" },
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
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };

      const plan = effectivePlanForExercise(ex, existing);
      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      const reopened = hydrateSetLogs(
        buildSetPlan(ex),
        meta,
        existing ?? undefined,
      ).map((set) => ({
        ...set,
        completed: false,
        force_incomplete: true,
      }));
      const totals = aggregateSetLogs(reopened, plan);

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
          notes: encodeExerciseLogMeta({
            set_logs: totals.set_logs,
            user_notes: meta.user_notes ?? null,
            per_set_attempts_override: meta.per_set_attempts_override ?? null,
            per_set_minutes_override: meta.per_set_minutes_override ?? null,
          }),
        },
        { onConflict: "exercise_id" },
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
        result: `Marked "${
          ex?.name ?? "drill"
        }" as not complete without resetting its results.`,
        dbChanged: true,
      };
    }

    case "reopen_workout": {
      if (!ctx.day.completed) {
        return { result: "Workout is already open.", dbChanged: false };
      }
      const { error: dayError } = await supabase
        .from("workout_days")
        .update({
          completed: false,
          completion_kind: null,
          finalized_at: null,
        })
        .eq("id", dayId)
        .eq("user_id", userId);
      if (dayError) {
        return { result: `Error: ${dayError.message}`, dbChanged: false };
      }
      const { error: logError } = await supabase
        .from("workout_day_logs")
        .delete()
        .eq("day_id", dayId)
        .eq("user_id", userId);
      if (logError) {
        return { result: `Error: ${logError.message}`, dbChanged: false };
      }
      ctx.day.completed = false;
      return {
        result: "Workout reopened without resetting any drill results.",
        dbChanged: true,
      };
    }

    case "save_note": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const existing = ctx.logs.get(exerciseId);
      const ex = ctx.exercises.find((e) => e.id === exerciseId);
      if (!ex) return { result: "Error: exercise not found", dbChanged: false };

      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      const note = String(args.note ?? "").trim().slice(0, 500);
      if (!note) return { result: "Error: note required", dbChanged: false };

      const userNotes = meta.user_notes?.trim()
        ? `${meta.user_notes}\n${note}`
        : note;
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
        { onConflict: "exercise_id" },
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      return {
        result: `Note saved on ${ex.name ?? "drill"}.`,
        dbChanged: true,
      };
    }

    case "set_shooting_set_targets": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const ex = ctx.exercises.find((exercise) => exercise.id === exerciseId);
      if (!ex || ex.log_type !== "makes_attempts") {
        return {
          result: "Only shooting and finishing set targets can be changed.",
          dbChanged: false,
        };
      }

      const existing = ctx.logs.get(exerciseId);
      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      const plan = effectivePlanForExercise(ex, existing);
      let setLogs = hydrateSetLogs(
        buildSetPlan(ex),
        meta,
        existing ?? undefined,
      );
      const explicitSetNumber = Number(args.set_number);
      const setNumber = Number.isInteger(explicitSetNumber)
        ? explicitSetNumber
        : getCurrentSetNumber(setLogs, plan) ?? 1;
      if (setNumber < 1 || setNumber > plan.setCount) {
        return {
          result: `Set number must be between 1 and ${plan.setCount}.`,
          dbChanged: false,
        };
      }

      const currentSet = setLogs.find((set) => set.set_number === setNumber)!;
      const requestedAttempts = Number(args.target_attempts);
      const requestedMakes = Number(args.target_makes);
      const hasAttempts = args.target_attempts != null &&
        Number.isInteger(requestedAttempts);
      const hasMakes = args.target_makes != null &&
        Number.isInteger(requestedMakes);
      if (!hasAttempts && !hasMakes) {
        return {
          result: "Tell me the new target makes, attempts, or both.",
          dbChanged: false,
        };
      }
      const currentAttempts = targetAttemptsForSet(currentSet, plan);
      const currentMakes = targetMakesForSet(currentSet, plan);
      const nextAttempts = hasAttempts ? requestedAttempts : currentAttempts;
      const nextMakes = hasMakes
        ? requestedMakes
        : currentMakes;
      if (
        nextAttempts == null ||
        nextMakes == null ||
        nextAttempts < 1 ||
        nextAttempts > 500 ||
        nextMakes < 0 ||
        nextMakes > nextAttempts
      ) {
        return {
          result:
            "Targets require 1–500 attempts and makes between 0 and attempts.",
          dbChanged: false,
        };
      }
      const recordedAttempts = currentSet.attempts ?? 0;
      const reopensCompletedSet =
        currentSet.completed && nextAttempts > recordedAttempts;

      setLogs = updateSetLog(setLogs, plan, setNumber, {
        target_makes_override: nextMakes,
        target_attempts_override: nextAttempts,
        attempts: currentSet.makes == null && !currentSet.completed
          ? null
          : currentSet.attempts,
        completed: !reopensCompletedSet && currentSet.completed &&
          (currentSet.attempts ?? 0) >= nextAttempts,
        force_incomplete: reopensCompletedSet ? false : currentSet.force_incomplete,
      });
      const totals = aggregateSetLogs(setLogs, plan);
      const persistedSetLogs = totals.set_logs.map((set) =>
        set.set_number === setNumber &&
          currentSet.makes == null &&
          !currentSet.completed
          ? { ...set, attempts: null }
          : set
      );
      const notes = encodeExerciseLogMeta({
        set_logs: persistedSetLogs,
        user_notes: meta.user_notes ?? null,
        per_set_attempts_override: meta.per_set_attempts_override ?? null,
        per_set_minutes_override: meta.per_set_minutes_override ?? null,
      });
      const updatedLog: LogRow = {
        exercise_id: exerciseId,
        completed: totals.completed,
        makes: totals.makes,
        attempts: totals.attempts,
        minutes_completed: existing?.minutes_completed ?? null,
        difficulty: existing?.difficulty ?? null,
        notes,
      };
      const { error } = await supabase.from("exercise_logs").upsert(
        { ...updatedLog, day_id: dayId, user_id: userId },
        { onConflict: "exercise_id" },
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      ctx.logs.set(exerciseId, updatedLog);
      if (reopensCompletedSet) {
        const { error: cursorError } = await supabase
          .from("workout_days")
          .update({
            active_exercise_id: exerciseId,
            active_set_number: setNumber,
          })
          .eq("id", dayId)
          .eq("user_id", userId);
        if (cursorError) {
          return {
            result: `Error: ${cursorError.message}`,
            dbChanged: false,
          };
        }
        ctx.day.active_exercise_id = exerciseId;
        ctx.day.active_set_number = setNumber;
      }
      return {
        result: reopensCompletedSet
          ? `Set ${setNumber} of ${ex.name ?? "this drill"} has been reopened. Its target changed from ${currentAttempts} to ${nextAttempts} attempts, and your ${currentSet.makes ?? 0} for ${recordedAttempts} score is unchanged.`
          : `Set ${setNumber} of ${
            ex.name ?? "this drill"
          } now targets ${nextMakes} makes in ${nextAttempts} attempts.`,
        dbChanged: true,
      };
    }

    case "set_timed_set_duration": {
      const exerciseId = validExercise(args.exercise_id, args.drill_name);
      if (!exerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const ex = ctx.exercises.find((exercise) => exercise.id === exerciseId);
      if (!ex || !isTimedExercise(ex)) {
        return {
          result: "That drill does not use timed sets.",
          dbChanged: false,
        };
      }
      const durationSeconds = Number(args.duration_seconds);
      if (
        !Number.isFinite(durationSeconds) || durationSeconds < 5 ||
        durationSeconds > 3600
      ) {
        return {
          result: "Set duration must be between 5 seconds and 60 minutes.",
          dbChanged: false,
        };
      }

      const existing = ctx.logs.get(exerciseId);
      const meta = decodeExerciseLogMeta(existing?.notes ?? null);
      const plan = effectivePlanForExercise(ex, existing);
      let setLogs = hydrateSetLogs(
        buildSetPlan(ex),
        meta,
        existing ?? undefined,
      );
      const explicitSetNumber = Number(args.set_number);
      const setNumber = Number.isInteger(explicitSetNumber)
        ? explicitSetNumber
        : getCurrentSetNumber(setLogs, plan) ?? 1;
      if (setNumber < 1 || setNumber > plan.setCount) {
        return {
          result: `Set number must be between 1 and ${plan.setCount}.`,
          dbChanged: false,
        };
      }
      setLogs = updateSetLog(setLogs, plan, setNumber, {
        duration_seconds_override: Math.round(durationSeconds),
      });
      const notes = encodeExerciseLogMeta({
        set_logs: setLogs,
        user_notes: meta.user_notes ?? null,
        per_set_attempts_override: meta.per_set_attempts_override ?? null,
        per_set_minutes_override: null,
      });
      const updatedLog: LogRow = {
        exercise_id: exerciseId,
        completed: existing?.completed ?? false,
        makes: existing?.makes ?? null,
        attempts: existing?.attempts ?? null,
        minutes_completed: existing?.minutes_completed ?? null,
        difficulty: existing?.difficulty ?? null,
        notes,
      };
      const { error } = await supabase.from("exercise_logs").upsert(
        {
          ...updatedLog,
          day_id: dayId,
          user_id: userId,
        },
        { onConflict: "exercise_id" },
      );
      if (error) return { result: `Error: ${error.message}`, dbChanged: false };
      ctx.logs.set(exerciseId, updatedLog);

      const durationLabel = durationSeconds < 60
        ? `${Math.round(durationSeconds)} seconds`
        : `${Number((durationSeconds / 60).toFixed(2))} minute${
          durationSeconds === 60 ? "" : "s"
        }`;
      return {
        result: `Set ${setNumber} of ${
          ex.name ?? "this drill"
        } is now ${durationLabel}.`,
        dbChanged: true,
      };
    }

    case "start_timer": {
      const requestedMinutes = Number(args.minutes);
      const requestedSeconds = Number(args.seconds);
      const timerExerciseId = validExercise(
        args.exercise_id,
        args.drill_name,
      );
      const hasTimerExerciseReference =
        (typeof args.exercise_id === "string" && args.exercise_id.trim()) ||
        (typeof args.drill_name === "string" && args.drill_name.trim());
      if (hasTimerExerciseReference && !timerExerciseId) {
        return {
          result: "I couldn't uniquely match that workout drill.",
          dbChanged: false,
        };
      }
      const currentExercise = timerExerciseId
        ? ctx.exercises.find((exercise) => exercise.id === timerExerciseId) ??
          null
        : findCurrentExercise(ctx);
      if (!currentExercise || !isTimedExercise(currentExercise)) {
        return {
          result: "That set does not use timed sets, so I won't start a timer.",
          dbChanged: false,
        };
      }
      const currentLog = currentExercise
        ? ctx.logs.get(currentExercise.id)
        : undefined;
      const currentPlan = currentExercise
        ? effectivePlanForExercise(currentExercise, currentLog)
        : null;
      const currentSetLogs = currentExercise
        ? hydrateSetLogs(
          buildSetPlan(currentExercise),
          decodeExerciseLogMeta(currentLog?.notes ?? null),
          currentLog ?? undefined,
        )
        : [];
      const requestedSetNumber = Number(args.set_number);
      const timerSetNumber =
        currentExercise && currentPlan && isTimedExercise(currentExercise)
          ? Number.isInteger(requestedSetNumber) &&
              requestedSetNumber >= 1 &&
              requestedSetNumber <= currentPlan.setCount
            ? requestedSetNumber
            : getCurrentSetNumber(currentSetLogs, currentPlan)
          : null;
      const currentSetLog = currentSetLogs.find(
        (set) => set.set_number === timerSetNumber,
      );
      const hasRequestedSeconds = Number.isFinite(requestedSeconds) &&
        requestedSeconds > 0;
      const hasRequestedMinutes = Number.isFinite(requestedMinutes) &&
        requestedMinutes > 0;
      const hasRequestedDuration = hasRequestedSeconds || hasRequestedMinutes;
      const savedSetDurationSeconds =
        currentExercise && isTimedExercise(currentExercise)
          ? currentSetLog?.duration_seconds_override ?? null
          : null;
      const defaultDurationMinutes =
        currentExercise && isTimedExercise(currentExercise)
          ? currentPlan?.perSetMinutes ?? null
          : null;
      if (
        !hasRequestedDuration &&
        savedSetDurationSeconds == null &&
        defaultDurationMinutes == null
      ) {
        return {
          result:
            "This set does not have a timed duration. Tell me how many minutes you want.",
          dbChanged: false,
        };
      }
      const durationSeconds = Math.min(
        hasRequestedSeconds
          ? Math.max(5, Math.round(requestedSeconds))
          : hasRequestedMinutes
          ? Math.max(5, Math.round(requestedMinutes * 60))
          : savedSetDurationSeconds ??
            Math.max(5, Math.round(defaultDurationMinutes! * 60)),
        180 * 60,
      );
      const durationLabel = durationSeconds < 60
        ? `${durationSeconds}-second`
        : `${Number((durationSeconds / 60).toFixed(2))}-minute`;
      return {
        result: `A ${durationLabel} timer has been started.`,
        dbChanged: false,
        clientAction: {
          type: "start_timer",
          duration_seconds: durationSeconds,
          timer_exercise_id: timerSetNumber != null
            ? currentExercise?.id ?? null
            : null,
          timer_set_number: timerSetNumber,
        },
      };
    }
    case "correct_current_shooting_total": {
      const makes = Number(args.makes);
      const attempts = Number(args.attempts);
      const currentExercise = findCurrentExercise(ctx);
      if (!Number.isInteger(makes) || makes < 0 || !Number.isInteger(attempts) ||
        attempts < 0 || makes > attempts) {
        return {
          result: "Makes cannot be greater than attempts.",
          dbChanged: false,
        };
      }
      if (!currentExercise || !isShootingDrill(currentExercise)) {
        return {
          result: `You're not on a shooting or finishing drill. You're on ${
            currentExercise?.name ?? "the current drill"
          }.`,
          dbChanged: false,
        };
      }
      return {
        result: "Current shooting total sent to the athlete device.",
        dbChanged: false,
        clientAction: { type: "set_shooting_total", makes, attempts },
        // The device applies the current cursor and speaks its prerecorded,
        // target-aware progress reply. Haiku must not narrate this mutation.
        skipModelResponse: true,
      };
    }
    case "get_timer_status":
      return {
        result: "Fetching exact live timer status from the athlete device.",
        dbChanged: false,
        clientAction: { type: "get_timer_status" },
        skipModelResponse: true,
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
    case "stop_timer":
      return {
        result: "Timer paused.",
        dbChanged: false,
        clientAction: { type: "pause_timer" },
      };

    default:
      return { result: `Unknown tool: ${name}`, dbChanged: false };
  }
}

export function buildRealtimeSessionConfig(
  instructions: string,
  model: string,
  voice: string,
  audioProfile: "bluetooth" | "speaker" = "bluetooth",
): Record<string, unknown> {
  return {
    type: "realtime",
    model,
    instructions,
    // Static instructions + retention_ratio truncation maximize implicit prompt cache hits.
    reasoning: {
      effort: "high",
    },
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
        noise_reduction: {
          type: audioProfile === "bluetooth" ? "near_field" : "far_field",
        },
        transcription: {
          model: "gpt-transcribe",
          language: "en",
          prompt:
            "Basketball training session. The user may report shots, ask about progress, navigate drills, control timers, request coaching, or modify the workout. Casual interjections may precede commands. Use basketball context to distinguish similar sounds: a one-word shot result is likely 'make' or 'miss', while phrases such as 'list workout drills' retain 'list'. Otherwise preserve the spoken wording.",
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "high",
          // The client owns routing and interruption for deterministic and
          // model-backed turns.
          create_response: false,
          interrupt_response: false,
        },
      },
      output: {
        voice,
        //speed: 1.1,
      },
    },
    tools: getRealtimeTools(),
    tool_choice: "auto",
  };
}
