import { spawn } from "node:child_process";
import type { ValidatorConfig, ValidatorResult } from "../types.js";
import { MAX_CAPTURE_BYTES } from "../run/executor.js";

const VALIDATOR_TIMEOUT_MS = 600_000;

function appendCaptured(current: string, chunk: string): string {
  if (current.length >= MAX_CAPTURE_BYTES) return current;
  return current + chunk.slice(0, MAX_CAPTURE_BYTES - current.length);
}

function runCommand(command: string, cwd: string): Promise<ValidatorResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (result: Omit<ValidatorResult, "name" | "command">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ name: "", command, ...result });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
    }, VALIDATOR_TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCaptured(stdout, chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCaptured(stderr, chunk.toString());
    });

    child.on("close", (code) => {
      finish({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout,
        stderr: timedOut ? `${stderr}\n[validator timed out]`.trim() : stderr,
      });
    });

    child.on("error", (error) => {
      finish({
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