# OLAP

<div align="center">

<pre>
 ██████╗ ██╗      █████╗ ██████╗ 
██╔═══██╗██║     ██╔══██╗██╔══██╗
██║   ██║██║     ███████║██████╔╝
██║   ██║██║     ██╔══██║██╔═══╝ 
╚██████╔╝███████╗██║  ██║██║     
 ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     
</pre>

orchestrated loop · architect plans, worker builds

</div>

OLAP is an orchestrated loop architect/worker CLI for coding agents. A small, token-efficient **orchestrator** plans and reviews work while a cheaper or more available **worker** does the implementation. You choose a model for each role independently. Supported adapters are Grok CLI, Claude Code, Gemini CLI, Codex CLI, and Kiro CLI.

The terminal UI is built on `@earendil-works/pi-tui` and gives you a Warp-like context bar (repo, git status, working directory), live run feedback (planning → working → reviewing) with orchestrator/worker token usage and sub-agent counts, an in-app settings panel, model selection, theming, modes, and access control. OLAP also notifies you when a newer published version is available.

## Install

```bash
npm install -g @geekyshubham/olap
```

Homebrew:

```bash
brew tap geekyshubham/olap
brew install olap
```

From source:

```bash
npm install
npm run build
npm link
```

## Quick Start

```bash
olap init           # write olap.config.yaml
olap adapters       # detect grok / claude / gemini / codex on PATH
olap models         # list known models per adapter
olap config         # show resolved roles, mode, theme, access
olap run "add the auth callback tests"
olap                # open the interactive TUI
```

## Roles and model selection

OLAP splits every run into two roles, each bound to an adapter (which CLI) and a model (which weights):

```yaml
roles:
  orchestrator:           # plans and reviews — favor reasoning
    adapter: grok
    model: grok-4-latest
  worker:                 # writes the code — favor speed/cost
    adapter: grok
    model: grok-code-fast-1
```

The orchestrator and worker can use different adapters (e.g. plan with Claude Opus, build with Grok Code Fast). Pick models interactively in the TUI (`/models`, `/settings`) or on the CLI:

```bash
olap run "refactor the parser" --orchestrator claude:opus --worker grok:grok-code-fast-1
```

`olap models` lists the models reported by each installed CLI (for example, it runs `grok models`), falling back to a built-in catalog when a CLI cannot enumerate them. The TUI model pickers use the same discovery, so the choices match what your CLIs actually support.

## The TUI

Run `olap` (or `olap tui`) to open the interactive UI:

- **Context bar** — repo name, branch with dirty/ahead/behind markers, working directory, the orchestrator/worker models, and the current mode.
- **Live feedback** — a spinner plus phase labels (packing context, planning, working, reviewing), streamed worker output, and a usage panel showing per-role token usage, sub-agents spawned/active, and context/budget gauges.
- **Settings panel** (`/settings`) — choose orchestrator/worker models, theme, mode, and access control without leaving the app. Changes persist to `olap.config.yaml`.
- **Model selection** (`/model orchestrator`, `/model worker`).
- **Modes** (`/mode plan|build|workflow`).
- **Themes** (`/theme` cycles; five built in: `olap-dark`, `grok-night`, `mono`, `solarized-dark`, `light`).

Slash commands autocomplete as you type `/`. Global keys: `Enter` run, `Ctrl+L` clear, `Ctrl+C` quit, `Esc` close an overlay.

## Modes

| Mode | Behavior |
| --- | --- |
| `plan` | Orchestrator plans only; workers are not run. Great for previewing. |
| `build` | Full architect/worker loop. |
| `workflow` | Full loop with validation gates. |

## Access control

Access settings map to each adapter's real permission flags and gate execution:

```yaml
access:
  approval: on-failure        # untrusted | on-failure | on-request | never
  sandbox: workspace-write    # read-only | workspace-write | danger-full-access
  network: false              # allow worker network access (sandbox dependent)
  execution: dry-run          # dry-run simulates; live spawns the real worker CLI
```

`execution: dry-run` (the default) builds and records adapter commands without spawning them, so no paid API calls are made. Switch to `live` (in `/settings`, or `olap run … --live`) to spawn the real worker CLI and stream its output. Live runs are skipped in `plan` mode and when the worker adapter is not installed.

## Commands

| Command | Purpose |
| --- | --- |
| `olap` / `olap tui` | Open the interactive TUI |
| `olap init` | Write `olap.config.yaml` |
| `olap adapters` | Detect Grok, Claude, Gemini, Codex CLIs on `PATH` |
| `olap models` | List known models per adapter and which roles use them |
| `olap config` | Print the resolved configuration |
| `olap modules` | List built-in and configured Pi-compatible modules |
| `olap run <task>` | Run the architect/worker loop and write artifacts |
| `olap check` | Run configured validators |

`olap run` flags: `--mode`, `--orchestrator <adapter[:model]>`, `--worker <adapter[:model]>`, `--theme`, `--live`, `--dry-run`, `--quiet`.

## Architecture

OLAP keeps expensive output small by making the orchestrator produce compact structured reviews instead of long prose, while cheaper context is packed into a bounded context pack for the worker.

Each run produces:

- adapter command plans for orchestrator and worker phases (role-aware, access-mapped)
- `.olap/sessions` records for resumable work
- `.olap/runs/<run-id>` artifacts: context pack, reviews, event log, report, summary
- structured review validation enforced by schema

The run loop emits phased live events (`plan → work → review`) with per-role token usage and sub-agent tracking. In `dry-run` it simulates each phase; in `live` it spawns the worker adapter behind the same command and review contracts.

## Packaging

```bash
npm run build
npm test
npm run lint
npm run typecheck
npm run pack:check
npm run smoke:cli
```

## Docs

- [Configuration](docs/config.md)
- [Adapters](docs/adapters.md)
- [Homebrew](docs/homebrew.md)