/**
 * import-videos.ts
 * ----------------------------------------------------------------------------
 * Parses `Videos.README` (at the project root) and upserts every exercise
 * clip it finds into the Supabase `exercise_video_clips` table.
 *
 * Run with:   npm run seed:videos   (from the `supabase/` directory)
 *
 * Required environment variables (put them in `supabase/.env`, see
 * `supabase/.env.example`):
 *   SUPABASE_URL               - your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  - the service role key (needed to bypass RLS
 *                                 for writes -- NEVER ship this to the app)
 *
 * ----------------------------------------------------------------------------
 * WHY THIS PARSER IS "FLEXIBLE"
 * ----------------------------------------------------------------------------
 * `Videos.README` is a hand-written, loosely-structured notes file rather
 * than a strict machine format. It generally looks like this (real excerpt):
 *
 *   Ball handling
 *   Beginner
 *   Full Body Wraps
 *   https://www.youtube.com/watch?v=ynkhxHilaKA
 *   2:15-2:45
 *
 *   Pound dribble:https://www.youtube.com/watch?v=CLoWxOvlHkk
 *   1:46-2:00
 *
 *   Intermidate
 *   Popcorn Dribbling
 *   https://www.youtube.com/watch?v=5XqHIyfH1QA
 *   0:26-0:56
 *
 * Rules the parser follows:
 *   1. Blank lines are ignored.
 *   2. A line containing a YouTube URL (optionally with an inline
 *      "Exercise Name:" prefix on the same line) starts/continues a clip.
 *   3. A line that looks like a timestamp range (e.g. "1:25-2:10",
 *      "1:02:30-1:04:00", or even a sloppy "4:01:4:20") closes the
 *      currently-open clip.
 *   4. Any other plain-text line is either:
 *        a) an exercise NAME, if the next non-blank line is a URL, or
 *        b) a SECTION HEADER (category like "Ball handling"/"Shooting
 *           Drill"/"Finishing Drills"/"Defensive Drills", or a difficulty
 *           label like "Beginner"/"Intermidate"/"Medium"/"Harder ...")
 *           otherwise.
 *   5. Difficulty sections are NOT repeated per-clip in the file -- a
 *      difficulty header (e.g. "# Beginner") applies to every clip that
 *      follows it until the next difficulty header appears. This parser
 *      tracks a "current difficulty" while walking the file, exactly like
 *      it tracks a "current category".
 *   6. If a clip truly has no discoverable difficulty (no header seen yet,
 *      and no keyword match), we fall back to inferring it from the clip's
 *      chronological position in the file: earlier clips skew "beginner",
 *      middle clips "intermediate", later clips "advanced"/"elite". This
 *      guarantees `difficulty_level` is almost never left blank.
 *
 * ----------------------------------------------------------------------------
 * OPTIONAL "STRUCTURED" FORMAT (also supported)
 * ----------------------------------------------------------------------------
 * If you would rather write unambiguous entries, this parser also
 * understands a structured, tag-based block format. Any block that starts
 * with a markdown heading (`## Exercise Name`) is parsed with this format
 * instead of the freeform heuristics above:
 *
 *   ## Pound Dribble
 *   Category: ball_handling
 *   URL: https://www.youtube.com/watch?v=abc123
 *   Start: 0:42
 *   End: 1:15
 *   Skill Levels: beginner, intermediate
 *   Goals: improve handles
 *   Weaknesses: weak ball handling
 *   Equipment: basketball
 *   Positions: guard, wing
 *   Description: Stationary pound dribble drill for control.
 *
 * Only `## Name` and `URL:` + a timestamp (`Start:`/`End:` or a bare
 * "1:25-2:10" line) are required; everything else is optional.
 * ----------------------------------------------------------------------------
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import WebSocket from "ws";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const README_PATH =
  process.env.VIDEOS_README_PATH ??
  path.resolve(__dirname, "../../Videos.README");

type Category =
  | "shooting"
  | "ball_handling"
  | "finishing"
  | "defense"
  | "footwork"
  | "conditioning"
  | "strength"
  | "warmup"
  | "cooldown"
  | "mobility"
  | "basketball_iq";

type Difficulty = "beginner" | "intermediate" | "advanced" | "elite";

interface ParsedClip {
  exercise_name: string;
  category: Category;
  difficulty_level: Difficulty | null;
  youtube_url: string;
  youtube_video_id: string;
  start_seconds: number;
  end_seconds: number | null;
  description: string | null;
  coaching_notes: string | null;
  skill_levels: string[] | null;
  goals: string[] | null;
  weaknesses: string[] | null;
  equipment: string[] | null;
  positions: string[] | null;
  source_section: string | null;
  source_order: number;
}

// ----------------------------------------------------------------------------
// Small text helpers
// ----------------------------------------------------------------------------

function cleanName(raw: string): string {
  return raw
    .replace(/[“”"']/g, (m) => (m === "'" ? "'" : "")) // strip curly/smart quotes
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:\-]\s*$/, "") // trailing colon/dash left over from inline "Name: URL" splits
    .trim();
}

const YOUTUBE_REGEX =
  /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]{6,20})[^\s]*/i;

function extractYoutube(
  line: string
): { url: string; videoId: string; prefix: string; suffix: string } | null {
  const match = line.match(YOUTUBE_REGEX);
  if (!match) return null;
  const rawUrl = match[0];
  const idMatch = rawUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  if (!idMatch) return null;
  const videoId = idMatch[1];
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const prefix = line.slice(0, match.index ?? 0);
  const suffix = line.slice((match.index ?? 0) + rawUrl.length);
  return { url: canonicalUrl, videoId, prefix, suffix };
}

const TIME_TOKEN = "\\d{1,2}(?:\\:\\d{1,2}){0,2}(?:\\.\\d+)?";
const TIMESTAMP_DASH_REGEX = new RegExp(
  `^(${TIME_TOKEN})\\s*-\\s*(${TIME_TOKEN})$`
);
/** A line made up only of digits/colons/dots/dashes/spaces, containing a colon. */
const TIMESTAMP_LIKE_REGEX = /^[\d\s:.\-]+$/;

function isNoiseLine(line: string): boolean {
  // Stray page numbers etc: pure digits, no colon, no letters.
  return /^\d+$/.test(line.trim());
}

function looksLikeTimestampLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes(":")) return false;
  return TIMESTAMP_LIKE_REGEX.test(t);
}

function parseTimeToSeconds(token: string): number {
  const parts = token.split(":").map((p) => parseFloat(p));
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else {
    seconds = parts[0];
  }
  return Math.max(0, Math.round(seconds));
}

/**
 * Parses a timestamp line into [startSeconds, endSeconds].
 * Handles the clean "1:25-2:10" format as well as the sloppy
 * colon-separated variant seen in the source file, e.g. "4:01:4:20"
 * (meant as "4:01" - "4:20").
 */
function parseTimestampRange(
  line: string
): { start: number; end: number } | null {
  const t = line.trim();

  const dashMatch = t.match(TIMESTAMP_DASH_REGEX);
  if (dashMatch) {
    return {
      start: parseTimeToSeconds(dashMatch[1]),
      end: parseTimeToSeconds(dashMatch[2]),
    };
  }

  // Fallback: sloppy "H:MM:H:MM" style range with no dash, e.g. "4:01:4:20"
  const tokens = t.split(":").map((tok) => tok.trim()).filter(Boolean);
  if (tokens.length >= 4 && tokens.length % 2 === 0) {
    const mid = tokens.length / 2;
    const startStr = tokens.slice(0, mid).join(":");
    const endStr = tokens.slice(mid).join(":");
    const start = parseTimeToSeconds(startStr);
    const end = parseTimeToSeconds(endStr);
    if (end > start) return { start, end };
  }

  return null;
}

// ----------------------------------------------------------------------------
// Header classification (category vs. difficulty)
// ----------------------------------------------------------------------------

const DIFFICULTY_PATTERNS: Array<[RegExp, Difficulty]> = [
  [/elite|\bpro\b|expert|master/i, "elite"],
  [/advanc|harder|\bhard\b|higher level|higher/i, "advanced"],
  [/interm|medium/i, "intermediate"],
  [/beginn|novice|\beasy\b|basic/i, "beginner"],
];

const CATEGORY_PATTERNS: Array<[RegExp, Category]> = [
  [/ball.?handl|dribbl/i, "ball_handling"],
  [/finish|layup|floater|mikan/i, "finishing"],
  [/shoot/i, "shooting"],
  [/defen/i, "defense"],
  [/footwork/i, "footwork"],
  [/condition|cardio|sprint/i, "conditioning"],
  [/strength|weight|resistance/i, "strength"],
  [/warm.?up/i, "warmup"],
  [/cool.?down|stretch/i, "cooldown"],
  [/mobility/i, "mobility"],
  [/iq|decision/i, "basketball_iq"],
];

function classifyHeader(
  text: string
): { type: "difficulty"; value: Difficulty } | { type: "category"; value: Category } | { type: "unknown" } {
  for (const [regex, value] of DIFFICULTY_PATTERNS) {
    if (regex.test(text)) return { type: "difficulty", value };
  }
  for (const [regex, value] of CATEGORY_PATTERNS) {
    if (regex.test(text)) return { type: "category", value };
  }
  return { type: "unknown" };
}

// ----------------------------------------------------------------------------
// Freeform parser (matches the real Videos.README layout)
// ----------------------------------------------------------------------------

function parseFreeform(raw: string): ParsedClip[] {
  const lines = raw.split(/\r?\n/);

  const clips: ParsedClip[] = [];
  let currentCategory: Category | null = null;
  let currentDifficulty: Difficulty | null = null;
  let currentSection: string | null = null;
  let sourceOrder = 0;

  let pendingName: string | null = null;
  let pendingUrl: string | null = null;
  let pendingVideoId: string | null = null;
  let awaitingTimestamp = false;

  function finalizePendingWithoutTimestamp() {
    if (!awaitingTimestamp || !pendingUrl || !pendingVideoId) return;
    console.warn(
      `  [warn] No timestamp found for "${pendingName ?? "Untitled Exercise"}" (${pendingUrl}); defaulting start=0.`
    );
    pushClip(pendingName ?? "Untitled Exercise", pendingUrl, pendingVideoId, 0, null);
    pendingName = null;
    pendingUrl = null;
    pendingVideoId = null;
    awaitingTimestamp = false;
  }

  function pushClip(
    name: string,
    url: string,
    videoId: string,
    start: number,
    end: number | null
  ) {
    clips.push({
      exercise_name: cleanName(name) || "Untitled Exercise",
      category: currentCategory ?? "ball_handling",
      difficulty_level: currentDifficulty,
      youtube_url: url,
      youtube_video_id: videoId,
      start_seconds: start,
      end_seconds: end,
      description: null,
      coaching_notes: null,
      skill_levels: null,
      goals: null,
      weaknesses: null,
      equipment: null,
      positions: null,
      source_section: currentSection,
      source_order: sourceOrder++,
    });
  }

  // Pre-compute the next non-blank, non-noise line index for lookahead.
  function nextContentLine(fromIdx: number): string | null {
    for (let i = fromIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.length === 0) continue;
      if (isNoiseLine(t)) continue;
      return t;
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw_line = lines[i];
    const line = raw_line.trim();
    if (line.length === 0) continue;
    if (isNoiseLine(line)) continue;

    const yt = extractYoutube(line);
    if (yt) {
      const inlineName = cleanName(yt.prefix);
      if (inlineName) {
        pendingName = inlineName;
      }
      pendingUrl = yt.url;
      pendingVideoId = yt.videoId;
      awaitingTimestamp = true;
      continue;
    }

    if (looksLikeTimestampLine(line)) {
      const range = parseTimestampRange(line);
      if (awaitingTimestamp && pendingUrl && pendingVideoId && range) {
        pushClip(
          pendingName ?? "Untitled Exercise",
          pendingUrl,
          pendingVideoId,
          range.start,
          range.end
        );
        pendingName = null;
        pendingUrl = null;
        pendingVideoId = null;
        awaitingTimestamp = false;
      } else {
        console.warn(`  [warn] Ignoring orphan timestamp line: "${line}"`);
      }
      continue;
    }

    // Plain text line: either a new clip name, or a section header.
    // If we were awaiting a timestamp for a previous clip and hit a new
    // text line instead, that previous clip simply had no timestamp.
    finalizePendingWithoutTimestamp();

    const next = nextContentLine(i);
    const nextIsUrl = next ? extractYoutube(next) !== null : false;

    if (nextIsUrl) {
      pendingName = cleanName(line);
    } else {
      const classification = classifyHeader(line);
      currentSection = line;
      if (classification.type === "difficulty") {
        currentDifficulty = classification.value;
      } else if (classification.type === "category") {
        // Only reset difficulty tracking when we're actually switching to a
        // *different* top-level category. A sub-heading that merely
        // re-mentions the current category (e.g. "Kyrie Finishing Drills"
        // while already under "Finishing Drills") should not wipe out the
        // difficulty carried over from the previous sub-section.
        if (classification.value !== currentCategory) {
          currentDifficulty = null;
        }
        currentCategory = classification.value;
      }
      // "unknown" headers (e.g. "Kyrie Finishing Drills") intentionally
      // leave currentCategory/currentDifficulty untouched so clips inherit
      // whatever was most recently established.
    }
  }

  finalizePendingWithoutTimestamp();

  return clips;
}

// ----------------------------------------------------------------------------
// Structured "## Name" + "Key: value" parser
// ----------------------------------------------------------------------------

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean);
}

function parseStructured(raw: string): ParsedClip[] {
  const blocks = raw.split(/\n(?=##\s)/g);
  const clips: ParsedClip[] = [];
  let sourceOrder = 0;

  for (const block of blocks) {
    const headingMatch = block.match(/^##\s+(.+)$/m);
    if (!headingMatch) continue;
    const name = cleanName(headingMatch[1]);

    const getField = (key: string): string | null => {
      const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im");
      const m = block.match(re);
      return m ? m[1].trim() : null;
    };

    const urlField = getField("URL");
    if (!urlField) continue;
    const yt = extractYoutube(urlField);
    if (!yt) continue;

    const startField = getField("Start");
    const endField = getField("End");
    const rangeField = block.match(
      new RegExp(`(${TIME_TOKEN}\\s*-\\s*${TIME_TOKEN})`)
    );

    let start = 0;
    let end: number | null = null;
    if (startField) start = parseTimeToSeconds(startField);
    if (endField) end = parseTimeToSeconds(endField);
    if (!startField && rangeField) {
      const range = parseTimestampRange(rangeField[1]);
      if (range) {
        start = range.start;
        end = range.end;
      }
    }

    const categoryField = getField("Category");
    const difficultyField = getField("Difficulty") ?? getField("Skill Level");

    clips.push({
      exercise_name: name,
      category: (categoryField?.toLowerCase().replace(/\s+/g, "_") as Category) ?? "ball_handling",
      difficulty_level: (difficultyField?.toLowerCase() as Difficulty) ?? null,
      youtube_url: yt.url,
      youtube_video_id: yt.videoId,
      start_seconds: start,
      end_seconds: end,
      description: getField("Description"),
      coaching_notes: getField("Coaching Notes"),
      skill_levels: getField("Skill Levels") ? splitTags(getField("Skill Levels")!) : null,
      goals: getField("Goals") ? splitTags(getField("Goals")!) : null,
      weaknesses: getField("Weaknesses") ? splitTags(getField("Weaknesses")!) : null,
      equipment: getField("Equipment") ? splitTags(getField("Equipment")!) : null,
      positions: getField("Positions") ? splitTags(getField("Positions")!) : null,
      source_section: "structured",
      source_order: sourceOrder++,
    });
  }

  return clips;
}

// ----------------------------------------------------------------------------
// Chronological difficulty inference fallback
// ----------------------------------------------------------------------------

function inferMissingDifficulties(clips: ParsedClip[]): void {
  const total = clips.length;
  if (total === 0) return;
  clips.forEach((clip, idx) => {
    if (clip.difficulty_level) return;
    const ratio = idx / total;
    if (ratio < 0.33) clip.difficulty_level = "beginner";
    else if (ratio < 0.66) clip.difficulty_level = "intermediate";
    else if (ratio < 0.9) clip.difficulty_level = "advanced";
    else clip.difficulty_level = "elite";
  });
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy supabase/.env.example to supabase/.env and fill it in."
    );
    process.exit(1);
  }

  if (!fs.existsSync(README_PATH)) {
    console.error(`Could not find Videos.README at ${README_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(README_PATH, "utf-8");
  const usesStructuredFormat = /^##\s/m.test(raw);

  console.log(
    `Parsing Videos.README using the ${usesStructuredFormat ? "structured (## headings)" : "freeform"} parser...`
  );

  const clips = usesStructuredFormat ? parseStructured(raw) : parseFreeform(raw);
  inferMissingDifficulties(clips);

  if (clips.length === 0) {
    console.warn("No clips were parsed. Nothing to import.");
    return;
  }

  console.log(`Parsed ${clips.length} clips. Upserting into Supabase...`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket as any },
  });

  const chunkSize = 100;
  let upserted = 0;
  for (let i = 0; i < clips.length; i += chunkSize) {
    const chunk = clips.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from("exercise_video_clips")
      .upsert(chunk, {
        onConflict: "youtube_video_id,start_seconds,exercise_name",
        count: "exact",
      });

    if (error) {
      console.error("Failed to upsert chunk:", error.message);
      process.exitCode = 1;
      continue;
    }
    upserted += count ?? chunk.length;
    console.log(`  Upserted ${Math.min(i + chunkSize, clips.length)}/${clips.length}`);
  }

  console.log(`Done. Upserted ~${upserted} exercise video clips.`);

  const byDifficulty: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const c of clips) {
    byDifficulty[c.difficulty_level ?? "unknown"] = (byDifficulty[c.difficulty_level ?? "unknown"] ?? 0) + 1;
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
  }
  console.log("By difficulty:", byDifficulty);
  console.log("By category:", byCategory);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
