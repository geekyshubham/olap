import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "../src/storage/task-store.js";
import { olapPaths } from "../src/storage/paths.js";

describe("TaskStore", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("creates and lists tasks", async () => {
    dir = await mkdtemp(join(tmpdir(), "olap-task-"));
    const store = new TaskStore(olapPaths(dir));
    const task = await store.create({
      title: "Fix login bug",
      job_type: "worker",
    });
    expect(task.id).toMatch(/^tsk_/);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("Fix login bug");
  });
});