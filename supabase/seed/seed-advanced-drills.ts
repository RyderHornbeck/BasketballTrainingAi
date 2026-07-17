/**
 * Seeds text-only advanced/elite combo drills into exercise_video_clips.
 * Run: npm run seed:advanced (from supabase/)
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import WebSocket from "ws";
import { ADVANCED_COMBO_DRILLS } from "./advanced-combo-drills-catalog.ts";
import { stripTextAfterFinalStep } from "./catalog-description.ts";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CATALOG_VIDEO_ID = "hoopplan-catalog";
const SOURCE_SECTION = "advanced-combo-catalog";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in supabase/.env");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as any },
  });

  let inserted = 0;
  let updated = 0;
  const activeNames = new Set(ADVANCED_COMBO_DRILLS.map((drill) => drill.exercise_name));

  for (const [index, drill] of ADVANCED_COMBO_DRILLS.entries()) {
    const row = {
      exercise_name: drill.exercise_name,
      category: drill.category,
      difficulty_level: drill.difficulty_level,
      youtube_url: `https://catalog.hoopplan.app/${slugify(drill.exercise_name)}`,
      youtube_video_id: CATALOG_VIDEO_ID,
      start_seconds: 10000 + index,
      end_seconds: null,
      description: stripTextAfterFinalStep(drill.description),
      coaching_notes: drill.coaching_notes,
      requires_both_sides: drill.requires_both_sides,
      equipment: drill.equipment ?? ["Basketball"],
      positions: drill.positions ?? ["Guard", "Wing", "Big"],
      skill_levels: [drill.difficulty_level],
      source_section: SOURCE_SECTION,
      source_order: index + 1,
      active: true,
    };

    const { data: existing, error: lookupError } = await supabase
      .from("exercise_video_clips")
      .select("id")
      .eq("exercise_name", drill.exercise_name)
      .eq("source_section", SOURCE_SECTION)
      .maybeSingle();

    if (lookupError) {
      console.error(`Lookup failed for "${drill.exercise_name}":`, lookupError.message);
      process.exit(1);
    }

    if (existing?.id) {
      const { error } = await supabase
        .from("exercise_video_clips")
        .update(row)
        .eq("id", existing.id);
      if (error) {
        console.error(`Update failed for "${drill.exercise_name}":`, error.message);
        process.exit(1);
      }
      updated += 1;
    } else {
      const { error } = await supabase.from("exercise_video_clips").insert(row);
      if (error) {
        console.error(`Insert failed for "${drill.exercise_name}":`, error.message);
        process.exit(1);
      }
      inserted += 1;
    }
  }

  const { data: staleRows, error: staleError } = await supabase
    .from("exercise_video_clips")
    .select("id, exercise_name")
    .eq("source_section", SOURCE_SECTION)
    .eq("active", true);

  if (staleError) {
    console.error("Failed to load stale catalog rows:", staleError.message);
    process.exit(1);
  }

  let deactivated = 0;
  for (const row of staleRows ?? []) {
    if (activeNames.has(row.exercise_name)) continue;
    const { error } = await supabase
      .from("exercise_video_clips")
      .update({ active: false })
      .eq("id", row.id);
    if (error) {
      console.error(`Deactivate failed for "${row.exercise_name}":`, error.message);
      process.exit(1);
    }
    deactivated += 1;
  }

  console.log(
    `Advanced combo catalog seeded: ${inserted} inserted, ${updated} updated, ${deactivated} deactivated (${ADVANCED_COMBO_DRILLS.length} active).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
