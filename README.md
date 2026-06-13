# OLAP

<div align="center">

<pre>
 ██████╗ ██╗      █████╗ ██████╗ 
██╔═══██╗██║     ██╔══██╗██╔══██╗
██║   ██║██║     ███████║██████╔╝
██║   ██║██║     ██╔══██║██╔═══╝ 
╚██████╔╝███████╗██║  ██║██║     
 ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ▟▛
</pre>

orchestrated loop · architect plans, worker builds

</div>

▟▛ OLAP is an orchestrated loop architect/worker CLI for coding agents. A small, token-efficient **orchestrator** plans and reviews work while a cheaper or more available **worker** does the implementation. You choose a model for each role independently. Supported adapters are Grok CLI, Claude Code, Gemini CLI, Codex CLI, and Kiro CLI.

The terminal UI gives you a Warp-like context bar (repo, git status, working directory), live run feedback (planning → working → reviewing) with orchestrator/worker token usage and sub-agent counts, an in-app settings panel, model selection, theming, modes, and access control. OLAP also notifies you when a newer published version is available.

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
    model: grok-composer-2.5-fast
  worker:                 # writes the code — favor speed/cost
    adapter: grok
    model: grok-composer-2.5-fast
```

The orchestrator and worker can use different adapters (e.g. plan with Claude Opus, build with Grok Code Fast). Pick models interactively in the TUI (`/models`, `/settings`) or on the CLI:

```bash
olap run "refactor the parser" --orchestrator claude:opus --worker grok:grok-build
```

`olap models` lists the models reported by each installed CLI (for example, it runs `grok models`), falling back to a built-in catalog when a CLI cannot enumerate them. The TUI model pickers use the same discovery, so the choices match what your CLIs actually support.

## The TUI

Run `olap` (or `olap tui`) to open the interactive UI:

- **Context bar** — repo name, branch with dirty/ahead/behind markers, working directory, the orchestrator/worker models, and the current mode.
- **Live feedback** — a spinner plus phase labels (packing context, planning, working, reviewing), streamed and parsed worker output (collapsed reasoning, tool-call status, last file touched, stall detection), a per-iteration git diff summary, and a usage panel showing per-role token usage, sub-agents spawned/active, a context-pack gauge (with a truncation marker), and real cumulative token totals.
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

Access settings map to each adapter's real permission flags (approval, sandbox, network):

```yaml
access:
  approval: on-failure        # untrusted | on-failure | on-request | never
  sandbox: workspace-write    # read-only | workspace-write | danger-full-access
  network: false              # allow worker network access (sandbox dependent)
```

OLAP always spawns the real orchestrator CLI (to plan and review) and worker CLI (to implement) and streams their output. In `plan` mode only the orchestrator runs. In `build`/`workflow` mode both adapters must be installed — a missing worker fails before planning.

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

`olap run` flags: `--mode`, `--orchestrator <adapter[:model]>`, `--worker <adapter[:model]>`, `--theme`, `--quiet`.

## Architecture

OLAP keeps expensive output small by making the orchestrator produce compact structured reviews instead of long prose, while cheaper context is packed into a bounded context pack for the worker.

Each run produces:

- adapter command plans for orchestrator and worker phases (role-aware, access-mapped)
- `.olap/sessions` records for resumable work
- `.olap/runs/<run-id>` artifacts: context pack, reviews, event log, report, `summary.json`, `changes.json` (diff summary)
- structured review validation enforced by schema

The run loop emits phased live events (`plan → work → review`) with per-role token usage and sub-agent tracking. It spawns the orchestrator CLI to plan and to review, and the worker CLI to implement — each with real repository context injected — behind the same command and review contracts. Natural-language intent in the task is honored: "no loops" / "just fix" runs a single pass (orchestrator plan → one worker pass), while "keep iterating" forces the review loop.

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
