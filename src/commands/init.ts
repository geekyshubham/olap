import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { detectAdapters } from "../adapters/detect.js";
import { resolveConfigModels } from "../adapters/discover.js";
import { CONFIG_FILENAME } from "../config/defaults.js";
import { cloneConfig } from "../config/read.js";
import { writeConfig } from "../config/write.js";

export async function initCommand(cwd = process.cwd()): Promise<string> {
  const path = resolve(cwd, CONFIG_FILENAME);
  try {
    await access(path);
    console.warn(`olap init: ${CONFIG_FILENAME} already exists — not overwriting`);
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const detections = await detectAdapters();
  const { config, warnings } = await resolveConfigModels(cloneConfig(), detections);
  for (const warning of warnings) {
    console.warn(`olap init: ${warning}`);
  }
  return writeConfig(cwd, config);
}