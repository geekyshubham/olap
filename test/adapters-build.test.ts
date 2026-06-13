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
  it("builds grok architect (plan) and worker commands using role models", () => {
    const detection = { id: "grok" as const, detected: true, binary: "/bin/grok" };
    const architect = finalizeAdapterCommand(
      buildArchitectCommand("grok", "review task", DEFAULT_CONFIG, detection),
    );
    const worker = finalizeAdapterCommand(
      buildWorkerCommand("grok", "implement task", DEFAULT_CONFIG, detection),
    );

    expect(architect.argv).toContain("--permission-mode");
    expect(architect.argv).toContain("plan");
    expect(architect.argv).toContain("--output-format");
    expect(architect.argv).toContain("json");
    expect(architect.argv).toContain("-p");
    // orchestrator role model
    expect(architect.argv).toContain("grok-4-latest");
    // worker role model + default access (on-failure/workspace-write) -> acceptEdits
    expect(worker.argv).toContain("grok-code-fast-1");
    expect(worker.argv).toContain("acceptEdits");
    expect(worker.shell).toContain("/bin/grok");
  });

  it("maps access policy into per-adapter permission args", () => {
    expect(permissionMode({ approval: "never", sandbox: "workspace-write", network: false, execution: "dry-run" })).toBe(
      "bypassPermissions",
    );
    expect(permissionMode({ approval: "on-failure", sandbox: "read-only", network: false, execution: "dry-run" })).toBe(
      "plan",
    );
    expect(permissionMode({ approval: "untrusted", sandbox: "workspace-write", network: false, execution: "dry-run" })).toBe(
      "default",
    );
    expect(permissionMode({ approval: "on-failure", sandbox: "danger-full-access", network: false, execution: "dry-run" })).toBe(
      "bypassPermissions",
    );
    expect(geminiApprovalMode({ approval: "never", sandbox: "workspace-write", network: false, execution: "dry-run" })).toBe(
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
