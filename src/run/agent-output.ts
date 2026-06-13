export type AgentChunkKind = "text" | "thought" | "tool" | "status" | "error";

export interface AgentChunk {
  kind: AgentChunkKind;
  content: string;
}

/** Side-channel signals extracted from agent JSON: what tool ran, which file, why it stopped. */
export interface AgentActivity {
  tool?: string;
  file?: string;
  stopReason?: string;
}

/** stopReasons that mean the worker did not finish its turn successfully. */
const ABORTED_STOP_REASONS = new Set([
  "cancelled",
  "canceled",
  "aborted",
  "abort",
  "error",
  "failed",
  "failure",
  "interrupted",
  "timeout",
  "timed_out",
]);

export function isAbortedStopReason(stopReason: string | undefined): boolean {
  if (!stopReason) return false;
  return ABORTED_STOP_REASONS.has(stopReason.trim().toLowerCase());
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

const FILE_KEYS = ["path", "file", "file_path", "filePath", "filename", "fileName", "target_file"];

function fileFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of FILE_KEYS) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function toolName(value: Record<string, unknown>): string | undefined {
  return asString(value.name ?? value.tool);
}

function toolSummary(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = toolName(record);
  const input = record.input ?? record.arguments ?? record.args;
  if (name && input !== undefined) {
    const brief = typeof input === "string" ? input : JSON.stringify(input);
    return `${name}(${brief.length > 120 ? `${brief.slice(0, 117)}...` : brief})`;
  }
  if (name) return name;
  return undefined;
}

/** Terminal turn-completion values allowed from a generic `status` field. */
const TERMINAL_STATUS_STOPS = new Set([
  "cancelled",
  "canceled",
  "aborted",
  "abort",
  "completed",
  "complete",
  "end_turn",
  "endturn",
  "stop",
  "done",
  "finished",
]);

function stopReasonFromRecord(record: Record<string, unknown>): string | undefined {
  const explicit = asString(record.stopReason ?? record.stop_reason);
  if (explicit) return explicit;
  const status = asString(record.status)?.toLowerCase();
  if (status && TERMINAL_STATUS_STOPS.has(status)) return status;
  return undefined;
}

function activityFromRecord(record: Record<string, unknown>): AgentActivity {
  const activity: AgentActivity = {};
  const stop = stopReasonFromRecord(record);
  if (stop) activity.stopReason = stop;

  const toolNode =
    (record.tool_call as Record<string, unknown> | undefined) ??
    (record.tool as Record<string, unknown> | undefined);
  const type = asString(record.type)?.toLowerCase();
  const isToolEvent =
    type === "tool_call" || type === "tool_use" || type === "function_call";

  if (toolNode && typeof toolNode === "object") {
    const name = toolName(toolNode);
    if (name) activity.tool = name;
    const input = toolNode.input ?? toolNode.arguments ?? toolNode.args;
    const file = fileFromInput(input);
    if (file) activity.file = file;
  } else if (isToolEvent) {
    const name = toolName(record);
    if (name) activity.tool = name;
    const input = record.input ?? record.arguments ?? record.args;
    const file = fileFromInput(input);
    if (file) activity.file = file;
  }
  return activity;
}

function mergeActivity(previous: AgentActivity, next: AgentActivity): AgentActivity {
  const merged = { ...previous, ...next };
  const previousStop = previous.stopReason;
  const nextStop = next.stopReason;
  if (isAbortedStopReason(previousStop) && !isAbortedStopReason(nextStop)) {
    merged.stopReason = previousStop;
  }
  return merged;
}

function chunksFromRecord(record: Record<string, unknown>): AgentChunk[] {
  const chunks: AgentChunk[] = [];
  const type = asString(record.type)?.toLowerCase();

  if (type === "tool_call" || type === "tool_use" || type === "function_call") {
    const summary = toolSummary(record) ?? toolSummary(record.tool_call) ?? toolSummary(record.tool);
    if (summary) chunks.push({ kind: "tool", content: summary });
    return chunks;
  }

  if (type === "thinking" || type === "thought") {
    const thought = asString(record.text ?? record.content ?? record.thought);
    if (thought) chunks.push({ kind: "thought", content: thought });
    return chunks;
  }

  const thought = asString(record.thought ?? record.reasoning);
  if (thought) chunks.push({ kind: "thought", content: thought });

  const text = asString(
    record.text ??
      record.message ??
      record.content ??
      record.output ??
      record.response,
  );
  if (text) chunks.push({ kind: "text", content: text });

  const tool = toolSummary(record.tool_call) ?? toolSummary(record.tool);
  if (tool) chunks.push({ kind: "tool", content: tool });

  const status = asString(record.status ?? record.stopReason ?? record.stop_reason);
  if (status && chunks.length === 0) chunks.push({ kind: "status", content: status });

  const error = asString(record.error ?? record.error_message);
  if (error) chunks.push({ kind: "error", content: error });

  return chunks;
}

/** Interpret one parsed agent JSON value into human-readable chunks + side-channel activity. */
export function interpretAgentValue(value: unknown): { chunks: AgentChunk[]; activity: AgentActivity } {
  if (Array.isArray(value)) {
    const chunks: AgentChunk[] = [];
    let activity: AgentActivity = {};
    for (const item of value) {
      if (item && typeof item === "object") {
        chunks.push(...chunksFromRecord(item as Record<string, unknown>));
        activity = mergeActivity(activity, activityFromRecord(item as Record<string, unknown>));
      }
    }
    return { chunks, activity };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return { chunks: chunksFromRecord(record), activity: activityFromRecord(record) };
  }
  return { chunks: [], activity: {} };
}

/** Turn one CLI stdout/stderr line into human-readable agent chunks (Grok/Claude/Codex JSON). */
export function parseAgentOutputLine(line: string): AgentChunk[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return [{ kind: "text", content: trimmed }];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const { chunks } = interpretAgentValue(parsed);
    if (chunks.length > 0) return chunks;
  } catch {
    // fall through to raw text
  }

  return [{ kind: "text", content: trimmed }];
}
