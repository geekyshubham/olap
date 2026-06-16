import { describe, expect, it } from "vitest";
import { routeTask } from "../src/run/routing.js";

describe("routeTask with AI hints", () => {
  it("prefers orchestrator strategy over keywords", () => {
    const decision = routeTask("implement a huge refactor", "auto", {
      strategy: "direct",
      complexity: "trivial",
      reason: "orchestrator says single pass",
    });
    expect(decision.strategy).toBe("direct");
    expect(decision.reason).toContain("orchestrator");
  });

  it("slash override still wins", () => {
    const decision = routeTask("/loop small fix", "auto", {
      strategy: "direct",
      complexity: "trivial",
    });
    expect(decision.strategy).toBe("loop");
  });
});