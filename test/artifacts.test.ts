import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { createRunId, writeRunArtifacts } from "../src/run/artifacts.js";
import { runOrchestratedLoop } from "../src/run/loop.js";
import type { AdapterCommand, AdapterDetection } from "../src/types.js";
import type { ExecOptions, ExecResult } from "../src/run/executor.js";
import { createTempDir } from "./helpers.js";

const GROK_DETECTED: AdapterDetection[] = [
  { id: "grok", detected: true, binary: "/bin/grok" },
  { id: "claude", detected: false },
  { id: "gemini", detected: false },
  { id: "codex", detected: false },
];

describe("artifacts", () => {
  it("writes task, config snapshot, events.jsonl, and final-report.md", async () => {
    const cwd = await createTempDir();
    const runId = createRunId(new Date("2026-06-12T10:00:00.000Z"));
    const task = "Build OLAP CLI";
    const config = { ...DEFAULT_CONFIG, ui: { ...DEFAULT_CONFIG.ui, mode: "plan" as const } };
    const execute = async (command: AdapterCommand, options: ExecOptions): Promise<ExecResult> => {
      const stdout =
        command.step === "plan"
          ? JSON.stringify({ text: "Plan the CLI." })
          : JSON.stringify({ text: "Implemented.", usage: { input_tokens: 10, output_tokens: 20 } });
      options.onLine?.("stdout", stdout);
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        stdout,
        stderr: "",
        timedOut: false,
        aborted: false,
        durationMs: 3,
      };
    };

    const { events, report } = await runOrchestratedLoop({
      task,
      config,
      cwd,
      detections: GROK_DETECTED,
      delay: () => Promise.resolve(),
      execute: execute as unknown as typeof import("../src/run/executor.js").executeCommand,
      runId,
      now: () => new Date("2026-06-12T10:00:00.000Z"),
    });

    const dir = await writeRunArtifacts({
      cwd,
      runId,
      task,
      config,
      events,
      report,
    });

    const files = (await readdir(dir)).sort();
    expect(files).toEqual([
      "config-snapshot.yaml",
      "events.jsonl",
      "final-report.md",
      "task.md",
    ]);

    const taskText = await readFile(join(dir, "task.md"), "utf8");
    expect(taskText.trim()).toBe(task);

    const eventsText = await readFile(join(dir, "events.jsonl"), "utf8");
    const lines = eventsText.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    const first = JSON.parse(lines[0]) as { phase: string };
    expect(first.phase).toBe("architect");

    const reportText = await readFile(join(dir, "final-report.md"), "utf8");
    expect(reportText).toContain("Run Summary");
    expect(reportText).toContain("orchestrator and/or worker CLI processes finished successfully");

    const configSnapshot = await readFile(join(dir, "config-snapshot.yaml"), "utf8");
    expect(configSnapshot).toContain("mode: plan");
  });

  it("writes optional CLI artifacts when provided", async () => {
    const cwd = await createTempDir();
    const runId = createRunId(new Date("2026-06-12T10:00:00.000Z"));
    const summary = {
      run_id: runId,
      session_id: "sess-1",
      adapter: "grok",
      iterations: 1,
      reviews_valid: 1,
      context_pack_tokens: 0,
      cwd,
      executed: true,
      files_changed: 1,
      worker_cancelled: false,
      cost: {
        estimated_usd: 0,
        budget_usd: 0,
        budget_exceeded: false,
      },
    };

    const dir = await writeRunArtifacts({
      cwd,
      runId,
      task: "Ship feature",
      config: DEFAULT_CONFIG,
      events: [],
      report: "# Report\n",
      brief: "Edit the module.",
      reviews: [
        {
          schema_version: 1,
          iteration: 1,
          verdict: "pass",
          summary: "Looks good.",
          findings: [{ severity: "info", message: "ok" }],
          next_actions: [],
          token_budget_used: 12,
        },
      ],
      adapterCommands: [
        {
          phase: "worker",
          step: "implement",
          executed: true,
          argv: ["grok", "-p", "prompt"],
        },
      ],
      summary,
      diff: {
        changed: true,
        files: [{ path: "src/a.ts", insertions: 1, deletions: 0, binary: false }],
        insertions: 1,
        deletions: 0,
      },
    });

    const files = (await readdir(dir)).sort();
    expect(files).toEqual([
      "adapter-commands.json",
      "architect-reviews.jsonl",
      "brief.md",
      "changes.json",
      "config-snapshot.yaml",
      "events.jsonl",
      "final-report.md",
      "summary.json",
      "task.md",
    ]);
  });
});