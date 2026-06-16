/**
 * Task domain model — unit of work in the multi-agent orchestrator.
 * State machine: todo → in_progress → review → done
 */

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "retrying"
  | "review"
  | "done"
  | "failed"
  | "cancelled";

/** Agent job types that map to skills and model roles. */
export type AgentJobType =
  | "orchestrator"
  | "architect"
  | "worker"
  | "qa"
  | "reviewer";

export type WorkspaceMode = "shared" | "worktree";

export type ReviewCriterion = "test_pass" | "typecheck" | "lint";

export interface ReviewResult {
  criterion: ReviewCriterion;
  passed: boolean;
  output: string;
}

export interface TaskProof {
  branch?: string;
  files_changed: string[];
  agent_summary?: string;
  run_id?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  /** Agent id (e.g. agt_worker_a). */
  assignee?: string;
  /** Job type hint for agent matching when assignee is unset. */
  job_type?: AgentJobType;
  labels: string[];
  depends_on: string[];
  created_at: string;
  updated_at: string;
  attempts: number;
  max_attempts: number;
  workspace_mode?: WorkspaceMode;
  workspace?: string;
  proof?: TaskProof;
  review_criteria?: ReviewCriterion[];
  review_results?: ReviewResult[];
  scope?: string[];
  feedback?: string;
  goal_id?: string;
  /** Parent task when decomposed from a goal. */
  parent_task_id?: string;
  /** AI routing: direct | loop | decompose */
  strategy?: "direct" | "loop" | "decompose";
  complexity?: "trivial" | "moderate" | "complex";
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  assignee?: string;
  job_type?: AgentJobType;
  labels?: string[];
  depends_on?: string[];
  max_attempts?: number;
  workspace_mode?: WorkspaceMode;
  review_criteria?: ReviewCriterion[];
  scope?: string[];
  goal_id?: string;
  parent_task_id?: string;
  strategy?: Task["strategy"];
  complexity?: Task["complexity"];
}