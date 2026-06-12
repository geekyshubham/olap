export type AdapterId = "grok" | "claude" | "gemini" | "codex";

export type ArchitectVerdict = "pass" | "revise" | "fail";

export interface AdapterSpec {
  id: AdapterId;
  binaries: string[];
}

export interface AdapterOptions {
  model?: string;
  extra_args: string[];
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
