import { spawn } from "node:child_process";
import type { AdapterCommand } from "../types.js";

export interface ExecResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Called for each complete line of output as it streams in. */
  onLine?: (stream: "stdout" | "stderr", line: string) => void;
  /** Abort signal to cancel the run early. */
  signal?: AbortSignal;
}

function splitLines(buffer: string, onLine: (line: string) => void): string {
  let rest = buffer;
  let index = rest.indexOf("\n");
  while (index !== -1) {
    onLine(rest.slice(0, index).replace(/\r$/, ""));
    rest = rest.slice(index + 1);
    index = rest.indexOf("\n");
  }
  return rest;
}

/**
 * Spawn an adapter command and stream its output. argv[0] is the binary.
 * This is the bridge between OLAP's command contracts and real CLI workers.
 */
export function executeCommand(
  command: AdapterCommand,
  options: ExecOptions,
): Promise<ExecResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const [bin, ...args] = command.argv.length > 0 ? command.argv : [command.binary];
    let stdout = "";
    let stderr = "";
    let stdoutBuf = "";
    let stderrBuf = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
    });

    const finish = (result: Omit<ExecResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      // Flush any trailing partial line.
      if (stdoutBuf) options.onLine?.("stdout", stdoutBuf.replace(/\r$/, ""));
      if (stderrBuf) options.onLine?.("stderr", stderrBuf.replace(/\r$/, ""));
      resolve({ ...result, durationMs: Date.now() - start });
    };

    const onAbort = () => {
      timedOut = true;
      child.kill("SIGTERM");
    };

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;
    timer?.unref?.();

    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuf = splitLines(stdoutBuf + text, (line) => options.onLine?.("stdout", line));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuf = splitLines(stderrBuf + text, (line) => options.onLine?.("stderr", line));
    });

    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      finish({ ok: false, exitCode: null, signal: null, stdout, stderr, timedOut });
    });

    child.on("close", (code, signal) => {
      finish({
        ok: code === 0 && !timedOut,
        exitCode: code,
        signal: signal ?? null,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
