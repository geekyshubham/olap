import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createTempDir } from "./helpers.js";

const runGit = promisify(execFile);
import {
  parseUsageFromOutput,
  runOrchestratedLoop,
  shouldCompleteSession,
  shouldExecuteWorker,
  shouldRunOrchestrator,
  type LoopUpdate,
} from "../src/run/loop.js";
import type { ExecOptions, ExecResult } from "../src/run/executor.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { EMPTY_DIFF_SUMMARY, type DiffSummary } from "../src/git/status.js";
import type { AdapterCommand, AdapterDetection, OlapConfig } from "../src/types.js";

const NO_DELAY = () => Promise.resolve();
const NO_DETECTIONS: AdapterDetection[] = [
  { id: "grok", detected: false },
  { id: "claude", detected: false },
  { id: "gemini", detected: false },
  { id: "codex", detected: false },
];
const GROK_DETECTED: AdapterDetection[] = [
  { id: "grok", detected: true, binary: "/bin/grok" },
  { id: "claude", detected: false },
  { id: "gemini", detected: false },
  { id: "codex", detected: false },
];

const NO_DIFF = async (): Promise<DiffSummary> => ({ ...EMPTY_DIFF_SUMMARY });
const SOME_DIFF: DiffSummary = {
  changed: true,
  files: [{ path: "src/tui/components.ts", insertions: 1, deletions: 1, binary: false }],
  insertions: 1,
  deletions: 1,
};
const NO_REPO_STATUS = async (): Promise<string> => "main clean";

function changingSignature(): (cwd: string) => Promise<string> {
  let calls = 0;
  return async () => {
    calls += 1;
    return calls === 1 ? "before-worker" : "after-worker";
  };
}

function cfg(patch: (c: OlapConfig) => void): OlapConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  patch(config);
  return config;
}

/** A fake executor that records every spawned command and answers per phase/step. */
function recordingExecutor(opts: {
  reviewJson?: (iteration: number) => string;
  workerStdout?: string;
  workerStopReason?: string;
  workerOk?: boolean;
} = {}) {
  const calls: AdapterCommand[] = [];
  const execute = async (command: AdapterCommand, options: ExecOptions): Promise<ExecResult> => {
    calls.push(command);
    if (command.phase === "worker") {
      const stdout =
        opts.workerStdout ??
        JSON.stringify({
          text: "Edited the file.",
          stopReason: opts.workerStopReason ?? "EndTurn",
          usage: { input_tokens: 40, output_tokens: 60 },
        });
      options.onLine?.("stdout", stdout);
      const ok = opts.workerOk ?? true;
      return mkResult({ ok, stdout });
    }
    if (command.step === "review") {
      const review =
        opts.reviewJson?.(1) ??
        JSON.stringify({
          schema_version: 1,
          iteration: 1,
          verdict: "pass",
          summary: "Looks correct.",
          findings: [{ severity: "info", message: "ok" }],
          next_actions: [],
          token_budget_used: 120,
        });
      options.onLine?.("stdout", review);
      return mkResult({ ok: true, stdout: review });
    }
    const plan = JSON.stringify({ text: "Brief: edit components.ts, verify with tests." });
    options.onLine?.("stdout", plan);
    return mkResult({ ok: true, stdout: plan });
  };
  return { calls, execute: execute as unknown as typeof import("../src/run/executor.js").executeCommand };
}

function mkResult(p: { ok: boolean; stdout: string; aborted?: boolean }): ExecResult {
  return {
    ok: p.ok,
    exitCode: p.ok ? 0 : 1,
    signal: null,
    stdout: p.stdout,
    stderr: "",
    timedOut: false,
    aborted: p.aborted ?? false,
    durationMs: 3,
  };
}

describe("shouldExecuteWorker / shouldRunOrchestrator", () => {
  it("worker executes only in build/workflow when available", () => {
    expect(shouldExecuteWorker("build", true)).toBe(true);
    expect(shouldExecuteWorker("plan", true)).toBe(false);
    expect(shouldExecuteWorker("build", false)).toBe(false);
  });

  it("orchestrator executes when available", () => {
    expect(shouldRunOrchestrator(true)).toBe(true);
    expect(shouldRunOrchestrator(false)).toBe(false);
  });
});

describe("parseUsageFromOutput", () => {
  it("extracts token usage from JSON output", () => {
    const usage = parseUsageFromOutput('noise\n{"usage":{"input_tokens":10,"output_tokens":20}}');
    expect(usage).toEqual({ tokens_in: 10, tokens_out: 20 });
  });

  it("returns zero usage when no usage JSON is present", () => {
    const usage = parseUsageFromOutput("just some text output");
    expect(usage).toEqual({ tokens_in: 0, tokens_out: 0 });
  });
});

describe("runOrchestratedLoop", () => {
  it("fails in build mode without spawning a plan when only the worker is missing", async () => {
    const calls: AdapterCommand[] = [];
    const execute = async (command: AdapterCommand, _options: ExecOptions): Promise<ExecResult> => {
      calls.push(command);
      return mkResult({ ok: true, stdout: '{"text":"plan"}' });
    };
    const result = await runOrchestratedLoop({
      task: "implement feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.roles.orchestrator.adapter = "grok";
        c.roles.worker.adapter = "codex";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute: execute as unknown as typeof import("../src/run/executor.js").executeCommand,
    });

    expect(result.status).toBe("failed");
    expect(calls.some((c) => c.step === "plan")).toBe(false);
  });

  it("fails when adapters are not installed", async () => {
    const result = await runOrchestratedLoop({
      task: "implement feature",
      config: cfg((c) => (c.ui.mode = "build")),
      cwd: process.cwd(),
      detections: NO_DETECTIONS,
      delay: NO_DELAY,
    });

    expect(result.status).toBe("failed");
    expect(result.executed).toBe(false);
    expect(result.events.some((e) => e.phase === "worker")).toBe(false);
  });

  it("plan mode runs orchestrator plan and skips worker execution", async () => {
    const { calls, execute } = recordingExecutor();
    const result = await runOrchestratedLoop({
      task: "plan only",
      config: cfg((c) => (c.ui.mode = "plan")),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
    });
    expect(result.summary.iterations).toBe(0);
    expect(result.events.some((e) => e.phase === "worker")).toBe(false);
    expect(calls.some((c) => c.step === "plan")).toBe(true);
    expect(calls.some((c) => c.phase === "worker")).toBe(false);
  });

  it("spawns the orchestrator (plan + review) AND the worker, recording each", async () => {
    const { calls, execute } = recordingExecutor();
    const updates: LoopUpdate[] = [];
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      repoStatus: NO_REPO_STATUS,
      onUpdate: (u) => updates.push(u),
    });

    expect(calls.some((c) => c.phase === "architect" && c.step === "plan")).toBe(true);
    expect(calls.some((c) => c.phase === "architect" && c.step === "review")).toBe(true);
    expect(calls.some((c) => c.phase === "worker" && c.step === "implement")).toBe(true);
    expect(calls.length).toBe(3);

    expect(result.executed).toBe(true);
    expect(result.usage.orchestrator.calls).toBe(2);
    expect(result.usage.worker.calls).toBe(1);
    expect(result.usage.worker.tokens_in).toBe(40);
    expect(result.usage.worker.tokens_out).toBe(60);
    expect(result.diff.changed).toBe(true);
    expect(result.summary.files_changed).toBe(1);
    expect(result.reviews.at(-1)?.verdict).toBe("pass");
    expect(result.status).toBe("completed");
    expect(updates.some((u) => u.type === "diff")).toBe(true);
    expect(updates.some((u) => u.type === "agent")).toBe(true);
  });

  it("fails a run when the estimated cost budget is exceeded", async () => {
    const { execute } = recordingExecutor();
    const updates: LoopUpdate[] = [];
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
        c.cost.session_budget_usd = 0.000001;
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      repoStatus: NO_REPO_STATUS,
      onUpdate: (u) => updates.push(u),
    });

    expect(result.status).toBe("failed");
    expect(result.cost.budget_exceeded).toBe(true);
    expect(updates.some((u) => u.error?.includes("cost budget exceeded"))).toBe(true);
  });

  it("injects real repository file CONTENTS into worker + orchestrator prompts", async () => {
    const { calls, execute } = recordingExecutor();
    const MARKER = "UNIQUE_CONTEXT_MARKER_42";
    await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      repoStatus: NO_REPO_STATUS,
      contextPack: {
        generated_at: "2026-06-12T00:00:00.000Z",
        max_tokens: 32000,
        total_tokens: 50,
        truncated: false,
        files: [{ path: "src/thing.ts", tokens: 50, content: `export const x = "${MARKER}";` }],
      },
    });

    const planCmd = calls.find((c) => c.step === "plan");
    const workerCmd = calls.find((c) => c.step === "implement");
    const planPrompt = planCmd?.argv.at(-1) ?? "";
    const workerPrompt = workerCmd?.argv.at(-1) ?? "";
    expect(planPrompt).toContain(MARKER);
    expect(workerPrompt).toContain(MARKER);
    expect(workerPrompt.toLowerCase()).toContain("orchestrator brief");
  });

  it("honors natural-language 'no loops' intent: orchestrator plans once, one worker pass, no review loop", async () => {
    const { calls, execute } = recordingExecutor();
    const updates: LoopUpdate[] = [];
    const result = await runOrchestratedLoop({
      task: "remove one of the two banner lines, no need of loops just fix and verify it",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.loop_policy = "auto";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      repoStatus: NO_REPO_STATUS,
      onUpdate: (u) => updates.push(u),
    });

    expect(updates.find((u) => u.type === "routing")?.strategy).toBe("direct");
    expect(result.reviews.length).toBe(0);
    expect(result.summary.iterations).toBe(1);
    expect(calls.filter((c) => c.phase === "worker").length).toBe(1);
    expect(calls.some((c) => c.step === "review")).toBe(false);
    expect(calls.some((c) => c.step === "plan")).toBe(true);
  });

  it("completes direct operational tasks without requiring file changes", async () => {
    const { execute } = recordingExecutor({ workerStdout: JSON.stringify({ text: "Published.", stopReason: "EndTurn" }) });
    const result = await runOrchestratedLoop({
      task: "publish the package now",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.loop_policy = "never";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: NO_DIFF,
      repoStatus: NO_REPO_STATUS,
    });
    expect(result.status).toBe("completed");
    expect(result.summary.iterations).toBe(1);
  });

  it("fails when worker emits cancelled then end_turn with exit 0", async () => {
    const calls: AdapterCommand[] = [];
    const execute = async (command: AdapterCommand, options: ExecOptions): Promise<ExecResult> => {
      calls.push(command);
      if (command.phase === "worker") {
        options.onLine?.("stdout", JSON.stringify({ stopReason: "Cancelled", text: "aborting" }));
        options.onLine?.("stdout", JSON.stringify({ stopReason: "end_turn", text: "done" }));
        return mkResult({ ok: true, stdout: "streamed" });
      }
      if (command.step === "review") {
        const review = JSON.stringify({
          schema_version: 1,
          iteration: 1,
          verdict: "pass",
          summary: "ok",
          findings: [],
          next_actions: [],
          token_budget_used: 1,
        });
        options.onLine?.("stdout", review);
        return mkResult({ ok: true, stdout: review });
      }
      const plan = JSON.stringify({ text: "Brief: publish." });
      options.onLine?.("stdout", plan);
      return mkResult({ ok: true, stdout: plan });
    };
    const result = await runOrchestratedLoop({
      task: "implement feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.loop_policy = "always";
        c.worker.max_iterations = 1;
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute: execute as unknown as typeof import("../src/run/executor.js").executeCommand,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      repoStatus: NO_REPO_STATUS,
    });
    expect(result.summary.worker_cancelled).toBe(true);
    expect(result.status).toBe("failed");
  });

  it("fails the run when the worker is cancelled even though it exits 0", async () => {
    const { execute } = recordingExecutor({ workerStopReason: "Cancelled", workerOk: true });
    const result = await runOrchestratedLoop({
      task: "publish the package now",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.loop_policy = "never";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: NO_DIFF,
      repoStatus: NO_REPO_STATUS,
    });
    expect(result.summary.worker_cancelled).toBe(true);
    expect(result.status).toBe("failed");
  });

  it("uses the orchestrator's own JSON review when it complies with the schema", async () => {
    const { execute } = recordingExecutor({
      reviewJson: () =>
        JSON.stringify({ schema_version: 1, iteration: 1, verdict: "revise", summary: "Try again", findings: [], next_actions: ["do x"], token_budget_used: 99 }) +
        "\n" +
        JSON.stringify({ schema_version: 1, iteration: 2, verdict: "pass", summary: "Done now", findings: [], next_actions: [], token_budget_used: 50 }),
    });
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      repoStatus: NO_REPO_STATUS,
    });
    expect(result.reviews.at(-1)?.summary).toBe("Done now");
  });

  it("continues iterating after a passing review when stop_on_first_pass is false", async () => {
    let reviewCalls = 0;
    const { calls, execute } = recordingExecutor({
      reviewJson: () => {
        reviewCalls += 1;
        return JSON.stringify({
          schema_version: 1,
          iteration: reviewCalls,
          verdict: "pass",
          summary: "Looks good",
          findings: [],
          next_actions: [],
          token_budget_used: 50,
        });
      },
    });
    const result = await runOrchestratedLoop({
      task: "implement feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 3;
        c.worker.stop_on_first_pass = false;
        c.worker.loop_policy = "always";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      repoStatus: NO_REPO_STATUS,
    });

    expect(result.summary.iterations).toBe(3);
    expect(calls.filter((c) => c.phase === "worker").length).toBe(3);
  });

  it("fails when the orchestrator exits non-zero even if stdout contains partial plan text", async () => {
    const calls: AdapterCommand[] = [];
    const execute = async (command: AdapterCommand, options: ExecOptions): Promise<ExecResult> => {
      calls.push(command);
      if (command.step === "plan") {
        options.onLine?.("stdout", '{"text":"partial plan"}');
        return mkResult({ ok: false, stdout: '{"text":"partial plan"}' });
      }
      return mkResult({ ok: true, stdout: "" });
    };
    const result = await runOrchestratedLoop({
      task: "implement feature",
      config: cfg((c) => (c.ui.mode = "build")),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute: execute as unknown as typeof import("../src/run/executor.js").executeCommand,
    });

    expect(result.status).toBe("failed");
    expect(calls.some((c) => c.phase === "worker")).toBe(false);
  });

  it("fails without running the worker when the orchestrator produces no plan", async () => {
    const calls: AdapterCommand[] = [];
    const execute = async (command: AdapterCommand, options: ExecOptions): Promise<ExecResult> => {
      calls.push(command);
      options.onLine?.("stdout", "");
      return mkResult({ ok: false, stdout: "" });
    };
    const result = await runOrchestratedLoop({
      task: "implement feature",
      config: cfg((c) => (c.ui.mode = "build")),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute: execute as unknown as typeof import("../src/run/executor.js").executeCommand,
    });

    expect(result.status).toBe("failed");
    expect(calls.some((c) => c.phase === "worker")).toBe(false);
  });

  it("fails loop-mode runs in a fresh git repo with no commits and no changes", async () => {
    const dir = await createTempDir("olap-fresh-git-");
    await runGit("git", ["init", "-b", "main"], { cwd: dir });
    const { execute } = recordingExecutor();
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
        c.validators = [];
      }),
      cwd: dir,
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: NO_DIFF,
    });
    expect(result.status).toBe("failed");
  });

  it("marks workflow runs failed when validators fail", async () => {
    const { execute } = recordingExecutor();
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "workflow";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
        c.validators = [{ name: "test", command: "false" }];
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      runValidatorsFn: async () => [
        { name: "test", command: "false", ok: false, exitCode: 1, stdout: "", stderr: "" },
      ],
    });
    expect(result.status).toBe("failed");
    expect(result.summary.validators_passed).toBe(false);
  });

  it("completes workflow runs when validators pass", async () => {
    const { execute } = recordingExecutor();
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "workflow";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
        c.validators = [{ name: "test", command: "true" }];
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
      runValidatorsFn: async () => [
        { name: "test", command: "true", ok: true, exitCode: 0, stdout: "", stderr: "" },
      ],
    });
    expect(result.status).toBe("completed");
    expect(result.summary.validators_passed).toBe(true);
  });

  it("accepts loop-mode runs when HEAD moves from empty repo to first commit", async () => {
    let headReads = 0;
    const { execute } = recordingExecutor();
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: NO_DIFF,
      getHead: async () => {
        headReads += 1;
        return headReads === 1 ? undefined : "first-commit-oid";
      },
    });
    expect(result.status).toBe("completed");
  });

  it("fails when require_valid_reviews is true and review JSON is missing", async () => {
    const calls: AdapterCommand[] = [];
    const execute = async (command: AdapterCommand, options: ExecOptions): Promise<ExecResult> => {
      calls.push(command);
      if (command.phase === "worker") {
        const stdout = JSON.stringify({
          text: "Edited.",
          stopReason: "EndTurn",
          usage: { input_tokens: 10, output_tokens: 20 },
        });
        options.onLine?.("stdout", stdout);
        return mkResult({ ok: true, stdout });
      }
      if (command.step === "review") {
        options.onLine?.("stdout", "not json at all");
        return mkResult({ ok: true, stdout: "not json at all" });
      }
      const plan = JSON.stringify({ text: "Brief: edit file." });
      options.onLine?.("stdout", plan);
      return mkResult({ ok: true, stdout: plan });
    };
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
        c.architect.require_valid_reviews = true;
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute: execute as unknown as typeof import("../src/run/executor.js").executeCommand,
      getRunDiff: async () => SOME_DIFF,
      getChangeSignature: changingSignature(),
    });
    expect(result.status).toBe("failed");
    expect(result.reviews.at(-1)?.verdict).toBe("fail");
  });

  it("fails loop-mode runs that complete with no file changes", async () => {
    const { execute } = recordingExecutor();
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: NO_DIFF,
      repoStatus: NO_REPO_STATUS,
    });

    expect(result.status).toBe("failed");
  });

  it("does not count pre-existing working-tree changes as run changes", async () => {
    const { execute } = recordingExecutor();
    const result = await runOrchestratedLoop({
      task: "implement the feature",
      config: cfg((c) => {
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
        c.worker.loop_policy = "always";
      }),
      cwd: process.cwd(),
      detections: GROK_DETECTED,
      delay: NO_DELAY,
      execute,
      getRunDiff: async () => SOME_DIFF,
      getHead: async () => "baseline",
      getChangeSignature: async () => "same-working-tree",
      repoStatus: NO_REPO_STATUS,
    });

    expect(result.status).toBe("failed");
  });
});

describe("shouldCompleteSession", () => {
  it("completes direct runs with no reviews when status is completed", () => {
    expect(shouldCompleteSession({ status: "completed", reviews: [] })).toBe(true);
  });

  it("completes when the last review passed", () => {
    expect(
      shouldCompleteSession({
        status: "completed",
        reviews: [{ verdict: "pass" } as never],
      }),
    ).toBe(true);
  });

  it("does not complete failed runs or revise verdicts", () => {
    expect(shouldCompleteSession({ status: "failed", reviews: [] })).toBe(false);
    expect(
      shouldCompleteSession({
        status: "completed",
        reviews: [{ verdict: "revise" } as never],
      }),
    ).toBe(false);
  });
});
