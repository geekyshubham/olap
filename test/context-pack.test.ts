import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  estimateTokens,
  generateContextPack,
  renderContextDigest,
  renderContextExcerpt,
} from "../src/context/pack.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { createTempDir, writeFileInDir } from "./helpers.js";
import type { ContextPack } from "../src/types.js";

const pack: ContextPack = {
  generated_at: "2026-06-12T00:00:00.000Z",
  max_tokens: 32000,
  total_tokens: 20,
  truncated: false,
  files: [
    { path: "src/a.ts", tokens: 10, content: "export const a = 1; // MARKER_A" },
    { path: "src/b.ts", tokens: 10, content: "export const b = 2; // MARKER_B" },
  ],
};

describe("context pack", () => {
  it("estimates tokens from text length", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });

  it("generates a context pack from workspace files", async () => {
    const cwd = await createTempDir();
    await writeFileInDir(cwd, "package.json", '{"name":"olap"}\n');
    await writeFileInDir(cwd, "src/index.ts", "export const x = 1;\n");
    await writeFileInDir(cwd, "olap.config.yaml", "version: 1\n");

    const pack = await generateContextPack(cwd, DEFAULT_CONFIG, [
      "package.json",
      "src/index.ts",
      "olap.config.yaml",
    ]);

    expect(pack.files.length).toBeGreaterThanOrEqual(3);
    expect(pack.total_tokens).toBeGreaterThan(0);
    expect(pack.max_tokens).toBe(DEFAULT_CONFIG.architect.context_pack_max_tokens);
    expect(pack.truncated).toBe(false);
  });

  it("truncates context pack when exceeding max tokens", async () => {
    const cwd = await createTempDir();
    const huge = "x".repeat(200_000);
    await writeFileInDir(cwd, "big.txt", huge);

    const config = {
      ...DEFAULT_CONFIG,
      architect: {
        ...DEFAULT_CONFIG.architect,
        context_pack_max_tokens: 100,
      },
    };

    const pack = await generateContextPack(cwd, config, ["big.txt"]);
    expect(pack.truncated).toBe(true);
    expect(pack.total_tokens).toBeLessThanOrEqual(100);
    const content = await readFile(join(cwd, "big.txt"), "utf8");
    expect(content.length).toBeGreaterThan(pack.files[0].content.length);
  });
});

describe("context rendering for prompts", () => {
  it("renders a compact digest listing file paths and token sizes", () => {
    const digest = renderContextDigest(pack);
    expect(digest).toContain("src/a.ts");
    expect(digest).toContain("src/b.ts");
    expect(digest).toContain("tok");
  });

  it("renders real file CONTENTS (not just names) in the excerpt", () => {
    const excerpt = renderContextExcerpt(pack, 32000);
    expect(excerpt).toContain("MARKER_A");
    expect(excerpt).toContain("MARKER_B");
    expect(excerpt).toContain("src/a.ts");
  });

  it("truncates the excerpt to the token budget", () => {
    const excerpt = renderContextExcerpt(pack, 2); // ~8 chars
    expect(excerpt).toContain("truncated");
    expect(excerpt.length).toBeLessThan(200);
  });

  it("handles an empty/undefined pack gracefully", () => {
    expect(renderContextExcerpt(undefined, 1000)).toBe("");
    expect(renderContextDigest(undefined)).toContain("no repository context");
  });
});
