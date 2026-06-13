import { detectAdapters } from "../adapters/detect.js";
import { resolveConfigModels } from "../adapters/discover.js";
import { writeConfig } from "../config/write.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";

export async function initCommand(cwd = process.cwd()): Promise<string> {
  const detections = await detectAdapters();
  const { config, warnings } = await resolveConfigModels(structuredClone(DEFAULT_CONFIG), detections);
  for (const warning of warnings) {
    console.warn(`olap init: ${warning}`);
  }
  return writeConfig(cwd, config);
}