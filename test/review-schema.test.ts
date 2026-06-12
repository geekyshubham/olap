import { describe, expect, it } from "vitest";
import {
  allReviewsValid,
  createSimulatedReview,
  validateArchitectReview,
} from "../src/validators/review-schema.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("architect review schema", () => {
  it("validates a well-formed review", () => {
    const review = createSimulatedReview(1, DEFAULT_CONFIG, 3);
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

  it("marks pass on final simulated iteration", () => {
    const review = createSimulatedReview(3, DEFAULT_CONFIG, 3);
    expect(review.verdict).toBe("pass");
    expect(allReviewsValid([review], DEFAULT_CONFIG)).toBe(true);
  });
});
