import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("package metadata", () => {
  it("keeps the CLI version in sync with package.json", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe(packageJson.version);
  });

  it("declares a publishable CLI package", async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8"),
    ) as {
      bin: Record<string, string>;
      files: string[];
      engines: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.bin.olap).toBe("dist/cli.js");
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist", "docs"]));
    expect(packageJson.engines.node).toContain(">=22");
    expect(packageJson.scripts).toHaveProperty("pack:check");
    expect(packageJson.scripts).toHaveProperty("homebrew:check");
    expect(packageJson.scripts).toHaveProperty("clean");
    expect(packageJson.scripts.build).toContain("clean");
  });
});
