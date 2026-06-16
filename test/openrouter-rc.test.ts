import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { syncOpenrouterProjectModel } from "../src/adapters/openrouter-rc.js";
import { createTempDir } from "./helpers.js";

describe("openrouter rc sync", () => {
  it("writes .openrouterrc when missing", async () => {
    const dir = await createTempDir("olap-or-");
    await syncOpenrouterProjectModel(dir, "anthropic/claude-sonnet-4");
    const text = await readFile(join(dir, ".openrouterrc"), "utf8");
    expect(JSON.parse(text)).toEqual({ model: "anthropic/claude-sonnet-4" });
  });

  it("merges model into existing rc without dropping fields", async () => {
    const dir = await createTempDir("olap-or-");
    const path = join(dir, ".openrouterrc.json");
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(
        path,
        JSON.stringify({ domain: "https://openrouter.ai/api/v1", model: "old/model" }),
      ),
    );
    await syncOpenrouterProjectModel(dir, "openrouter/auto");
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      domain?: string;
      model?: string;
    };
    expect(parsed.domain).toBe("https://openrouter.ai/api/v1");
    expect(parsed.model).toBe("openrouter/auto");
  });
});