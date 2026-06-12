import type { OlapConfig, OlapModule } from "../types.js";

export const BUILT_IN_PI_MODULES: OlapModule[] = [
  {
    name: "pi-tui",
    kind: "pi-package",
    enabled: true,
    package: "@earendil-works/pi-tui",
    entry: "dist/index.js",
    description: "Pi terminal UI renderer used by OLAP's Claude-like TUI.",
    source: "built-in",
  },
];

export function listModules(config: OlapConfig): OlapModule[] {
  const configured = config.modules.map((module) => ({
    ...module,
    source: "config" as const,
  }));
  return [...BUILT_IN_PI_MODULES, ...configured];
}

export function enabledModules(config: OlapConfig): OlapModule[] {
  return listModules(config).filter((module) => module.enabled);
}
