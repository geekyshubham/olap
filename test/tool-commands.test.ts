import { describe, expect, it } from "vitest";
import { buildToolInvocation, formatToolCommand } from "../src/commands/tools.js";

describe("tool commands", () => {
  it("defaults /graphify to mapping the current directory", () => {
    const invocation = buildToolInvocation("graphify", []);

    expect(invocation.binary).toBe("graphify");
    expect(invocation.argv).toEqual(["graphify", "."]);
    expect(formatToolCommand(invocation)).toBe("graphify .");
  });

  it("defaults /headroom to its performance report", () => {
    const invocation = buildToolInvocation("headroom", []);

    expect(invocation.binary).toBe("headroom");
    expect(invocation.argv).toEqual(["headroom", "perf"]);
    expect(formatToolCommand(invocation)).toBe("headroom perf");
  });

  it("passes explicit arguments through to the underlying tool", () => {
    const graphify = buildToolInvocation("graphify", ["src", "--no-open"]);
    const headroom = buildToolInvocation("headroom", ["stats"]);

    expect(graphify.argv).toEqual(["graphify", "src", "--no-open"]);
    expect(formatToolCommand(graphify)).toBe("graphify src --no-open");
    expect(headroom.argv).toEqual(["headroom", "stats"]);
  });
});
