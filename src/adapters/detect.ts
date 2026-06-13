import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import type { AdapterDetection, AdapterId, AdapterSpec } from "../types.js";

export const ADAPTER_SPECS: AdapterSpec[] = [
  { id: "grok", binaries: ["grok", "grok-cli"] },
  { id: "claude", binaries: ["claude", "claude-code"] },
  { id: "gemini", binaries: ["gemini", "gemini-cli"] },
  { id: "codex", binaries: ["codex", "codex-cli"] },
  { id: "kiro", binaries: ["kiro-cli", "kiro"] },
  { id: "ollama", binaries: ["ollama"] },
];

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Platform-specific executable names (PATHEXT on Windows). */
function executableNames(name: string): string[] {
  if (process.platform !== "win32") {
    return [name];
  }
  const names = [name];
  const pathext = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  for (const ext of pathext.split(";")) {
    const suffix = ext.trim();
    if (!suffix) continue;
    const normalized = suffix.startsWith(".") ? suffix : `.${suffix}`;
    if (!name.toLowerCase().endsWith(normalized.toLowerCase())) {
      names.push(`${name}${normalized}`);
    }
  }
  return names;
}

export async function findBinary(
  name: string,
  pathEnv = process.env.PATH ?? "",
): Promise<string | undefined> {
  const sep = process.platform === "win32" ? ";" : ":";
  const dirs = pathEnv.split(sep).filter(Boolean);
  for (const dir of dirs) {
    for (const candidateName of executableNames(name)) {
      const candidate = join(dir, candidateName);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export async function detectAdapter(
  spec: AdapterSpec,
  pathEnv = process.env.PATH ?? "",
): Promise<AdapterDetection> {
  for (const binary of spec.binaries) {
    const found = await findBinary(binary, pathEnv);
    if (found) {
      return { id: spec.id, detected: true, binary: found };
    }
  }
  return { id: spec.id, detected: false };
}

export async function detectAdapters(
  pathEnv = process.env.PATH ?? "",
): Promise<AdapterDetection[]> {
  return Promise.all(ADAPTER_SPECS.map((spec) => detectAdapter(spec, pathEnv)));
}

export function pickAdapter(
  detections: AdapterDetection[],
  preferred: AdapterId,
  fallback: AdapterId,
): AdapterDetection | undefined {
  const preferredMatch = detections.find((d) => d.id === preferred && d.detected);
  if (preferredMatch) return preferredMatch;
  const fallbackMatch = detections.find((d) => d.id === fallback && d.detected);
  if (fallbackMatch) return fallbackMatch;
  return detections.find((d) => d.detected);
}
