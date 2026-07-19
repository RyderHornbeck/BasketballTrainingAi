import { supabase } from "@/lib/supabase";
import { UserAchievement } from "@/types/database";
import {
  AlienIcon,
  AtomIcon,
  BasketballIcon,
  CalendarCheckIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  CirclesThreePlusIcon,
  ChartBarIcon,
  ClockIcon,
  CrosshairIcon,
  CrosshairSimpleIcon,
  CrownIcon,
  CrownSimpleIcon,
  DetectiveIcon,
  DiamondIcon,
  FireIcon,
  FireExtinguisherIcon,
  FlagCheckeredIcon,
  FootprintsIcon,
  FingerprintIcon,
  GaugeIcon,
  GearSixIcon,
  HandIcon,
  HourglassIcon,
  LightningIcon,
  ListChecksIcon,
  MedalIcon,
  MedalMilitaryIcon,
  MountainsIcon,
  NumberCircleEightIcon,
  NumberCircleNineIcon,
  NumberCircleSevenIcon,
  PercentIcon,
  PersonSimpleRunIcon,
  RocketLaunchIcon,
  ShootingStarIcon,
  SealCheckIcon,
  ShieldIcon,
  StackIcon,
  TargetIcon,
  TimerIcon,
  TrophyIcon,
  ShieldChevronIcon,
  type Icon,
} from "phosphor-react-native";

export type AchievementShape = "circle" | "shield" | "diamond";

export interface AchievementDefinition {
  key: string;
  title: string;
  description: string;
  color: string;
  shape: AchievementShape;
  icon: Icon;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { key: "streak_1", title: "First Flame", description: "Train on your first day.", color: "#F97316", shape: "circle", icon: FireIcon },
  { key: "streak_3", title: "Heating Up", description: "Reach a 3-day training streak.", color: "#FB923C", shape: "circle", icon: RocketLaunchIcon },
  { key: "streak_10", title: "On Fire", description: "Reach a 10-day training streak.", color: "#EF4444", shape: "shield", icon: FireExtinguisherIcon },
  { key: "streak_50", title: "Unbreakable", description: "Reach a 50-day training streak.", color: "#A855F7", shape: "diamond", icon: CrownIcon },
  { key: "streak_100", title: "Century Flame", description: "Reach a 100-day training streak.", color: "#EAB308", shape: "circle", icon: TrophyIcon },
  { key: "workouts_1", title: "Opening Tip", description: "Complete your first workout.", color: "#3B82F6", shape: "shield", icon: BasketballIcon },
  { key: "workouts_5", title: "Starting Five", description: "Complete 5 workouts.", color: "#06B6D4", shape: "shield", icon: CalendarCheckIcon },
  { key: "workouts_10", title: "Double Digits", description: "Complete 10 workouts.", color: "#14B8A6", shape: "diamond", icon: CheckCircleIcon },
  { key: "workouts_25", title: "Quarter Century", description: "Complete 25 workouts.", color: "#22C55E", shape: "circle", icon: SealCheckIcon },
  { key: "workouts_50", title: "Halfway Hero", description: "Complete 50 workouts.", color: "#84CC16", shape: "diamond", icon: FlagCheckeredIcon },
  { key: "workouts_100", title: "Hundred Club", description: "Complete 100 workouts.", color: "#F59E0B", shape: "shield", icon: MedalIcon },
  { key: "minutes_60", title: "Full Hour", description: "Train for 60 total minutes.", color: "#0EA5E9", shape: "diamond", icon: ClockIcon },
  { key: "minutes_300", title: "Five-Hour Grind", description: "Train for 300 total minutes.", color: "#6366F1", shape: "circle", icon: TimerIcon },
  { key: "minutes_1000", title: "Time Investor", description: "Train for 1,000 total minutes.", color: "#8B5CF6", shape: "circle", icon: HourglassIcon },
  { key: "minutes_3000", title: "Gym Resident", description: "Train for 3,000 total minutes.", color: "#D946EF", shape: "shield", icon: MountainsIcon },
  { key: "makes_10", title: "Found the Net", description: "Make 10 logged shots.", color: "#F43F5E", shape: "diamond", icon: TargetIcon },
  { key: "makes_100", title: "Shot Maker", description: "Make 100 logged shots.", color: "#EC4899", shape: "circle", icon: CrosshairIcon },
  { key: "makes_500", title: "Bucket Getter", description: "Make 500 logged shots.", color: "#C026D3", shape: "circle", icon: ChartLineUpIcon },
  { key: "makes_1000", title: "Four-Digit Scorer", description: "Make 1,000 logged shots.", color: "#7C3AED", shape: "shield", icon: ChartBarIcon },
  { key: "makes_2500", title: "Walking Bucket", description: "Make 2,500 logged shots.", color: "#6D28D9", shape: "diamond", icon: ShootingStarIcon },
  { key: "makes_5000", title: "Net Scorcher", description: "Make 5,000 logged shots.", color: "#DB2777", shape: "circle", icon: DiamondIcon },
  { key: "makes_10000", title: "Five-Digit Club", description: "Make 10,000 logged shots.", color: "#B45309", shape: "shield", icon: CrownSimpleIcon },
  { key: "makes_25000", title: "Scoring Machine", description: "Make 25,000 logged shots.", color: "#991B1B", shape: "shield", icon: MedalMilitaryIcon },
  { key: "shooting_25", title: "Pure Shooter", description: "Complete 25 shooting drills.", color: "#EA580C", shape: "diamond", icon: BasketballIcon },
  { key: "handling_25", title: "Ball on a String", description: "Complete 25 ball-handling drills.", color: "#2563EB", shape: "circle", icon: HandIcon },
  { key: "finishing_25", title: "Rim Raider", description: "Complete 25 finishing drills.", color: "#DC2626", shape: "diamond", icon: FootprintsIcon },
  { key: "conditioning_25", title: "Endless Motor", description: "Complete 25 conditioning drills.", color: "#16A34A", shape: "shield", icon: PersonSimpleRunIcon },
  { key: "defense_25", title: "Lockdown", description: "Complete 25 defense drills.", color: "#0284C7", shape: "diamond", icon: ShieldIcon },
  { key: "conditioning_10", title: "Engine Started", description: "Complete 10 conditioning drills.", color: "#65A30D", shape: "circle", icon: LightningIcon },
  { key: "accuracy_70", title: "True Aim", description: "Shoot 70% over at least 100 attempts.", color: "#10B981", shape: "shield", icon: PercentIcon },
  { key: "accuracy_80", title: "Deadeye", description: "Shoot 80% over at least 250 attempts.", color: "#059669", shape: "shield", icon: GaugeIcon },
  { key: "accuracy_85", title: "Sharpshooter", description: "Shoot 85% over at least 500 attempts.", color: "#0D9488", shape: "diamond", icon: CrosshairSimpleIcon },
  { key: "accuracy_90", title: "Laser Focus", description: "Shoot 90% over at least 1,000 attempts.", color: "#0369A1", shape: "circle", icon: AtomIcon },
  { key: "accuracy_95", title: "Nearly Automatic", description: "Shoot 95% over at least 2,500 attempts.", color: "#4338CA", shape: "diamond", icon: FingerprintIcon },
  { key: "full_10", title: "Clean Ten", description: "Fully complete every drill in 10 workouts.", color: "#0891B2", shape: "diamond", icon: ListChecksIcon },
  { key: "full_50", title: "No Drill Left Behind", description: "Fully complete every drill in 50 workouts.", color: "#4F46E5", shape: "circle", icon: StackIcon },
  { key: "all_rounder_20", title: "Complete Player", description: "Complete 20 drills in each core category.", color: "#CA8A04", shape: "diamond", icon: CirclesThreePlusIcon },
  { key: "overall_70", title: "Rising Prospect", description: "Reach a 70 overall skill rating.", color: "#0EA5E9", shape: "diamond", icon: ShieldChevronIcon },
  { key: "overall_80", title: "Impact Player", description: "Reach an 80 overall skill rating.", color: "#8B5CF6", shape: "shield", icon: GearSixIcon },
  { key: "overall_90", title: "All-Star", description: "Reach a 90 overall skill rating.", color: "#EC4899", shape: "circle", icon: AlienIcon },
  { key: "overall_100", title: "Court Legend", description: "Reach a 100 overall skill rating.", color: "#F59E0B", shape: "shield", icon: DetectiveIcon },
];

export async function getUserAchievements(): Promise<UserAchievement[]> {
  const { error: evaluationError } = await supabase.rpc("evaluate_my_achievements");
  if (evaluationError) throw new Error(evaluationError.message);

  const { data, error } = await supabase
    .from("user_achievements")
    .select("*")
    .order("unlocked_at", { ascending: true });
  if (error) throw new Error(error.message);
  const activeKeys = new Set(ACHIEVEMENTS.map((achievement) => achievement.key));
  return ((data as UserAchievement[]) ?? []).filter((achievement) =>
    activeKeys.has(achievement.achievement_key)
  );
}
