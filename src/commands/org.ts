import { deployTeam, listTeamTemplates } from "../services/bootstrap.js";

export async function orgListCommand(): Promise<void> {
  const templates = listTeamTemplates();
  console.log("Available team templates:\n");
  for (const t of templates) {
    console.log(`  ${t.id.padEnd(16)} ${t.name}`);
    console.log(`  ${"".padEnd(16)} ${t.description}`);
    console.log(`  ${"".padEnd(16)} Agents: ${t.agents.map((a) => a.display_role).join(", ")}`);
    console.log();
  }
}

export async function orgDeployCommand(
  templateId: string,
  options: { cwd?: string; goal?: string } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const result = await deployTeam(cwd, templateId);
  console.log(`Deployed team "${result.template}" with ${result.agents} agents.`);

  if (options.goal) {
    const { enqueueGoal } = await import("../orchestrator/engine.js");
    const goal = await enqueueGoal(cwd, options.goal);
    console.log(`Created goal ${goal.id}: ${goal.title}`);
    console.log("Run `olap serve` or open TUI watch mode to process overnight.");
  }
}