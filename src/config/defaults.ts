import type { OlapConfig } from "../types.js";

export const CONFIG_FILENAME = "olap.config.yaml";

export const DEFAULT_CONFIG: OlapConfig = {
  version: 1,
  adapters: {
    preferred: "grok",
    fallback: "codex",
    options: {
      grok: { model: "grok-composer", extra_args: [] },
      claude: { model: "sonnet", extra_args: [] },
      gemini: { model: "gemini-pro", extra_args: [] },
      codex: { model: "gpt-5-codex", extra_args: [] },
    },
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
  },
  modules: [],
  validators: [
    { name: "typecheck", command: "npm run typecheck" },
    { name: "test", command: "npm test" },
  ],
};
