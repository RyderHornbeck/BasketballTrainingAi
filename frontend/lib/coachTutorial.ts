import AsyncStorage from "@react-native-async-storage/async-storage";

const TUTORIAL_PENDING_KEY = "court-coach.tutorial.pending.v1";
const TUTORIAL_COMPLETED_KEY = "court-coach.tutorial.completed.v1";

function keyForUser(key: string, userId: string): string {
  return `${key}.${userId}`;
}

export async function markCoachTutorialPending(userId: string): Promise<void> {
  await AsyncStorage.multiSet([
    [keyForUser(TUTORIAL_PENDING_KEY, userId), "true"],
    [keyForUser(TUTORIAL_COMPLETED_KEY, userId), "false"],
  ]);
}

export async function completeCoachTutorial(userId: string): Promise<void> {
  await AsyncStorage.multiSet([
    [keyForUser(TUTORIAL_PENDING_KEY, userId), "false"],
    [keyForUser(TUTORIAL_COMPLETED_KEY, userId), "true"],
  ]);
}

export async function shouldShowCoachTutorial(userId: string): Promise<boolean> {
  const [[, pending], [, completed]] = await AsyncStorage.multiGet([
    keyForUser(TUTORIAL_PENDING_KEY, userId),
    keyForUser(TUTORIAL_COMPLETED_KEY, userId),
  ]);
  // Existing accounts predate this marker. Show the tutorial once so it can be
  // tested before the temporary rollout is removed.
  return pending === "true" || completed !== "true";
}
