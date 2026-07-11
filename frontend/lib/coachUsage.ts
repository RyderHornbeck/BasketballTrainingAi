// Client-side Realtime usage tracking and cost estimation.

import { supabase } from "@/lib/supabase";

export const REALTIME_MINI_RATES = {
  textInput: 0.6 / 1_000_000,
  textOutput: 2.4 / 1_000_000,
  audioInput: 10 / 1_000_000,
  audioOutput: 20 / 1_000_000,
  cachedTextInput: 0.3 / 1_000_000,
} as const;

export interface CoachUsageTotals {
  model: string;
  responseCount: number;
  sessionDurationMs: number;
  inputTextTokens: number;
  cachedInputTokens: number;
  inputAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  estimatedCostUsd: number;
}

export function createUsageTracker(model: string) {
  const startedAt = Date.now();
  let responseCount = 0;
  let inputTextTokens = 0;
  let cachedInputTokens = 0;
  let inputAudioTokens = 0;
  let outputTextTokens = 0;
  let outputAudioTokens = 0;

  return {
    addResponseUsage(usage?: {
      input_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
        cached_tokens?: number;
      };
      output_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
      };
    }) {
      responseCount += 1;
      const input = usage?.input_token_details;
      const output = usage?.output_token_details;
      inputTextTokens += input?.text_tokens ?? 0;
      cachedInputTokens += input?.cached_tokens ?? 0;
      inputAudioTokens += input?.audio_tokens ?? 0;
      outputTextTokens += output?.text_tokens ?? 0;
      outputAudioTokens += output?.audio_tokens ?? 0;
    },
    snapshot(): CoachUsageTotals {
      const uncachedText = Math.max(0, inputTextTokens - cachedInputTokens);
      const estimatedCostUsd =
        uncachedText * REALTIME_MINI_RATES.textInput +
        cachedInputTokens * REALTIME_MINI_RATES.cachedTextInput +
        inputAudioTokens * REALTIME_MINI_RATES.audioInput +
        outputTextTokens * REALTIME_MINI_RATES.textOutput +
        outputAudioTokens * REALTIME_MINI_RATES.audioOutput;

      return {
        model,
        responseCount,
        sessionDurationMs: Date.now() - startedAt,
        inputTextTokens,
        cachedInputTokens,
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
        cached_input_tokens: params.totals.cachedInputTokens,
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
