import { describe, expect, it } from "vitest";
import {
  interpretAgentValue,
  isAbortedStopReason,
  parseAgentOutputLine,
} from "../src/run/agent-output.js";

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

describe("interpretAgentValue", () => {
  it("returns chunks plus activity (tool, file, stopReason)", () => {
    const { chunks, activity } = interpretAgentValue({
      type: "tool_use",
      name: "edit",
      input: { file_path: "src/app.ts" },
    });
    expect(chunks.some((c) => c.kind === "tool")).toBe(true);
    expect(activity.tool).toBe("edit");
    expect(activity.file).toBe("src/app.ts");
  });

  it("captures stopReason from explicit stop fields", () => {
    const { activity } = interpretAgentValue({ text: "x", stopReason: "Cancelled" });
    expect(activity.stopReason).toBe("Cancelled");
  });

  it("ignores tool-level status errors when inferring stopReason", () => {
    const { activity } = interpretAgentValue({
      type: "tool_result",
      status: "error",
      text: "tool failed",
    });
    expect(activity.stopReason).toBeUndefined();
  });

  it("accepts terminal status values as stopReason", () => {
    const { activity } = interpretAgentValue({ status: "end_turn" });
    expect(activity.stopReason).toBe("end_turn");
  });

  it("preserves an aborted stopReason inside event arrays", () => {
    const { activity } = interpretAgentValue([
      { text: "aborting", stopReason: "Cancelled" },
      { text: "cleanup complete", stopReason: "end_turn" },
    ]);
    expect(activity.stopReason).toBe("Cancelled");
  });

  it("does not treat plain text events as tool activity", () => {
    const { activity } = interpretAgentValue({ type: "text", text: "hello" });
    expect(activity.tool).toBeUndefined();
  });
});

describe("isAbortedStopReason", () => {
  it("treats cancel/abort/error/timeout as aborted", () => {
    for (const reason of ["Cancelled", "canceled", "aborted", "error", "timeout"]) {
      expect(isAbortedStopReason(reason), reason).toBe(true);
    }
  });

  it("treats normal completion reasons as not aborted", () => {
    for (const reason of ["EndTurn", "stop", "end_turn", "max_tokens", "length", undefined]) {
      expect(isAbortedStopReason(reason), String(reason)).toBe(false);
    }
  });
});
