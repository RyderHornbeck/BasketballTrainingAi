#!/usr/bin/env node
/**
 * Pre-generates two-part shot-progress clips for every Coach persona.
 *
 * Required:
 *   INWORLD_API_KEY=<Inworld Basic Base64 credential>
 *
 * Optional:
 *   SHOT_PROGRESS_CONCURRENCY=2
 *   SHOT_PROGRESS_VOICES=devin,tyler
 *
 * Run from frontend:
 *   INWORLD_API_KEY=... node scripts/generate-shot-progress-audio.mjs
 *
 * Re-running is safe: valid existing files are skipped. A static Metro
 * manifest is written only after all expected files exist.
 */
import { createClient } from "@inworld/tts";
import { access, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = resolve(ROOT, "assets/sounds/ShotProgress");
const MINIMUM_AUDIO_BYTES = 256;
const MAX_SHOTS = 20;
const DEFAULT_CONCURRENCY = 2;
const STYLE_TAG =
  "[warm supportive basketball coach with natural conversational pacing and brief pauses between thoughts]";

const VOICES = {
  devin: "Nate",
  tyler: "Evan",
  maya: "Sarah",
  ava: "Zadie",
};
const BUNDLED_PERSONAS = (
  process.env.SHOT_PROGRESS_BUNDLED_PERSONAS ?? "devin,tyler,maya,ava"
)
  .split(",")
  .map((persona) => persona.trim().toLowerCase())
  .filter((persona) => persona in VOICES);
const manifestOnly = process.argv.includes("--manifest-only");

const requestedVoices = (process.env.SHOT_PROGRESS_VOICES ?? Object.keys(VOICES).join(","))
  .split(",")
  .map((voice) => voice.trim().toLowerCase())
  .filter(Boolean);

for (const voice of requestedVoices) {
  if (!(voice in VOICES)) {
    throw new Error(
      `Unknown voice "${voice}". Use one or more of: ${Object.keys(VOICES).join(", ")}.`,
    );
  }
}

const apiKey = process.env.INWORLD_API_KEY?.trim();
if (!apiKey && !manifestOnly) {
  throw new Error(
    "INWORLD_API_KEY is required. Use the same Basic Base64 credential configured as the Supabase Edge Function secret; do not put it in a committed .env file.",
  );
}

const parsedConcurrency = Number.parseInt(
  process.env.SHOT_PROGRESS_CONCURRENCY ?? String(DEFAULT_CONCURRENCY),
  10,
);
const concurrency = Number.isInteger(parsedConcurrency)
  ? Math.min(Math.max(parsedConcurrency, 1), 4)
  : DEFAULT_CONCURRENCY;

const client = apiKey
  ? createClient({
      apiKey,
      timeout: 60_000,
      maxRetries: 3,
      maxConcurrentRequests: concurrency,
    })
  : null;

function prefixText(makes, attempts) {
  return `You're ${makes} for ${attempts},`;
}

function remainingText(shotsLeft) {
  return shotsLeft === 1 ? "1 shot left." : `${shotsLeft} shots left.`;
}

function prefixFile(makes, attempts) {
  return `${String(makes).padStart(2, "0")}-for-${String(attempts).padStart(2, "0")}.mp3`;
}

function remainingFile(shotsLeft) {
  return `${String(shotsLeft).padStart(2, "0")}.mp3`;
}

async function validAudio(path) {
  try {
    return (await stat(path)).size >= MINIMUM_AUDIO_BYTES;
  } catch {
    return false;
  }
}

async function generateClip({ path, voice, text }) {
  if (await validAudio(path)) return false;
  if (!client) throw new Error("INWORLD_API_KEY is required to generate audio.");

  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.part`;
  try {
    await unlink(temporaryPath);
  } catch {
    // The file normally does not exist. A stale partial is safely replaced.
  }

  const audio = await client.generate({
    text: `${STYLE_TAG} ${text}`,
    voice,
    model: "inworld-tts-2",
    encoding: "MP3",
    sampleRate: 16_000,
    bitRate: 64_000,
    language: "en-US",
    speakingRate: 1.08,
    deliveryMode: "BALANCED",
  });
  if (audio.byteLength < MINIMUM_AUDIO_BYTES) {
    throw new Error(`Inworld returned an invalid audio response for "${text}".`);
  }
  await writeFile(temporaryPath, audio);
  await rename(temporaryPath, path);
  return true;
}

function jobsForVoice(persona) {
  const providerVoice = VOICES[persona];
  const jobs = [];
  for (let attempts = 0; attempts <= MAX_SHOTS; attempts += 1) {
    for (let makes = 0; makes <= attempts; makes += 1) {
      jobs.push({
        path: resolve(
          OUTPUT_ROOT,
          persona,
          "prefixes",
          prefixFile(makes, attempts),
        ),
        voice: providerVoice,
        text: prefixText(makes, attempts),
      });
    }
  }
  for (let shotsLeft = 0; shotsLeft <= MAX_SHOTS; shotsLeft += 1) {
    jobs.push({
      path: resolve(
        OUTPUT_ROOT,
        persona,
        "remaining",
        remainingFile(shotsLeft),
      ),
      voice: providerVoice,
      text: remainingText(shotsLeft),
    });
  }
  return jobs;
}

async function runPool(jobs) {
  let nextJob = 0;
  let completed = 0;
  let generated = 0;

  async function worker() {
    while (true) {
      const index = nextJob;
      nextJob += 1;
      if (index >= jobs.length) return;

      const wasGenerated = await generateClip(jobs[index]);
      completed += 1;
      if (wasGenerated) generated += 1;
      if (completed === jobs.length || completed % 20 === 0) {
        console.log(
          `${completed}/${jobs.length} processed (${generated} generated, ${completed - generated} reused)`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { generated, reused: completed - generated };
}

function manifestSource() {
  const lines = [
    "/* This file is generated by scripts/generate-shot-progress-audio.mjs. */",
    "/* eslint-disable @typescript-eslint/no-require-imports */",
    "",
    `export type ShotProgressPersona = ${BUNDLED_PERSONAS.map((persona) => `"${persona}"`).join(" | ")};`,
    "",
    "export interface ShotProgressAudio {",
    "  prefixes: Record<string, number>;",
    "  remaining: Record<number, number>;",
    "}",
    "",
    "export const SHOT_PROGRESS_AUDIO: Record<ShotProgressPersona, ShotProgressAudio> = {",
  ];

  for (const persona of BUNDLED_PERSONAS) {
    lines.push(`  ${persona}: {`, "    prefixes: {");
    for (let attempts = 0; attempts <= MAX_SHOTS; attempts += 1) {
      for (let makes = 0; makes <= attempts; makes += 1) {
        const file = prefixFile(makes, attempts);
        lines.push(
          `      "${makes}-${attempts}": require("./${persona}/prefixes/${file}"),`,
        );
      }
    }
    lines.push("    },", "    remaining: {");
    for (let shotsLeft = 0; shotsLeft <= MAX_SHOTS; shotsLeft += 1) {
      lines.push(
        `      ${shotsLeft}: require("./${persona}/remaining/${remainingFile(shotsLeft)}"),`,
      );
    }
    lines.push("    },", "  },");
  }
  lines.push("};", "");
  return lines.join("\n");
}

async function assertComplete() {
  for (const persona of BUNDLED_PERSONAS) {
    for (const job of jobsForVoice(persona)) {
      if (!(await validAudio(job.path))) {
        throw new Error(
          `Cannot write the Metro manifest: expected clip is missing or invalid: ${job.path}`,
        );
      }
    }
  }
}

async function main() {
  if (manifestOnly) {
    await assertComplete();
    await writeFile(resolve(OUTPUT_ROOT, "manifest.ts"), manifestSource());
    console.log("Wrote static Metro asset manifest without generating audio.");
    return;
  }
  const jobs = requestedVoices.flatMap(jobsForVoice);
  const expectedPrefixes = (MAX_SHOTS + 1) * (MAX_SHOTS + 2) / 2;
  console.log(
    `Preparing ${jobs.length} clips (${expectedPrefixes} prefixes + ${MAX_SHOTS + 1} remaining per voice) for ${requestedVoices.join(", ")} with ${concurrency} concurrent requests.`,
  );
  const result = await runPool(jobs);
  console.log(`Finished: ${result.generated} generated, ${result.reused} reused.`);

  if (requestedVoices.length === Object.keys(VOICES).length) {
    await assertComplete();
    await writeFile(resolve(OUTPUT_ROOT, "manifest.ts"), manifestSource());
    console.log("Wrote static Metro asset manifest.");
  } else {
    console.log("Skipped manifest: generate all four personas before writing it.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
