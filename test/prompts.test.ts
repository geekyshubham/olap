import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { buildReviewPrompt, buildWorkerPrompt, reviewOutputContract } from "../src/run/prompts.js";

describe("review prompts", () => {
  it("makes diff-only review mode explicit", () => {
    const prompt = buildReviewPrompt({
      config: DEFAULT_CONFIG,
      task: "implement auth callback",
      iteration: 1,
      totalIterations: 3,
      workerOutput: "done",
      workerOk: true,
      diffText: "2 files +10 -2",
      fileList: ["src/auth.ts", "test/auth.test.ts"],
    });

    expect(prompt).toContain("REVIEW OUTPUT CONTRACT");
    expect(prompt).toContain("Review scope: diff-only");
    expect(prompt).toContain("2 files +10 -2");
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).not.toContain("File contents (truncated to budget)");
    expect(prompt).toContain('"verdict":"pass"');
    expect(prompt).not.toContain("pass | revise | fail");
    expect(prompt.indexOf("REVIEW OUTPUT CONTRACT")).toBeLessThan(
      prompt.indexOf(DEFAULT_CONFIG.architect.system_prompt_hint),
    );
  });

  it("review contract requires JSON even when blocked", () => {
    const contract = reviewOutputContract(2, 1).join("\n");
    expect(contract).toContain("verdict \"fail\"");
    expect(contract).toContain("Do not run tools");
    expect(contract).toContain('"iteration":2');
  });
});

describe("worker prompts", () => {
  it("tells the worker not to edit OLAP meta files", () => {
    const prompt = buildWorkerPrompt({
      task: "fix ingest UI",
      brief: "Remove manage.py strings from frontend.",
      direct: false,
      iteration: 1,
      totalIterations: 3,
    });
    expect(prompt).toContain("Do not modify olap.config.yaml");
    expect(prompt).toContain(".impeccable/");
  });
});
