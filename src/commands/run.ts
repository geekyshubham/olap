import { cloneConfig, readConfig } from "../config/read.js";
import { detectAdapters } from "../adapters/detect.js";
import { resolveConfigModels } from "../adapters/discover.js";
import { defaultModelFor } from "../adapters/models.js";
import { generateContextPack } from "../context/pack.js";
import { formatDiffSummary, type DiffSummary } from "../git/status.js";
import { createRunId, writeRunArtifacts } from "../run/artifacts.js";
import {
  runOrchestratedLoop,
  terminalSessionStatus,
  type LoopUpdate,
} from "../run/loop.js";
import { formatCostSummary } from "../run/cost.js";
import {
  completeSession,
  createSessionId,
  formatSessionResumeMessage,
  registerSession,
} from "../sessions/registry.js";
import type {
  AdapterId,
  OlapConfig,
  ResolvedRole,
  RoleId,
  CostSnapshot,
  UsageSnapshot,
  WorkMode,
} from "../types.js";

const ADAPTERS: AdapterId[] = ["grok", "claude", "gemini", "codex", "kiro", "ollama"];
const MODES: WorkMode[] = ["plan", "build", "workflow"];

export interface RunOptions {
  cwd?: string;
  sessionId?: string;
  mode?: string;
  orchestrator?: string;
  worker?: string;
  theme?: string;
  quiet?: boolean;
}

export interface RunResult {
  runId: string;
  sessionId: string;
  dir: string;
  status: "completed" | "failed";
  executed: boolean;
  roles: Record<RoleId, ResolvedRole>;
  usage: UsageSnapshot;
  cost: CostSnapshot;
  iterations: number;
  diff: DiffSummary;
}

/** Parse "adapter:model" or "adapter" into a role override. */
export function parseRoleSpec(
  spec: string,
  role: RoleId,
): { adapter: AdapterId; model: string } | undefined {
  const trimmed = spec.trim();
  if (!trimmed) return undefined;
  const [adapterRaw, ...modelParts] = trimmed.split(":");
  const adapter = adapterRaw.trim().toLowerCase() as AdapterId;
  if (!adapter || !ADAPTERS.includes(adapter)) return undefined;
  const model = modelParts.join(":").trim() || defaultModelFor(adapter, role);
  return { adapter, model };
}

export interface RunOverrideResult {
  config: OlapConfig;
  errors: string[];
}

export function applyRunOverrides(config: OlapConfig, options: RunOptions): RunOverrideResult {
  const errors: string[] = [];
  const out = cloneConfig(config);

  if (options.mode !== undefined) {
    const mode = options.mode.trim().toLowerCase();
    if (!mode) {
      errors.push(`Invalid --mode "${options.mode}" (expected plan, build, or workflow).`);
    } else if (MODES.includes(mode as WorkMode)) {
      out.ui.mode = mode as WorkMode;
    } else {
      errors.push(`Invalid --mode "${options.mode}" (expected plan, build, or workflow).`);
    }
  }
  if (options.theme !== undefined) {
    const theme = options.theme.trim();
    if (!theme) {
      errors.push(`Invalid --theme "${options.theme}" (expected a non-empty theme name).`);
    } else {
      out.ui.theme = theme;
    }
  }
  if (options.cwd !== undefined) {
    const cwd = options.cwd.trim();
    if (!cwd) {
      errors.push(`Invalid --cwd "${options.cwd}" (expected a non-empty directory).`);
    }
  }
  if (options.sessionId !== undefined) {
    const sessionId = options.sessionId.trim();
    if (!sessionId) {
      errors.push(`Invalid --session-id "${options.sessionId}" (expected a non-empty session id).`);
    }
  }
  if (options.orchestrator !== undefined) {
    const parsed = parseRoleSpec(options.orchestrator, "orchestrator");
    if (parsed) out.roles.orchestrator = { ...out.roles.orchestrator, ...parsed };
    else errors.push(`Invalid --orchestrator "${options.orchestrator}" (expected adapter[:model]).`);
  }
  if (options.worker !== undefined) {
    const parsed = parseRoleSpec(options.worker, "worker");
    if (parsed) out.roles.worker = { ...out.roles.worker, ...parsed };
    else errors.push(`Invalid --worker "${options.worker}" (expected adapter[:model]).`);
  }
  return { config: out, errors };
}

function makePrinter(quiet: boolean): (update: LoopUpdate) => void {
  if (quiet) return () => undefined;
  return (update) => {
    switch (update.type) {
      case "phase":
        if (update.label) console.log(`· ${update.label}`);
        break;
      case "event":
        if (update.event) {
          const tag = update.event.phase === "architect" ? "orch" : "wrk";
          console.log(`  [${tag}] ${update.event.type}: ${update.event.message}`);
        }
        break;
      case "review":
        if (update.review) {
          console.log(`  [review] ${update.review.verdict.toUpperCase()} #${update.review.iteration}`);
        }
        break;
      case "output":
        if (update.line) console.log(`    | ${update.line}`);
        break;
      case "diff":
        if (update.diff) {
          console.log(`  changes: ${formatDiffSummary(update.diff)}`);
        }
        break;
      case "validator":
        if (update.validators) {
          for (const v of update.validators) {
            console.log(`  [validator] ${v.name}: ${v.ok ? "pass" : `fail (exit ${v.exitCode})`}`);
          }
        }
        break;
      case "error":
        if (update.error) console.error(`  ! ${update.error}`);
        break;
    }
  };
}

export async function runCommand(task: string, options: RunOptions = {}): Promise<RunResult> {
  const cwd = options.cwd?.trim() || process.cwd();
  const detections = await detectAdapters();
  const { config: overridden, errors: overrideErrors } = applyRunOverrides(await readConfig(cwd), options);
  if (overrideErrors.length > 0) {
    for (const error of overrideErrors) console.error(`olap run: ${error}`);
    throw new Error(overrideErrors.join(" "));
  }
  let config = overridden;
  const resolved = await resolveConfigModels(config, detections);
  config = resolved.config;
  if (!options.quiet) {
    for (const warning of resolved.warnings) {
      console.warn(`olap run: ${warning}`);
    }
  }

  const runId = createRunId();
  const sessionId = options.sessionId?.trim() || createSessionId();
  const contextPack = await generateContextPack(cwd, config);

  if (!options.quiet) {
    console.log(
      `OLAP run ${runId} — orchestrator ${config.roles.orchestrator.adapter}:${config.roles.orchestrator.model}, ` +
        `worker ${config.roles.worker.adapter}:${config.roles.worker.model}, mode ${config.ui.mode}`,
    );
  }

  const result = await runOrchestratedLoop({
    task,
    config,
    cwd,
    detections,
    contextPack,
    runId,
    sessionId,
    delay: () => Promise.resolve(),
    onUpdate: makePrinter(options.quiet ?? false),
  });

  let session = await registerSession({
    cwd,
    task,
    adapter: result.roles.worker.adapter,
    runId,
    sessionId,
  });
  session = (await completeSession(cwd, sessionId, terminalSessionStatus(result))) ?? session;

  const dir = await writeRunArtifacts({
    cwd,
    runId,
    task,
    config,
    events: result.events,
    report: result.report,
    brief: result.brief,
    contextPack,
    reviews: result.reviews,
    adapterCommands: result.adapterCommands,
    summary: result.summary,
    diff: result.diff,
    session,
  });

  return {
    runId,
    sessionId,
    dir,
    status: result.status,
    executed: result.executed,
    roles: result.roles,
    usage: result.usage,
    cost: result.cost,
    iterations: result.summary.iterations,
    diff: result.diff,
  };
}

export function printRunResult(result: RunResult): void {
  console.log("");
  console.log(`Run ${result.runId} ${result.status}`);
  for (const line of formatSessionResumeMessage(result.sessionId)) {
    console.log(line);
  }
  console.log(`Artifacts: ${result.dir}`);
  if (result.executed && result.iterations > 0) {
    console.log(`Changes: ${formatDiffSummary(result.diff)}`);
  }
  console.log(
    `Usage: orchestrator ${result.usage.orchestrator.calls} calls ↑${result.usage.orchestrator.tokens_in} ↓${result.usage.orchestrator.tokens_out} · ` +
      `worker ${result.usage.worker.calls} calls ↑${result.usage.worker.tokens_in} ↓${result.usage.worker.tokens_out}`,
  );
  console.log(`Cost: ${formatCostSummary(result.cost)}`);
}
