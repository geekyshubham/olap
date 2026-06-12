import { detectAdapters } from "../adapters/detect.js";
import type { AdapterDetection } from "../types.js";

export function formatAdapterLine(detection: AdapterDetection): string {
  if (detection.detected) {
    return `${detection.id}: detected (${detection.binary})`;
  }
  return `${detection.id}: not found`;
}

export async function adaptersCommand(
  pathEnv = process.env.PATH ?? "",
): Promise<AdapterDetection[]> {
  return detectAdapters(pathEnv);
}

export function printAdapters(detections: AdapterDetection[]): void {
  for (const detection of detections) {
    console.log(formatAdapterLine(detection));
  }
}