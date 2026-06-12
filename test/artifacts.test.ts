import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { createRunId, writeRunArtifacts } from "../src/run/artifacts.js";
import { simulateArchitectWorkerLoop } from "../src/run/simulator.js";
import { createTempDir } from "./helpers.js";

describe("artifacts", () => {
  it("writes task, config snapshot, events.jsonl, and final-report.md", async () => {
    const cwd = await createTempDir();
    const runId = createRunId(new Date("2026-06-12T10:00:00.000Z"));
    const task = "Build OLAP CLI";
    const { events, report } = simulateArchitectWorkerLoop(task, DEFAULT_CONFIG);

    const dir = await writeRunArtifacts({
      cwd,
      runId,
      task,
      config: DEFAULT_CONFIG,
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
    expect(reportText).toContain("Architect / Worker Summary");
    expect(reportText).toContain("Simulated run completed");
  });
});