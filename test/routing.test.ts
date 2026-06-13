import { describe, expect, it } from "vitest";
import { parseTaskOverride, routeTask } from "../src/run/routing.js";

describe("routeTask", () => {
  it("routes publish tasks to direct mode in auto policy", () => {
    const decision = routeTask("so publish this now", "auto");
    expect(decision.strategy).toBe("direct");
  });

  it("routes implementation tasks to the full loop", () => {
    const decision = routeTask("implement the auth callback tests", "auto");
    expect(decision.strategy).toBe("loop");
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
