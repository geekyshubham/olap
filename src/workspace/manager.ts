import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { ensureDir } from "../storage/fs-utils.js";
import type { WorkspaceMode } from "../domain/task.js";
import { isGitWorkTree } from "../git/status.js";

const execFileAsync = promisify(execFile);

export interface PrepareResult {
  cwd: string;
  branch?: string;
  mode: WorkspaceMode;
}

export class WorkspaceManager {
  constructor(
    private readonly projectRoot: string,
    private readonly workspacesDir: string,
  ) {}

  async prepare(taskId: string, title: string, mode?: WorkspaceMode): Promise<PrepareResult> {
    const resolved = mode ?? (await isGitWorkTree(this.projectRoot) ? "worktree" : "shared");
    if (resolved === "shared") {
      return { cwd: this.projectRoot, mode: "shared" };
    }
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
      .replace(/^-|-$/g, "") || "task";
    const branch = `olap/${taskId}/${slug}`;
    const worktreePath = path.join(this.workspacesDir, taskId);
    await ensureDir(this.workspacesDir);
    try {
      await execFileAsync("git", ["worktree", "add", "-B", branch, worktreePath], {
        cwd: this.projectRoot,
      });
    } catch {
      // worktree may already exist from a retry
      try {
        await execFileAsync("git", ["worktree", "add", worktreePath, branch], {
          cwd: this.projectRoot,
        });
      } catch {
        return { cwd: this.projectRoot, mode: "shared" };
      }
    }
    return { cwd: worktreePath, branch, mode: "worktree" };
  }

  async cleanup(taskId: string): Promise<void> {
    const worktreePath = path.join(this.workspacesDir, taskId);
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
        cwd: this.projectRoot,
      });
    } catch {
      // best effort
    }
  }
}