import { resolve } from "node:path";

export const OLAP_DIR = ".olap";

export interface OlapPaths {
  root: string;
  tasks: string;
  agents: string;
  goals: string;
  messages: string;
  runs: string;
  workspaces: string;
  state: string;
  lock: string;
  skills: string;
}

export function olapPaths(cwd: string): OlapPaths {
  const root = resolve(cwd, OLAP_DIR);
  return {
    root,
    tasks: resolve(root, "tasks"),
    agents: resolve(root, "agents"),
    goals: resolve(root, "goals"),
    messages: resolve(root, "messages"),
    runs: resolve(root, "runs"),
    workspaces: resolve(root, "workspaces"),
    state: resolve(root, "state.json"),
    lock: resolve(root, "olap.lock"),
    skills: resolve(root, "skills"),
  };
}