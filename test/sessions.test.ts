import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  completeSession,
  createSessionId,
  getSession,
  listSessions,
  registerSession,
  SESSIONS_DIR,
} from "../src/sessions/registry.js";
import { createTempDir } from "./helpers.js";

describe("session registry", () => {
  it("registers a session under .olap/sessions", async () => {
    const cwd = await createTempDir();
    const sessionId = createSessionId(new Date("2026-06-12T10:00:00.000Z"));

    const record = await registerSession({
      cwd,
      task: "Build OLAP core engine",
      adapter: "grok",
      runId: "run-1",
      sessionId,
      now: new Date("2026-06-12T10:00:00.000Z"),
    });

    expect(record.id).toBe(sessionId);
    expect(record.run_ids).toEqual(["run-1"]);
    expect(record.status).toBe("active");

    const onDisk = await readFile(join(cwd, SESSIONS_DIR, `${sessionId}.json`), "utf8");
    expect(onDisk).toContain("Build OLAP core engine");

    const index = await readFile(join(cwd, SESSIONS_DIR, "index.json"), "utf8");
    expect(index).toContain(sessionId);
  });

  it("appends runs and completes sessions", async () => {
    const cwd = await createTempDir();
    const sessionId = createSessionId();

    await registerSession({
      cwd,
      task: "first run",
      adapter: "codex",
      runId: "run-a",
      sessionId,
    });

    await registerSession({
      cwd,
      task: "second run",
      adapter: "codex",
      runId: "run-b",
      sessionId,
    });

    const updated = await getSession(cwd, sessionId);
    expect(updated?.run_ids).toEqual(["run-a", "run-b"]);

    const completed = await completeSession(cwd, sessionId, "completed");
    expect(completed?.status).toBe("completed");

    const sessions = await listSessions(cwd);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("completed");
  });
});
