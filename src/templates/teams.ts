import type { CreateAgentInput } from "../domain/agent.js";
import type { AdapterId, OlapConfig } from "../types.js";

export interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  agents: Omit<CreateAgentInput, "adapter" | "model" | "effort">[];
}

/** Resolve job_type → model from olap.config.yaml jobs mapping or roles fallback. */
export function resolveJobModel(
  config: OlapConfig,
  jobType: CreateAgentInput["job_type"],
): { adapter: AdapterId; model: string; effort?: string } {
  const job = config.jobs?.[jobType];
  if (job) return { adapter: job.adapter, model: job.model, effort: job.effort };
  if (jobType === "orchestrator" || jobType === "architect" || jobType === "reviewer") {
    return config.roles.orchestrator;
  }
  return config.roles.worker;
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: "startup-mvp",
    name: "Startup MVP",
    description: "Architect, 2 Workers, QA, Reviewer — ship features overnight",
    agents: [
      {
        name: "Architect",
        display_role: "CTO / Architect",
        job_type: "architect",
        role: "Decompose goals, assign work, verify acceptance criteria.",
        skills: ["architect"],
      },
      {
        name: "Backend Engineer A",
        display_role: "Backend Engineer",
        job_type: "worker",
        role: "Implement backend features and APIs.",
        skills: ["worker"],
      },
      {
        name: "Backend Engineer B",
        display_role: "Backend Engineer",
        job_type: "worker",
        role: "Implement parallel backend tasks in isolated scope.",
        skills: ["worker"],
      },
      {
        name: "QA",
        display_role: "QA Engineer",
        job_type: "qa",
        role: "Run tests, typecheck, and lint. Report failures.",
        skills: ["qa"],
      },
      {
        name: "Reviewer",
        display_role: "Code Reviewer",
        job_type: "reviewer",
        role: "Review diffs for scope, quality, and architecture fit.",
        skills: ["review"],
      },
    ],
  },
  {
    id: "bugfix-squad",
    name: "Bugfix Squad",
    description: "Architect, 3 Workers, QA, Reviewer — clear issue backlog",
    agents: [
      {
        name: "Triager",
        display_role: "Architect",
        job_type: "architect",
        role: "Triage issues, prioritize, decompose fixes.",
        skills: ["architect"],
      },
      {
        name: "Fixer A",
        display_role: "Engineer",
        job_type: "worker",
        role: "Fix assigned bugs.",
        skills: ["worker"],
      },
      {
        name: "Fixer B",
        display_role: "Engineer",
        job_type: "worker",
        role: "Fix assigned bugs in parallel scope.",
        skills: ["worker"],
      },
      {
        name: "Fixer C",
        display_role: "Engineer",
        job_type: "worker",
        role: "Fix assigned bugs in parallel scope.",
        skills: ["worker"],
      },
      {
        name: "QA",
        display_role: "QA",
        job_type: "qa",
        role: "Verify fixes with regression tests.",
        skills: ["qa"],
      },
      {
        name: "Reviewer",
        display_role: "Reviewer",
        job_type: "reviewer",
        role: "Approve fixes before merge.",
        skills: ["review"],
      },
    ],
  },
  {
    id: "test-factory",
    name: "Test Factory",
    description: "Architect, 2 Workers, 2 QA, Reviewer — raise coverage",
    agents: [
      {
        name: "Coverage Lead",
        display_role: "Architect",
        job_type: "architect",
        role: "Plan test gaps and assign coverage work.",
        skills: ["architect"],
      },
      {
        name: "Test Writer A",
        display_role: "Engineer",
        job_type: "worker",
        role: "Write unit and integration tests.",
        skills: ["worker"],
      },
      {
        name: "Test Writer B",
        display_role: "Engineer",
        job_type: "worker",
        role: "Write tests in parallel modules.",
        skills: ["worker"],
      },
      {
        name: "QA A",
        display_role: "QA",
        job_type: "qa",
        role: "Run full test suite and report gaps.",
        skills: ["qa"],
      },
      {
        name: "QA B",
        display_role: "QA",
        job_type: "qa",
        role: "Run targeted module tests.",
        skills: ["qa"],
      },
      {
        name: "Reviewer",
        display_role: "Reviewer",
        job_type: "reviewer",
        role: "Review test quality and coverage claims.",
        skills: ["review"],
      },
    ],
  },
];

export function getTeamTemplate(id: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES.find((t) => t.id === id);
}