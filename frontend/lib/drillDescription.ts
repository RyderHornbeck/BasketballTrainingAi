export interface ParsedDrillDescription {
  intro: string | null;
  steps: { number: number; text: string }[];
  repeat: string | null;
}

const STEP_SPLIT = /Step\s+(\d+):\s*/gi;

const TERM_REPLACEMENTS: [RegExp, string][] = [
  [/\bthe slot\b/gi, "the middle of the court (between the free-throw lines)"],
  [/\bslot area\b/gi, "middle court area"],
  [/\bfrom the slot\b/gi, "from the middle of the court"],
  [/\bat the slot\b/gi, "at the middle of the court"],
  [/\bto the slot\b/gi, "to the middle of the court"],
  [/\bthe nail\b/gi, "the top of the key"],
  [/\bself-toss\b/gi, "bounce the ball to yourself"],
  [/\bSelf-toss\b/g, "Bounce the ball to yourself"],
  [/\bhave a partner pass it\b/gi, "have a partner pass you the ball"],
  [/\bor have a partner pass it\b/gi, "or have a partner pass you the ball"],
  [/\btriple threat\b/gi, "triple-threat stance (ball ready to shoot, pass, or drive)"],
  [/\bpin-down screen\b/gi, "screen that runs you toward the baseline"],
  [/\bcharge circle\b/gi, "charge-circle area near the basket"],
  [/\bdunker spot\b/gi, "short corner area under the basket"],
  [/\bfree-throw line extended\b/gi, "wing area even with the free-throw line"],
];

export function clarifyDrillTerms(text: string): string {
  let result = text;
  for (const [pattern, replacement] of TERM_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function parseDrillDescription(raw: string): ParsedDrillDescription {
  const text = clarifyDrillTerms(raw.trim());
  const parts = text.split(STEP_SPLIT).filter(Boolean);

  if (parts.length <= 1) {
    const repeatMatch = text.match(/(?:Repeat|Do|Work|Alternate)[^.]*\.?\s*$/i);
    return { intro: text, steps: [], repeat: null };
  }

  const intro = parts[0].trim().replace(/\.\s*$/, "") || null;
  const steps: { number: number; text: string }[] = [];

  for (let i = 1; i < parts.length; i += 2) {
    const number = Number.parseInt(parts[i], 10);
    let stepText = (parts[i + 1] ?? "").trim();

    const repeatIdx = stepText.search(
      /\.\s*(Repeat|Do \d|Work both|Alternate|Next rep|Mirror|Then mirror)/i
    );
    if (repeatIdx >= 0) {
      stepText = stepText.slice(0, repeatIdx).trim();
    }

    if (stepText) {
      steps.push({ number, text: stepText.replace(/\.\s*$/, "") });
    }
  }

  const repeatMatch = text.match(
    /(?:Repeat|Do \d|Work both|Alternate|Mirror)[^.]*(?:\.|$)/i
  );
  const repeat = repeatMatch ? repeatMatch[0].trim().replace(/\.\s*$/, "") : null;

  return { intro, steps, repeat };
}
