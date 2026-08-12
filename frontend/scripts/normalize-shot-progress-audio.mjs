#!/usr/bin/env node
/**
 * Raises every generated shot-progress voice clip to a consistent speech
 * loudness without clipping. Re-running is safe.
 */
import { createRequire } from "node:module";
import { readdir, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");
const root = resolve(import.meta.dirname, "../assets/sounds/ShotProgress");
const concurrency = 4;

async function clips(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return clips(path);
    return entry.name.endsWith(".mp3") ? [path] : [];
  }));
  return nested.flat();
}

function normalize(path) {
  const temporary = path.replace(/\.mp3$/i, ".normalized.mp3");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpeg, [
      "-y",
      "-i", path,
      // Short clips hit peak headroom before loudnorm can raise their
      // perceived level. Apply a real 4x gain, then contain transients with
      // a fast limiter. This is materially louder than a loudnorm-only pass.
      "-af", "volume=4,alimiter=limit=0.8:attack=5:release=50",
      "-ar", "16000",
      "-b:a", "64k",
      temporary,
    ], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", async (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed (${code}) for ${path}`));
        return;
      }
      try {
        await rename(temporary, path);
        resolvePromise();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function main() {
  const files = await clips(root);
  let next = 0;
  let complete = 0;
  async function worker() {
    while (next < files.length) {
      const index = next++;
      await normalize(files[index]);
      complete += 1;
      if (complete % 50 === 0 || complete === files.length) {
        console.log(`${complete}/${files.length} normalized`);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } catch (error) {
    await Promise.all(files.map(async (path) => {
      try {
        await unlink(path.replace(/\.mp3$/i, ".normalized.mp3"));
      } catch {
        // No partial clip was created.
      }
    }));
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
