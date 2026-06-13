import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeConfig } from "../config/write.js";
import type { DiffSummary } from "../git/status.js";
import type {
  AdapterCommand,
  ArchitectReview,
  ContextPack,
  OlapConfig,
  RunEvent,
  RunSummary,
  SessionRecord,
} from "../types.js";

export const RUNS_DIR = ".olap/runs";

export function createRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}

export function runDir(cwd: string, runId: string): string {
  return join(cwd, RUNS_DIR, runId);
}

export async function writeRunArtifacts(options: {
  cwd: string;
  runId: string;
  task: string;
  config: OlapConfig;
  events: RunEvent[];
  report: string;
  brief?: string;
  contextPack?: ContextPack;
  reviews?: ArchitectReview[];
  adapterCommands?: AdapterCommand[];
  summary?: RunSummary;
  diff?: DiffSummary;
  session?: SessionRecord;
}): Promise<string> {
  const dir = runDir(options.cwd, options.runId);
  await mkdir(dir, { recursive: true });

  const writes: Promise<void>[] = [
    writeFile(join(dir, "task.md"), options.task.trim() + "\n", "utf8"),
    writeFile(join(dir, "config-snapshot.yaml"), serializeConfig(options.config), "utf8"),
    writeFile(
      join(dir, "events.jsonl"),
      options.events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    ),
    writeFile(join(dir, "final-report.md"), options.report.trim() + "\n", "utf8"),
  ];

  if (options.brief !== undefined) {
    // Full, untruncated orchestrator plan/brief — the TUI shows a collapsed view
    // and links here for the complete text.
    writes.push(
      writeFile(
        join(dir, "brief.md"),
        (options.brief.trim() || "(no plan produced)") + "\n",
        "utf8",
      ),
    );
  }

  if (options.contextPack) {
    writes.push(
      writeFile(
        join(dir, "context-pack.json"),
        JSON.stringify(options.contextPack, null, 2) + "\n",
        "utf8",
      ),
    );
  }

  if (options.reviews) {
    writes.push(
      writeFile(
        join(dir, "architect-reviews.jsonl"),
        options.reviews.map((review) => JSON.stringify(review)).join("\n") + "\n",
        "utf8",
      ),
    );
  }

  if (options.adapterCommands) {
    writes.push(
      writeFile(
        join(dir, "adapter-commands.json"),
        JSON.stringify(options.adapterCommands, null, 2) + "\n",
        "utf8",
      ),
    );
  }

  if (options.summary) {
    writes.push(
      writeFile(join(dir, "summary.json"), JSON.stringify(options.summary, null, 2) + "\n", "utf8"),
    );
  }

  if (options.diff) {
    writes.push(
      writeFile(join(dir, "changes.json"), JSON.stringify(options.diff, null, 2) + "\n", "utf8"),
    );
  }

  if (options.session) {
    writes.push(
      writeFile(join(dir, "session.json"), JSON.stringify(options.session, null, 2) + "\n", "utf8"),
    );
  }

  await Promise.all(writes);

  return dir;
}
