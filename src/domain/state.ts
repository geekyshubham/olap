export interface RunningEntry {
  task_id: string;
  agent_id: string;
  run_id: string;
  pid?: number;
  started_at: string;
  last_activity_at: string;
}

export interface RetryEntry {
  task_id: string;
  attempt: number;
  retry_at: string;
  reason: string;
}

export interface OrchestratorStats {
  ticks: number;
  tasks_dispatched: number;
  tasks_completed: number;
  tasks_failed: number;
}

export interface OrchestratorState {
  version: 1;
  running: Record<string, RunningEntry>;
  claimed: string[];
  retry_queue: RetryEntry[];
  stats: OrchestratorStats;
  updated_at: string;
}

export const DEFAULT_STATE: OrchestratorState = {
  version: 1,
  running: {},
  claimed: [],
  retry_queue: [],
  stats: {
    ticks: 0,
    tasks_dispatched: 0,
    tasks_completed: 0,
    tasks_failed: 0,
  },
  updated_at: new Date().toISOString(),
};