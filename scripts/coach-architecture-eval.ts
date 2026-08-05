import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inferCoachCapabilities } from "../frontend/lib/coachCapabilities";
import { parseCoachSpeechIntent } from "../frontend/lib/coachSpeech";
import { COACH_TOOL_REGISTRY } from "../shared/coach/toolRegistry";

const root = process.cwd().endsWith("/supabase")
  ? resolve(process.cwd(), "..")
  : process.cwd().endsWith("/frontend")
    ? resolve(process.cwd(), "..")
    : process.cwd();

const replayCases = [
  { phrase: "bruh I justed missed again", deterministic: "shot", capabilities: ["reads", "shots"] },
  { phrase: "I made two and missed three", deterministic: "shot", capabilities: ["reads", "shots"] },
  { phrase: "start a thirty second timer", deterministic: "timer", capabilities: ["reads", "timers"] },
  { phrase: "what's my target and attempts", deterministic: "progress", capabilities: ["reads", "shots"] },
  { phrase: "go to the fifth drill", deterministic: "navigation", capabilities: ["reads", "navigation"] },
  { phrase: "reopen the current workout", deterministic: "completion", capabilities: ["reads", "completion"] },
  { phrase: "save note my left hand felt weak", deterministic: "save_note", capabilities: ["reads", "notes"] },
  { phrase: "change this set to 30 seconds", deterministic: "set_prescription", capabilities: ["reads", "navigation", "edits"] },
  { phrase: "set this set target to 8 makes in 12 attempts", deterministic: "set_prescription", capabilities: ["reads", "shots", "navigation"] },
  { phrase: "complete set two", deterministic: "completion", capabilities: ["reads", "navigation", "completion"] },
  { phrase: "recommend and add a shooting drill", deterministic: null, capabilities: ["reads", "shots", "navigation", "edits", "recommendations"] },
  {
    phrase: "help me adjust this",
    deterministic: null,
    capabilities: ["reads", "shots", "navigation", "timers", "completion", "edits", "recommendations", "notes"],
  },
] as const;

async function main() {
  let passed = 0;
  for (const fixture of replayCases) {
    const intent = parseCoachSpeechIntent(fixture.phrase);
    const actualKind = intent?.kind ?? null;
    if (actualKind !== fixture.deterministic) {
      throw new Error(
        `${fixture.phrase}: expected ${String(fixture.deterministic)}, received ${String(actualKind)}`
      );
    }
    const capabilities = inferCoachCapabilities(fixture.phrase);
    if (JSON.stringify(capabilities) !== JSON.stringify(fixture.capabilities)) {
      throw new Error(
        `${fixture.phrase}: expected ${JSON.stringify(fixture.capabilities)}, received ${JSON.stringify(capabilities)}`
      );
    }
    passed += 1;
  }

  const coachCore = await readFile(
    resolve(root, "supabase/functions/_shared/coachCore.ts"),
    "utf8"
  );
  const prompt = coachCore.match(/export const COACH_TURN_STABLE_SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1] ?? "";
  const realtimeTools = COACH_TOOL_REGISTRY.filter((tool) => tool.realtime);
  const capabilityPayloads = Object.fromEntries(
    [...new Set(realtimeTools.map((tool) => tool.capability))].map((capability) => [
      capability,
      JSON.stringify(realtimeTools.filter((tool) => tool.capability === capability)).length,
    ])
  );
  const committedBaselinePromptChars = 8905;
  const promptReductionPct = Number(
    ((1 - prompt.length / committedBaselinePromptChars) * 100).toFixed(1)
  );

  console.log(
    JSON.stringify(
      {
        fixture_pass_rate: `${passed}/${replayCases.length}`,
        deterministic_fixtures: replayCases.filter((fixture) => fixture.deterministic).length,
        model_fallback_fixtures: replayCases.filter((fixture) => !fixture.deterministic).length,
        prompt_chars: prompt.length,
        committed_baseline_prompt_chars: committedBaselinePromptChars,
        prompt_reduction_pct: promptReductionPct,
        all_realtime_tool_chars: JSON.stringify(realtimeTools).length,
        response_capability_payload_chars: capabilityPayloads,
        paid_requests: 0,
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
