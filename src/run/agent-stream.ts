import {
  interpretAgentValue,
  parseAgentOutputLine,
  type AgentActivity,
  type AgentChunk,
} from "./agent-output.js";

export interface AgentStreamHandlers {
  /** Emitted for each human-readable chunk (text/thought/tool/status/error). */
  onChunk: (chunk: AgentChunk) => void;
  /** Emitted when side-channel activity (tool/file/stopReason) is detected. */
  onActivity?: (activity: AgentActivity) => void;
}

export interface AgentStream {
  /** Feed one line of CLI output (newlines already stripped). */
  push: (line: string) => void;
  /** Flush any buffered partial JSON at end-of-stream. */
  flush: () => void;
}

// Guard rails so a malformed/never-closing JSON blob can't buffer forever.
const MAX_BUFFER_LINES = 2000;
const MAX_BUFFER_CHARS = 1_000_000;

/**
 * Reassembles pretty-printed JSON that a CLI emits across multiple stdout lines
 * into single objects before interpreting them. Without this, a worker that
 * prints
 *
 *   {
 *     "text": "Searching the codebase...",
 *     "stopReason": "EndTurn"
 *   }
 *
 * would be parsed line-by-line and rendered as unreadable JSON shards. NDJSON
 * (one object per line) and interleaved plain text still work.
 */
export function createAgentStream(handlers: AgentStreamHandlers): AgentStream {
  const buffer: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let opened = false;

  const reset = (): void => {
    buffer.length = 0;
    depth = 0;
    inString = false;
    escaped = false;
    opened = false;
  };

  const emitValue = (value: unknown): void => {
    const { chunks, activity } = interpretAgentValue(value);
    for (const chunk of chunks) handlers.onChunk(chunk);
    if (handlers.onActivity && (activity.tool || activity.file || activity.stopReason)) {
      handlers.onActivity(activity);
    }
  };

  const emitText = (text: string): void => {
    for (const chunk of parseAgentOutputLine(text)) handlers.onChunk(chunk);
  };

  const flushBufferAsText = (): void => {
    if (buffer.length === 0) return;
    const joined = buffer.join("\n");
    reset();
    // Best effort: try the whole blob as one value, else fall back to per-line.
    const trimmed = joined.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        emitValue(JSON.parse(trimmed));
        return;
      } catch {
        // not valid JSON after all
      }
    }
    for (const line of joined.split("\n")) {
      if (line.trim()) emitText(line);
    }
  };

  const scan = (line: string): void => {
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString) {
        if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        depth += 1;
        opened = true;
      } else if (char === "}" || char === "]") {
        depth -= 1;
      }
    }
  };

  const push = (rawLine: string): void => {
    const line = rawLine.replace(/\r$/, "");

    // Not currently inside a JSON value: decide how to treat this line.
    if (buffer.length === 0) {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        // Plain text (or single-line JSON embedded in text) — handle immediately.
        emitText(line);
        return;
      }
    }

    buffer.push(line);
    scan(line);

    if (opened && depth <= 0) {
      const joined = buffer.join("\n").trim();
      reset();
      try {
        emitValue(JSON.parse(joined));
      } catch {
        // Closed braces but not parseable (e.g. trailing junk) — treat as text.
        for (const l of joined.split("\n")) {
          if (l.trim()) emitText(l);
        }
      }
      return;
    }

    // Runaway buffer protection.
    const totalChars = buffer.reduce((n, l) => n + l.length + 1, 0);
    if (buffer.length > MAX_BUFFER_LINES || totalChars > MAX_BUFFER_CHARS) {
      flushBufferAsText();
    }
  };

  return { push, flush: flushBufferAsText };
}
