// Client-side Realtime usage tracking and cost estimation.

import { supabase } from "@/lib/supabase";

export const COACH_WORKOUT_BUDGET_USD = 0.5;
export const COACH_DAILY_BUDGET_USD = 1;

export const COACH_LIMIT_MESSAGES = {
  workoutBudgetExhausted:
    "Coach time used up for this workout. Your assistant refills on your next workout.",
  dailyBudgetExhausted:
    "Daily coach limit reached. Your assistant refills tomorrow.",
  dailyResponseLimit:
    "Daily coach response limit reached. Your assistant refills tomorrow.",
  workoutResponseLimit:
    "Coach response limit reached for this workout. Open your next workout for more.",
} as const;

export function isCoachLimitMessage(msg: string): boolean {
  const values = Object.values(COACH_LIMIT_MESSAGES);
  return values.includes(msg as (typeof values)[number]) || msg.toLowerCase().includes("limit reached");
}

export interface CoachWorkoutBudget {
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}

export function isWorkoutBudgetExhausted(
  spentUsd: number,
  budgetUsd = COACH_WORKOUT_BUDGET_USD
): boolean {
  return spentUsd >= budgetUsd;
}

export function remainingWorkoutBudgetUsd(
  spentUsd: number,
  budgetUsd = COACH_WORKOUT_BUDGET_USD
): number {
  return Math.max(0, budgetUsd - spentUsd);
}

export function coachWorkoutBudgetFromUsage(
  spentUsd: number,
  budgetUsd = COACH_WORKOUT_BUDGET_USD
): CoachWorkoutBudget {
  const remainingUsd = remainingWorkoutBudgetUsd(spentUsd, budgetUsd);
  return {
    spentUsd,
    budgetUsd,
    remainingUsd,
    exhausted: isWorkoutBudgetExhausted(spentUsd, budgetUsd),
  };
}

export async function fetchWorkoutCoachBudget(dayId: string): Promise<CoachWorkoutBudget> {
  const budgetUsd = COACH_WORKOUT_BUDGET_USD;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("coach_usage_logs")
    .select("estimated_cost_usd")
    .eq("user_id", userData.user.id)
    .eq("day_id", dayId);

  if (error) throw new Error(error.message);

  const spentUsd = (data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0);
  return coachWorkoutBudgetFromUsage(spentUsd, budgetUsd);
}

export function formatCoachBudgetCents(usd: number): string {
  const cents = Math.max(0, Math.round(usd * 100));
  return `${cents}¢`;
}

export const REALTIME_MINI_RATES = {
  textInput: 0.6 / 1_000_000,
  textOutput: 2.4 / 1_000_000,
  audioInput: 10 / 1_000_000,
  audioOutput: 20 / 1_000_000,
  cachedTextInput: 0.06 / 1_000_000,
  cachedAudioInput: 0.30 / 1_000_000,
} as const;

export interface CoachUsageTotals {
  model: string;
  responseCount: number;
  sessionDurationMs: number;
  inputTextTokens: number;
  cachedTextTokens: number;
  cachedAudioTokens: number;
  inputAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  estimatedCostUsd: number;
}

function splitCachedTokens(usage?: {
  input_tokens?: number;
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    cached_tokens?: number;
    cached_tokens_details?: {
      text_tokens?: number;
      audio_tokens?: number;
    };
  };
}): { cachedText: number; cachedAudio: number } {
  const details = usage?.input_token_details?.cached_tokens_details;
  const input = usage?.input_token_details;
  const inputCountFromDetails = (input?.text_tokens ?? 0) + (input?.audio_tokens ?? 0);
  const totalInputCount = usage?.input_tokens ?? inputCountFromDetails;
  const cachedTotal = input?.cached_tokens ?? 0;
  const cachedIsIncluded = cachedTotal > 0 && cachedTotal <= totalInputCount;

  if (!cachedIsIncluded) {
    return { cachedText: 0, cachedAudio: 0 };
  }
  if (details) {
    return {
      cachedText: Math.min(details.text_tokens ?? 0, input?.text_tokens ?? 0),
      cachedAudio: Math.min(details.audio_tokens ?? 0, input?.audio_tokens ?? 0),
    };
  }
  return { cachedText: Math.min(cachedTotal, input?.text_tokens ?? 0), cachedAudio: 0 };
}

export function createUsageTracker(model: string) {
  const startedAt = Date.now();
  let responseCount = 0;
  let inputTextTokens = 0;
  let cachedTextTokens = 0;
  let cachedAudioTokens = 0;
  let inputAudioTokens = 0;
  let outputTextTokens = 0;
  let outputAudioTokens = 0;

  return {
    addResponseUsage(usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
        cached_tokens?: number;
        cached_tokens_details?: {
          text_tokens?: number;
          audio_tokens?: number;
        };
      };
      output_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
      };
    }) {
      responseCount += 1;
      const input = usage?.input_token_details;
      const output = usage?.output_token_details;
      const cached = splitCachedTokens(usage);
      inputTextTokens += input?.text_tokens ?? 0;
      cachedTextTokens += cached.cachedText;
      cachedAudioTokens += cached.cachedAudio;
      inputAudioTokens += input?.audio_tokens ?? 0;
      const outputAudio = output?.audio_tokens ?? 0;
      const outputText =
        usage?.output_tokens != null
          ? Math.max(0, usage.output_tokens - outputAudio)
          : output?.text_tokens ?? 0;
      outputTextTokens += outputText;
      outputAudioTokens += outputAudio;
    },
    snapshot(): CoachUsageTotals {
      const uncachedText = Math.max(0, inputTextTokens - cachedTextTokens);
      const uncachedAudio = Math.max(0, inputAudioTokens - cachedAudioTokens);
      const estimatedCostUsd =
        uncachedText * REALTIME_MINI_RATES.textInput +
        cachedTextTokens * REALTIME_MINI_RATES.cachedTextInput +
        uncachedAudio * REALTIME_MINI_RATES.audioInput +
        cachedAudioTokens * REALTIME_MINI_RATES.cachedAudioInput +
        outputTextTokens * REALTIME_MINI_RATES.textOutput +
        outputAudioTokens * REALTIME_MINI_RATES.audioOutput;

      return {
        model,
        responseCount,
        sessionDurationMs: Date.now() - startedAt,
        inputTextTokens,
        cachedTextTokens,
        cachedAudioTokens,
        inputAudioTokens,
        outputTextTokens,
        outputAudioTokens,
        estimatedCostUsd,
      };
    },
  };
}

export async function logCoachUsage(params: {
  dayId: string | null;
  sessionKey: string;
  totals: CoachUsageTotals;
}): Promise<void> {
  try {
    await supabase.functions.invoke("coach-usage", {
      body: {
        day_id: params.dayId,
        session_key: params.sessionKey,
        model: params.totals.model,
        response_count: params.totals.responseCount,
        session_duration_ms: params.totals.sessionDurationMs,
        input_text_tokens: params.totals.inputTextTokens,
        cached_text_tokens: params.totals.cachedTextTokens,
        cached_audio_tokens: params.totals.cachedAudioTokens,
        input_audio_tokens: params.totals.inputAudioTokens,
        output_text_tokens: params.totals.outputTextTokens,
        output_audio_tokens: params.totals.outputAudioTokens,
      },
    });
  } catch (err) {
    console.warn("Failed to log coach usage:", err);
  }
}

export function createClientRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSessionKey(): string {
  return `coach-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function appendConversationSummary(current: string, addition: string, maxLen = 200): string {
  const trimmed = addition.trim();
  if (!trimmed) return current.slice(0, maxLen);
  const merged = current ? `${current} ${trimmed}` : trimmed;
  return merged.length > maxLen ? merged.slice(-maxLen) : merged;
}
