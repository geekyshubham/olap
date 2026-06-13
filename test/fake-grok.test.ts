import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe("fake grok fixture", () => {
  it("returns a brief for plan prompts that mention review loops", async () => {
    const fixture = join(process.cwd(), "test", "fixtures", "fake-grok.sh");
    const prompt = [
      "You are the ORCHESTRATOR. Read the task and repository context.",
      "Keep scope tight so a worker iteration can complete and be reviewed.",
      "Produce a concise implementation brief for the WORKER.",
    ].join("\n");

    const { stdout } = await run("sh", [fixture, "-p", prompt]);
    expect(stdout).toContain('"text":"Brief:');
    expect(stdout).not.toContain('"verdict":"pass"');
  });
});
