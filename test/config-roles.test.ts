import { describe, expect, it } from "vitest";
import { applyRunOverrides } from "../src/commands/run.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { cloneConfig, collectLegacyConfigWarnings, mergeConfig, parseConfigText } from "../src/config/read.js";
import { serializeConfig } from "../src/config/write.js";

describe("config roles, ui, access, subagents", () => {
  it("ships sensible defaults", () => {
    expect(DEFAULT_CONFIG.roles.orchestrator).toEqual({
      adapter: "kiro",
      model: "claude-opus-4.8",
      effort: "default",
    });
    expect(DEFAULT_CONFIG.roles.worker).toEqual({
      adapter: "grok",
      model: "grok-composer-2.5-fast",
      effort: "default",
    });
    expect(DEFAULT_CONFIG.ui).toEqual({ theme: "mono", mode: "build", banner: true, confirm_before_run: true });
    expect(DEFAULT_CONFIG.access).toEqual({
      approval: "on-failure",
      sandbox: "workspace-write",
      network: false,
    });
    expect(DEFAULT_CONFIG.subagents).toEqual({ enabled: true, max_parallel: 4 });
  });

  it("serializes the new sections", () => {
    const yaml = serializeConfig(DEFAULT_CONFIG);
    expect(yaml).toContain("orchestrator:");
    expect(yaml).toContain("worker:");
    expect(yaml).toContain("theme: mono");
    // backward-compatible fields remain
    expect(yaml).toContain("preferred: grok");
    expect(yaml).toContain("fallback: codex");
  });

  it("merges partial role/ui/access overrides onto defaults", () => {
    const config = mergeConfig({
      roles: { worker: { adapter: "codex", model: "gpt-5-codex" } } as never,
      ui: { mode: "plan" } as never,
      access: { sandbox: "read-only" } as never,
    });
    expect(config.roles.worker).toEqual({ adapter: "codex", model: "gpt-5-codex", effort: "default" });
    // orchestrator falls back to default
    expect(config.roles.orchestrator).toEqual(DEFAULT_CONFIG.roles.orchestrator);
    expect(config.ui.mode).toBe("plan");
    expect(config.ui.theme).toBe("mono");
    expect(config.access.sandbox).toBe("read-only");
  });

  it("strips legacy dry-run keys and reports warnings", () => {
    const warnings = collectLegacyConfigWarnings({
      access: { execution: "dry-run" } as never,
      worker: { dry_run: true } as never,
    });
    expect(warnings.length).toBe(2);
    const config = mergeConfig({
      access: { execution: "dry-run", approval: "never" } as never,
      worker: { dry_run: true, max_iterations: 5 } as never,
    });
    expect((config.access as Record<string, unknown>).execution).toBeUndefined();
    expect((config.worker as Record<string, unknown>).dry_run).toBeUndefined();
    expect(config.worker.max_iterations).toBe(5);
  });

  it("rejects empty --cwd and --session-id overrides", () => {
    const config = cloneConfig();
    const cwdResult = applyRunOverrides(config, { cwd: "  " });
    expect(cwdResult.errors).toContain('Invalid --cwd "  " (expected a non-empty directory).');

    const sessionResult = applyRunOverrides(config, { sessionId: "" });
    expect(sessionResult.errors).toContain('Invalid --session-id "" (expected a non-empty session id).');
  });

  it("parses role specs case-insensitively", () => {
    const config = cloneConfig();
    const { config: updated } = applyRunOverrides(config, { worker: "Grok:grok-fast" });
    expect(updated.roles.worker.adapter).toBe("grok");
    expect(updated.roles.worker.model).toBe("grok-fast");
  });

  it("preserves role effort when CLI overrides adapter:model", () => {
    const config = cloneConfig();
    config.roles.orchestrator.effort = "high";
    const { config: updated } = applyRunOverrides(config, { orchestrator: "claude:opus" });
    expect(updated.roles.orchestrator).toEqual({
      adapter: "claude",
      model: "opus",
      effort: "high",
    });
  });

  it("reads a legacy config without the new sections", () => {
    const config = parseConfigText("version: 1\nadapters:\n  preferred: claude\n");
    expect(config.adapters.preferred).toBe("claude");
    expect(config.roles.orchestrator).toEqual(DEFAULT_CONFIG.roles.orchestrator);
    expect(config.ui.theme).toBe("mono");
    expect(config.subagents.max_parallel).toBe(4);
  });
});
