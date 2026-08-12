package expo.modules.duplexaudio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Process
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread
import kotlin.math.max

class DuplexSessionOptions(
  @Field val sampleRate: Int = 24_000,
  @Field val frameDurationMs: Int = 20,
  @Field val speaker: Boolean = true,
  @Field val muted: Boolean = false
) : Record

private data class PlaybackChunk(
  val bytes: ByteArray,
  val generation: Long
)

class ExpoDuplexAudioModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val sessionLock = Any()
  private val playbackQueue = LinkedBlockingQueue<PlaybackChunk>()
  private val playbackGeneration = AtomicLong(0)
  private val enqueuedFrames = AtomicLong(0)
  private val queuedFrames = AtomicLong(0)

  @Volatile private var isActive = false
  @Volatile private var isMuted = false
  @Volatile private var playbackState = "idle"

  private var sampleRate = 24_000
  private var frameDurationMs = 20
  private var audioRecord: AudioRecord? = null
  private var audioTrack: AudioTrack? = null
  private var captureThread: Thread? = null
  private var playbackThread: Thread? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  private var audioManager: AudioManager? = null
  private var previousAudioMode = AudioManager.MODE_NORMAL
  private var previousSpeakerphoneOn = false

  override fun definition() = ModuleDefinition {
    Name("ExpoDuplexAudio")

    Events("audioInput", "playbackStateChanged", "sessionStateChanged", "error")

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.RECORD_AUDIO
      )
    }

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.RECORD_AUDIO
      )
    }

    AsyncFunction("startSessionAsync") { options: DuplexSessionOptions ->
      synchronized(sessionLock) {
        startSession(options)
        state()
      }
    }

    AsyncFunction("stopSessionAsync") {
      synchronized(sessionLock) {
        stopSession("stopped")
      }
    }

    AsyncFunction("setMutedAsync") { muted: Boolean ->
      synchronized(sessionLock) {
        isMuted = muted
        if (isActive) {
          emitSessionState("muted_changed")
        }
        state()
      }
    }

    AsyncFunction("enqueuePlaybackAsync") { base64Pcm: String ->
      enqueuePlayback(base64Pcm)
    }

    AsyncFunction("clearPlaybackAsync") {
      clearPlayback("cleared", restartTrack = true)
    }

    AsyncFunction("getStateAsync") {
      state()
    }

    OnActivityEntersBackground {
      synchronized(sessionLock) {
        stopSession("stopped")
      }
    }

    OnDestroy {
      synchronized(sessionLock) {
        stopSession("stopped")
      }
    }
  }

  private fun startSession(options: DuplexSessionOptions) {
    check(
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
    ) {
      "Microphone permission is required before starting duplex audio."
    }
    require(options.sampleRate in setOf(16_000, 24_000, 44_100, 48_000)) {
      "Unsupported PCM sample rate."
    }
    require(options.frameDurationMs in setOf(10, 20, 40)) {
      "Frame duration must be 10, 20, or 40 ms."
    }

    if (isActive) {
      stopSession("stopped")
    }

    sampleRate = options.sampleRate
    frameDurationMs = options.frameDurationMs
    isMuted = options.muted

    val inputChannel = AudioFormat.CHANNEL_IN_MONO
    val outputChannel = AudioFormat.CHANNEL_OUT_MONO
    val encoding = AudioFormat.ENCODING_PCM_16BIT
    val captureChunkBytes = sampleRate * frameDurationMs / 1_000 * 2
    val minimumRecordBuffer = AudioRecord.getMinBufferSize(
      sampleRate,
      inputChannel,
      encoding
    )
    val minimumTrackBuffer = AudioTrack.getMinBufferSize(
      sampleRate,
      outputChannel,
      encoding
    )
    check(minimumRecordBuffer > 0 && minimumTrackBuffer > 0) {
      "The requested PCM format is not supported by this device."
    }
    val recordBufferBytes = max(
      minimumRecordBuffer,
      captureChunkBytes * 4
    )
    val trackBufferBytes = max(
      minimumTrackBuffer,
      captureChunkBytes * 4
    )

    val record = AudioRecord.Builder()
      .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(encoding)
          .setSampleRate(sampleRate)
          .setChannelMask(inputChannel)
          .build()
      )
      .setBufferSizeInBytes(recordBufferBytes)
      .build()
    check(record.state == AudioRecord.STATE_INITIALIZED) {
      record.release()
      "Could not initialize VOICE_COMMUNICATION microphone capture."
    }

    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(encoding)
          .setSampleRate(sampleRate)
          .setChannelMask(outputChannel)
          .build()
      )
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(trackBufferBytes)
      .build()
    check(track.state == AudioTrack.STATE_INITIALIZED) {
      record.release()
      track.release()
      "Could not initialize voice communication playback."
    }

    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    audioManager = manager
    previousAudioMode = manager.mode
    previousSpeakerphoneOn = manager.isSpeakerphoneOn
    manager.mode = AudioManager.MODE_IN_COMMUNICATION
    manager.isSpeakerphoneOn = options.speaker
    @Suppress("DEPRECATION")
    manager.requestAudioFocus(
      null,
      AudioManager.STREAM_VOICE_CALL,
      AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
    )

    audioRecord = record
    audioTrack = track
    if (AcousticEchoCanceler.isAvailable()) {
      echoCanceler = AcousticEchoCanceler.create(record.audioSessionId)?.apply {
        enabled = true
      }
    }
    if (NoiseSuppressor.isAvailable()) {
      noiseSuppressor = NoiseSuppressor.create(record.audioSessionId)?.apply {
        enabled = true
      }
    }

    playbackQueue.clear()
    playbackGeneration.incrementAndGet()
    enqueuedFrames.set(0)
    queuedFrames.set(0)
    playbackState = "idle"
    isActive = true

    record.startRecording()
    track.play()
    startCaptureThread(record, captureChunkBytes)
    startPlaybackThread(track, captureChunkBytes)
    emitSessionState("started")
  }

  private fun startCaptureThread(record: AudioRecord, chunkBytes: Int) {
    captureThread = thread(
      start = true,
      name = "ExpoDuplexAudio-Capture",
      priority = Thread.MAX_PRIORITY
    ) {
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
      val buffer = ByteArray(chunkBytes)
      while (isActive && !Thread.currentThread().isInterrupted) {
        val bytesRead = record.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
        if (bytesRead > 0) {
          if (!isMuted) {
            sendEvent(
              "audioInput",
              mapOf(
                "data" to Base64.encodeToString(
                  buffer.copyOf(bytesRead),
                  Base64.NO_WRAP
                ),
                "encoding" to "pcm_s16le",
                "sampleRate" to sampleRate,
                "channels" to 1,
                "frames" to bytesRead / 2,
                "timestampMs" to System.nanoTime() / 1_000_000.0
              )
            )
          }
        } else if (bytesRead < 0) {
          emitError(
            "capture_read_failed",
            "AudioRecord.read failed with code $bytesRead.",
            fatal = true
          )
          break
        }
      }
    }
  }

  private fun startPlaybackThread(track: AudioTrack, writeChunkBytes: Int) {
    playbackThread = thread(
      start = true,
      name = "ExpoDuplexAudio-Playback",
      priority = Thread.MAX_PRIORITY
    ) {
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
      var baselineHead = playbackHead(track)
      var currentGeneration = playbackGeneration.get()
      var current: PlaybackChunk? = null
      var offset = 0

      while (isActive && !Thread.currentThread().isInterrupted) {
        val generation = playbackGeneration.get()
        if (generation != currentGeneration) {
          currentGeneration = generation
          baselineHead = playbackHead(track)
          current = null
          offset = 0
        }

        if (current == null) {
          current = playbackQueue.poll(10, TimeUnit.MILLISECONDS)
          offset = 0
        }

        val chunk = current
        if (chunk != null) {
          if (chunk.generation != currentGeneration) {
            current = null
            continue
          }
          val bytesToWrite = minOf(writeChunkBytes, chunk.bytes.size - offset)
          val written = track.write(
            chunk.bytes,
            offset,
            bytesToWrite,
            AudioTrack.WRITE_BLOCKING
          )
          if (written < 0) {
            emitError(
              "playback_write_failed",
              "AudioTrack.write failed with code $written.",
              fatal = true
            )
            break
          }
          offset += written
          if (offset >= chunk.bytes.size) {
            current = null
          }
        }

        val playedFrames = playbackHead(track) - baselineHead
        val remaining = max(0L, enqueuedFrames.get() - playedFrames)
        queuedFrames.set(remaining)
        if (
          remaining == 0L &&
          playbackQueue.isEmpty() &&
          current == null &&
          playbackState == "playing"
        ) {
          playbackState = "idle"
          emitPlaybackState("idle", "completed")
        }
      }
    }
  }

  private fun enqueuePlayback(base64Pcm: String) {
    check(isActive) {
      "Start the duplex audio session before enqueueing playback."
    }
    val bytes = try {
      Base64.decode(base64Pcm, Base64.DEFAULT)
    } catch (_: IllegalArgumentException) {
      throw IllegalArgumentException("Playback must be valid base64 PCM.")
    }
    require(bytes.isNotEmpty()) {
      "Playback PCM must not be empty."
    }
    require(bytes.size % 2 == 0) {
      "PCM byte length must be aligned to signed 16-bit samples."
    }

    val frames = bytes.size / 2L
    // Keep live Coach speech low-latency under bursty cellular/Wi-Fi delivery.
    // Old queued output is worse than a clipped phrase: it becomes stale
    // speaker audio that can leak back into an always-open microphone.
    // Streaming PCM may arrive in brief bursts. Keep valid contiguous speech
    // queued rather than clearing the middle of a sentence; real barge-in
    // still clears playback immediately.
    val maxQueuedFrames = sampleRate.toLong() * 5_000L / 1_000L
    if (queuedFrames.get() + frames > maxQueuedFrames) {
      clearPlayback("latency_budget_exceeded", restartTrack = true)
    }
    val wasIdle = playbackState == "idle"
    enqueuedFrames.addAndGet(frames)
    queuedFrames.addAndGet(frames)
    playbackQueue.put(PlaybackChunk(bytes, playbackGeneration.get()))
    if (wasIdle) {
      playbackState = "playing"
      emitPlaybackState("playing", "started")
    }
  }

  private fun clearPlayback(reason: String, restartTrack: Boolean) {
    val track = audioTrack
    playbackGeneration.incrementAndGet()
    playbackQueue.clear()
    enqueuedFrames.set(0)
    queuedFrames.set(0)
    playbackState = "idle"

    if (track != null && track.state == AudioTrack.STATE_INITIALIZED) {
      try {
        track.pause()
        track.flush()
        if (restartTrack && isActive) {
          track.play()
        }
      } catch (_: IllegalStateException) {
        // The session is concurrently shutting down.
      }
    }
    emitPlaybackState("idle", reason)
  }

  private fun stopSession(reason: String) {
    if (!isActive && audioRecord == null && audioTrack == null) {
      return
    }

    clearPlayback("session_stopped", restartTrack = false)
    isActive = false

    val record = audioRecord
    val track = audioTrack
    try {
      record?.stop()
    } catch (_: IllegalStateException) {
      // Already stopped.
    }
    try {
      track?.stop()
    } catch (_: IllegalStateException) {
      // Already stopped.
    }

    captureThread?.interrupt()
    playbackThread?.interrupt()
    if (Thread.currentThread() !== captureThread) {
      captureThread?.join(250)
    }
    if (Thread.currentThread() !== playbackThread) {
      playbackThread?.join(250)
    }
    captureThread = null
    playbackThread = null

    echoCanceler?.release()
    echoCanceler = null
    noiseSuppressor?.release()
    noiseSuppressor = null
    record?.release()
    track?.release()
    audioRecord = null
    audioTrack = null

    audioManager?.let { manager ->
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(null)
      manager.isSpeakerphoneOn = previousSpeakerphoneOn
      manager.mode = previousAudioMode
    }
    audioManager = null
    sendEvent("sessionStateChanged", state(reason))
  }

  private fun playbackHead(track: AudioTrack): Long =
    track.playbackHeadPosition.toLong() and 0xffffffffL

  private fun state(reason: String? = null): Map<String, Any> {
    val result = mutableMapOf<String, Any>(
      "session" to if (isActive) "active" else "inactive",
      "playback" to playbackState,
      "sampleRate" to sampleRate,
      "frameDurationMs" to frameDurationMs,
      "muted" to isMuted,
      "queuedFrames" to queuedFrames.get()
    )
    if (reason != null) {
      result["reason"] = reason
    }
    return result
  }

  private fun emitSessionState(reason: String) {
    sendEvent("sessionStateChanged", state(reason))
  }

  private fun emitPlaybackState(state: String, reason: String) {
    sendEvent(
      "playbackStateChanged",
      mapOf(
        "state" to state,
        "queuedFrames" to queuedFrames.get(),
        "reason" to reason
      )
    )
  }

  private fun emitError(code: String, message: String, fatal: Boolean) {
    sendEvent(
      "error",
      mapOf(
        "code" to code,
        "message" to message,
        "fatal" to fatal
      )
    )
  }
}
