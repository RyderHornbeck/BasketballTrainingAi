/**
 * Applies coaching descriptions and bilateral flags to exercise_video_clips.
 * Run: npm run seed:metadata (from supabase/)
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import WebSocket from "ws";
import { EXERCISE_CATALOG_METADATA } from "./exercise-catalog-metadata.ts";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in supabase/.env");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as any },
  });

  const { data: clips, error } = await supabase
    .from("exercise_video_clips")
    .select("id, exercise_name")
    .eq("active", true);

  if (error || !clips) {
    console.error("Failed to load clips:", error?.message);
    process.exit(1);
  }

  let updated = 0;
  let missing = 0;

  for (const clip of clips) {
    const meta = EXERCISE_CATALOG_METADATA[clip.exercise_name];
    if (!meta) {
      console.warn(`  [warn] No metadata for "${clip.exercise_name}"`);
      missing += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from("exercise_video_clips")
      .update({
        description: meta.description,
        coaching_notes: meta.coaching_notes,
        requires_both_sides: meta.requires_both_sides,
      })
      .eq("id", clip.id);

    if (updateError) {
      console.error(`Failed to update ${clip.exercise_name}:`, updateError.message);
      continue;
    }
    updated += 1;
  }

  console.log(`Updated ${updated}/${clips.length} clips. Missing metadata: ${missing}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
