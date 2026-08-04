export type CoachSpeechScope = "set" | "exercise" | "workout";
export type CoachSpeechUnit = "set" | "drill";

export interface ShotIntentArgs {
  mode: "increment" | "replace";
  makes: number;
  attempts: number;
  source: "count" | "ratio";
}

export interface TimerIntentArgs {
  action: "start" | "pause" | "resume" | "stop" | "reset" | "restart" | "status";
  durationSeconds?: number;
  useSetDefault?: boolean;
}

export interface TimerDurationConfirmationArgs {
  accepted: boolean;
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
}

export interface CompletionIntentArgs {
  action: "complete" | "reopen";
  scope: CoachSpeechScope;
}

export interface ProgressIntentArgs {
  metric: "progress" | "percentage" | "remaining" | "target" | "totals";
  scope: CoachSpeechScope;
}

export interface SaveNoteIntentArgs {
  note: string;
}

export interface RemoveDrillIntentArgs {
  name: string;
  match: "exact";
}

export interface AdjustWorkoutIntentArgs {
  action: "extend" | "shorten";
  durationSeconds: number;
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
  | IntentBase<"timer", TimerIntentArgs>
  | IntentBase<"timer_duration_confirmation", TimerDurationConfirmationArgs>
  | IntentBase<"navigation", NavigationIntentArgs>
  | IntentBase<"completion", CompletionIntentArgs>
  | IntentBase<"progress", ProgressIntentArgs>
  | IntentBase<"list_drills", Record<string, never>>
  | IntentBase<"repeat", Record<string, never>>
  | IntentBase<"save_note", SaveNoteIntentArgs>
  | IntentBase<"remove_drill", RemoveDrillIntentArgs>
  | IntentBase<"adjust_workout", AdjustWorkoutIntentArgs>;

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
  return makes != null && attempts != null && attempts > 0 && attempts <= 100 && makes <= attempts;
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
  const ratio = text.match(
    new RegExp(
      `^(?:(im|i am|currently)\\s+|i\\s+)?(?:(just\\s+)?(?:made|hit)\\s+)?(${NUMBER})\\s*(?:/|for|out of|of)\\s*(${NUMBER})(?:\\s+shots?)?$`
    )
  );
  if (ratio) {
    const makes = parseSpokenNumber(ratio[3]);
    const attempts = parseSpokenNumber(ratio[4]);
    if (!validShotValues(makes, attempts)) return null;
    const mode: ShotIntentArgs["mode"] = /^(?:i\s+)?(?:just\s+)?(?:made|hit)\b/.test(text)
      ? "increment"
      : "replace";
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
    /^(?:(?:i\s+)?(?:just\s+)?)?(?:make|made|hit(?: it)?|swish(?:ed)?|bucket|another make)(?:\s+(?:one|another)(?:\s+shot)?|\s+again)?$/.test(
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

function parseDuration(value: string, unit: string): number | null {
  const amount = parseSpokenNumber(value);
  if (amount == null || amount <= 0) return null;
  const multiplier = /^hours?/.test(unit) ? 3600 : /^minutes?/.test(unit) ? 60 : 1;
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
      `^(?:start|begin|run|set)(?:\\s+(?:a|the))?\\s+(?:timer|time|countdown|stopwatch)(?:\\s+for)?\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)$`
    ),
    new RegExp(
      `^(?:start|begin|run|set)(?:\\s+me)?(?:\\s+a)?\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\s+(?:timer|time|countdown|stopwatch)$`
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
      /^(?:resume|continue|unpause)(?:\s+the)?\s+(?:timer|countdown|stopwatch)$/,
      "resume",
      "Resume timer heard",
    ],
    [
      /^(?:stop|end|cancel|clear)(?:\s+the)?\s+(?:timer|countdown|stopwatch)$/,
      "stop",
      "Stop timer heard",
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
      /^(?:timer status|(?:whats|what is|how much|how long) (?:(?:time|it)\s+is|time|is)?\s*(?:left|remaining)(?:\s+on(?:\s+the)?\s+(?:timer|countdown))?|how is (?:the )?(?:timer|countdown)|(?:time|timer) remaining)$/,
      "status",
      "Timer status heard",
    ],
  ];
  for (const [pattern, action, label] of controls) {
    if (pattern.test(text)) return intent("timer", { action }, label);
  }

  if (
    /^(?:start|begin|run)(?:\s+(?:a|the))?\s+(?:timer|time|countdown|stopwatch)(?:\s+for\s+(?:this|the current)\s+set)?$|^(?:start|begin|run)(?:\s+the)?\s+set\s+(?:timer|countdown)$/.test(
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

function navigationUnit(value: string | undefined): CoachSpeechUnit {
  return value === "set" ? "set" : "drill";
}

export const parseNavigationIntent: Parser = (text) => {
  let match = text.match(
    /^(?:whats|what is) (?:the )?(next|current) (set|drill|exercise|thing)|^(?:what|which) (set|drill|exercise|thing) am i on$|^what comes after this$/
  );
  if (match) {
    const unit = navigationUnit(match[2] ?? match[3]);
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
  if (/^(?:whats|what is|what do i have) (?:up )?next(?: for me)?$/.test(text)) {
    return intent(
      "navigation",
      { mode: "query", unit: "set", target: { type: "next" } },
      "What's next heard"
    );
  }
  match = text.match(
    /^(?:where am i|(?:whats|what is) (?:the )?current (set|drill|exercise|thing)|(?:what|which) (set|drill|exercise|thing) (?:am i|are we) (?:on|doing))$/
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
    if (ordinal == null || ordinal < 1 || ordinal > 100) return null;
    const unit = /\bset\b/.test(text) ? "set" : "drill";
    return intent(
      "navigation",
      { mode: "action", unit, target: { type: "ordinal", ordinal } },
      `Go to ${unit} ${ordinal} heard`
    );
  }

  match = text.match(
    /^(?:move|go)(?:\s+me)?\s+to\s+(?:the\s+)?(?:drill|exercise)\s+(?:named\s+)?(.+)$/
  );
  if (match) {
    const name = match[1].trim();
    if (name.length < 2 || /^(?:next|previous|first|last|current)$/.test(name)) return null;
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "named", name, match: "exact" } },
      `Go to ${name} heard`,
      0.98
    );
  }
  match = text.match(
    /^(?:move|go)(?:\s+me)?\s+to\s+(?:the\s+)?(.+)\s+(?:drill|exercise)$/
  );
  if (match) {
    const name = match[1].trim();
    if (name.length < 2 || /^(?:next|previous|first|last|current)$/.test(name)) return null;
    return intent(
      "navigation",
      { mode: "action", unit: "drill", target: { type: "named", name, match: "exact" } },
      `Go to ${name} heard`,
      0.98
    );
  }
  return null;
};

export const parseCompletionIntent: Parser = (text) => {
  const reopen = text.match(
    /^(?:reopen|uncomplete|mark incomplete)(?:\s+this|\s+the current)?\s+(set|drill|exercise|workout)$/
  );
  if (reopen) {
    const scope: CoachSpeechScope =
      reopen[1] === "set" ? "set" : reopen[1] === "workout" ? "workout" : "exercise";
    return intent("completion", { action: "reopen", scope }, `Reopen current ${scope} heard`);
  }
  const marked = text.match(
    /^mark(?:\s+this|\s+(?:the\s+)?current)?\s+(set|drill|exercise|workout)\s+(complete|incomplete)$/
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
    /^(?:(?:im|i am)\s+(?:finished|done)\s+with(?:\s+this|\s+the current)?|(?:mark|finish|complete)(?:\s+this|\s+the current)?)\s+(set|drill|exercise|workout)$/
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
    const namedScope = totals[2];
    const scope: CoachSpeechScope =
      namedScope === "set" ? "set" : namedScope === "workout" ? "workout" : "exercise";
    return intent("progress", { metric: "totals", scope }, `${scope} shot totals heard`);
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

export const parseListDrillsIntent: Parser = (text) =>
  /^(?:list|show)(?: me)?(?: the)?(?: workout)? (?:drills|exercises)$|^(?:what|which) (?:drills|exercises) (?:are|do i have) (?:in|for) (?:this|my|the) workout$/.test(
    text
  )
    ? intent("list_drills", {}, "List workout drills heard")
    : null;

export const parseSaveNoteIntent: Parser = (text) => {
  const match = text.match(
    /^save (?:a )?note(?:\s+that)?(?:\s*:\s*|\s+)(.+)$|^note\s*:\s*(.+)$/
  );
  const note = (match?.[1] ?? match?.[2])?.trim();
  if (!note || note.length < 2 || note.length > 500) return null;
  return intent("save_note", { note }, "Save note heard", 0.99);
};

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

export const parseAdjustWorkoutIntent: Parser = (text) => {
  const match = text.match(
    new RegExp(
      `^(extend|lengthen|add|shorten|reduce|cut)\\s+(?:the\\s+|this\\s+|my\\s+)?workout(?:\\s+by|\\s+for)?\\s+(${NUMBER})\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)$`
    )
  );
  if (!match) return null;
  const durationSeconds = parseDuration(match[2], match[3]);
  if (durationSeconds == null) return null;
  const action: AdjustWorkoutIntentArgs["action"] = /^(?:extend|lengthen|add)$/.test(match[1])
    ? "extend"
    : "shorten";
  return intent(
    "adjust_workout",
    { action, durationSeconds },
    `${action === "extend" ? "Extend" : "Shorten"} workout ${formatDurationLabel(
      durationSeconds
    )} heard`
  );
};

export const parseUndoShotIntent: Parser = (text) => {
  if (
    !/^(?:(?:please\s+)?(?:undo|revert|take back|remove|delete)(?:\s+(?:that|it|the|my))?(?:\s+(?:last|latest|previous))?(?:\s+(?:shot|make|miss|result))?|scratch that)$/.test(
      text
    )
  ) {
    return null;
  }
  return intent("undo_shot", {}, "Undo last shot heard", 0.99);
};

const PARSERS: readonly Parser[] = [
  parseSaveNoteIntent,
  parseUndoShotIntent,
  parseShotIntent,
  parseTimerIntent,
  parseNavigationIntent,
  parseCompletionIntent,
  parseProgressIntent,
  parseListDrillsIntent,
  parseRepeatIntent,
  parseRemoveDrillIntent,
  parseAdjustWorkoutIntent,
];

export function parseCoachSpeechIntent(
  transcript: string | null | undefined
): CoachSpeechIntent | null {
  const text = normalizeCoachSpeech(transcript);
  if (!text) return null;
  const matches = PARSERS.map((parser) => parser(text)).filter(
    (result): result is CoachSpeechIntent => result != null
  );
  return matches.length === 1 ? matches[0] : null;
}
