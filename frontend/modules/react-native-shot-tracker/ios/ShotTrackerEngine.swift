import CoreML
import CoreVideo
import Foundation
import ImageIO
import NitroModules
import Vision
import VisionCamera

/// Synchronous Nitro implementation. VisionCamera's `useAsyncRunner` owns
/// scheduling and frame dropping; this object never retains a Frame.
final class HybridShotTracker: HybridShotTrackerSpec {
  private let lock = NSLock()
  private var running = false
  private var model: VNCoreMLModel?
  private var inputSize = CGSize(width: 640, height: 640)
  private var outputName = "var_1439"
  private var machine = ShotTrackerStateMachine()
  private var ballConfidence = 0.5
  private var trackRim = true
  private var minimumUpdateInterval = 1.0 / 12
  private var lastUpdateTimestamp = -Double.infinity
  private var sequence: UInt64 = 0
  private let attemptTimer = ShotTrackerAttemptTimer()
  private var resultCallback: ((ProcessResult) -> Void)?
  private var lastDiagnosticWallTimeMs = -Double.infinity
  private var lastDiagnosticCode: String?

  deinit {
    attemptTimer.cancel()
  }

  func initialize() throws {
    lock.lock()
    defer { lock.unlock() }
    if model == nil { try loadModel() }
  }

  func start(configuration: TrackerConfiguration) throws {
    lock.lock()
    defer { lock.unlock() }
    if model == nil { try loadModel() }
    ballConfidence = max(0.05, min(0.95, configuration.ballConfidence))
    trackRim = configuration.trackRim
    minimumUpdateInterval = 1 / max(1, min(30, configuration.updateFps))
    running = true
  }

  func stop() {
    lock.lock()
    defer { lock.unlock() }
    attemptTimer.cancel()
    running = false
    machine.reset(clearCalibration: true)
    lastUpdateTimestamp = -Double.infinity
    lastDiagnosticWallTimeMs = -Double.infinity
    lastDiagnosticCode = nil
    sequence = 0
  }

  func reset() {
    lock.lock()
    defer { lock.unlock() }
    attemptTimer.cancel()
    machine.reset()
    lastUpdateTimestamp = -Double.infinity
    lastDiagnosticWallTimeMs = -Double.infinity
    lastDiagnosticCode = nil
  }

  func setManualRim(rim: NormalizedRect?) throws {
    lock.lock()
    defer { lock.unlock() }
    if let rim {
      guard rim.x.isFinite, rim.y.isFinite,
            rim.width.isFinite, rim.height.isFinite,
            rim.x >= 0, rim.y >= 0,
            rim.width > 0, rim.height > 0,
            rim.x + rim.width <= 1,
            rim.y + rim.height <= 1
      else {
        throw trackerError(
          5,
          "Manual rim coordinates must be a positive normalized rectangle."
        )
      }
      machine.setManualRim(
        STRect(x: rim.x, y: rim.y, width: rim.width, height: rim.height)
      )
    } else {
      machine.setManualRim(nil)
    }
  }

  func setResultCallback(
    callback: ((_ result: ProcessResult) -> Void)?
  ) {
    lock.lock()
    defer { lock.unlock() }
    resultCallback = callback
  }

  func process(frame: any HybridFrameSpec) throws -> ProcessResult? {
    lock.lock()
    defer { lock.unlock() }
    guard running else { return nil }
    guard let model else {
      throw trackerError(6, "Call initialize() or start() before process(frame).")
    }
    let timestamp = frame.timestamp
    guard frame.isValid,
          let nativeFrame = frame as? any NativeFrame,
          let sampleBuffer = nativeFrame.sampleBuffer,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
    else {
      // The pinned source silently drops unusable sample buffers. Only an
      // actual Vision/model inference failure is converted into a lost input.
      return nil
    }
    do {
      return try infer(
        pixelBuffer: pixelBuffer,
        timestamp: timestamp,
        orientation: cgOrientation(
          frame.orientation,
          mirrored: frame.isMirrored
        ),
        model: model
      )
    } catch {
      return consumeInferenceFailure(
        timestamp: timestamp,
        code: "inference_failed",
        message: error.localizedDescription
      )
    }
  }

  private func loadModel() throws {
    guard let url =
      Bundle.main.url(
        forResource: "BasketballYOLO26FP16",
        withExtension: "mlmodelc"
      ) ??
      Bundle(for: HybridShotTracker.self).url(
        forResource: "BasketballYOLO26FP16",
        withExtension: "mlmodelc"
      )
    else {
      throw trackerError(
        1,
        "BasketballYOLO26FP16.mlmodelc is missing from the application bundle."
      )
    }
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .all
    let rawModel = try MLModel(contentsOf: url, configuration: configuration)
    guard let imageInput =
      rawModel.modelDescription.inputDescriptionsByName["image"]?.imageConstraint
    else {
      throw trackerError(
        2,
        "The local model does not expose the expected image input."
      )
    }
    guard let output = rawModel.modelDescription.outputDescriptionsByName.first(
      where: {
        $0.value.multiArrayConstraint?.shape.map(\.intValue) ==
          ShotTrackerCoreMLDecoder.expectedShape
      }
    ) else {
      let schemas = rawModel.modelDescription.outputDescriptionsByName.map {
        "\($0.key):\($0.value.multiArrayConstraint?.shape.map(\.stringValue).joined(separator: "x") ?? "non-array")"
      }.joined(separator: ", ")
      throw trackerError(3, "Unsupported local model output schema: \(schemas)")
    }
    inputSize = CGSize(
      width: imageInput.pixelsWide,
      height: imageInput.pixelsHigh
    )
    outputName = output.key
    model = try VNCoreMLModel(for: rawModel)
  }

  private func infer(
    pixelBuffer: CVPixelBuffer,
    timestamp: Double,
    orientation: CGImagePropertyOrientation,
    model: VNCoreMLModel
  ) throws -> ProcessResult? {
    let request = VNCoreMLRequest(model: model)
    request.imageCropAndScaleOption = .scaleFill
    try VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer,
      orientation: orientation
    ).perform([request])
    guard let feature = request.results?
      .compactMap({ $0 as? VNCoreMLFeatureValueObservation })
      .first(where: { $0.featureName == outputName }),
      let tensor = feature.featureValue.multiArrayValue
    else {
      throw trackerError(4, "Inference returned no \(outputName) tensor.")
    }
    let detections = try ShotTrackerCoreMLDecoder.decode(
      tensor,
      inputSize: inputSize,
      minimumBallConfidence: ballConfidence,
      trackRim: trackRim
    )
    let result = machine.process(
      ball: detections.ball,
      detectedRim: detections.rim,
      timestamp: timestamp,
      wallTimeMs: Date().timeIntervalSince1970 * 1_000
    )
    synchronizeAttemptTimer()
    return makeSparseResult(
      stateResult: result,
      timestamp: timestamp,
      diagnostic: nil
    )
  }

  private func consumeInferenceFailure(
    timestamp: Double,
    code: String,
    message: String
  ) -> ProcessResult? {
    let wallTimeMs = Date().timeIntervalSince1970 * 1_000
    let result = machine.processInferenceFailure(
      timestamp: timestamp,
      wallTimeMs: wallTimeMs
    )
    synchronizeAttemptTimer()
    let shouldEmitDiagnostic =
      code != lastDiagnosticCode ||
      wallTimeMs - lastDiagnosticWallTimeMs >= 1_000
    let diagnostic: TrackerDiagnostic?
    if shouldEmitDiagnostic {
      lastDiagnosticCode = code
      lastDiagnosticWallTimeMs = wallTimeMs
      diagnostic = TrackerDiagnostic(
        code: code,
        message: message,
        timestamp: timestamp
      )
    } else {
      diagnostic = nil
    }
    return makeSparseResult(
      stateResult: result,
      timestamp: timestamp,
      diagnostic: diagnostic
    )
  }

  private func makeSparseResult(
    stateResult: (STSnapshot, STShot?),
    timestamp: Double,
    diagnostic: TrackerDiagnostic?
  ) -> ProcessResult? {
    let shouldUpdate =
      stateResult.1 != nil ||
      timestamp < lastUpdateTimestamp ||
      timestamp - lastUpdateTimestamp >= minimumUpdateInterval
    guard shouldUpdate || diagnostic != nil else { return nil }
    let update: TrackerUpdate?
    if shouldUpdate {
      lastUpdateTimestamp = timestamp
      sequence &+= 1
      update = makeUpdate(stateResult.0)
    } else {
      update = nil
    }
    return ProcessResult(
      update: update,
      shot: stateResult.1.map(makeShot),
      diagnostic: diagnostic
    )
  }

  private func synchronizeAttemptTimer() {
    attemptTimer.synchronize(token: machine.activeAttemptToken) {
      [weak self] token in
      self?.handleAttemptTimeout(token: token)
    }
  }

  private func handleAttemptTimeout(token: UInt64) {
    lock.lock()
    guard running else {
      lock.unlock()
      return
    }
    let now = Date().timeIntervalSince1970
    guard let shot = machine.timeoutAttempt(
      token: token,
      timestamp: now,
      wallTimeMs: now * 1_000
    ) else {
      lock.unlock()
      return
    }
    let callback = resultCallback
    let result = ProcessResult(
      update: nil,
      shot: makeShot(shot),
      diagnostic: nil
    )
    lock.unlock()
    callback?(result)
  }

  private func makeUpdate(_ value: STSnapshot) -> TrackerUpdate {
    TrackerUpdate(
      sequence: Double(sequence),
      timestamp: value.timestamp,
      state: TrackerState(fromString: value.state.rawValue)!,
      reason: value.reason,
      ball: value.ball.map(makeDetection),
      rim: value.detectedRim.map(makeDetection),
      activeRim: value.activeRim.map(makeRect),
      autoRim: value.autoRim,
      stableRimFrames: Double(value.stableRimFrames),
      trajectory: value.trajectory.map { Point(x: $0.x, y: $0.y) }
    )
  }

  private func makeShot(_ value: STShot) -> ShotEvent {
    ShotEvent(
      id: value.id,
      result: value.result == .make ? .make : .miss,
      timestamp: value.timestamp,
      reason: value.reason
    )
  }

  private func makeDetection(_ value: STDetection) -> Detection {
    Detection(
      confidence: value.confidence,
      label: value.label,
      x: value.rect.x,
      y: value.rect.y,
      width: value.rect.width,
      height: value.rect.height
    )
  }

  private func makeRect(_ value: STRect) -> NormalizedRect {
    NormalizedRect(
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height
    )
  }

  private func cgOrientation(
    _ orientation: CameraOrientation,
    mirrored: Bool
  ) -> CGImagePropertyOrientation {
    switch (orientation, mirrored) {
    case (.up, false): return .up
    case (.up, true): return .upMirrored
    case (.right, false): return .right
    case (.right, true): return .rightMirrored
    case (.down, false): return .down
    case (.down, true): return .downMirrored
    case (.left, false): return .left
    case (.left, true): return .leftMirrored
    }
  }

  private func trackerError(_ code: Int, _ message: String) -> NSError {
    NSError(
      domain: "ReactNativeShotTracker",
      code: code,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
