#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { initCommand } from "./commands/init.js";
import { adaptersCommand, printAdapters } from "./commands/adapters.js";
import { runCommand, printRunResult } from "./commands/run.js";
import { checkCommand, printCheckResults } from "./commands/check.js";
import { modulesCommand, printModules } from "./commands/modules.js";
import { startTui } from "./tui/app.js";
import { VERSION } from "./version.js";

export interface CliDependencies {
  startTui?: typeof startTui;
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
    .command("modules")
    .description("List built-in and configured Pi-compatible modules")
    .action(async () => {
      const modules = await modulesCommand();
      printModules(modules);
    });

  program
    .command("run")
    .description("Run simulated architect/worker loop for a task")
    .argument("<task>", "Task description")
    .action(async (task: string) => {
      const result = await runCommand(task);
      printRunResult(result);
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
    .description("Open Claude-like terminal UI")
    .action(async () => {
      await startTuiImpl();
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await createCliProgram().parseAsync(argv);
}

const isEntrypoint =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
