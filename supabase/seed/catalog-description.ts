/**
 * Keep drill descriptions focused on setup and numbered instructions.
 * Set counts, reps, times, and side-switch prescriptions are stored separately
 * on workout exercises and should not be repeated after the final numbered step.
 */
export function stripTextAfterFinalStep(description: string): string {
  const stepMatches = [...description.matchAll(/\bStep\s+\d+\s*:/gi)];
  const finalStep = stepMatches.at(-1);
  if (finalStep?.index == null) return description.trim();

  const finalStepText = description.slice(finalStep.index);
  const sentenceEnd = finalStepText.match(/[.!?](?=\s|$)/);
  if (sentenceEnd?.index == null) return description.trim();

  const keepThrough = finalStep.index + sentenceEnd.index + 1;
  return description.slice(0, keepThrough).trim();
}
