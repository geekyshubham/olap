import { describe, expect, it } from "vitest";
import {
  coerceReview,
  coerceReviewFromProse,
  collectReviewCandidates,
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

  it("falls back when JSON has no readable plan text", () => {
    expect(extractPlanText('{"usage":{"input_tokens":10,"output_tokens":20}}', "fallback")).toBe(
      "fallback",
    );
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

  it("extracts review JSON wrapped in grok agent text fields", () => {
    const wrapped = JSON.stringify({
      text: '{"schema_version":1,"iteration":1,"verdict":"pass","summary":"Looks good.","findings":[{"severity":"info","message":"ok"}],"next_actions":[],"token_budget_used":12}',
      usage: { input_tokens: 90, output_tokens: 45 },
    });
    const out = extractReview(wrapped, derived);
    expect(out.fromOrchestrator).toBe(true);
    expect(out.review.verdict).toBe("pass");
    expect(out.review.summary).toBe("Looks good.");
  });

  it("extracts review JSON from markdown code fences", () => {
    const stdout = [
      "Here is the review:",
      "```json",
      '{"schema_version":1,"iteration":1,"verdict":"pass","summary":"Ship it.","findings":[],"next_actions":[],"token_budget_used":0}',
      "```",
    ].join("\n");
    const out = extractReview(stdout, derived);
    expect(out.fromOrchestrator).toBe(true);
    expect(out.review.verdict).toBe("pass");
  });

  it("collectReviewCandidates unwraps nested review objects", () => {
    const candidates = collectReviewCandidates(
      '{"review":{"verdict":"fail","summary":"blocked","findings":[{"severity":"error","message":"scope mismatch"}],"next_actions":["retry"]}}',
    );
    expect(candidates.some((c) => c.verdict === "fail")).toBe(true);
  });

  it("parses plain-text reviews for any orchestrator adapter", () => {
    const stdout = [
      "\u001b[38;5;141m> \u001b[0mBLOCKED — scope mismatch. The task does not apply to this repository.",
      "Conclusion:",
      "- There is no UI prompting users to run a *.py script.",
      '{"severity":"warn","message":"Only dirty file is olap.config.yaml"}',
    ].join("\n");
    const out = extractReview(stdout, { ...derived, orchestratorAdapter: "kiro" });
    expect(out.fromOrchestrator).toBe(true);
    expect(out.review.verdict).toBe("fail");
    expect(out.review.summary).toContain("BLOCKED");
    expect(out.review.findings.some((f) => f.message.includes("olap.config.yaml"))).toBe(true);
  });

  it("parses prose reviews for JSON-first adapters when JSON is missing", () => {
    const stdout = "Verdict: pass\nSummary: Worker changes look correct.";
    const out = extractReview(stdout, { ...derived, orchestratorAdapter: "grok" });
    expect(out.fromOrchestrator).toBe(true);
    expect(out.review.verdict).toBe("pass");
  });

  it("does not infer reviews from unrelated prose", () => {
    const out = extractReview("not json at all", { ...derived, orchestratorAdapter: "grok" });
    expect(out.fromOrchestrator).toBe(false);
    expect(out.review.summary).toContain("Derived review");
  });

  it("rejects schema-placeholder verdict copies", () => {
    const out = extractReview(
      '{"verdict":"pass | revise | fail","summary":"maybe","findings":[],"next_actions":[]}',
      derived,
    );
    expect(out.fromOrchestrator).toBe(false);
  });

  it("accepts alternate verdict keys", () => {
    const out = extractReview(
      '{"decision":"approve","summary":"ok","findings":[{"severity":"info","message":"ok"}],"next_actions":[]}',
      derived,
    );
    expect(out.fromOrchestrator).toBe(true);
    expect(out.review.verdict).toBe("pass");
  });

  it("coerceReviewFromProse infers revise from rework language", () => {
    const review = coerceReviewFromProse(
      "Verdict: revise\n- Worker missed edge cases in auth callback.",
      1,
      config,
    );
    expect(review?.verdict).toBe("revise");
  });

  it("falls back to deriveReview when no JSON is present (unit-test helper only — live runs fail instead)", () => {
    const out = extractReview("the worker did stuff, looks fine", derived);
    expect(out.fromOrchestrator).toBe(false);
    expect(out.review.verdict).toBe("pass"); // workerOk + changed
    expect(out.review.summary).toContain("Derived review");
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
