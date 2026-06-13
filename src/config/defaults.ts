import type { OlapConfig } from "../types.js";

export const CONFIG_FILENAME = "olap.config.yaml";

export const DEFAULT_CONFIG: OlapConfig = {
  version: 1,
  adapters: {
    preferred: "grok",
    fallback: "codex",
    options: {
      grok: { model: "grok-code-fast-1", extra_args: [] },
      claude: { model: "sonnet", extra_args: [] },
      gemini: { model: "gemini-2.5-pro", extra_args: [] },
      codex: { model: "gpt-5-codex", extra_args: [] },
      kiro: { model: "", extra_args: [] },
    },
  },
  roles: {
    orchestrator: { adapter: "grok", model: "grok-4-latest", effort: "default" },
    worker: { adapter: "grok", model: "grok-code-fast-1", effort: "default" },
  },
  ui: {
    theme: "mono",
    mode: "build",
    banner: true,
  },
  access: {
    approval: "on-failure",
    sandbox: "workspace-write",
    network: false,
    execution: "dry-run",
  },
  subagents: {
    enabled: true,
    max_parallel: 3,
  },
  architect: {
    output_budget_tokens: 4096,
    context_pack_max_tokens: 32000,
    review_schema_version: 1,
    system_prompt_hint: "Return compact structured reviews. Avoid prose unless blocked.",
    require_valid_reviews: true,
  },
  worker: {
    max_iterations: 3,
    dry_run: true,
    iteration_timeout_ms: 300_000,
    stop_on_first_pass: false,
    loop_policy: "auto",
  },
  modules: [],
  validators: [
    { name: "typecheck", command: "npm run typecheck" },
    { name: "test", command: "npm test" },
  ],
};
