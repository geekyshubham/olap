import { describe, expect, it } from "vitest";
import {
  buildAdapterCommands,
  buildArchitectCommand,
  buildWorkerCommand,
  commandForPhase,
  finalizeAdapterCommand,
} from "../src/adapters/build.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("adapter command builders", () => {
  it("builds grok architect and worker commands from the real CLI shape", () => {
    const architect = finalizeAdapterCommand(
      buildArchitectCommand("grok", "review task", DEFAULT_CONFIG, {
        id: "grok",
        detected: true,
        binary: "/bin/grok",
      }),
    );
    const worker = finalizeAdapterCommand(
      buildWorkerCommand("grok", "implement task", DEFAULT_CONFIG, {
        id: "grok",
        detected: true,
        binary: "/bin/grok",
      }),
    );

    expect(architect.argv).toContain("--permission-mode");
    expect(architect.argv).toContain("plan");
    expect(architect.argv).toContain("--output-format");
    expect(architect.argv).toContain("json");
    expect(architect.argv).toContain("-p");
    expect(worker.argv).toContain("--permission-mode");
    expect(worker.argv).toContain("bypassPermissions");
    expect(worker.shell).toContain("/bin/grok");
  });

  it("builds distinct commands for claude, gemini, and codex", () => {
    for (const adapter of ["claude", "gemini", "codex"] as const) {
      const cmd = finalizeAdapterCommand(
        buildWorkerCommand(adapter, "task", DEFAULT_CONFIG),
      );
      expect(cmd.adapter).toBe(adapter);
      expect(cmd.shell.length).toBeGreaterThan(0);
      expect(cmd.dry_run).toBe(true);
    }
  });

  it("returns architect and worker commands via buildAdapterCommands", () => {
    const commands = buildAdapterCommands({
      adapterId: "codex",
      task: "ship feature",
      architectPrompt: "review",
      config: DEFAULT_CONFIG,
    });

    expect(commands).toHaveLength(2);
    expect(commandForPhase(commands, "architect")?.phase).toBe("architect");
    expect(commandForPhase(commands, "worker")?.phase).toBe("worker");
    expect(commands.every((c) => c.shell.length > 0)).toBe(true);
  });
});
