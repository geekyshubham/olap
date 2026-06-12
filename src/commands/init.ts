import { writeConfig } from "../config/write.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";

export async function initCommand(cwd = process.cwd()): Promise<string> {
  return writeConfig(cwd, DEFAULT_CONFIG);
}