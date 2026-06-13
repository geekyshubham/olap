import { readConfig } from "../config/read.js";
import { detectAdapters } from "../adapters/detect.js";
import { defaultModelFor } from "../adapters/models.js";
import { generateContextPack } from "../context/pack.js";
import { createRunId, writeRunArtifacts } from "../run/artifacts.js";
import { runOrchestratedLoop, type LoopUpdate } from "../run/loop.js";
import { completeSession, createSessionId, registerSession } from "../sessions/registry.js";
import type {
  AdapterId,
  ExecutionMode,
  OlapConfig,
  ResolvedRole,
  RoleId,
  UsageSnapshot,
  WorkMode,
} from "../types.js";

const ADAPTERS: AdapterId[] = ["grok", "claude", "gemini", "codex", "kiro"];
const MODES: WorkMode[] = ["plan", "build", "workflow"];

export interface RunOptions {
  cwd?: string;
  sessionId?: string;
  mode?: string;
  orchestrator?: string;
  worker?: string;
  execution?: ExecutionMode;
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
  iterations: number;
}

/** Parse "adapter:model" or "adapter" into a role override. */
export function parseRoleSpec(
  spec: string,
  role: RoleId,
): { adapter: AdapterId; model: string } | undefined {
  const [adapterRaw, ...modelParts] = spec.split(":");
  const adapter = adapterRaw.trim() as AdapterId;
  if (!ADAPTERS.includes(adapter)) return undefined;
  const model = modelParts.join(":").trim() || defaultModelFor(adapter, role);
  return { adapter, model };
}

export function applyRunOverrides(config: OlapConfig, options: RunOptions): OlapConfig {
  if (options.mode && MODES.includes(options.mode as WorkMode)) {
    config.ui.mode = options.mode as WorkMode;
  }
  if (options.theme) config.ui.theme = options.theme;
  if (options.execution) config.access.execution = options.execution;
  if (options.orchestrator) {
    const parsed = parseRoleSpec(options.orchestrator, "orchestrator");
    if (parsed) config.roles.orchestrator = parsed;
  }
  if (options.worker) {
    const parsed = parseRoleSpec(options.worker, "worker");
    if (parsed) config.roles.worker = parsed;
  }
  return config;
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
      case "error":
        if (update.error) console.error(`  ! ${update.error}`);
        break;
    }
  };
}

export async function runCommand(task: string, options: RunOptions = {}): Promise<RunResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = applyRunOverrides(await readConfig(cwd), options);
  const detections = await detectAdapters();

  const runId = createRunId();
  const sessionId = options.sessionId ?? createSessionId();
  const contextPack = await generateContextPack(cwd, config);

  if (!options.quiet) {
    console.log(
      `OLAP run ${runId} — orchestrator ${config.roles.orchestrator.adapter}:${config.roles.orchestrator.model}, ` +
        `worker ${config.roles.worker.adapter}:${config.roles.worker.model}, mode ${config.ui.mode}, ${config.access.execution}`,
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

  const session = await registerSession({
    cwd,
    task,
    adapter: result.roles.worker.adapter,
    runId,
    sessionId,
  });
  if (result.reviews.at(-1)?.verdict === "pass") {
    await completeSession(cwd, sessionId, "completed");
  }

  const dir = await writeRunArtifacts({
    cwd,
    runId,
    task,
    config,
    events: result.events,
    report: result.report,
    contextPack,
    reviews: result.reviews,
    adapterCommands: result.adapterCommands,
    summary: result.summary,
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
    iterations: result.summary.iterations,
  };
}

export function printRunResult(result: RunResult): void {
  console.log("");
  console.log(`Run ${result.runId} ${result.status}${result.executed ? " (live)" : " (dry-run)"}`);
  console.log(`Session: ${result.sessionId}`);
  console.log(`Artifacts: ${result.dir}`);
  console.log(
    `Usage: orchestrator ${result.usage.orchestrator.calls} calls ↑${result.usage.orchestrator.tokens_in} ↓${result.usage.orchestrator.tokens_out} · ` +
      `worker ${result.usage.worker.calls} calls ↑${result.usage.worker.tokens_in} ↓${result.usage.worker.tokens_out} · ` +
      `sub-agents ${result.usage.subagents_spawned}`,
  );
}
