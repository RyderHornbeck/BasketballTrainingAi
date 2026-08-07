/**
 * Applies the reviewed descriptions for the first 21 alphabetically exported drills.
 * Run: npm run catalog:apply-first-21-descriptions (from supabase/)
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "node:path";
// @ts-expect-error ws is installed for Node 20 Supabase transport but has no local type package.
import WebSocket from "ws";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DESCRIPTION_UPDATES = [
  [
    "0ac5ace9-b3b1-4cbc-a6cb-e695a7197233",
    "Behind the back",
    "Stand in an athletic stance with the ball in your right hand, knees bent. Step 1: Dribble the ball low behind your back from right hand to left hand. Step 2: Take a couple of pound dribbles then dribble the ball low behind your back from left hand to right hand. Step 3: Repeat sequence with a few pound dribbles in between each behind the back.",
  ],
  [
    "86493cc0-d519-4bed-aad2-85d1429742cb",
    "Between both legs",
    "Start at half court in a deep squat with the ball in your right hand. Step 1: Dribble the ball through your legs from right hand to left hand. Step 2: Dribble it back through your legs from left hand to right hand. Step 3: Keep going in a continuous figure-8 pattern without pausing.",
  ],
  [
    "8229b35b-a670-4483-9a86-243254f4c132",
    "Between dribbles",
    "Start in an athletic stance with the ball in your right hand. Step 1: Dribble the ball through your legs, right hand to left hand. Step 2: Then dribble the ball back between the legs the same way it came, without rapping it around your knee to go through your leg. Step 3: Aim to go continously.",
  ],
  [
    "8fec78cb-a40a-4317-a04f-2ae55283d614",
    "Box Dribbling",
    "Start inside a tight box (about 4 feet wide) marked on the floor with the ball in your right hand, in a low stance. Step 1: Dribble to the front-right corner and do a crossover to your left hand. Step 2: Dribble to the back-left corner and go between your legs. Step 3: Dribble to the back-right corner and go behind your back, then repeat the box. Complete 5 full box circuits without leaving the area.",
  ],
  [
    "63f11b14-cf58-4246-ae5d-e08da21cd8f0",
    "BTL Wrap Cross Combo Series",
    "Start with the ball in your right hand in a low athletic stance. Step 1: Dribble between your legs to your left hand. Step 2: Wrap dribble behind your back, back to your right hand. Step 3: Cross the ball to your opposite hand.",
  ],
  [
    "c79783db-26ef-4894-88d8-7c7ba48bfd6e",
    "Chaos 6-Move Freestyle Handle",
    "Start in place with the ball in either hand in a low athletic stance. Step 1: Pick any six dribble moves such as cross, in-and-out, between the legs, behind the back, spin, or hesitation. Step 2: Perform all six moves one after another without stopping. Step 3: Repeat.",
  ],
  [
    "089fcf2e-aea6-439d-b122-6614ae644c29",
    "Combo Front & Side V Dribble",
    "Start in a low stance with the ball in your right hand. Step 1: Do a front V-dribble — bounce the ball in front of you and out to your right side, then back (like a V shape) to your left side. Step 2: Switch to a side V-dribble — bounce it beside your hip out and back. Step 3: Alternate front V and side V without stopping.",
  ],
  [
    "cf120bfa-81a5-420f-82d8-181bb95aef39",
    "Continuous Scissor Dribble",
    "Start in a low stance with the ball in your right hand. Step 1: Dribble the ball through your legs from your right hand to your left. Step 2: Jump in a scissor motion and swap your legs position (make the back leg in front, and the front leg in back). Step 3: Dribble between your legs and repeat.",
  ],
  [
    "15c37aa4-e967-4081-874f-7bffbfa6e7fc",
    "Double Cross Between Legs Combo",
    "Start in a low athletic stance. Step 1: Cross the ball hard to your left hand. Step 2: Cross the ball hard back to your right hand. Step 3: Dribble behind your legs to your left hand. Walk full court and back without picking up the ball. Repeat starting with your left hand.",
  ],
  [
    "459f946f-0ae1-4a10-8478-d37bc259afe6",
    "Drag Hesitation Cross",
    "Start dribbling up the court. Step 1: Dribble fast with your right hand, then do one hard pound dribble on a sudden stop. Step 2: Pause with a hesitation shot fake. Step 3: Explosive cross to your left hand and attack the rim.",
  ],
  [
    "1af9e1b4-8d83-4341-97df-220827194d2f",
    "Dribble Sprints",
    "Start at the baseline with the ball in your right hand. Step 1: Push the ball out in front of you and sprint to half court. Step 2: Keep dribbling at full speed — head up, ball controlled. Step 3: Sprint through the finish line at half court without slowing down, then repeat with left hand.",
  ],
  [
    "627d431e-e672-49e5-ada5-dc45a018c655",
    "Figure 8 Behind the Back",
    "Start in place with the ball in your right hand in a deep athletic stance. Step 1: Figure-8 dribble through your legs (two between the legs). Step 2: On every other rep, add a behind-the-back dribble.",
  ],
  [
    "cfafffb6-5790-46c4-bfce-0ecf0967fbd0",
    "Figure 8 Wraps with Pound",
    "Start at half court in a low stance with the ball in your right hand. Step 1: Wrap the ball in a figure 8 through your legs — right hand to left hand. Step 2: Pound the ball hard once with your right hand. Step 3: Wrap figure 8 again, pound with your left hand, and keep alternating.",
  ],
  [
    "887c45d9-108e-4027-8bf3-4bac5d99755b",
    "Full Body Wraps",
    "Start at half court standing tall with the ball in both hands. Step 1: Wrap the ball around your waist as fast as you can — right to left and back. Step 2: Wrap it around your head in circles. Step 3: Wrap it around your legs in circles without letting it touch the ground. Keep cycling waist, head, and legs.",
  ],
  [
    "fd8ff26b-effb-4711-ac68-415c7bec71c1",
    "Full Court Combo Race",
    "Start at the baseline with the ball in either hand in a low athletic stance. Step 1: Dribble full court down using at least 4 different moves. Step 2: Dribble full court back using at least 4 more different moves. Step 3: Use 8 different moves total with no repeats until all 8 are done.",
  ],
  [
    "61e0e452-a59b-47be-bfb3-d2d2a02487f0",
    "Half Circle Pound Dribbles",
    "Start at half court in an athletic stance with the ball in your right hand. Step 1: Pound the ball hard in a half-circle arc on the floor, from the front of your body to behind your body on the right side, using your right hand. Step 2: Pound the ball back to the front in the same arc, then switch to your left hand and repeat Steps 1–2 on the left side. Step 3: Keep the half-circle smooth and the dribble at waist height.",
  ],
  [
    "0e41b0d3-f07c-439a-9044-943a621fcbc2",
    "Hesi Double Cross Blow-By",
    "Start at the top of the key with the ball in your right hand in a low athletic stance. Step 1: Hesitation dribble to freeze the defender. Step 2: Quick cross to your left hand. Step 3: Quick cross back to your right hand. Step 4: Blow by straight to the rim for a layup or pull-up. Repeat starting with your left hand.",
  ],
  [
    "bdf28554-6c0a-45cb-bfec-68944ecee5ec",
    "In and out",
    "Start at the top of the key with the ball in your right hand in a low stance. Step 1: Do one in-and-out and then a couple of pound dribbles in between. Step 2: If that's too easy, remove the pound dribbles from the drill.",
  ],
  [
    "cd5fc125-00d5-49e0-94b5-ace84f821432",
    "In-Out Cross Behind the Back Chain",
    "Start with the ball in your right hand in a low athletic stance. Step 1: In-and-out dribble to sell the push. Step 2: Explosive cross to your left hand. Step 3: Dribble behind your back back to your right hand.",
  ],
  [
    "aa64e118-201e-455b-b03e-54df58599fed",
    "Jogging with Dribbling",
    "Start by jogging in place. Step 1: Dribble at hip height while keeping your head up. Step 2: Add pound dribbles and other dribble moves while jogging in place until the timer runs out.",
  ],
] as const;

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in supabase/.env");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });

  for (const [id, exerciseName, description] of DESCRIPTION_UPDATES) {
    const { data, error } = await supabase
      .from("exercise_video_clips")
      .update({ description })
      .eq("id", id)
      .eq("exercise_name", exerciseName)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`Could not find expected drill: ${exerciseName}`);
  }

  console.log(`Updated ${DESCRIPTION_UPDATES.length} reviewed drill descriptions.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
