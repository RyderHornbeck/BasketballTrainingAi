// Coach usage limits and cost estimation for OpenAI Realtime sessions.

export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1-mini";

export const COACH_LIMITS = {
  /** One coach-credit pool across every workout in the user's local day. */
  maxDailyCostUsd: 0.75,
} as const;

export const COACH_DAILY_BUDGET_USD = COACH_LIMITS.maxDailyCostUsd;

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
  const uncachedText = Math.max(0, tokens.input_text_tokens - tokens.cached_text_tokens);
  const uncachedAudio = Math.max(0, tokens.input_audio_tokens - tokens.cached_audio_tokens);
  return (
    uncachedText * REALTIME_MINI_RATES.textInput +
    tokens.cached_text_tokens * REALTIME_MINI_RATES.cachedTextInput +
    uncachedAudio * REALTIME_MINI_RATES.audioInput +
    tokens.cached_audio_tokens * REALTIME_MINI_RATES.cachedAudioInput +
    tokens.output_text_tokens * REALTIME_MINI_RATES.textOutput +
    tokens.output_audio_tokens * REALTIME_MINI_RATES.audioOutput
  );
}
