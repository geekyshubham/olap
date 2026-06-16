import { describe, expect, it } from "vitest";
import {
  buildAdapterCommands,
  buildArchitectCommand,
  buildRoleCommands,
  buildWorkerCommand,
  codexApproval,
  codexSandbox,
  commandForPhase,
  finalizeAdapterCommand,
  geminiApprovalMode,
  permissionMode,
  resolveRoles,
} from "../src/adapters/build.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AccessConfig, OlapConfig } from "../src/types.js";

function withAccess(access: Partial<AccessConfig>): OlapConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.access = { ...config.access, ...access };
  return config;
}

describe("adapter command builders", () => {
  it("builds kiro orchestrator and grok worker commands from hybrid role config", () => {
    const grokDet = { id: "grok" as const, detected: true, binary: "/bin/grok" };
    const kiroDet = { id: "kiro" as const, detected: true, binary: "/bin/kiro-cli" };
    const architect = finalizeAdapterCommand(
      buildArchitectCommand("kiro", "review task", DEFAULT_CONFIG, kiroDet),
    );
    const worker = finalizeAdapterCommand(
      buildWorkerCommand("grok", "implement task", DEFAULT_CONFIG, grokDet),
    );

    expect(architect.argv).toContain("chat");
    expect(architect.argv).toContain("--model");
    expect(architect.argv).toContain("claude-opus-4.8");
    expect(architect.shell).toContain("/bin/kiro-cli");
    expect(worker.argv).toContain("grok-composer-2.5-fast");
    expect(worker.argv).toContain("-p");
    expect(worker.shell).toContain("/bin/grok");
  });

  it("maps access policy into per-adapter permission args", () => {
    expect(permissionMode({ approval: "never", sandbox: "workspace-write", network: false })).toBe(
      "bypassPermissions",
    );
    expect(permissionMode({ approval: "on-failure", sandbox: "read-only", network: false })).toBe(
      "plan",
    );
    expect(permissionMode({ approval: "untrusted", sandbox: "workspace-write", network: false })).toBe(
      "default",
    );
    expect(permissionMode({ approval: "on-failure", sandbox: "danger-full-access", network: false })).toBe(
      "bypassPermissions",
    );
    expect(geminiApprovalMode({ approval: "never", sandbox: "workspace-write", network: false })).toBe(
      "yolo",
    );
    expect(codexSandbox(DEFAULT_CONFIG.access)).toBe("workspace-write");
    expect(codexApproval(DEFAULT_CONFIG.access)).toBe("on-failure");
  });

  it("adds codex network override only when network + workspace-write", () => {
    const networked = finalizeAdapterCommand(
      buildWorkerCommand("codex", "task", withAccess({ network: true, sandbox: "workspace-write" })),
    );
    expect(networked.argv).toContain("sandbox_workspace_write.network_access=true");

    const offline = finalizeAdapterCommand(buildWorkerCommand("codex", "task", DEFAULT_CONFIG));
    expect(offline.argv).not.toContain("sandbox_workspace_write.network_access=true");
    expect(offline.argv).toContain("workspace-write");
    expect(offline.argv).toContain("on-failure");
  });

  it("builds distinct worker commands for claude, gemini, and codex", () => {
    for (const adapter of ["claude", "gemini", "codex"] as const) {
      const cmd = finalizeAdapterCommand(buildWorkerCommand(adapter, "task", DEFAULT_CONFIG));
      expect(cmd.adapter).toBe(adapter);
      expect(cmd.shell.length).toBeGreaterThan(0);
      expect(cmd.executed).toBeUndefined();
    }
  });

  it("builds ollama local text commands", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.roles.orchestrator = { adapter: "ollama", model: "qwen2.5-coder:7b" };
    config.roles.worker = { adapter: "ollama", model: "qwen2.5-coder:7b" };
    const detection = { id: "ollama" as const, detected: true, binary: "/bin/ollama" };

    const architect = finalizeAdapterCommand(
      buildArchitectCommand("ollama", "plan this", config, detection),
    );
    const worker = finalizeAdapterCommand(
      buildWorkerCommand("ollama", "write this", config, detection),
    );

    expect(architect.argv).toEqual(["/bin/ollama", "run", "qwen2.5-coder:7b", "plan this"]);
    expect(worker.argv).toEqual(["/bin/ollama", "run", "qwen2.5-coder:7b", "write this"]);
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
  });

  it("resolves roles and builds role-based commands with mixed adapters", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.roles.orchestrator = { adapter: "claude", model: "opus" };
    config.roles.worker = { adapter: "grok", model: "grok-code-fast-1" };
    const detections = [
      { id: "grok" as const, detected: true, binary: "/bin/grok" },
      { id: "claude" as const, detected: false },
      { id: "gemini" as const, detected: false },
      { id: "codex" as const, detected: false },
    ];

    const roles = resolveRoles(config, detections);
    expect(roles.orchestrator.adapter).toBe("claude");
    expect(roles.orchestrator.available).toBe(false);
    expect(roles.worker.adapter).toBe("grok");
    expect(roles.worker.available).toBe(true);

    const { commands } = buildRoleCommands({
      config,
      detections,
      task: "implement",
      architectPrompt: "review",
    });
    expect(commandForPhase(commands, "architect")?.adapter).toBe("claude");
    expect(commandForPhase(commands, "worker")?.adapter).toBe("grok");
  });
});
