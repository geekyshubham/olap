import { TaskStore } from "../storage/task-store.js";
import { olapPaths } from "../storage/paths.js";
import { ensureOlapWorkspace } from "../services/bootstrap.js";

const STATUS_ORDER = [
  "in_progress",
  "retrying",
  "review",
  "todo",
  "done",
  "failed",
  "cancelled",
] as const;

export async function tasksListCommand(cwd = process.cwd()): Promise<void> {
  await ensureOlapWorkspace(cwd);
  const store = new TaskStore(olapPaths(cwd));
  const tasks = await store.list();
  tasks.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  if (tasks.length === 0) {
    console.log("No tasks. Create a goal with `olap goal add` or `olap org deploy --goal`.");
    return;
  }
  for (const t of tasks) {
    const assignee = t.assignee ? ` → ${t.assignee}` : "";
    const job = t.job_type ? ` [${t.job_type}]` : "";
    console.log(`${t.status.padEnd(12)} ${t.id}  ${t.title}${job}${assignee}`);
  }
}

export async function tasksShowCommand(id: string, cwd = process.cwd()): Promise<void> {
  const store = new TaskStore(olapPaths(cwd));
  const task = await store.get(id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }
  console.log(JSON.stringify(task, null, 2));
}