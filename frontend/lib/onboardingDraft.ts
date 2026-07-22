// Onboarding now happens BEFORE account creation, so there's no user_id to
// attach the answers to yet. We stash the in-progress form here (backed by
// AsyncStorage so it survives the app being backgrounded/killed between the
// end of onboarding and finishing signup) and write it to Supabase once the
// account exists.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CoachVoice } from "@/lib/coachProfiles";
import { OnboardingFormData } from "@/types/plan";

const DRAFT_KEY = "hoopplan.onboarding_draft.v1";

export type OnboardingDraft = OnboardingFormData & {
  realtime_coach_voice?: CoachVoice;
};

export async function saveOnboardingDraft(data: OnboardingDraft): Promise<void> {
  await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(data));
}

export async function loadOnboardingDraft(): Promise<OnboardingDraft | null> {
  const raw = await AsyncStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OnboardingDraft;
  } catch {
    return null;
  }
}

export async function clearOnboardingDraft(): Promise<void> {
  await AsyncStorage.removeItem(DRAFT_KEY);
}
