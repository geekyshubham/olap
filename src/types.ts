export type AdapterId = "grok" | "claude" | "gemini" | "codex" | "kiro";

export type ArchitectVerdict = "pass" | "revise" | "fail";

/** Roles that map to a concrete adapter + model. */
export type RoleId = "orchestrator" | "worker";

/** High-level operating mode, surfaced in the TUI and used to gate worker execution. */
export type WorkMode = "plan" | "build" | "workflow";

/** Approval policy applied to worker execution (maps per-adapter). */
export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";

/** Filesystem sandbox policy for worker execution (maps per-adapter). */
export type SandboxPolicy = "read-only" | "workspace-write" | "danger-full-access";

/** Whether the worker phase actually spawns processes or stays simulated. */
export type ExecutionMode = "dry-run" | "live";

/**
 * When to run the full orchestrator/worker review loop vs a single direct worker pass.
 * - auto: route from task keywords (/direct and /loop override)
 * - always: always run the review loop
 * - never: always run one worker pass (no simulated reviews)
 */
export type LoopPolicy = "auto" | "always" | "never";

export interface AdapterSpec {
  id: AdapterId;
  binaries: string[];
}

export interface AdapterOptions {
  model?: string;
  extra_args: string[];
}

/** A role binds an adapter (which CLI) to a model (which weights). */
export interface RoleConfig {
  adapter: AdapterId;
  model: string;
  /** Reasoning/effort level mapped to each CLI's flag; "default" omits it. */
  effort?: string;
}

export interface UiConfig {
  /** Active theme name from the theme registry. */
  theme: string;
  /** Active operating mode. */
  mode: WorkMode;
  /** Whether the animated banner is shown. */
  banner: boolean;
}

export interface AccessConfig {
  approval: ApprovalPolicy;
  sandbox: SandboxPolicy;
  /** Allow workers network access (sandbox-dependent). */
  network: boolean;
  /** dry-run keeps everything simulated; live spawns worker processes. */
  execution: ExecutionMode;
}

export interface SubagentConfig {
  enabled: boolean;
  /** Maximum worker sub-agents allowed to run in parallel. */
  max_parallel: number;
}

export interface ValidatorConfig {
  name: string;
  command: string;
}

export type OlapModuleKind =
  | "pi-package"
  | "extension"
  | "skill"
  | "prompt-template"
  | "theme"
  | "local";

export interface OlapModuleConfig {
  name: string;
  kind: OlapModuleKind;
  enabled: boolean;
  package?: string;
  entry?: string;
  description?: string;
}

export interface OlapConfig {
  version: number;
  adapters: {
    preferred: AdapterId;
    fallback: AdapterId;
    options: Partial<Record<AdapterId, AdapterOptions>>;
  };
  /** Role-based model selection: orchestrator plans/reviews, worker codes. */
  roles: Record<RoleId, RoleConfig>;
  ui: UiConfig;
  access: AccessConfig;
  subagents: SubagentConfig;
  architect: {
    output_budget_tokens: number;
    context_pack_max_tokens: number;
    review_schema_version: number;
    system_prompt_hint: string;
    require_valid_reviews: boolean;
  };
  worker: {
    max_iterations: number;
    dry_run: boolean;
    iteration_timeout_ms: number;
    stop_on_first_pass: boolean;
    /** How often to use the architect/worker review loop vs a single worker pass. */
    loop_policy: LoopPolicy;
  };
  modules: OlapModuleConfig[];
  validators: ValidatorConfig[];
}

export interface AdapterDetection {
  id: AdapterId;
  detected: boolean;
  binary?: string;
}

export interface AdapterCommand {
  adapter: AdapterId;
  binary: string;
  argv: string[];
  shell: string;
  dry_run: boolean;
  phase: "architect" | "worker";
}

/** Resolved adapter + model + detection for a role. */
export interface ResolvedRole {
  role: RoleId;
  adapter: AdapterId;
  model: string;
  detection?: AdapterDetection;
  available: boolean;
}

export interface ContextPackFile {
  path: string;
  tokens: number;
  content: string;
}

export interface ContextPack {
  generated_at: string;
  max_tokens: number;
  total_tokens: number;
  truncated: boolean;
  files: ContextPackFile[];
}

export interface ArchitectReviewFinding {
  severity: "info" | "warn" | "error";
  message: string;
}

export interface ArchitectReview {
  schema_version: number;
  iteration: number;
  verdict: ArchitectVerdict;
  summary: string;
  findings: ArchitectReviewFinding[];
  next_actions: string[];
  token_budget_used: number;
}

export interface SessionRecord {
  id: string;
  created_at: string;
  updated_at: string;
  task_summary: string;
  status: "active" | "completed" | "failed";
  run_ids: string[];
  adapter: AdapterId | "none";
}

export type RunPhase = "architect" | "worker";

export interface RunEvent {
  ts: string;
  phase: RunPhase;
  type: string;
  tokens_in: number;
  tokens_out: number;
  message: string;
}

export interface TokenSummary {
  tokens_in: number;
  tokens_out: number;
  efficiency: number;
}

/** Per-role usage accounting surfaced live in the TUI. */
export interface RoleUsage {
  tokens_in: number;
  tokens_out: number;
  calls: number;
}

export interface UsageSnapshot {
  orchestrator: RoleUsage;
  worker: RoleUsage;
  subagents_spawned: number;
  subagents_active: number;
}

export interface ValidatorResult {
  name: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface OlapModule extends OlapModuleConfig {
  source: "built-in" | "config";
}

export interface RunSummary {
  run_id: string;
  session_id: string;
  adapter: AdapterId | "none";
  iterations: number;
  reviews_valid: number;
  context_pack_tokens: number;
  dry_run: boolean;
}
