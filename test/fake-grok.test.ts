import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createTempDir, writeFileInDir } from "./helpers.js";

const run = promisify(execFile);

const FIXTURE = join(process.cwd(), "test", "fixtures", "fake-grok.sh");

describe("fake grok fixture", () => {
  it("returns a brief for plan prompts that mention review loops", async () => {
    const prompt = [
      "You are the ORCHESTRATOR. Read the task and repository context.",
      "Keep scope tight so a worker iteration can complete and be reviewed.",
      "Produce a concise implementation brief for the WORKER.",
    ].join("\n");

    const { stdout } = await run("sh", [FIXTURE, "-p", prompt]);
    expect(stdout).toContain('"text":"Brief:');
    expect(stdout).not.toContain('"verdict":"pass"');
  });

  it("simulates a worker edit and returns implementation JSON", async () => {
    const dir = await createTempDir("olap-fake-grok-worker-");
    await writeFileInDir(dir, "src/smoke.ts", "export const smoke = true;\n");
    const prompt = [
      "You are the WORKER. Implement the orchestrator's brief in this repository.",
      "## Task",
      "fix smoke.ts",
      "## Orchestrator brief",
      "Brief: update smoke.ts and verify with tests.",
    ].join("\n");

    const { stdout } = await run("sh", [FIXTURE, "-p", prompt], { cwd: dir });
    expect(stdout).toContain('"text":"Implemented the change."');
    expect(stdout).not.toContain('"verdict"');

    const smoke = await readFile(join(dir, "src/smoke.ts"), "utf8");
    expect(smoke).toContain("false");
  });

  it("returns schema-valid review JSON for review prompts", async () => {
    const prompt = [
      "You are the ORCHESTRATOR reviewing the worker's latest result for this task.",
      "## Worker exit: ok",
      "Reviewing the worker output against the diff.",
    ].join("\n");

    const { stdout } = await run("sh", [FIXTURE, "-p", prompt]);
    const review = JSON.parse(stdout.trim()) as { verdict: string; schema_version: number };
    expect(review.verdict).toBe("pass");
    expect(review.schema_version).toBe(1);
  });
});
