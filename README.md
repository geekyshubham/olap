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

### Orchestrated Loop Architect/Worker CLI for AI Coding Agents

> **Cut your AI coding costs dramatically.** OLAP pairs a smart **orchestrator** model to plan and review with a cheap **worker** model to write and test code — without compromising on output quality.

[![npm version](https://img.shields.io/npm/v/@geekyshubham/olap)](https://www.npmjs.com/package/@geekyshubham/olap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

</div>

## The Problem: AI Coding Is Expensive

Every major AI coding CLI — Claude Code, Gemini CLI, Grok CLI, Codex CLI, Kiro CLI — burns tokens fast. The bottleneck is **implementation**: writing code, editing files, running tests. These steps generate the most output tokens, and output tokens are the most expensive part of any API call.

Expensive frontier models are great at *deciding what to do*. But using them to *actually write every line of code* is overkill — and it drains your budget.

---

## The Solution: Orchestrator + Worker

OLAP splits the AI coding pipeline into two independent roles:

| Role | Job | Recommended Model Type |
|---|---|---|
| **Orchestrator** | Plans the work and reviews the output | Capable reasoning models (e.g., Claude Sonnet, Gemini Pro, Grok Composer) |
| **Worker** | Implements the code, edits files, runs commands, runs tests | Cheap, fast, or high-concurrency models (e.g., Gemini Flash, Codex Mini) |

You configure each role independently. The orchestrator stays lean — it thinks and delegates. The worker stays cheap — it builds. The result: **frontier-quality planning at a fraction of the cost.**

**Example setup:** Use a capable orchestrator like `claude:claude-sonnet-3.5` for high-level planning and code review, while `gemini:gemini-2.5-flash` (significantly cheaper per output token) handles all the actual file edits and implementation. The orchestrator never touches a file directly — it just decides what the worker should do.

---

## What is OLAP?

**OLAP** stands for **Orchestrated Loop Architect/Worker CLI**. It is a terminal tool that wraps existing AI coding CLIs — letting you connect multiple agents into a single coordinated coding workflow where each model does what it does cheapest.

OLAP is not a new AI model. It is a **meta-layer** that routes work between the AI tools you already use, based on the role you assign them.

---

## How It Works

```
User Prompt / Task
        │
        ▼
┌─────────────────────────────┐
│      Run Plan Preview       │  (TUI Confirm Overlay or CLI startup)
│   [Strategy/Roles/Limits]   │
└────────────┬────────────────┘
             │  confirmed by user
             ▼
┌─────────────────────────────┐
│      OLAP Orchestrator       │
│  (plans, reviews, delegates) │
│   [your chosen model/CLI]    │
└────────────┬────────────────┘
             │  sub-task instructions
             ▼
┌─────────────────────────────┐
│        OLAP Worker           │
│  (writes code, edits files,  │
│   runs commands, tests)      │
│   [your chosen model/CLI]    │
└────────────┬────────────────┘
             │  implementation output (real changes tracked via git diff)
             ▼
┌─────────────────────────────┐
│      OLAP Orchestrator       │
│  (reviews output, iterates   │
│   or marks task complete)    │
└─────────────────────────────┘
```

The orchestrator loop:
1. Receives your prompt.
2. Plans the work and breaks it into sub-tasks.
3. Dispatches each sub-task to the worker.
4. Reviews worker output (verifying it against any configured test/lint validators).
5. Iterates if needed, or finalises and returns the result.

The worker never plans — it only implements. This keeps worker token usage predictable and cheap.

---

## Supported Adapters

OLAP connects to the following AI coding CLIs out of the box:

| CLI | Provider | Use as Orchestrator | Use as Worker |
|---|---|:---:|:---:|
| **Claude Code** | Anthropic | ✅ | ✅ |
| **Gemini CLI** | Google | ✅ | ✅ |
| **Grok CLI** | xAI | ✅ | ✅ |
| **Codex CLI** | OpenAI | ✅ | ✅ |
| **Kiro CLI** | AWS | ✅ | ✅ |
| **Ollama** | Local | ✅ | Text-only |

Mix and match across providers. Run a Claude orchestrator with a Gemini worker. Run Grok as orchestrator with Codex as worker. Ollama is supported for local plan/review or text-only workflows; its default capability profile marks file edits and shell execution as unavailable.

---

## Features

### Cost-Optimised Dual-Model Architecture
Run two models in parallel: a **planner/reviewer** and a **coder**. Eliminate the expensive pattern of using frontier models for every token of output. Typical setups reduce total API spend by 60–80% on implementation-heavy tasks without degrading plan quality.

### Terminal UI with Live Run Feedback
A Warp-inspired terminal interface shows you exactly what is happening at every step:
- **Planning →** orchestrator is breaking down the task
- **Working →** worker is implementing code
- **Reviewing →** orchestrator is validating output

Live token counters for both orchestrator and worker, context-pack coverage, and iteration state are visible throughout every run.

### TUI Pre-Run Confirmation & Run Plan Preview
Shows a confirmation overlay before starting work with strategy, roles, stop conditions, and iteration cap derived from the same routing logic as the loop. 
- Press `Enter` to start the run.
- Press `Esc` to cancel.
- Press `e` to return the task description back to your text editor.

You can override the routing strategy by prepending your prompt with `/direct` (forces a single worker pass) or `/loop` (forces a review loop strategy).

### Scrollable Transcript History
Scroll up and down through the terminal output history using `PgUp` and `PgDn` (or the arrow keys `Up` / `Down` when your editor input box is empty). The TUI renders PgUp and PgDn visual indicators whenever scrolling is available.

### Collapsible Planner Briefs
Large high-level plans or briefs produced by the orchestrator are automatically collapsed in the TUI to prevent screen clutter. A direct link to the full document is provided (e.g. `.olap/runs/<run-id>/brief.md`), allowing you to audit details with ease.

### Warp-Style Context Bar
A persistent context bar at the top of the terminal displays:
- Active repository name
- Current git branch with dirty/ahead/behind markers
- Working directory
- Active orchestrator and worker models/modes

### In-App Settings Panel
Configure everything without leaving the terminal:
- Switch orchestrator and worker models on the fly
- Choose from supported CLI adapters
- Set access controls and execution modes
- Toggle themes

### Graphify and Headroom Shortcuts
OLAP exposes two external-tool shortcuts from both the TUI and the CLI:
- `/graphify` or `olap graphify` runs `graphify .` by default to build a project knowledge graph. Pass arguments to target another path, for example `/graphify src` or `olap graphify src --no-open`.
- `/headroom` or `olap headroom` runs `headroom perf` by default so you can inspect Headroom's token-compression behavior. Pass arguments through for other Headroom commands, for example `/headroom stats` or `olap headroom stats`.

These commands require the tools to be installed on your `PATH`. For Graphify, install the official `graphifyy` package (`uv tool install graphifyy` or `pipx install graphifyy`). For Headroom, install the `headroom-ai` package (`pip install "headroom-ai[all]"`).

### Cost Estimates, Smart Routing, and Diff-Only Review
OLAP also implements the cost-focused improvements from the design notes:
- Live usage includes estimated USD cost, a single-model baseline, and savings percentage.
- `cost.session_budget_usd` can stop a run when estimated spend crosses your cap.
- Auto routing classifies tasks as `trivial`, `moderate`, or `complex`; trivial tasks run direct, moderate tasks use a shorter review loop, and complex tasks keep the full loop.
- Orchestrator reviews are explicitly diff-only, using changed files, diff summary, worker output, and acceptance criteria instead of a fresh full-repo context pack.
- `olap adapters` prints adapter capability profiles (`plan`, `review`, `write`, `shell`, `models`, `local`) so routing and configuration decisions are auditable.

---

## Installation

### Via npm:
```bash
npm install -g @geekyshubham/olap
```

### Via Homebrew:
```bash
brew tap geekyshubham/olap
brew install olap
```

> [!NOTE]
> npm and Homebrew are alternative install methods. Both publish the same `olap` binary. The Homebrew formula utilizes `link_overwrite "bin/olap"` so that `brew install` or `brew upgrade` can overwrite any existing NPM-generated global symlinks without causing file conflicts.

### From Source:
```bash
npm install
npm run build
npm link
```

**Prerequisites:**
- Node.js 18+ (Node 22+ recommended)
- At least one supported CLI adapter installed and authenticated (Claude Code, Gemini CLI, Grok CLI, Codex CLI, or Kiro CLI) on your system `PATH`.

---

## Quick Start

```bash
olap init           # write default olap.config.yaml
olap adapters       # detect grok / claude / gemini / codex / kiro / ollama on PATH
olap models         # list known models per adapter
olap config         # show resolved roles, mode, theme, access
olap graphify       # run graphify . for the current project
olap headroom       # run headroom perf
olap run "add the auth callback tests"   # run from CLI
olap                # open the interactive TUI
```

---

## Configuration

Settings are managed through the in-app settings panel (type `/settings` inside the TUI) or via a config file at `olap.config.yaml` in your working directory:

```yaml
version: 1
adapters:
  preferred: grok
  fallback: codex
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
  confirm_before_run: true
access:
  approval: on-failure
  sandbox: workspace-write
  network: false
subagents:
  enabled: false
  max_parallel: 1
architect:
  context_pack_max_tokens: 32000
worker:
  max_iterations: 3
  stop_on_first_pass: false
  loop_policy: auto
cost:
  enabled: true
  currency: USD
  session_budget_usd: 0
  prices_per_million_tokens:
    grok:
      grok-code-fast-1:
        input: 0.2
        output: 1.5
validators:
  - name: typecheck
    command: npm run typecheck
  - name: test
    command: npm test
```

For a comprehensive guide on all configuration keys, see [docs/config.md](docs/config.md).

---

## Modes

| Mode | Behavior |
| --- | --- |
| `plan` | Orchestrator plans only; workers are not run. Great for previewing. |
| `build` | Full architect/worker loop. |
| `workflow` | Full loop with validation gates. |

---

## Access Control

Access settings map to each adapter's real permission flags (approval, sandbox, network):

```yaml
access:
  approval: on-failure        # untrusted | on-failure | on-request | never
  sandbox: workspace-write    # read-only | workspace-write | danger-full-access
  network: false              # allow worker network access (sandbox dependent)
```

OLAP always spawns the real orchestrator CLI (to plan and review) and worker CLI (to implement) and streams their output. In `plan` mode only the orchestrator runs. In `build`/`workflow` mode both adapters must be installed — a missing worker fails before planning.

---

## Commands

| Command | Purpose |
| --- | --- |
| `olap` / `olap tui` | Open the interactive TUI |
| `olap init` | Write `olap.config.yaml` |
| `olap adapters` | Detect Grok, Claude, Gemini, Codex, and Kiro CLIs on `PATH` |
| `olap models` | List known models per adapter and which roles use them |
| `olap config` | Print the resolved configuration |
| `olap modules` | List built-in and configured Pi-compatible modules |
| `olap graphify [args...]` | Run Graphify (defaults to `graphify .`) |
| `olap headroom [args...]` | Run Headroom helpers (defaults to `headroom perf`) |
| `olap run <task>` | Run the architect/worker loop and write artifacts |
| `olap check` | Run configured validators |

`olap run` flags: `--mode`, `--orchestrator <adapter[:model]>`, `--worker <adapter[:model]>`, `--theme`, `--quiet`.

---

## The TUI Commands

While inside the interactive TUI, type `/` to auto-complete commands:

- `/help` — Open the help overlay.
- `/settings` — Open settings overlay.
- `/models` — Select models for orchestrator/worker.
- `/theme` — Cycle through themes (`olap-dark`, `grok-night`, `mono`, `solarized-dark`, `light`).
- `/mode` — Switch mode (`plan`, `build`, `workflow`).
- `/graphify [args]` — Run Graphify for this project (defaults to `graphify .`).
- `/headroom [args]` — Run Headroom helpers (defaults to `headroom perf`).
- `/clear` — Clear conversation history.
- `/exit` or `/quit` — Exit OLAP.

Global keys: `Enter` to run, `Ctrl+L` to clear, `Ctrl+C` to quit, `Esc` to close overlays or cancel running tasks.

---

## Contributing

Contributions are welcome. To add a new CLI adapter:

1. Fork the repo.
2. Create an adapter class under `src/adapters/`.
3. Implement the `OrchestratorAdapter` or `WorkerAdapter` interface.
4. Add a test suite.
5. Open a PR.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## Roadmap

- [ ] Cost dashboard: real-time spend tracking per session
- [ ] Adapter chaining: route specific task types to specific workers
- [ ] Local model support via Ollama
- [ ] Web UI companion
- [ ] Session replay and audit logs

---

## License

[MIT](LICENSE)

---

## Docs

- [Configuration](docs/config.md)
- [Adapters](docs/adapters.md)
- [Homebrew](docs/homebrew.md)
