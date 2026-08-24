import { COACH_INTRO_AUDIO } from "@/assets/sounds/CoachIntros/manifest";
import type { CoachPersonaId } from "@/lib/coachProfiles";
import { useAudioPlayer } from "expo-audio";
import { useCallback, useEffect, useRef } from "react";

const PLAYER_OPTIONS = { keepAudioSessionActive: true } as const;

export function useCoachIntroAudio() {
  const player = useAudioPlayer(null, PLAYER_OPTIONS);
  const nextClipRef = useRef<Record<CoachPersonaId, number>>({
    devin: 0,
    tyler: 0,
    maya: 0,
    ava: 0,
  });
  const playbackVersionRef = useRef(0);

  const stop = useCallback(() => {
    playbackVersionRef.current += 1;
    try {
      player.pause();
      void player.seekTo(0).catch(() => undefined);
    } catch {
      // The player can be released when onboarding unmounts.
    }
  }, [player]);

  const playNext = useCallback(
    (persona: CoachPersonaId) => {
      stop();
      const clipIndex = nextClipRef.current[persona];
      nextClipRef.current[persona] = (clipIndex + 1) % COACH_INTRO_AUDIO[persona].length;
      const version = playbackVersionRef.current;
      try {
        player.replace(COACH_INTRO_AUDIO[persona][clipIndex]);
        void player
          .seekTo(0)
          .then(() => {
            if (playbackVersionRef.current === version) player.play();
          })
          .catch(() => undefined);
      } catch {
        // A missing/unavailable packaged clip should never block selection.
      }
    },
    [player, stop],
  );

  useEffect(() => stop, [stop]);

  return { playNext, stop };
}
