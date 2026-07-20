import { clearOnboardingDraft, loadOnboardingDraft } from "@/lib/onboardingDraft";
import { requestPlanGeneration, submitOnboardingAnswers } from "@/lib/plan";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";

export async function routeAfterSocialAuth(
  userId: string,
  refreshProfile: () => Promise<void>
): Promise<void> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .single();
  if (error) throw error;

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

  await submitOnboardingAnswers(userId, draft);
  await clearOnboardingDraft();
  await refreshProfile();
  router.replace({
    pathname: "/paywall",
    params: { next: "app" },
  });
  void requestPlanGeneration().catch((generationError) => {
    console.error("Unable to start initial plan generation:", generationError);
  });
}
