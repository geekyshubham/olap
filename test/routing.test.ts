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
});

describe("parseTaskOverride", () => {
  it("strips slash prefixes", () => {
    expect(parseTaskOverride("/direct git push")).toEqual({
      task: "git push",
      force: "direct",
    });
  });
});