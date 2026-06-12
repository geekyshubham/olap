import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import type { AdapterDetection, AdapterId, AdapterSpec } from "../types.js";

export const ADAPTER_SPECS: AdapterSpec[] = [
  { id: "grok", binaries: ["grok", "grok-cli"] },
  { id: "claude", binaries: ["claude", "claude-code"] },
  { id: "gemini", binaries: ["gemini", "gemini-cli"] },
  { id: "codex", binaries: ["codex", "codex-cli"] },
];

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findBinary(
  name: string,
  pathEnv = process.env.PATH ?? "",
): Promise<string | undefined> {
  const dirs = pathEnv.split(":").filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (await isExecutable(candidate)) {
      return candidate;
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