import {
  buildRoleCommands,
  summarizeCommandShell,
  withCommandPrompt,
} from "../adapters/build.js";
import {
  estimateTokens,
  renderContextDigest,
  renderContextExcerpt,
} from "../context/pack.js";
import {
  EMPTY_DIFF_SUMMARY,
  formatDiffSummary,
  formatRepoStatus,
  getDiffSummary,
  getHeadOid,
  isGitWorkTree,
  getRepoStatus,
  getRunDiffSummary,
  getWorktreeChangeSignature,
  type DiffSummary,
} from "../git/status.js";
import { runValidators } from "../validators/runner.js";
import { validateArchitectReview } from "../validators/review-schema.js";
import { isAbortedStopReason } from "./agent-output.js";
import { createAgentStream } from "./agent-stream.js";
import { executeCommand, type ExecResult } from "./executor.js";
import { extractPlanText, extractReview, findJsonObjects } from "./orchestrator.js";
import { buildPlanPrompt, buildReviewPrompt, buildWorkerPrompt, type ContextBlock } from "./prompts.js";
import { parseTaskOverride, routeTask } from "./routing.js";
import { estimateUsageCost, formatCostSummary } from "./cost.js";
import type {
  AdapterCommand,
  AdapterDetection,
  ArchitectReview,
  CostSnapshot,
  ContextPack,
  OlapConfig,
  ResolvedRole,
  RoleId,
  RunEvent,
  RunSummary,
  UsageSnapshot,
  ValidatorConfig,
  ValidatorResult,
  WorkMode,
} from "../types.js";

export type LoopPhaseId = "context" | "plan" | "work" | "review" | "done";

/** Token budgets for context injected into prompts (kept well under ARG_MAX). */
const ORCH_CONTEXT_TOKENS = 12000;
const WORKER_CONTEXT_TOKENS = 8000;
const MAX_BRIEF_CHARS = 4000;

export interface LoopUpdate {
  type:
    | "phase"
    | "event"
    | "review"
    | "usage"
    | "output"
    | "agent"
    | "brief"
    | "command"
    | "routing"
    | "diff"
    | "activity"
    | "validator"
    | "final"
    | "error";
  phase?: LoopPhaseId;
  label?: string;
  event?: RunEvent;
  review?: ArchitectReview;
  usage?: UsageSnapshot;
  cost?: CostSnapshot;
  iteration?: number;
  totalIterations?: number;
  stream?: "stdout" | "stderr";
  line?: string;
  role?: RoleId;
  text?: string;
  command?: string;
  strategy?: "direct" | "loop";
  reason?: string;
  agentKind?: "text" | "thought" | "tool" | "status" | "error";
  content?: string;
  diff?: DiffSummary;
  activity?: { tool?: string; file?: string };
  validators?: ValidatorResult[];
  result?: OrchestratedResult;
  error?: string;
}

export interface OrchestratedResult {
  events: RunEvent[];
  reviews: ArchitectReview[];
  adapterCommands: AdapterCommand[];
  summary: RunSummary;
  report: string;
  /** Full orchestrator plan/brief text (untruncated) for artifacts and the TUI. */
  brief: string;
  usage: UsageSnapshot;
  roles: Record<RoleId, ResolvedRole>;
  status: "completed" | "failed";
  executed: boolean;
  diff: DiffSummary;
  validators: ValidatorResult[];
  cost: CostSnapshot;
}

/** Whether a finished run should mark its session completed. */
export function shouldCompleteSession(
  result: Pick<OrchestratedResult, "status" | "reviews">,
): boolean {
  return (
    result.status === "completed" &&
    (result.reviews.length === 0 || result.reviews.at(-1)?.verdict === "pass")
  );
}

/** Terminal session status after a run finishes. */
export function terminalSessionStatus(
  result: Pick<OrchestratedResult, "status" | "reviews">,
): "completed" | "failed" {
  return shouldCompleteSession(result) ? "completed" : "failed";
}

function donePhaseLabel(
  status: "completed" | "failed",
  mode: WorkMode,
): string {
  if (status === "failed") return mode === "plan" ? "Plan failed" : "Run failed";
  if (mode === "plan") return "Plan-only mode: workers not run";
  return "Run complete";
}

export interface RunLoopOptions {
  task: string;
  config: OlapConfig;
  cwd: string;
  detections: AdapterDetection[];
  contextPack?: ContextPack;
  runId?: string;
  sessionId?: string;
  now?: () => Date;
  delay?: (ms: number) => Promise<void>;
  stepDelayMs?: number;
  execute?: typeof executeCommand;
  /** Run-scoped diff since baseline (injectable for tests). */
  getRunDiff?: (cwd: string, baselineRef: string) => Promise<DiffSummary>;
  /** HEAD OID provider (injectable for tests). */
  getHead?: (cwd: string) => Promise<string | undefined>;
  /** Git status line provider (injectable for tests). */
  repoStatus?: (cwd: string) => Promise<string | undefined>;
  /** Working-tree change signature provider (injectable for tests). */
  getChangeSignature?: (cwd: string) => Promise<string | undefined>;
  /** Validator runner (injectable for tests). */
  runValidatorsFn?: (validators: ValidatorConfig[], cwd: string) => Promise<ValidatorResult[]>;
  signal?: AbortSignal;
  onUpdate?: (update: LoopUpdate) => void;
}

const realDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function emptyUsage(): UsageSnapshot {
  return {
    orchestrator: { tokens_in: 0, tokens_out: 0, calls: 0 },
    worker: { tokens_in: 0, tokens_out: 0, calls: 0 },
    subagents_spawned: 0,
    subagents_active: 0,
  };
}

/** Whether the worker phase should spawn a process. */
export function shouldExecuteWorker(mode: WorkMode, workerAvailable: boolean): boolean {
  if (mode === "plan") return false;
  return workerAvailable;
}

/** Whether the orchestrator should spawn its CLI for plan/review. */
export function shouldRunOrchestrator(orchestratorAvailable: boolean): boolean {
  return orchestratorAvailable;
}

function usageFromJsonValue(parsed: Record<string, unknown>): { tokens_in: number; tokens_out: number } | undefined {
  const usage = (parsed.usage ?? parsed) as Record<string, unknown>;
  const inTok = Math.max(
    0,
    Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.tokens_in ?? 0) || 0,
  );
  const outTok = Math.max(
    0,
    Number(usage.output_tokens ?? usage.completion_tokens ?? usage.tokens_out ?? 0) || 0,
  );
  if (inTok > 0 || outTok > 0) {
    return { tokens_in: inTok, tokens_out: outTok };
  }
  return undefined;
}

function usageFromParsedValue(value: unknown): { tokens_in: number; tokens_out: number } | undefined {
  if (Array.isArray(value)) {
    for (const item of [...value].reverse()) {
      if (item && typeof item === "object") {
        const hit = usageFromJsonValue(item as Record<string, unknown>);
        if (hit) return hit;
      }
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    return usageFromJsonValue(value as Record<string, unknown>);
  }
  return undefined;
}

/** Best-effort extraction of token usage from a worker CLI's JSON output. */
export function parseUsageFromOutput(stdout: string): { tokens_in: number; tokens_out: number } {
  const trimmed = stdout.trim();
  if (trimmed) {
    try {
      const hit = usageFromParsedValue(JSON.parse(trimmed));
      if (hit) return hit;
    } catch {
      // fall through to embedded-object / NDJSON scan
    }
  }

  // Prefer the last embedded object with usage (CLIs may log before the final JSON blob).
  for (const obj of [...findJsonObjects(stdout)].reverse()) {
    try {
      const hit = usageFromJsonValue(JSON.parse(obj) as Record<string, unknown>);
      if (hit) return hit;
    } catch {
      // keep scanning
    }
  }

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try {
      const hit = usageFromJsonValue(JSON.parse(line) as Record<string, unknown>);
      if (hit) return hit;
    } catch {
      // not JSON; keep scanning
    }
  }
  return { tokens_in: 0, tokens_out: 0 };
}

function buildContextBlock(
  pack: ContextPack | undefined,
  budgetTokens: number,
  gitStatus?: string,
): ContextBlock {
  return {
    digest: renderContextDigest(pack),
    excerpt: renderContextExcerpt(pack, budgetTokens),
    gitStatus,
  };
}

/** Bound a plan for one-line event log messages (not the worker payload). */
function capBrief(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_BRIEF_CHARS ? `${trimmed.slice(0, MAX_BRIEF_CHARS)}\n... [brief truncated]` : trimmed;
}

interface WorkerRunResult {
  result: ExecResult;
  stopReason?: string;
}

/**
 * Run the orchestrated architect/worker loop, emitting live updates so the TUI
 * can show real progress.
 *
 * Spawns the orchestrator CLI to PLAN and to REVIEW, and the worker CLI to
 * implement — each with real repository context injected.
 */
export async function runOrchestratedLoop(
  options: RunLoopOptions,
): Promise<OrchestratedResult> {
  const config = options.config;
  const clock = options.now ?? (() => new Date());
  const delay = options.delay ?? realDelay;
  const stepDelay = options.stepDelayMs ?? 220;
  const execute = options.execute ?? executeCommand;
  const getRunDiff =
    options.getRunDiff ?? ((cwd: string, baseline: string) => getRunDiffSummary(cwd, baseline));
  const getHead = options.getHead ?? ((cwd: string) => getHeadOid(cwd));
  const repoStatusFn =
    options.repoStatus ?? (async (cwd: string) => formatRepoStatus(await getRepoStatus(cwd)));
  const getChangeSignature =
    options.getChangeSignature ?? ((cwd: string) => getWorktreeChangeSignature(cwd));
  const runValidatorsFn = options.runValidatorsFn ?? runValidators;
  const emit = options.onUpdate ?? (() => undefined);
  const mode = config.ui.mode;

  const events: RunEvent[] = [];
  const reviews: ArchitectReview[] = [];
  const executedCommands: AdapterCommand[] = [];
  const validatorResults: ValidatorResult[] = [];
  const usage = emptyUsage();
  let diff: DiffSummary = { ...EMPTY_DIFF_SUMMARY };
  let workerCancelled = false;
  let runBaselineHead: string | undefined;
  let runBaselineSignature: string | undefined;
  let gitAvailable = false;

  const ts = () => clock().toISOString();
  const pushEvent = (event: RunEvent) => {
    events.push(event);
    emit({ type: "event", event });
  };

  const route = routeTask(options.task, config.worker.loop_policy);
  const { task: cleanedTask } = parseTaskOverride(options.task);
  emit({ type: "routing", strategy: route.strategy, reason: route.reason });
  const direct = route.strategy === "direct";

  const { commands, roles } = buildRoleCommands({
    config,
    detections: options.detections,
    task: cleanedTask,
    architectPrompt: `${config.architect.system_prompt_hint}\n\nTask:\n${cleanedTask}`,
  });
  const currentCost = (): CostSnapshot => estimateUsageCost(config, usage, roles);
  const pushUsage = () =>
    emit({ type: "usage", usage: structuredClone(usage), cost: currentCost() });
  const failIfBudgetExceeded = (): boolean => {
    const cost = currentCost();
    if (!cost.budget_exceeded) return false;
    status = "failed";
    emit({ type: "error", error: `Estimated cost budget exceeded (${formatCostSummary(cost)}).` });
    return true;
  };
  const architectBase = commands.find((c) => c.phase === "architect");
  const workerBase = commands.find((c) => c.phase === "worker");

  const workerAvailable = roles.worker.available && !!workerBase;
  const orchestratorAvailable = roles.orchestrator.available && !!architectBase;
  const workerLive = shouldExecuteWorker(mode, workerAvailable);
  const orchLive = shouldRunOrchestrator(orchestratorAvailable);
  const executed = workerLive || orchLive;

  // Phase: context
  emit({ type: "phase", phase: "context", label: "Packing repository context" });
  const contextTokens = options.contextPack?.total_tokens ?? estimateTokens(options.task);
  const gitStatus = executed ? await repoStatusFn(options.cwd).catch(() => undefined) : undefined;
  if (executed) {
    gitAvailable = await isGitWorkTree(options.cwd).catch(() => false);
    if (gitAvailable) {
      runBaselineHead = await getHead(options.cwd).catch(() => undefined);
      runBaselineSignature = await getChangeSignature(options.cwd).catch(() => undefined);
      // Transient git hiccups at run start should not force a false "no changes" failure.
      if (runBaselineSignature === undefined) {
        runBaselineSignature = await getChangeSignature(options.cwd).catch(() => undefined);
      }
    }
  }
  const orchContext = buildContextBlock(
    options.contextPack,
    Math.min(config.architect.context_pack_max_tokens, ORCH_CONTEXT_TOKENS),
    gitStatus,
  );
  const workerContext = buildContextBlock(
    options.contextPack,
    Math.min(config.architect.context_pack_max_tokens, WORKER_CONTEXT_TOKENS),
    gitStatus,
  );
  await delay(stepDelay);

  let iterationsRun = 0;
  let status: "completed" | "failed" = "completed";
  let lastWorkerOk = true;
  const maxIterations = direct
    ? 1
    : route.complexity === "moderate"
      ? Math.max(1, Math.min(2, config.worker.max_iterations))
      : Math.max(1, config.worker.max_iterations);

  // Phase: plan (orchestrator)
  emit({ type: "phase", phase: "plan", label: `Orchestrator planning (${roles.orchestrator.model})` });
  const planPrompt = buildPlanPrompt({ config, task: cleanedTask, direct, context: orchContext });
  let planText = "";

  if (mode !== "plan" && !workerAvailable) {
    status = "failed";
    emit({
      type: "error",
      error: `Worker adapter (${roles.worker.adapter}) is not installed.`,
    });
  } else if (!orchestratorAvailable) {
    status = "failed";
    emit({
      type: "error",
      error: `Orchestrator adapter (${roles.orchestrator.adapter}) is not installed.`,
    });
  } else {
    const planCommand = withCommandPrompt(architectBase!, planPrompt, {
      step: "plan",
      executed: true,
    });
    executedCommands.push(planCommand);
    emit({ type: "command", role: "orchestrator", command: summarizeCommandShell(planCommand) });
    const planRun = await runProcess(planCommand, options, execute, emit, "orchestrator");
    const planUsage = parseUsageFromOutput(planRun.stdout);
    usage.orchestrator.tokens_in += planUsage.tokens_in;
    usage.orchestrator.tokens_out += planUsage.tokens_out;
    usage.orchestrator.calls += 1;
    planText = extractPlanText(planRun.stdout, "");
    if (!planRun.ok || !planText) {
      status = "failed";
      const exitNote =
        planRun.exitCode !== null && planRun.exitCode !== 0 ? ` (exit ${planRun.exitCode})` : "";
      emit({
        type: "error",
        error: !planText
          ? planRun.ok
            ? "Orchestrator produced no usable plan."
            : `Orchestrator failed to produce a plan${exitNote}.`
          : `Orchestrator plan process failed${exitNote} despite partial output.`,
      });
    }
    pushEvent({
      ts: ts(),
      phase: "architect",
      type: "plan",
      tokens_in: planUsage.tokens_in,
      tokens_out: planUsage.tokens_out,
      message: planText ? `Architect plan: ${capBrief(planText)}` : "Architect plan: (no output)",
    });
  }
  emit({ type: "brief", role: "orchestrator", text: planText.trim() || "(no plan produced)" });
  const fullBrief = planText.trim();
  pushUsage();
  if (status !== "failed") {
    failIfBudgetExceeded();
  }
  await delay(stepDelay);

  if (mode !== "plan" && status !== "failed") {
    let priorReview: ArchitectReview | undefined;
    for (let i = 1; i <= maxIterations; i++) {
      if (options.signal?.aborted) {
        status = "failed";
        emit({ type: "error", error: "Run cancelled before worker iteration." });
        break;
      }
      iterationsRun = i;

      const workerPrompt = buildWorkerPrompt({
        task: cleanedTask,
        brief: fullBrief || cleanedTask,
        direct,
        iteration: i,
        totalIterations: maxIterations,
        context: workerContext,
        priorReview,
      });

      emit({
        type: "phase",
        phase: "work",
        label: direct
          ? `Worker direct pass (${roles.worker.model})`
          : `Worker iteration ${i}/${maxIterations} (${roles.worker.model})`,
        iteration: i,
        totalIterations: maxIterations,
      });
      emit({
        type: "brief",
        role: "worker",
        text: direct
          ? `Implementing brief in a single pass: ${cleanedTask}`
          : `Iteration ${i}/${maxIterations}: ${cleanedTask}`,
      });

      let workerOutput = "";

      const workerCommand = withCommandPrompt(workerBase!, workerPrompt, {
        step: "implement",
        executed: true,
      });
      executedCommands.push(workerCommand);
      emit({ type: "command", role: "worker", command: summarizeCommandShell(workerCommand) });
      const run = await runWorkerProcess(workerCommand, options, execute, emit);
      workerOutput = run.result.stdout;
      const parsed = parseUsageFromOutput(run.result.stdout);
      const workerIn = parsed.tokens_in;
      const workerOut = parsed.tokens_out;
      const cancelled = run.result.aborted || isAbortedStopReason(run.stopReason);
      if (cancelled) workerCancelled = true;
      lastWorkerOk = run.result.ok && !cancelled;
      const failReason = run.result.aborted
        ? "cancelled"
        : run.result.timedOut
          ? "timeout"
          : cancelled
            ? `stopReason ${run.stopReason}`
            : `exit ${run.result.exitCode}`;
      const prefix = direct ? "Worker" : `Worker iteration ${i}`;
      const workerMessage = lastWorkerOk
        ? `${prefix}: completed (exit ${run.result.exitCode})`
        : `${prefix}: failed (${failReason})`;
      if (runBaselineHead) {
        diff = await getRunDiff(options.cwd, runBaselineHead).catch(() => ({ ...EMPTY_DIFF_SUMMARY }));
      } else {
        diff = await getDiffSummary(options.cwd).catch(() => ({ ...EMPTY_DIFF_SUMMARY }));
      }
      emit({ type: "diff", diff });

      usage.worker.tokens_in += workerIn;
      usage.worker.tokens_out += workerOut;
      usage.worker.calls += 1;
      pushEvent({
        ts: ts(),
        phase: "worker",
        type: "implement",
        tokens_in: workerIn,
        tokens_out: workerOut,
        message: workerMessage,
      });
      pushUsage();
      if (failIfBudgetExceeded()) break;

      if (direct) {
        status = lastWorkerOk ? "completed" : "failed";
        break;
      }

      if (!lastWorkerOk) {
        status = "failed";
        break;
      }

      // Phase: review (orchestrator)
      emit({ type: "phase", phase: "review", label: `Orchestrator reviewing iteration ${i}` });
      const { review, tokensIn: reviewIn, tokensOut: reviewOut } = await produceReview({
        i,
        maxIterations,
        config,
        architectBase: architectBase!,
        task: cleanedTask,
        workerOutput,
        workerOk: lastWorkerOk,
        diff,
        options,
        execute,
        emit,
        executedCommands,
        usage,
      });

      const validation = validateArchitectReview(review, config.architect.review_schema_version);
      if (!validation.valid && config.architect.require_valid_reviews) {
        status = "failed";
        emit({ type: "error", error: `Invalid architect review: ${validation.errors.join("; ")}` });
        break;
      }
      reviews.push(review);
      priorReview = review;
      emit({ type: "review", review });
      pushEvent({
        ts: ts(),
        phase: "architect",
        type: "review",
        tokens_in: reviewIn,
        tokens_out: reviewOut,
        message: review.summary,
      });
      pushUsage();
      if (failIfBudgetExceeded()) break;
      await delay(stepDelay);

      if (review.verdict === "fail") {
        status = "failed";
        break;
      }
      if (review.verdict === "pass" && config.worker.stop_on_first_pass) break;
      // verdict === "revise" (or pass with stop_on_first_pass off): continue.
    }

    if (!direct && status !== "failed") {
      const finalReview = reviews.at(-1);
      if (lastWorkerOk && finalReview?.verdict === "pass") {
        status = "completed";
      } else {
        status = "failed";
        if (finalReview?.verdict === "revise") {
          emit({
            type: "error",
            error: "Review loop ended with revise and no iterations remaining.",
          });
        }
      }
    }
  }

  const currentHead = gitAvailable
    ? await getHead(options.cwd).catch(() => undefined)
    : undefined;
  const headMoved =
    !!currentHead && (!runBaselineHead || currentHead !== runBaselineHead);
  const currentSignature = gitAvailable
    ? await getChangeSignature(options.cwd).catch(() => undefined)
    : undefined;
  const worktreeChangedSinceStart =
    runBaselineSignature !== undefined &&
    currentSignature !== undefined &&
    currentSignature !== runBaselineSignature;
  if (status === "completed" && executed && mode !== "plan" && !direct) {
    if (!gitAvailable) {
      status = "failed";
      emit({ type: "error", error: "Cannot verify file changes outside a git work tree." });
    } else if (!worktreeChangedSinceStart && !headMoved) {
      const fallbackToRunDiff =
        runBaselineSignature === undefined && diff.changed;
      if (!fallbackToRunDiff) {
        status = "failed";
        emit({
          type: "error",
          error: runBaselineHead
            ? "No file changes were detected since the run started."
            : "No file changes were detected (repository has no commits yet).",
        });
      }
    }
  }

  // Workflow mode: run configured validators as a gate on real runs.
  let validatorsPassed: boolean | undefined;
  if (
    mode === "workflow" &&
    status === "completed" &&
    iterationsRun > 0 &&
    config.validators.length > 0
  ) {
    emit({ type: "phase", phase: "review", label: "Running validators" });
    let validatorError: string | undefined;
    const results = await runValidatorsFn(config.validators, options.cwd).catch((error: unknown) => {
      validatorError = error instanceof Error ? error.message : String(error);
      return [];
    });
    validatorResults.push(...results);
    emit({ type: "validator", validators: results });
    for (const r of results) {
      pushEvent({
        ts: ts(),
        phase: "worker",
        type: "validate",
        tokens_in: 0,
        tokens_out: 0,
        message: `${r.name}: ${r.ok ? "pass" : `fail (exit ${r.exitCode})`}`,
      });
    }
    if (validatorError) {
      status = "failed";
      emit({ type: "error", error: `Validators could not run: ${validatorError}` });
    } else {
      validatorsPassed = results.length > 0 && results.every((r) => r.ok);
      if (validatorsPassed === false) {
        status = "failed";
        emit({ type: "error", error: "Validators failed — run marked failed." });
      }
    }
  }

  const didExecute = executedCommands.length > 0;

  const runId = options.runId ?? "loop-run";
  const sessionId = options.sessionId ?? "loop-session";
  const reviewsValid = reviews.filter(
    (review) => validateArchitectReview(review, config.architect.review_schema_version).valid,
  ).length;
  const cost = currentCost();
  const summary: RunSummary = {
    run_id: runId,
    session_id: sessionId,
    adapter: roles.worker.adapter,
    iterations: iterationsRun,
    reviews_valid: reviewsValid,
    context_pack_tokens: contextTokens,
    cwd: options.cwd,
    executed: didExecute,
    files_changed: diff.files.length,
    worker_cancelled: workerCancelled,
    validators_passed: validatorsPassed,
    cost,
  };

  const report = buildReport({
    task: options.task,
    config,
    roles,
    reviews,
    commands: executedCommands,
    usage,
    summary,
    executed: didExecute,
    status,
    diff,
    validators: validatorResults,
    cost,
  });

  const result: OrchestratedResult = {
    events,
    reviews,
    adapterCommands: executedCommands,
    summary,
    report,
    brief: fullBrief,
    usage,
    roles,
    status,
    executed: didExecute,
    diff,
    validators: validatorResults,
    cost,
  };

  emit({ type: "phase", phase: "done", label: donePhaseLabel(status, mode) });
  emit({ type: "final", result, usage: structuredClone(usage), cost });
  return result;
}

/** Run the orchestrator review phase via the real CLI. */
async function produceReview(args: {
  i: number;
  maxIterations: number;
  config: OlapConfig;
  architectBase: AdapterCommand;
  task: string;
  workerOutput: string;
  workerOk: boolean;
  diff: DiffSummary;
  options: RunLoopOptions;
  execute: typeof executeCommand;
  emit: (u: LoopUpdate) => void;
  executedCommands: AdapterCommand[];
  usage: UsageSnapshot;
}): Promise<{ review: ArchitectReview; tokensIn: number; tokensOut: number }> {
  const { config, i, maxIterations, usage } = args;
  const reviewPrompt = buildReviewPrompt({
    config,
    task: args.task,
    iteration: i,
    totalIterations: maxIterations,
    workerOutput: args.workerOutput,
    workerOk: args.workerOk,
    diffText: formatDiffSummary(args.diff),
    fileList: args.diff.files.map((f) => f.path),
  });
  const reviewCommand = withCommandPrompt(args.architectBase, reviewPrompt, {
    step: "review",
    executed: true,
  });
  args.executedCommands.push(reviewCommand);
  args.emit({ type: "command", role: "orchestrator", command: summarizeCommandShell(reviewCommand) });
  const run = await runProcess(reviewCommand, args.options, args.execute, args.emit, "orchestrator");
  const reviewUsage = parseUsageFromOutput(run.stdout);
  usage.orchestrator.tokens_in += reviewUsage.tokens_in;
  usage.orchestrator.tokens_out += reviewUsage.tokens_out;
  usage.orchestrator.calls += 1;
  if (!run.ok || run.timedOut) {
    const exitNote =
      run.exitCode !== null && run.exitCode !== 0 ? ` (exit ${run.exitCode})` : run.timedOut ? " (timeout)" : "";
    args.emit({
      type: "error",
      error: `Orchestrator review CLI failed${exitNote}.`,
    });
    return {
      review: {
        schema_version: config.architect.review_schema_version,
        iteration: i,
        verdict: "fail",
        summary: `Orchestrator review CLI failed${exitNote}.`,
        findings: [{ severity: "error", message: "Review process did not complete successfully." }],
        next_actions: ["Re-run after checking orchestrator availability and logs."],
        token_budget_used: reviewUsage.tokens_out,
      },
      tokensIn: reviewUsage.tokens_in,
      tokensOut: reviewUsage.tokens_out,
    };
  }
  const { review, fromOrchestrator } = extractReview(run.stdout, {
    iteration: i,
    totalIterations: maxIterations,
    config,
    workerOk: args.workerOk,
    changed: args.diff.changed,
    changeSummary: formatDiffSummary(args.diff),
  });
  if (!fromOrchestrator) {
    args.emit({
      type: "error",
      error: "Orchestrator did not return a schema-valid review JSON.",
    });
    return {
      review: {
        schema_version: config.architect.review_schema_version,
        iteration: i,
        verdict: "fail",
        summary: "Orchestrator did not return a schema-valid review.",
        findings: [
          { severity: "error", message: "Missing or invalid review JSON from orchestrator CLI." },
        ],
        next_actions: ["Ensure the orchestrator CLI prints schema-compliant review JSON."],
        token_budget_used: reviewUsage.tokens_out,
      },
      tokensIn: reviewUsage.tokens_in,
      tokensOut: reviewUsage.tokens_out,
    };
  }
  return {
    review,
    tokensIn: reviewUsage.tokens_in,
    tokensOut: reviewUsage.tokens_out,
  };
}

interface CapturedProcess {
  stdout: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
}

/** Run a non-worker (orchestrator) process, capturing stdout. */
async function runProcess(
  command: AdapterCommand,
  options: RunLoopOptions,
  execute: typeof executeCommand,
  emit: (update: LoopUpdate) => void,
  role: RoleId,
): Promise<CapturedProcess> {
  const stream = createAgentStream({
    onChunk: (chunk) => {
      if (chunk.kind === "text" || chunk.kind === "thought" || chunk.kind === "tool" || chunk.kind === "error") {
        emit({ type: "agent", agentKind: chunk.kind, content: `${role === "orchestrator" ? "◆ " : ""}${chunk.content}` });
      }
    },
  });
  const result = await execute(command, {
    cwd: options.cwd,
    timeoutMs: options.config.architect.iteration_timeout_ms,
    signal: options.signal,
    onLine: (s, line) => {
      if (s === "stdout") stream.push(line);
      else if (line.trim()) emit({ type: "output", stream: "stderr", line });
    },
  });
  stream.flush();
  return {
    stdout: result.stdout,
    ok: result.ok,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  };
}

/** Run the worker process, streaming parsed agent output and tracking activity. */
async function runWorkerProcess(
  command: AdapterCommand,
  options: RunLoopOptions,
  execute: typeof executeCommand,
  emit: (update: LoopUpdate) => void,
): Promise<WorkerRunResult> {
  let stopReason: string | undefined;
  const stream = createAgentStream({
    onChunk: (chunk) => emit({ type: "agent", agentKind: chunk.kind, content: chunk.content }),
    onActivity: (activity) => {
      if (activity.stopReason) {
        const incoming = activity.stopReason;
        if (!stopReason) {
          stopReason = incoming;
        } else if (isAbortedStopReason(incoming)) {
          stopReason = incoming;
        } else if (!isAbortedStopReason(stopReason)) {
          stopReason = incoming;
        }
      }
      if (activity.tool || activity.file) {
        emit({ type: "activity", activity: { tool: activity.tool, file: activity.file } });
      }
    },
  });

  const result = await execute(command, {
    cwd: options.cwd,
    timeoutMs: options.config.worker.iteration_timeout_ms,
    signal: options.signal,
    onLine: (s, line) => {
      if (s === "stdout") {
        stream.push(line);
      } else if (line.trim()) {
        emit({ type: "output", stream: "stderr", line });
      }
    },
  });
  stream.flush();
  return { result, stopReason };
}

function buildReport(input: {
  task: string;
  config: OlapConfig;
  roles: Record<RoleId, ResolvedRole>;
  reviews: ArchitectReview[];
  commands: AdapterCommand[];
  usage: UsageSnapshot;
  summary: RunSummary;
  executed: boolean;
  status: "completed" | "failed";
  diff: DiffSummary;
  validators: ValidatorResult[];
  cost: CostSnapshot;
}): string {
  const { usage, roles, diff, cost } = input;
  const changeLines =
    diff.files.length === 0
      ? ["- No working-tree changes detected."]
      : [
          `- ${formatDiffSummary(diff)}`,
          ...diff.files.map((f) => `  - ${f.path} (+${f.insertions} -${f.deletions}${f.binary ? " binary" : ""})`),
        ];
  return [
    "# OLAP Run Report",
    "",
    `Task: ${input.task.trim()}`,
    `- Strategy: ${input.config.worker.loop_policy}`,
    `- Workspace: ${input.summary.cwd ?? "(unknown)"}`,
    "",
    "## Roles",
    "",
    `- Orchestrator: ${roles.orchestrator.adapter} / ${roles.orchestrator.model}`,
    `- Worker: ${roles.worker.adapter} / ${roles.worker.model}`,
    `- Mode: ${input.config.ui.mode}`,
    `- Executed: ${input.executed ? "yes" : "no"}`,
    "",
    "## Run Summary",
    "",
    `- Run ID: ${input.summary.run_id}`,
    `- Iterations: ${input.summary.iterations}`,
    `- Reviews valid: ${input.summary.reviews_valid}/${input.reviews.length}`,
    `- Context pack tokens: ${input.summary.context_pack_tokens}`,
    `- Files changed: ${input.summary.files_changed ?? 0}`,
    `- Worker cancelled: ${input.summary.worker_cancelled ? "yes" : "no"}`,
    `- Status: ${input.status}`,
    "",
    "## Usage",
    "",
    `- Orchestrator: ${usage.orchestrator.calls} calls, in ${usage.orchestrator.tokens_in}, out ${usage.orchestrator.tokens_out}`,
    `- Worker: ${usage.worker.calls} calls, in ${usage.worker.tokens_in}, out ${usage.worker.tokens_out}`,
    `- Estimated cost: ${formatCostSummary(cost)}`,
    "",
    "## Changes",
    "",
    ...changeLines,
    "",
    "## Validators",
    "",
    ...(input.validators.length === 0
      ? ["- Not run."]
      : input.validators.map((v) => `- ${v.name}: ${v.ok ? "pass" : `fail (exit ${v.exitCode})`}`)),
    "",
    "## Adapter Commands (as executed)",
    "",
    ...(input.commands.length === 0
      ? ["- No adapter commands."]
      : input.commands.map(
          (command) =>
            `- [${command.phase}${command.step ? `/${command.step}` : ""}] ${command.executed ? "ran" : "planned"}: ${summarizeCommandShell(command)}`,
        )),
    "",
    "## Architect Reviews",
    "",
    ...(input.reviews.length === 0
      ? ["- No reviews (direct/single-pass run)."]
      : input.reviews.map(
          (review) =>
            `- Iteration ${review.iteration}: ${review.verdict} - ${review.summary} (${review.token_budget_used} tokens)`,
        )),
    "",
    "## Status",
    "",
    input.executed
      ? input.status === "completed"
        ? "Run completed: orchestrator and/or worker CLI processes finished successfully."
        : "Run failed after spawning orchestrator and/or worker CLI processes."
      : input.status === "completed"
        ? "Run completed without spawning CLI processes (plan-only mode)."
        : "Run failed before or without spawning CLI processes.",
  ].join("\n");
}
