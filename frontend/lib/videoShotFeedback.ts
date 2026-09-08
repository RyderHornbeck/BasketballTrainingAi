export type VideoShotKind = "shooting" | "layup" | "floater";
export type VideoShotResult = "make" | "miss";

export const SHOOTING_MAKES = [
  "Nice shot.",
  "Good bucket.",
  "That's green.",
  "Nicely done.",
  "Good shot.",
  "Knocked it down.",
  "That's money.",
] as const;

export const LAYUP_MAKES = [
  "Nice lay.",
  "Good finish.",
  "There you go.",
  "Laid it in.",
  "Nice bucket.",
  "There it is.",
  "Good work.",
] as const;

export const FLOATER_MAKES = [
  "Nice floater.",
  "Dropped it in.",
  "Good bucket.",
  "There you go.",
  "Got it to fall.",
  "Nice finish.",
  "That's money.",
  "Count it.",
] as const;

export const SHOOTING_MISSES = [
  "Bend your knees and get your legs into the shot.",
  "Hold your follow-through.",
  "Keep your elbow under the ball as you rise.",
  "Finish with your arm extended and your wrist relaxed.",
  "Get your feet underneath you before you shoot.",
  "Stay balanced and finish tall.",
  "Push through your legs in one smooth motion.",
  "Keep your guide hand relaxed and let your shooting hand finish.",
  "Reach up through your release.",
  "Keep your shoulders relaxed.",
  "Hold your finish until the ball reaches the rim.",
  "Use your legs so you don't have to force it with your arms.",
  "Set your feet and rise into the shot.",
  "Keep your wrist loose through the release.",
  "Straighten your shooting arm all the way through.",
  "Keep your head steady as you shoot.",
  "Get balanced before you bring the ball up.",
  "Let the ball roll off your fingertips.",
  "Bend your knees, then extend toward the basket.",
  "Keep your shooting motion smooth.",
  "Let your guide hand support the ball without pushing it.",
  "Finish high and hold it.",
  "Keep your body upright through the shot.",
  "Bring the ball up smoothly as you straighten your legs.",
  "Stay loose through your arms and shoulders.",
  "Give yourself a strong, balanced base.",
  "Lift into the shot instead of forcing the release.",
  "Keep your elbow underneath it and extend fully.",
  "Land balanced after your shot.",
  "Let your legs and shooting arm work together.",
  "Keep your hand relaxed as the ball leaves.",
  "Rise up without leaning back.",
  "Reach toward the basket and let your wrist relax.",
  "Keep the motion flowing from your knees through your fingertips.",
  "Settle your feet before you rise.",
  "Use a smooth lift and a relaxed release.",
  "Keep your balance all the way through your finish.",
  "Bring the ball up under control.",
  "Extend through the shot before you lower your arm.",
  "Get your legs involved and keep your upper body relaxed.",
] as const;

export const FLOATER_MISSES = [
  "Use your legs and finish with a soft touch.",
  "Reach high on the release.",
  "Keep your wrist relaxed.",
  "Stay balanced as you lift into the floater.",
  "Give the ball some arc and let it drop.",
  "Go up under control.",
  "Extend your arm and let the ball roll off your fingertips.",
  "Keep your body upright as you finish.",
  "Bend your knees and lift through your legs.",
  "Keep your shooting hand soft.",
  "Slow your approach and control the finish.",
  "Lift the ball instead of pushing it hard.",
  "Keep your shoulders relaxed as you release.",
  "Finish high with a gentle touch.",
  "Get your feet underneath you before you go up.",
  "Keep the release smooth.",
  "Use your legs for height and your hand for touch.",
  "Stay steady through your takeoff.",
  "Reach up and let the ball go softly.",
  "Keep your head steady as you finish.",
  "Relax your fingers through the release.",
  "Control your steps before you lift.",
  "Give yourself room to rise and extend.",
  "Keep your arm motion smooth and relaxed.",
  "Let the ball come off your fingertips gently.",
  "Go up tall.",
  "Keep your balance instead of leaning back.",
  "Lift with your legs and reach through the finish.",
  "Keep your guide hand relaxed on the release.",
  "Take a little speed off and finish under control.",
  "Get underneath the ball and lift it.",
  "Extend upward with a loose wrist.",
  "Stay relaxed through your arm and shoulder.",
  "Bring the ball up in one smooth motion.",
  "Let the height of the floater do the work.",
  "Keep your body controlled and your release gentle.",
  "Finish with your shooting arm extended.",
  "Rise into it without rushing your hand.",
  "Keep the ball steady as you gather.",
  "Bend your knees, reach high, and soften the release.",
] as const;

export const LAYUP_MISSES = [
  "Go up strong and finish softly.",
  "Extend your arm toward the basket.",
  "Control your last two steps.",
  "Drive your knee up as you finish.",
  "Let the ball roll off your fingertips.",
  "Keep your body balanced on the way up.",
  "Reach high and use a soft touch.",
  "Slow down enough to control the finish.",
  "Use your legs to get up toward the rim.",
  "Keep your finishing hand relaxed.",
  "Bring the ball up under control.",
  "Get your feet underneath you before you jump.",
  "Lift the ball gently toward the basket.",
  "Keep your chest up as you finish.",
  "Extend fully before you release.",
  "Keep the ball secure on your approach.",
  "Jump up instead of drifting underneath the rim.",
  "Stay smooth through your steps and your release.",
  "Reach closer to the basket.",
  "Keep your wrist loose at the finish.",
  "Gather the ball firmly, then release it softly.",
  "Push through your legs and finish tall.",
  "Keep your shoulders relaxed.",
  "Take your time through the final steps.",
  "Lift with your legs instead of throwing the ball.",
  "Stay upright as you go up.",
  "Keep the ball close until you reach to finish.",
  "Use a gentle touch off your fingertips.",
  "Keep your head steady through the finish.",
  "Go up balanced and extend toward the rim.",
  "Make your approach smooth and controlled.",
  "Reach up before you let it go.",
  "Keep your arm relaxed as you extend.",
  "Give yourself space to take off.",
  "Bring your knee up and reach with your finishing hand.",
  "Keep your steps controlled so you don't rush the release.",
  "Finish with a soft hand.",
  "Let your jump bring you closer before you release.",
  "Stay balanced from your gather through your finish.",
  "Control your approach, get up tall, and lay it in softly.",
] as const;

export function videoShotKind(category: string | null, drillName: string | null): VideoShotKind {
  if (/\b(?:floater|runner|push shot)\b/i.test(drillName ?? "")) return "floater";
  return category === "finishing" ? "layup" : "shooting";
}

function randomItem<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

export function selectVideoShotReply(args: {
  result: VideoShotResult;
  kind: VideoShotKind;
  makes: number;
  attempts: number;
  makeStreak: number;
  random?: () => number;
}): string {
  const random = args.random ?? Math.random;
  if (args.result === "make" && [3, 5, 10].includes(args.makeStreak)) {
    return `Keep going, you're ${args.makeStreak} in a row.`;
  }
  if (random() >= 0.8) return `You're ${args.makes} for ${args.attempts}.`;
  if (args.result === "make") {
    const clips = args.kind === "floater"
      ? FLOATER_MAKES
      : args.kind === "layup"
        ? LAYUP_MAKES
        : SHOOTING_MAKES;
    return randomItem(clips, random);
  }
  const clips = args.kind === "floater"
    ? FLOATER_MISSES
    : args.kind === "layup"
      ? LAYUP_MISSES
      : SHOOTING_MISSES;
  return randomItem(clips, random);
}
