import AsyncStorage from "@react-native-async-storage/async-storage";

export type CoachVoiceProvider = "cartesia" | "assembly_inworld";

const STORAGE_KEY = "court-coach:developer-voice-provider";

export function isCoachVoiceProvider(value: unknown): value is CoachVoiceProvider {
  return value === "cartesia" || value === "assembly_inworld";
}

export async function loadDeveloperCoachVoiceProvider(): Promise<CoachVoiceProvider> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  return isCoachVoiceProvider(saved) ? saved : "cartesia";
}

export async function saveDeveloperCoachVoiceProvider(
  provider: CoachVoiceProvider,
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, provider);
}
