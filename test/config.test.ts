import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { parseConfigText, readConfig } from "../src/config/read.js";
import { serializeConfig, writeConfig } from "../src/config/write.js";
import { createTempDir } from "./helpers.js";

describe("config", () => {
  it("serializes defaults with architect/worker settings", () => {
    const yaml = serializeConfig(DEFAULT_CONFIG);
    expect(yaml).toContain("output_budget_tokens: 4096");
    expect(yaml).toContain("context_pack_max_tokens: 32000");
    expect(yaml).toContain("max_iterations: 3");
    expect(yaml).toContain("cost:");
    expect(yaml).toContain("prices_per_million_tokens:");
    expect(yaml).toContain("capabilities:");
    expect(yaml).toContain("modules: []");
  });

  it("writeConfig creates olap.config.yaml", async () => {
    const dir = await createTempDir();
    const path = await writeConfig(dir);
    const text = await readFile(path, "utf8");
    expect(text).toContain("preferred: grok");
    expect(text).toContain("fallback: codex");
  });

  it("readConfig falls back to defaults when missing", async () => {
    const dir = await createTempDir();
    const config = await readConfig(dir);
    expect(config.architect.output_budget_tokens).toBe(4096);
    expect(config.modules).toEqual([]);
    expect(config.validators).toHaveLength(2);
    expect(config.cost.enabled).toBe(true);
    expect(config.adapters.capabilities.grok?.file_edits).toBe(true);
  });

  it("returns isolated copies that do not mutate DEFAULT_CONFIG", async () => {
    const dir = await createTempDir();
    const config = await readConfig(dir);
    config.validators.push({ name: "extra", command: "true" });
    config.roles.worker.model = "mutated";

    expect(DEFAULT_CONFIG.validators).toHaveLength(2);
    expect(DEFAULT_CONFIG.roles.worker.model).not.toBe("mutated");
  });

  it("parseConfigText merges partial yaml", () => {
    const config = parseConfigText(`
version: 1
architect:
  output_budget_tokens: 2048
cost:
  session_budget_usd: 1.5
`);
    expect(config.architect.output_budget_tokens).toBe(2048);
    expect(config.architect.context_pack_max_tokens).toBe(32000);
    expect(config.cost.session_budget_usd).toBe(1.5);
    expect(config.cost.enabled).toBe(true);
    expect(config.modules).toEqual([]);
  });
});
