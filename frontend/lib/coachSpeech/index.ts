export type CoachSpeechScope = "set" | "exercise" | "workout";
export type CoachSpeechUnit = "set" | "drill";

export interface ShotIntentArgs {
  mode: "increment" | "replace";
  makes: number;
  attempts: number;
  source: "count" | "ratio";
}

export type LastShotCorrectionArgs =
  | { from: "make" | "miss"; to: "make" | "miss" }
  | { action: "flip" };

export interface MissTotalCorrectionArgs {
  misses: number;
}

export interface TimerIntentArgs {
  action: "start" | "pause" | "resume" | "stop" | "reset" | "restart" | "status";
  durationSeconds?: number;
  useSetDefault?: boolean;
}

export interface TimerDurationConfirmationArgs {
  accepted: boolean;
}

export interface SetCompletionConfirmationArgs {
  accepted: boolean;
}

export interface ContinuationConfirmationArgs {
  accepted: boolean;
}

export interface StartupConfirmationArgs {
  accepted: boolean;
}

export interface DrillExplanationArgs {
  target: "current";
}

export interface DrillRequestArgs {
  query: string;
  action: "move_or_add" | "add";
}

export interface SpeechControlIntentArgs {
  action: "stop_speaking";
}

export type NavigationTarget =
  | { type: "current" | "next" | "previous" | "first" | "last" }
  | { type: "ordinal"; ordinal: number }
  | { type: "from_end"; offset: number }
  | { type: "named"; name: string; match: "exact" };

export interface NavigationIntentArgs {
  mode: "query" | "action";
  unit: CoachSpeechUnit;
  target: NavigationTarget;
  skip?: boolean;
  /** Conversational continuation must retain an unfinished current set. */
  resumeCurrentIfIncomplete?: boolean;
}

export interface CompletionIntentArgs {
  action: "complete" | "reopen";
  scope: CoachSpeechScope;
  setNumber?: number;
}

export interface ProgressIntentArgs {
  metric: "progress" | "percentage" | "remaining" | "target" | "totals";
  scope: CoachSpeechScope;
  totalsField?: "makes" | "misses" | "attempts";
}

export interface RemoveDrillIntentArgs {
  name: string;
  match: "exact";
}

export interface SetPrescriptionIntentArgs {
  setNumber?: number;
  durationSeconds?: number;
  targetAttempts?: number;
  additionalAttempts?: boolean;
  /** Set the target to the attempts already recorded plus this value. */
  remainingAttempts?: boolean;
  /** Signed change to the current shooting-attempt target. */
  attemptAdjustment?: number;
  confirmedTargetChange?: boolean;
}

export interface CoachSpeechParseContext {
  /**
   * Number-first target requests ("twenty shots") are only unambiguous when
   * the caller has an active shooting set.
   */
  activeShootingSet?: boolean;
}

interface IntentBase<K extends string, A> {
  kind: K;
  args: A;
  confidence: number;
  heardLabel: string;
  safeToDelete: boolean;
}

export type CoachSpeechIntent =
  | IntentBase<"shot", ShotIntentArgs>
  | IntentBase<"undo_shot", Record<string, never>>
  | IntentBase<"correct_last_shot", LastShotCorrectionArgs>
  | IntentBase<"correct_shot_misses", MissTotalCorrectionArgs>
  | IntentBase<"timer", TimerIntentArgs>
  | IntentBase<"timer_duration_confirmation", TimerDurationConfirmationArgs>
  | IntentBase<"set_completion_confirmation", SetCompletionConfirmationArgs>
  | IntentBase<"continuation_confirmation", ContinuationConfirmationArgs>
  | IntentBase<"startup_confirmation", StartupConfirmationArgs>
  | IntentBase<"drill_explanation", DrillExplanationArgs>
  | IntentBase<"drill_request", DrillRequestArgs>
  | IntentBase<"speech_control", SpeechControlIntentArgs>
  | IntentBase<"navigation", NavigationIntentArgs>
  | IntentBase<"completion", CompletionIntentArgs>
  | IntentBase<"progress", ProgressIntentArgs>
  | IntentBase<"list_drills", Record<string, never>>
  | IntentBase<"repeat", Record<string, never>>
  | IntentBase<"remove_drill", RemoveDrillIntentArgs>
  | IntentBase<"set_prescription", SetPrescriptionIntentArgs>;

type Parser = (text: string) => CoachSpeechIntent | null;

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
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
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_WORD =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)";
const NUMBER = `(?:\\d+|${NUMBER_WORD}(?:[ -]${NUMBER_WORD}){0,2})`;
const ORDINAL_WORDS: Record<string, number> = {
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
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
};

const LEADING_SPEECH_PADDING = new Set([
  "ah",
  "bruh",
  "bro",
  "dang",
  "dangit",
  "damn",
  "dammit",
  "hey",
  "like",
  "man",
  "oh",
  "ok",
  "okay",
  "oops",
  "shoot",
  "uh",
  "um",
  "ugh",
  "well",
  "yo",
]);

const SUBJECT_PADDING = new Set([
  "actually",
  "definitely",
  "freaking",
  "just",
  "literally",
  "really",
]);

function normalizeConversationalPadding(text: string): string {
  const words = text.split(" ").filter(Boolean);
  while (words.length > 1 && LEADING_SPEECH_PADDING.has(words[0])) words.shift();

  // Transcription occasionally adds a suffix to short filler words ("justed").
  for (let index = 0; index < words.length; index += 1) {
    if (/^just(?:ed|in|ing)?$/.test(words[index])) words[index] = "just";
  }

  if (words[0] === "i") {
    while (words.length > 2 && SUBJECT_PADDING.has(words[1]) && words[1] !== "just") {
      words.splice(1, 1);
    }
  }
  return words.join(" ");
}

function normalizeSingleWordShotTranscription(text: string): string {
  if (text.includes(" ")) return text;
  // These corrections are intentionally limited to an entire one-word turn,
  // so "list workout drills" and other legitimate commands stay untouched.
  if (text === "list") return "miss";
  if (text === "may") return "make";
  return text;
}

function intent<K extends CoachSpeechIntent["kind"]>(
  kind: K,
  args: Extract<CoachSpeechIntent, { kind: K }>["args"],
  heardLabel: string,
  confidence = 1
): Extract<CoachSpeechIntent, { kind: K }> {
  return { kind, args, confidence, heardLabel, safeToDelete: true } as Extract<
    CoachSpeechIntent,
    { kind: K }
  >;
}

export function normalizeCoachSpeech(transcript: string | null | undefined): string {
  let text = String(transcript ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\bi m\b/g, "im")
    .replace(/\bwhat s\b/g, "whats")
    .replace(/\bwork[\s-]+out\b/g, "workout")
    .replace(/\bcount[\s-]+down\b/g, "countdown")
    .replace(/\bstop[\s-]+watch\b/g, "stopwatch")
    .replace(/\b(?:a|the)\s*timer\b/g, "timer")
    .replace(/\bair[\s-]?ball(?:ed)?\b/g, (value) =>
      /ed$/.test(value) ? "airballed" : "airball"
    )
    .replace(/[^a-z0-9/: -]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  text = normalizeConversationalPadding(text);
  text = text
    .replace(
      /^(?:(?:yo|hey|hi|ok|okay)\s+)?(?:court\s+)?coach(?:es|s)?(?:\s+|$)/,
      ""
    )
    .replace(
      /^(?:(?:can|could|would|will)\s+you|can\s+i|could\s+i|can\s+we)\s+/,
      ""
    )
    .replace(/^please\s+/, "")
    .replace(/^(?:please\s+)?tell\s+me\s+/, "")
    .replace(/^please\s+/, "")
    .replace(/^(?:so\s+)+/, "")
    .replace(/^(?:fire\s+up)\s+/, "start ")
    .replace(/^(start|set)\s+me\s+(?:a\s+)?/, "$1 a ")
    .replace(/\s+(?:court\s+)?coach(?:es|s)?$/, "")
    .replace(/\s+please$/, "")
    .trim();
  return normalizeSingleWordShotTranscription(text);
}

export function parseSpokenNumber(value: string): number | null {
  const normalized = value.toLowerCase().replace(/-/g, " ").trim();
  if (/^\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 999 ? numeric : null;
  }

  const words = normalized.split(/\s+/).filter((word) => word !== "and");
  if (!words.length) return null;
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word in SMALL_NUMBERS) current += SMALL_NUMBERS[word];
    else if (word in TENS) current += TENS[word];
    else if (word === "hundred" && current > 0) current *= 100;
    else return null;
  }
  total += current;
  return total <= 999 ? total : null;
}

function parseOrdinal(value: string): number | null {
  const wordOrdinal = ORDINAL_WORDS[value];
  if (wordOrdinal) return wordOrdinal;
  const numeric = value.match(/^(\d+)(?:st|nd|rd|th)$/);
  if (numeric) return Number(numeric[1]);
  return parseSpokenNumber(value);
}

function validShotValues(makes: number | null, attempts: number | null): boolean {
  return makes != null &&
    attempts != null &&
    makes >= 0 &&
    attempts >= 0 &&
    attempts <= 500 &&
    makes <= attempts;
}

function shotLabel(makes: number, attempts: number, mode: ShotIntentArgs["mode"]): string {
  if (mode === "replace" || (makes > 0 && makes < attempts)) {
    return `${makes} for ${attempts} heard`;
  }
  return makes === attempts
    ? `${attempts} ${attempts === 1 ? "make" : "makes"} heard`
    : `${attempts} ${attempts === 1 ? "miss" : "misses"} heard`;
}

export const parseShotIntent: Parser = (text) => {
  const explicitTotals = text.match(
    new RegExp(
      `^(?:i\\s+)?(?:have\\s+)?(${NUMBER})\\s+(?:makes?|buckets?|swishes?)\\s+and\\s+(${NUMBER})\\s+(?:miss(?:es)?|bricks?|airballs?)$`,
    ),
  );
  if (explicitTotals) {
    const makes = parseSpokenNumber(explicitTotals[1]);
    const misses = parseSpokenNumber(explicitTotals[2]);
    const attempts = makes != null && misses != null ? makes + misses : null;
    if (!validShotValues(makes, attempts)) return null;
    return intent(
      "shot",
      { mode: "replace", makes: makes!, attempts: attempts!, source: "count" },
      shotLabel(makes!, attempts!, "replace"),
      0.99,
    );
  }
  const ratio = text.match(
    new RegExp(
      `(?:\\b(?:im|i am|currently)(?:\\s+(?:actually|currently|now))?\\s+|^i\\s+|^)(?:(just\\s+)?(?:made|hit)\\s+)?(${NUMBER})\\s*(?:/|for|out of|of)\\s*(${NUMBER})(?:\\s+shots?)?(?:\\s*,?\\s*${NUMBER}\\s+shots?\\s+left)?`
    )
  );
  if (ratio) {
    const makes = parseSpokenNumber(ratio[2]);
    const attempts = parseSpokenNumber(ratio[3]);
    if (
      makes == null ||
      attempts == null ||
      makes < 0 ||
      attempts < 0 ||
      makes > 500 ||
      attempts > 500
    ) return null;
    const mode: ShotIntentArgs["mode"] = /^(?:i\s+)?(?:just\s+)?(?:made|hit)\b/.test(text)
      ? "increment"
      : "replace";
    if (mode === "increment" && (attempts === 0 || makes > attempts)) return null;
    return intent(
      "shot",
      { mode, makes: makes!, attempts: attempts!, source: "ratio" },
      shotLabel(makes!, attempts!, mode)
    );
  }

  const split = text.match(
    new RegExp(
      `^(?:i\\s+)?(?:just\\s+)?(?:made|hit)\\s+(${NUMBER})(?:\\s+shots?)?\\s+and\\s+(?:missed|bricked|airballed)\\s+(${NUMBER})(?:\\s+shots?)?$`
    )
  );
  if (split) {
    const makes = parseSpokenNumber(split[1]);
    const misses = parseSpokenNumber(split[2]);
    if (makes == null || misses == null || makes + misses < 1 || makes + misses > 100) return null;
    return intent(
      "shot",
      { mode: "increment", makes, attempts: makes + misses, source: "count" },
      shotLabel(makes, makes + misses, "increment")
    );
  }

  const verbCount = text.match(
    new RegExp(
      `^(?:i\\s+)?(?:just\\s+)?(made|make|hit|swished|missed|miss|bricked|brick|airballed|airball)\\s+(${NUMBER})(?:\\s+more)?(?:\\s+(?:shots?|buckets?|makes?|misses?|bricks?|airballs?))?(?:\\s+(?:in a row|straight))?(?:\\s+again)?$`
    )
  );
  if (verbCount) {
    const count = parseSpokenNumber(verbCount[2]);
    if (count == null || count < 1 || count > 100) return null;
    const made = /^(?:made|make|hit|swished)$/.test(verbCount[1]);
    const makes = made ? count : 0;
    return intent(
      "shot",
      { mode: "increment", makes, attempts: count, source: "count" },
      shotLabel(makes, count, "increment")
    );
  }

  const nounCount = text.match(
    new RegExp(`^(${NUMBER})\\s+(makes?|buckets?|swishes?|misses?|bricks?|airballs?)$`)
  );
  if (nounCount) {
    const count = parseSpokenNumber(nounCount[1]);
    if (count == null || count < 1 || count > 100) return null;
    const made = /^(?:make|bucket|swish)/.test(nounCount[2]);
    const makes = made ? count : 0;
    return intent(
      "shot",
      { mode: "increment", makes, attempts: count, source: "count" },
      shotLabel(makes, count, "increment")
    );
  }

  if (
    /^(?:(?:i\s+)?(?:just\s+)?)?(?:make|made(?: it)?|hit(?: it)?|swish(?:ed)?|bucket|another make)(?:\s+(?:one|another)(?:\s+shot)?|\s+again)?$/.test(
      text
    )
  ) {
    return intent(
      "shot",
      { mode: "increment", makes: 1, attempts: 1, source: "count" },
      "1 make heard"
    );
  }
  if (
    /^(?:(?:i\s+)?(?:just\s+)?)?(?:miss(?:ed)?|brick(?:ed)?|airball(?:ed)?|another miss)(?:\s+(?:one|another)(?:\s+shot)?|\s+again)?$/.test(
      text
    )
  ) {
    return intent(
      "shot",
      { mode: "increment", makes: 0, attempts: 1, source: "count" },
      "1 miss heard"
    );
  }
  return null;
};

export const parseMissTotalCorrectionIntent: Parser = (text) => {
  const match = text.match(
    new RegExp(
      `^(?:i\\s+)?(?:have\\s+)?(?:only\\s+)?(?:missed|miss)\\s+(${NUMBER})(?:\\s+(?:shot|shots|time|times))?$`,
    ),
  );
  const misses = match ? parseSpokenNumber(match[1]) : null;
  if (misses == null || misses < 1 || misses > 500) return null;
  return intent(
    "correct_shot_misses",
    { misses },
    `${misses} ${misses === 1 ? "miss" : "misses"} total heard`,
    0.99,
  );
};

function parseDuration(value: string, unit: string): number | null {
  const amount = /^(?:a|an)$/.test(value) ? 1 : parseSpokenNumber(value);
  if (amount == null || amount <= 0) return null;
  const multiplier = /^(?:hours?|hrs?)/.test(unit)
    ? 3600
    : /^(?:minutes?|mins?)/.test(unit)
    ? 60
    : 1;
  const seconds = amount * multiplier;
  return seconds <= 24 * 60 * 60 ? seconds : null;
}

function formatDurationLabel(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours}-hour`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes}-minute`;
  }
  return `${seconds}-second`;
}

export const parseTimerIntent: Parser = (text) => {
  const explicitPatterns: RegExp[] = [
    new RegExp(
      `^(?:start|begin|run|set)(?:\\s+(?:a|the))?\\s+(?:timer|time|countdown|stopwatch)(?:\\s+for)?\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)(?:\\s+for\\s+(?:this|that|the current)\\s+set)?$`
    ),
    new RegExp(
      `^(?:start|begin|run|set)(?:\\s+me)?(?:\\s+a)?\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\s+(?:timer|time|countdown|stopwatch)(?:\\s+for\\s+(?:this|that|the current)\\s+set)?$`
    ),
    new RegExp(
      `^(?:give me|i need|make)(?:\\s+a)?\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\s+(?:timer|time|countdown)$`
    ),
    new RegExp(
      `^(?:timer|countdown)(?:\\s+for)?\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)$`
    ),
    new RegExp(
      `^(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\s+(?:timer|time|countdown)$`
    ),
    new RegExp(
      `^(?:start|begin|run|set)(?:\\s+a)?\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)$`
    ),
  ];
  for (const pattern of explicitPatterns) {
    const explicit = text.match(pattern);
    if (!explicit) continue;
    const durationSeconds = parseDuration(explicit[1], explicit[2]);
    if (durationSeconds == null) return null;
    return intent(
      "timer",
      { action: "start", durationSeconds },
      `Start ${formatDurationLabel(durationSeconds)} timer heard`
    );
  }

  const controls: [RegExp, TimerIntentArgs["action"], string][] = [
    [
      /^(?:pause|hold|freeze)(?:\s+the)?\s+(?:timer|countdown|stopwatch)$/,
      "pause",
      "Pause timer heard",
    ],
    [
      /^(?:resume|continue|unpause)(?:\s+the)?\s+(?:timer|countdown|stopwatch)$|^(?:start|turn)(?:\s+it)?\s+back(?:\s+up)?(?:\s+again)?$/,
      "resume",
      "Resume timer heard",
    ],
    [
      /^(?:stop|end|cancel|clear|break|take a break)(?:\s+(?:the))?\s+(?:timer|countdown|stopwatch)$/,
      "pause",
      "Pause timer heard",
    ],
    [
      /^(?:reset)(?:\s+the)?\s+(?:timer|countdown|stopwatch)$/,
      "reset",
      "Reset timer heard",
    ],
    [
      /^(?:restart|start over)(?:\s+the)?\s+(?:timer|countdown|stopwatch)$|^(?:restart|start)(?:\s+the)?\s+(?:timer|countdown|stopwatch)\s+over$/,
      "restart",
      "Restart timer heard",
    ],
    [
      /^(?:timer status|(?:whats|what is|how much|how long) (?:(?:time|it)\s+is|time|is)?\s*(?:left|remaining)(?:\s+on(?:\s+the)?\s+(?:timer|countdown))?|(?:how much|how long) time (?:do i have|is there|is left|remains)|(?:whats|what is) (?:the )?time|what time is it|(?:whats|what is) (?:the )?(?:timer|countdown) at|what(?:s| is) (?:on )?(?:the )?(?:timer|clock|countdown)|how is (?:the )?(?:timer|countdown)|(?:time|timer) remaining)$/,
      "status",
      "Timer status heard",
    ],
  ];
  for (const [pattern, action, label] of controls) {
    if (pattern.test(text)) return intent("timer", { action }, label);
  }

  if (
    /^(?:start|begin|run)(?:\s+(?:a|the))?\s+(?:timer|time|countdown|stopwatch)(?:\s+for\s+(?:this|that|the current)\s+set)?$|^(?:start|begin|run)(?:\s+the)?\s+set\s+(?:timer|countdown)$/.test(
      text
    )
  ) {
    return intent(
      "timer",
      { action: "start", useSetDefault: true },
      "Start set timer heard"
    );
  }
  return null;
};

const TIMER_CONFIRMATION_AFFIRMATIVES = [
  "yes",
  "yes please",
  "yes do it",
  "yes start it",
  "yeah",
  "yeah please",
  "yeah do it",
  "yep",
  "yup",
  "sure",
  "sure thing",
  "absolutely",
  "definitely",
  "certainly",
  "of course",
  "for sure",
  "sounds good",
  "sounds great",
  "that works",
  "works for me",
  "im ready",
  "i am ready",
  "ready",
  "ready to go",
  "all ready",
  "lets go",
  "let us go",
  "lets do it",
  "let us do it",
  "lets start",
  "let us start",
  "go",
  "go ahead",
  "ahead",
  "do",
  "do it",
  "please do",
  "start",
  "start it",
  "start now",
  "start timer",
  "start the timer",
  "begin",
  "begin now",
  "begin timer",
  "begin the timer",
  "run it",
  "run timer",
  "run the timer",
  "fire it up",
  "fire up the timer",
  "kick it off",
  "get it going",
  "get started",
  "im good",
  "i am good",
  "good to go",
  "all good",
  "okay",
  "ok",
  "okay go",
  "ok go",
  "okay start it",
  "ok start it",
  "why not",
  "fine",
  "perfect",
  "correct",
  "affirmative",
  "you can",
  "you can start",
  "please",
] as const;

const TIMER_CONFIRMATION_NEGATIVES =
  /\b(?:no|nope|nah|not|dont|do not|stop|wait|hold|cancel|never|later|yet)\b/;

/**
 * A permissive reply parser used only while an explicit timer-start offer is
 * pending. Each affirmative may have up to two conversational words before
 * and after it, while negative wording always wins.
 */
export function isTimerStartConfirmationAffirmative(
  transcript: string | null | undefined,
): boolean {
  const raw = String(transcript ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const texts = [...new Set([normalizeCoachSpeech(transcript), raw])].filter(Boolean);
  if (
    !texts.length ||
    texts.some((text) =>
      TIMER_CONFIRMATION_NEGATIVES.test(text.replace(/\bwhy not\b/g, ""))
    )
  ) {
    return false;
  }
  return texts.some((text) => {
    const words = text.split(" ");
    return TIMER_CONFIRMATION_AFFIRMATIVES.some((phrase) => {
      const phraseWords = phrase.split(" ");
      if (words.length < phraseWords.length || words.length > phraseWords.length + 4) {
        return false;
      }
      for (let start = 0; start <= words.length - phraseWords.length; start += 1) {
        if (start > 2 || words.length - start - phraseWords.length > 2) continue;
        if (phraseWords.every((word, index) => words[start + index] === word)) return true;
      }
      return false;
    });
  });
}

export const parseDrillExplanationIntent: Parser = (text) => {
  if (
    /\bafter this\b/.test(text) ||
    (/\b(?:next|up next)\b/.test(text) &&
      !/\b(?:drill|exercise|movement)\b/.test(text))
  ) {
    return null;
  }
  const leadingPadding = "(?:[a-z0-9]+\\s+){0,3}";
  const trailingPadding = "(?:\\s+[a-z0-9]+){0,3}";
  const drill =
    "(?:(?:the\\s+)?(?:this|that|my|current)\\s+|the\\s+)?(?:drill|exercise|movement)";
  const drillObject = `(?:${drill}|(?:this|that)(?:\\s+one)?|it)`;
  const patterns = [
    `(?:explain|describe|teach)(?:\\s+me)?(?:\\s+how\\s+to\\s+do)?\\s+${drill}`,
    `(?:explain|describe|teach)(?:\\s+me)?\\s+${drillObject}`,
    `(?:explain|describe|teach)(?:\\s+me)?\\s+how\\s+to\\s+(?:do|perform|execute)\\s+${drillObject}`,
    `(?:explain|describe)(?:\\s+${drill})?(?:\\s+to\\s+me)`,
    `(?:walk|talk)(?:\\s+me)?\\s+through\\s+${drillObject}`,
    `(?:can\\s+you\\s+)?run\\s+through\\s+${drillObject}(?:\\s+for\\s+me)?`,
    `(?:show|tell)(?:\\s+me)?\\s+how\\s+(?:i\\s+|to\\s+)?(?:do|perform|execute)\\s+${drillObject}`,
    `(?:tell|show)(?:\\s+me)?\\s+what\\s+to\\s+do`,
    `what\\s+to\\s+do`,
    `(?:how\\s+do\\s+i|how\\s+should\\s+i|how\\s+am\\s+i\\s+supposed\\s+to)\\s+(?:do|perform|execute)\\s+${drillObject}`,
    `how\\s+do\\s+i\\s+(?:start|run)\\s+${drillObject}`,
    `how\\s+should\\s+i\\s+run\\s+${drillObject}`,
    `how\\s+do\\s+i\\s+go\\s+through\\s+${drillObject}`,
    `how\\s+do\\s+i\\s+set\\s+${drillObject}\\s+up`,
    `how\\s+am\\s+i\\s+supposed\\s+to\\s+start`,
    `how\\s+am\\s+i\\s+(?:doing|performing|running)\\s+${drillObject}`,
    `how\\s+should\\s+${drillObject}\\s+go`,
    `how\\s+(?:do|does)\\s+${drillObject}\\s+(?:work|go)`,
    `what\\s+(?:am\\s+i\\s+supposed\\s+to(?:\\s+be)?|am\\s+i\\s+meant\\s+to|should\\s+i|do\\s+i\\s+need\\s+to|do\\s+i)\\s+(?:do|doing)(?:\\s+(?:for|on|with)\\s+${drillObject})?`,
    `what(?:\\s+exactly)?\\s+am\\s+i\\s+doing(?:\\s+here|\\s+right\\s+now)?`,
    `what\\s+am\\s+i\\s+doing\\s+(?:for|on|with)\\s+${drillObject}(?:\\s+again)?`,
    `what\\s+should\\s+i\\s+be\\s+doing(?:\\s+(?:for|on|with)\\s+${drillObject})?`,
    `what\\s+(?:are\\s+we|am\\s+i)\\s+(?:doing|working\\s+on)(?:\\s+(?:for|on|with)\\s+${drillObject}|\\s+here)?`,
    `what\\s+am\\s+i\\s+supposed\\s+to\\s+work\\s+on`,
    `what\\s+am\\s+i\\s+working\\s+on(?:\\s+here|\\s+right\\s+now)?`,
    `(?:what\\s+(?:are|is)|whats)\\s+(?:the\\s+)?(?:instructions?|directions?|steps|setup)(?:\\s+(?:for|to|on)\\s+${drillObject})?`,
    `whats\\s+(?:the\\s+)?(?:right|proper|correct)\\s+way\\s+to\\s+(?:do|perform|run)\\s+${drillObject}`,
    `whats\\s+(?:the\\s+)?(?:move|play)\\s+here`,
    `whats\\s+${drillObject}\\s+about`,
    `whats\\s+${drill}\\s+supposed\\s+to\\s+look\\s+like`,
    `what\\s+should\\s+${drillObject}\\s+look\\s+like`,
    `what\\s+do\\s+i\\s+need\\s+to\\s+know(?:\\s+(?:for|on|with)\\s+${drillObject})?`,
    `whats\\s+(?:the\\s+)?(?:point|purpose|goal|idea)(?:\\s+(?:for|of|on|with)\\s+${drillObject})`,
    `whats\\s+(?:the\\s+)?(?:technique|form|process)(?:\\s+(?:for|of|on)\\s+${drillObject})?`,
    `what\\s+should\\s+i\\s+focus\\s+on(?:\\s+(?:for|on|with)\\s+${drillObject})?`,
    `what\\s+does\\s+${drillObject}\\s+mean`,
    `(?:give|read)(?:\\s+me)?\\s+(?:the\\s+)?(?:instructions|directions|steps)(?:\\s+(?:for|to|on)\\s+${drillObject})?`,
    `(?:can\\s+you\\s+)?go\\s+over\\s+${drillObject}`,
    `(?:explain|describe)(?:\\s+to\\s+me)?\\s+what\\s+i(?:m|\\s+am)\\s+doing(?:\\s+here|\\s+right\\s+now)?`,
    `(?:explain|describe)(?:\\s+to\\s+me)?\\s+what\\s+i(?:m|\\s+am)\\s+supposed\\s+to\\s+do`,
    `(?:remind|tell)(?:\\s+me)?\\s+what\\s+${drillObject}\\s+is`,
    `what\\s+do\\s+i\\s+do\\s+next\\s+(?:for|on|with)\\s+${drillObject}`,
    `(?:can\\s+you\\s+)?break\\s+down\\s+what\\s+i\\s+need\\s+to\\s+do`,
    `(?:remind|tell)(?:\\s+me)?\\s+(?:what|how)(?:\\s+i(?:m|\\s+am))?\\s+(?:to|supposed\\s+to|should)\\s+(?:do|perform|execute)(?:\\s+${drill})?`,
    `(?:i\\s+)?(?:dont|do\\s+not)\\s+(?:know|understand|remember)\\s+(?:what|how)\\s+to\\s+(?:do|perform|execute)(?:\\s+(?:for|on|with)\\s+${drillObject}|\\s+${drillObject})?`,
    `what(?:s|\\s+is)\\s+${drill}`,
    `what(?:s|\\s+is)\\s+(?:the\\s+)?goal(?:\\s+(?:for|of|on)\\s+${drillObject})`,
    `where\\s+do\\s+i\\s+start(?:\\s+(?:for|on|with)\\s+${drillObject})?`,
    `(?:can\\s+you\\s+)?break\\s+${drillObject}\\s+down`,
    `how\\s+to\\s+(?:do|perform|execute)\\s+${drillObject}`,
  ];
  const matched = patterns.some((pattern) =>
    new RegExp(`^${leadingPadding}(?:${pattern})${trailingPadding}$`).test(text)
  );
  return matched
    ? intent(
        "drill_explanation",
        { target: "current" },
        "Explain current drill heard",
        0.99,
      )
    : null;
};

function normalizedRequestedDrillName(value: string): string | null {
  const query = value
    .replace(/\b(?:now|today|please|for me|instead)\b.*$/, "")
    .replace(/^(?:the\s+)?(?:drill|exercise)\s+/, "")
    .replace(/\s+(?:drill|exercise)$/, "")
    .trim();
  return query.length >= 2 &&
      !/^(?:this|that|it|next|previous|current|a drill|an exercise|drill|exercise)$/.test(query)
    ? query
    : null;
}

const LOCAL_NAVIGATION_PADDING = new Set([
  "coach",
  "hey",
  "yo",
  "please",
  "okay",
  "ok",
  "just",
  "now",
  "there",
]);

function trimLocalNavigationPadding(text: string): string {
  const words = text.split(" ").filter(Boolean);
  for (let index = 0; index < 2 && LOCAL_NAVIGATION_PADDING.has(words[0]); index += 1) {
    words.shift();
  }
  for (
    let index = 0;
    index < 2 && LOCAL_NAVIGATION_PADDING.has(words.at(-1) ?? "");
    index += 1
  ) {
    words.pop();
  }
  return words.join(" ");
}

function localNavigationCategoryName(value: string): string | null {
  const query = normalizedRequestedDrillName(value);
  if (!query) return null;
  if (/^(?:shooting|shoot)$/.test(query)) return "shooting";
  if (/^(?:finishing|finish|layup|layups|rim finishes?)$/.test(query)) return "finishing";
  if (/^(?:ball handling|ballhandling|handles|dribbling|dribble)$/.test(query)) {
    return "ball handling";
  }
  if (/^(?:defense|defence|defensive)$/.test(query)) return "defense";
  if (/^(?:conditioning|fitness)$/.test(query)) return "conditioning";
  return null;
}

export const parseDrillRequestIntent: Parser = (text) => {
  const add = text.match(
    /^(?:add|include|insert|put\s+in)(?:\s+(?:a|an|the))?\s+(.+?)(?:\s+(?:drill|exercise))?$/,
  );
  const query = normalizedRequestedDrillName(add?.[1] ?? "");
  if (!query) return null;
  return intent(
    "drill_request",
    { query, action: "add" },
    `Add ${query} drill heard`,
    0.99,
  );
};

function navigationUnit(value: string | undefined): CoachSpeechUnit {
  return value === "set" ? "set" : "drill";
}

export const parseNavigationIntent: Parser = (text) => {
  text = trimLocalNavigationPadding(text);
  let match = text.match(
    /^(?:whats|what is) (?:the )?(next|current) (set|drill|exercise|thing)|^(?:what|which) (set|drill|exercise|thing) am i(?:\s+on)?(?:\s+\d+\s+(?:for|out of)\s+\d+)?$|^what comes after this$/
  );
  if (match) {
    // “What comes after this?” is a next-set question, not permission to
    // select another drill. Only explicit "next drill/exercise" wording uses
    // drill navigation.
    const unit = text === "what comes after this"
      ? "set"
      : navigationUnit(match[2] ?? match[3]);
    const target = match[1] === "next" || text === "what comes after this" ? "next" : "current";
    return intent(
      "navigation",
      { mode: "query", unit, target: { type: target } },
      target === "next" ? `What's next ${unit} heard` : `Current ${unit} heard`
    );
  }
  if (/^(?:whats|what is) next$/.test(text)) {
    return intent(
      "navigation",
      { mode: "query", unit: "set", target: { type: "next" } },
      "What's next heard"
    );
  }
  if (
    /^(?:bring|take|send)(?:\s+me)?\s+(?:to\s+)?(?:whats|what is)\s+(?:up\s+)?next(?:\s+(?:drill|exercise|thing))?$/.test(
      text,
    )
  ) {
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "next" } },
      "Move to next drill heard",
    );
  }
  if (/^(?:(?:let'?s\s+)?(?:move on|keep going|continue)|let'?s(?:\s+now)?\s+continue|let'?s go)$/.test(text)) {
    return intent(
      "navigation",
      {
        mode: "query",
        unit: "set",
        target: { type: "next" },
      },
      "What's next heard"
    );
  }
  if (/^(?:whats|what is|what do i have) (?:up )?next(?: for me)?$/.test(text)) {
    return intent(
      "navigation",
      { mode: "query", unit: "set", target: { type: "next" } },
      "What's next heard"
    );
  }
  match = text.match(
    /^(?:where (?:am i|are we|we at)|(?:whats|what is) (?:the )?current (set|drill|exercise|thing)|(?:what|which) (set|drill|exercise|thing) (?:am i|are we) (?:on|doing))$/
  );
  if (match) {
    const unit = navigationUnit(match[1] ?? match[2]);
    return intent(
      "navigation",
      { mode: "query", unit, target: { type: "current" } },
      `Current ${unit} heard`
    );
  }
  match = text.match(
    new RegExp(
      `^(?:move|go)(?:\\s+me)?\\s+to\\s+(?:the\\s+)?(${NUMBER}|[a-z0-9]+)(?:st|nd|rd|th)?\\s+(?:from the end|from last)$`
    )
  );
  if (match) {
    const offset = parseOrdinal(match[1]);
    if (offset == null || offset < 1 || offset > 100) return null;
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "from_end", offset } },
      `Go to ${offset} from end heard`
    );
  }
  match = text.match(
    /^(?:(?:can|could|would)\s+(?:we|you)\s+)?skip(?:\s+this|\s+the current)?\s+(set|drill|exercise|thing)$/
  );
  if (match) {
    const unit = navigationUnit(match[1]);
    return intent(
      "navigation",
      { mode: "action", unit, target: { type: "next" }, skip: true },
      `Skip current ${unit} heard`
    );
  }

  match = text.match(
    /^(?:(skip)(?:\s+this|\s+the current)?\s+|(?:(?:move|go)(?:\s+me)?\s+to\s+(?:the\s+)?)?)(next|previous|first|last)\s+(set|drill|exercise|thing)$/
  );
  if (match) {
    const unit = navigationUnit(match[3]);
    const target = match[2] as "next" | "previous" | "first" | "last";
    return intent(
      "navigation",
      { mode: "action", unit, target: { type: target }, skip: Boolean(match[1]) },
      `${match[1] ? "Skip current" : `Go to ${target}`} ${unit} heard`
    );
  }
  match = text.match(/^(?:go back|previous (?:set|drill|exercise|thing))$/);
  if (match) {
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "previous" } },
      "Previous drill heard"
    );
  }

  match = text.match(
    /^(?:move|go)(?:\s+me)?\s+to\s+(?:the\s+)?([a-z0-9]+)(?:\s+(?:set|drill|exercise|thing))$|^(?:move|go)(?:\s+me)?\s+to\s+(?:set|drill|exercise)\s+([a-z0-9]+)$/
  );
  if (match) {
    const ordinalText = match[1] ?? match[2];
    const ordinal = parseOrdinal(ordinalText);
    if (ordinal != null && ordinal >= 1 && ordinal <= 100) {
      const unit = /\bset\b/.test(text) ? "set" : "drill";
      return intent(
        "navigation",
        { mode: "action", unit, target: { type: "ordinal", ordinal } },
        `Go to ${unit} ${ordinal} heard`
      );
    }
  }

  match = text.match(
    /^(?:move|go)(?:\s+me)?\s+to\s+(?:the\s+)?(?:drill|exercise)\s+(?:named\s+)?(.+)$/
  );
  if (match) {
    const name = normalizedRequestedDrillName(match[1]);
    if (!name || /^(?:next|previous|first|last|current)$/.test(name)) return null;
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "named", name, match: "exact" } },
      `Go to ${name} heard`,
      0.98
    );
  }
  match = text.match(
    /^(?:move|go)(?:\s+me)?\s+(?:to|into|onto|on|over\s+to)\s+(?:the\s+)?(.+)$/,
  );
  if (match) {
    const name = normalizedRequestedDrillName(match[1]);
    if (!name || /^(?:next|previous|first|last|current)$/.test(name)) return null;
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "named", name, match: "exact" } },
      `Go to ${name} heard`,
      0.98,
    );
  }
  match = text.match(
    /^(?:move|go)(?:\s+me)?\s+to\s+(?:the\s+)?(.+)\s+(?:drill|exercise)$/
  );
  if (match) {
    const name = normalizedRequestedDrillName(match[1]);
    if (!name || /^(?:next|previous|first|last|current)$/.test(name)) return null;
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "named", name, match: "exact" } },
      `Go to ${name} heard`,
      0.98
    );
  }
  match = text.match(
    /^(?:take|bring|send|put)(?:\s+me)?\s+(?:to|into|onto|on|over\s+to)\s+(?:the\s+)?(?:(?:drill|exercise)\s+)?(.+)$/,
  );
  if (match) {
    const name = normalizedRequestedDrillName(match[1]);
    if (!name) return null;
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "named", name, match: "exact" } },
      `Go to ${name} heard`,
      0.98,
    );
  }
  return null;
};

export const parseCompletionIntent: Parser = (text) => {
  const numberedSet = text.match(
    new RegExp(
      `^(?:(?:complete|finish)\\s+set\\s+(${NUMBER})|mark\\s+set\\s+(${NUMBER})\\s+complete|(?:reopen|uncomplete)\\s+set\\s+(${NUMBER})|mark\\s+set\\s+(${NUMBER})\\s+incomplete)$`
    )
  );
  if (numberedSet) {
    const setNumber = parseSpokenNumber(
      numberedSet[1] ?? numberedSet[2] ?? numberedSet[3] ?? numberedSet[4]
    );
    if (setNumber == null || setNumber < 1) return null;
    const action: CompletionIntentArgs["action"] =
      numberedSet[3] || numberedSet[4] ? "reopen" : "complete";
    return intent(
      "completion",
      { action, scope: "set", setNumber },
      `${action === "complete" ? "Finish" : "Reopen"} set ${setNumber} heard`
    );
  }
  const reopen = text.match(
    /^(?:reopen|uncomplete|mark incomplete)(?:\s+this|\s+the current)?\s+(set|drill|exercise|workout)$/
  );
  if (reopen) {
    const scope: CoachSpeechScope =
      reopen[1] === "set" ? "set" : reopen[1] === "workout" ? "workout" : "exercise";
    return intent("completion", { action: "reopen", scope }, `Reopen current ${scope} heard`);
  }
  const marked = text.match(
    /^mark(?:\s+(?:this|that|the|current)|\s+the\s+current)?\s+(set|drill|exercise|workout)\s+(complete|incomplete)$/
  );
  if (marked) {
    const scope: CoachSpeechScope =
      marked[1] === "set" ? "set" : marked[1] === "workout" ? "workout" : "exercise";
    const action: CompletionIntentArgs["action"] =
      marked[2] === "complete" ? "complete" : "reopen";
    return intent(
      "completion",
      { action, scope },
      `${action === "complete" ? "Finish" : "Reopen"} current ${scope} heard`
    );
  }

  const complete = text.match(
    /^(?:(?:im|i am)\s+(?:finished|done)\s+with(?:\s+(?:this|that|the|current)|\s+the current)?|(?:mark|finish|complete)(?:\s+(?:this|that|the|current)|\s+the current)?)\s+(set|drill|exercise|workout)$/
  );
  if (complete) {
    const scope: CoachSpeechScope =
      complete[1] === "set" ? "set" : complete[1] === "workout" ? "workout" : "exercise";
    return intent("completion", { action: "complete", scope }, `Finish current ${scope} heard`);
  }
  return null;
};

export const parseProgressIntent: Parser = (text) => {
  if (
    /^(?:(?:whats|what is) my |show me my )?(?:total|overall|workout) shooting (?:percentage|percent)(?:\s+(?:for|in)\s+(?:this|my|the)\s+workout)?$/.test(
      text
    )
  ) {
    return intent(
      "progress",
      { metric: "percentage", scope: "workout" },
      "workout shooting percentage heard"
    );
  }
  if (
    /^(?:just\s+)?(?:(?:whats|what is|tell me|show me) (?:my|the) |my )?(?:current )?(?:shooting )?(?:percentage|percent)(?:\s+(?:so far|right now))?$|^(?:what am i|how am i) shooting(?:\s+(?:so far|right now))?$/.test(
      text
    )
  ) {
    return intent(
      "progress",
      { metric: "percentage", scope: "exercise" },
      "exercise shooting percentage heard"
    );
  }
  const remaining = text.match(
    /^(?:how many\s+)?(?:more\s+)?(shots?|makes?|sets?|drills?|exercises?|things?)(?:\s+do i have)?\s+(?:are\s+)?(?:left|remaining|to go)$|^how many\s+(shots?|makes?|sets?|drills?|exercises?|things?)\s+(?:do i have\s+)?left$/
  );
  if (remaining) {
    const noun = remaining[1] ?? remaining[2];
    const scope: CoachSpeechScope = /^sets?/.test(noun)
      ? "exercise"
      : /^(?:drills?|exercises?|things?)/.test(noun)
        ? "workout"
        : "set";
    return intent("progress", { metric: "remaining", scope }, `${scope} remaining heard`);
  }
  const scopedRemaining = text.match(
    /^(?:(?:whats|what is|show me) (?:left|remaining)|how much (?:is )?(?:left|remaining))(?:\s+(?:for|in|on))?\s+(?:this|the current|my)\s+(set|drill|exercise|workout)$/
  );
  if (scopedRemaining) {
    const scope: CoachSpeechScope =
      scopedRemaining[1] === "set"
        ? "set"
        : scopedRemaining[1] === "workout"
          ? "workout"
          : "exercise";
    return intent("progress", { metric: "remaining", scope }, `${scope} remaining heard`);
  }
  const target = text.match(
    /^(?:(?:whats|what is) (?:my|the) (?:target|goal)(?: and attempts?)?|what are (?:my|the) target(?: makes)? and attempts?|what are this sets (?:target )?attempts?|how many attempts (?:are|is) (?:in|for) this set|what (?:do i need|am i aiming for|am i trying to get)|how many (?:shots|makes) (?:do i need|is the target))(?:\s+for|\s+on|\s+in)?\s*(?:this|the current|my)?\s*(set|drill|exercise|workout)?$/
  );
  if (target) {
    const namedScope = target[1];
    const scope: CoachSpeechScope =
      namedScope === "workout" ? "workout" : /^(?:drill|exercise)$/.test(namedScope ?? "") ? "exercise" : "set";
    return intent("progress", { metric: "target", scope }, `${scope} target heard`);
  }
  const totals =
    text.match(
      /^how many\s+(makes?|misses?|attempts?|shots?)(?:\s+do i have|\s+have i (?:made|missed|taken))?(?:\s+for|\s+on|\s+in)?\s*(?:this|the current|my)?\s*(set|drill|exercise|workout)?$/
    ) ??
    text.match(
      /^(makes|misses|attempts|shots)(?:\s+do i have|\s+so far)(?:\s+for|\s+on|\s+in)?\s*(?:this|the current|my)?\s*(set|drill|exercise|workout)?$/
    );
  if (totals) {
    const noun = totals[1];
    const namedScope = totals[2];
    const scope: CoachSpeechScope =
      namedScope === "set" ? "set" : namedScope === "workout" ? "workout" : "exercise";
    const totalsField: ProgressIntentArgs["totalsField"] = /^makes?/.test(noun)
      ? "makes"
      : /^misses?/.test(noun)
        ? "misses"
        : "attempts";
    return intent(
      "progress",
      { metric: "totals", scope, totalsField },
      `${scope} shot totals heard`
    );
  }
  const percentage = text.match(
    /^(?:(?:whats|what is)(?: my| the)? |show me my )?(?:shooting )?(?:percentage|percent)(?:\s+for|\s+on|\s+in)?\s+(?:this|the current|my|the whole|whole|todays|the)?\s*(set|drill|exercise|workout)(?:\s+so far)?$/
  );
  if (percentage) {
    const scope: CoachSpeechScope =
      percentage[1] === "set" ? "set" : percentage[1] === "workout" ? "workout" : "exercise";
    return intent("progress", { metric: "percentage", scope }, `${scope} shooting percentage heard`);
  }
  const progress = text.match(
    /^(?:(?:whats|what is) my |show me my |how is my )progress(?:(?:\s+for|\s+on|\s+in)?\s+(?:this|the current|the|my)?\s*(set|drill|exercise|workout))?$|^how far (?:am i|are we) (?:through|into)(?:\s+(?:this|the|my))?\s+(set|drill|exercise|workout)$/
  );
  if (progress) {
    const namedScope = progress[1] ?? progress[2];
    const scope: CoachSpeechScope =
      namedScope === "set" ? "set" : namedScope === "workout" ? "workout" : "exercise";
    return intent("progress", { metric: "progress", scope }, `${scope} progress heard`);
  }
  return null;
};

export const parseRepeatIntent: Parser = (text) =>
  /^(?:repeat|repeat that|say that again|what did you say)$/.test(text)
    ? intent("repeat", {}, "Repeat heard")
    : null;

export const parseSpeechControlIntent: Parser = (text) =>
  /^(?:stop|stop talking|stop speaking|stop (?:talking|speaking) coach|be quiet|quiet(?: please)?|pause(?: coach)?|wait|hold on|cancel|never mind|shh|hush)$/.test(
    text
  )
    ? intent("speech_control", { action: "stop_speaking" }, "Stop coach speech heard", 0.99)
    : null;

export const parseListDrillsIntent: Parser = (text) =>
  /^(?:list|show)(?: me)?(?: the)?(?: workout)? (?:drills|exercises)$|^(?:what|which) (?:drills|exercises) (?:are|do i have) (?:in|for) (?:this|my|the) workout$/.test(
    text
  )
    ? intent("list_drills", {}, "List workout drills heard")
    : null;

export const parseRemoveDrillIntent: Parser = (text) => {
  const match = text.match(
    /^(?:remove|delete)\s+(?:the\s+)?(?:drill|exercise)(?:\s+named)?\s+(.+)$/
  );
  const name = match?.[1]?.trim();
  if (!name || name.length < 2 || /^(?:this|current|next|previous|first|last)$/.test(name)) {
    return null;
  }
  return intent(
    "remove_drill",
    { name, match: "exact" },
    `Remove ${name} heard`,
    0.98
  );
};

export function parseSetPrescriptionIntent(
  text: string,
  context: CoachSpeechParseContext = {},
): CoachSpeechIntent | null {
  const durationValue = `(${NUMBER}|a|an)`;
  const durationUnit = "(seconds?|secs?|minutes?|mins?)";
  const timerDurationPadding = "(?:[a-z0-9]+\\s+){0,3}";
  const timerDurationTrailingPadding = "(?:\\s+[a-z0-9]+){0,3}";
  // “Change it to three minutes instead of two” means three minutes. Remove
  // the old value before applying the bounded conversational-command grammar.
  const durationText = text.replace(
    new RegExp(
      `\\s+instead\\s+of\\s+(?:${NUMBER}|a|an)\\s*(?:seconds?|secs?|minutes?|mins?)(?:\\s+[a-z0-9]+){0,3}$`,
    ),
    "",
  ).trim();
  const naturalDuration =
    durationText.match(
      new RegExp(
        `^${timerDurationPadding}(?:i\\s+)?(?:only\\s+)?(?:want|wanna|would\\s+like|need|prefer)\\s+(?:to\\s+)?(?:(?:do|have|make|set|run)\\s+)?(?:(?:this|that|the\\s+current)\\s+)?(?:set\\s+)?(?:for\\s+)?${durationValue}\\s*${durationUnit}(?:\\s+for\\s+(?:this|that|the\\s+current)\\s+set)?${timerDurationTrailingPadding}$`,
      ),
    ) ??
    durationText.match(
      new RegExp(
        `^${timerDurationPadding}(?:change|make|set)\\s+(?:(?:this|that|the|my)\\s+)?(?:current\\s+)?set\\s+(?:timer|duration|time)\\s+(?:to(?:\\s+be)?|for)\\s+${durationValue}\\s*${durationUnit}${timerDurationTrailingPadding}$`,
      ),
    ) ??
    durationText.match(
      new RegExp(
        `^${timerDurationPadding}(?:(?:can|could|would)\\s+(?:we|i)\\s+)?(?:just\\s+)?(?:(?:let(?:s|\\s+s)|let\\s+us)\\s+)?(?:do|make|set|run)\\s+(?:(?:this|that|the\\s+current)\\s+)?(?:set\\s+)?(?:for\\s+)?${durationValue}\\s*${durationUnit}(?:\\s+for\\s+(?:this|that|the\\s+current)\\s+set)?${timerDurationTrailingPadding}$`,
      ),
    );
  if (naturalDuration) {
    const durationSeconds = parseDuration(naturalDuration[1], naturalDuration[2]);
    if (durationSeconds == null || durationSeconds < 5 || durationSeconds > 3600) {
      return null;
    }
    return intent(
      "set_prescription",
      { durationSeconds },
      `Change set duration to ${formatDurationLabel(durationSeconds)} heard`,
      0.99,
    );
  }
  const duration =
    text.match(
    new RegExp(
      `^(?:change|set|make)\\s+(?:(?:set\\s+(${NUMBER}))|(?:this|that|the current)\\s+set)(?:s)?(?:\\s+(?:duration|time))?\\s+(?:to|for)\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?)$`
    )
    ) ??
    text.match(
      new RegExp(
        `^(?:change|set)\\s+(?:the\\s+)?(?:duration|time)(?:\\s+(?:for|of))?\\s+(?:(?:set\\s+(${NUMBER}))|(?:this|that|the current)\\s+set)\\s+to\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?)$`
      )
    );
  if (duration) {
    const setNumber = duration[1] ? parseSpokenNumber(duration[1]) : null;
    const durationSeconds = parseDuration(duration[2], duration[3]);
    if (
      durationSeconds == null ||
      durationSeconds < 5 ||
      durationSeconds > 3600 ||
      (duration[1] && (setNumber == null || setNumber < 1))
    ) {
      return null;
    }
    return intent(
      "set_prescription",
      {
        setNumber: setNumber ?? undefined,
        durationSeconds,
      },
      `Change set duration to ${formatDurationLabel(durationSeconds)} heard`,
      0.99
    );
  }

  // Target changes must stay compact: tolerate brief STT conversational
  // padding without turning an ordinary long sentence into a workout edit.
  const padding = "(?:[a-z0-9]+\\s+){0,3}?";
  const trailingPadding = "(?:\\s+[a-z0-9]+){0,3}";
  const bounded = (pattern: string): RegExpMatchArray | null =>
    text.match(new RegExp(`^${padding}(?:${pattern})${trailingPadding}$`));
  const attemptNoun = "(?:attempts?|shots?)";
  const currentSet = "(?:(?:this|that|the current)\\s+set)";
  const targetReference = `(?:(?:the\\s+)?(?:target\\s+)?${attemptNoun}|${currentSet}(?:'?s)?(?:\\s+(?:target\\s+)?${attemptNoun})?)`;
  const targetVerb = "(?:set|change|update|adjust|make)";
  const targetNumber = (value: string | undefined): number | null => {
    const targetAttempts = value ? parseSpokenNumber(value) : null;
    return targetAttempts != null && targetAttempts >= 1 && targetAttempts <= 500
      ? targetAttempts
      : null;
  };

  const fromTo = bounded(
    `${targetVerb}\\s+${targetReference}\\s+from\\s+(${NUMBER})\\s+to\\s+(${NUMBER})`,
  );
  if (fromTo) {
    const targetAttempts = targetNumber(fromTo[2]);
    if (targetAttempts == null) return null;
    return intent("set_prescription", { targetAttempts }, `Change target attempts to ${targetAttempts} heard`, 0.99);
  }

  const namedAbsolute = bounded(
    `${targetVerb}\\s+${targetReference}\\s+(?:to|at|for)\\s+(${NUMBER})`,
  );
  if (namedAbsolute) {
    const targetAttempts = targetNumber(namedAbsolute[1]);
    if (targetAttempts == null) return null;
    return intent("set_prescription", { targetAttempts }, `Change target attempts to ${targetAttempts} heard`, 0.99);
  }

  const absolute = bounded(
    `(?:${targetVerb}\\s+${currentSet}\\s+(?:to\\s+)?|(?:i\\s+)?(?:want|need|would\\s+like|prefer)\\s+(?:to\\s+)?(?:shoot|take)\\s+|(?:can|could)\\s+(?:i|we)\\s+(?:shoot|take)\\s+|(?:i\\s+)?(?:shoot|take)\\s+)(${NUMBER})\\s+(?:total\\s+)?${attemptNoun}(?!\\s+more\\b)(?:\\s+(?:total|right\\s+now))?(?:\\s+(?:for|on|in)\\s+${currentSet})?(?:\\s+instead\\s+of\\s+${NUMBER})?`,
  );
  if (absolute) {
    const targetAttempts = targetNumber(absolute[1]);
    if (targetAttempts == null) return null;
    return intent("set_prescription", { targetAttempts }, `Change target attempts to ${targetAttempts} heard`, 0.99);
  }

  const insteadOf = bounded(
    `(?:${targetVerb}\\s+)?(${NUMBER})\\s+${attemptNoun}\\s+instead\\s+of\\s+${NUMBER}(?:\\s+(?:for|on|in)\\s+${currentSet})?`,
  );
  if (insteadOf) {
    const targetAttempts = targetNumber(insteadOf[1]);
    if (targetAttempts == null) return null;
    return intent("set_prescription", { targetAttempts }, `Change target attempts to ${targetAttempts} heard`, 0.99);
  }

  const relative = bounded(
    `(?:${targetVerb}\\s+)?(increase|raise|add|extend|decrease|lower|reduce|shorten)\\s+(?:the\\s+)?(?:target\\s+)?${attemptNoun}(?:\\s+(?:for|on|in)\\s+${currentSet})?\\s+(?:by\\s+)?(${NUMBER})`,
  );
  if (relative) {
    const amount = targetNumber(relative[2]);
    if (amount == null) return null;
    const attemptAdjustment = /^(?:increase|raise|add|extend)$/.test(relative[1])
      ? amount
      : -amount;
    return intent(
      "set_prescription",
      { attemptAdjustment },
      `${attemptAdjustment > 0 ? "Increase" : "Decrease"} target attempts by ${amount} heard`,
      0.99,
    );
  }

  // "I made two more" is a shot result, not a target extension. Do not let
  // bounded conversational padding consume the shot verb before this parser.
  const wantsRemaining = new RegExp(
    `\\b(?:only|just)\\s+(?:want\\s+)?(?:to\\s+)?(?:(?:shoot|take|do)\\s+)?${NUMBER}\\s+more\\b`,
  ).test(text);
  const more = new RegExp(
    `\\b(?:made|make|hit|miss(?:ed)?|brick(?:ed)?|airball(?:ed)?)\\s+${NUMBER}\\s+more\\b`,
  ).test(text)
    ? null
    : bounded(
        `(?:(?:i\\s+)?(?:want|need|would\\s+like)\\s+(?:to\\s+)?(?:shoot|take)\\s+|(?:can|could)\\s+(?:i|we)\\s+(?:shoot|take)\\s+|(?:i\\s+)?(?:shoot|take)\\s+)?(${NUMBER})\\s+(?:more(?:\\s+${attemptNoun})?|${attemptNoun}\\s+more)(?:\\s+(?:for|on|in)\\s+${currentSet})?`,
      );
  if (more) {
    const additional = targetNumber(more[1]);
    if (additional == null) return null;
    return intent(
      "set_prescription",
      wantsRemaining
        ? { targetAttempts: additional, remainingAttempts: true }
        : { targetAttempts: additional, additionalAttempts: true },
      wantsRemaining
        ? `Set remaining attempts to ${additional} heard`
        : `Extend target attempts by ${additional} heard`,
      0.99,
    );
  }

  if (context.activeShootingSet) {
    const reverseReplacement = bounded(
      `(?:(?:instead\\s+of|rather\\s+than|not|forget)\\s+${NUMBER}(?:\\s+${attemptNoun})?(?:\\s*,?\\s*(?:do|make\\s+it|lets\\s+do|i\\s+want(?:\\s+to\\s+shoot)?)\\s+)|dont\\s+do\\s+${NUMBER}(?:\\s+${attemptNoun})?\\s*,?\\s*(?:do|make\\s+it)\\s+)(${NUMBER})(?:\\s+${attemptNoun})?`,
    );
    if (reverseReplacement) {
      const targetAttempts = targetNumber(reverseReplacement[1]);
      if (targetAttempts == null) return null;
      return intent("set_prescription", { targetAttempts }, `Change target attempts to ${targetAttempts} heard`, 0.99);
    }

    const decreaseByAmount = bounded(
      `(?:(?:do|make\\s+it|lets\\s+do|i\\s+(?:want\\s+)?(?:to\\s+)?do)\\s+)?(${NUMBER})\\s+(?:less|fewer)(?:\\s+${attemptNoun})?`,
    );
    if (decreaseByAmount) {
      const decrease = targetNumber(decreaseByAmount[1]);
      if (decrease == null) return null;
      return intent(
        "set_prescription",
        { attemptAdjustment: -decrease },
        `Decrease target attempts by ${decrease} heard`,
        0.99,
      );
    }

    const relativeShort = bounded(
      `(?:(?:add|give\\s+me|extend|increase|bump\\s+(?:it\\s+)?up\\s+by|make\\s+it)\\s+(?:another\\s+)?(${NUMBER})(?:\\s+(?:more\\s+)?${attemptNoun})?|(?:take\\s+off|take\\s+(${NUMBER})\\s+off|remove|drop\\s+(?:it\\s+)?by|lower\\s+(?:it\\s+)?by|bring\\s+(?:it\\s+)?down\\s+by|cut\\s+(?:it\\s+)?by|knock\\s+(${NUMBER})\\s+off)\\s*(${NUMBER})?(?:\\s+(?:less|fewer|${attemptNoun}))?)`,
    );
    if (relativeShort) {
      const increase = targetNumber(relativeShort[1]);
      const decrease = targetNumber(
        relativeShort[2] ?? relativeShort[3] ?? relativeShort[4],
      );
      if (increase != null) {
        return intent(
          "set_prescription",
          { targetAttempts: increase, additionalAttempts: true },
          `Extend target attempts by ${increase} heard`,
          0.99,
        );
      }
      if (decrease != null) {
        return intent(
          "set_prescription",
          { attemptAdjustment: -decrease },
          `Decrease target attempts by ${decrease} heard`,
          0.99,
        );
      }
    }

    // These short conversational forms are intentionally active-set-only: out
    // of workout context, "fifteen is good" is far too ambiguous to edit.
    const replacement = bounded(
      `(?:(?:i\\s+)?(?:want|wanna|need|prefer|will|am\\s+gonna|am\\s+going\\s+to)|ill|let\\s+me|lets|can\\s+(?:i|we|you)|could\\s+(?:i|we|you)|would\\s+(?:i|we)|how\\s+about|what\\s+about|do|make|set|change|switch|put|give\\s+me|just|only|maybe|actually|nah|no|wait|sorry|i\\s+(?:meant|said)|never\\s+mind|make\\s+that|change\\s+that|i\\s+(?:would\\s+)?rather)\\s+(?:(?:to\\s+)?(?:shoot|take|do)\\s+)?(?:(?:it|this|that|this\\s+(?:set|one)|the\\s+(?:target|attempts?|shots?))\\s+)?(?:to\\s+|at\\s+)?(${NUMBER})(?:\\s+(?:total\\s+)?${attemptNoun})?(?:\\s+(?:for|on|in)\\s+${currentSet})?(?:\\s+(?:is|should\\s+be)\\s+(?:good|fine|okay|ok|work(?:s)?))?(?:\\s+instead(?:\\s+of\\s+${NUMBER})?)?`,
    );
    if (replacement) {
      const targetAttempts = targetNumber(replacement[1]);
      if (targetAttempts == null) return null;
      return intent("set_prescription", { targetAttempts }, `Change target attempts to ${targetAttempts} heard`, 0.99);
    }

    const remaining = bounded(
      `(?:(?:i\\s+)?(?:only\\s+)?(?:want|need)\\s+(?:to\\s+)?(?:shoot|take|do)\\s+|(?:let\\s+me|just)\\s+(?:shoot|take|do)?\\s*|(?:shoot|take|do)\\s+)?(${NUMBER})\\s+(?:more(?:\\s+${attemptNoun})?|another\\s+${NUMBER})`,
    );
    if (remaining) {
      const remainingAttempts = targetNumber(remaining[1]);
      if (remainingAttempts == null) return null;
      return intent(
        "set_prescription",
        { targetAttempts: remainingAttempts, remainingAttempts: true },
        `Set remaining attempts to ${remainingAttempts} heard`,
        0.99,
      );
    }

    const numberFirst = bounded(
      `(${NUMBER})(?:\\s+(?:total\\s+)?${attemptNoun}(?:\\s+total)?(?:\\s+(?:for|on|in)\\s+${currentSet})?|\\s+(?:for|on|in)\\s+(?:this\\s+)?(?:set|one)|\\s+instead|\\s+(?:is\\s+)?(?:good|fine|okay|ok|works?|should\\s+be\\s+good))`,
    );
    if (numberFirst) {
      const targetAttempts = targetNumber(numberFirst[1]);
      if (targetAttempts == null) return null;
      return intent("set_prescription", { targetAttempts }, `Change target attempts to ${targetAttempts} heard`, 0.99);
    }
  }

  const singleTarget = text.match(
    new RegExp(
      `^(?:set|change)\\s+(?:(?:set\\s+(${NUMBER})\\s+)|(?:this|the current)\\s+set(?:s)?\\s+|my\\s+)?(target\\s+attempts?|attempts?)\\s+to\\s+(${NUMBER})$`
    )
  );
  if (!singleTarget) return null;
  const setNumber = singleTarget[1] ? parseSpokenNumber(singleTarget[1]) : null;
  const value = parseSpokenNumber(singleTarget[3]);
  if (
    value == null ||
    value > 500 ||
    value < 1 ||
    (singleTarget[1] && (setNumber == null || setNumber < 1))
  ) {
    return null;
  }
  return intent(
    "set_prescription",
    {
      setNumber: setNumber ?? undefined,
      targetAttempts: value,
    },
    `Change target attempts to ${value} heard`,
    0.99
  );
}

export const parseUndoShotIntent: Parser = (text) => {
  const padding = "(?:[a-z0-9]+\\s+){0,2}";
  const trailingPadding = "(?:\\s+[a-z0-9]+){0,2}";
  if (
    !new RegExp(
      `^${padding}(?:(?:undo|revert)(?:\\s+(?:that|it|the|my|last|latest|previous|one|shot|make|miss|result))*|take(?:\\s+back(?:\\s+(?:that|it|the|my|last|latest|previous|one|shot|result))*|\\s+(?:(?:that|it|the|my|last|latest|previous|one|shot|result)\\s+)*back)|scratch(?:\\s+(?:that|it|the|my|last|latest|previous|one|shot|result))*|redo(?:\\s+(?:that|it|the|my|last|latest|previous|one|shot|result))*)${trailingPadding}$`,
    ).test(
      text,
    )
  ) {
    return null;
  }
  return intent(
    "correct_last_shot",
    { action: "flip" },
    "Flip last shot heard",
    0.99,
  );
};

export const parseShotCorrectionIntent: Parser = (text) => {
  // Corrections are deliberately bounded to four unrelated words on either
  // side. This tolerates conversational STT padding without treating a long,
  // ordinary sentence as a score edit.
  const padding = "(?:[a-z0-9]+\\s+){0,4}";
  const trailingPadding = "(?:\\s+[a-z0-9]+){0,4}";
  const parseBounded = (pattern: string): RegExpMatchArray | null =>
    text.match(new RegExp(`^${padding}(?:${pattern})${trailingPadding}$`));
  const correction = parseBounded(
    "(?:you\\s+)?(?:counted|marked|logged)\\s+(?:a\\s+)?(make|miss)(?:\\s+as|\\s+instead\\s+of)\\s+(?:a\\s+)?(make|miss)",
  );
  if (correction && correction[1] !== correction[2]) {
    return intent(
      "correct_last_shot",
      { from: correction[1] as "make" | "miss", to: correction[2] as "make" | "miss" },
      `Correct ${correction[1]} to ${correction[2]} heard`,
      0.99,
    );
  }
  const statedResult = parseBounded(
    "(?:the\\s+)?(?:last|latest|previous)(?:\\s+(?:shot|one|result))?\\s+(?:was|is|should\\s+(?:be|have\\s+been))\\s+(?:a\\s+)?(make|made|hit|swish|bucket|miss|missed|brick|bricked|airball|airballed)",
  );
  if (statedResult) {
    const to = /^(?:make|made|hit|swish|bucket)$/.test(statedResult[1]) ? "make" : "miss";
    const from = to === "make" ? "miss" : "make";
    return intent(
      "correct_last_shot",
      { from, to },
      `Correct last ${from} to ${to} heard`,
      0.99,
    );
  }
  const disputedResult = text.match(
    /\b(?:youre|your|you are)\s+wrong\b(?:\s+[a-z0-9]+){0,4}?\s+(?:i\s+)?(?:actually\s+)?(made|missed|hit|bricked|airballed)\b/,
  );
  if (disputedResult) {
    const to = /^(?:made|hit)$/.test(disputedResult[1]) ? "make" : "miss";
    const from = to === "make" ? "miss" : "make";
    return intent(
      "correct_last_shot",
      { from, to },
      `Correct disputed ${from} to ${to} heard`,
      0.99,
    );
  }
  const lastShot = parseBounded(
    "(?:i\\s+)?(?:actually\\s+)?(made|missed|hit|bricked|airballed)(?:\\s+(?:that|the))?\\s+(?:last|latest|previous)(?:\\s+(?:one|shot|result))?",
  );
  if (!lastShot) return null;
  const to = /^(?:made|hit)$/.test(lastShot[1]) ? "make" : "miss";
  const from = to === "make" ? "miss" : "make";
  return intent(
    "correct_last_shot",
    { from, to },
    `Correct last ${from} to ${to} heard`,
    0.99,
  );
};

export const parseGenericShotCorrectionIntent: Parser = (text) => {
  // Let the more specific disputed-result parser own phrases such as
  // "you're wrong, I missed that one"; otherwise two parsers match and the
  // intentionally unambiguous parser dispatcher rejects the command.
  if (
    /\b(?:youre|your|you are)\s+wrong\b.*\b(?:made|missed|hit|bricked|airballed)\b/.test(
      text,
    )
  ) {
    return null;
  }
  const padding = "(?:[a-z0-9]+\\s+){0,2}";
  const trailingPadding = "(?:\\s+[a-z0-9]+){0,2}";
  const generic = [
    "(?:youre|your|you\\s+are)\\s+(?:wrong|off)(?:\\s+on\\s+(?:that|it|that\\s+one))?",
    "(?:that|thats|it|that\\s+call|the\\s+last\\s+(?:one|shot)|that\\s+last\\s+one|the\\s+result|that\\s+result|the\\s+count|my\\s+count|your\\s+count|the\\s+shot\\s+count|my\\s+stats|the\\s+stats)(?:\\s+(?:was|is|isnt|wasnt))?\\s+(?:wrong|off|incorrect|not\\s+right|not\\s+correct|a\\s+(?:mistake|bad\\s+call|error))",
    "(?:you\\s+)?got\\s+(?:that|it|that\\s+one|the\\s+last\\s+shot|my\\s+stats|the\\s+result)?\\s*(?:wrong|backwards)",
    "(?:you\\s+)?(?:called|marked|recorded|counted|logged|entered|read|saw)\\s+(?:that|it|that\\s+one|the\\s+last\\s+shot|the\\s+result|my\\s+stats)?\\s*(?:wrong|incorrectly)",
    "(?:you\\s+)?put\\s+(?:(?:that|it)\\s+(?:in\\s+)?wrong|the\\s+wrong\\s+thing)",
    "(?:you\\s+)?(?:made\\s+(?:an?\\s+)?(?:mistake|error)|messed(?:\\s+(?:that|it|that\\s+one))?\\s+up|screwed(?:\\s+(?:that|it|that\\s+one))?\\s+up|mixed(?:\\s+(?:that|it|that\\s+one))?\\s+up|flipped\\s+(?:that|it|that\\s+one)|switched\\s+(?:that|it|those\\s+up)|confused\\s+(?:that|it)|miscounted(?:\\s+(?:that|it))?|misread(?:\\s+(?:that|it|the\\s+shot))?)",
    "(?:you\\s+)?(?:have|got)\\s+(?:that|it)\\s+backwards",
    "(?:you\\s+)?(?:didnt\\s+(?:get|mark|count)\\s+(?:that|it)\\s+right|need\\s+to\\s+(?:fix|change|correct)\\s+(?:that|it|the\\s+last\\s+one)|gotta\\s+(?:fix|change|correct)\\s+(?:that|it|the\\s+last\\s+one))",
    "(?:that|it)\\s+(?:isnt|aint|wasnt)\\s+(?:right|correct)",
    "(?:wrong|incorrect|not\\s+right|bad\\s+call|wrong\\s+call|correction(?:\\s+on\\s+(?:that|it|the\\s+last\\s+one))?)",
    "(?:fix|correct|change|switch|flip|reverse|check|recheck)\\s+(?:your\\s+call|that|that\\s+one|the\\s+last\\s+one|the\\s+last\\s+shot|the\\s+result)(?:\\s+again)?",
    "(?:look\\s+(?:again|at\\s+that\\s+again)|i\\s+(?:need|want)\\s+to\\s+correct\\s+(?:that|it)|let\\s+me\\s+correct\\s+(?:that|it)|(?:that|it)\\s+needs\\s+(?:a\\s+)?(?:correction|to\\s+be\\s+(?:fixed|corrected))|you\\s+missed\\s+(?:one|that\\s+one)|you\\s+got\\s+one\\s+wrong)",
    "(?:correction|my\\s+mistake|i\\s+was\\s+wrong)",
  ].some((pattern) => new RegExp(`^${padding}(?:${pattern})${trailingPadding}$`).test(text));
  return generic
    ? intent("correct_last_shot", { action: "flip" }, "Flip last shot heard", 0.99)
    : null;
};

const PARSERS: readonly Parser[] = [
  parseSpeechControlIntent,
  parseUndoShotIntent,
  parseShotCorrectionIntent,
  parseGenericShotCorrectionIntent,
  parseMissTotalCorrectionIntent,
  parseShotIntent,
  parseDrillExplanationIntent,
  parseTimerIntent,
  parseNavigationIntent,
  parseCompletionIntent,
  parseProgressIntent,
  parseListDrillsIntent,
  parseRepeatIntent,
  parseSetPrescriptionIntent,
];

export function parseCoachSpeechIntent(
  transcript: string | null | undefined,
  context: CoachSpeechParseContext = {},
): CoachSpeechIntent | null {
  const text = normalizeCoachSpeech(transcript);
  if (!text) return null;
  // An explicit score ratio always describes current session progress, never
  // a set target. Preserve even an impossible ratio so the local execution
  // path can explain the validation error instead of routing its denominator
  // into a target-changing command or model tool.
  const scoreRatio = parseShotIntent(text);
  if (scoreRatio?.kind === "shot" && scoreRatio.args.mode === "replace") {
    return scoreRatio;
  }
  // A request to shoot a different number of shots is a workout edit, even
  // though its wording can resemble a general shooting question.
  const setPrescription = parseSetPrescriptionIntent(text, context);
  if (setPrescription) return setPrescription;
  const matches = PARSERS.map((parser) => parser(text)).filter(
    (result): result is CoachSpeechIntent => result != null
  );
  return matches.length === 1 ? matches[0] : null;
}
