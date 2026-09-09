import Foundation

private func require(
  _ condition: @autoclosure () -> Bool,
  _ message: String
) {
  guard condition() else {
    FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
    exit(1)
  }
}

private func ball(
  _ centerX: Double,
  _ centerY: Double,
  size: Double = 0.03
) -> STDetection {
  STDetection(
    rect: STRect(
      x: centerX - size / 2,
      y: centerY - size / 2,
      width: size,
      height: size
    ),
    confidence: 0.9,
    label: "ball"
  )
}

private let rim = STRect(x: 0.4, y: 0.4, width: 0.2, height: 0.05)

private final class FakeCancellation: ShotTrackerTimerCancellation {
  private(set) var cancelled = false
  func cancel() { cancelled = true }
}

private func process(
  _ machine: inout ShotTrackerStateMachine,
  _ x: Double?,
  _ y: Double?,
  _ timestamp: Double,
  _ wallTimeMs: Double,
  size: Double = 0.03
) -> STShot? {
  machine.process(
    ball: x.flatMap { value in y.map { ball(value, $0, size: size) } },
    detectedRim: nil,
    timestamp: timestamp,
    wallTimeMs: wallTimeMs
  ).1
}

@main
enum ShotTrackerFixtureHarness {
  static func main() {
    geometryFixtures()
    makeAndCooldownFixture()
    reacquisitionFixture()
    rimOcclusionBridgeFixture()
    visibleTrajectoryReacquisitionFixture()
    missFixture()
    timeoutFixture()
    autonomousTimerFixture()
    resetCooldownFixture()
    manualRimSetterFixture()
    inferenceFailureFixture()
    print("PASS: inner-rim geometry, timer, reset, manual-rim, and inference-loss fixtures")
  }

  private static func geometryFixtures() {
    require(
      ShotTrackerStateMachine.downwardSegmentPassesThroughRim(
        STPoint(x: 0.5, y: 0.3),
        STPoint(x: 0.5, y: 0.55),
        rim
      ),
      "centered downward segment should pass through rim"
    )
    require(
      !ShotTrackerStateMachine.downwardSegmentPassesThroughRim(
        STPoint(x: 0.25, y: 0.3),
        STPoint(x: 0.25, y: 0.55),
        rim
      ),
      "outside segment must not count as a make"
    )
    require(
      !ShotTrackerStateMachine.downwardSegmentPassesThroughRim(
        STPoint(x: 0.5, y: 0.55),
        STPoint(x: 0.5, y: 0.3),
        rim
      ),
      "upward segment must not count as a make"
    )
  }

  private static func makeAndCooldownFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 0.8, 800)
    require(process(&machine, 0.5, 0.3, 1.0, 1_000) == nil, "upward point should arm the attempt")
    let made = process(&machine, 0.5, 0.55, 1.2, 1_200)
    require(made?.result == .make, "a descending trajectory through the inner rim box should make")
    require(!(made?.id.isEmpty ?? true), "shot event ID must be unique and non-empty")

    require(process(&machine, 0.5, 0.3, 1.3, 1_300) == nil, "post-shot lockout should reject above point")
    require(process(&machine, 0.5, 0.55, 1.4, 1_400) == nil, "cooldown should reject duplicate crossing")
  }

  private static func reacquisitionFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 1.8, 1_800)
    _ = process(&machine, 0.5, 0.3, 2.0, 2_000)
    let first = process(&machine, 0.5, 0.55, 2.2, 2_200)
    require(first?.result == .make, "fixture setup should resolve first shot")

    _ = process(&machine, 0.7, 0.7, 3.2, 3_200)
    _ = process(&machine, 0.65, 0.6, 3.3, 3_300)
    _ = process(&machine, 0.6, 0.5, 3.4, 3_400)
    _ = process(&machine, 0.5, 0.3, 3.5, 3_500)
    let second = process(&machine, 0.5, 0.55, 3.7, 3_700)
    require(second?.result == .make, "new upward launch should reacquire after cooldown")
    require(second?.id != first?.id, "each shot must have a distinct event ID")
  }

  private static func rimOcclusionBridgeFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 1.8, 1_800)
    _ = process(&machine, 0.5, 0.3, 2.0, 2_000)
    // Simulate the ball being hidden by the rim/net long enough that there is
    // no normal adjacent detector segment when it reappears.
    _ = process(&machine, nil, nil, 2.3, 2_300)
    let made = process(&machine, 0.5, 0.55, 3.2, 3_200)
    require(
      made?.result == .make,
      "an above-rim point followed by a lower re-acquisition through the inner box should make"
    )
  }

  private static func visibleTrajectoryReacquisitionFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 3.8, 3_800)
    _ = process(&machine, 0.5, 0.3, 4.0, 4_000)
    // The detector misses a little over one second while the visible trail
    // stays connected. The scoring trajectory resets, but this displayed
    // downward segment still crosses the inner box and must make.
    _ = process(&machine, 0.5, 0.402, 4.2, 4_200)
    let made = process(&machine, 0.5, 0.46, 5.4, 5_400)
    require(
      made?.result == .make,
      "a displayed downward inner-rim crossing must score after detector re-acquisition"
    )
  }

  private static func missFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 4.0, 4_000)
    _ = process(&machine, 0.5, 0.3, 4.2, 4_200)
    let missed = process(&machine, 0.75, 0.55, 4.4, 4_400)
    require(missed?.result == .miss, "armed shot outside opening should miss")
  }

  private static func timeoutFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 5.0, 5_000)
    _ = process(&machine, 0.5, 0.3, 5.2, 5_200)
    guard let token = machine.activeAttemptToken else {
      require(false, "upward trajectory should arm timeout")
      return
    }
    require(
      machine.timeoutAttempt(token: token, timestamp: 7.2, wallTimeMs: 7_200)?.result == .miss,
      "two-second attempt timer should resolve a miss"
    )
    require(
      machine.timeoutAttempt(token: token, timestamp: 7.3, wallTimeMs: 7_300) == nil,
      "stale timer token must not emit a duplicate"
    )
  }

  private static func autonomousTimerFixture() {
    var actions: [() -> Void] = []
    var cancellations: [FakeCancellation] = []
    var delays: [TimeInterval] = []
    var fired: [UInt64] = []
    let timer = ShotTrackerAttemptTimer { delay, action in
      delays.append(delay)
      actions.append(action)
      let cancellation = FakeCancellation()
      cancellations.append(cancellation)
      return cancellation
    }

    timer.synchronize(token: 11) { fired.append($0) }
    require(delays == [2], "production timer delay must match TS two-second timeout")
    timer.synchronize(token: 11) { fired.append($0) }
    require(actions.count == 1, "same attempt token must not re-arm timer")

    let staleAction = actions[0]
    timer.synchronize(token: 12) { fired.append($0) }
    require(cancellations[0].cancelled, "new attempt must cancel prior timer")
    staleAction()
    require(fired.isEmpty, "stale timer action must not fire")
    actions[1]()
    require(fired == [12], "current timer must autonomously deliver its token")

    timer.synchronize(token: 13) { fired.append($0) }
    let cancelledAction = actions[2]
    timer.cancel()
    require(cancellations[2].cancelled, "reset or stop must cancel timer")
    cancelledAction()
    require(fired == [12], "cancelled timer must not deliver a result")
  }

  private static func resetCooldownFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 7.8, 7_800)
    _ = process(&machine, 0.5, 0.3, 8.0, 8_000)
    require(
      {
        return process(&machine, 0.5, 0.55, 8.2, 8_200)?.result == .make
      }(),
      "fixture setup should resolve a make"
    )

    machine.reset()
    _ = process(&machine, 0.5, 0.3, 8.3, 8_300)
    require(
      process(&machine, 0.5, 0.55, 8.4, 8_400) == nil,
      "ordinary reset must preserve the TS cooldown"
    )

    machine.reset(clearCalibration: true)
    _ = process(&machine, 0.5, 0.65, 8.45, 8_450)
    _ = process(&machine, 0.5, 0.3, 8.5, 8_500)
    require(
      {
        return process(&machine, 0.5, 0.55, 8.7, 8_700)?.result == .make
      }(),
      "stop/full clear may clear cooldown"
    )
  }

  private static func manualRimSetterFixture() {
    var machine = ShotTrackerStateMachine()
    let initialState = machine.state
    let initialReason = machine.reason
    machine.setManualRim(rim)
    require(
      machine.state == initialState && machine.reason == initialReason,
      "manual setter must not eagerly mutate TS state or reason"
    )
    machine.setManualRim(nil)
    require(
      machine.state == initialState && machine.reason == initialReason,
      "clearing manual rim must remain a raw setter"
    )
  }

  private static func inferenceFailureFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 9.0, 9_000)
    _ = process(&machine, 0.5, 0.3, 9.2, 9_200)
    var shot: STShot?
    for index in 1...9 {
      shot = machine.processInferenceFailure(
        timestamp: 9.2 + Double(index) * 0.25,
        wallTimeMs: 9_200 + Double(index) * 250
      ).1
      if shot != nil { break }
    }
    require(
      shot?.result == .miss,
      "inference failures must traverse the same lost-ball timeout path"
    )
  }

  private static func bounceGrowthMissFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 12.0, 12_000)
    _ = process(&machine, 0.5, 0.3, 12.2, 12_200, size: 0.03)
    _ = process(&machine, 0.5, 0.34, 12.3, 12_300, size: 0.03)
    _ = process(&machine, 0.51, 0.31, 12.4, 12_400, size: 0.03)
    _ = process(&machine, 0.52, 0.30, 12.5, 12_500, size: 0.032)
    let miss = process(&machine, 0.53, 0.29, 12.6, 12_600, size: 0.0345)
    require(
      miss?.result == .miss,
      "a >90-degree descending reversal followed by 15% sustained box growth must lock a miss"
    )
    require(
      process(&machine, 0.5, 0.55, 12.7, 12_700) == nil,
      "bounce-growth miss must not double-count a later rim crossing"
    )
  }

  private static func sideBounceCannotMakeFixture() {
    var machine = ShotTrackerStateMachine()
    machine.setManualRim(rim)
    _ = process(&machine, 0.5, 0.65, 14.0, 14_000)
    _ = process(&machine, 0.5, 0.3, 14.2, 14_200)
    _ = process(&machine, 0.5, 0.405, 14.3, 14_300)
    _ = process(&machine, 0.3, 0.42, 14.4, 14_400)
    let result = process(&machine, 0.25, 0.55, 14.5, 14_500)
    require(
      result?.result == .miss,
      "a ball that enters the top but exits the side must miss without a bottom-opening crossing"
    )
  }
}
