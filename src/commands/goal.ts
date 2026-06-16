import { enqueueGoal } from "../orchestrator/engine.js";
import { GoalStore } from "../storage/goal-store.js";
import { olapPaths } from "../storage/paths.js";
import { ensureOlapWorkspace } from "../services/bootstrap.js";

export async function goalAddCommand(
  title: string,
  options: { description?: string; cwd?: string } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  await ensureOlapWorkspace(cwd);
  const goal = await enqueueGoal(cwd, title, options.description);
  console.log(`Created goal ${goal.id}: ${goal.title}`);
  console.log("The Architect will decompose this on the next orchestrator tick.");
}

export async function goalListCommand(cwd = process.cwd()): Promise<void> {
  await ensureOlapWorkspace(cwd);
  const store = new GoalStore(olapPaths(cwd));
  const goals = await store.list();
  if (goals.length === 0) {
    console.log("No goals.");
    return;
  }
  for (const g of goals) {
    console.log(`${g.status.padEnd(10)} ${g.id}  ${g.title} (${g.task_ids.length} tasks)`);
  }
}