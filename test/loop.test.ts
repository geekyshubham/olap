import { describe, expect, it } from "vitest";
import {
  parseUsageFromOutput,
  runOrchestratedLoop,
  shouldExecuteLive,
  type LoopUpdate,
} from "../src/run/loop.js";
import type { ExecResult } from "../src/run/executor.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import type { AdapterDetection, OlapConfig } from "../src/types.js";

const NO_DELAY = () => Promise.resolve();
const NO_DETECTIONS: AdapterDetection[] = [
  { id: "grok", detected: false },
  { id: "claude", detected: false },
  { id: "gemini", detected: false },
  { id: "codex", detected: false },
];

function cfg(patch: (c: OlapConfig) => void): OlapConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  patch(config);
  return config;
}

describe("shouldExecuteLive", () => {
  it("only executes live when allowed, configured, and worker available", () => {
    const live = cfg((c) => (c.access.execution = "live"));
    expect(shouldExecuteLive(live, "build", true)).toBe(true);
    expect(shouldExecuteLive(live, "plan", true)).toBe(false);
    expect(shouldExecuteLive(live, "build", false)).toBe(false);
    expect(shouldExecuteLive(DEFAULT_CONFIG, "build", true)).toBe(false);
  });
});

describe("parseUsageFromOutput", () => {
  it("extracts token usage from JSON output", () => {
    const usage = parseUsageFromOutput('noise\n{"usage":{"input_tokens":10,"output_tokens":20}}');
    expect(usage).toEqual({ tokens_in: 10, tokens_out: 20 });
  });

  it("falls back to an estimate when no usage is present", () => {
    const usage = parseUsageFromOutput("just some text output");
    expect(usage.tokens_in).toBeGreaterThan(0);
    expect(usage.tokens_out).toBeGreaterThan(0);
  });
});

describe("runOrchestratedLoop (dry-run)", () => {
  it("emits phases, events, reviews, and tracks usage + sub-agents", async () => {
    const updates: LoopUpdate[] = [];
    const result = await runOrchestratedLoop({
      task: "implement feature",
      config: cfg((c) => (c.ui.mode = "build")),
      cwd: process.cwd(),
      detections: NO_DETECTIONS,
      delay: NO_DELAY,
      now: () => new Date("2026-06-12T10:00:00.000Z"),
      onUpdate: (u) => updates.push(u),
    });

    expect(result.status).toBe("completed");
    expect(result.executed).toBe(false);
    expect(result.events[0].phase).toBe("architect");
    expect(result.events.some((e) => e.phase === "worker")).toBe(true);
    expect(result.reviews.length).toBe(DEFAULT_CONFIG.worker.max_iterations);
    expect(result.usage.worker.calls).toBe(DEFAULT_CONFIG.worker.max_iterations);
    expect(result.usage.orchestrator.calls).toBeGreaterThan(1);
    expect(result.usage.subagents_spawned).toBe(DEFAULT_CONFIG.worker.max_iterations);

    const types = updates.map((u) => u.type);
    expect(types).toContain("phase");
    expect(types).toContain("event");
    expect(types).toContain("review");
    expect(types).toContain("usage");
    expect(types.at(-1)).toBe("final");
  });

  it("plan mode skips worker execution", async () => {
    const result = await runOrchestratedLoop({
      task: "plan only",
      config: cfg((c) => (c.ui.mode = "plan")),
      cwd: process.cwd(),
      detections: NO_DETECTIONS,
      delay: NO_DELAY,
    });
    expect(result.summary.iterations).toBe(0);
    expect(result.events.some((e) => e.phase === "worker")).toBe(false);
  });
});

describe("runOrchestratedLoop (live)", () => {
  it("spawns the worker via the injected executor and records its usage", async () => {
    const detections: AdapterDetection[] = [
      { id: "grok", detected: true, binary: "/bin/grok" },
      { id: "claude", detected: false },
      { id: "gemini", detected: false },
      { id: "codex", detected: false },
    ];
    let executed = 0;
    const fakeExecute = async (
      _command: unknown,
      options: { onLine?: (s: "stdout" | "stderr", l: string) => void },
    ): Promise<ExecResult> => {
      executed += 1;
      options.onLine?.("stdout", "applying patch...");
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        stdout: '{"usage":{"input_tokens":40,"output_tokens":60}}',
        stderr: "",
        timedOut: false,
        durationMs: 5,
      };
    };

    const updates: LoopUpdate[] = [];
    const result = await runOrchestratedLoop({
      task: "do work",
      config: cfg((c) => {
        c.access.execution = "live";
        c.ui.mode = "build";
        c.worker.max_iterations = 1;
      }),
      cwd: process.cwd(),
      detections,
      delay: NO_DELAY,
      execute: fakeExecute as never,
      onUpdate: (u) => updates.push(u),
    });

    expect(executed).toBe(1);
    expect(result.executed).toBe(true);
    expect(result.usage.worker.tokens_in).toBe(40);
    expect(result.usage.worker.tokens_out).toBe(60);
    expect(updates.some((u) => u.type === "output")).toBe(true);
  });
});
