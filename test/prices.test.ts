import { describe, expect, it } from "vitest";

import { normalizeModelId, resolveMarketPrice } from "../src/run/prices.js";

describe("normalizeModelId", () => {
  it("strips adapter prefixes and normalizes separators", () => {
    expect(normalizeModelId("kiro:claude-opus-4.8")).toBe("claude-opus-4-8");
    expect(normalizeModelId("claude-opus-4.8")).toBe("claude-opus-4-8");
    expect(normalizeModelId("Grok_Code_Fast_1")).toBe("grok-code-fast-1");
    expect(normalizeModelId("  grok-4-fast  ")).toBe("grok-4-fast");
  });
});

describe("resolveMarketPrice", () => {
  it("resolves claude opus 4.8 from the bundled snapshot", () => {
    const price = resolveMarketPrice("kiro", "claude-opus-4.8");
    expect(price).toEqual({ input: 5, output: 25 });
  });

  it("resolves grok-composer-2.5-fast via alias to grok-code-fast-1", () => {
    const price = resolveMarketPrice("grok", "grok-composer-2.5-fast");
    expect(price).toEqual({ input: 0.2, output: 1.5 });
  });

  it("matches dated/suffixed model ids by prefix", () => {
    const price = resolveMarketPrice("claude", "claude-opus-4-8-20260101");
    expect(price).toEqual({ input: 5, output: 25 });
  });

  it("returns undefined for unknown models so cost stays honest", () => {
    expect(resolveMarketPrice("grok", "totally-made-up-model")).toBeUndefined();
    expect(resolveMarketPrice("ollama", "llama3.1")).toBeUndefined();
    expect(resolveMarketPrice("grok", "")).toBeUndefined();
  });
});
