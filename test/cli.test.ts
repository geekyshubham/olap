import { describe, expect, it } from "vitest";
import { createCliProgram } from "../src/cli.js";
import type { ToolName, ToolRunResult } from "../src/commands/tools.js";

function okToolResult(name: ToolName, args: string[]): ToolRunResult {
  return {
    tool: name,
    command: `${name} ${args.join(" ")}`.trim(),
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    installHint: "",
    missingBinary: false,
  };
}

describe("cli", () => {
  it("starts the TUI when no command is provided", async () => {
    let started = false;
    const program = createCliProgram({
      startTui: async () => {
        started = true;
      },
    });

    await program.parseAsync(["node", "olap"], { from: "node" });

    expect(started).toBe(true);
  });

  it("routes graphify and headroom subcommands to the tool runner", async () => {
    const calls: Array<{ name: ToolName; args: string[] }> = [];
    const program = createCliProgram({
      startTui: async () => undefined,
      runToolCommand: async (name, args) => {
        calls.push({ name, args });
        return okToolResult(name, args);
      },
    });

    await program.parseAsync(["node", "olap", "graphify"], { from: "node" });
    await program.parseAsync(["node", "olap", "headroom", "stats"], { from: "node" });

    expect(calls).toEqual([
      { name: "graphify", args: [] },
      { name: "headroom", args: ["stats"] },
    ]);
  });
});
