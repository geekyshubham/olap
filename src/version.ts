import { readFileSync } from "node:fs";

export function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    if (typeof packageJson.version === "string") {
      return packageJson.version;
    }
  } catch {
    // Keep the CLI usable if package metadata is unavailable in a local build.
  }
  return "0.0.0";
}

export const VERSION = readPackageVersion();
