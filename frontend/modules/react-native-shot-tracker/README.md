# react-native-shot-tracker

iOS-only local Core ML shot detection using VisionCamera 5.1.1 and Nitro
Modules 0.36.1. `ShotTracker.process(frame)` is synchronous and must run on
VisionCamera's asynchronous runner thread. It returns `undefined` between
throttled overlay updates and never retains the native Frame.

```tsx
import { useEffect } from "react";
import { scheduleOnRN } from "react-native-worklets";
import {
  Camera,
  useAsyncRunner,
  useFrameOutput,
  type CameraDevice,
} from "react-native-vision-camera";
import {
  ShotTracker,
  type ProcessResult,
} from "react-native-shot-tracker";

function CoachCamera({
  device,
  onTrackerResult,
}: {
  device: CameraDevice;
  onTrackerResult: (result: ProcessResult) => void;
}) {
  const runner = useAsyncRunner();

  useEffect(() => {
    ShotTracker.initialize();
    // Autonomous two-second timeout misses arrive here even if the camera
    // does not produce another process(frame) call.
    ShotTracker.setResultCallback(onTrackerResult);
    ShotTracker.start({
      ballConfidence: 0.5,
      trackRim: true,
      updateFps: 30,
    });
    return () => {
      ShotTracker.stop();
      ShotTracker.setResultCallback(undefined);
    };
  }, [onTrackerResult]);

  const frameOutput = useFrameOutput({
    targetResolution: { width: 1280, height: 720 },
    pixelFormat: "rgb",
    enablePhysicalBufferRotation: true,
    onFrame(frame) {
      "worklet";
      const accepted = runner.runAsync(() => {
        "worklet";
        try {
          const result = ShotTracker.process(frame);
          if (result != null) {
            scheduleOnRN(onTrackerResult, result);
          }
        } finally {
          frame.dispose();
        }
      });
      if (!accepted) {
        // The runner is busy: drop instead of building an inference backlog.
        frame.dispose();
      }
    },
  });

  return <Camera device={device} isActive outputs={[frameOutput]} />;
}
```

Call `ShotTracker.reset()` between sessions when calibration should be
retained. `ShotTracker.stop()` stops inference and clears automatic
calibration. Ordinary reset intentionally preserves the active 450 ms
duplicate cooldown; stop performs the full clear. Manual rim input is
normalized:

```ts
ShotTracker.setManualRim({ x: 0.4, y: 0.35, width: 0.2, height: 0.05 });
ShotTracker.setManualRim(undefined);
```

Only autonomous timer results use `setResultCallback`. Frame-driven updates,
shots, and throttled inference diagnostics are returned from `process(frame)`,
so the same shot ID is never emitted through both paths.

Run the pure-Swift state-machine fixtures without CocoaPods:

```sh
cd ios
swiftc -parse-as-library \
  ShotTrackerStateMachine.swift \
  ShotTrackerAttemptTimer.swift \
  Tests/ShotTrackerFixtureHarness.swift \
  -o /tmp/shot-tracker-fixtures
/tmp/shot-tracker-fixtures
```
