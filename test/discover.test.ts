import { afterEach, describe, expect, it } from "vitest";
import {
  canDiscover,
  clearModelCache,
  discoverModels,
  loadModels,
  parseGrokModels,
  parseKiroModels,
  resolveConfigModels,
  resolveModelsForRole,
  setDiscoveredModels,
  toModelInfos,
} from "../src/adapters/discover.js";

const GROK_OUTPUT = [
  "You are logged in with grok.com.",
  "",
  "Default model: grok-composer-2.5-fast",
  "",
  "Available models:",
  "  - grok-build",
  "  * grok-composer-2.5-fast (default)",
].join("\n");

afterEach(() => clearModelCache());

describe("model discovery", () => {
  it("parses grok models output and the default marker", () => {
    const parsed = parseGrokModels(GROK_OUTPUT);
    expect(parsed.models).toEqual(["grok-build", "grok-composer-2.5-fast"]);
    expect(parsed.default).toBe("grok-composer-2.5-fast");
  });

  it("knows which adapters can be discovered", () => {
    expect(canDiscover("grok")).toBe(true);
    expect(canDiscover("kiro")).toBe(true);
    expect(canDiscover("claude")).toBe(false);
  });

  it("parses kiro --list-models JSON with descriptions and default", () => {
    const json = JSON.stringify({
      models: [
        { model_id: "auto", description: "Models chosen by task", model_name: "auto" },
        { model_id: "claude-opus-4.8", description: "Opus 4.8" },
      ],
      default_model: "auto",
    });
    const parsed = parseKiroModels(json);
    expect(parsed.models).toEqual(["auto", "claude-opus-4.8"]);
    expect(parsed.default).toBe("auto");
    expect(parsed.details?.["auto"]?.description).toContain("chosen");
    expect(parseKiroModels("not json").models).toEqual([]);
  });

  it("discovers models via an injected exec", async () => {
    const result = await discoverModels("grok", "/bin/grok", {
      exec: async () => GROK_OUTPUT,
    });
    expect(result?.models).toContain("grok-composer-2.5-fast");
    expect(result?.default).toBe("grok-composer-2.5-fast");

    const failed = await discoverModels("grok", "/bin/grok", { exec: async () => undefined });
    expect(failed).toBeUndefined();
  });

  it("turns discovered ids into ordered ModelInfo with the default first", () => {
    const infos = toModelInfos("grok", {
      models: ["grok-build", "grok-composer-2.5-fast"],
      default: "grok-composer-2.5-fast",
    });
    expect(infos[0].id).toBe("grok-composer-2.5-fast");
    expect(infos[0].description).toContain("default");
  });

  it("resolves from cache when present, else falls back to catalog", () => {
    expect(resolveModelsForRole("grok", "worker").some((m) => m.id === "grok-code-fast-1")).toBe(true);
    setDiscoveredModels("grok", toModelInfos("grok", { models: ["grok-build"], default: "grok-build" }));
    expect(resolveModelsForRole("grok", "worker").map((m) => m.id)).toEqual(["grok-build"]);
  });

  it("resolveConfigModels falls back when configured model is unavailable", async () => {
    const config = structuredClone(
      (await import("../src/config/defaults.js")).DEFAULT_CONFIG,
    );
    config.roles.orchestrator.model = "grok-4-latest";
    config.roles.worker.model = "grok-code-fast-1";
    const { config: resolved, warnings } = await resolveConfigModels(
      config,
      [{ id: "grok", detected: true, binary: "/bin/grok" }],
      { exec: async () => GROK_OUTPUT },
    );
    expect(resolved.roles.orchestrator.model).toBe("grok-composer-2.5-fast");
    expect(resolved.roles.worker.model).toBe("grok-composer-2.5-fast");
    expect(warnings.length).toBe(2);
  });

  it("loadModels discovers, caches, and returns the list", async () => {
    const models = await loadModels(
      "grok",
      { id: "grok", detected: true, binary: "/bin/grok" },
      { exec: async () => GROK_OUTPUT },
    );
    expect(models.map((m) => m.id)).toContain("grok-build");
    expect(resolveModelsForRole("grok", "orchestrator").length).toBe(models.length);
  });
});
