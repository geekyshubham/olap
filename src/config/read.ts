import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { CONFIG_FILENAME, DEFAULT_CONFIG } from "./defaults.js";
import type { AdapterCapabilityProfile, AdapterId, OlapConfig, RoleId } from "../types.js";

function mergeAdapterOptions(
  partial: Partial<OlapConfig["adapters"]> | undefined,
): OlapConfig["adapters"] {
  const base = DEFAULT_CONFIG.adapters;
  const options = { ...base.options };
  const capabilities = { ...base.capabilities };
  if (partial?.options) {
    for (const id of Object.keys(partial.options) as AdapterId[]) {
      const extraArgs = partial.options[id]?.extra_args ?? base.options[id]?.extra_args ?? [];
      options[id] = {
        ...base.options[id],
        ...partial.options[id],
        extra_args: [...extraArgs],
      };
    }
  }
  if (partial?.capabilities) {
    for (const id of Object.keys(partial.capabilities) as AdapterId[]) {
      const baseProfile = base.capabilities[id];
      const patch = partial.capabilities[id];
      if (!baseProfile || !patch) continue;
      const merged: AdapterCapabilityProfile = { ...baseProfile, ...patch };
      capabilities[id] = merged;
    }
  }
  return {
    preferred: partial?.preferred ?? base.preferred,
    fallback: partial?.fallback ?? base.fallback,
    options,
    capabilities,
  };
}

function mergeRoles(partial: Partial<OlapConfig["roles"]> | undefined): OlapConfig["roles"] {
  const base = DEFAULT_CONFIG.roles;
  const roles = { ...base };
  for (const role of Object.keys(base) as RoleId[]) {
    roles[role] = { ...base[role], ...partial?.[role] };
  }
  return roles;
}

function mergeCost(partial: Partial<OlapConfig["cost"]> | undefined): OlapConfig["cost"] {
  const base = DEFAULT_CONFIG.cost;
  const prices = structuredClone(base.prices_per_million_tokens);
  if (partial?.prices_per_million_tokens) {
    for (const id of Object.keys(partial.prices_per_million_tokens) as AdapterId[]) {
      prices[id] = {
        ...(prices[id] ?? {}),
        ...partial.prices_per_million_tokens[id],
      };
    }
  }
  return {
    ...base,
    ...partial,
    prices_per_million_tokens: prices,
  };
}

/** Warnings for deprecated config keys stripped during merge. */
export function collectLegacyConfigWarnings(partial: Partial<OlapConfig>): string[] {
  const warnings: string[] = [];
  const access = partial.access as Record<string, unknown> | undefined;
  if (access && access.execution !== undefined) {
    warnings.push(
      "access.execution is ignored — OLAP always spawns live CLIs. Remove it from olap.config.yaml.",
    );
  }
  const worker = partial.worker as Record<string, unknown> | undefined;
  if (worker && worker.dry_run !== undefined) {
    warnings.push(
      "worker.dry_run is ignored — OLAP always spawns live CLIs. Remove it from olap.config.yaml.",
    );
  }
  return warnings;
}

function stripLegacyConfig(partial: Partial<OlapConfig>): Partial<OlapConfig> {
  const access = partial.access ? { ...partial.access } : undefined;
  if (access) {
    delete (access as Record<string, unknown>).execution;
  }
  const worker = partial.worker ? { ...partial.worker } : undefined;
  if (worker) {
    delete (worker as Record<string, unknown>).dry_run;
  }
  return { ...partial, access, worker };
}

/** Deep copy so callers can mutate config without aliasing DEFAULT_CONFIG. */
export function cloneConfig(config: OlapConfig = DEFAULT_CONFIG): OlapConfig {
  return structuredClone(config);
}

export function mergeConfig(partial: Partial<OlapConfig>): OlapConfig {
  const cleaned = stripLegacyConfig(partial);
  return cloneConfig({
    ...DEFAULT_CONFIG,
    ...cleaned,
    adapters: mergeAdapterOptions(cleaned.adapters),
    roles: mergeRoles(cleaned.roles),
    ui: { ...DEFAULT_CONFIG.ui, ...cleaned.ui },
    access: { ...DEFAULT_CONFIG.access, ...cleaned.access },
    subagents: { ...DEFAULT_CONFIG.subagents, ...cleaned.subagents },
    architect: { ...DEFAULT_CONFIG.architect, ...cleaned.architect },
    worker: { ...DEFAULT_CONFIG.worker, ...cleaned.worker },
    cost: mergeCost(cleaned.cost),
    modules: cleaned.modules
      ? structuredClone(cleaned.modules)
      : structuredClone(DEFAULT_CONFIG.modules),
    validators: cleaned.validators
      ? structuredClone(cleaned.validators)
      : structuredClone(DEFAULT_CONFIG.validators),
  });
}

export function parseConfigText(text: string): OlapConfig {
  const parsed = parseYaml(text) as Partial<OlapConfig> | null;
  if (!parsed || typeof parsed !== "object") {
    return cloneConfig();
  }
  for (const warning of collectLegacyConfigWarnings(parsed)) {
    console.warn(`olap config: ${warning}`);
  }
  return mergeConfig(parsed);
}

export async function readConfig(cwd = process.cwd()): Promise<OlapConfig> {
  const path = resolve(cwd, CONFIG_FILENAME);
  try {
    const text = await readFile(path, "utf8");
    return parseConfigText(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return cloneConfig();
    }
    throw error;
  }
}
