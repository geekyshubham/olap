import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { collectLegacyConfigWarnings, mergeConfig, parseConfigText } from "../src/config/read.js";
import { serializeConfig } from "../src/config/write.js";

describe("config roles, ui, access, subagents", () => {
  it("ships sensible defaults", () => {
    expect(DEFAULT_CONFIG.roles.orchestrator).toEqual({
      adapter: "grok",
      model: "grok-composer-2.5-fast",
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
    expect(DEFAULT_CONFIG.subagents).toEqual({ enabled: true, max_parallel: 3 });
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

  it("reads a legacy config without the new sections", () => {
    const config = parseConfigText("version: 1\nadapters:\n  preferred: claude\n");
    expect(config.adapters.preferred).toBe("claude");
    expect(config.roles.orchestrator).toEqual(DEFAULT_CONFIG.roles.orchestrator);
    expect(config.ui.theme).toBe("mono");
    expect(config.subagents.max_parallel).toBe(3);
  });
});
