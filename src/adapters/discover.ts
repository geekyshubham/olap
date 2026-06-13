import { execFile } from "node:child_process";
import type { AdapterDetection, AdapterId, RoleId } from "../types.js";
import { findModel, modelsForRole, type ModelInfo } from "./models.js";

export interface DiscoveredModels {
  models: string[];
  default?: string;
  /** Optional per-model metadata (e.g. descriptions reported by the CLI). */
  details?: Record<string, { description?: string }>;
}

export type ModelExec = (
  binary: string,
  args: string[],
  timeoutMs: number,
) => Promise<string | undefined>;

/** Parse `grok models` output (lines marked with `-`/`*`, plus a "Default model:" line). */
export function parseGrokModels(output: string): DiscoveredModels {
  const models: string[] = [];
  let def: string | undefined;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const marked = line.match(/^[-*]\s+(\S+)/);
    if (marked) {
      const id = marked[1];
      if (!models.includes(id)) models.push(id);
      if (line.startsWith("*") || /\(default\)/i.test(line)) def = id;
      continue;
    }
    const defaultLine = line.match(/^Default model:\s*(\S+)/i);
    if (defaultLine) def = defaultLine[1];
  }
  return { models, default: def };
}

/** Parse `kiro-cli chat --list-models --format json` output. */
export function parseKiroModels(output: string): DiscoveredModels {
  try {
    const data = JSON.parse(output) as {
      models?: Array<{ model_id?: string; model_name?: string; description?: string }>;
      default_model?: string;
    };
    const models: string[] = [];
    const details: Record<string, { description?: string }> = {};
    for (const entry of data.models ?? []) {
      const id = entry.model_id ?? entry.model_name;
      if (!id || models.includes(id)) continue;
      models.push(id);
      details[id] = { description: entry.description };
    }
    return { models, default: data.default_model, details };
  } catch {
    return { models: [] };
  }
}

/** Adapters whose CLIs can enumerate models, and how to parse them. */
const LIST_COMMANDS: Partial<
  Record<AdapterId, { args: string[]; parse: (output: string) => DiscoveredModels }>
> = {
  grok: { args: ["models"], parse: parseGrokModels },
  kiro: { args: ["chat", "--list-models", "--format", "json"], parse: parseKiroModels },
};

const defaultExec: ModelExec = (binary, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? undefined : stdout.toString()),
    );
  });

/** Returns true when OLAP knows how to ask this adapter's CLI for its models. */
export function canDiscover(adapter: AdapterId): boolean {
  return LIST_COMMANDS[adapter] !== undefined;
}

export async function discoverModels(
  adapter: AdapterId,
  binary: string,
  options: { timeoutMs?: number; exec?: ModelExec } = {},
): Promise<DiscoveredModels | undefined> {
  const spec = LIST_COMMANDS[adapter];
  if (!spec) return undefined;
  const exec = options.exec ?? defaultExec;
  const output = await exec(binary, spec.args, options.timeoutMs ?? 6000);
  if (output === undefined) return undefined;
  const parsed = spec.parse(output);
  return parsed.models.length > 0 ? parsed : undefined;
}

/** Turn discovered model ids into ModelInfo, reusing catalog descriptions where known. */
export function toModelInfos(adapter: AdapterId, discovered: DiscoveredModels): ModelInfo[] {
  const ordered = [...discovered.models];
  if (discovered.default) {
    ordered.sort((a, b) => (a === discovered.default ? -1 : b === discovered.default ? 1 : 0));
  }
  return ordered.map((id) => {
    const known = findModel(adapter, id);
    const detail = discovered.details?.[id];
    const isDefault = id === discovered.default;
    const description = detail?.description ?? known?.description ?? "Reported by the CLI";
    return {
      id,
      label: known?.label ?? id,
      description: `${description}${isDefault ? " (default)" : ""}`,
      goodFor: known?.goodFor ?? ["orchestrator", "worker"],
    };
  });
}

// ---- module cache (populated by the TUI/commands after discovery) ----
const cache = new Map<AdapterId, ModelInfo[]>();

export function setDiscoveredModels(adapter: AdapterId, models: ModelInfo[]): void {
  cache.set(adapter, models);
}

export function getDiscoveredModels(adapter: AdapterId): ModelInfo[] | undefined {
  return cache.get(adapter);
}

export function clearModelCache(): void {
  cache.clear();
}

/** Cache-aware model list for a role: discovered models first, else the static catalog. */
export function resolveModelsForRole(adapter: AdapterId, role: RoleId): ModelInfo[] {
  const discovered = cache.get(adapter);
  if (discovered && discovered.length > 0) return discovered;
  return modelsForRole(adapter, role);
}

/** Discover + cache models for an adapter; returns the resolved list. */
export async function loadModels(
  adapter: AdapterId,
  detection: AdapterDetection | undefined,
  options: { timeoutMs?: number; exec?: ModelExec } = {},
): Promise<ModelInfo[]> {
  if (detection?.detected && detection.binary) {
    const discovered = await discoverModels(adapter, detection.binary, options);
    if (discovered) {
      const infos = toModelInfos(adapter, discovered);
      cache.set(adapter, infos);
      return infos;
    }
  }
  return modelsForRole(adapter, "worker");
}
