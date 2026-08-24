import { clearOnboardingDraft, loadOnboardingDraft } from "@/lib/onboardingDraft";
import {
  clearPendingAIDataConsent,
  loadPendingAIDataConsent,
  setAIDataConsent,
} from "@/lib/aiDataConsent";
import { DEFAULT_COACH_VOICE } from "@/lib/coachProfiles";
import { requestPlanGeneration, submitOnboardingAnswers } from "@/lib/plan";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";

async function loadPostAuthProfile(userId: string) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", userId)
      .maybeSingle();
    if (error) lastError = new Error(error.message);
    if (data) return data;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(
    "Your account was verified, but Court Coach could not finish account setup."
  );
}

export async function routeAfterSocialAuth(
  userId: string,
  refreshProfile: () => Promise<void>
): Promise<void> {
  const profile = await loadPostAuthProfile(userId);

  if (profile.onboarding_completed) {
    await refreshProfile();
    router.replace("/");
    return;
  }

  const draft = await loadOnboardingDraft();
  if (!draft) {
    await refreshProfile();
    router.replace("/onboarding");
    return;
  }

  const pendingAIConsent = await loadPendingAIDataConsent();
  const aiConsentAllowed = pendingAIConsent?.allowed === true;
  try {
    await setAIDataConsent(aiConsentAllowed, "onboarding");
    const { error: voiceError } = await supabase
      .from("profiles")
      .update({
        realtime_coach_voice: draft.realtime_coach_voice ?? DEFAULT_COACH_VOICE,
        preferred_name: draft.preferred_name?.trim() || null,
      })
      .eq("id", userId);
    if (voiceError) throw voiceError;
    // This flips onboarding_completed and is deliberately the final database
    // step. Interrupted setup therefore remains retryable on the next launch.
    await submitOnboardingAnswers(userId, draft);
    await Promise.all([
      clearOnboardingDraft(),
      clearPendingAIDataConsent(),
    ]);
    await refreshProfile();
    router.replace({
      pathname: "/paywall",
      params: { next: "generating" },
    });
    void requestPlanGeneration().catch((generationError) => {
      console.error("Unable to start initial plan generation:", generationError);
    });
  } catch (setupError) {
    // The identity provider sign-in already succeeded. Keep the authenticated
    // session and move setup to the retryable post-paywall screen instead of
    // incorrectly reporting an Apple/Google sign-in failure.
    console.warn("Post-auth onboarding setup will be retried:", setupError);
    await refreshProfile().catch(() => {});
    router.replace({
      pathname: "/paywall",
      params: { next: "finish-setup" },
    });
  }
}
