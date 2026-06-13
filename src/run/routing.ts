import type { LoopPolicy } from "../types.js";

export type RunStrategy = "direct" | "loop";

export interface RouteDecision {
  strategy: RunStrategy;
  reason: string;
}

const DIRECT_HINTS = [
  /\b(publish|push|deploy|release|ship|tag)\b/i,
  /\bgit\s+(push|commit|tag|pull)\b/i,
  /\bnpm\s+publish\b/i,
  /\bbrew\s+(install|publish|tap)\b/i,
  /\bwhat did you do\b/i,
  /\bshow (me )?(status|changes|diff)\b/i,
];

const LOOP_HINTS = [
  /\b(implement|refactor|add|fix|write|create|design|build|migrate)\b/i,
  /\b(loop|iterate|review)\b/i,
  /\barchitect\b/i,
];

/** User overrides via slash prefix or explicit flags in the task text. */
export function parseTaskOverride(task: string): { task: string; force?: RunStrategy } {
  const trimmed = task.trim();
  const direct = trimmed.match(/^\/direct\s+(.+)$/is);
  if (direct) return { task: direct[1].trim(), force: "direct" };
  const loop = trimmed.match(/^\/loop\s+(.+)$/is);
  if (loop) return { task: loop[1].trim(), force: "loop" };
  return { task: trimmed };
}

/** Decide whether a task needs the full orchestrator/worker review loop. */
export function routeTask(task: string, policy: LoopPolicy): RouteDecision {
  const { task: cleaned, force } = parseTaskOverride(task);
  if (force) {
    return {
      strategy: force,
      reason: force === "direct" ? "forced direct (/direct)" : "forced loop (/loop)",
    };
  }

  if (policy === "always") {
    return { strategy: "loop", reason: "loop policy: always" };
  }
  if (policy === "never") {
    return { strategy: "direct", reason: "loop policy: never" };
  }

  const text = cleaned.toLowerCase();
  const directScore = DIRECT_HINTS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  const loopScore = LOOP_HINTS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);

  if (directScore > 0 && loopScore === 0) {
    return {
      strategy: "direct",
      reason: "operational task — single worker pass (use /loop to force review loop)",
    };
  }
  if (loopScore > directScore) {
    return { strategy: "loop", reason: "implementation task — full orchestrator/worker loop" };
  }
  if (directScore > 0) {
    return {
      strategy: "direct",
      reason: "looks operational — defaulting to direct (use /loop to force review loop)",
    };
  }

  // Short prompts without implementation verbs are usually operational questions.
  if (cleaned.split(/\s+/).length <= 6) {
    return {
      strategy: "direct",
      reason: "short task — direct worker (use /loop for architect/worker loop)",
    };
  }

  return { strategy: "loop", reason: "default — full orchestrator/worker loop" };
}