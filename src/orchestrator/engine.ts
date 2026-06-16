import { detectAdapters } from "../adapters/detect.js";
import { buildRoleCommands, withCommandPrompt } from "../adapters/build.js";
import { readConfig, cloneConfig } from "../config/read.js";
import type { Agent } from "../domain/agent.js";
import type { Goal } from "../domain/goal.js";
import type { Task } from "../domain/task.js";
import {
  calculateRetryDelay,
  isBlocked,
  isDispatchable,
  isTerminal,
  resolveFailureStatus,
} from "../domain/transitions.js";
import type { OrchestratorState } from "../domain/state.js";
import { createRunId } from "../run/artifacts.js";
import { executeCommand } from "../run/executor.js";
import { runOrchestratedLoop } from "../run/loop.js";
import { extractPlanText } from "../run/orchestrator.js";
import { SkillLoader } from "../skills/loader.js";
import { AgentStore } from "../storage/agent-store.js";
import { GoalStore } from "../storage/goal-store.js";
import { MessageStore } from "../storage/message-store.js";
import { acquireLock, releaseLock, touchLock } from "../storage/lock.js";
import { olapPaths } from "../storage/paths.js";
import { StateStore } from "../storage/state-store.js";
import { TaskStore } from "../storage/task-store.js";
import { ensureDir } from "../storage/fs-utils.js";
import type { OlapConfig, RoleId } from "../types.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { buildDecomposePrompt, parseDecompositionPlan } from "./decompose.js";
import { EventBus } from "./event-bus.js";

export interface EngineOptions {
  cwd: string;
  tickIntervalMs?: number;
  once?: boolean;
}

export class OrchestratorEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private tickInProgress = false;
  private stateMutex: Promise<void> = Promise.resolve();
  private readonly paths;
  private readonly taskStore;
  private readonly agentStore;
  private readonly goalStore;
  private readonly messageStore;
  private readonly stateStore;
  private readonly skillLoader;
  private readonly workspace;
  readonly events = new EventBus();
  private lockHeld = false;

  constructor(private readonly options: EngineOptions) {
    this.paths = olapPaths(options.cwd);
    this.taskStore = new TaskStore(this.paths);
    this.agentStore = new AgentStore(this.paths);
    this.goalStore = new GoalStore(this.paths);
    this.messageStore = new MessageStore(this.paths);
    this.stateStore = new StateStore(this.paths);
    this.skillLoader = new SkillLoader({ projectSkillsDir: this.paths.skills });
    this.workspace = new WorkspaceManager(options.cwd, this.paths.workspaces);
  }

  async init(): Promise<void> {
    await ensureDir(this.paths.root);
    await this.taskStore.ensure();
    await this.agentStore.ensure();
    await this.goalStore.ensure();
    await this.messageStore.ensure();
  }

  async startWatch(): Promise<void> {
    this.lockHeld = await acquireLock(this.paths.lock);
    if (!this.lockHeld) {
      throw new Error("Another OLAP orchestrator is already running (olap serve).");
    }
    this.events.emit({ type: "orchestrator:started" });
    const interval = this.options.tickIntervalMs ?? 10_000;
    await this.tick();
    this.intervalId = setInterval(() => {
      void this.tick().catch((err) => {
        this.events.emit({
          type: "orchestrator:error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }, interval);
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    if (this.lockHeld) await releaseLock(this.paths.lock);
    this.lockHeld = false;
    this.events.emit({ type: "orchestrator:stopped" });
  }

  waitForStop(): Promise<void> {
    return new Promise((resolve) => {
      const unsub = this.events.on((e) => {
        if (e.type === "orchestrator:stopped") {
          unsub();
          resolve();
        }
      });
    });
  }

  async tick(): Promise<void> {
    if (this.tickInProgress || this.shuttingDown) return;
    this.tickInProgress = true;
    try {
      await this.withStateLock(async () => {
        if (this.lockHeld) await touchLock(this.paths.lock);
        const config = await readConfig(this.options.cwd);
        const state = await this.stateStore.load();
        state.stats.ticks += 1;

        await this.processRetryQueue(state);
        await this.decomposeActiveGoals(config);

        const tasks = await this.taskStore.list();
        const taskMap = new Map(tasks.map((t) => [t.id, t]));
        const agents = await this.agentStore.list();

        const dispatchable = tasks
          .filter((t) => isDispatchable(t.status) && !isBlocked(t, taskMap))
          .filter((t) => !state.claimed.includes(t.id) && !state.running[t.id]);

        const runningCount = Object.keys(state.running).length;
        const maxConcurrent =
          config.orchestrator?.max_concurrent_agents ?? config.subagents.max_parallel ?? 4;
        const slots = Math.max(0, maxConcurrent - runningCount);

        const queued = dispatchable.length;
        this.events.emit({ type: "orchestrator:tick", running: runningCount, queued });

        if (slots > 0) {
          const sorted = sortTasks(dispatchable);
          for (const task of sorted.slice(0, slots)) {
            const agent = findBestAgent(agents, task, state);
            if (!agent || agent.status !== "idle") continue;
            state.claimed.push(task.id);
            await this.stateStore.save(state);
            void this.dispatchTask(task, agent, config, state).catch((err) => {
              this.events.emit({
                type: "orchestrator:error",
                message: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }

        await this.stateStore.save(state);

        if (this.options.once && runningCount === 0 && queued === 0) {
          const allTerminal = tasks.every((t) => isTerminal(t.status));
          if (allTerminal) await this.stop();
        }
      });
    } finally {
      this.tickInProgress = false;
    }
  }

  private async withStateLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.stateMutex;
    this.stateMutex = next;
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release!();
      }
    });
  }

  private async processRetryQueue(state: OrchestratorState): Promise<void> {
    const now = Date.now();
    const ready = state.retry_queue.filter((r) => new Date(r.retry_at).getTime() <= now);
    state.retry_queue = state.retry_queue.filter((r) => new Date(r.retry_at).getTime() > now);
    for (const entry of ready) {
      const task = await this.taskStore.get(entry.task_id);
      if (task && task.status === "retrying") {
        task.status = "todo";
        task.feedback = entry.reason;
        await this.taskStore.save(task);
      }
    }
  }

  private async decomposeActiveGoals(config: OlapConfig): Promise<void> {
    const goals = await this.goalStore.list();
    const active = goals.filter((g) => g.status === "active" && g.task_ids.length === 0);
    for (const goal of active) {
      await this.decomposeGoal(goal, config);
    }
  }

  private async decomposeGoal(goal: Goal, config: OlapConfig): Promise<void> {
    const architect = (await this.agentStore.list()).find((a) => a.job_type === "architect");
    if (!architect) return;

    const skills = await this.skillLoader.loadSkills(architect.skills);
    const prompt = [
      skills,
      buildDecomposePrompt(`${goal.title}\n\n${goal.description}`, true),
    ].join("\n\n");

    const planText = await this.runArchitectPrompt(architect, prompt, config, goal.title);
    const plan = parseDecompositionPlan(planText);

    if (plan.strategy !== "decompose" || plan.subtasks.length === 0) {
      const single = await this.taskStore.create({
        title: goal.title,
        description: goal.description,
        goal_id: goal.id,
        job_type: "worker",
        strategy: plan.strategy,
        complexity: plan.complexity,
      });
      goal.task_ids = [single.id];
      await this.goalStore.save(goal);
      this.events.emit({ type: "task:created", taskId: single.id, title: single.title });
      return;
    }

    const titleToId = new Map<string, string>();
    const createdIds: string[] = [];
    for (const sub of plan.subtasks) {
      const depends = sub.depends_on_titles
        .map((t) => titleToId.get(t))
        .filter((id): id is string => !!id);
      const task = await this.taskStore.create({
        title: sub.title,
        description: sub.description,
        goal_id: goal.id,
        job_type: sub.job_type,
        depends_on: depends,
        scope: sub.scope,
        priority: sub.priority,
        strategy: plan.strategy,
        complexity: plan.complexity,
      });
      titleToId.set(sub.title, task.id);
      createdIds.push(task.id);
      this.events.emit({ type: "task:created", taskId: task.id, title: task.title });
    }
    goal.task_ids = createdIds;
    await this.goalStore.save(goal);
    this.events.emit({
      type: "task:decomposed",
      goalId: goal.id,
      taskIds: createdIds,
      count: createdIds.length,
    });

    await this.messageStore.create({
      from_agent: architect.id,
      channel: "broadcast",
      subject: `Goal decomposed: ${goal.title}`,
      body: `Created ${createdIds.length} tasks. Strategy: ${plan.strategy}. ${plan.reason}`,
    });
  }

  private async dispatchTask(
    task: Task,
    agent: Agent,
    config: OlapConfig,
    state: OrchestratorState,
  ): Promise<void> {
    const runId = createRunId();
    const prevStatus = task.status;
    task.status = "in_progress";
    task.assignee = agent.id;
    task.attempts += 1;
    await this.taskStore.save(task);
    this.events.emit({
      type: "task:status_changed",
      taskId: task.id,
      from: prevStatus,
      to: "in_progress",
    });

    agent.status = "running";
    agent.current_task = task.id;
    await this.agentStore.save(agent);
    this.events.emit({
      type: "agent:status_changed",
      agentId: agent.id,
      from: "idle",
      to: "running",
    });

    const ws = await this.workspace.prepare(
      task.id,
      task.title,
      task.workspace_mode ?? config.orchestrator?.workspace_mode,
    );
    task.workspace = ws.cwd;
    await this.taskStore.save(task);

    state.running[task.id] = {
      task_id: task.id,
      agent_id: agent.id,
      run_id: runId,
      started_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    };
    state.claimed = state.claimed.filter((id) => id !== task.id);
    state.stats.tasks_dispatched += 1;
    await this.stateStore.save(state);

    this.events.emit({
      type: "agent:started",
      agentId: agent.id,
      taskId: task.id,
      runId,
    });

    const skills = await this.skillLoader.loadSkills(agent.skills);
    const taskPrompt = [
      skills,
      agent.role,
      "",
      `## Task: ${task.title}`,
      task.description,
      task.feedback ? `\n## Feedback\n${task.feedback}` : "",
    ].join("\n");

    const agentConfig = configForAgent(config, agent);
    const detections = await detectAdapters();
    const startMs = Date.now();

    let ok = false;
    try {
      if (agent.job_type === "architect" && task.labels.includes("decompose-only")) {
        const out = await this.runArchitectPrompt(agent, taskPrompt, agentConfig, task.title);
        ok = out.length > 0;
      } else {
        const result = await runOrchestratedLoop({
          task: taskPrompt,
          config: agentConfig,
          cwd: ws.cwd,
          detections,
          runId,
          routeHints: {
            strategy:
              task.strategy === "decompose" ? "loop" : task.strategy,
            complexity: task.complexity,
            reason: "task metadata from architect decomposition",
          },
          onUpdate: (u) => {
            if (u.type === "output" && u.line) {
              this.events.emit({
                type: "agent:output",
                agentId: agent.id,
                taskId: task.id,
                line: u.line,
              });
            }
          },
        });
        ok = result.status === "completed";
        if (ok && result.diff.changed) {
          task.proof = {
            files_changed: result.diff.files.map((f) =>
              typeof f === "string" ? f : f.path,
            ),
            agent_summary: result.brief.slice(0, 2000),
            run_id: runId,
          };
        }
      }
    } catch (err) {
      ok = false;
      agent.last_error = {
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      };
    }

    const duration = Date.now() - startMs;
    agent.stats.total_runs += 1;
    agent.stats.total_runtime_ms += duration;

    if (ok) {
      task.status = agent.job_type === "reviewer" ? "done" : "review";
      agent.stats.tasks_completed += 1;
      state.stats.tasks_completed += 1;
      if (agent.job_type === "worker" || agent.job_type === "qa") {
        const qaAgent = (await this.agentStore.list()).find((a) => a.job_type === "qa");
        if (qaAgent) {
          await this.messageStore.create({
            from_agent: agent.id,
            to_agent: qaAgent.id,
            subject: `Worker finished: ${task.title}`,
            body: `Task ${task.id} ready for QA. Files: ${task.proof?.files_changed?.join(", ") ?? "unknown"}`,
            task_id: task.id,
          });
        }
      }
      if (task.status === "review") {
        const reviewer = (await this.agentStore.list()).find((a) => a.job_type === "reviewer");
        if (reviewer) {
          const reviewTask = await this.taskStore.create({
            title: `Review: ${task.title}`,
            description: `Review worker output for: ${task.description}`,
            job_type: "reviewer",
            assignee: reviewer.id,
            depends_on: [task.id],
            parent_task_id: task.id,
            priority: 2,
          });
          this.events.emit({
            type: "task:created",
            taskId: reviewTask.id,
            title: reviewTask.title,
          });
        }
        task.status = "done";
      }
    } else {
      const next = resolveFailureStatus(task.attempts, task.max_attempts);
      task.status = next;
      agent.stats.tasks_failed += 1;
      if (next === "retrying") {
        state.retry_queue.push({
          task_id: task.id,
          attempt: task.attempts,
          retry_at: new Date(Date.now() + calculateRetryDelay(task.attempts)).toISOString(),
          reason: agent.last_error?.message ?? "task failed",
        });
      } else {
        state.stats.tasks_failed += 1;
      }
    }

    await this.taskStore.save(task);
    delete state.running[task.id];
    agent.status = "idle";
    agent.current_task = undefined;
    await this.agentStore.save(agent);
    await this.stateStore.save(state);

    this.events.emit({
      type: "agent:completed",
      agentId: agent.id,
      taskId: task.id,
      runId,
      ok,
    });
    this.events.emit({
      type: "task:status_changed",
      taskId: task.id,
      from: "in_progress",
      to: task.status,
    });
    this.events.emit({
      type: "agent:status_changed",
      agentId: agent.id,
      from: "running",
      to: "idle",
    });

    await this.checkGoalCompletion(task.goal_id);
    if (ws.mode === "worktree") await this.workspace.cleanup(task.id);
  }

  private async checkGoalCompletion(goalId?: string): Promise<void> {
    if (!goalId) return;
    const goal = await this.goalStore.get(goalId);
    if (!goal) return;
    const tasks = await Promise.all(goal.task_ids.map((id) => this.taskStore.get(id)));
    const allDone = tasks.every((t) => t && t.status === "done");
    const anyFailed = tasks.some((t) => t && t.status === "failed");
    if (allDone) {
      goal.status = "completed";
      await this.goalStore.save(goal);
      this.events.emit({
        type: "goal:status_changed",
        goalId: goal.id,
        from: "active",
        to: "completed",
      });
    } else if (anyFailed) {
      goal.status = "failed";
      await this.goalStore.save(goal);
      this.events.emit({
        type: "goal:status_changed",
        goalId: goal.id,
        from: "active",
        to: "failed",
      });
    }
  }

  private async runArchitectPrompt(
    agent: Agent,
    prompt: string,
    config: OlapConfig,
    taskTitle: string,
  ): Promise<string> {
    const detections = await detectAdapters();
    const agentConfig = configForAgent(config, { ...agent, job_type: "architect" });
    const { commands } = buildRoleCommands({
      config: agentConfig,
      detections,
      task: taskTitle,
      architectPrompt: prompt,
    });
    const base = commands.find((c) => c.phase === "architect");
    if (!base) return "";
    const cmd = withCommandPrompt(base, prompt, { step: "plan", executed: true });
    const result = await executeCommand(cmd, {
      cwd: this.options.cwd,
      timeoutMs: agentConfig.architect.iteration_timeout_ms,
    });
    return extractPlanText(result.stdout, "");
  }

  getStores(): {
    tasks: TaskStore;
    agents: AgentStore;
    goals: GoalStore;
    messages: MessageStore;
  } {
    return {
      tasks: this.taskStore,
      agents: this.agentStore,
      goals: this.goalStore,
      messages: this.messageStore,
    };
  }
}

function configForAgent(config: OlapConfig, agent: Agent): OlapConfig {
  const out = cloneConfig(config);
  const isOrchestratorJob =
    agent.job_type === "architect" ||
    agent.job_type === "orchestrator" ||
    agent.job_type === "reviewer";
  const role: RoleId = isOrchestratorJob ? "orchestrator" : "worker";
  out.roles[role] = {
    adapter: agent.adapter,
    model: agent.model,
    effort: agent.effort ?? "default",
  };
  if (agent.job_type === "qa") {
    out.ui.mode = "workflow";
  }
  if (agent.job_type === "reviewer") {
    out.worker.loop_policy = "always";
    out.worker.max_iterations = 1;
  }
  if (agent.job_type === "worker") {
    out.worker.loop_policy = out.worker.loop_policy ?? "auto";
  }
  return out;
}

function findBestAgent(agents: Agent[], task: Task, state: OrchestratorState): Agent | undefined {
  const busy = new Set(Object.values(state.running).map((r) => r.agent_id));
  if (task.assignee) {
    const assigned = agents.find((a) => a.id === task.assignee && !busy.has(a.id));
    if (assigned && assigned.status === "idle") return assigned;
  }
  const jobType = task.job_type ?? "worker";
  const candidates = agents.filter(
    (a) => a.status === "idle" && a.job_type === jobType && !busy.has(a.id),
  );
  return candidates[0];
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pri = (b.priority ?? 5) - (a.priority ?? 5);
    if (pri !== 0) return pri;
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Enqueue a user goal and optionally decompose on next tick. */
export async function enqueueGoal(cwd: string, title: string, description?: string): Promise<Goal> {
  const paths = olapPaths(cwd);
  const goalStore = new GoalStore(paths);
  await goalStore.ensure();
  const goal = await goalStore.create({ title, description });
  return goal;
}