import AVFoundation
import CoreML
import CoreVideo
import QuartzCore
import React
import UIKit
import Vision

/// React Native manager declaration is exported in
/// `LocalCoreMLCameraViewManager.m`, which makes its props visible to Obj-C.
@objc(LocalCoreMLCameraViewManager)
final class LocalCoreMLCameraViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }

  override func view() -> UIView! {
    LocalCoreMLCameraView()
  }
}

/// Full-size native camera preview and local Core ML shot tracker.
///
/// Capture/inference/tracker state is confined to `outputQueue`; UIKit,
/// AVFoundation preview, and React event callbacks always run on the main queue.
@objc(LocalCoreMLCameraView)
final class LocalCoreMLCameraView: UIView, AVCaptureVideoDataOutputSampleBufferDelegate {
  @objc var isActive = false {
    didSet {
      let active = isActive
      outputQueue.async { [weak self] in
        guard let self else { return }
        self.trackingActive = active
        if !self.trackingActive {
          self.attemptTimer.cancel()
          self.machine.reset(clearCalibration: true)
          self.lastEventTimestamp = -Double.infinity
          self.sequence = 0
        }
      }
      if active { loadModelIfNeeded() }
      updateCaptureState()
    }
  }

  @objc var ballConfidence: NSNumber = 0.5 {
    didSet {
      let value = ballConfidence.doubleValue
      outputQueue.async { [weak self] in self?.minimumBallConfidence = value }
    }
  }

  @objc var trackRim = true {
    didSet {
      let value = trackRim
      outputQueue.async { [weak self] in self?.shouldTrackRim = value }
    }
  }

  @objc var onTrackerEvent: RCTDirectEventBlock?
  @objc var onModelStatus: RCTDirectEventBlock?
  @objc var onCameraStatus: RCTDirectEventBlock?

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(
    label: "com.hoopplan.shot-tracker.camera",
    qos: .userInitiated
  )
  private let outputQueue = DispatchQueue(
    label: "com.hoopplan.shot-tracker.inference",
    qos: .userInitiated
  )
  private let modelQueue = DispatchQueue(
    label: "com.hoopplan.shot-tracker.model",
    qos: .userInitiated
  )

  private var videoOutput: AVCaptureVideoDataOutput?
  private var previewLayer: AVCaptureVideoPreviewLayer?

  // outputQueue-only state
  private var visionModel: VNCoreMLModel?
  private var inputSize = CGSize(width: 640, height: 640)
  private var outputName = "var_1439"
  private var trackingActive = false
  private var minimumBallConfidence = 0.5
  private var shouldTrackRim = true
  private var machine = ShotTrackerStateMachine()
  private let attemptTimer = ShotTrackerAttemptTimer()
  private var sequence: UInt64 = 0
  private var lastEventTimestamp = -Double.infinity
  private var lastSnapshot: STSnapshot?

  // Accessed only on modelQueue.
  private var loadingModel = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = true
    setupCamera()
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer?.frame = bounds
    updateVideoOrientation()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      sessionQueue.async { [weak self] in
        guard let self, self.session.isRunning else { return }
        self.session.stopRunning()
      }
    } else {
      updateVideoOrientation()
      if isActive { updateCaptureState() }
    }
  }

  deinit {
    attemptTimer.cancel()
    videoOutput?.setSampleBufferDelegate(nil, queue: nil)
    let captureSession = session
    sessionQueue.async {
      if captureSession.isRunning { captureSession.stopRunning() }
    }
  }

  private func setupCamera() {
    session.beginConfiguration()
    session.sessionPreset = .hd1280x720
    guard
      let device = AVCaptureDevice.default(
        .builtInWideAngleCamera,
        for: .video,
        position: .back
      ),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      session.commitConfiguration()
      emitCameraStatus("CAMERA_CONFIGURATION_FAILED")
      return
    }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    output.setSampleBufferDelegate(self, queue: outputQueue)
    guard session.canAddOutput(output) else {
      session.commitConfiguration()
      emitCameraStatus("CAMERA_OUTPUT_CONFIGURATION_FAILED")
      return
    }
    session.addOutput(output)
    videoOutput = output
    session.commitConfiguration()

    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    layer.insertSublayer(preview, at: 0)
    previewLayer = preview
    updateVideoOrientation()
  }

  private func updateVideoOrientation() {
    let orientation: AVCaptureVideoOrientation
    switch window?.windowScene?.interfaceOrientation {
    case .landscapeLeft:
      orientation = .landscapeLeft
    case .landscapeRight:
      orientation = .landscapeRight
    default:
      orientation = .landscapeRight
    }
    previewLayer?.connection?.videoOrientation = orientation
    videoOutput?.connection(with: .video)?.videoOrientation = orientation
  }

  private func updateCaptureState() {
    if isActive, window != nil {
      emitCameraStatus("CAMERA_STARTING")
      sessionQueue.async { [weak self] in
        guard let self else { return }
        if !self.session.isRunning { self.session.startRunning() }
        self.emitCameraStatus(
          self.session.isRunning ? "PREVIEW_RUNNING" : "CAMERA_FAILED_TO_START"
        )
      }
    } else {
      sessionQueue.async { [weak self] in
        guard let self else { return }
        if self.session.isRunning { self.session.stopRunning() }
        self.emitCameraStatus("PREVIEW_STOPPED")
      }
    }
  }

  private func loadModelIfNeeded() {
    modelQueue.async { [weak self] in
      guard let self, !self.loadingModel else { return }
      self.loadingModel = true
      self.emitModelStatus("loading", "Loading bundled YOLO26 FP16 Core ML model.")
      defer { self.loadingModel = false }
      do {
        guard let url = Bundle.main.url(
          forResource: "BasketballYOLO26FP16",
          withExtension: "mlmodelc"
        ) ?? Bundle(for: LocalCoreMLCameraView.self).url(
          forResource: "BasketballYOLO26FP16",
          withExtension: "mlmodelc"
        ) else {
          throw trackerError(1, "BasketballYOLO26FP16.mlmodelc is missing from the application bundle.")
        }
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .all
        let model = try MLModel(contentsOf: url, configuration: configuration)
        guard let imageInput = model.modelDescription.inputDescriptionsByName["image"]?.imageConstraint else {
          throw trackerError(2, "The local model does not expose the expected image input.")
        }
        guard let output = model.modelDescription.outputDescriptionsByName.first(where: {
          $0.value.multiArrayConstraint?.shape.map(\.intValue) == ShotTrackerCoreMLDecoder.expectedShape
        }) else {
          throw trackerError(3, "The local model does not expose a [1,300,6] output tensor.")
        }
        let visionModel = try VNCoreMLModel(for: model)
        self.outputQueue.async { [weak self] in
          guard let self else { return }
          self.visionModel = visionModel
          self.inputSize = CGSize(width: imageInput.pixelsWide, height: imageInput.pixelsHigh)
          self.outputName = output.key
          self.emitModelStatus("ready", "YOLO26 local FP16 model loaded.")
        }
      } catch {
        self.emitModelStatus("error", "Local Core ML model failed to load: \(error.localizedDescription)")
      }
    }
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard trackingActive,
          let visionModel,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
    else { return }

    let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
    do {
      let request = VNCoreMLRequest(model: visionModel)
      request.imageCropAndScaleOption = .scaleFill
      try VNImageRequestHandler(cvPixelBuffer: pixelBuffer).perform([request])
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
        minimumBallConfidence: minimumBallConfidence,
        trackRim: shouldTrackRim
      )
      consume(
        ball: detections.ball,
        rim: detections.rim,
        timestamp: timestamp
      )
    } catch {
      emitModelStatus("error", "Local Core ML inference failed: \(error.localizedDescription)")
      consume(ball: nil, rim: nil, timestamp: timestamp)
    }
  }

  private func consume(
    ball: STDetection?,
    rim: STDetection?,
    timestamp: Double
  ) {
    let result = machine.process(
      ball: ball,
      detectedRim: rim,
      timestamp: timestamp,
      wallTimeMs: Date().timeIntervalSince1970 * 1_000
    )
    lastSnapshot = result.0
    synchronizeAttemptTimer()
    emitTrackerEvent(snapshot: result.0, shot: result.1, force: result.1 != nil)
  }

  private func synchronizeAttemptTimer() {
    attemptTimer.synchronize(token: machine.activeAttemptToken) { [weak self] token in
      self?.outputQueue.async {
        self?.handleAttemptTimeout(token: token)
      }
    }
  }

  private func handleAttemptTimeout(token: UInt64) {
    guard trackingActive else { return }
    let now = Date().timeIntervalSince1970
    guard let shot = machine.timeoutAttempt(
      token: token,
      timestamp: now,
      wallTimeMs: now * 1_000
    ) else { return }
    let snapshot = machine.currentSnapshot(
      timestamp: now,
      ball: lastSnapshot?.ball,
      detectedRim: lastSnapshot?.detectedRim
    )
    lastSnapshot = snapshot
    emitTrackerEvent(snapshot: snapshot, shot: shot, force: true)
  }

  private func emitTrackerEvent(
    snapshot: STSnapshot,
    shot: STShot?,
    force: Bool
  ) {
    guard force || snapshot.timestamp < lastEventTimestamp ||
      snapshot.timestamp - lastEventTimestamp >= (1.0 / 30.0)
    else { return }
    lastEventTimestamp = snapshot.timestamp
    sequence &+= 1
    let eventSequence = Double(sequence)
    // `AVCaptureVideoPreviewLayer` uses resizeAspectFill. Convert the
    // detector's camera-frame coordinates into that layer's displayed rect on
    // the main thread, where UIKit layer geometry is authoritative.
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      var event: [String: Any] = [
        "sequence": eventSequence,
        "timestamp": snapshot.timestamp,
        "state": snapshot.state.rawValue,
        "reason": snapshot.reason,
        "ball": snapshot.ball.map(self.eventDetection) ?? NSNull(),
        "rim": snapshot.detectedRim.map(self.eventDetection) ?? NSNull(),
        "activeRim": snapshot.activeRim.map(self.eventRect) ?? NSNull(),
        "autoRim": snapshot.autoRim,
        "stableRimFrames": snapshot.stableRimFrames,
        "trajectory": snapshot.trajectory.map(self.eventPoint),
      ]
      if let shot {
        event["shot"] = [
          "id": shot.id,
          "result": shot.result.rawValue,
          "timestamp": shot.timestamp,
          "reason": shot.reason,
        ]
      }
      self.onTrackerEvent?(event)
    }
  }

  private func emitModelStatus(_ state: String, _ message: String) {
    DispatchQueue.main.async { [weak self] in
      self?.onModelStatus?(["state": state, "message": message])
    }
  }

  private func emitCameraStatus(_ state: String) {
    DispatchQueue.main.async { [weak self] in
      self?.onCameraStatus?(["state": state])
    }
  }

  private func eventDetection(_ detection: STDetection) -> [String: Any] {
    let rect = previewRect(detection.rect)
    return [
      "x": rect.x,
      "y": rect.y,
      "width": rect.width,
      "height": rect.height,
      "confidence": detection.confidence,
      "label": detection.label,
    ]
  }

  private func eventRect(_ rect: STRect) -> [String: Any] {
    let projected = previewRect(rect)
    return [
      "x": projected.x,
      "y": projected.y,
      "width": projected.width,
      "height": projected.height,
    ]
  }

  private func eventPoint(_ point: STPoint) -> [String: Any] {
    let projected = previewRect(STRect(x: point.x, y: point.y, width: 0, height: 0))
    return ["x": projected.x, "y": projected.y]
  }

  private func previewRect(_ rect: STRect) -> STRect {
    guard bounds.width > 0, bounds.height > 0,
          let previewLayer
    else { return rect }
    // AVFoundation supplies the source-frame region currently visible through
    // this resizeAspectFill preview. Invert that region to convert detector
    // coordinates into React view coordinates without assuming a 16:9 camera
    // or phone-sized view.
    let visibleSourceRect = previewLayer.metadataOutputRectConverted(
      fromLayerRect: bounds
    )
    guard visibleSourceRect.width > 0, visibleSourceRect.height > 0 else {
      return rect
    }
    return STRect(
      x: (rect.x - visibleSourceRect.minX) / visibleSourceRect.width,
      y: (rect.y - visibleSourceRect.minY) / visibleSourceRect.height,
      width: rect.width / visibleSourceRect.width,
      height: rect.height / visibleSourceRect.height
    )
  }

  private func trackerError(_ code: Int, _ message: String) -> NSError {
    NSError(
      domain: "ReactNativeShotTracker",
      code: code,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
