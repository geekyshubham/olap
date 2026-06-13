import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deriveRepoName,
  EMPTY_REPO_STATUS,
  formatDiffSummary,
  formatRepoStatus,
  getDiffSummary,
  getHeadOid,
  getRepoStatus,
  getRunDiffSummary,
  getWorktreeChangeSignature,
  mergeDiffFiles,
  normalizeDiffPath,
  parseNumstat,
  parsePorcelainV2,
  type RepoStatus,
} from "../src/git/status.js";
import { createTempDir } from "./helpers.js";

const run = promisify(execFile);

describe("git status parsing", () => {
  it("parses porcelain v2 branch and change counts", () => {
    const output = [
      "# branch.head main",
      "# branch.ab +2 -1",
      "1 M. N... 100644 100644 100644 aaa bbb staged.ts",
      "1 .M N... 100644 100644 100644 ccc ddd unstaged.ts",
      "? untracked.ts",
    ].join("\n");
    const parsed = parsePorcelainV2(output);
    expect(parsed.branch).toBe("main");
    expect(parsed.ahead).toBe(2);
    expect(parsed.behind).toBe(1);
    expect(parsed.staged).toBe(1);
    expect(parsed.unstaged).toBe(1);
    expect(parsed.untracked).toBe(1);
  });

  it("derives repo name from remote url or top level", () => {
    expect(deriveRepoName("/a/b/myrepo", "git@github.com:owner/cool-repo.git")).toBe("cool-repo");
    expect(deriveRepoName("/a/b/myrepo", undefined)).toBe("myrepo");
    expect(deriveRepoName(undefined, "https://github.com/o/r")).toBe("r");
  });

  it("formats status compactly", () => {
    expect(formatRepoStatus(EMPTY_REPO_STATUS)).toBe("no git");
    const clean: RepoStatus = { ...EMPTY_REPO_STATUS, isRepo: true, branch: "main" };
    expect(formatRepoStatus(clean)).toBe("main clean");
    const dirty: RepoStatus = { ...clean, staged: 1, dirty: true };
    expect(formatRepoStatus(dirty)).toContain("+1");
  });

  it("returns not-a-repo for a plain directory", async () => {
    const dir = await createTempDir("olap-nogit-");
    const status = await getRepoStatus(dir);
    expect(status.isRepo).toBe(false);
  });

  it("reads a real repository's branch and dirty state", async () => {
    const dir = await createTempDir("olap-git-");
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "file.txt"), "hello\n", "utf8");

    const status = await getRepoStatus(dir);
    expect(status.isRepo).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.untracked).toBeGreaterThanOrEqual(1);
    expect(status.dirty).toBe(true);
  });
});

describe("git diff summary", () => {
  it("normalizes brace-style and simple rename paths", () => {
    expect(normalizeDiffPath("foo/{bar => baz}/file")).toBe("foo/baz/file");
    expect(normalizeDiffPath("old-name.ts => new-name.ts")).toBe("new-name.ts");
    expect(normalizeDiffPath("src/a.ts")).toBe("src/a.ts");
  });

  it("parses numstat into per-file churn (text + binary)", () => {
    const files = parseNumstat(["12\t4\tsrc/a.ts", "-\t-\tassets/logo.png"].join("\n"));
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ path: "src/a.ts", insertions: 12, deletions: 4, binary: false });
    expect(files[1].binary).toBe(true);
    expect(files[1].insertions).toBe(0);
  });

  it("merges staged + unstaged churn per path", () => {
    const merged = mergeDiffFiles(
      [{ path: "src/a.ts", insertions: 2, deletions: 1, binary: false }],
      [{ path: "src/a.ts", insertions: 3, deletions: 0, binary: false }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ path: "src/a.ts", insertions: 5, deletions: 1, binary: false });
  });

  it("formats a compact change summary", () => {
    expect(formatDiffSummary({ changed: false, files: [], insertions: 0, deletions: 0 })).toBe("no changes");
    expect(
      formatDiffSummary({
        changed: true,
        files: [{ path: "a", insertions: 3, deletions: 1, binary: false }],
        insertions: 3,
        deletions: 1,
      }),
    ).toBe("1 file +3 -1");
  });

  it("summarizes a real repository's working-tree changes", async () => {
    const dir = await createTempDir("olap-diff-");
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "tracked.txt"), "one\n", "utf8");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "tracked.txt"), "one\ntwo\n", "utf8");
    await writeFile(join(dir, "new.txt"), "fresh\n", "utf8");

    const summary = await getDiffSummary(dir);
    expect(summary.changed).toBe(true);
    const paths = summary.files.map((f) => f.path);
    expect(paths).toContain("tracked.txt");
    expect(paths).toContain("new.txt");
  });

  it("detects committed changes since a baseline ref", async () => {
    const dir = await createTempDir("olap-rundiff-");
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "tracked.txt"), "one\n", "utf8");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "init"], { cwd: dir });
    const baseline = await getHeadOid(dir);
    expect(baseline).toBeTruthy();
    await writeFile(join(dir, "tracked.txt"), "one\ntwo\n", "utf8");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "second"], { cwd: dir });

    const summary = await getRunDiffSummary(dir, baseline!);
    expect(summary.changed).toBe(true);
    expect(summary.files.some((f) => f.path === "tracked.txt")).toBe(true);
  });

  it("reports no changes for a non-repo directory", async () => {
    const dir = await createTempDir("olap-nodiff-");
    const summary = await getDiffSummary(dir);
    expect(summary.changed).toBe(false);
  });

  it("changes the worktree signature when tracked or untracked changes change", async () => {
    const dir = await createTempDir("olap-signature-");
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "tracked.txt"), "one\n", "utf8");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "init"], { cwd: dir });

    const before = await getWorktreeChangeSignature(dir);
    await writeFile(join(dir, "tracked.txt"), "one\ntwo\n", "utf8");
    const afterTracked = await getWorktreeChangeSignature(dir);
    await writeFile(join(dir, "new.txt"), "fresh\n", "utf8");
    const afterUntracked = await getWorktreeChangeSignature(dir);

    expect(afterTracked).not.toBe(before);
    expect(afterUntracked).not.toBe(afterTracked);
  });

  it("counts real added lines for new untracked files (not +0 -0)", async () => {
    const dir = await createTempDir("olap-untracked-");
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "new.txt"), "a\nb\nc\n", "utf8");

    const summary = await getDiffSummary(dir);
    const file = summary.files.find((f) => f.path === "new.txt");
    expect(file).toBeDefined();
    expect(file?.insertions).toBe(3);
    expect(summary.insertions).toBeGreaterThanOrEqual(3);
  });

  it("never counts OLAP's own .olap/ artifacts as changes", async () => {
    const dir = await createTempDir("olap-selfignore-");
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "Test"], { cwd: dir });
    await mkdir(join(dir, ".olap", "runs", "r1"), { recursive: true });
    await writeFile(join(dir, ".olap", "runs", "r1", "events.jsonl"), "{}\n", "utf8");
    await writeFile(join(dir, "real.txt"), "code\n", "utf8");

    const summary = await getDiffSummary(dir);
    const paths = summary.files.map((f) => f.path);
    expect(paths).toContain("real.txt");
    expect(paths.some((p) => p.startsWith(".olap"))).toBe(false);

    // Adding only .olap artifacts must NOT change the worktree signature.
    const sigBefore = await getWorktreeChangeSignature(dir);
    await mkdir(join(dir, ".olap", "runs", "r2"), { recursive: true });
    await writeFile(join(dir, ".olap", "runs", "r2", "events.jsonl"), "{}\n", "utf8");
    const sigAfter = await getWorktreeChangeSignature(dir);
    expect(sigAfter).toBe(sigBefore);
  });
});
