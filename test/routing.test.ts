import { describe, expect, it } from "vitest";
import { buildRunPlan, parseTaskOverride, routeTask } from "../src/run/routing.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("routeTask", () => {
  it("routes publish tasks to direct mode in auto policy", () => {
    const decision = routeTask("so publish this now", "auto");
    expect(decision.strategy).toBe("direct");
  });

  it("routes implementation tasks to the full loop", () => {
    const decision = routeTask("implement the auth callback tests", "auto");
    expect(decision.strategy).toBe("loop");
    expect(decision.complexity).toBe("complex");
  });

  it("routes trivial mechanical tasks directly", () => {
    const decision = routeTask("fix a typo in README", "auto");
    expect(decision.strategy).toBe("direct");
    expect(decision.complexity).toBe("trivial");
  });

  it("honors /loop and /direct overrides", () => {
    expect(routeTask("/loop publish now", "never").strategy).toBe("loop");
    expect(routeTask("/direct implement parser", "always").strategy).toBe("direct");
  });

  it("respects loop policy always/never", () => {
    expect(routeTask("publish", "always").strategy).toBe("loop");
    expect(routeTask("implement feature", "never").strategy).toBe("direct");
  });

  it("honors natural-language 'no loops' even when the task contains a loop verb", () => {
    // "fix" is a loop keyword, but the explicit "no need of loops just fix" wins.
    const decision = routeTask(
      "can you remove one line of the two lines present on the screen when loaded no need of loops just fix and verify it",
      "auto",
    );
    expect(decision.strategy).toBe("direct");
  });

  it("treats several no-loop phrasings as direct", () => {
    for (const task of [
      "fix the bug, no loops",
      "just fix the typo and verify",
      "refactor this in a single pass",
      "implement the change without loops",
      "add the field, one shot",
    ]) {
      expect(routeTask(task, "auto").strategy, task).toBe("direct");
    }
  });

  it("loop policy always wins over natural-language no-loop hints", () => {
    expect(routeTask("just fix the import, no loops", "always").strategy).toBe("loop");
  });

  it("honors explicit requests to keep iterating under auto policy", () => {
    expect(routeTask("keep iterating until the tests pass", "auto").strategy).toBe("loop");
  });

  it("loop policy never wins over natural-language loop hints", () => {
    expect(routeTask("publish but run the review loop first", "never").strategy).toBe("direct");
  });
});

describe("parseTaskOverride", () => {
  it("strips slash prefixes", () => {
    expect(parseTaskOverride("/direct git push")).toEqual({
      task: "git push",
      force: "direct",
    });
  });
});

describe("buildRunPlan", () => {
  const config = structuredClone(DEFAULT_CONFIG);

  it("previews a full loop for implementation tasks and matches routeTask", () => {
    const plan = buildRunPlan("implement the auth callback tests", config);
    expect(plan.strategy).toBe("loop");
    expect(plan.complexity).toBe("complex");
    expect(plan.reason).toBe(routeTask("implement the auth callback tests", config.worker.loop_policy).reason);
    expect(plan.maxIterations).toBe(config.worker.max_iterations);
    expect(plan.mode).toBe(config.ui.mode);
    expect(plan.orchestrator).toBe("grok:grok-composer-2.5-fast");
    expect(plan.worker).toBe("grok:grok-composer-2.5-fast");
    expect(plan.stopConditions.some((s) => s.includes("cancel"))).toBe(true);
    expect(plan.stopConditions.some((s) => /max 3 iteration/.test(s))).toBe(true);
  });

  it("previews a single direct pass and strips the /direct prefix", () => {
    const plan = buildRunPlan("/direct just publish the package", config);
    expect(plan.strategy).toBe("direct");
    expect(plan.task).toBe("just publish the package");
    expect(plan.maxIterations).toBe(1);
    expect(plan.stopConditions.some((s) => s.includes("single pass"))).toBe(true);
  });

  it("honors the /loop override even for operational text", () => {
    const plan = buildRunPlan("/loop publish now", config);
    expect(plan.strategy).toBe("loop");
  });

  it("caps moderate tasks at two review iterations", () => {
    const plan = buildRunPlan("add a compact settings row", config);
    expect(plan.strategy).toBe("loop");
    expect(plan.complexity).toBe("moderate");
    expect(plan.maxIterations).toBe(2);
  });
});
