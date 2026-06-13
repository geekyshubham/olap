export type AgentChunkKind = "text" | "thought" | "tool" | "status" | "error";

export interface AgentChunk {
  kind: AgentChunkKind;
  content: string;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function toolSummary(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = asString(record.name ?? record.tool ?? record.type);
  const input = record.input ?? record.arguments ?? record.args;
  if (name && input !== undefined) {
    const brief =
      typeof input === "string"
        ? input
        : JSON.stringify(input);
    return `${name}(${brief.length > 120 ? `${brief.slice(0, 117)}...` : brief})`;
  }
  if (name) return name;
  return undefined;
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

/** Turn one CLI stdout/stderr line into human-readable agent chunks (Grok/Claude/Codex JSON). */
export function parseAgentOutputLine(line: string): AgentChunk[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return [{ kind: "text", content: trimmed }];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) =>
        item && typeof item === "object"
          ? chunksFromRecord(item as Record<string, unknown>)
          : [],
      );
    }
    if (parsed && typeof parsed === "object") {
      const chunks = chunksFromRecord(parsed as Record<string, unknown>);
      if (chunks.length > 0) return chunks;
    }
  } catch {
    // fall through to raw text
  }

  return [{ kind: "text", content: trimmed }];
}