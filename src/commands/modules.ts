import { readConfig } from "../config/read.js";
import { listModules } from "../modules/registry.js";
import type { OlapModule } from "../types.js";

export async function modulesCommand(cwd = process.cwd()): Promise<OlapModule[]> {
  const config = await readConfig(cwd);
  return listModules(config);
}

export function printModules(modules: OlapModule[]): void {
  for (const module of modules) {
    const state = module.enabled ? "enabled" : "disabled";
    const pkg = module.package ? ` package=${module.package}` : "";
    const entry = module.entry ? ` entry=${module.entry}` : "";
    console.log(`${module.name} ${state} ${module.kind} source=${module.source}${pkg}${entry}`);
  }
}
