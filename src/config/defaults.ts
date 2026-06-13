import type { OlapConfig } from "../types.js";

export const CONFIG_FILENAME = "olap.config.yaml";

export const DEFAULT_CONFIG: OlapConfig = {
  version: 1,
  adapters: {
    preferred: "grok",
    fallback: "codex",
    options: {
      grok: { model: "grok-composer-2.5-fast", extra_args: [] },
      claude: { model: "sonnet", extra_args: [] },
      gemini: { model: "gemini-2.5-pro", extra_args: [] },
      codex: { model: "gpt-5-codex", extra_args: [] },
      kiro: { model: "", extra_args: [] },
      ollama: { model: "qwen2.5-coder:7b", extra_args: [] },
    },
    capabilities: {
      grok: {
        planning: true,
        review: true,
        file_edits: true,
        shell: true,
        model_discovery: true,
        local: false,
        notes: "General-purpose agentic CLI with JSON output.",
      },
      claude: {
        planning: true,
        review: true,
        file_edits: true,
        shell: true,
        model_discovery: false,
        local: false,
        notes: "Strong planning/review CLI; model list is usually configured externally.",
      },
      gemini: {
        planning: true,
        review: true,
        file_edits: true,
        shell: true,
        model_discovery: false,
        local: false,
        notes: "Large-context CLI; model list is usually configured externally.",
      },
      codex: {
        planning: true,
        review: true,
        file_edits: true,
        shell: true,
        model_discovery: false,
        local: false,
        notes: "Agentic coding CLI with explicit sandbox and approval controls.",
      },
      kiro: {
        planning: true,
        review: true,
        file_edits: true,
        shell: true,
        model_discovery: true,
        local: false,
        notes: "Kiro manages model selection and trusted tool scopes.",
      },
      ollama: {
        planning: true,
        review: true,
        file_edits: false,
        shell: false,
        model_discovery: false,
        local: true,
        notes: "Local text model adapter. Best for plan/review or custom text-only workflows.",
      },
    },
  },
  roles: {
    orchestrator: { adapter: "grok", model: "grok-composer-2.5-fast", effort: "default" },
    worker: { adapter: "grok", model: "grok-composer-2.5-fast", effort: "default" },
  },
  ui: {
    theme: "mono",
    mode: "build",
    banner: true,
    confirm_before_run: true,
  },
  access: {
    approval: "on-failure",
    sandbox: "workspace-write",
    network: false,
  },
  subagents: {
    enabled: false,
    max_parallel: 1,
  },
  architect: {
    output_budget_tokens: 4096,
    context_pack_max_tokens: 32000,
    review_schema_version: 1,
    system_prompt_hint: "Return compact structured reviews. Avoid prose unless blocked.",
    require_valid_reviews: true,
    iteration_timeout_ms: 600_000,
  },
  worker: {
    max_iterations: 3,
    iteration_timeout_ms: 300_000,
    stop_on_first_pass: false,
    loop_policy: "auto",
  },
  cost: {
    enabled: true,
    currency: "USD",
    session_budget_usd: 0,
    prices_per_million_tokens: {
      grok: {
        "grok-composer-2.5-fast": { input: 1.25, output: 2.5 },
        "grok-build": { input: 1, output: 2 },
        "grok-code-fast-1": { input: 0.2, output: 1.5 },
        "grok-3-mini": { input: 0.3, output: 0.5 },
      },
      claude: {
        sonnet: { input: 3, output: 15 },
        opus: { input: 5, output: 25 },
        haiku: { input: 1, output: 5 },
      },
      gemini: {
        "gemini-2.5-flash": { input: 0.3, output: 2.5 },
        "gemini-2.0-flash": { input: 0.1, output: 0.4 },
      },
      codex: {
        "gpt-5-codex": { input: 1.25, output: 10 },
        "gpt-5": { input: 1.25, output: 10 },
        "o4-mini": { input: 1.1, output: 4.4 },
      },
      ollama: {
        "qwen2.5-coder:7b": { input: 0, output: 0 },
      },
    },
  },
  modules: [],
  validators: [
    { name: "typecheck", command: "npm run typecheck" },
    { name: "test", command: "npm test" },
  ],
};
