import AVFoundation
import CryptoKit
import ExpoModulesCore

private let sampleRate = 24_000.0
private let bytesPerFrame = 2
private let scheduleFrames = 480 // 20 ms at 24 kHz
private let jitterFrames = 2_880 // 120 ms at 24 kHz
private let maximumResponseBytes = 8 * 1_024 * 1_024
private let maximumCacheItemBytes = 4 * 1_024 * 1_024

struct StreamingPcmSpeakOptions: Record {
  @Field var url: String = ""
  @Field var headers: [String: String] = [:]
  @Field var body: String = ""
  @Field var text: String = ""
  @Field var voice: String = ""
  @Field var model: String = ""
  @Field var requestId: String?
  @Field var useCache: Bool = true
}

private final class StreamingDelegate: NSObject, URLSessionDataDelegate {
  let onResponse: (HTTPURLResponse) -> Bool
  let onData: (Data) -> Void
  let onComplete: (Error?) -> Void

  init(
    onResponse: @escaping (HTTPURLResponse) -> Bool,
    onData: @escaping (Data) -> Void,
    onComplete: @escaping (Error?) -> Void
  ) {
    self.onResponse = onResponse
    self.onData = onData
    self.onComplete = onComplete
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let response = response as? HTTPURLResponse, onResponse(response) else {
      completionHandler(.cancel)
      return
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    onData(data)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    onComplete(error)
  }
}

private final class PcmCache {
  private let memory = NSCache<NSString, NSData>()
  private let fileManager = FileManager.default
  private let directory: URL
  private let diskLimit = 32 * 1_024 * 1_024

  init() {
    memory.countLimit = 16
    memory.totalCostLimit = 8 * 1_024 * 1_024
    let root = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first!
    directory = root.appendingPathComponent("ExpoStreamingPcmPlayer", isDirectory: true)
    try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  func key(voice: String, text: String, model: String) -> String {
    let source = "\(voice)\u{0}\(model)\u{0}\(text)"
    return SHA256.hash(data: Data(source.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  func data(for key: String) -> Data? {
    if let cached = memory.object(forKey: key as NSString) {
      return cached as Data
    }
    let url = directory.appendingPathComponent("\(key).pcm")
    guard let data = try? Data(contentsOf: url), !data.isEmpty, data.count <= maximumCacheItemBytes else {
      return nil
    }
    memory.setObject(data as NSData, forKey: key as NSString, cost: data.count)
    try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
    return data
  }

  func store(_ data: Data, for key: String) {
    guard !data.isEmpty, data.count <= maximumCacheItemBytes else {
      return
    }
    memory.setObject(data as NSData, forKey: key as NSString, cost: data.count)
    try? data.write(to: directory.appendingPathComponent("\(key).pcm"), options: .atomic)
    trimDisk()
  }

  func clear() {
    memory.removeAllObjects()
    try? fileManager.removeItem(at: directory)
    try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  private func trimDisk() {
    let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey]
    guard let files = try? fileManager.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: Array(keys),
      options: [.skipsHiddenFiles]
    ) else {
      return
    }
    let entries = files.compactMap { url -> (URL, Date, Int)? in
      guard let values = try? url.resourceValues(forKeys: keys) else {
        return nil
      }
      return (url, values.contentModificationDate ?? .distantPast, values.fileSize ?? 0)
    }.sorted { $0.1 > $1.1 }

    var used = 0
    for entry in entries {
      used += entry.2
      if used > diskLimit {
        try? fileManager.removeItem(at: entry.0)
      }
    }
  }
}

public final class ExpoStreamingPcmPlayerModule: Module {
  private let audioQueue = DispatchQueue(label: "com.hoopplan.streaming-pcm-player")
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let cache = PcmCache()

  private var audioIsConfigured = false
  private var activeRequestId: String?
  private var activeCacheKey: String?
  private var shouldCache = false
  private var pendingPcm = Data()
  private var cacheData = Data()
  private var totalBytes = 0
  private var scheduledBuffers = 0
  private var networkFinished = false
  private var playbackStarted = false
  private var responseAccepted = false
  private var session: URLSession?
  private var task: URLSessionDataTask?

  public func definition() -> ModuleDefinition {
    Name("ExpoStreamingPcmPlayer")

    Events("started", "firstByte", "firstAudio", "finished", "error", "cancelled")

    Function("speak") { (options: StreamingPcmSpeakOptions) -> String in
      let requestId = options.requestId ?? UUID().uuidString
      audioQueue.async {
        self.start(options: options, requestId: requestId)
      }
      return requestId
    }

    Function("prefetch") { (options: StreamingPcmSpeakOptions) -> String in
      let requestId = options.requestId ?? UUID().uuidString
      audioQueue.async {
        self.prefetch(options: options, requestId: requestId)
      }
      return requestId
    }

    Function("cancel") { (requestId: String?) in
      audioQueue.async {
        guard requestId == nil || requestId == self.activeRequestId else {
          return
        }
        self.cancelActive(emitEvent: true)
      }
    }

    Function("clear") {
      audioQueue.async {
        self.cancelActive(emitEvent: true)
        self.cache.clear()
      }
    }

    OnDestroy {
      self.audioQueue.async {
        self.cancelActive(emitEvent: false)
        self.player.stop()
        self.engine.stop()
      }
    }
  }

  private func start(options: StreamingPcmSpeakOptions, requestId: String) {
    cancelActive(emitEvent: true)

    guard let url = URL(string: options.url), url.scheme == "https" else {
      emit("error", requestId: requestId, extra: [
        "code": "invalid_url",
        "message": "PCM speech URL must use HTTPS."
      ])
      return
    }
    guard !options.text.isEmpty, options.text.utf8.count <= 2_000 else {
      emit("error", requestId: requestId, extra: [
        "code": "invalid_text",
        "message": "Speech text must be between 1 and 2000 UTF-8 bytes."
      ])
      return
    }
    guard options.body.utf8.count <= 32_768, options.headers.count <= 32 else {
      emit("error", requestId: requestId, extra: [
        "code": "invalid_request",
        "message": "Speech request body or headers exceed the allowed size."
      ])
      return
    }

    activeRequestId = requestId
    activeCacheKey = cache.key(voice: options.voice, text: options.text, model: options.model)
    shouldCache = options.useCache
    resetStreamState()
    emit("started", requestId: requestId)

    if options.useCache, let key = activeCacheKey, let cached = cache.data(for: key) {
      responseAccepted = true
      ingest(cached, requestId: requestId)
      completeStream(error: nil, requestId: requestId)
      return
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = Data(options.body.utf8)
    request.timeoutInterval = 45
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("audio/pcm, application/octet-stream", forHTTPHeaderField: "Accept")
    for (name, value) in options.headers {
      request.setValue(value, forHTTPHeaderField: name)
    }

    let delegate = StreamingDelegate(
      onResponse: { [weak self] response in
        guard let self else { return false }
        return self.audioQueue.sync {
          guard self.activeRequestId == requestId else { return false }
          guard (200..<300).contains(response.statusCode) else {
            self.fail(
              requestId: requestId,
              code: "http_error",
              message: "PCM speech request failed with HTTP \(response.statusCode)."
            )
            return false
          }
          self.responseAccepted = true
          return true
        }
      },
      onData: { [weak self] data in
        self?.audioQueue.async {
          self?.ingest(data, requestId: requestId)
        }
      },
      onComplete: { [weak self] error in
        self?.audioQueue.async {
          self?.completeStream(error: error, requestId: requestId)
        }
      }
    )

    let configuration = URLSessionConfiguration.ephemeral
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    self.session = session
    task = session.dataTask(with: request)
    task?.resume()
  }

  private func prefetch(options: StreamingPcmSpeakOptions, requestId: String) {
    let key = cache.key(voice: options.voice, text: options.text, model: options.model)
    if cache.data(for: key) != nil {
      return
    }
    guard
      let url = URL(string: options.url),
      url.scheme == "https",
      !options.text.isEmpty,
      options.text.utf8.count <= 2_000,
      options.body.utf8.count <= 32_768,
      options.headers.count <= 32
    else {
      return
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = Data(options.body.utf8)
    request.timeoutInterval = 45
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("audio/pcm, application/octet-stream", forHTTPHeaderField: "Accept")
    for (name, value) in options.headers {
      request.setValue(value, forHTTPHeaderField: name)
    }
    URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
      guard
        let self,
        let response = response as? HTTPURLResponse,
        (200..<300).contains(response.statusCode),
        let data,
        !data.isEmpty,
        data.count <= maximumCacheItemBytes,
        data.count.isMultiple(of: bytesPerFrame)
      else {
        return
      }
      self.audioQueue.async {
        self.cache.store(data, for: key)
      }
    }.resume()
  }

  private func resetStreamState() {
    pendingPcm.removeAll(keepingCapacity: true)
    cacheData.removeAll(keepingCapacity: true)
    totalBytes = 0
    scheduledBuffers = 0
    networkFinished = false
    playbackStarted = false
    responseAccepted = false
  }

  private func configureAudioIfNeeded() throws {
    guard !audioIsConfigured else {
      if !engine.isRunning {
        try engine.start()
      }
      return
    }
    guard let format = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: sampleRate,
      channels: 1,
      interleaved: false
    ) else {
      throw NSError(domain: "ExpoStreamingPcmPlayer", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Could not create the 24 kHz PCM format."
      ])
    }

    // Deliberately do not set or deactivate AVAudioSession. WebRTC owns the
    // playAndRecord/voiceChat session; this engine plays within that session.
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)
    engine.prepare()
    try engine.start()
    audioIsConfigured = true
  }

  private func ingest(_ data: Data, requestId: String) {
    guard activeRequestId == requestId, !data.isEmpty else {
      return
    }
    if totalBytes == 0 {
      emit("firstByte", requestId: requestId)
    }
    totalBytes += data.count
    guard totalBytes <= maximumResponseBytes else {
      fail(
        requestId: requestId,
        code: "response_too_large",
        message: "PCM speech response exceeded \(maximumResponseBytes) bytes."
      )
      return
    }

    pendingPcm.append(data)
    if shouldCache, cacheData.count + data.count <= maximumCacheItemBytes {
      cacheData.append(data)
    } else {
      shouldCache = false
      cacheData.removeAll(keepingCapacity: false)
    }

    if playbackStarted {
      scheduleAvailable(requestId: requestId, flush: false)
    } else if pendingPcm.count >= jitterFrames * bytesPerFrame {
      scheduleAvailable(requestId: requestId, flush: false)
      beginPlayback(requestId: requestId)
    }
  }

  private func completeStream(error: Error?, requestId: String) {
    guard activeRequestId == requestId else {
      return
    }
    session?.finishTasksAndInvalidate()
    session = nil
    task = nil

    if let error = error as? URLError, error.code == .cancelled {
      if responseAccepted {
        fail(requestId: requestId, code: "stream_cancelled", message: "PCM stream ended unexpectedly.")
      }
      return
    }
    if let error {
      fail(requestId: requestId, code: "network_error", message: error.localizedDescription)
      return
    }
    guard responseAccepted else {
      fail(requestId: requestId, code: "invalid_response", message: "PCM endpoint returned no valid response.")
      return
    }
    guard totalBytes > 0, pendingPcm.count.isMultiple(of: bytesPerFrame) else {
      fail(requestId: requestId, code: "invalid_pcm", message: "PCM response was empty or not frame-aligned.")
      return
    }

    networkFinished = true
    scheduleAvailable(requestId: requestId, flush: true)
    if !playbackStarted {
      beginPlayback(requestId: requestId)
    }
    finishIfReady(requestId: requestId)
  }

  private func scheduleAvailable(requestId: String, flush: Bool) {
    let standardBytes = scheduleFrames * bytesPerFrame
    while pendingPcm.count >= standardBytes || (flush && !pendingPcm.isEmpty) {
      let byteCount = pendingPcm.count >= standardBytes ? standardBytes : pendingPcm.count
      let chunk = Data(pendingPcm.prefix(byteCount))
      pendingPcm.removeFirst(byteCount)
      schedule(chunk, requestId: requestId)
    }
  }

  private func schedule(_ pcm: Data, requestId: String) {
    let frameCount = pcm.count / bytesPerFrame
    guard
      frameCount > 0,
      let format = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: sampleRate,
        channels: 1,
        interleaved: false
      ),
      let buffer = AVAudioPCMBuffer(
        pcmFormat: format,
        frameCapacity: AVAudioFrameCount(frameCount)
      ),
      let channel = buffer.int16ChannelData?[0]
    else {
      fail(requestId: requestId, code: "audio_buffer_error", message: "Could not allocate a PCM audio buffer.")
      return
    }

    buffer.frameLength = AVAudioFrameCount(frameCount)
    pcm.withUnsafeBytes { rawBuffer in
      guard let source = rawBuffer.baseAddress else { return }
      memcpy(channel, source, pcm.count)
    }
    scheduledBuffers += 1
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.audioQueue.async {
        guard let self, self.activeRequestId == requestId else { return }
        self.scheduledBuffers = max(0, self.scheduledBuffers - 1)
        self.finishIfReady(requestId: requestId)
      }
    }
  }

  private func beginPlayback(requestId: String) {
    guard activeRequestId == requestId, scheduledBuffers > 0, !playbackStarted else {
      return
    }
    do {
      try configureAudioIfNeeded()
      player.play()
      playbackStarted = true
      emit("firstAudio", requestId: requestId)
    } catch {
      fail(requestId: requestId, code: "audio_engine_error", message: error.localizedDescription)
    }
  }

  private func finishIfReady(requestId: String) {
    guard
      activeRequestId == requestId,
      networkFinished,
      pendingPcm.isEmpty,
      scheduledBuffers == 0
    else {
      return
    }
    if shouldCache, let key = activeCacheKey {
      cache.store(cacheData, for: key)
    }
    emit("finished", requestId: requestId)
    finishActive()
  }

  private func fail(requestId: String, code: String, message: String) {
    guard activeRequestId == requestId || activeRequestId == nil else {
      return
    }
    task?.cancel()
    session?.invalidateAndCancel()
    player.stop()
    emit("error", requestId: requestId, extra: ["code": code, "message": message])
    finishActive()
  }

  private func cancelActive(emitEvent: Bool) {
    guard let requestId = activeRequestId else {
      return
    }
    task?.cancel()
    session?.invalidateAndCancel()
    player.stop()
    if emitEvent {
      emit("cancelled", requestId: requestId)
    }
    finishActive()
  }

  private func finishActive() {
    activeRequestId = nil
    activeCacheKey = nil
    task = nil
    session = nil
    shouldCache = false
    resetStreamState()
  }

  private func emit(_ name: String, requestId: String, extra: [String: Any] = [:]) {
    var payload = extra
    payload["requestId"] = requestId
    DispatchQueue.main.async {
      self.sendEvent(name, payload)
    }
  }
}
