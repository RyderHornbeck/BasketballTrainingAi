/**
 * Seeds text-only spot-specific shooting drills into exercise_video_clips.
 * Run: npm run seed:shot-zones (from supabase/)
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import WebSocket from "ws";
import { stripTextAfterFinalStep } from "./catalog-description.ts";
import { SHOT_ZONE_DRILLS } from "./shot-zone-drills-catalog.ts";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CATALOG_VIDEO_ID = "hoopplan-catalog";
const SOURCE_SECTION = "shot-zone-catalog";

function legacyTieredName(name: string): string {
  return `Basic ${name}`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in supabase/.env");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as any },
  });
  const activeNames = new Set(SHOT_ZONE_DRILLS.map((drill) => drill.exercise_name));
  let inserted = 0;
  let updated = 0;

  for (const [index, drill] of SHOT_ZONE_DRILLS.entries()) {
    const row = {
      exercise_name: drill.exercise_name,
      category: drill.category,
      difficulty_level: drill.difficulty_level,
      youtube_url: `https://catalog.hoopplan.app/${slugify(drill.exercise_name)}`,
      youtube_video_id: CATALOG_VIDEO_ID,
      start_seconds: 20000 + index,
      end_seconds: null,
      description: stripTextAfterFinalStep(drill.description),
      coaching_notes: drill.coaching_notes,
      requires_both_sides: drill.requires_both_sides,
      equipment: ["Basketball"],
      positions: ["Guard", "Wing", "Big"],
      skill_levels: ["beginner", "intermediate", "advanced", "elite"],
      source_section: SOURCE_SECTION,
      source_order: index + 1,
      active: true,
    };

    const { data: existing, error: lookupError } = await supabase
      .from("exercise_video_clips")
      .select("id")
      .eq("source_section", SOURCE_SECTION)
      .eq("active", true)
      .in("exercise_name", [drill.exercise_name, legacyTieredName(drill.exercise_name)]);
    if (lookupError) throw lookupError;
    if ((existing?.length ?? 0) > 1) {
      throw new Error(`Multiple active canonical rows found for ${drill.exercise_name}.`);
    }
    const existingRow = existing?.[0];

    if (existingRow?.id) {
      const { error } = await supabase
        .from("exercise_video_clips")
        .update(row)
        .eq("id", existingRow.id);
      if (error) throw error;
      updated += 1;
    } else {
      const { error } = await supabase.from("exercise_video_clips").insert(row);
      if (error) throw error;
      inserted += 1;
    }
  }

  const { data: staleRows, error: staleError } = await supabase
    .from("exercise_video_clips")
    .select("id, exercise_name")
    .eq("source_section", SOURCE_SECTION)
    .eq("active", true);
  if (staleError) throw staleError;

  let deactivated = 0;
  for (const row of staleRows ?? []) {
    if (activeNames.has(row.exercise_name)) continue;
    const { error } = await supabase
      .from("exercise_video_clips")
      .update({ active: false })
      .eq("id", row.id);
    if (error) throw error;
    deactivated += 1;
  }

  console.log(
    `Shot-zone catalog seeded: ${inserted} inserted, ${updated} updated, ${deactivated} deactivated (${SHOT_ZONE_DRILLS.length} active).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
