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
import { startTui } from "./tui/app.js";
import { PACKAGE_NAME, VERSION } from "./version.js";
import { checkForUpdate, formatUpdateNotice } from "./update-check.js";

export interface CliDependencies {
  startTui?: typeof startTui;
}

interface RunCliOptions {
  mode?: string;
  orchestrator?: string;
  worker?: string;
  theme?: string;
  quiet?: boolean;
}

export function createCliProgram(deps: CliDependencies = {}): Command {
  const startTuiImpl = deps.startTui ?? startTui;
  const program = new Command();

  program
    .name("olap")
    .description("OLAP orchestrated loop architect/worker CLI")
    .version(VERSION)
    .action(async () => {
      await startTuiImpl();
    });

  program
    .command("init")
    .description("Write default olap.config.yaml")
    .action(async () => {
      const path = await initCommand();
      console.log(`Wrote ${path}`);
    });

  program
    .command("adapters")
    .description("Detect grok, claude, gemini, and codex adapters on PATH")
    .action(async () => {
      const detections = await adaptersCommand();
      printAdapters(detections);
    });

  program
    .command("models")
    .description("List known models per adapter and which roles use them")
    .action(async () => {
      const listings = await modelsCommand();
      printModels(listings);
    });

  program
    .command("config")
    .description("Print the resolved OLAP configuration (roles, ui, access, sub-agents)")
    .action(async () => {
      const config = await configCommand();
      printConfig(config);
    });

  program
    .command("modules")
    .description("List built-in and configured Pi-compatible modules")
    .action(async () => {
      const modules = await modulesCommand();
      printModules(modules);
    });

  program
    .command("run")
    .description("Run the architect/worker loop for a task")
    .argument("<task>", "Task description")
    .option("--mode <mode>", "Operating mode: plan | build | workflow")
    .option("--orchestrator <adapter[:model]>", "Override orchestrator role")
    .option("--worker <adapter[:model]>", "Override worker role")
    .option("--theme <name>", "Theme to record for this run")
    .option("--quiet", "Suppress live event output")
    .action(async (task: string, options: RunCliOptions) => {
      const runOptions: RunOptions = {
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
    });

  program
    .command("check")
    .description("Run validators from olap.config.yaml")
    .action(async () => {
      const results = await checkCommand();
      const ok = printCheckResults(results);
      if (!ok) {
        process.exitCode = 1;
      }
    });

  program
    .command("tui")
    .description("Open the interactive terminal UI")
    .action(async () => {
      await startTuiImpl();
    });

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
