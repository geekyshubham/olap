import { AgentStore } from "../storage/agent-store.js";
import { olapPaths } from "../storage/paths.js";
import { ensureOlapWorkspace } from "../services/bootstrap.js";

export async function agentsListCommand(cwd = process.cwd()): Promise<void> {
  await ensureOlapWorkspace(cwd);
  const store = new AgentStore(olapPaths(cwd));
  const agents = await store.list();
  if (agents.length === 0) {
    console.log("No agents. Deploy a team with `olap org deploy startup-mvp`.");
    return;
  }
  for (const a of agents) {
    const task = a.current_task ? ` → ${a.current_task}` : "";
    console.log(
      `${a.status.padEnd(8)} ${a.id}  ${a.name} (${a.display_role}) [${a.job_type}] ${a.adapter}:${a.model}${task}`,
    );
  }
}