#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { Command } from "commander";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initCommand } from "./commands/init.js";
import { adaptersCommand, printAdapters } from "./commands/adapters.js";
import { runCommand, printRunResult, type RunOptions } from "./commands/run.js";
import { checkCommand, printCheckResults } from "./commands/check.js";
import { modulesCommand, printModules } from "./commands/modules.js";
import { modelsCommand, printModels } from "./commands/models.js";
import { configCommand, printConfig } from "./commands/config.js";
import { printToolRunResult, runToolCommand, type ToolName } from "./commands/tools.js";
import { readConfig } from "./config/read.js";
import { startTui } from "./tui/app.js";
import { PACKAGE_NAME, VERSION } from "./version.js";
import { checkForUpdate, formatUpdateNotice } from "./update-check.js";

export interface CliDependencies {
  startTui?: typeof startTui;
  runToolCommand?: typeof runToolCommand;
}

interface RunCliOptions {
  cwd?: string;
  sessionId?: string;
  mode?: string;
  orchestrator?: string;
  worker?: string;
  theme?: string;
  quiet?: boolean;
}

function runCliAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await action(...args);
    } catch (error: unknown) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  };
}

export function createCliProgram(deps: CliDependencies = {}): Command {
  const startTuiImpl = deps.startTui ?? startTui;
  const runToolCommandImpl = deps.runToolCommand ?? runToolCommand;
  const program = new Command();

  program
    .name("olap")
    .description("OLAP orchestrated loop architect/worker CLI")
    .version(VERSION)
    .action(runCliAction(async () => {
      await startTuiImpl();
    }));

  program
    .command("init")
    .description("Write default olap.config.yaml")
    .action(runCliAction(async () => {
      const path = await initCommand();
      console.log(`Wrote ${path}`);
    }));

  program
    .command("adapters")
    .description("Detect grok, claude, gemini, codex, kiro, and ollama adapters on PATH")
    .action(runCliAction(async () => {
      const detections = await adaptersCommand();
      printAdapters(detections, await readConfig());
    }));

  program
    .command("models")
    .description("List known models per adapter and which roles use them")
    .action(runCliAction(async () => {
      const listings = await modelsCommand();
      printModels(listings);
    }));

  program
    .command("config")
    .description("Print the resolved OLAP configuration (roles, ui, access)")
    .action(runCliAction(async () => {
      const config = await configCommand();
      printConfig(config);
    }));

  program
    .command("modules")
    .description("List built-in and configured Pi-compatible modules")
    .action(runCliAction(async () => {
      const modules = await modulesCommand();
      printModules(modules);
    }));

  const addToolCommand = (name: ToolName, description: string): void => {
    program
      .command(name)
      .description(description)
      .allowUnknownOption(true)
      .argument("[args...]", `Arguments passed to ${name}`)
      .action(runCliAction(async (args: string[] = []) => {
        const result = await runToolCommandImpl(name, args, { cwd: process.cwd() });
        printToolRunResult(result);
        if (!result.ok) {
          process.exitCode = result.exitCode ?? 1;
        }
      }));
  };

  addToolCommand(
    "graphify",
    "Run Graphify for this project (defaults to `graphify .`)",
  );
  addToolCommand(
    "headroom",
    "Run Headroom helper commands (defaults to `headroom perf`)",
  );

  program
    .command("run")
    .description("Run the architect/worker loop for a task")
    .argument("<task>", "Task description")
    .option("--cwd <dir>", "Working directory for config, context pack, and git status")
    .option("--session-id <id>", "Resume or group runs under an existing session id")
    .option("--mode <mode>", "Operating mode: plan | build | workflow")
    .option("--orchestrator <adapter[:model]>", "Override orchestrator role")
    .option("--worker <adapter[:model]>", "Override worker role")
    .option("--theme <name>", "Theme to record for this run")
    .option("--quiet", "Suppress live event output")
    .action(runCliAction(async (task: string, options: RunCliOptions) => {
      const runOptions: RunOptions = {
        cwd: options.cwd,
        sessionId: options.sessionId,
        mode: options.mode,
        orchestrator: options.orchestrator,
        worker: options.worker,
        theme: options.theme,
        quiet: options.quiet,
      };
      const result = await runCommand(task, runOptions);
      printRunResult(result);
      if (result.status !== "completed") {
        process.exitCode = 1;
      }
    }));

  program
    .command("check")
    .description("Run validators from olap.config.yaml")
    .action(runCliAction(async () => {
      const results = await checkCommand();
      const ok = printCheckResults(results);
      if (!ok) {
        process.exitCode = 1;
      }
    }));

  program
    .command("tui")
    .description("Open the interactive terminal UI")
    .action(runCliAction(async () => {
      await startTuiImpl();
    }));

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await createCliProgram().parseAsync(argv);
  await notifyUpdateOnCli();
}

async function notifyUpdateOnCli(): Promise<void> {
  try {
    const info = await checkForUpdate({ current: VERSION, packageName: PACKAGE_NAME });
    if (info?.updateAvailable) {
      console.error(formatUpdateNotice(info, PACKAGE_NAME));
    }
  } catch {
    // Update checks must never fail a command.
  }
}

function isCliEntrypoint(): boolean {
  const executed = process.argv[1];
  if (executed === undefined) {
    return false;
  }

  const entrypoint = fileURLToPath(import.meta.url);
  try {
    return realpathSync(executed) === realpathSync(entrypoint);
  } catch {
    return pathToFileURL(executed).href === import.meta.url;
  }
}

if (isCliEntrypoint()) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
