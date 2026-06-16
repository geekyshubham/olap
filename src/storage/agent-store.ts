import path from "node:path";
import type { Agent, CreateAgentInput } from "../domain/agent.js";
import { createId, sanitizeId } from "../domain/ids.js";
import { ensureDir, listFiles, readYaml, removeFile, writeYaml } from "./fs-utils.js";
import type { OlapPaths } from "./paths.js";

export class AgentStore {
  constructor(private readonly paths: OlapPaths) {}

  private filePath(id: string): string {
    return path.join(this.paths.agents, `${sanitizeId(id)}.yaml`);
  }

  async ensure(): Promise<void> {
    await ensureDir(this.paths.agents);
  }

  async create(input: CreateAgentInput): Promise<Agent> {
    await this.ensure();
    const agent: Agent = {
      id: createId("agent"),
      name: input.name,
      display_role: input.display_role,
      job_type: input.job_type,
      adapter: input.adapter,
      model: input.model,
      effort: input.effort,
      role: input.role,
      skills: input.skills ?? [],
      status: "idle",
      workspace_mode: input.workspace_mode,
      timeout_ms: input.timeout_ms,
      stats: {
        tasks_completed: 0,
        tasks_failed: 0,
        total_runs: 0,
        total_runtime_ms: 0,
      },
    };
    await writeYaml(this.filePath(agent.id), agent);
    return agent;
  }

  async get(id: string): Promise<Agent | null> {
    return readYaml<Agent>(this.filePath(id));
  }

  async save(agent: Agent): Promise<void> {
    await writeYaml(this.filePath(agent.id), agent);
  }

  async list(): Promise<Agent[]> {
    const files = await listFiles(this.paths.agents, ".yaml");
    const agents = await Promise.all(files.map((f) => readYaml<Agent>(f)));
    return agents.filter((a): a is Agent => a !== null);
  }

  async delete(id: string): Promise<void> {
    await removeFile(this.filePath(id));
  }
}