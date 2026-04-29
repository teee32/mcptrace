/**
 * Streaming newline-delimited JSON parser.
 *
 * Tolerates:
 *  - chunks split mid-line
 *  - multiple JSON objects in one chunk
 *  - blank lines (skipped silently)
 *  - lines that are not valid JSON (reported via onError)
 */
export interface NdjsonHandlers {
  onMessage: (value: unknown, rawLine: string) => void;
  onError?: (err: Error, rawLine: string) => void;
}

export class NdjsonParser {
  private buffer = "";

  constructor(private readonly handlers: NdjsonHandlers) {}

  feed(chunk: string | Buffer): void {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.handleLine(line);
    }
  }

  /** Flush any remaining buffered text as a final line. */
  flush(): void {
    if (this.buffer.length > 0) {
      const line = this.buffer;
      this.buffer = "";
      this.handleLine(line);
    }
  }

  private handleLine(rawLine: string): void {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line.length === 0) return;

    try {
      const value = JSON.parse(line);
      this.handlers.onMessage(value, line);
    } catch (err) {
      this.handlers.onError?.(err as Error, line);
    }
  }
}
