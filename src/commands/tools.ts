import { executeProcess, type ExecOptions } from "../run/executor.js";

export type ToolName = "graphify" | "headroom";

export interface ToolInvocation {
  tool: ToolName;
  binary: string;
  argv: string[];
  installHint: string;
}

export interface ToolRunResult {
  tool: ToolName;
  command: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  installHint: string;
  missingBinary: boolean;
}

const TOOL_DEFS: Record<
  ToolName,
  { binary: string; defaultArgs: string[]; installHint: string }
> = {
  graphify: {
    binary: "graphify",
    defaultArgs: ["."],
    installHint:
      "Install Graphify with `uv tool install graphifyy` or `pipx install graphifyy`, then ensure `graphify` is on PATH.",
  },
  headroom: {
    binary: "headroom",
    defaultArgs: ["perf"],
    installHint:
      'Install Headroom with `pip install "headroom-ai[all]"`, then ensure `headroom` is on PATH.',
  },
};

function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function normalizeArgs(args: string[]): string[] {
  return args.map((arg) => arg.trim()).filter(Boolean);
}

export function buildToolInvocation(tool: ToolName, args: string[]): ToolInvocation {
  const def = TOOL_DEFS[tool];
  const forwarded = normalizeArgs(args);
  const toolArgs = forwarded.length > 0 ? forwarded : def.defaultArgs;
  return {
    tool,
    binary: def.binary,
    argv: [def.binary, ...toolArgs],
    installHint: def.installHint,
  };
}

export function formatToolCommand(invocation: ToolInvocation): string {
  return invocation.argv.map(shellQuote).join(" ");
}

export async function runToolCommand(
  tool: ToolName,
  args: string[] = [],
  options: ExecOptions = { cwd: process.cwd() },
): Promise<ToolRunResult> {
  const invocation = buildToolInvocation(tool, args);
  const result = await executeProcess(invocation, options);
  const missingBinary = result.exitCode === null && /ENOENT|not found/i.test(result.stderr);
  return {
    tool,
    command: formatToolCommand(invocation),
    ok: result.ok,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    installHint: invocation.installHint,
    missingBinary,
  };
}

export function printToolRunResult(result: ToolRunResult): void {
  if (result.stdout.trim()) {
    process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  }
  if (result.stderr.trim()) {
    process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
  }
  if (!result.ok) {
    console.error(`${result.tool} failed${result.exitCode === null ? "" : ` (exit ${result.exitCode})`}.`);
    if (result.missingBinary) {
      console.error(result.installHint);
    }
    return;
  }
  console.log(`${result.tool} completed: ${result.command}`);
}
