import path from "node:path";
import type { CreateGoalInput, Goal } from "../domain/goal.js";
import { createId, sanitizeId } from "../domain/ids.js";
import { ensureDir, listFiles, readYaml, removeFile, writeYaml } from "./fs-utils.js";
import type { OlapPaths } from "./paths.js";

export class GoalStore {
  constructor(private readonly paths: OlapPaths) {}

  private filePath(id: string): string {
    return path.join(this.paths.goals, `${sanitizeId(id)}.yaml`);
  }

  async ensure(): Promise<void> {
    await ensureDir(this.paths.goals);
  }

  async create(input: CreateGoalInput): Promise<Goal> {
    await this.ensure();
    const now = new Date().toISOString();
    const goal: Goal = {
      id: createId("goal"),
      title: input.title,
      description: input.description ?? "",
      status: "active",
      assignee: input.assignee,
      created_at: now,
      updated_at: now,
      task_ids: [],
    };
    await writeYaml(this.filePath(goal.id), goal);
    return goal;
  }

  async get(id: string): Promise<Goal | null> {
    return readYaml<Goal>(this.filePath(id));
  }

  async save(goal: Goal): Promise<void> {
    goal.updated_at = new Date().toISOString();
    await writeYaml(this.filePath(goal.id), goal);
  }

  async list(): Promise<Goal[]> {
    const files = await listFiles(this.paths.goals, ".yaml");
    const goals = await Promise.all(files.map((f) => readYaml<Goal>(f)));
    return goals.filter((g): g is Goal => g !== null);
  }

  async delete(id: string): Promise<void> {
    await removeFile(this.filePath(id));
  }
}