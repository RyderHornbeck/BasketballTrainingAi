export type CoachSttProvider = "assemblyai" | "deepgram";

export function selectCoachSttProvider(
  flag: string | undefined | null,
): CoachSttProvider {
  return flag === "1" ? "deepgram" : "assemblyai";
}

export async function resolveCoachSttAuthorization<
  AssemblyToken,
  DeepgramToken,
>(
  options: {
    flag: string | undefined | null;
    forceAssemblyFallback?: boolean;
    reconnectDeepgram?: boolean;
    mintAssembly: () => Promise<AssemblyToken>;
    mintDeepgram: () => Promise<DeepgramToken>;
  },
): Promise<{
  selected: CoachSttProvider;
  fallback: boolean;
  fallbackReason?: "deepgram_authorization_failed";
  assembly?: AssemblyToken;
  deepgram?: DeepgramToken;
}> {
  const selected = options.forceAssemblyFallback
    ? "assemblyai"
    : options.reconnectDeepgram
    ? "deepgram"
    : selectCoachSttProvider(options.flag);
  if (selected === "assemblyai") {
    return {
      selected,
      fallback: Boolean(options.forceAssemblyFallback),
      assembly: await options.mintAssembly(),
    };
  }
  try {
    return {
      selected,
      fallback: false,
      deepgram: await options.mintDeepgram(),
    };
  } catch {
    return {
      selected: "assemblyai",
      fallback: true,
      fallbackReason: "deepgram_authorization_failed",
      assembly: await options.mintAssembly(),
    };
  }
}

export const DEEPGRAM_STREAMING_CONFIG = {
  model: "nova-3",
  language: "en-US",
  encoding: "linear16",
  sample_rate: 16_000,
  channels: 1,
  interim_results: true,
  endpointing: 600,
  smart_format: true,
  punctuate: true,
  vad_events: true,
} as const;
