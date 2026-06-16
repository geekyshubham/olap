import { execFile } from "node:child_process";
import type { AdapterDetection, AdapterId, OlapConfig, RoleId } from "../types.js";
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

/** Parse `opencode models` output (`provider/model` per line). */
export function parseOpencodeModels(output: string): DiscoveredModels {
  const models: string[] = [];
  const details: Record<string, { description?: string }> = {};
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("Model")) continue;
    const id = line.split(/\s+/)[0];
    if (!id?.includes("/") || models.includes(id)) continue;
    models.push(id);
    details[id] = { description: "Reported by opencode models" };
  }
  return { models, details };
}

/** Parse `openrouter models --non-interactive` table output. */
export function parseOpenrouterModels(output: string): DiscoveredModels {
  const models: string[] = [];
  const details: Record<string, { description?: string }> = {};
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("┌") || line.startsWith("├") || line.startsWith("└")) continue;
    const cells = line
      .split(/[|│]/)
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2 || cells[0] === "ID") continue;
    const id = cells[0];
    if (!id || models.includes(id)) continue;
    models.push(id);
    details[id] = { description: cells[1] };
  }
  return { models, details };
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
  opencode: { args: ["models"], parse: parseOpencodeModels },
  openrouter: { args: ["models", "--non-interactive"], parse: parseOpenrouterModels },
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

/** Pick the best available model id for a role from a discovered list. */
export function pickDiscoveredModel(
  adapter: AdapterId,
  role: RoleId,
  discovered: DiscoveredModels,
): string {
  const available = new Set(discovered.models);
  if (discovered.default && available.has(discovered.default)) {
    return discovered.default;
  }
  for (const info of modelsForRole(adapter, role)) {
    if (available.has(info.id)) return info.id;
  }
  return discovered.models[0] ?? "";
}

export interface ModelResolution {
  config: OlapConfig;
  warnings: string[];
}

/**
 * Ensure each role's model exists on the installed adapter CLI.
 * Falls back to the CLI default or the first catalog match when the configured id is missing.
 */
export async function resolveConfigModels(
  config: OlapConfig,
  detections: AdapterDetection[],
  options: { timeoutMs?: number; exec?: ModelExec } = {},
): Promise<ModelResolution> {
  const out = structuredClone(config);
  const warnings: string[] = [];
  for (const role of ["orchestrator", "worker"] as RoleId[]) {
    const adapter = out.roles[role].adapter;
    const detection = detections.find((d) => d.id === adapter);
    if (!detection?.detected || !detection.binary || !canDiscover(adapter)) continue;
    const discovered = await discoverModels(adapter, detection.binary, options);
    if (!discovered?.models.length) continue;
    const configured = out.roles[role].model?.trim();
    if (configured && discovered.models.includes(configured)) continue;
    const fallback = pickDiscoveredModel(adapter, role, discovered);
    if (!fallback) continue;
    if (configured) {
      warnings.push(
        `roles.${role}.model "${configured}" is not available on ${adapter}; using "${fallback}".`,
      );
    }
    out.roles[role].model = fallback;
  }
  return { config: out, warnings };
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
