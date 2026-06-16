import type { Task, TaskStatus } from "./task.js";

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["review", "retrying", "failed", "cancelled"],
  retrying: ["in_progress", "failed", "cancelled"],
  review: ["done", "todo", "cancelled"],
  done: [],
  failed: ["todo", "retrying"],
  cancelled: ["todo"],
};

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["done", "failed", "cancelled"]);

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

export function isDispatchable(status: TaskStatus): boolean {
  return status === "todo" || status === "retrying";
}

export function isBlocked(task: Task, allTasks: Task[] | Map<string, Task>): boolean {
  if (task.depends_on.length === 0) return false;
  const lookup = (id: string): Task | undefined =>
    allTasks instanceof Map ? allTasks.get(id) : allTasks.find((t) => t.id === id);
  return task.depends_on.some((depId) => {
    const dep = lookup(depId);
    if (!dep) return false;
    return dep.status !== "done";
  });
}

export function resolveFailureStatus(attempts: number, maxAttempts: number): TaskStatus {
  return attempts >= maxAttempts ? "failed" : "retrying";
}

export function resolveCompletionStatus(reviewPassed: boolean): TaskStatus {
  return reviewPassed ? "done" : "todo";
}

export function calculateRetryDelay(attempt: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 5));
}