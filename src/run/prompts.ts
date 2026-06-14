import type { AdapterId, ArchitectReview, OlapConfig } from "../types.js";

export interface ContextBlock {
  /** Compact file list with token sizes. */
  digest: string;
  /** Real file contents truncated to a token budget (may be empty). */
  excerpt: string;
  /** One-line git status, e.g. "main ~3 ?1". */
  gitStatus?: string;
}

function contextSection(context: ContextBlock | undefined, label: string): string[] {
  if (!context) return [];
  const lines = ["", `## ${label}`];
  if (context.gitStatus) lines.push(`Git: ${context.gitStatus}`, "");
  lines.push("Packed files:", context.digest);
  if (context.excerpt.trim()) {
    lines.push("", "File contents (truncated to budget):", context.excerpt);
  }
  return lines;
}

/** Machine-parseable output contract prepended to every orchestrator review prompt. */
export function reviewOutputContract(iteration: number, schemaVersion: number): string[] {
  const example = {
    schema_version: schemaVersion,
    iteration,
    verdict: "pass",
    summary: "Worker changes meet acceptance criteria.",
    findings: [{ severity: "info", message: "Diff is scoped and tests pass." }],
    next_actions: [],
    token_budget_used: 0,
  };
  return [
    "REVIEW OUTPUT CONTRACT (mandatory — OLAP parses stdout mechanically; any other format fails the run):",
    "- Reply with EXACTLY one JSON object. No markdown, no code fences, no preamble, no postscript.",
    "- Do not run tools, shell commands, or repository searches for this review.",
    "- The first non-whitespace character must be {. The last non-whitespace character must be }.",
    '- verdict must be exactly one of: "pass", "revise", or "fail" (never multiple values).',
    "- Even when blocked or the task is out of scope, still emit JSON with verdict \"fail\".",
    "- Use this exact shape (replace verdict/summary/findings as appropriate):",
    JSON.stringify(example),
    "",
  ];
}

/** Orchestrator PLAN prompt: turn the user task + repo context into a worker brief. */
export function buildPlanPrompt(input: {
  config: OlapConfig;
  task: string;
  direct: boolean;
  context?: ContextBlock;
  orchestratorAdapter?: AdapterId;
}): string {
  const lines = [
    input.config.architect.system_prompt_hint,
    "",
    "You are the ORCHESTRATOR. Read the task and repository context, then produce a",
    "concise implementation brief for the WORKER.",
    "Plan output may be prose or bullets — the worker needs a clear, actionable brief.",
    "Include:",
    "- the concrete change(s) to make and the files most likely involved",
    "- acceptance checks the worker should satisfy and verify",
    input.direct
      ? "- this is a SINGLE-PASS task: scope the brief so one worker run can finish it"
      : "- keep scope tight so a worker iteration can complete and be reviewed",
    "If the task is out of scope for this repository, say so in the brief and list what",
    "the worker should verify; do not refuse to produce a brief.",
    "Keep the brief compact (no long prose).",
    "",
    "## Task",
    input.task.trim(),
    ...contextSection(input.context, "Repository context"),
  ];
  return lines.join("\n");
}

/** WORKER prompt: the orchestrator brief + real context + prior review feedback. */
export function buildWorkerPrompt(input: {
  task: string;
  brief: string;
  direct: boolean;
  iteration: number;
  totalIterations: number;
  context?: ContextBlock;
  priorReview?: ArchitectReview;
}): string {
  const lines = [
    "You are the WORKER. Implement the orchestrator's brief in this repository.",
    input.direct
      ? "Single pass: make the change, then verify it (run tests/build when appropriate)."
      : `Iteration ${input.iteration}/${input.totalIterations}: implement, then verify.`,
    "Do not modify olap.config.yaml, .olap/, or local tooling caches (.impeccable/, .playwright-cli/, etc.)",
    "unless the task explicitly asks for OLAP/tooling changes. Edit application source only.",
    "State exactly what you changed and the result of each command you ran.",
    "",
    "## Task",
    input.task.trim(),
    "",
    "## Orchestrator brief",
    input.brief.trim() || "(no brief provided)",
  ];

  if (input.priorReview && input.priorReview.verdict !== "pass") {
    lines.push(
      "",
      "## Address this review feedback",
      `Verdict: ${input.priorReview.verdict} — ${input.priorReview.summary}`,
      ...input.priorReview.next_actions.map((a) => `- ${a}`),
    );
  }

  lines.push(...contextSection(input.context, "Repository context"));
  return lines.join("\n");
}

/** Orchestrator REVIEW prompt: must return a JSON review object only. */
export function buildReviewPrompt(input: {
  config: OlapConfig;
  task: string;
  iteration: number;
  totalIterations: number;
  workerOutput: string;
  workerOk: boolean;
  diffText: string;
  fileList: string[];
  orchestratorAdapter?: AdapterId;
}): string {
  const files = input.fileList.length > 0 ? input.fileList.join(", ") : "(none)";
  const workerExcerpt =
    input.workerOutput.length > 4000
      ? `${input.workerOutput.slice(0, 4000)}\n... [truncated]`
      : input.workerOutput;
  return [
    ...reviewOutputContract(input.iteration, input.config.architect.review_schema_version),
    "Tone hint (does not override the JSON contract above):",
    input.config.architect.system_prompt_hint,
    "",
    "You are the ORCHESTRATOR reviewing the worker's latest result for this task.",
    "Review scope: diff-only. Judge the worker by the changed file list, diff summary,",
    "worker output, and acceptance criteria; do not request or rely on the full repository context.",
    "Decide: pass (acceptance met), revise (needs another iteration), or fail (blocked).",
    "",
    "## Task",
    input.task.trim(),
    "",
    `## Worker exit: ${input.workerOk ? "ok" : "failed"}`,
    "",
    "## Files changed",
    files,
    "",
    "## Diff summary",
    input.diffText || "no changes",
    "",
    "## Worker output (truncated)",
    workerExcerpt || "(no output captured)",
  ].join("\n");
}