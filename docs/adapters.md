# Adapters

OLAP separates orchestration from worker execution through adapter command builders. The adapter layer detects installed coding CLIs and builds phase-specific commands for architect and worker turns.

## Supported CLIs

| Adapter | Binaries | Architect shape | Worker shape |
| --- | --- | --- | --- |
| Grok | `grok` | `grok -p <prompt>` | `grok --permission-mode bypassPermissions -p <prompt>` |
| Claude | `claude` | `claude --print <prompt>` | `claude --print --permission-mode bypassPermissions <prompt>` |
| Gemini | `gemini` | `gemini --prompt <prompt>` | `gemini --approval-mode yolo --prompt <prompt>` |
| Codex | `codex` | `codex exec <prompt>` | `codex exec --ask-for-approval never <prompt>` |

Where supported, OLAP adds JSON output flags and model flags from `olap.config.yaml`.

## Selection

1. Detect available binaries on `PATH`.
2. Use `adapters.preferred` if detected.
3. Use `adapters.fallback` if the preferred adapter is missing.
4. Continue in `none` mode if no configured adapter is available.

`none` mode is still useful for checking context packing, review schema behavior, sessions, validators, and artifact generation.

## Safety

The current run loop is simulated. Adapter commands are generated and written to artifacts, but they are not spawned. This keeps development safe while the command contracts settle.

Real execution should keep the same boundaries:

- architect phases emit compact structured reviews
- worker phases receive the task, context pack, and latest review
- all output is captured into `.olap/runs/<run-id>`
- validators remain repo-defined commands

## Adding an Adapter

1. Add the adapter id to `AdapterId`.
2. Add binary detection in `src/adapters/detect.ts`.
3. Add command construction in `src/adapters/build.ts`.
4. Add defaults in `src/config/defaults.ts`.
5. Add tests for detection and generated commands.
