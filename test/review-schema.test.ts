import { describe, expect, it } from "vitest";
import { allReviewsValid, validateArchitectReview } from "../src/validators/review-schema.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { ArchitectReview } from "../src/types.js";

function sampleReview(iteration: number, verdict: ArchitectReview["verdict"]): ArchitectReview {
  return {
    schema_version: DEFAULT_CONFIG.architect.review_schema_version,
    iteration,
    verdict,
    summary: `Review ${iteration}: ${verdict}`,
    findings: [{ severity: "info", message: "ok" }],
    next_actions: [],
    token_budget_used: 120,
  };
}

describe("architect review schema", () => {
  it("validates a well-formed review", () => {
    const review = sampleReview(1, "pass");
    const result = validateArchitectReview(
      review,
      DEFAULT_CONFIG.architect.review_schema_version,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid reviews", () => {
    const result = validateArchitectReview({ iteration: 0, verdict: "maybe" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("accepts a passing final-iteration review", () => {
    const review = sampleReview(3, "pass");
    expect(review.verdict).toBe("pass");
    expect(allReviewsValid([review], DEFAULT_CONFIG)).toBe(true);
  });
});