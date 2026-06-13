import { execFile } from "node:child_process";
import { basename } from "node:path";

export interface RepoStatus {
  isRepo: boolean;
  repoName?: string;
  branch?: string;
  detached: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
  dirty: boolean;
}

export const EMPTY_REPO_STATUS: RepoStatus = {
  isRepo: false,
  detached: false,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  ahead: 0,
  behind: 0,
  dirty: false,
};

function git(args: string[], cwd: string, timeoutMs = 2000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}

/** Parse `git status --porcelain=v2 --branch` output into counts. */
export function parsePorcelainV2(output: string): {
  branch?: string;
  detached: boolean;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
} {
  let branch: string | undefined;
  let detached = false;
  let ahead = 0;
  let behind = 0;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      if (head === "(detached)") {
        detached = true;
      } else {
        branch = head;
      }
    } else if (line.startsWith("# branch.ab ")) {
      const parts = line.slice("# branch.ab ".length).trim().split(/\s+/);
      for (const part of parts) {
        if (part.startsWith("+")) ahead = Number.parseInt(part.slice(1), 10) || 0;
        if (part.startsWith("-")) behind = Number.parseInt(part.slice(1), 10) || 0;
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Changed/renamed entries: XY field is the 2nd token, e.g. "M.".
      const xy = line.split(" ")[1] ?? "..";
      const x = xy[0];
      const y = xy[1];
      if (x && x !== ".") staged += 1;
      if (y && y !== ".") unstaged += 1;
    } else if (line.startsWith("u ")) {
      // Unmerged entry counts as both staged and unstaged churn.
      unstaged += 1;
    } else if (line.startsWith("? ")) {
      untracked += 1;
    }
  }

  return { branch, detached, ahead, behind, staged, unstaged, untracked };
}

export async function getRepoStatus(cwd = process.cwd()): Promise<RepoStatus> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (!inside || inside.trim() !== "true") {
    return { ...EMPTY_REPO_STATUS };
  }

  const [topLevel, statusOut, remoteUrl] = await Promise.all([
    git(["rev-parse", "--show-toplevel"], cwd),
    git(["status", "--porcelain=v2", "--branch"], cwd),
    git(["config", "--get", "remote.origin.url"], cwd),
  ]);

  const parsed = parsePorcelainV2(statusOut ?? "");
  const repoName = deriveRepoName(topLevel?.trim(), remoteUrl?.trim());

  return {
    isRepo: true,
    repoName,
    branch: parsed.branch,
    detached: parsed.detached,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    ahead: parsed.ahead,
    behind: parsed.behind,
    dirty: parsed.staged + parsed.unstaged + parsed.untracked > 0,
  };
}

export function deriveRepoName(topLevel?: string, remoteUrl?: string): string | undefined {
  if (remoteUrl) {
    const cleaned = remoteUrl.replace(/\.git$/, "").replace(/\/$/, "");
    const segment = cleaned.split(/[/:]/).pop();
    if (segment) return segment;
  }
  if (topLevel) return basename(topLevel);
  return undefined;
}

/** Compact one-line summary: `repo  branch ●2 +1 ↑3`. */
export function formatRepoStatus(status: RepoStatus): string {
  if (!status.isRepo) return "no git";
  const parts: string[] = [];
  if (status.branch) {
    parts.push(status.branch);
  } else if (status.detached) {
    parts.push("detached");
  }
  if (status.staged > 0) parts.push(`+${status.staged}`);
  if (status.unstaged > 0) parts.push(`~${status.unstaged}`);
  if (status.untracked > 0) parts.push(`?${status.untracked}`);
  if (status.ahead > 0) parts.push(`↑${status.ahead}`);
  if (status.behind > 0) parts.push(`↓${status.behind}`);
  if (!status.dirty && status.ahead === 0 && status.behind === 0) parts.push("clean");
  return parts.join(" ");
}
