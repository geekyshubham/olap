import { detectAdapters } from "../adapters/detect.js";
import { resolveConfigModels } from "../adapters/discover.js";
import { readConfig } from "../config/read.js";
import { AgentStore } from "../storage/agent-store.js";
import { ensureDir } from "../storage/fs-utils.js";
import { olapPaths } from "../storage/paths.js";
import { getTeamTemplate, resolveJobModel, TEAM_TEMPLATES } from "../templates/teams.js";

export async function ensureOlapWorkspace(cwd: string): Promise<void> {
  const paths = olapPaths(cwd);
  await Promise.all([
    ensureDir(paths.root),
    ensureDir(paths.tasks),
    ensureDir(paths.agents),
    ensureDir(paths.goals),
    ensureDir(paths.messages),
    ensureDir(paths.runs),
    ensureDir(paths.workspaces),
    ensureDir(paths.skills),
  ]);
}

export async function deployTeam(
  cwd: string,
  templateId: string,
): Promise<{ agents: number; template: string }> {
  const template = getTeamTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown team template: ${templateId}. Run olap org list.`);
  }
  await ensureOlapWorkspace(cwd);
  const paths = olapPaths(cwd);
  const agentStore = new AgentStore(paths);
  const detections = await detectAdapters();
  const { config } = await resolveConfigModels(await readConfig(cwd), detections);

  const existing = await agentStore.list();
  if (existing.length > 0) {
    throw new Error(
      `Agents already deployed (${existing.length}). Remove .olap/agents/ or use a fresh project.`,
    );
  }

  for (const spec of template.agents) {
    const binding = resolveJobModel(config, spec.job_type);
    await agentStore.create({
      ...spec,
      adapter: binding.adapter,
      model: binding.model,
      effort: binding.effort,
    });
  }

  return { agents: template.agents.length, template: template.name };
}

export function listTeamTemplates(): typeof TEAM_TEMPLATES {
  return TEAM_TEMPLATES;
}