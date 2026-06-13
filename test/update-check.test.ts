import { describe, expect, it } from "vitest";
import {
  checkForUpdate,
  formatUpdateNotice,
  isNewerVersion,
  parseSemver,
} from "../src/update-check.js";
import { createTempDir } from "./helpers.js";

describe("update check", () => {
  it("parses semver and compares versions", () => {
    expect(parseSemver("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseSemver("2")).toEqual([2, 0, 0]);
    expect(isNewerVersion("1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.2.0", "1.10.0")).toBe(false);
  });

  it("reports an available update and writes the cache", async () => {
    const cacheDir = await createTempDir("olap-upd-");
    const info = await checkForUpdate({
      current: "0.1.1",
      packageName: "@geekyshubham/olap",
      cacheDir,
      now: () => 1000,
      fetchLatest: async () => "9.9.9",
    });
    expect(info).toEqual({ current: "0.1.1", latest: "9.9.9", updateAvailable: true });
  });

  it("uses the cache within the TTL instead of refetching", async () => {
    const cacheDir = await createTempDir("olap-upd-");
    let fetches = 0;
    const fetchLatest = async () => {
      fetches += 1;
      return "2.0.0";
    };
    await checkForUpdate({ current: "1.0.0", packageName: "p", cacheDir, now: () => 0, fetchLatest });
    const second = await checkForUpdate({
      current: "1.0.0",
      packageName: "p",
      cacheDir,
      now: () => 1000,
      fetchLatest,
    });
    expect(fetches).toBe(1);
    expect(second?.latest).toBe("2.0.0");
  });

  it("returns undefined when the latest version cannot be determined", async () => {
    const cacheDir = await createTempDir("olap-upd-");
    const info = await checkForUpdate({
      current: "1.0.0",
      packageName: "p",
      cacheDir,
      fetchLatest: async () => undefined,
    });
    expect(info).toBeUndefined();
  });

  it("formats a clear update notice", () => {
    const notice = formatUpdateNotice(
      { current: "0.1.1", latest: "0.2.0", updateAvailable: true },
      "@geekyshubham/olap",
    );
    expect(notice).toContain("0.2.0");
    expect(notice).toContain("npm i -g @geekyshubham/olap");
  });
});
