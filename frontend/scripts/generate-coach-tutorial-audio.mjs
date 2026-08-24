#!/usr/bin/env node
/**
 * Generates packaged, tutorial-only Coach speech for every persona.
 *
 * Run from frontend:
 *   INWORLD_API_KEY=... node scripts/generate-coach-tutorial-audio.mjs --force
 */
import { createClient } from "@inworld/tts";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = resolve(ROOT, "assets/sounds/CoachTutorial");
const MINIMUM_AUDIO_BYTES = 256;
const force = process.argv.includes("--force");
const apiKey = process.env.INWORLD_API_KEY?.trim();

const lines = [
  "Let's start your tutorial workout by pressing Start Workout.",
  "These are your two exercises for today: Form Shooting and Pound Dribbles.",
  "Hey! Are you ready to start this workout?",
  "Your first exercise is Form Shooting. Your target is two makes out of three attempts.",
  "Form Shooting is all about clean mechanics. Focus on your balance, elbow, and follow-through.",
  "Good job. You hit your target and shot sixty-six percent for Form Shooting. Now you're on Pound Dribbles. Would you like me to start the one-minute timer?",
  "Pound Dribbles complete. You have finished this workout.",
];

const coaches = {
  devin: { voice: "Nate" },
  tyler: { voice: "Evan" },
  maya: { voice: "Sarah" },
  ava: { voice: "Zadie" },
};

if (!apiKey) throw new Error("INWORLD_API_KEY is required to generate tutorial audio.");
const client = createClient({ apiKey, timeout: 60_000, maxRetries: 3, maxConcurrentRequests: 2 });

async function shouldGenerate(path) {
  if (force) return true;
  try {
    return (await stat(path)).size < MINIMUM_AUDIO_BYTES;
  } catch {
    return true;
  }
}

async function generate(path, voice, text) {
  if (!(await shouldGenerate(path))) return false;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.part.mp3`;
  await unlink(temporary).catch(() => undefined);
  const audio = await client.generate({
    text,
    voice,
    model: "inworld-tts-2",
    encoding: "MP3",
    sampleRate: 16_000,
    bitRate: 64_000,
    language: "en-US",
    speakingRate: 1.05,
    deliveryMode: "BALANCED",
  });
  if (audio.byteLength < MINIMUM_AUDIO_BYTES) throw new Error(`Invalid tutorial clip: ${text}`);
  await writeFile(temporary, audio);
  await rename(temporary, path);
  return true;
}

let generated = 0;
for (const [persona, coach] of Object.entries(coaches)) {
  for (const [index, line] of lines.entries()) {
    const path = resolve(OUTPUT_ROOT, persona, `step-${index + 1}.mp3`);
    if (await generate(path, coach.voice, line)) generated += 1;
  }
}
console.log(`Tutorial Coach audio complete (${generated} clips generated).`);
