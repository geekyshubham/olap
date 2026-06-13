import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { mergeConfig, parseConfigText } from "../src/config/read.js";
import { serializeConfig } from "../src/config/write.js";

describe("config roles, ui, access, subagents", () => {
  it("ships sensible defaults", () => {
    expect(DEFAULT_CONFIG.roles.orchestrator).toEqual({
      adapter: "grok",
      model: "grok-4-latest",
      effort: "default",
    });
    expect(DEFAULT_CONFIG.roles.worker).toEqual({
      adapter: "grok",
      model: "grok-code-fast-1",
      effort: "default",
    });
    expect(DEFAULT_CONFIG.ui).toEqual({ theme: "mono", mode: "build", banner: true });
    expect(DEFAULT_CONFIG.access).toEqual({
      approval: "on-failure",
      sandbox: "workspace-write",
      network: false,
      execution: "dry-run",
    });
    expect(DEFAULT_CONFIG.subagents).toEqual({ enabled: true, max_parallel: 3 });
  });

  it("serializes the new sections", () => {
    const yaml = serializeConfig(DEFAULT_CONFIG);
    expect(yaml).toContain("orchestrator:");
    expect(yaml).toContain("worker:");
    expect(yaml).toContain("theme: mono");
    expect(yaml).toContain("execution: dry-run");
    // backward-compatible fields remain
    expect(yaml).toContain("preferred: grok");
    expect(yaml).toContain("fallback: codex");
  });

  it("merges partial role/ui/access overrides onto defaults", () => {
    const config = mergeConfig({
      roles: { worker: { adapter: "codex", model: "gpt-5-codex" } } as never,
      ui: { mode: "plan" } as never,
      access: { execution: "live" } as never,
    });
    expect(config.roles.worker).toEqual({ adapter: "codex", model: "gpt-5-codex", effort: "default" });
    // orchestrator falls back to default
    expect(config.roles.orchestrator).toEqual(DEFAULT_CONFIG.roles.orchestrator);
    expect(config.ui.mode).toBe("plan");
    expect(config.ui.theme).toBe("mono");
    expect(config.access.execution).toBe("live");
    expect(config.access.sandbox).toBe("workspace-write");
  });

  it("reads a legacy config without the new sections", () => {
    const config = parseConfigText("version: 1\nadapters:\n  preferred: claude\n");
    expect(config.adapters.preferred).toBe("claude");
    expect(config.roles.orchestrator).toEqual(DEFAULT_CONFIG.roles.orchestrator);
    expect(config.ui.theme).toBe("mono");
    expect(config.subagents.max_parallel).toBe(3);
  });
});
