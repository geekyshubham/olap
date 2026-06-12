import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { simulateArchitectWorkerLoop, summarizeTokens } from "../src/run/simulator.js";

describe("simulator", () => {
  it("runs architect/worker loop without external calls", () => {
    const { events, report } = simulateArchitectWorkerLoop(
      "implement feature",
      DEFAULT_CONFIG,
      new Date("2026-06-12T10:00:00.000Z"),
    );

    expect(events[0].phase).toBe("architect");
    expect(events.some((e) => e.phase === "worker")).toBe(true);
    expect(report).toContain("Token efficiency");

    const summary = summarizeTokens(events);
    expect(summary.tokens_in).toBeGreaterThan(0);
    expect(summary.tokens_out).toBeGreaterThan(0);
    expect(summary.efficiency).toBeGreaterThan(0);
  });
});