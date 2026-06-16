import { describe, expect, it } from "vitest";
import { buildArchitectCommand, buildWorkerCommand } from "../src/adapters/build.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("openrouter adapter", () => {
  it("builds non-interactive ask commands with model env", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.roles.orchestrator = {
      adapter: "openrouter",
      model: "anthropic/claude-sonnet-4",
    };
    const architect = buildArchitectCommand("openrouter", "review", config);
    expect(architect.argv).toContain("ask");
    expect(architect.argv).toContain("--format");
    expect(architect.argv).toContain("plain");
    expect(architect.argv).toContain("--no-init");
    expect(architect.env?.OLAP_OPENROUTER_MODEL).toBe("anthropic/claude-sonnet-4");

    const worker = buildWorkerCommand("openrouter", "task", config);
    expect(worker.argv).toContain("ask");
    expect(worker.env?.OLAP_OPENROUTER_MODEL).toBe("anthropic/claude-sonnet-4");
  });
});