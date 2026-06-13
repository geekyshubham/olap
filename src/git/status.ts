import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

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

/** Per-file churn from `git diff --numstat`. Binary files report `-1` lines. */
export interface DiffFile {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
}

/** Aggregate working-tree change summary surfaced after a worker iteration. */
export interface DiffSummary {
  changed: boolean;
  files: DiffFile[];
  insertions: number;
  deletions: number;
}

export const EMPTY_DIFF_SUMMARY: DiffSummary = {
  changed: false,
  files: [],
  insertions: 0,
  deletions: 0,
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
      staged += 1;
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

/** Normalize git numstat path segments (simple and brace-style renames). */
export function normalizeDiffPath(raw: string): string {
  const trimmed = raw.trim();
  const brace = trimmed.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (brace) {
    const [, prefix, middle, suffix] = brace;
    const arrow = middle.match(/^(.*)=>\s*(.*)$/);
    if (arrow) {
      const newPart = arrow[2].trim();
      return `${prefix}${newPart}${suffix}`.replace(/\/+/g, "/");
    }
  }
  const simple = trimmed.match(/^(.+?)\s+=>\s+(.+)$/);
  if (simple) return simple[2].trim();
  return trimmed;
}

/** True when `cwd` is inside a git work tree (even with no commits yet). */
export async function isGitWorkTree(cwd = process.cwd(), timeoutMs = 4000): Promise<boolean> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd, timeoutMs);
  return inside?.trim() === "true";
}

/** Parse `git diff --numstat` output into per-file churn. */
export function parseNumstat(output: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [insRaw, delRaw, ...pathParts] = parts;
    const binary = insRaw === "-" || delRaw === "-";
    const path = normalizeDiffPath(pathParts.join("\t"));
    files.push({
      path,
      insertions: binary ? 0 : Number.parseInt(insRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(delRaw, 10) || 0,
      binary,
    });
  }
  return files;
}

/** Merge staged + unstaged numstat entries, summing churn per path. */
export function mergeDiffFiles(...groups: DiffFile[][]): DiffFile[] {
  const byPath = new Map<string, DiffFile>();
  for (const group of groups) {
    for (const file of group) {
      const existing = byPath.get(file.path);
      if (existing) {
        existing.insertions += file.insertions;
        existing.deletions += file.deletions;
        existing.binary = existing.binary || file.binary;
      } else {
        byPath.set(file.path, { ...file });
      }
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function summarizeDiffFiles(files: DiffFile[]): DiffSummary {
  const insertions = files.reduce((n, f) => n + f.insertions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  return { changed: files.length > 0, files, insertions, deletions };
}

/** Current `HEAD` OID, or undefined when not inside a git work tree. */
export async function getHeadOid(cwd = process.cwd(), timeoutMs = 4000): Promise<string | undefined> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd, timeoutMs);
  if (!inside || inside.trim() !== "true") return undefined;
  const head = await git(["rev-parse", "HEAD"], cwd, timeoutMs);
  return head?.trim() || undefined;
}

/** Paths OLAP writes for itself (run artifacts). These must never count as worker changes. */
function isInternalArtifactPath(rawPath: string): boolean {
  const path = rawPath.trim().replace(/^"|"$/g, "").replace(/^\.\//, "");
  return path === ".olap" || path.startsWith(".olap/");
}

/** Drop OLAP's own artifact paths from a numstat/untracked text block, returning trimmed lines. */
function withoutInternalArtifactLines(raw: string | undefined): string[] {
  return (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const path = line.split("\t").pop() ?? line;
      return !isInternalArtifactPath(path);
    });
}

/** Cap for reading untracked files to count added lines (skip huge files). */
const MAX_UNTRACKED_BYTES = 512 * 1024;

/**
 * `git diff --numstat` ignores untracked files, so new files would otherwise show as
 * `+0 -0`. Read each untracked file and count its lines as added so a freshly created
 * file reports real churn (binary/oversized files are flagged, not counted).
 */
async function untrackedFileChurn(cwd: string, path: string): Promise<DiffFile> {
  try {
    const info = await stat(join(cwd, path));
    if (!info.isFile()) return { path, insertions: 0, deletions: 0, binary: false };
    if (info.size > MAX_UNTRACKED_BYTES) return { path, insertions: 0, deletions: 0, binary: true };
    const buffer = await readFile(join(cwd, path));
    if (buffer.includes(0)) return { path, insertions: 0, deletions: 0, binary: true };
    if (buffer.length === 0) return { path, insertions: 0, deletions: 0, binary: false };
    const text = buffer.toString("utf8");
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    const insertions = body.length === 0 ? 0 : body.split("\n").length;
    return { path, insertions, deletions: 0, binary: false };
  } catch {
    return { path, insertions: 0, deletions: 0, binary: false };
  }
}

/**
 * Summarize changes since a run baseline: commits landed on `HEAD` since `baselineRef`
 * plus the current working-tree diff on top of `HEAD`.
 */
export async function getRunDiffSummary(
  cwd: string,
  baselineRef: string,
  timeoutMs = 4000,
): Promise<DiffSummary> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd, timeoutMs);
  if (!inside || inside.trim() !== "true") return { ...EMPTY_DIFF_SUMMARY };

  const trimmedBaseline = baselineRef.trim();
  if (!trimmedBaseline) return getDiffSummary(cwd, timeoutMs);

  const baselineValid = await git(["rev-parse", "--verify", trimmedBaseline], cwd, timeoutMs);
  if (!baselineValid?.trim()) return getDiffSummary(cwd, timeoutMs);

  const currentHead = await getHeadOid(cwd, timeoutMs);
  const committed =
    currentHead && currentHead !== trimmedBaseline
      ? parseNumstat(
          (await git(["diff", "--numstat", `${trimmedBaseline}..HEAD`], cwd, timeoutMs)) ?? "",
        )
      : [];

  const working = await getDiffSummary(cwd, timeoutMs);
  const merged = mergeDiffFiles(committed, working.files).filter(
    (file) => !isInternalArtifactPath(file.path),
  );
  return summarizeDiffFiles(merged);
}

export async function getDiffSummary(cwd = process.cwd(), timeoutMs = 4000): Promise<DiffSummary> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd, timeoutMs);
  if (!inside || inside.trim() !== "true") return { ...EMPTY_DIFF_SUMMARY };

  const [unstaged, staged, untracked] = await Promise.all([
    git(["diff", "--numstat"], cwd, timeoutMs),
    git(["diff", "--numstat", "--cached"], cwd, timeoutMs),
    git(["ls-files", "--others", "--exclude-standard"], cwd, timeoutMs),
  ]);

  const untrackedPaths = (untracked ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((path) => !isInternalArtifactPath(path));
  const untrackedFiles: DiffFile[] = await Promise.all(
    untrackedPaths.map((path) => untrackedFileChurn(cwd, path)),
  );

  const files = mergeDiffFiles(
    parseNumstat(unstaged ?? ""),
    parseNumstat(staged ?? ""),
    untrackedFiles,
  ).filter((file) => !isInternalArtifactPath(file.path));
  return summarizeDiffFiles(files);
}

/**
 * Compact signature for the current working-tree change state.
 * Used to tell whether a run changed the worktree beyond whatever was dirty before it started.
 */
export async function getWorktreeChangeSignature(
  cwd = process.cwd(),
  timeoutMs = 4000,
): Promise<string | undefined> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd, timeoutMs);
  if (!inside || inside.trim() !== "true") return undefined;

  const [unstaged, staged, untracked] = await Promise.all([
    git(["diff", "--numstat"], cwd, timeoutMs),
    git(["diff", "--numstat", "--cached"], cwd, timeoutMs),
    git(["ls-files", "--others", "--exclude-standard"], cwd, timeoutMs),
  ]);

  return JSON.stringify({
    staged: withoutInternalArtifactLines(staged).sort().join("\n"),
    unstaged: withoutInternalArtifactLines(unstaged).sort().join("\n"),
    untracked: withoutInternalArtifactLines(untracked).sort(),
  });
}

/** Compact change summary: `3 files +12 -4`, or `no changes`. */
export function formatDiffSummary(summary: DiffSummary): string {
  if (!summary.changed) return "no changes";
  const fileWord = summary.files.length === 1 ? "file" : "files";
  return `${summary.files.length} ${fileWord} +${summary.insertions} -${summary.deletions}`;
}
