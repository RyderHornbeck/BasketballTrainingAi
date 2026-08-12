import {
  requireNativeModule,
  type EventSubscription,
} from "expo-modules-core";

export type PcmEncoding = "pcm_s16le";
export type DuplexSessionStatus = "inactive" | "active";
export type PlaybackStatus = "idle" | "playing";
export type PlaybackStateReason =
  | "started"
  | "completed"
  | "cleared"
  | "session_stopped";

export interface DuplexAudioSessionOptions {
  /** PCM sample rate used at the JavaScript boundary. Defaults to 24 kHz. */
  sampleRate?: 16000 | 24000 | 44100 | 48000;
  /** Capture event duration in milliseconds. Defaults to 20 ms. */
  frameDurationMs?: 10 | 20 | 40;
  /** Route call audio through the loudspeaker. Defaults to true. */
  speaker?: boolean;
  /** Start capture muted while keeping the duplex audio graph alive. */
  muted?: boolean;
}

export interface DuplexAudioState {
  session: DuplexSessionStatus;
  playback: PlaybackStatus;
  sampleRate: number;
  frameDurationMs: number;
  muted: boolean;
  queuedFrames: number;
}

export interface PermissionResponse {
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
  expires: "never";
}

export interface AudioInputEvent {
  data: string;
  encoding: PcmEncoding;
  sampleRate: number;
  channels: 1;
  frames: number;
  timestampMs: number;
}

export interface PlaybackStateEvent {
  state: PlaybackStatus;
  queuedFrames: number;
  reason: PlaybackStateReason;
}

export interface SessionStateEvent extends DuplexAudioState {
  reason: "started" | "muted_changed" | "stopped" | "interrupted" | "error";
}

export interface DuplexAudioErrorEvent {
  code: string;
  message: string;
  fatal: boolean;
}

export interface LocalPlaybackFinishedEvent {
  playbackId: string;
}

type DuplexAudioEvents = {
  audioInput: (event: AudioInputEvent) => void;
  playbackStateChanged: (event: PlaybackStateEvent) => void;
  sessionStateChanged: (event: SessionStateEvent) => void;
  error: (event: DuplexAudioErrorEvent) => void;
  localPlaybackFinished: (event: LocalPlaybackFinishedEvent) => void;
};

interface ExpoDuplexAudioNativeModule {
  addListener<EventName extends keyof DuplexAudioEvents>(
    eventName: EventName,
    listener: DuplexAudioEvents[EventName],
  ): EventSubscription;
  requestPermissionsAsync(): Promise<PermissionResponse>;
  getPermissionsAsync(): Promise<PermissionResponse>;
  startSessionAsync(
    options?: DuplexAudioSessionOptions,
  ): Promise<DuplexAudioState>;
  stopSessionAsync(): Promise<void>;
  setMutedAsync(muted: boolean): Promise<DuplexAudioState>;
  /** Enqueues headerless little-endian signed 16-bit mono PCM. */
  enqueuePlaybackAsync(base64Pcm: string): Promise<void>;
  /** Plays packaged local audio through the active voice-call output graph. */
  playLocalFilesAsync(uris: string[]): Promise<string>;
  /** Immediately drops queued audio and flushes audio already handed to output. */
  clearPlaybackAsync(): Promise<void>;
  getStateAsync(): Promise<DuplexAudioState>;
}

const nativeModule =
  requireNativeModule<ExpoDuplexAudioNativeModule>("ExpoDuplexAudio");

export const requestPermissionsAsync = () =>
  nativeModule.requestPermissionsAsync();
export const getPermissionsAsync = () => nativeModule.getPermissionsAsync();
export const startSessionAsync = (options: DuplexAudioSessionOptions = {}) =>
  nativeModule.startSessionAsync(options);
export const stopSessionAsync = () => nativeModule.stopSessionAsync();
export const setMutedAsync = (muted: boolean) =>
  nativeModule.setMutedAsync(muted);
export const enqueuePlaybackAsync = (base64Pcm: string) =>
  nativeModule.enqueuePlaybackAsync(base64Pcm);
export const playLocalFilesAsync = (uris: string[]) =>
  nativeModule.playLocalFilesAsync(uris);
export const clearPlaybackAsync = () => nativeModule.clearPlaybackAsync();
export const getStateAsync = () => nativeModule.getStateAsync();

export function addAudioInputListener(
  listener: DuplexAudioEvents["audioInput"],
): EventSubscription {
  return nativeModule.addListener("audioInput", listener);
}

export function addPlaybackStateListener(
  listener: DuplexAudioEvents["playbackStateChanged"],
): EventSubscription {
  return nativeModule.addListener("playbackStateChanged", listener);
}

export function addSessionStateListener(
  listener: DuplexAudioEvents["sessionStateChanged"],
): EventSubscription {
  return nativeModule.addListener("sessionStateChanged", listener);
}

export function addErrorListener(
  listener: DuplexAudioEvents["error"],
): EventSubscription {
  return nativeModule.addListener("error", listener);
}

export function addLocalPlaybackFinishedListener(
  listener: DuplexAudioEvents["localPlaybackFinished"],
): EventSubscription {
  return nativeModule.addListener("localPlaybackFinished", listener);
}
