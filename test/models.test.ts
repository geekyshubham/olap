import { describe, expect, it } from "vitest";
import {
  defaultModelFor,
  findModel,
  modelsForAdapter,
  modelsForRole,
} from "../src/adapters/models.js";
import { buildModelListing } from "../src/commands/models.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("model catalog", () => {
  it("lists models per adapter", () => {
    expect(modelsForAdapter("grok").length).toBeGreaterThan(0);
    expect(modelsForAdapter("codex").some((m) => m.id === "gpt-5-codex")).toBe(true);
  });

  it("suggests role-appropriate defaults", () => {
    expect(defaultModelFor("grok", "worker")).toBe("grok-composer-2.5-fast");
    expect(defaultModelFor("grok", "orchestrator")).toBe("grok-4-latest");
    expect(defaultModelFor("kiro", "worker")).toBe("");
    expect(defaultModelFor("kiro", "orchestrator")).toBe("");
    expect(defaultModelFor("opencode", "orchestrator")).toBe("opencode/claude-opus-4-8");
    expect(defaultModelFor("openrouter", "orchestrator")).toBe("anthropic/claude-sonnet-4");
  });

  it("finds models and orders by role suitability", () => {
    expect(findModel("grok", "grok-4-latest")?.label).toContain("Grok 4");
    expect(findModel("grok", "nope")).toBeUndefined();
    expect(modelsForRole("grok", "worker")[0].goodFor).toContain("worker");
  });

  it("marks selected role models in the listing", () => {
    const listing = buildModelListing(DEFAULT_CONFIG);
    const grok = listing.find((l) => l.adapter === "grok");
    const worker = grok?.models.find((m) => m.id === "grok-composer-2.5-fast");
    expect(worker?.selectedFor).toContain("worker");
    expect(DEFAULT_CONFIG.roles.orchestrator.adapter).toBe("kiro");
    expect(DEFAULT_CONFIG.roles.orchestrator.model).toBe("claude-opus-4.8");
    expect(DEFAULT_CONFIG.roles.worker.adapter).toBe("grok");
    expect(DEFAULT_CONFIG.roles.worker.model).toBe("grok-composer-2.5-fast");
  });
});
