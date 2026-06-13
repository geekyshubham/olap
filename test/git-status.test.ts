import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deriveRepoName,
  EMPTY_REPO_STATUS,
  formatRepoStatus,
  getRepoStatus,
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
