import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo-modules-core";

export type AppReviewMilestone = "badge_5" | "badge_10";

interface StoreReviewModule {
  isAvailableAsync?: () => Promise<boolean>;
  requestReview?: () => Promise<void>;
}

const storeReview = requireOptionalNativeModule<StoreReviewModule>("ExpoStoreReview");
const requestedStorageKey = (userId: string) => `court-coach.app-review.requested.${userId}`;
const onboardingReviewStorageKey = "court-coach.app-review.onboarding-requested";
const inFlight = new Map<string, Promise<boolean>>();
let onboardingRequest: Promise<boolean> | null = null;

async function requestedMilestones(userId: string): Promise<Set<AppReviewMilestone>> {
  try {
    const raw = await AsyncStorage.getItem(requestedStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (value): value is AppReviewMilestone =>
          value === "badge_5" || value === "badge_10"
      )
    );
  } catch {
    return new Set();
  }
}

export function requestOnboardingReviewOnce(): Promise<boolean> {
  if (onboardingRequest) return onboardingRequest;
  onboardingRequest = (async () => {
    if ((await AsyncStorage.getItem(onboardingReviewStorageKey)) === "1") return true;
    if (
      !storeReview?.isAvailableAsync ||
      !storeReview.requestReview ||
      !(await storeReview.isAvailableAsync())
    ) {
      return false;
    }

    await AsyncStorage.setItem(onboardingReviewStorageKey, "1");
    try {
      await storeReview.requestReview();
      return true;
    } catch (error) {
      await AsyncStorage.removeItem(onboardingReviewStorageKey);
      console.warn("Unable to request an onboarding app review:", error);
      return false;
    }
  })().finally(() => {
    onboardingRequest = null;
  });
  return onboardingRequest;
}

export function requestAppReviewOnce(
  userId: string,
  milestone: AppReviewMilestone
): Promise<boolean> {
  const requestKey = `${userId}:${milestone}`;
  const existing = inFlight.get(requestKey);
  if (existing) return existing;

  const request = (async () => {
    const requested = await requestedMilestones(userId);
    if (requested.has(milestone)) return true;
    if (
      !storeReview?.isAvailableAsync ||
      !storeReview.requestReview ||
      !(await storeReview.isAvailableAsync())
    ) {
      return false;
    }

    requested.add(milestone);
    await AsyncStorage.setItem(requestedStorageKey(userId), JSON.stringify([...requested]));
    try {
      await storeReview.requestReview();
      return true;
    } catch (error) {
      requested.delete(milestone);
      await AsyncStorage.setItem(requestedStorageKey(userId), JSON.stringify([...requested]));
      console.warn("Unable to request an app review:", error);
      return false;
    }
  })().finally(() => {
    inFlight.delete(requestKey);
  });

  inFlight.set(requestKey, request);
  return request;
}
