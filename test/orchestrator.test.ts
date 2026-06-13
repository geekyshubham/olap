import { describe, expect, it } from "vitest";
import {
  coerceReview,
  deriveReview,
  extractPlanText,
  extractReview,
  findJsonObjects,
} from "../src/run/orchestrator.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

const config = DEFAULT_CONFIG;

describe("findJsonObjects", () => {
  it("finds multiple top-level objects in noisy text", () => {
    const text = 'log line\n{"a":1}\nmore log {"b":{"c":2}} trailing';
    expect(findJsonObjects(text)).toEqual(['{"a":1}', '{"b":{"c":2}}']);
  });

  it("ignores braces inside strings", () => {
    expect(findJsonObjects('{"k":"a}b{c"}')).toEqual(['{"k":"a}b{c"}']);
  });

  it("ignores unmatched closing braces before valid JSON", () => {
    expect(findJsonObjects('log line with stray } then {"a":1}')).toEqual(['{"a":1}']);
  });
});

describe("extractPlanText", () => {
  it("pulls text from JSON orchestrator output", () => {
    expect(extractPlanText('{"text":"do the thing"}', "fallback")).toBe("do the thing");
  });

  it("pulls thought/reasoning chunks from JSON orchestrator output", () => {
    expect(extractPlanText('{"thought":"step one: edit file"}', "fallback")).toBe("step one: edit file");
  });

  it("uses raw output for plain-text orchestrators (e.g. kiro)", () => {
    expect(extractPlanText("Plan: edit file X then run tests", "fb")).toContain("edit file X");
  });

  it("falls back when output is empty", () => {
    expect(extractPlanText("   ", "fallback")).toBe("fallback");
  });
});

describe("coerceReview", () => {
  it("coerces a loose object into a schema-valid review", () => {
    const review = coerceReview({ verdict: "approve", summary: "ok" }, 1, config);
    expect(review?.verdict).toBe("pass");
    expect(review?.schema_version).toBe(config.architect.review_schema_version);
  });

  it("rejects objects with no usable verdict", () => {
    expect(coerceReview({ note: "hi" }, 1, config)).toBeUndefined();
  });
});

describe("extractReview", () => {
  const derived = {
    iteration: 1,
    totalIterations: 3,
    config,
    workerOk: true,
    changed: true,
    changeSummary: "1 file +2 -0",
  };

  it("prefers the orchestrator's own JSON review", () => {
    const out = extractReview(
      'noise\n{"schema_version":1,"iteration":1,"verdict":"revise","summary":"more","findings":[],"next_actions":[],"token_budget_used":10}',
      derived,
    );
    expect(out.fromOrchestrator).toBe(true);
    expect(out.review.verdict).toBe("revise");
  });

  it("derives a review from real signals when no JSON is present", () => {
    const out = extractReview("the worker did stuff, looks fine", derived);
    expect(out.fromOrchestrator).toBe(false);
    expect(out.review.verdict).toBe("pass"); // workerOk + changed
  });
});

describe("deriveReview", () => {
  it("fails when the worker did not complete", () => {
    const r = deriveReview({ iteration: 1, totalIterations: 3, config, workerOk: false, changed: false, changeSummary: "no changes" });
    expect(r.verdict).toBe("fail");
  });

  it("flags revise when worker ok but nothing changed mid-loop", () => {
    const r = deriveReview({ iteration: 1, totalIterations: 3, config, workerOk: true, changed: false, changeSummary: "no changes" });
    expect(r.verdict).toBe("revise");
  });

  it("fails on the final iteration when worker ok but nothing changed", () => {
    const r = deriveReview({ iteration: 3, totalIterations: 3, config, workerOk: true, changed: false, changeSummary: "no changes" });
    expect(r.verdict).toBe("fail");
  });

  it("passes when worker ok and files changed", () => {
    const r = deriveReview({ iteration: 1, totalIterations: 3, config, workerOk: true, changed: true, changeSummary: "2 files +5 -1" });
    expect(r.verdict).toBe("pass");
  });
});
