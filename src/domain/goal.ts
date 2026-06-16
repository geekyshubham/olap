export type GoalStatus = "active" | "completed" | "failed" | "cancelled";

export interface Goal {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  assignee?: string;
  created_at: string;
  updated_at: string;
  task_ids: string[];
}

export interface CreateGoalInput {
  title: string;
  description?: string;
  assignee?: string;
}

export function isGoalTerminal(status: GoalStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}