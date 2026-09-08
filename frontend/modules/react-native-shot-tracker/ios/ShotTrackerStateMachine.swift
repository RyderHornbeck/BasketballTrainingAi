import Foundation

struct STRect: Equatable {
  var x: Double
  var y: Double
  var width: Double
  var height: Double

  var center: STPoint { STPoint(x: x + width / 2, y: y + height / 2) }
}

struct STPoint: Equatable {
  var x: Double
  var y: Double
}

struct STDetection: Equatable {
  var rect: STRect
  var confidence: Double
  var label: String
}

enum STResult: String {
  case make
  case miss
}

enum STState: String {
  case unconfigured = "UNCONFIGURED"
  case idle = "IDLE"
  case approaching = "APPROACHING"
  case aboveRim = "ABOVE_RIM"
  case rimInteraction = "RIM_INTERACTION"
  case cooldown = "COOLDOWN"
}

struct STShot {
  let id: String
  let result: STResult
  let timestamp: Double
  let reason: String
}

struct STSnapshot {
  let timestamp: Double
  let state: STState
  let reason: String
  let ball: STDetection?
  let detectedRim: STDetection?
  let activeRim: STRect?
  let autoRim: Bool
  let stableRimFrames: Int
  let trajectory: [STPoint]
}

private struct STObservedPoint {
  var x: Double
  var y: Double
  var timestamp: Double
}

private struct STTrack {
  var x: Double
  var y: Double
  var vx: Double
  var vy: Double
  var width: Double
  var height: Double
  var observedX: Double
  var observedY: Double
  var timestamp: Double
  var misses: Int
}

private struct STPendingMake {
  var timestamp: Double
}

private struct STSizeGrowthCandidate {
  var startedAt: Double
  var baselineSize: Double
  var previousSize: Double
  var observations: Int
  var growthSteps: Int
  var maximumSize: Double
}

/// Pure-Swift port of `useManualRimBallTracker` at source commit
/// 0901b6e3cbce1aafd75e2066db5f00ccd8d7d592.
struct ShotTrackerStateMachine {
  private let maxLostFrames = 7
  private let cooldownMs = 450.0
  private let attemptTimeoutSeconds = 2.0
  private let postShotResetSeconds = 0.8
  private let postShotMaxLockoutMs = 2_500.0
  private let bounceOverrideSeconds = 0.4
  private let bounceGrowthWindowSeconds = 0.5
  private let bounceGrowthRatio = 1.25
  private let rimStableFramesRequired = 5
  private let rimSmoothing = 0.3
  private let rimWidthScale = 1.3

  private(set) var state: STState = .unconfigured
  private(set) var reason = "Set the rim box to arm tracking."
  private var manualRim: STRect?
  private var autoRim: STRect?
  private var lastRimCandidate: STRect?
  private var stableRimFrames = 0
  private var track: STTrack?
  private var attemptStartedAt = 0.0
  private var attemptGeneration: UInt64 = 0
  private var cooldownUntilMs = 0.0
  private var crossedRim = false
  private var pendingMake: STPendingMake?
  private var attemptWasAboveRim = false
  private var attemptWasDescending = false
  private var previousAttemptMotion: STPoint?
  private var sizeGrowthCandidate: STSizeGrowthCandidate?
  private var bounceReversalSeen = false
  private var lastObservedBall: STObservedPoint?
  private var lastAboveRimBall: STObservedPoint?
  private var trajectory: [STPoint] = []
  private var displayTrajectory: [STObservedPoint] = []
  private var lastDisplayBall: STObservedPoint?
  private var resetReady = true
  private var resetClearSince = 0.0
  private var postShotResetStartedAtMs = 0.0
  private var resetPreviousBall: STObservedPoint?
  private var resetUpwardStreak = 0
  private var upwardStreak = 0

  var activeRim: STRect? { autoRim ?? manualRim }
  var activeAttemptToken: UInt64? {
    attemptStartedAt == 0 ? nil : attemptGeneration
  }

  mutating func setManualRim(_ rim: STRect?) {
    manualRim = rim
  }

  mutating func reset(clearCalibration: Bool = false) {
    attemptGeneration &+= 1
    track = nil
    lastObservedBall = nil
    lastAboveRimBall = nil
    trajectory = []
    displayTrajectory = []
    lastDisplayBall = nil
    attemptStartedAt = 0
    crossedRim = false
    pendingMake = nil
    attemptWasAboveRim = false
    attemptWasDescending = false
    previousAttemptMotion = nil
    sizeGrowthCandidate = nil
    bounceReversalSeen = false
    resetReady = true
    resetClearSince = 0
    postShotResetStartedAtMs = 0
    resetPreviousBall = nil
    resetUpwardStreak = 0
    upwardStreak = 0
    if clearCalibration {
      cooldownUntilMs = 0
      autoRim = nil
      lastRimCandidate = nil
      stableRimFrames = 0
    }
    state = activeRim == nil ? .unconfigured : .idle
    reason = activeRim == nil
      ? "Waiting for an automatic rim calibration or manual rim box."
      : "Tracker reset."
  }

  mutating func timeoutAttempt(
    token: UInt64,
    timestamp: Double,
    wallTimeMs: Double
  ) -> STShot? {
    guard attemptStartedAt != 0, token == attemptGeneration else { return nil }
    if pendingMake != nil {
      return resolveShot(
        .make,
        "Ball entered and exited the detected rim opening on a downward trajectory.",
        timestamp,
        wallTimeMs
      )
    }
    return resolveShot(
      .miss,
      "Ball reached the rim-height attempt zone without a confirmed rim intersection.",
      timestamp,
      wallTimeMs
    )
  }

  mutating func process(
    ball: STDetection?,
    detectedRim: STDetection?,
    timestamp: Double,
    wallTimeMs: Double
  ) -> (STSnapshot, STShot?) {
    updateDisplayTrajectory(ball: ball, timestamp: timestamp)
    updateAutomaticRim(detectedRim)

    guard let rim = activeRim else {
      return (snapshot(timestamp, ball, detectedRim), nil)
    }

    guard let ball else {
      let shot = processLost(rim: rim, timestamp: timestamp, wallTimeMs: wallTimeMs)
      return (snapshot(timestamp, nil, detectedRim), shot)
    }

    let measurement = STObservedPoint(
      x: ball.rect.center.x,
      y: ball.rect.center.y,
      timestamp: timestamp
    )
    let observedPrevious = lastObservedBall
    let rimCenterX = rim.center.x

    if !resetReady {
      let clearOfPreviousShot =
        measurement.y > rim.y + rim.height * 3.5 ||
        Swift.abs(measurement.x - rimCenterX) > rim.width * 3
      let newUpwardLaunch = resetPreviousBall.map {
        timestamp - $0.timestamp <= 0.6 &&
        measurement.y < $0.y - max(ball.rect.height * 0.12, rim.height * 0.12)
      } ?? false
      resetUpwardStreak = newUpwardLaunch ? resetUpwardStreak + 1 : 0
      resetPreviousBall = measurement
      if clearOfPreviousShot {
        if resetClearSince == 0 { resetClearSince = timestamp }
        if timestamp - resetClearSince >= postShotResetSeconds {
          resetReady = true
          reason = "Ball cleared the post-shot reset zone; ready for a new attempt."
        }
      } else {
        resetClearSince = 0
      }
      if !resetReady &&
          wallTimeMs - postShotResetStartedAtMs >= cooldownMs &&
          resetUpwardStreak >= 2 {
        resetReady = true
        reason = "A new upward launch was detected after the prior result; ready for a new attempt."
      }
      if !resetReady && wallTimeMs - postShotResetStartedAtMs >= postShotMaxLockoutMs {
        resetReady = true
        reason = "Post-shot duplicate lockout expired; ready for a new attempt."
      }
      if !resetReady {
        return (snapshot(timestamp, ball, detectedRim), nil)
      }
      resetClearSince = 0
      resetPreviousBall = nil
      resetUpwardStreak = 0
    }

    let risingEnough = observedPrevious.map {
      timestamp - $0.timestamp <= 0.6 &&
      measurement.y < $0.y - max(ball.rect.height * 0.1, rim.height * 0.1) &&
      Swift.abs(measurement.x - rimCenterX) < rim.width * 3.5
    } ?? false
    upwardStreak = risingEnough ? upwardStreak + 1 : 0
    let trajectoryPrevious = observedPrevious.flatMap {
      timestamp - $0.timestamp <= 1 ? trajectory.last : nil
    }
    let observationGap = observedPrevious.map { timestamp - $0.timestamp } ?? .infinity
    let observationJump = observedPrevious.map {
      hypot(measurement.x - $0.x, measurement.y - $0.y)
    } ?? 0
    let maxContinuousJump = max(rim.width * 12, 0.45)
    if observedPrevious != nil && observationGap < 0.35 && observationJump > maxContinuousJump {
      track = nil
      lastAboveRimBall = nil
      lastObservedBall = measurement
      trajectory = [STPoint(x: measurement.x, y: measurement.y)]
      reason = "Ignored an implausible ball-position jump and restarted the trajectory."
      return (snapshot(timestamp, ball, detectedRim), nil)
    }
    if observedPrevious == nil || observationGap > 1 { trajectory = [] }
    trajectory.append(STPoint(x: measurement.x, y: measurement.y))
    trajectory = Array(trajectory.suffix(20))
    lastObservedBall = measurement

    let previous = track
    let dt = previous.map { max(1.0 / 60, min(0.25, timestamp - $0.timestamp)) } ?? 1.0 / 30
    let predictedX = previous.map { $0.x + $0.vx * dt } ?? measurement.x
    let predictedY = previous.map { $0.y + $0.vy * dt } ?? measurement.y
    let residualX = measurement.x - predictedX
    let residualY = measurement.y - predictedY
    let gate = max(max(rim.width, rim.height) * 16, 0.35)
    let resetFilter = previous != nil && hypot(residualX, residualY) > gate
    let baseX = resetFilter ? measurement.x : predictedX
    let baseY = resetFilter ? measurement.y : predictedY
    let baseResidualX = measurement.x - baseX
    let baseResidualY = measurement.y - baseY
    let next = STTrack(
      x: baseX + 0.62 * baseResidualX,
      y: baseY + 0.62 * baseResidualY,
      vx: resetFilter ? 0 : (previous?.vx ?? 0) + (0.22 * baseResidualX) / dt,
      vy: resetFilter ? 0 : (previous?.vy ?? 0) + (0.22 * baseResidualY) / dt,
      width: ball.rect.width,
      height: ball.rect.height,
      observedX: measurement.x,
      observedY: measurement.y,
      timestamp: timestamp,
      misses: 0
    )
    track = next
    let trackedBall = STDetection(
      rect: STRect(
        x: next.x - ball.rect.width / 2,
        y: next.y - ball.rect.height / 2,
        width: ball.rect.width,
        height: ball.rect.height
      ),
      confidence: ball.confidence,
      label: ball.label
    )

    let rimReady = manualRim != nil || (autoRim != nil && stableRimFrames >= rimStableFramesRequired)
    guard rimReady else {
      if state != .unconfigured { state = .unconfigured }
      reason = "Waiting for rim stabilization (\(stableRimFrames)/\(rimStableFramesRequired) frames)."
      return (snapshot(timestamp, trackedBall, detectedRim), nil)
    }
    guard wallTimeMs >= cooldownUntilMs else {
      return (snapshot(timestamp, trackedBall, detectedRim), nil)
    }

    let activeState = state
    let innerLeft = rim.x + rim.width * 0.1
    let innerRight = rim.x + rim.width * 0.9
    let rimPlane = rim.y + rim.height * 0.5
    let above = next.y < rimPlane
    let insideOpening = next.x >= innerLeft && next.x <= innerRight
    let nearRim =
      next.x >= rim.x - rim.width && next.x <= rim.x + rim.width * 2 &&
      next.y >= rim.y - rim.height * 2 && next.y <= rim.y + rim.height * 3
    let approachZone =
      next.x >= rim.x - rim.width * 2.5 && next.x <= rim.x + rim.width * 3.5 &&
      next.y >= rim.y - rim.height * 5 && next.y <= rim.y + rim.height * 4
    let observedCrossesDownward = observedPrevious.map {
      timestamp - $0.timestamp <= 1.5 && $0.y < rimPlane && measurement.y >= rimPlane
    } ?? false
    let crossingProgress = observedCrossesDownward
      ? (rimPlane - (observedPrevious?.y ?? rimPlane)) /
        max(0.0001, measurement.y - (observedPrevious?.y ?? measurement.y))
      : 0
    let crossingX = observedCrossesDownward
      ? (observedPrevious?.x ?? measurement.x) +
        (measurement.x - (observedPrevious?.x ?? measurement.x)) * crossingProgress
      : measurement.x
    let crossesOpening = crossingX >= innerLeft && crossingX <= innerRight
    let crossingNearRim = crossingX >= rim.x - rim.width && crossingX <= rim.x + rim.width * 2
    // A nearby ball can look vertically above the hoop in normalized camera
    // coordinates. Do not let its oversized detector box arm a shot attempt.
    let ballArea = ball.rect.width * ball.rect.height
    let rimArea = rim.width * rim.height
    let eligibleAttemptBall = ballArea < rimArea * 2

    if attemptStartedAt == 0 && eligibleAttemptBall && upwardStreak >= 1 &&
        measurement.y <= rim.y && Swift.abs(measurement.x - rimCenterX) < rim.width * 3 {
      armAttempt(timestamp, .aboveRim, "Confirmed upward trajectory reached above the rim; waiting for make confirmation.")
    }
    let enteredFromAboveWhileDescending = observedPrevious.map {
      $0.y < rim.y &&
      measurement.y > $0.y + max(ball.rect.height * 0.1, rim.height * 0.1) &&
      measurement.y <= rim.y + rim.height * 2 &&
      Swift.abs(measurement.x - rimCenterX) < rim.width * 3
    } ?? false
    if attemptStartedAt == 0 && eligibleAttemptBall && enteredFromAboveWhileDescending {
      armAttempt(timestamp, .rimInteraction, "Ball entered from above the camera view on a downward path toward the rim.")
    }

    if measurement.y <= rim.y && Swift.abs(measurement.x - rimCenterX) < rim.width * 4 {
      lastAboveRimBall = measurement
    }

    let currentPoint = STPoint(x: measurement.x, y: measurement.y)

    // A basket is a descending trajectory segment through the centered inner
    // 3/5 width and two-thirds height of the stabilized rim box. It may enter and leave any side,
    // so slanted and corner-to-corner makes count just like vertical swishes.
    let scoringRim = Self.innerRimBox(rim)
    // Net/rim occlusion can hide the ball between an above-rim detection and
    // its reappearance below. Bridge that gap with the last real above-rim
    // center, rather than requiring adjacent inference frames. The direction,
    // time, and lateral-distance guards prevent an unrelated later ball from
    // being joined to the earlier shot.
    if attemptStartedAt != 0,
       let aboveRimPoint = lastAboveRimBall,
       timestamp - aboveRimPoint.timestamp <= 1.5,
       measurement.y > scoringRim.y + scoringRim.height,
       Swift.abs(measurement.x - aboveRimPoint.x) <= max(rim.width * 3, 0.18),
       Self.downwardSegmentIntersectsRect(
         STPoint(x: aboveRimPoint.x, y: aboveRimPoint.y),
         currentPoint,
         scoringRim
       ) {
      return resolve(
        .make,
        "Ball reappeared below the rim on a descending path through the inner rim box.",
        timestamp,
        wallTimeMs,
        trackedBall,
        detectedRim
      )
    }
    if attemptStartedAt != 0,
       let trajectoryPrevious,
       Self.downwardSegmentIntersectsRect(
         trajectoryPrevious,
         currentPoint,
         scoringRim
       ) {
      return resolve(
        .make,
        "Descending ball trajectory crossed the inner rim box.",
        timestamp,
        wallTimeMs,
        trackedBall,
        detectedRim
      )
    }

    if activeState == .unconfigured { state = .idle }
    if activeState == .idle && approachZone &&
        next.vy < -max(rim.height, ball.rect.height) * 0.12 {
      state = .approaching
    }
    if (activeState == .approaching || activeState == .idle) &&
        above && insideOpening && next.vy < 0 {
      state = .aboveRim
    }
    if activeState == .aboveRim && nearRim { state = .rimInteraction }
    if observedCrossesDownward && !crossesOpening && crossingNearRim {
      state = .rimInteraction
    }
    let clearlyMissedRim =
      attemptStartedAt != 0 &&
      measurement.y > rim.y + rim.height
    if clearlyMissedRim {
      return resolve(.miss, "Ball passed below the rim without crossing the inner rim box.", timestamp, wallTimeMs, trackedBall, detectedRim)
    }
    if attemptStartedAt != 0 && timestamp - attemptStartedAt > attemptTimeoutSeconds {
      return resolve(.miss, "Shot left the rim interaction window without a downward rim crossing.", timestamp, wallTimeMs, trackedBall, detectedRim)
    }
    return (snapshot(timestamp, trackedBall, detectedRim), nil)
  }

  /// Testable seam matching LocalCoreMLCameraView.emitLostDetection: an
  /// inference failure is still a normal lost-ball input to shot tracking.
  mutating func processInferenceFailure(
    timestamp: Double,
    wallTimeMs: Double
  ) -> (STSnapshot, STShot?) {
    process(
      ball: nil,
      detectedRim: nil,
      timestamp: timestamp,
      wallTimeMs: wallTimeMs
    )
  }

  /// Produces an event snapshot after an autonomous timer changes state
  /// without a new camera frame.
  func currentSnapshot(
    timestamp: Double,
    ball: STDetection?,
    detectedRim: STDetection?
  ) -> STSnapshot {
    snapshot(timestamp, ball, detectedRim)
  }

  private mutating func updateDisplayTrajectory(ball: STDetection?, timestamp: Double) {
    // This is visual history only. Do not reset it on detector gaps, shot
    // resolution, or tracker re-acquisition: every visible ball box should
    // connect to the prior one until it naturally fades after 2.5 seconds.
    displayTrajectory.removeAll { timestamp - $0.timestamp > 2.5 }
    guard let ball else { return }
    let point = STObservedPoint(x: ball.rect.center.x, y: ball.rect.center.y, timestamp: timestamp)
    displayTrajectory.append(point)
    displayTrajectory = Array(displayTrajectory.suffix(120))
    lastDisplayBall = point
  }

  private mutating func updateAutomaticRim(_ detection: STDetection?) {
    guard let detection else { return }
    let expandedWidth = min(1, detection.rect.width * rimWidthScale)
    let next = STRect(
      x: max(0, min(1 - expandedWidth, detection.rect.x - (expandedWidth - detection.rect.width) / 2)),
      y: detection.rect.y,
      width: expandedWidth,
      height: detection.rect.height
    )
    let stable = lastRimCandidate.map {
      Swift.abs($0.center.x - next.center.x) < max($0.width, next.width) * 0.65 &&
      Swift.abs($0.center.y - next.center.y) < max($0.height, next.height) * 0.65
    } ?? false
    stableRimFrames = stable ? stableRimFrames + 1 : 1
    let smoothedCandidate = smooth(lastRimCandidate, next)
    lastRimCandidate = smoothedCandidate
    if stableRimFrames >= rimStableFramesRequired {
      autoRim = smooth(autoRim, smoothedCandidate)
      if stableRimFrames == rimStableFramesRequired {
        reason = "Rim auto-calibrated from stable model detections."
      }
    }
  }

  private mutating func processLost(
    rim: STRect,
    timestamp: Double,
    wallTimeMs: Double
  ) -> STShot? {
    if let pendingMake,
       timestamp - pendingMake.timestamp >= bounceOverrideSeconds,
       sizeGrowthCandidate == nil {
      return resolveShot(
        .make,
        "Ball entered and exited the detected rim opening on a downward trajectory.",
        timestamp,
        wallTimeMs
      )
    }
    if !resetReady && postShotResetStartedAtMs > 0 &&
        wallTimeMs - postShotResetStartedAtMs >= postShotMaxLockoutMs {
      resetReady = true
      resetClearSince = 0
      resetPreviousBall = nil
      resetUpwardStreak = 0
      reason = "Post-shot reset expired while the ball was lost; ready to reacquire a new shot."
    }
    guard let previous = track else {
      if attemptStartedAt != 0 && timestamp - attemptStartedAt > attemptTimeoutSeconds {
        return resolveShot(.miss, "Shot timed out after the ball was lost near the rim.", timestamp, wallTimeMs)
      }
      return nil
    }
    let dt = max(1.0 / 60, min(0.25, timestamp - previous.timestamp))
    let predicted = STTrack(
      x: previous.x + previous.vx * dt,
      y: previous.y + previous.vy * dt,
      vx: previous.vx,
      vy: previous.vy,
      width: previous.width,
      height: previous.height,
      observedX: previous.observedX,
      observedY: previous.observedY,
      timestamp: timestamp,
      misses: previous.misses + 1
    )
    track = predicted
    if crossedRim && pendingMake == nil &&
        predicted.y > rim.y + rim.height &&
        Swift.abs(predicted.x - rim.center.x) < rim.width * 1.1 &&
        predicted.vy > 0 {
      pendingMake = STPendingMake(timestamp: timestamp)
      reason = "Tracked rim crossing continued below the opening during a brief occlusion."
    }
    if predicted.misses > maxLostFrames {
      track = nil
      lastObservedBall = nil
      trajectory = []
      if let pending = lastAboveRimBall, timestamp - pending.timestamp <= 4 {
        armAttempt(pending.timestamp, .rimInteraction, "Ball is temporarily hidden at the rim; waiting for it to reappear below.")
      } else if attemptStartedAt != 0 && timestamp - attemptStartedAt > attemptTimeoutSeconds {
        return resolveShot(.miss, "Shot timed out after the ball left the rim area.", timestamp, wallTimeMs)
      } else {
        lastAboveRimBall = nil
        reason = "Ball left frame. Waiting to reacquire a new basketball detection."
      }
    }
    return nil
  }

  private mutating func updateBounceMissSequence(
    from start: STPoint,
    to end: STPoint,
    ball: STDetection,
    rim: STRect,
    timestamp: Double
  ) -> Bool {
    let size = max(ball.rect.width, ball.rect.height)

    if var candidate = sizeGrowthCandidate {
      if timestamp - candidate.startedAt <= bounceGrowthWindowSeconds {
        candidate.observations += 1
        if size >= candidate.previousSize * 1.03 {
          candidate.growthSteps += 1
        }
        candidate.previousSize = size
        candidate.maximumSize = max(candidate.maximumSize, size)
        sizeGrowthCandidate = candidate
        if candidate.observations >= 2 &&
            candidate.growthSteps >= 2 &&
            candidate.maximumSize >= candidate.baselineSize * bounceGrowthRatio {
          return true
        }
      } else {
        sizeGrowthCandidate = nil
      }
    }

    let motion = STPoint(x: end.x - start.x, y: end.y - start.y)
    let minimumMotion = max(min(rim.width, rim.height) * 0.04, 0.001)
    let motionMagnitude = hypot(motion.x, motion.y)
    if end.y <= rim.y {
      attemptWasAboveRim = true
    }

    if let previousMotion = previousAttemptMotion {
      let previousMagnitude = hypot(previousMotion.x, previousMotion.y)
      let directionChangedPastNinety =
        previousMagnitude >= minimumMotion &&
        motionMagnitude >= minimumMotion &&
        previousMotion.x * motion.x + previousMotion.y * motion.y < 0
      if !bounceReversalSeen &&
          attemptWasAboveRim &&
          attemptWasDescending &&
          previousMotion.y > minimumMotion &&
          directionChangedPastNinety {
        bounceReversalSeen = true
        sizeGrowthCandidate = STSizeGrowthCandidate(
          startedAt: timestamp,
          baselineSize: size,
          previousSize: size,
          observations: 0,
          growthSteps: 0,
          maximumSize: size
        )
        reason = "Direction reversal detected after the descending ball was above the rim; monitoring ball-box growth."
      }
    }

    if attemptWasAboveRim && motion.y > minimumMotion {
      attemptWasDescending = true
    }
    previousAttemptMotion = motion
    return false
  }

  private mutating func armAttempt(_ timestamp: Double, _ next: STState, _ nextReason: String) {
    guard attemptStartedAt == 0 else { return }
    attemptGeneration &+= 1
    attemptStartedAt = max(timestamp, 0.000001)
    crossedRim = false
    pendingMake = nil
    attemptWasAboveRim = false
    attemptWasDescending = false
    previousAttemptMotion = nil
    sizeGrowthCandidate = nil
    bounceReversalSeen = false
    state = next
    reason = nextReason
  }

  private mutating func resolve(
    _ result: STResult,
    _ resultReason: String,
    _ timestamp: Double,
    _ wallTimeMs: Double,
    _ ball: STDetection?,
    _ rim: STDetection?
  ) -> (STSnapshot, STShot?) {
    let shot = resolveShot(result, resultReason, timestamp, wallTimeMs)
    return (snapshot(timestamp, ball, rim), shot)
  }

  private mutating func resolveShot(
    _ result: STResult,
    _ resultReason: String,
    _ timestamp: Double,
    _ wallTimeMs: Double
  ) -> STShot {
    cooldownUntilMs = wallTimeMs + cooldownMs
    crossedRim = false
    pendingMake = nil
    attemptWasAboveRim = false
    attemptWasDescending = false
    previousAttemptMotion = nil
    sizeGrowthCandidate = nil
    bounceReversalSeen = false
    attemptStartedAt = 0
    track = nil
    lastObservedBall = nil
    lastAboveRimBall = nil
    trajectory = []
    resetReady = false
    resetClearSince = 0
    postShotResetStartedAtMs = wallTimeMs
    resetPreviousBall = nil
    resetUpwardStreak = 0
    upwardStreak = 0
    state = .idle
    reason = resultReason
    return STShot(id: UUID().uuidString, result: result, timestamp: timestamp, reason: resultReason)
  }

  private func snapshot(
    _ timestamp: Double,
    _ ball: STDetection?,
    _ detectedRim: STDetection?
  ) -> STSnapshot {
    STSnapshot(
      timestamp: timestamp,
      state: state,
      reason: reason,
      ball: ball,
      detectedRim: detectedRim,
      activeRim: activeRim,
      autoRim: autoRim != nil,
      stableRimFrames: stableRimFrames,
      trajectory: displayTrajectory.map { STPoint(x: $0.x, y: $0.y) }
    )
  }

  private func smooth(_ previous: STRect?, _ next: STRect) -> STRect {
    guard let previous else { return next }
    return STRect(
      x: previous.x + (next.x - previous.x) * rimSmoothing,
      y: previous.y + (next.y - previous.y) * rimSmoothing,
      width: previous.width + (next.width - previous.width) * rimSmoothing,
      height: previous.height + (next.height - previous.height) * rimSmoothing
    )
  }

  static func innerRimBox(_ rim: STRect) -> STRect {
    let width = rim.width * (3.0 / 5.0)
    let height = rim.height * (2.0 / 3.0)
    return STRect(
      x: rim.center.x - width / 2,
      y: rim.center.y - height / 2,
      width: width,
      height: height
    )
  }

  /// True when a strictly descending trajectory segment touches any part of
  /// the inner rim box. This intentionally permits top-to-side, side-to-side,
  /// and corner-to-corner swishes.
  static func downwardSegmentIntersectsRect(
    _ start: STPoint,
    _ end: STPoint,
    _ rect: STRect
  ) -> Bool {
    guard end.y > start.y else { return false }
    let dx = end.x - start.x
    let dy = end.y - start.y
    var entry = 0.0
    var exit = 1.0

    func clip(_ p: Double, _ q: Double) -> Bool {
      if Swift.abs(p) < 0.000_001 { return q >= 0 }
      let ratio = q / p
      if p < 0 {
        if ratio > exit { return false }
        entry = max(entry, ratio)
      } else {
        if ratio < entry { return false }
        exit = min(exit, ratio)
      }
      return true
    }

    return clip(-dx, start.x - rect.x) &&
      clip(dx, rect.x + rect.width - start.x) &&
      clip(-dy, start.y - rect.y) &&
      clip(dy, rect.y + rect.height - start.y) &&
      entry <= exit
  }

  static func downwardSegmentPassesThroughRim(
    _ start: STPoint,
    _ end: STPoint,
    _ rim: STRect
  ) -> Bool {
    if end.y <= start.y || start.y > rim.y || end.y < rim.y + rim.height {
      return false
    }
    let dy = end.y - start.y
    let xAtTop = start.x + (end.x - start.x) * ((rim.y - start.y) / dy)
    let xAtBottom = start.x + (end.x - start.x) * ((rim.y + rim.height - start.y) / dy)
    let openingLeft = rim.x + rim.width * 0.1
    let openingRight = rim.x + rim.width * 0.9
    return xAtTop >= openingLeft && xAtTop <= openingRight &&
      xAtBottom >= openingLeft && xAtBottom <= openingRight
  }

  static func downwardSegmentCrossesRimPlane(
    _ start: STPoint,
    _ end: STPoint,
    _ planeY: Double,
    _ rim: STRect
  ) -> Bool {
    if end.y <= start.y || start.y > planeY || end.y < planeY { return false }
    let progress = (planeY - start.y) / max(0.0001, end.y - start.y)
    let crossingX = start.x + (end.x - start.x) * progress
    return crossingX >= rim.x + rim.width * 0.1 &&
      crossingX <= rim.x + rim.width * 0.9
  }
}
