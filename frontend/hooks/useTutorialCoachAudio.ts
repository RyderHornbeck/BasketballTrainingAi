import { COACH_TUTORIAL_AUDIO, TutorialAudioStep } from "@/assets/sounds/CoachTutorial/manifest";
import type { CoachPersonaId } from "@/lib/coachProfiles";
import { useAudioPlayer } from "expo-audio";
import { useCallback, useEffect } from "react";

const PLAYER_OPTIONS = { keepAudioSessionActive: false } as const;

export function useTutorialCoachAudio() {
  const player = useAudioPlayer(null, PLAYER_OPTIONS);

  const stop = useCallback(() => {
    try {
      player.pause();
      void player.seekTo(0).catch(() => undefined);
    } catch {
      // The tutorial can unmount while native audio is releasing.
    }
  }, [player]);

  const play = useCallback(
    (persona: CoachPersonaId, step: TutorialAudioStep) => {
      stop();
      try {
        player.replace(COACH_TUTORIAL_AUDIO[persona][step - 1]);
        void player.seekTo(0).then(() => player.play()).catch(() => undefined);
      } catch {
        // Text remains visible if a packaged clip cannot be loaded.
      }
    },
    [player, stop],
  );

  useEffect(() => stop, [stop]);
  return { play, stop };
}
