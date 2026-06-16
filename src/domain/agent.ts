import type { AdapterId } from "../types.js";
import type { AgentJobType, WorkspaceMode } from "./task.js";

export type AgentStatus = "idle" | "running" | "error" | "disabled";

export interface AgentStats {
  tasks_completed: number;
  tasks_failed: number;
  total_runs: number;
  total_runtime_ms: number;
}

export interface AgentLastError {
  message: string;
  timestamp: string;
}

/** Persistent agent entity — maps to a job type and model binding. */
export interface Agent {
  id: string;
  name: string;
  /** Display role: CTO, Backend Engineer, QA, Reviewer, etc. */
  display_role: string;
  job_type: AgentJobType;
  adapter: AdapterId;
  model: string;
  effort?: string;
  role: string;
  skills: string[];
  status: AgentStatus;
  current_task?: string;
  workspace_mode?: WorkspaceMode;
  timeout_ms?: number;
  stats: AgentStats;
  last_error?: AgentLastError;
}

export interface CreateAgentInput {
  name: string;
  display_role: string;
  job_type: AgentJobType;
  adapter: AdapterId;
  model: string;
  effort?: string;
  role: string;
  skills?: string[];
  workspace_mode?: WorkspaceMode;
  timeout_ms?: number;
}