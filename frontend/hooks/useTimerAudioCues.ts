import { useAudioPlayer } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef } from "react";

type TimerCue = "halfway" | "tenSeconds" | "complete";
const TIMER_PLAYER_OPTIONS = { keepAudioSessionActive: true } as const;

interface TimerCueState {
  runId: number | null;
  previousRemaining: number | null;
  fired: Set<TimerCue>;
  playbackVersion: number;
}

function crossedThreshold(previous: number, current: number, threshold: number): boolean {
  return previous > threshold && current <= threshold;
}

export function useTimerAudioCues() {
  const halfwayPlayer = useAudioPlayer(
    require("../assets/sounds/HalfWayThere.mp3"),
    TIMER_PLAYER_OPTIONS
  );
  const tenSecondsPlayer = useAudioPlayer(
    require("../assets/sounds/10SecondsLeft.mp3"),
    TIMER_PLAYER_OPTIONS
  );
  const completePlayer = useAudioPlayer(
    require("../assets/sounds/TimesUp.mp3"),
    TIMER_PLAYER_OPTIONS
  );
  const stateRef = useRef<TimerCueState>({
    runId: null,
    previousRemaining: null,
    fired: new Set(),
    playbackVersion: 0,
  });
  const disposedRef = useRef(false);

  const players = useMemo(
    () => [halfwayPlayer, tenSecondsPlayer, completePlayer],
    [completePlayer, halfwayPlayer, tenSecondsPlayer]
  );

  const stopAll = useCallback(() => {
    stateRef.current.playbackVersion += 1;
    for (const player of players) {
      try {
        player.pause();
        void player.seekTo(0).catch(() => {});
      } catch {
        // The player may already have been released during screen teardown.
      }
    }
  }, [players]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      stopAll();
    };
  }, [stopAll]);

  const beginRun = useCallback((runId: number, durationSeconds: number) => {
    // Do not touch Expo audio players here. Pausing/seeking them while Sonic is
    // announcing the timer can interrupt the shared iOS audio session.
    stateRef.current.runId = runId;
    stateRef.current.previousRemaining = durationSeconds;
    stateRef.current.fired = new Set();
  }, []);

  const pause = useCallback(() => {
    stopAll();
  }, [stopAll]);

  const play = useCallback(
    (cue: TimerCue) => {
      const player =
        cue === "halfway" ? halfwayPlayer : cue === "tenSeconds" ? tenSecondsPlayer : completePlayer;
      const playbackVersion = stateRef.current.playbackVersion;
      try {
        player.pause();
        void player
          .seekTo(0)
          .then(() => {
            if (!disposedRef.current && stateRef.current.playbackVersion === playbackVersion) {
              player.play();
            }
          })
          .catch(() => {});
      } catch {
        // Ignore a cue request after the player has been released.
      }
    },
    [completePlayer, halfwayPlayer, tenSecondsPlayer]
  );

  const sync = useCallback(
    (runId: number, durationSeconds: number | null, remainingSeconds: number, running: boolean) => {
      if (!durationSeconds || durationSeconds <= 0) return;

      const state = stateRef.current;
      if (state.runId !== runId) {
        beginRun(runId, durationSeconds);
      }
      if (!running) {
        state.previousRemaining = remainingSeconds;
        return;
      }

      const previous = state.previousRemaining ?? durationSeconds;
      const current = Math.max(0, remainingSeconds);
      const cues: [TimerCue, number][] = [
        ["halfway", durationSeconds / 2],
        ["tenSeconds", 10],
        ["complete", 0],
      ];

      for (const [cue, threshold] of cues) {
        if (!state.fired.has(cue) && crossedThreshold(previous, current, threshold)) {
          state.fired.add(cue);
          play(cue);
        }
      }
      state.previousRemaining = current;
    },
    [beginRun, play]
  );

  return useMemo(() => ({ beginRun, pause, stopAll, sync }), [beginRun, pause, stopAll, sync]);
}
