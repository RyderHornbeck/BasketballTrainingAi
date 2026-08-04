export async function consumeNdjsonStream<T>(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void | Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const drain = async (final = false) => {
    const lines = buffer.split(/\r?\n/);
    buffer = final ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      await onEvent(JSON.parse(line) as T);
    }
    if (final && buffer.trim()) {
      await onEvent(JSON.parse(buffer) as T);
      buffer = "";
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    await drain();
  }
  buffer += decoder.decode();
  const last = buffer;
  buffer = `${last}\n`;
  await drain(true);
}
