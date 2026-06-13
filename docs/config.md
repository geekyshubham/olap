# Configuration

OLAP reads `olap.config.yaml` from the working directory. Missing fields are merged with defaults, so older configs keep working — new sections simply fall back to their defaults.

```yaml
version: 1
adapters:
  preferred: grok
  fallback: codex
  options:
    grok:
      model: grok-code-fast-1
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
roles:
  orchestrator:
    adapter: grok
    model: grok-4-latest
    effort: default
  worker:
    adapter: grok
    model: grok-code-fast-1
    effort: default
ui:
  theme: olap-dark
  mode: build
  banner: true
access:
  approval: on-failure
  sandbox: workspace-write
  network: false
  execution: dry-run
subagents:
  enabled: true
  max_parallel: 3
architect:
  output_budget_tokens: 4096
  context_pack_max_tokens: 32000
  review_schema_version: 1
  system_prompt_hint: Return compact structured reviews. Avoid prose unless blocked.
  require_valid_reviews: true
worker:
  max_iterations: 3
  dry_run: true
  iteration_timeout_ms: 300000
  stop_on_first_pass: false
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
- `access.execution` — `dry-run` simulates the worker; `live` spawns the real worker CLI. Live is skipped in `plan` mode and when the worker adapter is not installed.

## Sub-agents

- `subagents.enabled` — spawn a worker sub-agent per iteration.
- `subagents.max_parallel` — cap on concurrently active sub-agents (shown live in the usage panel).

## Adapters (legacy selection)

`adapters.preferred` / `adapters.fallback` remain for backward compatibility and binary detection. `options.<adapter>.model` is used when a role does not pin its own model, and `options.<adapter>.extra_args` are appended to generated commands.

## Architect

- `output_budget_tokens` limits expensive orchestrator output.
- `context_pack_max_tokens` bounds the generated context pack.
- `review_schema_version` pins the expected structured review shape.
- `system_prompt_hint` is a compact instruction sent to orchestrator phases.
- `require_valid_reviews` controls whether review schema validity is required.

## Worker

- `max_iterations` controls architect/worker loop depth.
- `dry_run` keeps generated adapter commands non-executing (the effective execution mode is also gated by `access.execution`).
- `iteration_timeout_ms` bounds a live worker process.
- `stop_on_first_pass` stops once the orchestrator emits a passing review.

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

Validators are shell commands run by `olap check`. They are intentionally external so each repo can keep its native quality gates.
