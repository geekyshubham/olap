import { describe, expect, it } from "vitest";
import { createAgentStream } from "../src/run/agent-stream.js";
import type { AgentActivity, AgentChunk } from "../src/run/agent-output.js";

function collect() {
  const chunks: AgentChunk[] = [];
  const activity: AgentActivity[] = [];
  const stream = createAgentStream({
    onChunk: (c) => chunks.push(c),
    onActivity: (a) => activity.push(a),
  });
  return { chunks, activity, stream };
}

describe("createAgentStream", () => {
  it("reassembles pretty-printed JSON split across many lines into one object", () => {
    const { chunks, stream } = collect();
    // This is the exact failure mode from the bug report: one object, many lines.
    const pretty = [
      "{",
      '  "text": "Searching the codebase...",',
      '  "thought": "The user wants me to remove a line",',
      '  "stopReason": "EndTurn"',
      "}",
    ];
    for (const line of pretty) stream.push(line);
    stream.flush();

    // One coherent object → a thought + a text chunk, NOT 5 raw shards.
    expect(chunks.filter((c) => c.kind === "text")).toHaveLength(1);
    expect(chunks.find((c) => c.kind === "text")?.content).toContain("Searching the codebase");
    expect(chunks.find((c) => c.kind === "thought")?.content).toContain("remove a line");
    // No shard should be the bare "{" or a dangling key fragment.
    expect(chunks.some((c) => c.content.trim() === "{")).toBe(false);
  });

  it("extracts tool/file/stopReason activity from a tool call", () => {
    const { activity, stream } = collect();
    stream.push('{"type":"tool_use","name":"edit","input":{"path":"src/tui/components.ts"}}');
    stream.flush();
    const merged = activity.at(-1);
    expect(merged?.tool).toBe("edit");
    expect(merged?.file).toBe("src/tui/components.ts");
  });

  it("handles NDJSON (one object per line) without buffering across objects", () => {
    const { chunks, stream } = collect();
    stream.push('{"text":"line one"}');
    stream.push('{"text":"line two"}');
    stream.flush();
    const texts = chunks.filter((c) => c.kind === "text").map((c) => c.content);
    expect(texts).toEqual(["line one", "line two"]);
  });

  it("passes through interleaved plain text immediately", () => {
    const { chunks, stream } = collect();
    stream.push("applying patch...");
    stream.push('{"text":"done"}');
    stream.flush();
    expect(chunks[0]).toEqual({ kind: "text", content: "applying patch..." });
    expect(chunks.at(-1)?.content).toBe("done");
  });

  it("keeps an aborted stopReason when a later completion reason arrives", () => {
    const { activity, stream } = collect();
    stream.push(JSON.stringify({ stopReason: "Cancelled", text: "aborting" }));
    stream.push(JSON.stringify({ stopReason: "end_turn", text: "done" }));
    stream.flush();
    expect(activity.some((a) => a.stopReason === "Cancelled")).toBe(true);
  });

  it("does not lose a trailing object without a closing newline (flush)", () => {
    const { chunks, stream } = collect();
    stream.push("{");
    stream.push('  "text": "tail"');
    stream.push("}");
    // no extra push; rely on flush
    stream.flush();
    expect(chunks.find((c) => c.kind === "text")?.content).toBe("tail");
  });
});
