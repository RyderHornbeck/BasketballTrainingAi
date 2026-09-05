# Voice + Video Coach device verification

This mode is iOS-only and visible only in development or on the `staging`
updates channel. Set `EXPO_PUBLIC_VIDEO_COACH_ENABLED=0` to disable it without
changing the native build.

Use a physical iPhone and a staging development build. The simulator can
validate compilation and UI layout, but not live camera inference.

## Session and lifecycle

- Start Voice Coach, enter Video Coach, and confirm the same exercise, set,
  timer, transcript, and Coach connection remain active.
- Toggle back to Voice Coach and confirm the camera indicator turns off,
  portrait orientation returns, and spoken make/miss commands work again.
- Background and foreground the app in video mode. Confirm capture and
  inference stop in the background and resume without duplicate shot events.
- Close Video Coach with the X button. Confirm the Coach session ends, camera
  access stops, and the main app returns to portrait.
- Deny camera permission, then grant it from Settings and retry.

## Detection behavior

- Frame the full rim and shooting area with the rear wide-angle camera.
- Confirm only a thin yellow ball box/trajectory and blue rim box appear.
- Test clean makes, rim misses, airballs, dribbles below the rim, pump fakes,
  rebounds, rapid consecutive shots, temporary ball loss, and moving the
  phone/rim out of frame.
- Confirm every real attempt produces exactly one MAKE or MISS and cooldown
  prevents rebound or net motion from producing a second event.
- Confirm the tracker reacquires the ball and stabilized rim after occlusion.
- Confirm people never receive a box and no confidence/FPS/debug labels appear.

## Shared Coach behavior

- During an untimed shooting set, confirm camera MAKE/MISS updates the same
  makes, attempts, persistence, feedback audio, transcript, and set-completion
  behavior as voice input.
- While Coach audio is playing, take a shot and confirm the result follows the
  same interruption path as a spoken make/miss.
- In video mode, say “make” and “miss” and confirm neither changes shot totals.
  Verify timer, navigation, editing, and other voice commands still work.
- During a timed drill, confirm inference and overlays remain active but
  detected shots do not change makes/attempts and do not interrupt or play
  result audio.
- Confirm the top-right metric is the running timer when active and otherwise
  the current set shooting percentage.
