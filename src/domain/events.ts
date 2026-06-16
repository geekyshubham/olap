import type { TaskStatus } from "./task.js";
import type { AgentStatus } from "./agent.js";
import type { GoalStatus } from "./goal.js";

export type OlapOrchestratorEvent =
  | { type: "orchestrator:started" }
  | { type: "orchestrator:stopped" }
  | { type: "orchestrator:tick"; running: number; queued: number }
  | { type: "task:created"; taskId: string; title: string }
  | { type: "task:status_changed"; taskId: string; from: TaskStatus; to: TaskStatus }
  | { type: "task:decomposed"; goalId: string; taskIds: string[]; count: number }
  | { type: "agent:started"; agentId: string; taskId: string; runId: string }
  | { type: "agent:completed"; agentId: string; taskId: string; runId: string; ok: boolean }
  | { type: "agent:status_changed"; agentId: string; from: AgentStatus; to: AgentStatus }
  | { type: "goal:created"; goalId: string; title: string }
  | { type: "goal:status_changed"; goalId: string; from: GoalStatus; to: GoalStatus }
  | { type: "message:sent"; messageId: string; from: string; to?: string }
  | { type: "agent:output"; agentId: string; taskId: string; line: string }
  | { type: "orchestrator:error"; message: string };