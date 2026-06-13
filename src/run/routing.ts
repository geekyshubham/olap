import type { LoopPolicy, OlapConfig, RoleConfig, WorkMode } from "../types.js";

export type RunStrategy = "direct" | "loop";

export interface RouteDecision {
  strategy: RunStrategy;
  reason: string;
}

/** A preview of how a submitted task will run, for the pre-run confirmation overlay. */
export interface RunPlan {
  /** Task text after stripping /direct or /loop prefixes. */
  task: string;
  strategy: RunStrategy;
  reason: string;
  mode: WorkMode;
  /** Effective iteration cap (1 for direct/single-pass). */
  maxIterations: number;
  stopOnFirstPass: boolean;
  /** `adapter:model` badge for the orchestrator role. */
  orchestrator: string;
  /** `adapter:model` badge for the worker role. */
  worker: string;
  /** Human-readable stop conditions, in order. */
  stopConditions: string[];
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

/**
 * Natural-language phrases where the user explicitly asks for a single pass / no
 * review loop. These win over keyword scoring (and the `auto` policy) because they
 * express intent for *this* task, e.g. "no need of loops just fix and verify it".
 */
const FORCE_DIRECT_HINTS = [
  /\bno\s+need\s+(of|for)\s+(a\s+)?loops?\b/i,
  /\bno\s+loops?\b/i,
  /\bwithout\s+(a\s+|any\s+)?loops?\b/i,
  /\bdo\s*n['’]?t\s+loop\b/i,
  /\bdo\s+not\s+loop\b/i,
  /\bsingle[-\s]?pass\b/i,
  /\bone[-\s]?pass\b/i,
  /\bone\s+shot\b/i,
  /\bjust\s+fix\s+(it|this|the)\b/i,
  /\bjust\s+fix\s+and\b/i,
  /\bjust\s+do\s+it\b/i,
  /\bno\s+(need\s+(of|for)\s+)?iterat(e|ing|ion|ions)\b/i,
  /\bdo\s*n['’]?t\s+iterate\b/i,
  /\bno\s+review\s+loop\b/i,
  /\bskip\s+(the\s+)?review\b/i,
];

/** Natural-language phrases where the user explicitly asks to keep iterating. */
const FORCE_LOOP_HINTS = [
  /\bloop\s+until\b/i,
  /\bkeep\s+iterating\b/i,
  /\biterate\s+until\b/i,
  /\brun\s+the\s+(review\s+)?loop\b/i,
  /\buse\s+the\s+(review\s+)?loop\b/i,
  /\bwith\s+(a\s+)?review\s+loop\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/** User overrides via slash prefix or explicit flags in the task text. */
export function parseTaskOverride(task: string): { task: string; force?: RunStrategy } {
  const trimmed = task.trim();
  const direct = trimmed.match(/^\/direct\s+(.+)$/is);
  if (direct) return { task: direct[1].trim(), force: "direct" };
  const loop = trimmed.match(/^\/loop\s+(.+)$/is);
  if (loop) return { task: loop[1].trim(), force: "loop" };
  return { task: trimmed };
}

/**
 * Decide whether a task needs the full orchestrator/worker review loop.
 *
 * Precedence (strongest first):
 *  1. Slash overrides (`/direct`, `/loop`).
 *  2. Configured loop policy (`always` / `never`).
 *  3. Natural-language intent for this task (auto policy only).
 *  4. Keyword scoring (operational vs implementation), then prompt length.
 */
export function routeTask(task: string, policy: LoopPolicy): RouteDecision {
  const { task: cleaned, force } = parseTaskOverride(task);
  if (force) {
    return {
      strategy: force,
      reason: force === "direct" ? "forced direct (/direct)" : "forced loop (/loop)",
    };
  }

  const text = cleaned.toLowerCase();

  // 2. Configured policy (explicit always/never wins over NL hints).
  if (policy === "always") {
    return { strategy: "loop", reason: "loop policy: always" };
  }
  if (policy === "never") {
    return { strategy: "direct", reason: "loop policy: never" };
  }

  // 3. Natural-language intent for this task (auto policy only).
  if (matchesAny(text, FORCE_DIRECT_HINTS)) {
    return { strategy: "direct", reason: "you asked for a single pass — no review loop" };
  }
  if (matchesAny(text, FORCE_LOOP_HINTS)) {
    return { strategy: "loop", reason: "you asked to keep iterating — review loop on" };
  }

  // 4. Keyword scoring.
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

function roleBadge(role: RoleConfig): string {
  return role.model ? `${role.adapter}:${role.model}` : role.adapter;
}

/**
 * Build a preview of how a submitted task will run, reusing the exact routing
 * logic so the confirmation overlay matches what the loop will actually do.
 */
export function buildRunPlan(task: string, config: OlapConfig): RunPlan {
  const { task: cleaned } = parseTaskOverride(task);
  const decision = routeTask(task, config.worker.loop_policy);
  const direct = decision.strategy === "direct";
  const maxIterations = direct ? 1 : Math.max(1, config.worker.max_iterations);

  const stopConditions: string[] = [];
  if (direct) {
    stopConditions.push("worker finishes a single pass (no review loop)");
  } else {
    if (config.worker.stop_on_first_pass) {
      stopConditions.push("orchestrator review passes");
    }
    stopConditions.push(`max ${maxIterations} iteration${maxIterations === 1 ? "" : "s"} reached`);
    stopConditions.push("a review returns a failing verdict");
  }
  stopConditions.push("you cancel (Esc / Ctrl+C)");

  return {
    task: cleaned,
    strategy: decision.strategy,
    reason: decision.reason,
    mode: config.ui.mode,
    maxIterations,
    stopOnFirstPass: config.worker.stop_on_first_pass,
    orchestrator: roleBadge(config.roles.orchestrator),
    worker: roleBadge(config.roles.worker),
    stopConditions,
  };
}
