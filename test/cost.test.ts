import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { estimateUsageCost, formatCostSummary } from "../src/run/cost.js";
import type { ResolvedRole, UsageSnapshot } from "../src/types.js";

const usage: UsageSnapshot = {
  orchestrator: { tokens_in: 1_000_000, tokens_out: 100_000, calls: 2 },
  worker: { tokens_in: 2_000_000, tokens_out: 1_000_000, calls: 3 },
  subagents_spawned: 3,
  subagents_active: 0,
};

const roles: ResolvedRole[] = [
  { role: "orchestrator", adapter: "grok", model: "orch", available: true },
  { role: "worker", adapter: "grok", model: "worker", available: true },
];

describe("cost estimates", () => {
  it("estimates per-role spend and single-model savings", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.cost.prices_per_million_tokens.grok = {
      orch: { input: 10, output: 20 },
      worker: { input: 1, output: 2 },
    };

    const cost = estimateUsageCost(config, usage, {
      orchestrator: roles[0]!,
      worker: roles[1]!,
    });

    expect(cost.orchestrator_usd).toBeCloseTo(12);
    expect(cost.worker_usd).toBeCloseTo(4);
    expect(cost.total_usd).toBeCloseTo(16);
    expect(cost.single_model_baseline_usd).toBeCloseTo(52);
    expect(cost.savings_usd).toBeCloseTo(36);
    expect(cost.savings_percent).toBe(69);
    expect(cost.pricing_complete).toBe(true);
  });

  it("marks estimates incomplete when a role has no price", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.cost.prices_per_million_tokens.grok = {
      orch: { input: 10, output: 20 },
    };

    const cost = estimateUsageCost(config, usage, {
      orchestrator: roles[0]!,
      worker: roles[1]!,
    });

    expect(cost.pricing_complete).toBe(false);
    expect(formatCostSummary(cost)).toContain("pricing incomplete");
  });
});
