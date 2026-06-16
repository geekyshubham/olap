import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdapterId, SessionRecord } from "../types.js";

export const SESSIONS_DIR = ".olap/sessions";
export const SESSION_INDEX = "index.json";

function sessionsRoot(cwd: string): string {
  return join(cwd, SESSIONS_DIR);
}

function indexPath(cwd: string): string {
  return join(sessionsRoot(cwd), SESSION_INDEX);
}

function sessionPath(cwd: string, sessionId: string): string {
  return join(sessionsRoot(cwd), `${sessionId}.json`);
}

export function createSessionId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `sess-${stamp}-${suffix}`;
}

/** Lines printed when a session can be resumed from the CLI. */
export function formatSessionResumeMessage(sessionId: string): string[] {
  return [
    `Session: ${sessionId}`,
    `Resume:  olap run --session-id ${sessionId} "your next task"`,
  ];
}

function taskSummary(task: string, maxLen = 120): string {
  const trimmed = task.trim().replace(/\s+/g, " ");
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen - 3)}...`;
}

function isSessionStatus(value: unknown): value is SessionRecord["status"] {
  return value === "active" || value === "completed" || value === "failed";
}

/** Coerce partial/corrupt on-disk records into a valid SessionRecord shape. */
export function normalizeSessionRecord(
  raw: unknown,
  fallback: { id: string; now: Date },
): SessionRecord {
  const partial = (raw && typeof raw === "object" ? raw : {}) as Partial<SessionRecord>;
  const runIds = Array.isArray(partial.run_ids)
    ? partial.run_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const createdAt =
    typeof partial.created_at === "string" && partial.created_at.length > 0
      ? partial.created_at
      : fallback.now.toISOString();
  const updatedAt =
    typeof partial.updated_at === "string" && partial.updated_at.length > 0
      ? partial.updated_at
      : createdAt;

  return {
    id: typeof partial.id === "string" && partial.id.length > 0 ? partial.id : fallback.id,
    created_at: createdAt,
    updated_at: updatedAt,
    task_summary:
      typeof partial.task_summary === "string" && partial.task_summary.length > 0
        ? partial.task_summary
        : "",
    status: isSessionStatus(partial.status) ? partial.status : "active",
    run_ids: runIds,
    adapter:
      partial.adapter === "none" ||
      partial.adapter === "grok" ||
      partial.adapter === "claude" ||
      partial.adapter === "gemini" ||
      partial.adapter === "codex" ||
      partial.adapter === "kiro" ||
      partial.adapter === "opencode" ||
      partial.adapter === "openrouter" ||
      partial.adapter === "ollama"
        ? partial.adapter
        : "none",
  };
}

async function readIndex(cwd: string): Promise<SessionRecord[]> {
  try {
    const text = await readFile(indexPath(cwd), "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry, index) =>
        normalizeSessionRecord(entry, {
          id: `unknown-${index}`,
          now: new Date(0),
        }),
      )
      .filter((session) => session.id.length > 0 && !session.id.startsWith("unknown-"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeIndex(cwd: string, sessions: SessionRecord[]): Promise<void> {
  const dir = sessionsRoot(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(indexPath(cwd), JSON.stringify(sessions, null, 2) + "\n", "utf8");
}

function appendRunId(runIds: string[], runId: string): string[] {
  return runIds.includes(runId) ? runIds : [...runIds, runId];
}

export async function registerSession(options: {
  cwd: string;
  task: string;
  adapter: AdapterId | "none";
  runId: string;
  sessionId?: string;
  now?: Date;
}): Promise<SessionRecord> {
  const now = options.now ?? new Date();
  const sessionId = options.sessionId ?? createSessionId(now);
  const dir = sessionsRoot(options.cwd);
  await mkdir(dir, { recursive: true });

  const existingPath = sessionPath(options.cwd, sessionId);
  let record: SessionRecord;
  try {
    const text = await readFile(existingPath, "utf8");
    record = normalizeSessionRecord(JSON.parse(text) as unknown, { id: sessionId, now });
    record.updated_at = now.toISOString();
    record.run_ids = appendRunId(record.run_ids, options.runId);
    record.adapter = options.adapter;
    record.task_summary = taskSummary(options.task);
    record.status = "active";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    record = {
      id: sessionId,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      task_summary: taskSummary(options.task),
      status: "active",
      run_ids: [options.runId],
      adapter: options.adapter,
    };
  }

  await writeFile(existingPath, JSON.stringify(record, null, 2) + "\n", "utf8");

  const index = await readIndex(options.cwd);
  const without = index.filter((session) => session.id !== sessionId);
  without.push(record);
  without.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  await writeIndex(options.cwd, without);

  return record;
}

export async function getSession(
  cwd: string,
  sessionId: string,
): Promise<SessionRecord | undefined> {
  try {
    const text = await readFile(sessionPath(cwd, sessionId), "utf8");
    return normalizeSessionRecord(JSON.parse(text) as unknown, { id: sessionId, now: new Date() });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listSessions(cwd: string): Promise<SessionRecord[]> {
  return readIndex(cwd);
}

export async function completeSession(
  cwd: string,
  sessionId: string,
  status: "completed" | "failed" = "completed",
  now = new Date(),
): Promise<SessionRecord | undefined> {
  const record = await getSession(cwd, sessionId);
  if (!record) return undefined;

  record.status = status;
  record.updated_at = now.toISOString();
  await writeFile(sessionPath(cwd, sessionId), JSON.stringify(record, null, 2) + "\n", "utf8");

  const index = await readIndex(cwd);
  const found = index.some((session) => session.id === sessionId);
  const updated = found
    ? index.map((session) => (session.id === sessionId ? record : session))
    : [...index, record];
  updated.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  await writeIndex(cwd, updated);
  return record;
}