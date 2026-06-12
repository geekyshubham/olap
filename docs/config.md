# Configuration

OLAP reads `olap.config.yaml` from the working directory. Missing fields are merged with defaults.

```yaml
version: 1
adapters:
  preferred: grok
  fallback: codex
  options:
    grok:
      model: grok-composer
      extra_args: []
    claude:
      model: sonnet
      extra_args: []
    gemini:
      model: gemini-pro
      extra_args: []
    codex:
      model: gpt-5-codex
      extra_args: []
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

## Adapters

- `preferred` is the first adapter OLAP tries to use.
- `fallback` is used when the preferred adapter is not detected.
- `options.<adapter>.model` is translated into the matching CLI model flag.
- `options.<adapter>.extra_args` are appended to generated adapter commands.

## Architect

- `output_budget_tokens` limits expensive architect output.
- `context_pack_max_tokens` bounds the generated context pack.
- `review_schema_version` pins the expected structured review shape.
- `system_prompt_hint` is a compact instruction sent to architect phases.
- `require_valid_reviews` controls whether review schema validity is required.

## Worker

- `max_iterations` controls architect/worker loop depth.
- `dry_run` keeps generated adapter commands non-executing.
- `iteration_timeout_ms` is reserved for real process execution.
- `stop_on_first_pass` stops once the architect emits a passing review.

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
