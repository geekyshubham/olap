import type { ArchitectReview, OlapConfig } from "../types.js";

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

/** Orchestrator PLAN prompt: turn the user task + repo context into a worker brief. */
export function buildPlanPrompt(input: {
  config: OlapConfig;
  task: string;
  direct: boolean;
  context?: ContextBlock;
}): string {
  const lines = [
    input.config.architect.system_prompt_hint,
    "",
    "You are the ORCHESTRATOR. Read the task and repository context, then produce a",
    "concise implementation brief for the WORKER. Include:",
    "- the concrete change(s) to make and the files most likely involved",
    "- acceptance checks the worker should satisfy and verify",
    input.direct
      ? "- this is a SINGLE-PASS task: scope the brief so one worker run can finish it"
      : "- keep scope tight so a worker iteration can complete and be reviewed",
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
}): string {
  const schema = {
    schema_version: input.config.architect.review_schema_version,
    iteration: input.iteration,
    verdict: "pass | revise | fail",
    summary: "one sentence",
    findings: [{ severity: "info | warn | error", message: "..." }],
    next_actions: ["..."],
    token_budget_used: 0,
  };
  const files = input.fileList.length > 0 ? input.fileList.join(", ") : "(none)";
  const workerExcerpt =
    input.workerOutput.length > 4000
      ? `${input.workerOutput.slice(0, 4000)}\n... [truncated]`
      : input.workerOutput;
  return [
    input.config.architect.system_prompt_hint,
    "",
    "You are the ORCHESTRATOR reviewing the worker's latest result for this task.",
    "Review scope: diff-only. Judge the worker by the changed file list, diff summary,",
    "worker output, and acceptance criteria; do not request or rely on the full repository context.",
    "Decide: pass (acceptance met), revise (needs another iteration), or fail (blocked).",
    "Respond with ONLY a single JSON object, no prose, matching this shape:",
    JSON.stringify(schema, null, 2),
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
