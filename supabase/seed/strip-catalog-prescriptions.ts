/**
 * Removes trailing prescription text after the final numbered instruction from
 * every catalog description. Run: npm run catalog:strip-prescriptions
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "node:path";
// @ts-expect-error ws is installed for Node 20 Supabase transport but has no local type package.
import WebSocket from "ws";
import { stripTextAfterFinalStep } from "./catalog-description.ts";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE_SIZE = 1000;

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in supabase/.env");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });
  const { data: rows, error } = await supabase
    .from("exercise_video_clips")
    .select("id, description");
  if (error) throw error;

  const updates = (rows ?? [])
    .filter((row) => typeof row.description === "string")
    .map((row) => ({
      id: row.id,
      before: row.description as string,
      after: stripTextAfterFinalStep(row.description as string),
    }))
    .filter((row) => row.after !== row.before);

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from("exercise_video_clips")
      .update({ description: update.after })
      .eq("id", update.id);
    if (updateError) throw updateError;
  }

  const workoutRows: { id: string; instructions: string | null }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error: workoutError } = await supabase
      .from("workout_exercises")
      .select("id, instructions")
      .range(from, from + PAGE_SIZE - 1);
    if (workoutError) throw workoutError;
    workoutRows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  const workoutUpdates = workoutRows
    .filter((row): row is { id: string; instructions: string } => typeof row.instructions === "string")
    .map((row) => ({
      id: row.id,
      before: row.instructions,
      after: stripTextAfterFinalStep(row.instructions),
    }))
    .filter((row) => row.after !== row.before);

  for (const update of workoutUpdates) {
    const { error: updateError } = await supabase
      .from("workout_exercises")
      .update({ instructions: update.after })
      .eq("id", update.id);
    if (updateError) throw updateError;
  }

  console.log(
    `Removed trailing prescription text from ${updates.length} catalog descriptions and ${workoutUpdates.length} existing workout exercises.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
