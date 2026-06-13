import type { ArchitectReview, ArchitectVerdict, OlapConfig } from "../types.js";

const VALID_VERDICTS = new Set<ArchitectVerdict>(["pass", "revise", "fail"]);
const VALID_SEVERITIES = new Set(["info", "warn", "error"]);

export interface ReviewValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateArchitectReview(
  value: unknown,
  expectedSchemaVersion = 1,
): ReviewValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ["review must be an object"] };
  }

  if (typeof value.schema_version !== "number") {
    errors.push("schema_version must be a number");
  } else if (value.schema_version !== expectedSchemaVersion) {
    errors.push(`schema_version must be ${expectedSchemaVersion}`);
  }

  if (
    typeof value.iteration !== "number" ||
    !Number.isFinite(value.iteration) ||
    value.iteration < 1 ||
    !Number.isInteger(value.iteration)
  ) {
    errors.push("iteration must be a positive integer");
  }

  if (typeof value.verdict !== "string" || !VALID_VERDICTS.has(value.verdict as ArchitectVerdict)) {
    errors.push("verdict must be pass, revise, or fail");
  }

  if (typeof value.summary !== "string" || value.summary.trim().length === 0) {
    errors.push("summary must be a non-empty string");
  }

  if (!Array.isArray(value.findings)) {
    errors.push("findings must be an array");
  } else {
    for (const [index, finding] of value.findings.entries()) {
      if (!isRecord(finding)) {
        errors.push(`findings[${index}] must be an object`);
        continue;
      }
      if (typeof finding.severity !== "string" || !VALID_SEVERITIES.has(finding.severity)) {
        errors.push(`findings[${index}].severity must be info, warn, or error`);
      }
      if (typeof finding.message !== "string" || finding.message.trim().length === 0) {
        errors.push(`findings[${index}].message must be a non-empty string`);
      }
    }
  }

  if (!isStringArray(value.next_actions)) {
    errors.push("next_actions must be an array of strings");
  }

  if (
    typeof value.token_budget_used !== "number" ||
    !Number.isFinite(value.token_budget_used) ||
    value.token_budget_used < 0
  ) {
    errors.push("token_budget_used must be a non-negative number");
  }

  return { valid: errors.length === 0, errors };
}

export function allReviewsValid(reviews: ArchitectReview[], config: OlapConfig): boolean {
  if (!config.architect.require_valid_reviews) return true;
  return reviews.every(
    (review) => validateArchitectReview(review, config.architect.review_schema_version).valid,
  );
}
