import { describe, expect, it } from "vitest";
import { parseDecompositionPlan, buildDecomposePrompt } from "../src/orchestrator/decompose.js";

describe("parseDecompositionPlan", () => {
  it("parses valid decomposition JSON", () => {
    const stdout = JSON.stringify({
      strategy: "decompose",
      complexity: "complex",
      reason: "multi-step feature",
      subtasks: [
        {
          title: "Implement auth",
          description: "OAuth flow",
          job_type: "worker",
          depends_on_titles: [],
        },
        {
          title: "QA auth",
          job_type: "qa",
          depends_on_titles: ["Implement auth"],
        },
      ],
    });
    const plan = parseDecompositionPlan(stdout);
    expect(plan.strategy).toBe("decompose");
    expect(plan.complexity).toBe("complex");
    expect(plan.subtasks).toHaveLength(2);
    expect(plan.subtasks[1].job_type).toBe("qa");
  });

  it("falls back when output is empty", () => {
    const plan = parseDecompositionPlan("");
    expect(plan.strategy).toBe("loop");
    expect(plan.subtasks).toHaveLength(0);
  });
});

describe("buildDecomposePrompt", () => {
  it("includes output contract", () => {
    const prompt = buildDecomposePrompt("add auth", true);
    expect(prompt).toContain("DECOMPOSITION OUTPUT CONTRACT");
    expect(prompt).toContain("add auth");
  });
});