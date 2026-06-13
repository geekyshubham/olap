import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { buildReviewPrompt } from "../src/run/prompts.js";

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

    expect(prompt).toContain("Review scope: diff-only");
    expect(prompt).toContain("2 files +10 -2");
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).not.toContain("File contents (truncated to budget)");
  });
});
