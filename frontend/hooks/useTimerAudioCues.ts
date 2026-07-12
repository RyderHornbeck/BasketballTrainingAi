import { useAudioPlayer } from "expo-audio";
import { useCallback, useMemo, useRef } from "react";

type TimerCue = "halfway" | "tenSeconds" | "complete";

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
  const halfwayPlayer = useAudioPlayer(require("../assets/sounds/HalfWayThere.mp3"));
  const tenSecondsPlayer = useAudioPlayer(require("../assets/sounds/10SecondsLeft.mp3"));
  const completePlayer = useAudioPlayer(require("../assets/sounds/TimesUp.mp3"));
  const stateRef = useRef<TimerCueState>({
    runId: null,
    previousRemaining: null,
    fired: new Set(),
    playbackVersion: 0,
  });

  const players = useMemo(
    () => [halfwayPlayer, tenSecondsPlayer, completePlayer],
    [completePlayer, halfwayPlayer, tenSecondsPlayer]
  );

  const stopAll = useCallback(() => {
    stateRef.current.playbackVersion += 1;
    for (const player of players) {
      player.pause();
      void player.seekTo(0).catch(() => {});
    }
  }, [players]);

  const beginRun = useCallback(
    (runId: number, durationSeconds: number) => {
      stopAll();
      stateRef.current.runId = runId;
      stateRef.current.previousRemaining = durationSeconds;
      stateRef.current.fired = new Set();
    },
    [stopAll]
  );

  const pause = useCallback(() => {
    stopAll();
  }, [stopAll]);

  const play = useCallback(
    (cue: TimerCue) => {
      const player =
        cue === "halfway" ? halfwayPlayer : cue === "tenSeconds" ? tenSecondsPlayer : completePlayer;
      const playbackVersion = stateRef.current.playbackVersion;
      player.pause();
      void player
        .seekTo(0)
        .then(() => {
          if (stateRef.current.playbackVersion === playbackVersion) player.play();
        })
        .catch(() => {});
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
      const cues: Array<[TimerCue, number]> = [
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
