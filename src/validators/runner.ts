import { spawn } from "node:child_process";
import type { ValidatorConfig, ValidatorResult } from "../types.js";

function runCommand(command: string, cwd: string): Promise<ValidatorResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({
        name: "",
        command,
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });

    child.on("error", (error) => {
      resolve({
        name: "",
        command,
        ok: false,
        exitCode: null,
        stdout,
        stderr: error.message,
      });
    });
  });
}

export async function runValidators(
  validators: ValidatorConfig[],
  cwd = process.cwd(),
): Promise<ValidatorResult[]> {
  const results: ValidatorResult[] = [];
  for (const validator of validators) {
    const result = await runCommand(validator.command, cwd);
    results.push({ ...result, name: validator.name });
  }
  return results;
}

export function allValidatorsPassed(results: ValidatorResult[]): boolean {
  if (results.length === 0) return true;
  return results.every((r) => r.ok);
}