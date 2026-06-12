# OLAP

OLAP is an orchestrated loop architect/worker CLI for coding agents. It uses a small, token-efficient architect loop to plan and review work while cheaper or more available CLI workers do the implementation. The first supported worker adapters are Grok CLI, Claude Code, Gemini CLI, and Codex CLI.

The terminal UI is built on `@earendil-works/pi-tui`, from the Pi monorepo, and OLAP exposes a small module manifest for Pi-compatible packages, skills, extensions, prompt templates, themes, and local modules.

## Install

```bash
npm install -g @geekyshubham/olap
```

Homebrew (after tap is published):

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
olap init
olap adapters
olap modules
olap run "add the auth callback tests"
olap
```

`olap` opens the Claude-like TUI. `olap run` currently executes the safe simulated harness path: it builds adapter commands, packs context, generates structured architect reviews, records sessions, and writes artifacts without calling paid model APIs.

## Commands

| Command | Purpose |
| --- | --- |
| `olap` | Open the interactive TUI |
| `olap tui` | Open the interactive TUI explicitly |
| `olap init` | Write `olap.config.yaml` |
| `olap adapters` | Detect Grok, Claude, Gemini, and Codex CLIs on `PATH` |
| `olap modules` | List built-in and configured Pi-compatible modules |
| `olap run <task>` | Run the simulated architect/worker loop and write artifacts |
| `olap check` | Run configured validators |

## Architecture

OLAP keeps expensive output small by making the architect produce compact structured reviews instead of long prose. Input context is cheaper, so the harness packs relevant local files into a bounded context pack and sends concise instructions to workers.

The current run loop produces:

- adapter command plans for architect and worker phases
- `.olap/sessions` records for resumable work
- `.olap/runs/<run-id>` artifacts, including context pack, reviews, event log, report, and summary
- structured review validation so the architect output can be enforced by schema

Future execution can swap the dry-run simulator for real process execution behind the same adapter and review contracts.

## Packaging

```bash
npm run build
npm test
npm run lint
npm run typecheck
npm run pack:check
npm run smoke:cli
```

Release preparation:

```bash
bash scripts/release.sh patch
```

Homebrew tap notes are in [docs/homebrew.md](docs/homebrew.md).

## Docs

- [Configuration](docs/config.md)
- [Adapters](docs/adapters.md)
- [Homebrew](docs/homebrew.md)
