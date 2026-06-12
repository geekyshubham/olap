import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { CONFIG_FILENAME, DEFAULT_CONFIG } from "./defaults.js";
import type { OlapConfig } from "../types.js";

export function serializeConfig(config: OlapConfig = DEFAULT_CONFIG): string {
  return stringifyYaml(config, { lineWidth: 0 });
}

export async function writeConfig(
  cwd = process.cwd(),
  config: OlapConfig = DEFAULT_CONFIG,
): Promise<string> {
  const path = resolve(cwd, CONFIG_FILENAME);
  await writeFile(path, serializeConfig(config), "utf8");
  return path;
}