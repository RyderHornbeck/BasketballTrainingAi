export type CatalogCategory =
  | "shooting"
  | "ball_handling"
  | "finishing"
  | "defense"
  | "footwork"
  | "conditioning";

export type CatalogDifficulty = "advanced" | "elite";

export interface AdvancedComboDrill {
  exercise_name: string;
  category: CatalogCategory;
  difficulty_level: CatalogDifficulty;
  description: string;
  coaching_notes: string;
  requires_both_sides: boolean;
  equipment?: string[];
  positions?: string[];
}

/** Text-only pro-style combo drills (no video). Seeded with youtube_video_id = hoopplan-catalog. */
export const ADVANCED_COMBO_DRILLS: AdvancedComboDrill[] = [
  // ── Shooting (15) ──────────────────────────────────────────────────────────
  {
    exercise_name: "Between Legs Cross Into Pull-Up",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start on the right wing with the ball in your right hand. Step 1: Take one setup dribble. Step 2: Dribble between your legs to your left hand. Step 3: Cross the ball hard back to your right hand. Step 4: Gather on two feet at the right elbow and shoot the right-elbow mid-range jumper. Complete the right-side set, then mirror every step to the left elbow.",
    coaching_notes: "Eyes up on the cross, land on two feet square, don't fade away sideways.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Hesitation Cross Step-Back Jumper",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start on the right wing with the ball in your right hand. Step 1: Attack toward the middle and pause with a hesitation dribble. Step 2: Cross the ball back to your right hand. Step 3: Step back behind the right-wing three-point line. Step 4: Shoot the right-wing three. Complete the right-side set, then mirror every step from the left wing.",
    coaching_notes: "Freeze on the hesi with your eyes on the rim, push off the front foot on the step-back.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Rocker Step Into Side Step Three",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start on the right wing behind the three-point line in triple-threat stance with the ball. Step 1: Shot fake by rocking up. Step 2: Drive fake by rocking down. Step 3: Take one dribble toward the middle. Step 4: Side-step back to the right wing and shoot the three. Complete the right-side set, then mirror every step from the left wing.",
    coaching_notes: "Sell both fakes with shoulders, stay tall on the side step, high release.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Rip Through One Dribble Pull-Up",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start on the right wing facing the basket in triple-threat stance. Step 1: Rip the ball low below your knee to your right hand. Step 2: Take one hard dribble to the right elbow. Step 3: Stop on balance and shoot the right-elbow mid-range jumper. Complete the right-side set, then mirror every step to the left elbow.",
    coaching_notes: "Rip tight to the body, chin on shoulder on the gather, straight up on the shot.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Attack Retreat Side Step Three",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start on the right wing behind the three-point line with the ball. Step 1: Drive hard into the paint. Step 2: Take two controlled retreat dribbles back to the right wing. Step 3: Side-step toward the sideline. Step 4: Shoot the right-wing three. Complete the right-side set, then mirror every step from the left wing.",
    coaching_notes: "Retreat stays low and controlled, reload hips before the side step, no leaning back.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Double Cross Into Floater Pull-Up",
    category: "shooting",
    difficulty_level: "elite",
    description:
      "Start at the top of the key with the ball in your right hand. Step 1: Make two quick crossovers. Step 2: Attack the center of the paint with one hard dribble. Step 3: Pick up the ball on your last step. Step 4: Shoot a one-foot floater from the paint. Repeat the same center-paint floater for every rep.",
    coaching_notes: "Ball on a tight string through the crosses, floater off the outside hand with soft touch.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Drift Dribble Into Pull-Up",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start at the top of the key with the ball in your right hand. Step 1: Drift laterally to the right-wing mid-range spot while dribbling. Step 2: Plant both feet without crossing back toward the middle. Step 3: Shoot the right-wing mid-range pull-up. Complete the right-side set, then mirror every step to the left wing.",
    coaching_notes: "Drift at game speed, feet set before lift, shoulders square to the rim.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Pin-Down Curl Catch-and-Shoot",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start under the basket without the ball. Step 1: Sprint a tight curl to the right wing behind the three-point line. Step 2: Spin the ball ahead to the right wing and meet it with your hands ready. Step 3: Use one-two footwork and shoot the right-wing three without dribbling. Complete the right-side set, then mirror every step to the left wing.",
    coaching_notes: "Hands up before the catch, dip into hips, land on two feet on the shot.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Step-Back Side Step Three",
    category: "shooting",
    difficulty_level: "elite",
    description:
      "Start at the top of the key with the ball in your right hand in an athletic stance. Step 1: Take one dribble to the right. Step 2: Hard step-back to create space. Step 3: Take a small side-step to the left. Step 4: Shoot the three. Mirror the moves starting with a left-hand dribble.",
    coaching_notes: "First step-back must be balanced; second step is small and crisp, not a hop.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Relocation Three Off Drive-Kick",
    category: "shooting",
    difficulty_level: "elite",
    description:
      "Start in the right corner behind the three-point line with the ball. Step 1: Simulate a teammate's baseline drive-and-kick by spinning the ball ahead to the right wing. Step 2: Sprint directly to the right wing with your hands ready. Step 3: Catch on balance and shoot the right-wing three. Complete the right-side set, then mirror the drill from the left corner and shoot every rep from the left wing.",
    coaching_notes: "Sprint through the catch, feet down before the ball arrives, no extra dribble.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Snatch Back Cross Pull-Up",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start on the right wing behind the three-point line with the ball. Step 1: Attack middle with two dribbles. Step 2: Snatch the ball back with one hard crossover. Step 3: Step back to the right wing behind the three-point line. Step 4: Shoot the right-wing three. Complete the right-side set, then mirror every step from the left wing.",
    coaching_notes: "Snatch is low and quick, step-back lands balanced, shoot on the way up.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Drag Step-Back Three",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start on the right wing behind the three-point line in triple-threat stance. Step 1: Take one gather dribble and drag your top foot back while pulling the ball into your shooting pocket. Step 2: Rise immediately into the right-wing three. Complete the right-side set, then mirror every step from the left wing.",
    coaching_notes: "Drag step loads the hips, ball to pocket fast, no pause at the top of the shot.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Fake Reject Into Pull-Up",
    category: "shooting",
    difficulty_level: "elite",
    description:
      "Start at the top of the key with the ball in your right hand. Step 1: Dribble toward an imaginary screen on the right. Step 2: Fake the reject, then attack to the right elbow. Step 3: Plant on two feet. Step 4: Shoot the right-elbow mid-range jumper. Complete the right-side set, then mirror every step to the left elbow.",
    coaching_notes: "Sell the reject with eyes and shoulders, plant on two feet, quick release.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Wing Turnaround Fade",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start on the right block with your back to the basket and the ball. Step 1: Take one dribble toward the middle. Step 2: Plant your inside foot and turn over your baseline shoulder. Step 3: Shoot the right-side baseline mid-range fadeaway. Complete the right-side set, then mirror every step from the left block.",
    coaching_notes: "Pivot on the inside foot, fade on a straight line, high release over the hand.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Transition Pull-Up Stop",
    category: "shooting",
    difficulty_level: "advanced",
    description:
      "Start at half court with the ball. Step 1: Dribble full speed down the center of the court. Step 2: Take one hard pound dribble as you reach the top of the key. Step 3: Stop on a dime with a one-two gather. Step 4: Shoot the top-of-key three. Return to half court and repeat the same shot.",
    coaching_notes: "Pound dribble is violent, stop is loud, upper body stays back over feet.",
    requires_both_sides: false,
  },

  // ── Ball handling (16) ───────────────────────────────────────────────────
  {
    exercise_name: "Tween Cross Tween Behind the Back",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at half court or in place with the ball in your right hand in a low athletic stance. Step 1: In-and-out dribble with your right hand. Step 2: Cross the ball to your left hand. Step 3: In-and-out dribble with your left hand. Step 4: Dribble behind your back back to your right hand. Repeat the chain for 30 seconds, then mirror starting with your left hand.",
    coaching_notes: "Pound each move, eyes up, behind-the-back snaps at hip height.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Double Cross Between Legs Combo",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at half court with the ball in your right hand in a low athletic stance. Step 1: Cross the ball hard to your left hand. Step 2: Cross the ball hard back to your right hand. Step 3: Dribble between your legs to your left hand. Walk full court and back without picking up the ball. Repeat starting with your left hand.",
    coaching_notes: "Crosses are low and sharp, BTL stays tight through your stride.",
    requires_both_sides: true,
  },
  {
    exercise_name: "In-Out Cross Behind the Back Chain",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at the top of the key with the ball in your right hand in a low athletic stance. Step 1: In-and-out dribble to sell the push. Step 2: Explosive cross to your left hand. Step 3: Dribble behind your back back to your right hand. Do 20 seconds in place, then 20 seconds moving. Repeat starting with your left hand.",
    coaching_notes: "Sell the in-and-out with wrist and shoulder, cross is violent and low.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Pound Cross Between Behind 4-Move",
    category: "ball_handling",
    difficulty_level: "elite",
    description:
      "Start at the top of the key with the ball in your right hand in a low athletic stance. Step 1: Setup pound dribble. Step 2: Cross the ball to your left hand. Step 3: Dribble between your legs back to your right hand. Step 4: Dribble behind your back to your left hand. Repeat for 30 seconds, then mirror starting with your left hand.",
    coaching_notes: "Don't rush the setup pound; accelerate through the last two moves.",
    requires_both_sides: true,
  },
  {
    exercise_name: "BTL Wrap Cross Combo Series",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at half court with the ball in your right hand in a low athletic stance. Step 1: Dribble between your legs to your left hand. Step 2: Wrap dribble around your front leg. Step 3: Cross the ball to your opposite hand. Walk the arc from half court to each corner. Repeat starting with your left hand.",
    coaching_notes: "Wrap is quick, cross covers ground, stay in athletic stance throughout.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Retreat Dribble Cross Combo",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at the top of the key with the ball in your right hand in a low athletic stance. Step 1: Take two retreat dribbles toward half court. Step 2: Cross the ball hard to your left hand. Step 3: Explode at full speed toward the rim. Repeat starting with your left hand.",
    coaching_notes: "Retreat is controlled, cross is low and hard, eyes up on the re-attack.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Side V-Dribble Cross BTL",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start in place with the ball in your right hand in a low athletic stance. Step 1: V-dribble at the side of your body outside your knee. Step 2: Cross the ball to your left hand. Step 3: Dribble between your legs back to your right hand. Repeat for 30 seconds, then mirror starting with your left hand.",
    coaching_notes: "V-dribble at knee height, don't stand up between moves.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Kill Sequence Cross BTL Spin",
    category: "ball_handling",
    difficulty_level: "elite",
    description:
      "Start at half court with the ball in your right hand in a low athletic stance. Step 1: Cross the ball to your left hand. Step 2: Dribble between your legs back to your right hand. Step 3: Spin move off your inside foot toward open space. Go full court and protect the ball with your body. Repeat starting with your left hand.",
    coaching_notes: "Spin on the inside foot, ball low through the turn, explode out of the spin.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Chaos 6-Move Freestyle Handle",
    category: "ball_handling",
    difficulty_level: "elite",
    description:
      "Start in place with the ball in either hand in a low athletic stance. Step 1: Pick any six dribble moves such as cross, in-and-out, between the legs, behind the back, spin, or hesitation. Step 2: Perform all six moves one after another without stopping. Step 3: Keep going for 45 to 60 seconds without traveling. Change the order of moves each set.",
    coaching_notes: "Stay low, eyes up, push pace each set, no carries.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Offset Cone Tween Cross Series",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at half court with the ball in your right hand in a low athletic stance in front of zigzag cones. Step 1: Weave through the cones using in-and-out and cross moves only. Step 2: Attack the outside shoulder of each cone. Step 3: Plant your foot and explode to the next cone. Never pick up the ball. Repeat weaving from both directions.",
    coaching_notes: "Plant foot points at the next cone, ball stays outside the body on the turn.",
    requires_both_sides: true,
    equipment: ["Basketball", "Cones"],
  },
  {
    exercise_name: "Hesi Double Cross Blow-By",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at the top of the key with the ball in your right hand in a low athletic stance. Step 1: Hesitation dribble to freeze the defender. Step 2: Quick cross to your left hand. Step 3: Quick cross back to your right hand. Step 4: Blow by straight to the rim for a layup or pull-up. Repeat starting with your left hand.",
    coaching_notes: "Hesi sells the drive, crosses are tight, last step is long on the blow-by.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Shuffle Cross BTL Behind Chain",
    category: "ball_handling",
    difficulty_level: "elite",
    description:
      "Start at the top of the key with the ball in your right hand in a low defensive stance. Step 1: Defensive shuffle two steps to the right while dribbling. Step 2: Cross the ball to your left hand. Step 3: Dribble between your legs back to your right hand. Step 4: Dribble behind your back to your left hand and explode forward. Repeat shuffling to both sides.",
    coaching_notes: "Shuffle stays low, chain is continuous, explode after the behind-the-back.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Pound 2 Cross 1 BTL",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at the top of the key with the ball in your right hand in a low athletic stance. Step 1: Two setup pound dribbles at shoulder height. Step 2: One cross to your left hand at knee height. Step 3: One between-the-legs dribble back to your right hand. Repeat for 30 seconds, then change pace slow-fast-slow. Mirror starting with your left hand.",
    coaching_notes: "Pounds are shoulder height, cross and BTL are knee height, eyes on the rim.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Figure 8 Behind the Back",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start in place with the ball in your right hand in a deep athletic stance. Step 1: Figure-8 dribble through your legs. Step 2: On every other rep, add a behind-the-back dribble. Do 45 seconds in place, then walk full court. Repeat starting with your left hand.",
    coaching_notes: "Stay in deep athletic stance, don't watch the ball, snap the behind-the-back.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Drag Hesitation Cross",
    category: "ball_handling",
    difficulty_level: "advanced",
    description:
      "Start at half court with the ball in your right hand in a low athletic stance. Step 1: Drag dribble slow and low with your right hand. Step 2: Pause with a hesitation dribble. Step 3: Explosive cross to your left hand and attack the rim. Walk from half court to the rim twice per hand.",
    coaching_notes: "Drag is patient, hesi freezes, cross is the fastest move in the sequence.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Full Court Combo Race",
    category: "ball_handling",
    difficulty_level: "elite",
    description:
      "Start at the baseline with the ball in either hand in a low athletic stance. Step 1: Dribble full court down using at least 4 different moves. Step 2: Dribble full court back using at least 4 more different moves. Step 3: Use 8 different moves total with no repeats until all 8 are done. Time yourself and repeat.",
    coaching_notes: "Sprint the straightaways, control the turns, no traveling on the corners.",
    requires_both_sides: true,
  },

  // ── Finishing (14) ───────────────────────────────────────────────────────
  {
    exercise_name: "Euro Step Extension Finish",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start on the wing with the ball in an athletic stance. Step 1: Drive full speed toward the middle. Step 2: Take a long first step. Step 3: Take a long second step around the imaginary help defender. Step 4: Finish with your outside hand on the opposite side of the rim. Alternate finishing on right-side and left-side drives.",
    coaching_notes: "Long-long steps, ball high through the euro, finish off the outside hand.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Pro Hop Into Reverse Layup",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start on the wing with the ball in an athletic stance. Step 1: Attack the paint with the ball. Step 2: Two-foot pro hop when you see the rim protector. Step 3: Reverse layup on the opposite side of the rim using the backboard. Repeat from both wings.",
    coaching_notes: "Hop is explosive but balanced, eyes find the window on the reverse.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Scoop Finger Roll Series",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start in the right baseline corner with the ball. Step 1: Take one hard dribble toward the right side of the rim. Step 2: Finish with an underhand finger roll over the imaginary contest. Complete the right-side set, then mirror every step from the left baseline corner.",
    coaching_notes: "High arc, roll off the fingertips, use the backboard on tight angles.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Inside-Outside Shoulder Rip Finish",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start on the wing with the ball in an athletic stance. Step 1: Drive toward the basket. Step 2: Rip the ball low below the defender's hip on the inside. Step 3: Take one dribble. Step 4: Finish with your outside hand on the opposite side. Repeat driving from both wings.",
    coaching_notes: "Rip is below the knee, shoulder through the hip, high finish with extension.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Baseline Reverse Extension Finish",
    category: "finishing",
    difficulty_level: "elite",
    description:
      "Start on the wing with the ball in an athletic stance. Step 1: Attack the baseline. Step 2: Jump stop under the rim when help cuts you off. Step 3: Extend with a long reverse finish on the opposite side with your arm fully extended. Repeat from both wings.",
    coaching_notes: "Jump stop is balanced, extend fully, expect contact on the way up.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Jump Stop Baby Hook Series",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start on the wing with the ball in an athletic stance. Step 1: Drive toward the middle. Step 2: Jump stop at the near-basket circle on two feet. Step 3: Shoot a one-handed baby hook off your inside shoulder. Repeat from both left and right blocks.",
    coaching_notes: "Hook off inside shoulder, soft touch, backboard when available.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Stride Stop Up-and-Under",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start on the block with a catch in an athletic stance. Step 1: Stride stop on two feet. Step 2: Shot fake by showing the ball high. Step 3: Step long and low under the leaping defender. Step 4: Finish with a layup. Repeat on both blocks.",
    coaching_notes: "Sell the fake with eyes and ball, step through is long and low.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Flick Finish Over Length",
    category: "finishing",
    difficulty_level: "elite",
    description:
      "Start in the paint with the ball in an athletic stance. Step 1: One-foot gather against imaginary length. Step 2: High-ball flick finish with your outside hand. Step 3: Release at the peak before the block arrives. Repeat on both sides.",
    coaching_notes: "Release high, soft touch, expect bump on the way up.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Power Finish Two Feet",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start on the right wing with the ball. Step 1: Drive toward the middle. Step 2: Jump stop on two feet inside the restricted area. Step 3: Power through contact and finish with two hands. Complete the right-side set, then mirror the drive from the left wing.",
    coaching_notes: "Wide base on landing, absorb contact, finish high off the glass.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Same Foot Same Hand Floater",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start at the top of the key with the ball in an athletic stance. Step 1: One dribble into the paint. Step 2: Pick up the ball on the same foot you attacked with. Step 3: Shoot a one-foot floater before the big rotates. Repeat on both sides.",
    coaching_notes: "Floater is soft, high arc, release before the second defender lands.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Cradle Reverse Under Rim",
    category: "finishing",
    difficulty_level: "elite",
    description:
      "Start on one side under the rim with the ball in an athletic stance. Step 1: Attack under the rim. Step 2: Cradle the ball with both hands. Step 3: Reverse finish on the other side while absorbing contact. Repeat attacking from both sides.",
    coaching_notes: "Cradle protects the ball, reverse is slow and controlled, use the glass.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Contact Layup Pad Finish",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start on the wing with the ball in an athletic stance. Step 1: Drive toward the basket. Step 2: Imagine bumping the defender's shoulder at the gather. Step 3: Jump off your inside foot and finish through contact with your outside hand. Repeat from both wings.",
    coaching_notes: "Initiate legal contact with shoulder, finish high, expect the bump.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Spin Baseline Finish",
    category: "finishing",
    difficulty_level: "advanced",
    description:
      "Start on the right wing with the ball. Step 1: Drive the right baseline. Step 2: When help cuts you off, plant your inside foot. Step 3: Spin back to the middle and finish a standard layup on the right side of the rim. Complete the right-side set, then mirror every step from the left wing.",
    coaching_notes: "Spin on inside foot, ball protected, explode out of the turn to the rim.",
    requires_both_sides: true,
  },
  {
    exercise_name: "High Glass Tear Drop",
    category: "finishing",
    difficulty_level: "elite",
    description:
      "Start in the lane with the ball in an athletic stance. Step 1: One-foot gather in the paint. Step 2: Shoot a floater with high backboard touch. Step 3: Aim for the top corner of the square so the ball drops through. Repeat from both sides of the lane.",
    coaching_notes: "High arc, hit the top of the square, soft touch off the index finger.",
    requires_both_sides: true,
  },

  // ── Defense (10) ─────────────────────────────────────────────────────────
  {
    exercise_name: "Closeout Contest Mirror Drill",
    category: "defense",
    difficulty_level: "advanced",
    description:
      "Start under the rim in a low defensive stance with no ball. Step 1: Sprint closeout to the imaginary shooter on the wing with high hands. Step 2: Chop your feet on arrival. Step 3: Mirror one dribble middle or baseline without fouling. Step 4: Contest the pull-up shot. Reset after each rep for 30 to 45 second rounds.",
    coaching_notes: "Closeout under control, no hopping, slide on the drive, hand up on the shot.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Ice Pick-and-Roll Defense",
    category: "defense",
    difficulty_level: "advanced",
    description:
      "Start on the ball side of an imaginary side ball screen in a low defensive stance. Step 1: Force the ballhandler baseline. Step 2: Drop step with the imaginary big. Step 3: Keep your weak-side stunt ready on the roll. Walk through 5 times slowly, then 5 at game speed. Repeat on both sides.",
    coaching_notes: "Communicate 'ice' out loud, stunt don't over-help, recover on the pass.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Weak-Side Stunt and Recover",
    category: "defense",
    difficulty_level: "advanced",
    description:
      "Start in help position on the weak side in a low defensive stance. Step 1: On the drive, stunt by stepping toward the ball with high hands. Step 2: Sprint recover to the corner shooter on the kick. Step 3: Close out and contest the three. Repeat from both sides.",
    coaching_notes: "Stunt with high hands, don't leave your feet, close out on the kick.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Full Deny Wing Defense",
    category: "defense",
    difficulty_level: "advanced",
    description:
      "Start on the wing in a low defensive stance with your hand in the passing lane. Step 1: Deny the catch with your butt to the ball. Step 2: Force the catch further out. Step 3: Shuffle with the imaginary cutter. Do 20 seconds, then switch sides.",
    coaching_notes: "Ball-side low stance, active feet, hands up, don't reach-in foul.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Post Front and Quarter",
    category: "defense",
    difficulty_level: "elite",
    description:
      "Start on the ball-side block in a low defensive stance with the ball on the wing. Step 1: Front the post player chest to chest with your hand in the lane. Step 2: When the ball goes above the break, move to three-quarter from the top. Step 3: Keep one hand on the post and one in the passing lane. Walk through both positions 10 times each.",
    coaching_notes: "Communicate with help, dig on the lob, don't let the post catch deep.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Shell Closeout Rotation",
    category: "defense",
    difficulty_level: "advanced",
    description:
      "Start under the rim in a low defensive stance with no ball. Step 1: Sprint closeout to the corner. Step 2: Imagine a pass to the wing and rotate. Step 3: Close out to the wing. Step 4: Imagine a drive, help, and recover. Keep going for 30 to 45 seconds.",
    coaching_notes: "Call 'ball' and 'help' out loud, point on every pass, sprint closeouts.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Drop Coverage Ball Screen",
    category: "defense",
    difficulty_level: "advanced",
    description:
      "Start on the ball side of an imaginary middle pick-and-roll in a low defensive stance. Step 1: Go over the screen. Step 2: Let the big drop to the near-basket circle. Step 3: Trail and recover to contest the pull-up or pass to the roller. Walk 5 reps slowly, then 5 at game speed on each side.",
    coaching_notes: "Fight over the screen, don't die on the reject, communicate with the big.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Weave Defensive Slide",
    category: "defense",
    difficulty_level: "advanced",
    description:
      "Start on the baseline in a low defensive stance with no ball. Step 1: Defensive slide through the lane in a figure-8 or weave pattern. Step 2: Touch each elbow. Step 3: Stay low the whole time. Continue for 30 to 45 seconds.",
    coaching_notes: "Hands up, hips low, don't bounce, push off the outside foot.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Closeout to Contest Corner Three",
    category: "defense",
    difficulty_level: "advanced",
    description:
      "Start at the top of the key in a low defensive stance with no ball. Step 1: Sprint to the corner closeout. Step 2: Arrive with high hands and chop your feet. Step 3: Contest the imaginary three without flying by. Repeat closing out to both corners.",
    coaching_notes: "Sprint then chop, high hands, don't leave your feet on the shot fake.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Dig and Recover Post Help",
    category: "defense",
    difficulty_level: "elite",
    description:
      "Start on the weak side in help position in a low defensive stance. Step 1: On the post catch, dig with a quick step and hand. Step 2: Sprint recover to your man on the kick. Step 3: Find the ball and your man. Repeat from both sides.",
    coaching_notes: "Dig is short and violent, recover with sprint, find the ball and your man.",
    requires_both_sides: true,
  },

  // ── Footwork (8) ─────────────────────────────────────────────────────────
  {
    exercise_name: "Stride Stop Lateral Bound Into Shot",
    category: "footwork",
    difficulty_level: "advanced",
    description:
      "Start at the middle of the court (between the free-throw lines) without the ball in an athletic stance. Step 1: Lateral bound sideways with an explosive push. Step 2: Stride stop on two feet at the free-throw line extended. Step 3: Rise into a pull-up shot. Repeat bounding to both sides.",
    coaching_notes: "Stick the stride stop, knees bent, shoot straight up.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Hip Turn Blast First Step",
    category: "footwork",
    difficulty_level: "advanced",
    description:
      "Start on the wing in triple-threat stance (ready to shoot, pass, or drive) with the ball. Step 1: Hip turn with a jab foot to load the drive. Step 2: Explosive first step toward the middle. Step 3: Reset and explosive first step toward the baseline. Alternate middle and baseline each rep on both wings.",
    coaching_notes: "Hip turn is quick, first step covers maximum ground, stay low.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Pro Agility T-Drill Footwork",
    category: "footwork",
    difficulty_level: "advanced",
    description:
      "Start at the baseline of a T-drill setup in an athletic stance. Step 1: Sprint forward 5 yards. Step 2: Shuffle left 5 yards. Step 3: Shuffle right 10 yards. Step 4: Shuffle left 5 yards. Step 5: Backpedal 5 yards. Touch each line every rep.",
    coaching_notes: "Low hips on shuffles, don't cross feet, touch every line.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Drop Step Rip Through",
    category: "footwork",
    difficulty_level: "advanced",
    description:
      "Start on the block with a post catch in an athletic stance. Step 1: Drop step middle and open your hip to the paint. Step 2: Rip through below the hand. Step 3: One power dribble. Step 4: Finish at the rim. Then drop step baseline with the same sequence. Repeat on both blocks.",
    coaching_notes: "Drop step opens the hip fully, rip is low, power dribble is north-south.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Pivot Series triple-threat stance",
    category: "footwork",
    difficulty_level: "advanced",
    description:
      "Start on the wing with a catch in triple-threat stance (ready to shoot, pass, or drive). Step 1: Front pivot into a jab and first step. Step 2: Reverse pivot into a jab and first step. Step 3: Sweep pivot into a jab and first step. Do 5 reps of each pivot type per side.",
    coaching_notes: "Pivots stay tight, jab sells the drive, don't travel on the sweep.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Lane Line Footwork Sprint",
    category: "footwork",
    difficulty_level: "advanced",
    description:
      "Start on the sideline in an athletic stance. Step 1: Sprint along the sideline. Step 2: Plant at each lane line with a two-foot jump stop. Step 3: Explode to the next line. Go full court down and back.",
    coaching_notes: "Jump stops are loud and balanced, explode out low.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Jab Crossover Footwork",
    category: "footwork",
    difficulty_level: "advanced",
    description:
      "Start on the wing in triple-threat stance (ready to shoot, pass, or drive) with the ball. Step 1: Jab with your opposite foot. Step 2: Crossover step into your first step attack. Step 3: Finish the drive or reset. Do 10 reps each direction from the wing.",
    coaching_notes: "Jab is violent but controlled, crossover step is long, stay low.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Kobe Pivot Fade Footwork",
    category: "footwork",
    difficulty_level: "elite",
    description:
      "Start in the mid-post with a catch in an athletic stance. Step 1: Dribble once. Step 2: Pivot on your inside foot toward the baseline. Step 3: Fadeaway jumper. Repeat on both shoulders.",
    coaching_notes: "Pivot on inside foot, fade on a straight line, high release.",
    requires_both_sides: true,
  },

  // ── Conditioning (8) ─────────────────────────────────────────────────────
  {
    exercise_name: "17s Sprint Conditioning",
    category: "conditioning",
    difficulty_level: "advanced",
    description:
      "Start on one sideline in an athletic stance. Step 1: Sprint sideline to sideline (17 feet). Step 2: Touch the far line. Step 3: Sprint back and touch the start line. Target 4 to 5 seconds per rep. Rest 30 to 60 seconds and repeat 6 to 10 reps.",
    coaching_notes: "Full effort every rep, full recovery between, track your times.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Lane Agility Suicide Progression",
    category: "conditioning",
    difficulty_level: "advanced",
    description:
      "Start at the baseline in an athletic stance. Step 1: Sprint to the near free throw line and back. Step 2: Sprint to the far free throw line and back. Step 3: Sprint to half court and back. Touch every line. Time each set and rest 90 seconds between sets.",
    coaching_notes: "Plant and go at each line, don't round corners, touch every line.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Defensive Slide Conditioning Circuit",
    category: "conditioning",
    difficulty_level: "advanced",
    description:
      "Start on one side of the lane in a low defensive stance. Step 1: Defensive slide across the lane width. Step 2: Touch the sideline. Step 3: Slide back across the lane. Keep going for 30 to 45 second bursts. Rest 60 seconds and do 4 to 6 rounds.",
    coaching_notes: "Stay low the entire rep, hands up, don't hop between slides.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Full-Court Dribble Sprint Intervals",
    category: "conditioning",
    difficulty_level: "elite",
    description:
      "Start at the baseline with the ball in an athletic stance. Step 1: Speed dribble full court down at max pace. Step 2: Speed dribble full court back with controlled handle. Step 3: Walk back to recover. Repeat 6 to 8 intervals.",
    coaching_notes: "Sprint through the finish, handle stays sharp, walk back fully.",
    requires_both_sides: true,
  },
  {
    exercise_name: "Baseline Rebound Outlet Sprint",
    category: "conditioning",
    difficulty_level: "advanced",
    description:
      "Start at the baseline in an athletic stance. Step 1: Touch the backboard or rim. Step 2: Sprint to half court and touch the line. Step 3: Sprint back for an imaginary rebound. Repeat 8 to 10 reps.",
    coaching_notes: "Explode on the first three steps, touch every line, game-speed effort.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Paint Touch Repeat Sprints",
    category: "conditioning",
    difficulty_level: "advanced",
    description:
      "Start at half court in an athletic stance. Step 1: Sprint to touch the near-basket circle. Step 2: Jog back to half court. Step 3: Repeat the sprint and jog back. Do 8 total trips.",
    coaching_notes: "Touch inside the circle, sprint in, jog back, maintain form when tired.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Corner Closeout Sprint Circuit",
    category: "conditioning",
    difficulty_level: "advanced",
    description:
      "Start at the top of the key in an athletic stance. Step 1: Sprint closeout to the corner. Step 2: Defensive slide along the baseline to the other corner. Step 3: Sprint back to the top of the key. Repeat 6 rounds.",
    coaching_notes: "Sprint the closeout, slide low on the baseline, don't stand up.",
    requires_both_sides: false,
  },
  {
    exercise_name: "Transition Lane Fill Sprints",
    category: "conditioning",
    difficulty_level: "elite",
    description:
      "Start at the baseline in an athletic stance. Step 1: Sprint the right lane full court and touch the front rim. Step 2: Walk back to recover. Step 3: Sprint the left lane full court and touch the front rim. Repeat for 6 to 8 total trips.",
    coaching_notes: "Sprint the first three steps every trip, touch the rim, walk back recovery.",
    requires_both_sides: false,
  },
];
