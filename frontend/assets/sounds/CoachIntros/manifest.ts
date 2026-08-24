/* Generated audio lives beside this manifest. See scripts/generate-coach-intros.mjs. */
/* eslint-disable @typescript-eslint/no-require-imports */

import type { CoachPersonaId } from "@/lib/coachProfiles";

export const COACH_INTRO_AUDIO: Record<CoachPersonaId, readonly [number, number, number, number]> = {
  devin: [
    require("./devin/intro-1.mp3"),
    require("./devin/intro-2.mp3"),
    require("./devin/intro-3.mp3"),
    require("./devin/intro-4.mp3"),
  ],
  tyler: [
    require("./tyler/intro-1.mp3"),
    require("./tyler/intro-2.mp3"),
    require("./tyler/intro-3.mp3"),
    require("./tyler/intro-4.mp3"),
  ],
  maya: [
    require("./maya/intro-1.mp3"),
    require("./maya/intro-2.mp3"),
    require("./maya/intro-3.mp3"),
    require("./maya/intro-4.mp3"),
  ],
  ava: [
    require("./ava/intro-1.mp3"),
    require("./ava/intro-2.mp3"),
    require("./ava/intro-3.mp3"),
    require("./ava/intro-4.mp3"),
  ],
};
