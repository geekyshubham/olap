import { readFileSync } from "node:fs";

interface PackageMeta {
  name: string;
  version: string;
}

function readPackageMeta(): PackageMeta {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { name?: unknown; version?: unknown };
    return {
      name: typeof packageJson.name === "string" ? packageJson.name : "@geekyshubham/olap",
      version: typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
    };
  } catch {
    // Keep the CLI usable if package metadata is unavailable in a local build.
    return { name: "@geekyshubham/olap", version: "0.0.0" };
  }
}

const META = readPackageMeta();

export const VERSION = META.version;
export const PACKAGE_NAME = META.name;

export function readPackageVersion(): string {
  return META.version;
}
