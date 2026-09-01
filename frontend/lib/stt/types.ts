export interface StreamingSttTurn {
  turnOrder: number;
  transcript: string;
  endOfTurn: boolean;
}

export interface StreamingSttClient {
  readonly isOpen: boolean;
  connect(): Promise<void>;
  sendAudio(base64Pcm: string): void;
  close(): void;
}

export interface StreamingSttCallbacks {
  onSpeechStarted: () => void;
  onPartial: (turn: StreamingSttTurn) => void;
  onTurn: (turn: StreamingSttTurn) => void;
  onServerActivity?: () => void;
  onError: (error: Error) => void;
  onClose: (error: Error) => void;
}
