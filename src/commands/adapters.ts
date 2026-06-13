import { detectAdapters } from "../adapters/detect.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { AdapterCapabilityProfile, AdapterDetection, AdapterId, OlapConfig } from "../types.js";

export function adapterCapabilities(
  config: OlapConfig,
  adapter: AdapterId,
): AdapterCapabilityProfile {
  return {
    ...DEFAULT_CONFIG.adapters.capabilities[adapter]!,
    ...config.adapters.capabilities[adapter],
  };
}

function capabilityTags(profile: AdapterCapabilityProfile): string {
  const tags = [
    profile.planning ? "plan" : undefined,
    profile.review ? "review" : undefined,
    profile.file_edits ? "write" : undefined,
    profile.shell ? "shell" : undefined,
    profile.model_discovery ? "models" : undefined,
    profile.local ? "local" : undefined,
  ].filter((tag): tag is string => tag !== undefined);
  return tags.join(",");
}

export function formatAdapterLine(
  detection: AdapterDetection,
  config: OlapConfig = DEFAULT_CONFIG,
): string {
  const profile = adapterCapabilities(config, detection.id);
  const caps = ` capabilities=${capabilityTags(profile) || "none"}`;
  if (detection.detected) {
    return `${detection.id}: detected (${detection.binary})${caps}`;
  }
  return `${detection.id}: not found${caps}`;
}

export async function adaptersCommand(
  pathEnv = process.env.PATH ?? "",
): Promise<AdapterDetection[]> {
  return detectAdapters(pathEnv);
}

export function printAdapters(detections: AdapterDetection[], config: OlapConfig = DEFAULT_CONFIG): void {
  for (const detection of detections) {
    console.log(formatAdapterLine(detection, config));
  }
}
