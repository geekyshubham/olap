import { resolve } from "node:path";
import { readConfig } from "../config/read.js";
import { CONFIG_FILENAME } from "../config/defaults.js";
import type { OlapConfig } from "../types.js";

export async function configCommand(cwd = process.cwd()): Promise<OlapConfig> {
  return readConfig(cwd);
}

export function printConfig(config: OlapConfig, cwd = process.cwd()): void {
  console.log(`Config: ${resolve(cwd, CONFIG_FILENAME)}`);
  console.log("");
  console.log("Roles");
  console.log(`  orchestrator  ${config.roles.orchestrator.adapter}:${config.roles.orchestrator.model}`);
  console.log(`  worker        ${config.roles.worker.adapter}:${config.roles.worker.model}`);
  console.log("");
  console.log("UI");
  console.log(`  theme   ${config.ui.theme}`);
  console.log(`  mode    ${config.ui.mode}`);
  console.log(`  banner  ${config.ui.banner}`);
  console.log("");
  console.log("Access");
  console.log(`  approval   ${config.access.approval}`);
  console.log(`  sandbox    ${config.access.sandbox}`);
  console.log(`  network    ${config.access.network}`);
  console.log("");
  console.log("Sub-agents");
  console.log(`  enabled       ${config.subagents.enabled}`);
  console.log(`  max_parallel  ${config.subagents.max_parallel}`);
  console.log("");
  console.log("Loop");
  console.log(`  max_iterations           ${config.worker.max_iterations}`);
  console.log(`  loop_policy              ${config.worker.loop_policy}`);
  console.log(`  worker_timeout_ms        ${config.worker.iteration_timeout_ms}`);
  console.log(`  orchestrator_timeout_ms  ${config.architect.iteration_timeout_ms}`);
  console.log(`  context_max              ${config.architect.context_pack_max_tokens}`);
  console.log(`  output_budget            ${config.architect.output_budget_tokens}`);
}
