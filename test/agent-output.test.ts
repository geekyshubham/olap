import { describe, expect, it } from "vitest";
import { parseAgentOutputLine } from "../src/run/agent-output.js";

describe("parseAgentOutputLine", () => {
  it("extracts text and thought from grok-style JSON", () => {
    const chunks = parseAgentOutputLine(
      JSON.stringify({
        text: "Running npm publish",
        thought: "Checking git status first",
        stopReason: "EndTurn",
      }),
    );
    expect(chunks.map((c) => c.kind)).toEqual(["thought", "text"]);
    expect(chunks.find((c) => c.kind === "text")?.content).toContain("npm publish");
  });

  it("falls back to plain text for non-JSON lines", () => {
    const chunks = parseAgentOutputLine("applying patch...");
    expect(chunks).toEqual([{ kind: "text", content: "applying patch..." }]);
  });

  it("summarizes tool calls", () => {
    const chunks = parseAgentOutputLine(
      JSON.stringify({ type: "tool_call", name: "bash", input: { command: "git push" } }),
    );
    expect(chunks[0]).toEqual({ kind: "tool", content: "bash({\"command\":\"git push\"})" });
  });
});