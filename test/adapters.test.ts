import { describe, expect, it } from "vitest";
import { detectAdapters, findBinary, pickAdapter } from "../src/adapters/detect.js";
import { adapterCapabilities, formatAdapterLine } from "../src/commands/adapters.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { createTempDir, writeFakeBinary } from "./helpers.js";

describe("adapters", () => {
  it("detects fake grok/claude/gemini/codex/kiro/ollama binaries on PATH", async () => {
    const binDir = await createTempDir("olap-bin-");
    await Promise.all([
      writeFakeBinary(binDir, "grok"),
      writeFakeBinary(binDir, "claude"),
      writeFakeBinary(binDir, "gemini"),
      writeFakeBinary(binDir, "codex"),
      writeFakeBinary(binDir, "kiro-cli"),
      writeFakeBinary(binDir, "ollama"),
    ]);

    const pathEnv = `${binDir}:/usr/bin:/bin`;
    const detections = await detectAdapters(pathEnv);
    const detected = detections.filter((d) => d.detected).map((d) => d.id);

    expect(detected).toEqual(["grok", "claude", "gemini", "codex", "kiro", "ollama"]);
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

  it("prints adapter capability profiles", () => {
    const line = formatAdapterLine(
      { id: "grok", detected: true, binary: "/bin/grok" },
      DEFAULT_CONFIG,
    );

    expect(line).toContain("capabilities=");
    expect(line).toContain("plan");
    expect(line).toContain("write");
    expect(adapterCapabilities(DEFAULT_CONFIG, "kiro").shell).toBe(true);
    expect(adapterCapabilities(DEFAULT_CONFIG, "ollama").local).toBe(true);
    expect(adapterCapabilities(DEFAULT_CONFIG, "ollama").file_edits).toBe(false);
  });
});
