import { describe, expect, it } from "vitest";
import {
  canTransition,
  isBlocked,
  isDispatchable,
  isTerminal,
  resolveFailureStatus,
} from "../src/domain/transitions.js";
import type { Task } from "../src/domain/task.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk_1",
    title: "t",
    description: "",
    status: "todo",
    priority: 5,
    labels: [],
    depends_on: [],
    created_at: "",
    updated_at: "",
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

describe("transitions", () => {
  it("allows todo → in_progress", () => {
    expect(canTransition("todo", "in_progress")).toBe(true);
  });

  it("blocks dispatch when dependency not done", () => {
    const dep = makeTask({ id: "tsk_a", status: "in_progress" });
    const task = makeTask({ depends_on: ["tsk_a"] });
    expect(isBlocked(task, [dep, task])).toBe(true);
  });

  it("marks terminal statuses", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isDispatchable("todo")).toBe(true);
  });

  it("retries until max attempts", () => {
    expect(resolveFailureStatus(2, 3)).toBe("retrying");
    expect(resolveFailureStatus(3, 3)).toBe("failed");
  });
});