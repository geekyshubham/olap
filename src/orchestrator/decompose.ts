import { findJsonObjects } from "../run/orchestrator.js";
import type { AgentJobType } from "../types.js";
import type { TaskComplexity } from "../types.js";

export interface DecomposedSubtask {
  title: string;
  description: string;
  job_type: AgentJobType;
  depends_on_titles: string[];
  scope?: string[];
  priority?: number;
}

export interface DecompositionPlan {
  strategy: "direct" | "loop" | "decompose";
  complexity: TaskComplexity;
  reason: string;
  subtasks: DecomposedSubtask[];
}

const DEFAULT_PLAN: DecompositionPlan = {
  strategy: "loop",
  complexity: "moderate",
  reason: "fallback — orchestrator returned no parseable plan",
  subtasks: [],
};

/** Parse orchestrator JSON output into a decomposition plan. */
export function parseDecompositionPlan(stdout: string): DecompositionPlan {
  const candidates: Record<string, unknown>[] = [];
  const trimmed = stdout.trim();
  if (!trimmed) return DEFAULT_PLAN;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    candidates.push(parsed);
  } catch {
    for (const obj of findJsonObjects(trimmed)) {
      try {
        candidates.push(JSON.parse(obj) as Record<string, unknown>);
      } catch {
        // ignore
      }
    }
  }

  for (const raw of [...candidates].reverse()) {
    const plan = coercePlan(raw);
    if (plan) return plan;
  }
  return DEFAULT_PLAN;
}

function coercePlan(raw: Record<string, unknown>): DecompositionPlan | null {
  const strategy = raw.strategy;
  if (strategy !== "direct" && strategy !== "loop" && strategy !== "decompose") return null;

  const complexity = raw.complexity;
  const validComplexity =
    complexity === "trivial" || complexity === "moderate" || complexity === "complex"
      ? complexity
      : "moderate";

  const reason = typeof raw.reason === "string" ? raw.reason : "orchestrator classification";

  const subtasksRaw = Array.isArray(raw.subtasks) ? raw.subtasks : [];
  const subtasks: DecomposedSubtask[] = [];
  for (const item of subtasksRaw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title) continue;
    const jobType = coerceJobType(rec.job_type);
    subtasks.push({
      title,
      description: typeof rec.description === "string" ? rec.description : "",
      job_type: jobType,
      depends_on_titles: Array.isArray(rec.depends_on_titles)
        ? rec.depends_on_titles.filter((t): t is string => typeof t === "string")
        : [],
      scope: Array.isArray(rec.scope)
        ? rec.scope.filter((s): s is string => typeof s === "string")
        : undefined,
      priority: typeof rec.priority === "number" ? rec.priority : undefined,
    });
  }

  return { strategy, complexity: validComplexity, reason, subtasks };
}

function coerceJobType(value: unknown): AgentJobType {
  if (value === "architect" || value === "qa" || value === "reviewer" || value === "orchestrator") {
    return value;
  }
  return "worker";
}

/** Build the orchestrator prompt for AI-based routing and optional decomposition. */
export function buildDecomposePrompt(task: string, decompose: boolean): string {
  const example = {
    strategy: "decompose",
    complexity: "complex",
    reason: "Multi-module auth feature needs parallel workers and QA gate",
    subtasks: [
      {
        title: "Implement OAuth callback handler",
        description: "Add callback route and token exchange",
        job_type: "worker",
        depends_on_titles: [],
        scope: ["src/auth/"],
        priority: 5,
      },
      {
        title: "Run QA on auth changes",
        description: "typecheck + test",
        job_type: "qa",
        depends_on_titles: ["Implement OAuth callback handler"],
        priority: 3,
      },
      {
        title: "Review auth implementation",
        description: "Diff-only review",
        job_type: "reviewer",
        depends_on_titles: ["Run QA on auth changes"],
        priority: 2,
      },
    ],
  };

  return [
    "DECOMPOSITION OUTPUT CONTRACT (mandatory — OLAP parses stdout mechanically):",
    "- Reply with EXACTLY one JSON object. No markdown, no code fences.",
    "- strategy: direct | loop | decompose",
    "  - direct: single worker pass, no review loop",
    "  - loop: one worker with orchestrator review iterations",
    "  - decompose: break into multiple subtasks for the agent team",
    "- complexity: trivial | moderate | complex (your AI judgment, not keywords)",
    "- reason: one sentence explaining your classification",
    decompose
      ? "- subtasks: required when strategy is decompose — ordered work for Architect/Workers/QA/Reviewer"
      : "- subtasks: [] unless strategy is decompose",
    "- job_type per subtask: worker | qa | reviewer | architect",
    "- depends_on_titles: titles of subtasks that must finish first",
    "",
    "Example shape:",
    JSON.stringify(example),
    "",
    "## Goal / Task",
    task.trim(),
  ].join("\n");
}