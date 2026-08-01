import {
  requireOptionalNativeModule,
  type EventSubscription,
} from "expo-modules-core";

export type StreamingPcmEventName =
  | "started"
  | "firstByte"
  | "firstAudio"
  | "finished"
  | "error"
  | "cancelled";

export interface StreamingPcmSpeakOptions {
  url: string;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  /** Exact deterministic text, used only to derive the cache key. */
  text: string;
  voice: string;
  model: string;
  requestId?: string;
  useCache?: boolean;
}

export interface StreamingPcmEvent {
  requestId: string;
}

export interface StreamingPcmErrorEvent extends StreamingPcmEvent {
  code: string;
  message: string;
}

type StreamingPcmEvents = {
  started: (event: StreamingPcmEvent) => void;
  firstByte: (event: StreamingPcmEvent) => void;
  firstAudio: (event: StreamingPcmEvent) => void;
  finished: (event: StreamingPcmEvent) => void;
  error: (event: StreamingPcmErrorEvent) => void;
  cancelled: (event: StreamingPcmEvent) => void;
};

interface NativeStreamingPcmPlayer {
  addListener<Name extends keyof StreamingPcmEvents>(
    eventName: Name,
    listener: StreamingPcmEvents[Name]
  ): EventSubscription;
  speak(options: {
    url: string;
    headers: Record<string, string>;
    body: string;
    text: string;
    voice: string;
    model: string;
    requestId?: string;
    useCache: boolean;
  }): string;
  prefetch(options: {
    url: string;
    headers: Record<string, string>;
    body: string;
    text: string;
    voice: string;
    model: string;
    requestId?: string;
    useCache: boolean;
  }): string;
  cancel(requestId?: string): void;
  clear(): void;
}

const nativePlayer =
  requireOptionalNativeModule<NativeStreamingPcmPlayer>(
    "ExpoStreamingPcmPlayer"
  );

export const isStreamingPcmPlayerAvailable = nativePlayer != null;

export function speakStreamingPcm(
  options: StreamingPcmSpeakOptions
): string | null {
  if (!nativePlayer) return null;

  try {
    return nativePlayer.speak({
      ...options,
      headers: options.headers ?? {},
      body: JSON.stringify(options.body),
      useCache: options.useCache ?? true,
    });
  } catch {
    // A stale Expo Go/dev-client build must not break the voice router.
    return null;
  }
}

export function prefetchStreamingPcm(
  options: StreamingPcmSpeakOptions
): string | null {
  if (!nativePlayer) return null;
  try {
    return nativePlayer.prefetch({
      ...options,
      headers: options.headers ?? {},
      body: JSON.stringify(options.body),
      useCache: true,
    });
  } catch {
    return null;
  }
}

export function cancelStreamingPcm(requestId?: string): void {
  try {
    nativePlayer?.cancel(requestId);
  } catch {
    // Native playback is an optional enhancement.
  }
}

export function clearStreamingPcmCache(): void {
  try {
    nativePlayer?.clear();
  } catch {
    // Native playback is an optional enhancement.
  }
}

export function addStreamingPcmListener<Name extends StreamingPcmEventName>(
  eventName: Name,
  listener: StreamingPcmEvents[Name]
): EventSubscription {
  if (!nativePlayer) {
    return { remove() {} };
  }
  return nativePlayer.addListener(eventName, listener);
}
