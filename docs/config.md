# Configuration

OLAP reads `olap.config.yaml` from the working directory. Missing fields are merged with defaults, so older configs keep working — new sections simply fall back to their defaults.

## Migration from dry-run

OLAP always spawns live orchestrator and worker CLIs. The following keys and flags were removed:

- `access.execution` — ignored with a warning if still present
- `worker.dry_run` — removed; runs always execute when adapters are installed
- CLI `--live` / `--dry-run` — removed

Change detection and the post-run “must have file changes” gate require a git work tree. Direct/operational tasks (e.g. publish, deploy) skip the change gate.

```yaml
version: 1
adapters:
  preferred: grok
  fallback: codex
  options:
    grok:
      model: grok-composer-2.5-fast
      extra_args: []
    claude:
      model: sonnet
      extra_args: []
    gemini:
      model: gemini-2.5-pro
      extra_args: []
    codex:
      model: gpt-5-codex
      extra_args: []
    kiro:
      model: ""
      extra_args: []
    ollama:
      model: qwen2.5-coder:7b
      extra_args: []
  capabilities:
    grok:
      planning: true
      review: true
      file_edits: true
      shell: true
      model_discovery: true
      local: false
    ollama:
      planning: true
      review: true
      file_edits: false
      shell: false
      model_discovery: false
      local: true
roles:
  orchestrator:
    adapter: grok
    model: grok-composer-2.5-fast
    effort: default
  worker:
    adapter: grok
    model: grok-composer-2.5-fast
    effort: default
ui:
  theme: olap-dark
  mode: build
  banner: true
access:
  approval: on-failure
  sandbox: workspace-write
  network: false
subagents:
  enabled: true
  max_parallel: 3
architect:
  output_budget_tokens: 4096
  context_pack_max_tokens: 32000
  review_schema_version: 1
  system_prompt_hint: Return compact structured reviews. Avoid prose unless blocked.
  require_valid_reviews: true
  iteration_timeout_ms: 600000
worker:
  max_iterations: 3
  iteration_timeout_ms: 300000
  stop_on_first_pass: false
  loop_policy: auto
cost:
  enabled: true
  currency: USD
  session_budget_usd: 0
  prices_per_million_tokens:
    grok:
      grok-composer-2.5-fast:
        input: 1.25
        output: 2.5
      grok-code-fast-1:
        input: 0.2
        output: 1.5
modules: []
validators:
  - name: typecheck
    command: npm run typecheck
  - name: test
    command: npm test
```

## Roles

Roles bind a coding CLI (`adapter`) to a model. The orchestrator plans and reviews; the worker writes code. They can use different adapters.

- `roles.orchestrator.adapter` / `roles.orchestrator.model` / `roles.orchestrator.effort`
- `roles.worker.adapter` / `roles.worker.model` / `roles.worker.effort`

Run `olap models` to see known models per adapter, or pick them in the TUI with `/settings` and `/models`. When you change an adapter in the settings panel, the model resets to a sensible default for that role.

Where a CLI can enumerate its own models (for example `grok models` or `kiro-cli chat --list-models`), OLAP discovers them from the CLI and the pickers show those instead of the static catalog. Kiro manages its own models; leave its model blank to use Kiro's configured default, or pin one.

`effort` is the reasoning/effort level (`default`, `low`, `medium`, `high`, `xhigh`, `max`). It maps to `--effort` for Claude and Kiro and to `model_reasoning_effort` for Codex (clamped at `high`); Grok and Gemini have no effort flag, so it is ignored there. `default` omits the flag entirely.

## UI

- `ui.theme` — active theme: `olap-dark`, `grok-night`, `mono`, `solarized-dark`, or `light`.
- `ui.mode` — `plan`, `build`, or `workflow`.
- `ui.banner` — show the small banner.

## Access control

Access settings are surfaced in the TUI and mapped into each adapter's real permission flags (see [Adapters](adapters.md)).

- `access.approval` — `untrusted` | `on-failure` | `on-request` | `never`.
- `access.sandbox` — `read-only` | `workspace-write` | `danger-full-access`.
- `access.network` — allow the worker network access (sandbox dependent).

## Sub-agents

- `subagents.enabled` — spawn a worker sub-agent per iteration.
- `subagents.max_parallel` — cap on concurrently active sub-agents (shown live in the usage panel).

## Adapters (legacy selection)

`adapters.preferred` / `adapters.fallback` remain for backward compatibility and binary detection. `options.<adapter>.model` is used when a role does not pin its own model, and `options.<adapter>.extra_args` are appended to generated commands.

`adapters.capabilities.<adapter>` is a user-editable profile used for reporting and future routing decisions:

- `planning` — adapter can produce implementation briefs.
- `review` — adapter can review worker output.
- `file_edits` — adapter can edit repository files.
- `shell` — adapter can run shell/tool commands.
- `model_discovery` — OLAP can ask the CLI for available models.
- `local` — adapter runs locally instead of through a cloud model provider.

`olap adapters` prints these profiles as compact tags, for example `capabilities=plan,review,write,shell,models`.

## Architect

- `output_budget_tokens` limits expensive orchestrator output.
- `context_pack_max_tokens` bounds the generated context pack.
- `review_schema_version` pins the expected structured review shape.
- `system_prompt_hint` is a compact instruction sent to orchestrator phases.
- `require_valid_reviews` controls whether review schema validity is required.
- `iteration_timeout_ms` bounds orchestrator plan/review CLI invocations.

## Worker

- `max_iterations` controls architect/worker loop depth.
- `iteration_timeout_ms` bounds a worker process.
- `stop_on_first_pass` stops once the orchestrator emits a passing review.
- `loop_policy` — `auto` (route from task keywords and complexity), `always` (review loop), or `never` (single worker pass). In `auto`, trivial tasks go direct, moderate tasks use up to two iterations, and complex tasks use `max_iterations`.

## Cost

Cost estimates are based on observed token usage from adapter output and configurable per-model prices. They are estimates for run-time visibility, not a billing source of truth.

- `cost.enabled` — show cost estimates in the TUI, CLI result, and run report.
- `cost.currency` — currently `USD`.
- `cost.session_budget_usd` — stop a run when estimated spend exceeds this amount. `0` disables the cap.
- `cost.prices_per_million_tokens.<adapter>.<model>.input` — estimated USD per 1M input tokens.
- `cost.prices_per_million_tokens.<adapter>.<model>.output` — estimated USD per 1M output tokens.

Each run report includes total estimated cost, a single-model baseline priced as if all tokens used the orchestrator model, and the estimated savings percentage. If a selected model has no configured price, OLAP still runs but marks the cost summary as `pricing incomplete`.

## Modules

`modules` declares Pi-compatible packages or local module entries that OLAP can discover and report.

```yaml
modules:
  - name: review-skill-pack
    kind: skill
    enabled: true
    package: "@example/pi-review-skills"
  - name: quiet-theme
    kind: theme
    enabled: false
    entry: "./themes/quiet.ts"
```

Supported `kind` values are `pi-package`, `extension`, `skill`, `prompt-template`, `theme`, and `local`.

## Validators

Validators are shell commands run by `olap check`. In `workflow` mode, OLAP also runs configured validators automatically after a successful worker loop and marks the run failed when any validator exits non-zero. They are intentionally external so each repo can keep its native quality gates.

Each run writes artifacts under `.olap/runs/<run-id>/`, including `summary.json` (with `files_changed`, `worker_cancelled`, `validators_passed`, `cwd`, `executed`, and `cost`), `changes.json` (diff summary), reviews, events, and the context pack. Orchestrator review prompts are diff-only: they use the changed file list, diff summary, worker output, and task acceptance criteria instead of repacking the full repository for each review.
