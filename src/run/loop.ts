import { buildRoleCommands } from "../adapters/build.js";
import { estimateTokens } from "../context/pack.js";
import {
  allReviewsValid,
  createSimulatedReview,
  validateArchitectReview,
} from "../validators/review-schema.js";
import { parseAgentOutputLine } from "./agent-output.js";
import { executeCommand, type ExecResult } from "./executor.js";
import { parseTaskOverride, routeTask } from "./routing.js";
import type {
  AdapterCommand,
  AdapterDetection,
  ArchitectReview,
  ContextPack,
  OlapConfig,
  ResolvedRole,
  RoleId,
  RunEvent,
  RunSummary,
  UsageSnapshot,
  WorkMode,
} from "../types.js";

export type LoopPhaseId = "context" | "plan" | "work" | "review" | "done";

export interface LoopUpdate {
  type:
    | "phase"
    | "event"
    | "review"
    | "usage"
    | "subagent"
    | "output"
    | "agent"
    | "brief"
    | "command"
    | "routing"
    | "final"
    | "error";
  phase?: LoopPhaseId;
  label?: string;
  event?: RunEvent;
  review?: ArchitectReview;
  usage?: UsageSnapshot;
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
  result?: OrchestratedResult;
  error?: string;
}

export interface OrchestratedResult {
  events: RunEvent[];
  reviews: ArchitectReview[];
  adapterCommands: AdapterCommand[];
  summary: RunSummary;
  report: string;
  usage: UsageSnapshot;
  roles: Record<RoleId, ResolvedRole>;
  status: "completed" | "failed";
  executed: boolean;
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

/** Whether the worker phase should actually spawn a process. */
export function shouldExecuteLive(
  config: OlapConfig,
  mode: WorkMode,
  workerAvailable: boolean,
): boolean {
  if (mode === "plan") return false;
  if (config.access.execution !== "live") return false;
  return workerAvailable;
}

/** Best-effort extraction of token usage from a worker CLI's JSON output. */
export function parseUsageFromOutput(stdout: string): { tokens_in: number; tokens_out: number } {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const usage = (parsed.usage ?? parsed) as Record<string, unknown>;
      const inTok =
        Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.tokens_in ?? 0) || 0;
      const outTok =
        Number(usage.output_tokens ?? usage.completion_tokens ?? usage.tokens_out ?? 0) || 0;
      if (inTok > 0 || outTok > 0) {
        return { tokens_in: inTok, tokens_out: outTok };
      }
    } catch {
      // not JSON; keep scanning
    }
  }
  return { tokens_in: estimateTokens(stdout), tokens_out: estimateTokens(stdout) };
}

/**
 * Run the orchestrated architect/worker loop, emitting live updates so the TUI
 * can show real progress. In dry-run it simulates each phase with small delays;
 * in live mode it spawns the worker adapter and streams its output.
 */
function buildWorkerBrief(options: {
  task: string;
  iteration: number;
  totalIterations: number;
  planText: string;
  contextSummary?: string;
  direct?: boolean;
}): string {
  const lines = [
    `Task: ${options.task.trim()}`,
    "",
    options.direct
      ? "Execute this operational task directly in the repository."
      : `Worker iteration ${options.iteration}/${options.totalIterations}.`,
    options.direct
      ? "- Inspect git status, run the required shell commands, and report each step."
      : "- Implement the task; run tests/validators when appropriate.",
    "- State what you changed and the outcome of each command.",
    "",
    `Orchestrator plan: ${options.planText}`,
  ];
  if (options.contextSummary) {
    lines.push("", "Repository context:", options.contextSummary);
  }
  return lines.join("\n");
}

function contextSummary(pack?: ContextPack): string | undefined {
  if (!pack || pack.files.length === 0) return undefined;
  const names = pack.files.slice(0, 8).map((f) => f.path);
  const more = pack.files.length > names.length ? ` (+${pack.files.length - names.length} more)` : "";
  return `${names.join(", ")}${more}`;
}

export async function runOrchestratedLoop(
  options: RunLoopOptions,
): Promise<OrchestratedResult> {
  const config = options.config;
  const clock = options.now ?? (() => new Date());
  const delay = options.delay ?? realDelay;
  const stepDelay = options.stepDelayMs ?? 220;
  const execute = options.execute ?? executeCommand;
  const emit = options.onUpdate ?? (() => undefined);
  const mode = config.ui.mode;

  const events: RunEvent[] = [];
  const reviews: ArchitectReview[] = [];
  const usage = emptyUsage();

  const ts = () => clock().toISOString();
  const pushEvent = (event: RunEvent) => {
    events.push(event);
    emit({ type: "event", event });
  };
  const pushUsage = () => emit({ type: "usage", usage: structuredClone(usage) });

  const { task: cleanedTask } = parseTaskOverride(options.task);
  const route = routeTask(options.task, config.worker.loop_policy);
  emit({ type: "routing", strategy: route.strategy, reason: route.reason });

  const { commands, roles } = buildRoleCommands({
    config,
    detections: options.detections,
    task: cleanedTask,
    architectPrompt: `${config.architect.system_prompt_hint}\n\nTask:\n${cleanedTask}`,
  });
  const architectCommand = commands.find((c) => c.phase === "architect");
  const workerCommand = commands.find((c) => c.phase === "worker");
  const live = shouldExecuteLive(config, mode, roles.worker.available && !!workerCommand);

  if (architectCommand) {
    emit({
      type: "brief",
      role: "orchestrator",
      text: cleanedTask,
    });
    emit({ type: "command", role: "orchestrator", command: architectCommand.shell });
  }

  // Phase: context
  emit({ type: "phase", phase: "context", label: "Packing repository context" });
  const contextTokens = options.contextPack?.total_tokens ?? estimateTokens(options.task);
  await delay(stepDelay);

  // Phase: plan (orchestrator)
  emit({ type: "phase", phase: "plan", label: `Orchestrator planning (${roles.orchestrator.model})` });
  const planText = [
    "Decompose task into verifiable worker steps.",
    "Define acceptance checks and a token budget per iteration.",
    "Route work to the configured worker without wasted spend.",
  ].join(" ");
  const planOut = estimateTokens(planText);
  usage.orchestrator.tokens_in += contextTokens;
  usage.orchestrator.tokens_out += planOut;
  usage.orchestrator.calls += 1;
  pushEvent({
    ts: ts(),
    phase: "architect",
    type: "plan",
    tokens_in: contextTokens,
    tokens_out: planOut,
    message: `Architect plan: ${planText}`,
  });
  pushUsage();
  await delay(stepDelay);

  let iterationsRun = 0;
  let status: "completed" | "failed" = "completed";
  let lastWorkerOk = true;
  const workerWarnings: string[] = [];
  const direct = route.strategy === "direct";
  const maxIterations = direct ? 1 : config.worker.max_iterations;
  const packSummary = contextSummary(options.contextPack);

  if (mode === "plan") {
    emit({ type: "phase", phase: "done", label: "Plan-only mode: workers not run" });
  } else {
    for (let i = 1; i <= maxIterations; i++) {
      if (options.signal?.aborted) {
        status = "failed";
        break;
      }
      iterationsRun = i;

      // Phase: work (worker / sub-agent)
      const workerBrief = buildWorkerBrief({
        task: cleanedTask,
        iteration: i,
        totalIterations: maxIterations,
        planText,
        contextSummary: packSummary,
        direct,
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
      emit({ type: "brief", role: "worker", text: workerBrief });
      if (workerCommand) {
        emit({ type: "command", role: "worker", command: workerCommand.shell });
      }

      if (config.subagents.enabled) {
        usage.subagents_spawned += 1;
        usage.subagents_active = Math.min(config.subagents.max_parallel, usage.subagents_active + 1);
        emit({ type: "subagent", usage: structuredClone(usage), iteration: i });
      }

      let workerMessage: string;
      let workerIn: number;
      let workerOut: number;

      if (live && workerCommand) {
        const liveCommand = {
          ...workerCommand,
          argv: [...workerCommand.argv.slice(0, -1), workerBrief],
        };
        const result = await runWorkerProcess(liveCommand, options, execute, emit);
        const parsed = parseUsageFromOutput(result.stdout);
        workerIn = parsed.tokens_in;
        workerOut = parsed.tokens_out;
        lastWorkerOk = result.ok;
        workerMessage = result.ok
          ? direct
            ? `Worker: completed (exit ${result.exitCode})`
            : `Worker iteration ${i}: completed (exit ${result.exitCode})`
          : direct
            ? `Worker: failed (${result.timedOut ? "timeout" : `exit ${result.exitCode}`})`
            : `Worker iteration ${i}: failed (${result.timedOut ? "timeout" : `exit ${result.exitCode}`})`;
        if (!result.ok) {
          workerWarnings.push(workerMessage);
        }
      } else {
        workerMessage = `Worker iteration ${i}/${config.worker.max_iterations}: simulated implementation pass.`;
        workerIn = estimateTokens(planText);
        workerOut = estimateTokens(workerMessage);
        await delay(stepDelay);
      }

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
      if (config.subagents.enabled) {
        usage.subagents_active = Math.max(0, usage.subagents_active - 1);
      }
      pushUsage();

      if (direct) {
        status = lastWorkerOk ? "completed" : "failed";
        break;
      }

      // Phase: review (orchestrator)
      emit({ type: "phase", phase: "review", label: `Orchestrator reviewing iteration ${i}` });
      const review = createSimulatedReview(i, config, maxIterations);
      const validation = validateArchitectReview(review, config.architect.review_schema_version);
      if (!validation.valid && config.architect.require_valid_reviews) {
        status = "failed";
        emit({ type: "error", error: `Invalid architect review: ${validation.errors.join("; ")}` });
        break;
      }
      reviews.push(review);
      usage.orchestrator.tokens_in += estimateTokens(workerMessage);
      usage.orchestrator.tokens_out += review.token_budget_used;
      usage.orchestrator.calls += 1;
      emit({ type: "review", review });
      pushEvent({
        ts: ts(),
        phase: "architect",
        type: "review",
        tokens_in: estimateTokens(workerMessage),
        tokens_out: review.token_budget_used,
        message: review.summary,
      });
      pushUsage();
      await delay(stepDelay);

      if (config.worker.stop_on_first_pass && review.verdict === "pass") break;
    }

    if (!direct) {
      const finalReview = reviews.at(-1);
      status = lastWorkerOk && finalReview?.verdict === "pass" ? "completed" : "failed";
    }
    if (workerWarnings.length > 0 && status === "completed") {
      emit({
        type: "error",
        error: `Completed with warnings: ${workerWarnings.join("; ")}`,
      });
    }
  }

  const runId = options.runId ?? "loop-run";
  const sessionId = options.sessionId ?? "loop-session";
  const reviewsValid = allReviewsValid(reviews, config) ? reviews.length : 0;
  const summary: RunSummary = {
    run_id: runId,
    session_id: sessionId,
    adapter: roles.worker.adapter,
    iterations: iterationsRun,
    reviews_valid: reviewsValid,
    context_pack_tokens: contextTokens,
    dry_run: !live,
  };

  const report = buildReport({
    task: options.task,
    config,
    roles,
    events,
    reviews,
    commands,
    usage,
    summary,
    live,
    status,
  });

  const result: OrchestratedResult = {
    events,
    reviews,
    adapterCommands: commands,
    summary,
    report,
    usage,
    roles,
    status,
    executed: live,
  };

  emit({ type: "phase", phase: "done", label: status === "completed" ? "Run complete" : "Run failed" });
  emit({ type: "final", result, usage: structuredClone(usage) });
  return result;
}

async function runWorkerProcess(
  command: AdapterCommand,
  options: RunLoopOptions,
  execute: typeof executeCommand,
  emit: (update: LoopUpdate) => void,
): Promise<ExecResult> {
  return execute(command, {
    cwd: options.cwd,
    timeoutMs: options.config.worker.iteration_timeout_ms,
    signal: options.signal,
    onLine: (stream, line) => {
      const chunks = parseAgentOutputLine(line);
      if (chunks.length > 0) {
        for (const chunk of chunks) {
          emit({ type: "agent", agentKind: chunk.kind, content: chunk.content });
        }
        return;
      }
      if (line.trim()) emit({ type: "output", stream, line });
    },
  });
}

function buildReport(input: {
  task: string;
  config: OlapConfig;
  roles: Record<RoleId, ResolvedRole>;
  events: RunEvent[];
  reviews: ArchitectReview[];
  commands: AdapterCommand[];
  usage: UsageSnapshot;
  summary: RunSummary;
  live: boolean;
  status: "completed" | "failed";
}): string {
  const { usage, roles } = input;
  return [
    "# OLAP Run Report",
    "",
    `Task: ${input.task.trim()}`,
    `- Strategy: ${input.config.worker.loop_policy}`,
    "",
    "## Roles",
    "",
    `- Orchestrator: ${roles.orchestrator.adapter} / ${roles.orchestrator.model}`,
    `- Worker: ${roles.worker.adapter} / ${roles.worker.model}`,
    `- Mode: ${input.config.ui.mode}`,
    `- Execution: ${input.live ? "live" : "dry-run"}`,
    "",
    "## Run Summary",
    "",
    `- Run ID: ${input.summary.run_id}`,
    `- Iterations: ${input.summary.iterations}`,
    `- Reviews valid: ${input.summary.reviews_valid}/${input.reviews.length}`,
    `- Context pack tokens: ${input.summary.context_pack_tokens}`,
    `- Status: ${input.status}`,
    "",
    "## Usage",
    "",
    `- Orchestrator: ${usage.orchestrator.calls} calls, in ${usage.orchestrator.tokens_in}, out ${usage.orchestrator.tokens_out}`,
    `- Worker: ${usage.worker.calls} calls, in ${usage.worker.tokens_in}, out ${usage.worker.tokens_out}`,
    `- Sub-agents spawned: ${usage.subagents_spawned}`,
    "",
    "## Adapter Commands",
    "",
    ...(input.commands.length === 0
      ? ["- No adapter commands."]
      : input.commands.map((command) => `- [${command.phase}] ${command.shell}`)),
    "",
    "## Architect Reviews",
    "",
    ...input.reviews.map(
      (review) =>
        `- Iteration ${review.iteration}: ${review.verdict} - ${review.summary} (${review.token_budget_used} tokens)`,
    ),
    "",
    "## Status",
    "",
    input.live
      ? "Live run executed the worker adapter process."
      : "Dry-run completed (no external model calls).",
  ].join("\n");
}
