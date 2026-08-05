import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/database";

export const AI_DATA_CONSENT_VERSION = "2026-08-05";
export const AI_DATA_CONSENT_REQUIRED_CODE = "ai_data_consent_required";

const PENDING_CONSENT_KEY = "@court-coach/ai-data-consent";

export type AIDataConsentSource = "onboarding" | "settings" | "coach_gate";

interface PendingAIDataConsent {
  allowed: boolean;
  version: string;
}

export function hasCurrentAIDataConsent(
  profile: Pick<
    Profile,
    "ai_data_processing_allowed" | "ai_data_processing_consent_version"
  > | null | undefined
): boolean {
  return (
    profile?.ai_data_processing_allowed === true &&
    profile.ai_data_processing_consent_version === AI_DATA_CONSENT_VERSION
  );
}

export async function savePendingAIDataConsent(allowed: boolean): Promise<void> {
  const value: PendingAIDataConsent = {
    allowed,
    version: AI_DATA_CONSENT_VERSION,
  };
  await AsyncStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify(value));
}

export async function loadPendingAIDataConsent(): Promise<PendingAIDataConsent | null> {
  const raw = await AsyncStorage.getItem(PENDING_CONSENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingAIDataConsent>;
    if (
      typeof parsed.allowed !== "boolean" ||
      parsed.version !== AI_DATA_CONSENT_VERSION
    ) {
      return null;
    }
    return parsed as PendingAIDataConsent;
  } catch {
    return null;
  }
}

export async function clearPendingAIDataConsent(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_CONSENT_KEY);
}

export async function setAIDataConsent(
  allowed: boolean,
  source: AIDataConsentSource
): Promise<void> {
  const { error } = await supabase.rpc("set_ai_data_processing_consent", {
    p_allowed: allowed,
    p_consent_version: AI_DATA_CONSENT_VERSION,
    p_source: source,
  });
  if (error) throw new Error(error.message);
  await savePendingAIDataConsent(allowed);
}
