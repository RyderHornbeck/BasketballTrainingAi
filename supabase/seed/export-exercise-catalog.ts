import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import WebSocket from "ws";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_PATH = path.resolve(__dirname, "../../exercise-catalog-review.csv");
const PAGE_SIZE = 1000;
const TEXT_ONLY_VIDEO_ID = "hoopplan-catalog";

const PREFERRED_COLUMNS = [
  "id",
  "active",
  "exercise_name",
  "category",
  "difficulty_level",
  "description",
  "coaching_notes",
  "requires_both_sides",
  "has_real_video",
  "review_video_link",
  "youtube_url",
  "youtube_video_id",
  "start_time",
  "end_time",
  "skill_levels",
  "goals",
  "weaknesses",
  "equipment",
  "positions",
  "source_section",
  "source_order",
  "created_at",
];

function csvValue(value: unknown): string {
  if (value == null) return "";
  const text =
    Array.isArray(value) || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function formatTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in supabase/.env");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as any },
  });
  const rows: Record<string, unknown>[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("exercise_video_clips")
      .select("*")
      .order("category")
      .order("exercise_name")
      .order("difficulty_level")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  const enriched = rows.map((row) => {
    const videoId = typeof row.youtube_video_id === "string" ? row.youtube_video_id : "";
    const hasRealVideo = Boolean(videoId && videoId !== TEXT_ONLY_VIDEO_ID);
    const startSeconds = Number(row.start_seconds ?? 0);
    const { start_seconds, end_seconds, ...reviewRow } = row;
    return {
      ...reviewRow,
      has_real_video: hasRealVideo,
      start_time: formatTimestamp(start_seconds),
      end_time: formatTimestamp(end_seconds),
      review_video_link: hasRealVideo
        ? `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`
        : null,
    };
  });

  const discoveredColumns = [...new Set(enriched.flatMap((row) => Object.keys(row)))];
  const columns = [
    ...PREFERRED_COLUMNS.filter((column) => discoveredColumns.includes(column)),
    ...discoveredColumns.filter((column) => !PREFERRED_COLUMNS.includes(column)).sort(),
  ];
  const csv = [
    columns.map(csvValue).join(","),
    ...enriched.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ].join("\n");

  await writeFile(OUTPUT_PATH, `${csv}\n`, "utf8");
  const videoCount = enriched.filter((row) => row.has_real_video).length;
  const activeCount = enriched.filter((row) => row.active === true).length;
  const activeVideoCount = enriched.filter(
    (row) => row.active === true && row.has_real_video
  ).length;
  console.log(
    `Exported ${enriched.length} drills (${videoCount} video, ${enriched.length - videoCount} text-only; ${activeCount} active: ${activeVideoCount} video and ${activeCount - activeVideoCount} text-only; ${enriched.length - activeCount} inactive) to ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
