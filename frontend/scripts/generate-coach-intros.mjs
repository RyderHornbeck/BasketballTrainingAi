#!/usr/bin/env node
/**
 * Generates four short, packaged onboarding introductions for each coach.
 *
 * Run from frontend:
 *   INWORLD_API_KEY=... node scripts/generate-coach-intros.mjs --force
 *
 * This script generates bundled MP3 assets once during development. The app
 * never requests a server or TTS provider when onboarding plays these clips.
 */
import { createClient } from "@inworld/tts";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = resolve(ROOT, "assets/sounds/CoachIntros");
const MINIMUM_AUDIO_BYTES = 256;

const COACHES = {
  devin: {
    voice: "Nate",
    lines: [
      "Hey, I'm Devin, your Court Coach. Let's get after it.",
      "Bring the energy — I'll handle the plan.",
      "We'll stay locked in and make every rep count.",
      "Whenever you're ready, let's get to work.",
    ],
  },
  tyler: {
    voice: "Evan",
    lines: [
      "Hey, I'm Tyler, your Court Coach. Let's get focused.",
      "We'll take it one strong rep at a time.",
      "Stay disciplined, trust the work, and I'll guide you through it.",
      "Ready when you are. Let's get started.",
    ],
  },
  maya: {
    voice: "Sarah",
    lines: [
      "Hi, I'm Maya, your Court Coach. I can't wait to train with you.",
      "Let's bring some great energy into this workout.",
      "I'll keep you moving and help you get the most out of every rep.",
      "Whenever you're ready, let's have a great session.",
    ],
  },
  ava: {
    voice: "Zadie",
    lines: [
      "Hi, I'm Ava, your Court Coach. I'm so excited to train with you.",
      "We're gonna make this workout challenging, but fun.",
      "I'll be right there with you every step of the way.",
      "I'm ready when you are. Let's do this.",
    ],
  },
};

const force = process.argv.includes("--force");
const apiKey = process.env.INWORLD_API_KEY?.trim();
if (!apiKey) {
  throw new Error("INWORLD_API_KEY is required to generate Coach introduction clips.");
}
const client = createClient({
  apiKey,
  timeout: 60_000,
  maxRetries: 3,
  maxConcurrentRequests: 2,
});

async function validAudio(path) {
  if (force) return false;
  try {
    return (await stat(path)).size >= MINIMUM_AUDIO_BYTES;
  } catch {
    return false;
  }
}

async function generateClip(path, voice, text) {
  if (await validAudio(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.part.mp3`;
  await unlink(temporaryPath).catch(() => undefined);
  const audio = await client.generate({
    text: text,
    voice,
    model: "inworld-tts-2",
    encoding: "MP3",
    sampleRate: 16_000,
    bitRate: 64_000,
    language: "en-US",
    speakingRate: 1.05,
    deliveryMode: "BALANCED",
  });
  if (audio.byteLength < MINIMUM_AUDIO_BYTES) {
    throw new Error(`Inworld returned invalid introduction audio for "${text}".`);
  }
  await writeFile(temporaryPath, audio);
  await rename(temporaryPath, path);
  return true;
}

let generated = 0;
for (const [persona, coach] of Object.entries(COACHES)) {
  for (const [index, line] of coach.lines.entries()) {
    const path = resolve(OUTPUT_ROOT, persona, `intro-${index + 1}.mp3`);
    if (await generateClip(path, coach.voice, line)) generated += 1;
  }
}

console.log(`Coach introductions complete (${generated} generated with Inworld TTS-2).`);
