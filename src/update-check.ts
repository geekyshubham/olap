import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

export interface UpdateCheckOptions {
  current: string;
  packageName: string;
  cacheDir?: string;
  ttlMs?: number;
  now?: () => number;
  timeoutMs?: number;
  /** Injectable fetcher for tests; returns the latest version string or undefined. */
  fetchLatest?: (packageName: string, timeoutMs: number) => Promise<string | undefined>;
}

interface CacheShape {
  checkedAt: number;
  latest: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a semver-ish string into [major, minor, patch], ignoring prerelease/build. */
export function parseSemver(version: string): [number, number, number] {
  const core = version.replace(/^v/, "").split(/[-+]/)[0];
  const [major = 0, minor = 0, patch = 0] = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return [major, minor, patch];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const [lMaj, lMin, lPat] = parseSemver(latest);
  const [cMaj, cMin, cPat] = parseSemver(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

async function fetchLatestFromNpm(
  packageName: string,
  timeoutMs: number,
): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timer);
    if (!response.ok) return undefined;
    const data = (await response.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : undefined;
  } catch {
    return undefined;
  }
}

function cachePath(cacheDir: string): string {
  return join(cacheDir, "update-check.json");
}

async function readCache(cacheDir: string): Promise<CacheShape | undefined> {
  try {
    const text = await readFile(cachePath(cacheDir), "utf8");
    const parsed = JSON.parse(text) as CacheShape;
    if (typeof parsed.checkedAt === "number" && typeof parsed.latest === "string") return parsed;
  } catch {
    // ignore missing/corrupt cache
  }
  return undefined;
}

async function writeCache(cacheDir: string, cache: CacheShape): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath(cacheDir), JSON.stringify(cache), "utf8");
  } catch {
    // best-effort; never fail the run over a cache write
  }
}

/**
 * Check whether a newer published version exists. Uses a daily on-disk cache so we
 * hit the network at most once per TTL. Returns undefined when the latest version
 * cannot be determined (e.g. offline).
 */
export async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateInfo | undefined> {
  const cacheDir = options.cacheDir ?? join(homedir(), ".olap");
  const ttlMs = options.ttlMs ?? DAY_MS;
  const now = (options.now ?? Date.now)();
  const fetchLatest = options.fetchLatest ?? fetchLatestFromNpm;

  const cached = await readCache(cacheDir);
  let latest = cached && now - cached.checkedAt < ttlMs ? cached.latest : undefined;

  if (latest === undefined) {
    latest = await fetchLatest(options.packageName, options.timeoutMs ?? 1500);
    if (latest === undefined) return undefined;
    await writeCache(cacheDir, { checkedAt: now, latest });
  }

  return {
    current: options.current,
    latest,
    updateAvailable: isNewerVersion(latest, options.current),
  };
}

export function formatUpdateNotice(info: UpdateInfo, packageName: string): string {
  return `Update available: OLAP ${info.latest} (you have ${info.current}). Run: npm i -g ${packageName}`;
}
