import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, beforeAll } from "vitest";
import { createTempDir, writeFakeBinary, writeFileInDir } from "./helpers.js";

const run = promisify(execFile);

const CLI = join(process.cwd(), "dist", "cli.js");

async function runCli(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await run("node", [CLI, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr), exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

function isolatedEnv(binDir: string): NodeJS.ProcessEnv {
  const nodeDir = dirname(process.execPath);
  return { PATH: `${binDir}:${nodeDir}:/usr/bin:/bin`, HOME: process.env.HOME };
}

async function setupE2eRepo(): Promise<{ dir: string; env: NodeJS.ProcessEnv }> {
  const dir = await createTempDir("olap-e2e-");
  const binDir = join(dir, "bin");
  await writeFakeBinary(binDir, "grok", await readFile(join(process.cwd(), "test/fixtures/fake-grok.sh"), "utf8"));
  const env = isolatedEnv(binDir);

  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "user.email", "e2e@example.com"]);
  await runGit(dir, ["config", "user.name", "E2E"]);
  await writeFileInDir(dir, "src/smoke.ts", "export const smoke = true;\n");
  await runGit(dir, ["add", "."]);
  await runGit(dir, ["commit", "-m", "init"]);

  const init = await runCli(["init"], { cwd: dir, env });
  expect(init.exitCode).toBe(0);

  return { dir, env };
}

async function setValidators(dir: string, command: string): Promise<void> {
  const { readConfig } = await import("../src/config/read.js");
  const { serializeConfig } = await import("../src/config/write.js");
  const { writeFile } = await import("node:fs/promises");
  const config = await readConfig(dir);
  config.validators = [{ name: "noop", command }];
  await writeFile(join(dir, "olap.config.yaml"), serializeConfig(config), "utf8");
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await run("git", args, { cwd });
}

beforeAll(async () => {
  await access(CLI);
});

describe("E2E CLI", () => {
  it("prints version and help", async () => {
    const version = await runCli(["--version"]);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);

    const help = await runCli(["--help"]);
    expect(help.stdout).toContain("init");
    expect(help.stdout).toContain("run");
    expect(help.stdout).toContain("check");
    expect(help.stdout).toContain("tui");
  });

  it("runs init, config, adapters, models, and modules in a fresh repo", { timeout: 15_000 }, async () => {
    const { dir, env } = await setupE2eRepo();

    const configText = await runCli(["config"], { cwd: dir, env });
    expect(configText.stdout).toContain("grok-composer-2.5-fast");
    expect(configText.stdout).toContain("mode");

    const adapters = await runCli(["adapters"], { cwd: dir, env });
    expect(adapters.stdout).toContain("grok: detected");

    const models = await runCli(["models"], { cwd: dir, env });
    expect(models.stdout).toContain("grok");

    const modules = await runCli(["modules"], { cwd: dir, env });
    expect(modules.exitCode).toBe(0);
  });

  it("completes plan mode without worker execution", async () => {
    const { dir, env } = await setupE2eRepo();
    const result = await runCli(["run", "preview the auth flow", "--mode", "plan", "--quiet"], {
      cwd: dir,
      env,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("completed");

    const runs = await readdir(join(dir, ".olap", "runs"));
    expect(runs.length).toBeGreaterThan(0);
    const runDir = join(dir, ".olap", "runs", runs[0]!);
    const files = await readdir(runDir);
    expect(files).toContain("task.md");
    expect(files).toContain("events.jsonl");
    expect(files).toContain("summary.json");
  });

  it("completes build mode with fake grok and writes diff artifacts", async () => {
    const { dir, env } = await setupE2eRepo();
    await writeFileInDir(dir, "src/smoke.ts", "export const smoke = false;\n");

    const result = await runCli(
      ["run", "just fix smoke.ts no loops", "--mode", "build", "--quiet"],
      { cwd: dir, env },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("completed");
    expect(result.stdout).toContain("Changes:");

    const runs = await readdir(join(dir, ".olap", "runs"));
    const latest = runs.sort().at(-1)!;
    const changes = JSON.parse(
      await readFile(join(dir, ".olap", "runs", latest, "changes.json"), "utf8"),
    ) as { changed: boolean };
    expect(changes.changed).toBe(true);
  });

  it("runs workflow mode with injected passing validators", async () => {
    const { dir, env } = await setupE2eRepo();
    await setValidators(dir, "true");
    await writeFileInDir(dir, "src/smoke.ts", "export const smoke = 2;\n");

    const result = await runCli(
      ["run", "update smoke.ts", "--mode", "workflow", "--quiet"],
      { cwd: dir, env },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("completed");
  });

  it("honors role overrides on the CLI", async () => {
    const { dir, env } = await setupE2eRepo();
    const result = await runCli(
      [
        "run",
        "plan only",
        "--mode",
        "plan",
        "--orchestrator",
        "grok:grok-build",
        "--quiet",
      ],
      { cwd: dir, env },
    );
    expect(result.exitCode).toBe(0);
    const runs = await readdir(join(dir, ".olap", "runs"));
    const commands = JSON.parse(
      await readFile(
        join(dir, ".olap", "runs", runs.sort().at(-1)!, "adapter-commands.json"),
        "utf8",
      ),
    ) as Array<{ argv: string[] }>;
    expect(commands.some((c) => c.argv.includes("grok-build"))).toBe(true);
  });

  it("fails clearly when adapters are missing", async () => {
    const dir = await createTempDir("olap-e2e-noadapter-");
    const nodeDir = dirname(process.execPath);
    const isolatedEnv = { PATH: `${nodeDir}:/usr/bin:/bin`, HOME: dir };
    await runCli(["init"], { cwd: dir, env: isolatedEnv });
    const result = await runCli(["run", "do work"], { cwd: dir, env: isolatedEnv });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/not installed|failed|Run .* failed/i);
  });

  it("runs olap check against configured validators", async () => {
    const { dir, env } = await setupE2eRepo();
    await setValidators(dir, "true");

    const check = await runCli(["check"], { cwd: dir, env });
    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain("[PASS]");
  });
});