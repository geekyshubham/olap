import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { CONFIG_FILENAME, DEFAULT_CONFIG } from "./defaults.js";
import type { AdapterId, OlapConfig } from "../types.js";

function mergeAdapterOptions(
  partial: Partial<OlapConfig["adapters"]> | undefined,
): OlapConfig["adapters"] {
  const base = DEFAULT_CONFIG.adapters;
  const options = { ...base.options };
  if (partial?.options) {
    for (const id of Object.keys(partial.options) as AdapterId[]) {
      options[id] = {
        ...base.options[id],
        ...partial.options[id],
        extra_args: partial.options[id]?.extra_args ?? base.options[id]?.extra_args ?? [],
      };
    }
  }
  return {
    preferred: partial?.preferred ?? base.preferred,
    fallback: partial?.fallback ?? base.fallback,
    options,
  };
}

export function mergeConfig(partial: Partial<OlapConfig>): OlapConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    adapters: mergeAdapterOptions(partial.adapters),
    architect: { ...DEFAULT_CONFIG.architect, ...partial.architect },
    worker: { ...DEFAULT_CONFIG.worker, ...partial.worker },
    modules: partial.modules ?? DEFAULT_CONFIG.modules,
    validators: partial.validators ?? DEFAULT_CONFIG.validators,
  };
}

export function parseConfigText(text: string): OlapConfig {
  const parsed = parseYaml(text) as Partial<OlapConfig> | null;
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_CONFIG };
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
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}
