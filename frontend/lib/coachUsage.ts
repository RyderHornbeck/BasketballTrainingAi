// Client-side Realtime usage tracking and cost estimation.

import { supabase } from "@/lib/supabase";

export const COACH_DAILY_BUDGET_USD = 0.75;

export const COACH_LIMIT_MESSAGES = {
  dailyBudgetExhausted: "Today's 75¢ coach credit is used up. It refills tomorrow.",
} as const;

export function isCoachLimitMessage(msg: string): boolean {
  const values = Object.values(COACH_LIMIT_MESSAGES);
  return values.includes(msg as (typeof values)[number]) || msg.toLowerCase().includes("limit reached");
}

export interface CoachDailyBudget {
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  exhausted: boolean;
}

export function isDailyBudgetExhausted(
  spentUsd: number,
  budgetUsd = COACH_DAILY_BUDGET_USD
): boolean {
  return spentUsd >= budgetUsd;
}

export function remainingDailyBudgetUsd(
  spentUsd: number,
  budgetUsd = COACH_DAILY_BUDGET_USD
): number {
  return Math.max(0, budgetUsd - spentUsd);
}

export function coachDailyBudgetFromUsage(
  spentUsd: number,
  budgetUsd = COACH_DAILY_BUDGET_USD
): CoachDailyBudget {
  const remainingUsd = remainingDailyBudgetUsd(spentUsd, budgetUsd);
  return {
    spentUsd,
    budgetUsd,
    remainingUsd,
    exhausted: isDailyBudgetExhausted(spentUsd, budgetUsd),
  };
}

export async function fetchDailyCoachBudget(): Promise<CoachDailyBudget> {
  const budgetUsd = COACH_DAILY_BUDGET_USD;
  const { data, error } = await supabase.rpc("get_my_coach_daily_usage");
  if (error) throw new Error(error.message);
  const daily = Array.isArray(data) ? data[0] : data;
  return coachDailyBudgetFromUsage(Number(daily?.spent_usd ?? 0), budgetUsd);
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
  finalizeSession?: boolean;
}): Promise<{ spentUsd: number; budgetUsd: number; remainingUsd: number } | null> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { data, error } = await supabase.functions.invoke<{
        daily_usage?: { spent_usd: number; budget_usd: number; remaining_usd: number };
      }>("coach-usage", {
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
          finalize_session: params.finalizeSession === true,
        },
      });
      if (error) throw error;
      const daily = data?.daily_usage;
      if (daily) {
        return {
          spentUsd: Number(daily.spent_usd),
          budgetUsd: Number(daily.budget_usd),
          remainingUsd: Number(daily.remaining_usd),
        };
      }
      throw new Error("Coach usage response did not include a daily balance.");
    } catch (err) {
      if (attempt === 3) {
        console.warn("Failed to log coach usage after retries:", err);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  return null;
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

export function appendConversationTurn(
  current: string,
  userTranscript: string,
  coachResponse: string,
  maxLen = 1_200,
): string {
  const user = userTranscript.trim();
  const coach = coachResponse.trim();
  if (!user && !coach) return current.slice(-maxLen);
  const turn = [
    user ? `User: ${user}` : "",
    coach ? `Coach: ${coach}` : "",
  ].filter(Boolean).join("\n");
  const merged = current ? `${current}\n${turn}` : turn;
  return merged.length > maxLen ? merged.slice(-maxLen) : merged;
}
