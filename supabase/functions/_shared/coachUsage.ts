// Coach usage limits and cost estimation for OpenAI Realtime sessions.

export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1-mini";

export const COACH_LIMITS = {
  /** One coach-credit pool across every workout in the user's local day. */
  maxDailyCostUsd: 0.75,
} as const;

export const COACH_DAILY_BUDGET_USD = COACH_LIMITS.maxDailyCostUsd;

export const CARTESIA_RATES = {
  /** Public direct-API billing units; override the USD conversion for the account plan. */
  ink2CreditsPerAudioSecond: 3,
  sonic35CreditsPerCharacter: 1,
  usdPerMillionCredits: 50,
} as const;

export const RESPONSES_RATES = {
  "gpt-5.6-luna": { input: 1 / 1_000_000, output: 6 / 1_000_000 },
  "gpt-5.6-terra": { input: 2.5 / 1_000_000, output: 15 / 1_000_000 },
} as const;

export const ANTHROPIC_RATES = {
  "claude-haiku-4-5-20251001": {
    input: 1 / 1_000_000,
    output: 5 / 1_000_000,
    cacheWrite: 1.25 / 1_000_000,
    cacheRead: 0.1 / 1_000_000,
  },
} as const;

export function estimateCartesiaCostUsd(input: {
  sttAudioSeconds?: number;
  ttsCharacters?: number;
  usdPerMillionCredits?: number;
}): number {
  const credits = Math.max(0, input.sttAudioSeconds ?? 0) *
      CARTESIA_RATES.ink2CreditsPerAudioSecond +
    Math.max(0, input.ttsCharacters ?? 0) *
      CARTESIA_RATES.sonic35CreditsPerCharacter;
  return (
    credits *
    Math.max(
      0,
      input.usdPerMillionCredits ?? CARTESIA_RATES.usdPerMillionCredits,
    ) /
    1_000_000
  );
}

export function estimateResponsesCostUsd(input: {
  model: keyof typeof RESPONSES_RATES;
  inputTokens?: number;
  outputTokens?: number;
}): number {
  const rate = RESPONSES_RATES[input.model];
  return (
    Math.max(0, input.inputTokens ?? 0) * rate.input +
    Math.max(0, input.outputTokens ?? 0) * rate.output
  );
}

export function estimateAnthropicCostUsd(input: {
  model: keyof typeof ANTHROPIC_RATES;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}): number {
  const rate = ANTHROPIC_RATES[input.model];
  return (
    Math.max(0, input.inputTokens ?? 0) * rate.input +
    Math.max(0, input.outputTokens ?? 0) * rate.output +
    Math.max(0, input.cacheCreationInputTokens ?? 0) * rate.cacheWrite +
    Math.max(0, input.cacheReadInputTokens ?? 0) * rate.cacheRead
  );
}

export const TTS_MODEL = "gpt-4o-mini-tts";
export const TTS_MAX_TEXT_LENGTH = 300;
export const TTS_MAX_REQUESTS_PER_MINUTE = 30;
export const TTS_MAX_REQUESTS_PER_SESSION = 200;

/** Published estimate for gpt-4o-mini-tts, plus its text-input token rate. */
export const TTS_RATES = {
  audioPerMinute: 0.015,
  textInputPerToken: 0.6 / 1_000_000,
  estimatedWordsPerMinute: 150,
  estimatedCharactersPerToken: 4,
  minimumAudioSeconds: 0.4,
} as const;

export const COACH_LIMIT_MESSAGES = {
  workoutBudgetExhausted:
    "Coach time used up for this workout. Your assistant refills on your next workout.",
  dailyBudgetExhausted:
    "Daily coach limit reached. Your assistant refills tomorrow.",
} as const;

export function isDailyBudgetExhausted(spentUsd: number): boolean {
  return spentUsd >= COACH_LIMITS.maxDailyCostUsd;
}

/** gpt-realtime-2.1-mini pricing (USD per token). */
export const REALTIME_MINI_RATES = {
  textInput: 0.6 / 1_000_000,
  textOutput: 2.4 / 1_000_000,
  audioInput: 10 / 1_000_000,
  audioOutput: 20 / 1_000_000,
  cachedTextInput: 0.06 / 1_000_000,
  cachedAudioInput: 0.30 / 1_000_000,
} as const;

export interface UsageTokenBreakdown {
  input_text_tokens: number;
  cached_text_tokens: number;
  input_audio_tokens: number;
  cached_audio_tokens: number;
  output_text_tokens: number;
  output_audio_tokens: number;
}

export function estimateRealtimeCostUsd(tokens: UsageTokenBreakdown): number {
  const uncachedText = Math.max(
    0,
    tokens.input_text_tokens - tokens.cached_text_tokens,
  );
  const uncachedAudio = Math.max(
    0,
    tokens.input_audio_tokens - tokens.cached_audio_tokens,
  );
  return (
    uncachedText * REALTIME_MINI_RATES.textInput +
    tokens.cached_text_tokens * REALTIME_MINI_RATES.cachedTextInput +
    uncachedAudio * REALTIME_MINI_RATES.audioInput +
    tokens.cached_audio_tokens * REALTIME_MINI_RATES.cachedAudioInput +
    tokens.output_text_tokens * REALTIME_MINI_RATES.textOutput +
    tokens.output_audio_tokens * REALTIME_MINI_RATES.audioOutput
  );
}

export interface ValidatedTtsRequest {
  text: string;
  requestId: string;
  sessionKey: string;
}

export type TtsValidationResult =
  | { ok: true; value: ValidatedTtsRequest }
  | { ok: false; error: string };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function validateTtsRequest(input: unknown): TtsValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body must be an object" };
  }
  const body = input as Record<string, unknown>;
  if (typeof body.text !== "string") {
    return { ok: false, error: "text is required" };
  }
  const text = body.text.trim();
  if (!text || text.length > TTS_MAX_TEXT_LENGTH) {
    return {
      ok: false,
      error: `text must be between 1 and ${TTS_MAX_TEXT_LENGTH} characters`,
    };
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    return { ok: false, error: "text contains unsupported control characters" };
  }
  if (
    typeof body.request_id !== "string" ||
    body.request_id.length < 8 ||
    body.request_id.length > 128 ||
    !REQUEST_ID_PATTERN.test(body.request_id)
  ) {
    return { ok: false, error: "Invalid request_id" };
  }
  if (
    typeof body.session_key !== "string" ||
    body.session_key.length < 16 ||
    body.session_key.length > 128
  ) {
    return { ok: false, error: "Invalid session_key" };
  }
  return {
    ok: true,
    value: {
      text,
      requestId: body.request_id,
      sessionKey: body.session_key,
    },
  };
}

/**
 * Speech responses do not include token usage when streamed as raw PCM.
 * Reserve a deterministic estimate from text length and a 150 WPM delivery.
 */
export function estimateTtsCostUsd(text: string): number {
  const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
  const audioMinutes = Math.max(
    TTS_RATES.minimumAudioSeconds / 60,
    words / TTS_RATES.estimatedWordsPerMinute,
  );
  const textTokens = Math.ceil(
    text.length / TTS_RATES.estimatedCharactersPerToken,
  );
  return (
    audioMinutes * TTS_RATES.audioPerMinute +
    textTokens * TTS_RATES.textInputPerToken
  );
}
