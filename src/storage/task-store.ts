import path from "node:path";
import type { CreateTaskInput, Task } from "../domain/task.js";
import { createId, sanitizeId } from "../domain/ids.js";
import { ensureDir, listFiles, readYaml, removeFile, writeYaml } from "./fs-utils.js";
import type { OlapPaths } from "./paths.js";

export class TaskStore {
  constructor(private readonly paths: OlapPaths) {}

  private filePath(id: string): string {
    return path.join(this.paths.tasks, `${sanitizeId(id)}.yaml`);
  }

  async ensure(): Promise<void> {
    await ensureDir(this.paths.tasks);
  }

  async create(input: CreateTaskInput): Promise<Task> {
    await this.ensure();
    const now = new Date().toISOString();
    const task: Task = {
      id: createId("task"),
      title: input.title,
      description: input.description ?? "",
      status: "todo",
      priority: input.priority ?? 5,
      assignee: input.assignee,
      job_type: input.job_type,
      labels: input.labels ?? [],
      depends_on: input.depends_on ?? [],
      created_at: now,
      updated_at: now,
      attempts: 0,
      max_attempts: input.max_attempts ?? 3,
      workspace_mode: input.workspace_mode,
      review_criteria: input.review_criteria,
      scope: input.scope,
      goal_id: input.goal_id,
      parent_task_id: input.parent_task_id,
      strategy: input.strategy,
      complexity: input.complexity,
    };
    await writeYaml(this.filePath(task.id), task);
    return task;
  }

  async get(id: string): Promise<Task | null> {
    return readYaml<Task>(this.filePath(id));
  }

  async save(task: Task): Promise<void> {
    task.updated_at = new Date().toISOString();
    await writeYaml(this.filePath(task.id), task);
  }

  async list(): Promise<Task[]> {
    const files = await listFiles(this.paths.tasks, ".yaml");
    const tasks = await Promise.all(files.map((f) => readYaml<Task>(f)));
    return tasks.filter((t): t is Task => t !== null);
  }

  async delete(id: string): Promise<void> {
    await removeFile(this.filePath(id));
  }
}