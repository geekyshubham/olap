import { describe, expect, it } from "vitest";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executeCommand } from "../src/run/executor.js";
import type { AdapterCommand } from "../src/types.js";
import { createTempDir } from "./helpers.js";

async function writeScript(dir: string, name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body, "utf8");
  await chmod(path, 0o755);
  return path;
}

function command(binary: string, args: string[]): AdapterCommand {
  return {
    adapter: "grok",
    binary,
    argv: [binary, ...args],
    shell: "",
    dry_run: false,
    phase: "worker",
  };
}

describe("executeCommand", () => {
  it("streams stdout lines and reports success", async () => {
    const dir = await createTempDir("olap-exec-");
    const script = await writeScript(dir, "echoer.sh", "#!/bin/sh\necho line-one\necho line-two\n");

    const lines: string[] = [];
    const result = await executeCommand(command(script, []), {
      cwd: dir,
      onLine: (stream, line) => {
        if (stream === "stdout") lines.push(line);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(lines).toEqual(["line-one", "line-two"]);
    expect(result.stdout).toContain("line-one");
  });

  it("reports failure for non-zero exit codes", async () => {
    const dir = await createTempDir("olap-exec-");
    const script = await writeScript(dir, "fail.sh", "#!/bin/sh\necho oops 1>&2\nexit 3\n");

    const errs: string[] = [];
    const result = await executeCommand(command(script, []), {
      cwd: dir,
      onLine: (stream, line) => {
        if (stream === "stderr") errs.push(line);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(errs.join("\n")).toContain("oops");
  });
});
