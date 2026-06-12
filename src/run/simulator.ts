import { buildAdapterCommands } from "../adapters/build.js";
import { estimateTokens } from "../context/pack.js";
import type {
  AdapterCommand,
  AdapterDetection,
  AdapterId,
  ArchitectReview,
  ContextPack,
  OlapConfig,
  RunEvent,
  RunSummary,
  TokenSummary,
} from "../types.js";
import {
  allReviewsValid,
  createSimulatedReview,
  validateArchitectReview,
} from "../validators/review-schema.js";

export { estimateTokens };

export function summarizeTokens(events: RunEvent[]): TokenSummary {
  const tokens_in = events.reduce((sum, e) => sum + e.tokens_in, 0);
  const tokens_out = events.reduce((sum, e) => sum + e.tokens_out, 0);
  const efficiency = tokens_in === 0 ? 0 : tokens_out / tokens_in;
  return { tokens_in, tokens_out, efficiency };
}

export interface SimulationResult {
  events: RunEvent[];
  report: string;
  reviews: ArchitectReview[];
  adapterCommands: AdapterCommand[];
  summary: RunSummary;
}

export function simulateArchitectWorkerLoop(
  task: string,
  config: OlapConfig,
  options: {
    now?: Date;
    runId?: string;
    sessionId?: string;
    adapterId?: AdapterId | "none";
    contextPack?: ContextPack;
    detection?: AdapterDetection;
  } = {},
): SimulationResult {
  const now = options.now ?? new Date();
  const runId = options.runId ?? "sim-run";
  const sessionId = options.sessionId ?? "sim-session";
  const adapterId = options.adapterId ?? config.adapters.preferred;
  const contextPack = options.contextPack;
  const events: RunEvent[] = [];
  const reviews: ArchitectReview[] = [];
  const ts = () => now.toISOString();

  const architectPlan = [
    "Decompose task into verifiable worker steps.",
    "Define acceptance checks and token budget per iteration.",
    "Select adapter routing without external model calls.",
  ];

  const planText = architectPlan.join(" ");
  const contextTokens = contextPack?.total_tokens ?? estimateTokens(task);

  events.push({
    ts: ts(),
    phase: "architect",
    type: "plan",
    tokens_in: contextTokens,
    tokens_out: estimateTokens(planText),
    message: `Architect plan: ${planText}`,
  });

  const adapterCommands =
    adapterId === "none"
      ? []
      : buildAdapterCommands({
          adapterId,
          task,
          architectPrompt: `${config.architect.system_prompt_hint}\n\nTask:\n${task.trim()}`,
          config,
          detection: options.detection,
        });

  let iterationsRun = 0;

  for (let i = 1; i <= config.worker.max_iterations; i++) {
    iterationsRun = i;
    const workerMessage = `Worker iteration ${i}/${config.worker.max_iterations}: simulated implementation pass.`;
    events.push({
      ts: ts(),
      phase: "worker",
      type: "implement",
      tokens_in: estimateTokens(planText),
      tokens_out: estimateTokens(workerMessage),
      message: workerMessage,
    });

    const review = createSimulatedReview(i, config, config.worker.max_iterations);
    const validation = validateArchitectReview(
      review,
      config.architect.review_schema_version,
    );
    if (!validation.valid && config.architect.require_valid_reviews) {
      throw new Error(`Invalid architect review: ${validation.errors.join("; ")}`);
    }
    reviews.push(review);

    events.push({
      ts: ts(),
      phase: "architect",
      type: "review",
      tokens_in: estimateTokens(workerMessage),
      tokens_out: review.token_budget_used,
      message: review.summary,
    });

    if (config.worker.stop_on_first_pass && review.verdict === "pass") {
      break;
    }
  }

  const summary = summarizeTokens(events);
  const reviewsValid = allReviewsValid(reviews, config) ? reviews.length : 0;
  const runSummary: RunSummary = {
    run_id: runId,
    session_id: sessionId,
    adapter: adapterId,
    iterations: iterationsRun,
    reviews_valid: reviewsValid,
    context_pack_tokens: contextTokens,
    dry_run: config.worker.dry_run,
  };

  const report = [
    "# OLAP Run Report",
    "",
    `Task: ${task.trim()}`,
    "",
    "## Run Summary",
    "",
    `- Run ID: ${runId}`,
    `- Session ID: ${sessionId}`,
    `- Adapter: ${adapterId}`,
    `- Iterations: ${iterationsRun}`,
    `- Reviews valid: ${reviewsValid}/${reviews.length}`,
    `- Context pack tokens: ${contextTokens}`,
    `- Dry run: ${config.worker.dry_run}`,
    "",
    "## Architect / Worker Summary",
    "",
    `- Tokens in: ${summary.tokens_in}`,
    `- Tokens out: ${summary.tokens_out}`,
    `- Token efficiency (out/in): ${summary.efficiency.toFixed(2)}`,
    `- Architect output budget: ${config.architect.output_budget_tokens}`,
    `- Context pack max: ${config.architect.context_pack_max_tokens}`,
    "",
    "## Adapter Commands (dry-run)",
    "",
    ...(adapterCommands.length === 0
      ? ["- No adapter commands (adapter none)."]
      : adapterCommands.map((command) => `- [${command.phase}] ${command.shell}`)),
    "",
    "## Architect Reviews",
    "",
    ...reviews.map(
      (review) =>
        `- Iteration ${review.iteration}: ${review.verdict} - ${review.summary} (${review.token_budget_used} tokens)`,
    ),
    "",
    "## Events",
    "",
    ...events.map((e) => `- [${e.phase}] ${e.type}: ${e.message}`),
    "",
    "## Status",
    "",
    "Simulated run completed successfully (no external model calls).",
  ].join("\n");

  return { events, report, reviews, adapterCommands, summary: runSummary };
}
