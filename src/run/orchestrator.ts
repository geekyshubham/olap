import { interpretAgentValue } from "./agent-output.js";
import { validateArchitectReview } from "../validators/review-schema.js";
import type { AdapterId, ArchitectReview, ArchitectVerdict, OlapConfig } from "../types.js";

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
  // JSON/metadata-only blobs (e.g. usage objects) are not a usable plan.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return fallback;
  // Plain-text orchestrator (e.g. kiro chat) — use the raw output as the brief.
  return trimmed;
}

function coerceVerdict(value: unknown): ArchitectVerdict | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v.includes("|")) return undefined;
  if (v === "pass" || v === "approve" || v === "approved" || v === "accept" || v === "ok") {
    return "pass";
  }
  if (v === "revise" || v === "changes" || v === "rework" || v === "retry") return "revise";
  if (v === "fail" || v === "blocked" || v === "reject" || v === "failed") return "fail";
  return undefined;
}

function verdictFromRecord(raw: Record<string, unknown>): ArchitectVerdict | undefined {
  return (
    coerceVerdict(raw.verdict) ??
    coerceVerdict(raw.decision) ??
    coerceVerdict(raw.result) ??
    coerceVerdict(raw.status)
  );
}

/** Coerce a loosely-shaped parsed object into a schema-valid ArchitectReview. */
export function coerceReview(
  raw: Record<string, unknown>,
  iteration: number,
  config: OlapConfig,
): ArchitectReview | undefined {
  const verdict = verdictFromRecord(raw);
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
  orchestratorAdapter?: AdapterId;
}

/**
 * Signal-derived review used only in unit tests. Live runs require orchestrator
 * JSON and fail when it is missing (see loop.ts produceReview).
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

const AGENT_TEXT_KEYS = ["text", "message", "content", "response", "output"] as const;

/** Unwrap ```json fences so embedded review objects can be scanned. */
function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (_, inner: string) => inner.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushParsedObject(value: unknown, out: Record<string, unknown>[]): void {
  if (!isRecord(value)) return;
  out.push(value);
  for (const key of AGENT_TEXT_KEYS) {
    const nested = value[key];
    if (typeof nested !== "string" || !nested.trim()) continue;
    const unfenced = stripCodeFences(nested.trim());
    try {
      pushParsedObject(JSON.parse(unfenced), out);
    } catch {
      for (const obj of findJsonObjects(unfenced)) {
        try {
          pushParsedObject(JSON.parse(obj), out);
        } catch {
          // ignore
        }
      }
    }
  }
  const nestedReview = value.review;
  if (isRecord(nestedReview)) out.push(nestedReview);
}

/** Strip ANSI color / style sequences from terminal CLI output. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- intentional ESC stripping
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function inferVerdictFromProse(text: string): ArchitectVerdict | undefined {
  const normalized = stripAnsi(text).toLowerCase();

  if (
    /\bpass\s*\|\s*revise\s*\|\s*fail\b/.test(normalized) ||
    /"verdict"\s*:\s*"[^"]*\|/.test(normalized)
  ) {
    return undefined;
  }

  const jsonVerdict = normalized.match(/"verdict"\s*:\s*"(pass|revise|fail)"/);
  if (jsonVerdict) return coerceVerdict(jsonVerdict[1]);

  const labeled = normalized.match(/\bverdict\s*[:=]\s*(pass|revise|fail|blocked|approve|approved)/);
  if (labeled) return coerceVerdict(labeled[1]);

  if (/\bblocked\b/.test(normalized) || /\bscope mismatch\b/.test(normalized)) return "fail";
  if (
    /\bneeds (another|more) (iteration|pass|round)\b/.test(normalized) ||
    /\b(revise|rework|retry)\b/.test(normalized)
  ) {
    return "revise";
  }
  if (
    /\b(looks good|ship it|accept(?:ed)?|approved)\b/.test(normalized) ||
    (/\bpass(?:es|ed)?\b/.test(normalized) && !/\bfail/.test(normalized))
  ) {
    return "pass";
  }
  return undefined;
}

function extractSummaryFromProse(text: string): string {
  const clean = stripAnsi(text).replace(/\r/g, "").trim();
  const blocked = clean.match(/BLOCKED[^\n]*/i);
  if (blocked) return blocked[0].trim();

  const conclusion = clean.match(/Conclusion:\s*\n?([^\n]+)/i);
  if (conclusion?.[1]?.trim()) return conclusion[1].trim();

  for (const line of clean.split("\n")) {
    const trimmed = line.trim();
    if (
      trimmed.length > 12 &&
      !/^searching\b/i.test(trimmed) &&
      !/^i will run\b/i.test(trimmed) &&
      !/^\(using tool:/i.test(trimmed)
    ) {
      return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
    }
  }
  return "Orchestrator review (parsed from plain text).";
}

function coerceFinding(
  value: unknown,
): ArchitectReview["findings"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (!("severity" in value) || !("message" in value) || "verdict" in value) return undefined;
  const severity =
    value.severity === "error" || value.severity === "warn" || value.severity === "info"
      ? value.severity
      : "info";
  const message = typeof value.message === "string" ? value.message.trim() : "";
  return message ? { severity, message } : undefined;
}

function collectLooseFindings(stdout: string): ArchitectReview["findings"] {
  const findings: ArchitectReview["findings"] = [];
  const seen = new Set<string>();
  for (const parsed of collectReviewCandidates(stdout)) {
    const finding = coerceFinding(parsed);
    if (finding && !seen.has(finding.message)) {
      seen.add(finding.message);
      findings.push(finding);
    }
  }
  for (const obj of findJsonObjects(stripAnsi(stdout))) {
    try {
      const finding = coerceFinding(JSON.parse(obj));
      if (finding && !seen.has(finding.message)) {
        seen.add(finding.message);
        findings.push(finding);
      }
    } catch {
      // ignore
    }
  }
  for (const line of stripAnsi(stdout).split("\n")) {
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    if (!bullet) continue;
    const message = bullet[1].trim();
    if (message.length < 12 || seen.has(message)) continue;
    seen.add(message);
    const severity = /error|fail|blocked|vulnerab/i.test(message)
      ? "error"
      : /warn/i.test(message)
        ? "warn"
        : "info";
    findings.push({ severity, message });
  }
  return findings.slice(0, 12);
}

/** Build a schema-valid review from plain-text orchestrator output (kiro, ollama). */
export function coerceReviewFromProse(
  stdout: string,
  iteration: number,
  config: OlapConfig,
): ArchitectReview | undefined {
  const verdict = inferVerdictFromProse(stdout);
  if (!verdict) return undefined;

  const findings = collectLooseFindings(stdout);
  const summary = extractSummaryFromProse(stdout);
  return coerceReview(
    {
      verdict,
      summary,
      findings,
      next_actions: [],
      token_budget_used: 0,
    },
    iteration,
    config,
  );
}

/** Collect every JSON object that might contain a review verdict from noisy CLI stdout. */
export function collectReviewCandidates(stdout: string): Record<string, unknown>[] {
  const normalized = stripCodeFences(stripAnsi(stdout).trim());
  const candidates: Record<string, unknown>[] = [];

  try {
    pushParsedObject(JSON.parse(normalized), candidates);
  } catch {
    for (const obj of findJsonObjects(normalized)) {
      try {
        pushParsedObject(JSON.parse(obj), candidates);
      } catch {
        // ignore
      }
    }
  }

  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      pushParsedObject(JSON.parse(trimmed), candidates);
    } catch {
      // ignore
    }
  }

  return candidates;
}

/** Parse orchestrator review output; derive a signal-based review only when tests need a fallback. */
export function extractReview(
  stdout: string,
  derived: DerivedReviewInput,
): ReviewExtraction {
  const candidates = collectReviewCandidates(stdout);
  // Prefer the last object that mentions a verdict (CLIs often print logs first).
  for (const parsed of [...candidates].reverse()) {
    const review = coerceReview(parsed, derived.iteration, derived.config);
    if (review) return { review, fromOrchestrator: true };
  }

  const proseReview = coerceReviewFromProse(stdout, derived.iteration, derived.config);
  if (proseReview) return { review: proseReview, fromOrchestrator: true };

  return { review: deriveReview(derived), fromOrchestrator: false };
}
