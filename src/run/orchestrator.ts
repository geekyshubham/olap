import { interpretAgentValue } from "./agent-output.js";
import { validateArchitectReview } from "../validators/review-schema.js";
import type { ArchitectReview, ArchitectVerdict, OlapConfig } from "../types.js";

/** Scan text for top-level JSON objects ({...}) and return them in order. */
export function findJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Extract a human-readable plan/brief from orchestrator CLI output. Handles
 * JSON CLIs (grok/claude/codex/gemini) by pulling text/thought chunks, and
 * plain-text CLIs (kiro chat) by using the raw output.
 */
export function extractPlanText(stdout: string, fallback: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return fallback;

  const texts: string[] = [];
  // Try whole-output JSON, then any embedded JSON objects, then NDJSON lines.
  const candidates: unknown[] = [];
  try {
    candidates.push(JSON.parse(trimmed));
  } catch {
    for (const obj of findJsonObjects(trimmed)) {
      try {
        candidates.push(JSON.parse(obj));
      } catch {
        // ignore
      }
    }
  }
  for (const value of candidates) {
    const { chunks } = interpretAgentValue(value);
    for (const chunk of chunks) {
      if (chunk.kind === "text" || chunk.kind === "thought") texts.push(chunk.content);
    }
  }

  if (texts.length > 0) return texts.join("\n").trim();
  // Plain-text orchestrator (e.g. kiro chat) — use the raw output as the brief.
  return trimmed;
}

function coerceVerdict(value: unknown): ArchitectVerdict | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "pass" || v === "approve" || v === "approved" || v === "accept") return "pass";
  if (v === "revise" || v === "changes" || v === "rework" || v === "retry") return "revise";
  if (v === "fail" || v === "blocked" || v === "reject") return "fail";
  return undefined;
}

/** Coerce a loosely-shaped parsed object into a schema-valid ArchitectReview. */
export function coerceReview(
  raw: Record<string, unknown>,
  iteration: number,
  config: OlapConfig,
): ArchitectReview | undefined {
  const verdict = coerceVerdict(raw.verdict);
  if (!verdict) return undefined;

  const findingsRaw = Array.isArray(raw.findings) ? raw.findings : [];
  const findings = findingsRaw
    .map((f) => {
      if (!f || typeof f !== "object") return undefined;
      const rec = f as Record<string, unknown>;
      const severity =
        rec.severity === "error" || rec.severity === "warn" || rec.severity === "info"
          ? rec.severity
          : "info";
      const message = typeof rec.message === "string" ? rec.message : "";
      return message.trim() ? { severity, message } : undefined;
    })
    .filter((f): f is ArchitectReview["findings"][number] => f !== undefined);

  const nextActions = Array.isArray(raw.next_actions)
    ? raw.next_actions.filter((a): a is string => typeof a === "string")
    : [];

  const summary =
    typeof raw.summary === "string" && raw.summary.trim()
      ? raw.summary.trim()
      : `Architect review ${iteration}: ${verdict}.`;

  const review: ArchitectReview = {
    schema_version: config.architect.review_schema_version,
    iteration,
    verdict,
    summary,
    findings: findings.length > 0 ? findings : [{ severity: "info", message: summary }],
    next_actions: nextActions,
    token_budget_used:
      typeof raw.token_budget_used === "number"
        ? Math.min(config.architect.output_budget_tokens, Math.max(0, raw.token_budget_used))
        : 0,
  };
  return validateArchitectReview(review, config.architect.review_schema_version).valid
    ? review
    : undefined;
}

export interface DerivedReviewInput {
  iteration: number;
  totalIterations: number;
  config: OlapConfig;
  workerOk: boolean;
  changed: boolean;
  changeSummary: string;
}

/**
 * When the orchestrator didn't return a parseable review, derive one from real
 * signals (worker exit + whether files changed) instead of faking a pass. This
 * keeps the loop honest in live mode without a hard failure on noncompliant CLIs.
 */
export function deriveReview(input: DerivedReviewInput): ArchitectReview {
  const { iteration, totalIterations, config } = input;
  let verdict: ArchitectVerdict;
  let message: string;
  if (!input.workerOk) {
    verdict = "fail";
    message = "Worker did not complete successfully.";
  } else if (!input.changed) {
    verdict = iteration >= totalIterations ? "fail" : "revise";
    message = "Worker reported success but no file changes were detected.";
  } else {
    verdict = "pass";
    message = `Worker applied changes (${input.changeSummary}).`;
  }
  return {
    schema_version: config.architect.review_schema_version,
    iteration,
    verdict,
    summary: `Derived review ${iteration}: ${verdict} — ${message}`,
    findings: [
      { severity: verdict === "fail" ? "error" : verdict === "revise" ? "warn" : "info", message },
    ],
    next_actions:
      verdict === "pass"
        ? ["Finalize artifacts."]
        : verdict === "fail"
          ? ["Re-run the worker after addressing the failure."]
          : [`Run worker iteration ${iteration + 1}.`],
    token_budget_used: 0,
  };
}

export interface ReviewExtraction {
  review: ArchitectReview;
  /** True when parsed from the orchestrator's own JSON; false when derived. */
  fromOrchestrator: boolean;
}

/** Parse orchestrator review output; fall back to a signal-derived review. */
export function extractReview(
  stdout: string,
  derived: DerivedReviewInput,
): ReviewExtraction {
  const objects = findJsonObjects(stdout);
  // Prefer the last object that mentions a verdict (CLIs often print logs first).
  for (const obj of objects.reverse()) {
    try {
      const parsed = JSON.parse(obj) as Record<string, unknown>;
      const candidate = "verdict" in parsed ? parsed : (parsed.review as Record<string, unknown>);
      if (candidate && typeof candidate === "object") {
        const review = coerceReview(candidate, derived.iteration, derived.config);
        if (review) return { review, fromOrchestrator: true };
      }
    } catch {
      // keep scanning
    }
  }
  return { review: deriveReview(derived), fromOrchestrator: false };
}
