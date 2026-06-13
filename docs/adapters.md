# Adapters

OLAP separates orchestration from worker execution through adapter command builders. The adapter layer detects installed coding CLIs and builds phase-specific commands for the orchestrator (architect) and worker roles.

## Supported CLIs

| Adapter | Binaries | Architect shape | Worker shape |
| --- | --- | --- | --- |
| Grok | `grok` | `grok --permission-mode plan -p <prompt>` | `grok --permission-mode <mode> -p <task>` |
| Claude | `claude` | `claude --print --permission-mode plan <prompt>` | `claude --print --permission-mode <mode> <task>` |
| Gemini | `gemini` | `gemini --approval-mode plan --prompt <prompt>` | `gemini --approval-mode <mode> --prompt <task>` |
| Codex | `codex` | `codex exec --sandbox read-only <prompt>` | `codex exec --sandbox <policy> --ask-for-approval <policy> <task>` |
| Kiro | `kiro-cli` | `kiro-cli chat --no-interactive --trust-tools=fs_read <prompt>` | `kiro-cli chat --no-interactive <trust flags> <task>` |
| Ollama | `ollama` | `ollama run <model> <prompt>` | `ollama run <model> <task>` |

Builders add the role's model via the adapter's native model mechanism (`--model` for most CLIs, positional model for Ollama), and JSON output flags where the CLI supports them. The architect phase always runs read-only / plan, regardless of access settings, because planning should never write.

Ollama is a local text adapter. It can produce plans/reviews, but its default capability profile sets `file_edits: false` and `shell: false`; use it for plan mode, review assistance, or custom local workflows rather than expecting it to edit files like the agentic coding CLIs.

## Roles

Each phase resolves a role to a concrete adapter + model:

- the orchestrator phase uses `roles.orchestrator`
- the worker phase uses `roles.worker`

Because the roles are independent, you can plan with one CLI and build with another (e.g. orchestrate with `claude:opus`, work with `grok:grok-code-fast-1`). `resolveRoles()` reports whether each role's adapter was detected on `PATH`.

## Access mapping

Worker commands map `access` settings into each CLI's real permission vocabulary:

| OLAP access | grok / claude `--permission-mode` | gemini `--approval-mode` | codex |
| --- | --- | --- | --- |
| `sandbox: read-only` | `plan` | `plan` | `--sandbox read-only` |
| `approval: untrusted` | `default` | `default` | `--ask-for-approval untrusted` |
| `approval: on-failure` / `on-request` | `acceptEdits` | `auto_edit` | `--ask-for-approval on-failure` / `on-request` |
| `approval: never` | `bypassPermissions` | `yolo` | `--ask-for-approval never` |
| `sandbox: danger-full-access` | `bypassPermissions` | `yolo` | `--sandbox danger-full-access` |

When `network: true` and `sandbox: workspace-write`, the codex worker also receives `-c sandbox_workspace_write.network_access=true`.

Kiro maps the same access vocabulary to `kiro-cli chat` trust flags: `read-only` → `--trust-tools=fs_read`, `untrusted` → `--trust-tools=`, `on-failure`/`on-request` → `--trust-tools=fs_read,fs_write`, and `never` / `danger-full-access` → `--trust-all-tools`.

## Model discovery

`olap models` and the TUI model pickers ask each installed CLI for its models where possible, falling back to a built-in catalog:

- Grok: runs `grok models` and parses the reported list (including the default).
- Other adapters use the static catalog; Kiro defers to its own configured default model unless you pin one. Ollama defaults to `qwen2.5-coder:7b`, but any locally installed Ollama model can be pinned in `roles`.

Discovered models are cached in-process and refreshed on startup, so the pickers reflect what your CLIs actually support rather than a fixed guess.

## Selection and detection

1. Detect available binaries on `PATH`.
2. Resolve `roles.orchestrator` and `roles.worker` to adapters + models.
3. `adapters.preferred` / `adapters.fallback` remain for backward compatibility.

If a role's adapter is missing, the run fails fast with a clear error. In `plan` mode the worker is skipped even when installed.

## Execution

OLAP always spawns the configured orchestrator and worker CLIs when their adapters are installed:

- orchestrator phases plan and emit compact structured reviews
- worker phases receive the task, context pack, and access-mapped flags
- stdout/stderr stream into the timeline and token usage is parsed from JSON output
- all output is captured into `.olap/runs/<run-id>`
- validators remain repo-defined commands (workflow mode)

When the orchestrator review CLI exits successfully but does not print schema-valid review JSON, OLAP falls back to a signal-derived review (worker exit + diff). If `architect.require_valid_reviews` is true (default), the run fails instead of accepting the derived verdict.

## Adding an Adapter

1. Add the adapter id to `AdapterId`.
2. Add binary detection in `src/adapters/detect.ts`.
3. Add command construction (architect + worker, with access mapping) in `src/adapters/build.ts`.
4. Add models to the catalog in `src/adapters/models.ts`.
5. Add defaults in `src/config/defaults.ts`.
6. Add tests for detection, generated commands, and access mapping.
