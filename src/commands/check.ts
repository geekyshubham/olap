import { readConfig } from "../config/read.js";
import { allValidatorsPassed, runValidators } from "../validators/runner.js";
import type { ValidatorResult } from "../types.js";

export async function checkCommand(cwd = process.cwd()): Promise<ValidatorResult[]> {
  const config = await readConfig(cwd);
  return runValidators(config.validators, cwd);
}

export function printCheckResults(results: ValidatorResult[]): boolean {
  let allOk = true;
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    console.log(`[${status}] ${result.name}: ${result.command}`);
    if (!result.ok) {
      allOk = false;
      if (result.stderr.trim()) {
        console.error(result.stderr.trim());
      }
      if (result.stdout.trim()) {
        console.log(result.stdout.trim());
      }
    }
  }
  return allOk && allValidatorsPassed(results);
}