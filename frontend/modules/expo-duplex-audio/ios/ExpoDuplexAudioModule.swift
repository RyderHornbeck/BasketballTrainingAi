import AVFoundation
import ExpoModulesCore

private struct DuplexSessionOptions: Record {
  @Field var sampleRate: Int = 24_000
  @Field var frameDurationMs: Int = 20
  @Field var speaker: Bool = true
  @Field var muted: Bool = false
}

public final class ExpoDuplexAudioModule: Module {
  private let audioQueue = DispatchQueue(label: "com.hoopplan.duplex-audio")
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()

  private var captureConverter: AVAudioConverter?
  private var inputTapInstalled = false
  private var interruptionObserver: NSObjectProtocol?
  private var routeChangeObserver: NSObjectProtocol?
  private var isActive = false
  private var isMuted = false
  private var sampleRate = 24_000
  private var frameDurationMs = 20
  private var queuedFrames: Int64 = 0
  private var playbackGeneration: UInt64 = 0
  private var stoppedForBackground = false
  // Configuring AVAudioSession can itself generate route and engine
  // configuration notifications. Those are expected during startup and must
  // not tear down the session that just finished starting.
  private var ignoreAudioResetsUntil = Date.distantPast

  public func definition() -> ModuleDefinition {
    Name("ExpoDuplexAudio")

    Events("audioInput", "playbackStateChanged", "sessionStateChanged", "error")

    OnCreate {
      self.installInterruptionObserver()
      self.installAudioResetObservers()
    }

    AsyncFunction("requestPermissionsAsync") { (promise: Promise) in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        promise.resolve(self.permissionResponse(granted: granted))
      }
    }

    AsyncFunction("getPermissionsAsync") {
      self.currentPermissionResponse()
    }

    AsyncFunction("startSessionAsync") { (options: DuplexSessionOptions) in
      try self.audioQueue.sync {
        try self.startSession(options)
        return self.state()
      }
    }

    AsyncFunction("stopSessionAsync") {
      self.audioQueue.sync {
        self.stopSession(reason: "stopped")
      }
    }

    AsyncFunction("setMutedAsync") { (muted: Bool) in
      self.audioQueue.sync {
        self.isMuted = muted
        if self.isActive {
          self.emitSessionState(reason: "muted_changed")
        }
        return self.state()
      }
    }

    AsyncFunction("enqueuePlaybackAsync") { (base64Pcm: String) in
      try self.audioQueue.sync {
        try self.enqueuePlayback(base64Pcm)
      }
    }

    AsyncFunction("clearPlaybackAsync") {
      self.audioQueue.sync {
        self.clearPlayback(reason: "cleared", restartPlayer: true)
      }
    }

    AsyncFunction("getStateAsync") {
      self.audioQueue.sync {
        self.state()
      }
    }

    OnAppEntersBackground {
      self.audioQueue.async {
        self.stoppedForBackground = self.isActive
        self.stopSession(reason: "stopped")
      }
    }

    OnAppEntersForeground {
      self.audioQueue.async {
        guard self.stoppedForBackground else { return }
        self.stoppedForBackground = false
        // The JavaScript session and provider sockets may still look alive
        // after iOS suspends this foreground-only AudioEngine. Tell the
        // coordinator to rebuild the complete route with fresh audio I/O.
        self.sendEvent("sessionStateChanged", self.state(reason: "interrupted"))
      }
    }

    OnDestroy {
      self.audioQueue.sync {
        self.stopSession(reason: "stopped")
      }
      if let observer = self.interruptionObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      if let observer = self.routeChangeObserver {
        NotificationCenter.default.removeObserver(observer)
      }
    }
  }

  private func startSession(_ options: DuplexSessionOptions) throws {
    guard currentPermissionResponse()["granted"] as? Bool == true else {
      throw Exception(
        name: "MicrophonePermissionDenied",
        description: "Microphone permission is required before starting duplex audio."
      )
    }
    guard [16_000, 24_000, 44_100, 48_000].contains(options.sampleRate) else {
      throw Exception(name: "InvalidSampleRate", description: "Unsupported PCM sample rate.")
    }
    guard [10, 20, 40].contains(options.frameDurationMs) else {
      throw Exception(name: "InvalidFrameDuration", description: "Frame duration must be 10, 20, or 40 ms.")
    }

    if isActive {
      stopSession(reason: "stopped")
    }

    sampleRate = options.sampleRate
    frameDurationMs = options.frameDurationMs
    isMuted = options.muted
    queuedFrames = 0
    playbackGeneration &+= 1
    ignoreAudioResetsUntil = Date().addingTimeInterval(1)

    let session = AVAudioSession.sharedInstance()
    var categoryOptions: AVAudioSession.CategoryOptions = [
      .allowBluetoothHFP,
      .allowAirPlay,
    ]
    if options.speaker {
      categoryOptions.insert(.defaultToSpeaker)
    }

    do {
      try session.setCategory(
        .playAndRecord,
        mode: .voiceChat,
        options: categoryOptions
      )
      try session.setPreferredSampleRate(Double(sampleRate))
      try session.setPreferredIOBufferDuration(Double(frameDurationMs) / 1_000.0)
      try session.setActive(true, options: .notifyOthersOnDeactivation)

      if !engine.attachedNodes.contains(player) {
        engine.attach(player)
      }

      let playbackFormat = AVAudioFormat(
        standardFormatWithSampleRate: Double(sampleRate),
        channels: 1
      )!
      engine.connect(player, to: engine.mainMixerNode, format: playbackFormat)

      let input = engine.inputNode
      try input.setVoiceProcessingEnabled(true)
      let inputFormat = input.outputFormat(forBus: 0)
      guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
        throw Exception(name: "InvalidInputFormat", description: "No microphone input format is available.")
      }

      let captureFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: Double(sampleRate),
        channels: 1,
        interleaved: false
      )!
      guard let converter = AVAudioConverter(from: inputFormat, to: captureFormat) else {
        throw Exception(name: "ConverterUnavailable", description: "Could not create the microphone PCM converter.")
      }
      captureConverter = converter

      let tapFrames = AVAudioFrameCount(
        max(1, Int(inputFormat.sampleRate) * frameDurationMs / 1_000)
      )
      input.installTap(
        onBus: 0,
        bufferSize: tapFrames,
        format: inputFormat
      ) { [weak self] buffer, time in
        self?.handleCapture(buffer: buffer, time: time, outputFormat: captureFormat)
      }
      inputTapInstalled = true

      engine.prepare()
      try engine.start()
      player.play()
      isActive = true
      emitSessionState(reason: "started")
    } catch {
      inputCleanup()
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
      throw error
    }
  }

  private func stopSession(reason: String) {
    guard isActive || engine.isRunning else {
      return
    }

    clearPlayback(reason: "session_stopped", restartPlayer: false)
    inputCleanup()
    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: .notifyOthersOnDeactivation
    )
    isActive = false
    sendEvent("sessionStateChanged", state(reason: reason))
  }

  private func inputCleanup() {
    if inputTapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      inputTapInstalled = false
    }
    player.stop()
    engine.stop()
    engine.reset()
    captureConverter = nil
  }

  private func handleCapture(
    buffer: AVAudioPCMBuffer,
    time: AVAudioTime,
    outputFormat: AVAudioFormat
  ) {
    guard isActive, !isMuted, let converter = captureConverter else {
      return
    }

    let ratio = outputFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * ratio)) + 1
    guard let output = AVAudioPCMBuffer(
      pcmFormat: outputFormat,
      frameCapacity: capacity
    ) else {
      return
    }

    var supplied = false
    var conversionError: NSError?
    let status = converter.convert(to: output, error: &conversionError) {
      _, inputStatus in
      if supplied {
        inputStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      inputStatus.pointee = .haveData
      return buffer
    }

    guard status != .error,
          output.frameLength > 0,
          let samples = output.int16ChannelData?.pointee else {
      if let conversionError {
        emitError(
          code: "capture_conversion_failed",
          message: conversionError.localizedDescription,
          fatal: false
        )
      }
      return
    }

    let byteCount = Int(output.frameLength) * MemoryLayout<Int16>.size
    let data = Data(bytes: samples, count: byteCount)
    let timestampMs: Double
    if time.hostTime != 0 {
      timestampMs = AVAudioTime.seconds(forHostTime: time.hostTime) * 1_000
    } else {
      timestampMs = Date().timeIntervalSince1970 * 1_000
    }

    sendEvent("audioInput", [
      "data": data.base64EncodedString(),
      "encoding": "pcm_s16le",
      "sampleRate": sampleRate,
      "channels": 1,
      "frames": Int(output.frameLength),
      "timestampMs": timestampMs,
    ])
  }

  private func enqueuePlayback(_ base64Pcm: String) throws {
    guard isActive, engine.isRunning else {
      throw Exception(name: "SessionInactive", description: "Start the duplex audio session before enqueueing playback.")
    }
    guard let data = Data(base64Encoded: base64Pcm), !data.isEmpty else {
      throw Exception(name: "InvalidPcm", description: "Playback must be non-empty base64 PCM.")
    }
    guard data.count.isMultiple(of: MemoryLayout<Int16>.size) else {
      throw Exception(name: "InvalidPcm", description: "PCM byte length must be aligned to signed 16-bit samples.")
    }

    let frames = data.count / MemoryLayout<Int16>.size
    // Inworld can deliver contiguous PCM in short network bursts. A 1.2-second
    // cap cleared an entire valid sentence mid-playback whenever a burst briefly
    // outpaced the speaker, producing chopped words. User barge-in still clears
    // immediately; this is only a last-resort stale-audio ceiling.
    let maxQueuedFrames = Int64(sampleRate * 5_000 / 1_000)
    if queuedFrames + Int64(frames) > maxQueuedFrames {
      clearPlayback(reason: "latency_budget_exceeded", restartPlayer: true)
    }
    let format = AVAudioFormat(
      standardFormatWithSampleRate: Double(sampleRate),
      channels: 1
    )!
    guard let buffer = AVAudioPCMBuffer(
      pcmFormat: format,
      frameCapacity: AVAudioFrameCount(frames)
    ), let output = buffer.floatChannelData?.pointee else {
      throw Exception(name: "PlaybackBufferUnavailable", description: "Could not allocate a playback buffer.")
    }

    data.withUnsafeBytes { rawBuffer in
      let samples = rawBuffer.bindMemory(to: Int16.self)
      for index in 0..<frames {
        output[index] = Float(samples[index]) / 32_768.0
      }
    }
    buffer.frameLength = AVAudioFrameCount(frames)

    let generation = playbackGeneration
    let wasIdle = queuedFrames == 0
    queuedFrames += Int64(frames)
    player.scheduleBuffer(
      buffer,
      completionCallbackType: .dataPlayedBack
    ) { [weak self] _ in
      self?.audioQueue.async {
        guard let self, self.playbackGeneration == generation else {
          return
        }
        self.queuedFrames = max(0, self.queuedFrames - Int64(frames))
        if self.queuedFrames == 0 {
          self.emitPlaybackState(state: "idle", reason: "completed")
        }
      }
    }
    if !player.isPlaying {
      player.play()
    }
    if wasIdle {
      emitPlaybackState(state: "playing", reason: "started")
    }
  }

  private func clearPlayback(reason: String, restartPlayer: Bool) {
    playbackGeneration &+= 1
    player.stop()
    player.reset()
    queuedFrames = 0
    if restartPlayer, isActive, engine.isRunning {
      player.play()
    }
    emitPlaybackState(state: "idle", reason: reason)
  }

  private func installInterruptionObserver() {
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(),
      queue: nil
    ) { [weak self] notification in
      guard
        let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        AVAudioSession.InterruptionType(rawValue: typeValue) == .began
      else {
        return
      }
      self?.audioQueue.async {
        self?.stopSession(reason: "interrupted")
      }
    }
  }

  private func installAudioResetObservers() {
    routeChangeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: AVAudioSession.sharedInstance(),
      queue: nil
    ) { [weak self] notification in
      guard
        let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
        let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue),
        reason != .categoryChange
      else {
        return
      }
      self?.restartRequiredAfterAudioChange()
    }
  }

  private func restartRequiredAfterAudioChange() {
    audioQueue.async {
      // A real hardware route change invalidates player buffers and input
      // formats. Category changes and AVAudioEngine configuration-change
      // events also occur during ordinary setup, so they must not tear down a
      // healthy first turn.
      guard self.isActive, Date() >= self.ignoreAudioResetsUntil else { return }
      self.stopSession(reason: "interrupted")
    }
  }

  private func currentPermissionResponse() -> [String: Any] {
    switch AVAudioSession.sharedInstance().recordPermission {
    case .granted:
      return permissionResponse(granted: true)
    case .denied:
      return permissionResponse(granted: false)
    case .undetermined:
      return [
        "status": "undetermined",
        "granted": false,
        "canAskAgain": true,
        "expires": "never",
      ]
    @unknown default:
      return permissionResponse(granted: false)
    }
  }

  private func permissionResponse(granted: Bool) -> [String: Any] {
    [
      "status": granted ? "granted" : "denied",
      "granted": granted,
      "canAskAgain": false,
      "expires": "never",
    ]
  }

  private func state(reason: String? = nil) -> [String: Any] {
    var result: [String: Any] = [
      "session": isActive ? "active" : "inactive",
      "playback": queuedFrames > 0 ? "playing" : "idle",
      "sampleRate": sampleRate,
      "frameDurationMs": frameDurationMs,
      "muted": isMuted,
      "queuedFrames": queuedFrames,
    ]
    if let reason {
      result["reason"] = reason
    }
    return result
  }

  private func emitSessionState(reason: String) {
    sendEvent("sessionStateChanged", state(reason: reason))
  }

  private func emitPlaybackState(state: String, reason: String) {
    sendEvent("playbackStateChanged", [
      "state": state,
      "queuedFrames": queuedFrames,
      "reason": reason,
    ])
  }

  private func emitError(code: String, message: String, fatal: Bool) {
    sendEvent("error", [
      "code": code,
      "message": message,
      "fatal": fatal,
    ])
  }
}
