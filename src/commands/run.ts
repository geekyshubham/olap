import { readConfig } from "../config/read.js";
import { detectAdapters, pickAdapter } from "../adapters/detect.js";
import { generateContextPack } from "../context/pack.js";
import { createRunId, writeRunArtifacts } from "../run/artifacts.js";
import { simulateArchitectWorkerLoop, summarizeTokens } from "../run/simulator.js";
import { completeSession, createSessionId, registerSession } from "../sessions/registry.js";

export interface RunResult {
  runId: string;
  sessionId: string;
  dir: string;
  adapter: string;
  summary: ReturnType<typeof summarizeTokens>;
}

export async function runCommand(
  task: string,
  cwd = process.cwd(),
  sessionId?: string,
): Promise<RunResult> {
  const config = await readConfig(cwd);
  const detections = await detectAdapters();
  const adapter = pickAdapter(
    detections,
    config.adapters.preferred,
    config.adapters.fallback,
  );
  const adapterId = adapter?.id ?? "none";

  const runId = createRunId();
  const resolvedSessionId = sessionId ?? createSessionId();
  const contextPack = await generateContextPack(cwd, config);
  const simulation = simulateArchitectWorkerLoop(task, config, {
    runId,
    sessionId: resolvedSessionId,
    adapterId,
    contextPack,
    detection: adapter,
  });

  const session = await registerSession({
    cwd,
    task,
    adapter: adapterId,
    runId,
    sessionId: resolvedSessionId,
  });

  const lastReview = simulation.reviews.at(-1);
  if (lastReview?.verdict === "pass") {
    await completeSession(cwd, resolvedSessionId, "completed");
  }

  const dir = await writeRunArtifacts({
    cwd,
    runId,
    task,
    config,
    events: simulation.events,
    report: simulation.report,
    contextPack,
    reviews: simulation.reviews,
    adapterCommands: simulation.adapterCommands,
    summary: simulation.summary,
    session,
  });

  return {
    runId,
    sessionId: resolvedSessionId,
    dir,
    adapter: adapterId,
    summary: summarizeTokens(simulation.events),
  };
}

export function printRunResult(result: RunResult): void {
  console.log(`Run ${result.runId} complete`);
  console.log(`Session: ${result.sessionId}`);
  console.log(`Artifacts: ${result.dir}`);
  console.log(`Adapter: ${result.adapter}`);
  console.log(
    `Tokens in/out: ${result.summary.tokens_in}/${result.summary.tokens_out} (efficiency ${result.summary.efficiency.toFixed(2)})`,
  );
}
