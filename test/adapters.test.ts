import { describe, expect, it } from "vitest";
import { detectAdapters, findBinary, pickAdapter } from "../src/adapters/detect.js";
import { createTempDir, writeFakeBinary } from "./helpers.js";

describe("adapters", () => {
  it("detects fake grok/claude/gemini/codex binaries on PATH", async () => {
    const binDir = await createTempDir("olap-bin-");
    await Promise.all([
      writeFakeBinary(binDir, "grok"),
      writeFakeBinary(binDir, "claude"),
      writeFakeBinary(binDir, "gemini"),
      writeFakeBinary(binDir, "codex"),
    ]);

    const pathEnv = `${binDir}:/usr/bin:/bin`;
    const detections = await detectAdapters(pathEnv);
    const detected = detections.filter((d) => d.detected).map((d) => d.id);

    expect(detected).toEqual(["grok", "claude", "gemini", "codex"]);
  });

  it("findBinary returns undefined when missing", async () => {
    const binDir = await createTempDir("olap-empty-");
    const found = await findBinary("missing-cli", binDir);
    expect(found).toBeUndefined();
  });

  it("pickAdapter prefers configured adapter then fallback", async () => {
    const binDir = await createTempDir("olap-pick-");
    await writeFakeBinary(binDir, "codex");
    const pathEnv = `${binDir}:/usr/bin:/bin`;
    const detections = await detectAdapters(pathEnv);

    const preferred = pickAdapter(detections, "grok", "codex");
    expect(preferred?.id).toBe("codex");
  });
});