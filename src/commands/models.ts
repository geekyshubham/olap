import { readConfig } from "../config/read.js";
import { detectAdapters } from "../adapters/detect.js";
import { MODEL_CATALOG, modelsForAdapter } from "../adapters/models.js";
import { canDiscover, discoverModels, toModelInfos } from "../adapters/discover.js";
import type { AdapterId, OlapConfig, RoleId } from "../types.js";

export interface ModelEntry {
  id: string;
  label: string;
  description: string;
  selectedFor: RoleId[];
}

export interface ModelListing {
  adapter: AdapterId;
  detected: boolean;
  source: "cli" | "catalog" | "empty";
  models: ModelEntry[];
}

function selectionFor(config: OlapConfig, adapter: AdapterId, id: string): RoleId[] {
  const roles: RoleId[] = [];
  if (config.roles.orchestrator.adapter === adapter && config.roles.orchestrator.model === id) {
    roles.push("orchestrator");
  }
  if (config.roles.worker.adapter === adapter && config.roles.worker.model === id) {
    roles.push("worker");
  }
  return roles;
}

/** Catalog-only listing (synchronous; no CLI calls). */
export function buildModelListing(config: OlapConfig): ModelListing[] {
  return (Object.keys(MODEL_CATALOG) as AdapterId[]).map((adapter) => ({
    adapter,
    detected: false,
    source: modelsForAdapter(adapter).length > 0 ? ("catalog" as const) : ("empty" as const),
    models: modelsForAdapter(adapter).map((model) => ({
      id: model.id,
      label: model.label,
      description: model.description,
      selectedFor: selectionFor(config, adapter, model.id),
    })),
  }));
}

/** Discover models per adapter from the installed CLI, falling back to the catalog. */
export async function modelsCommand(cwd = process.cwd()): Promise<ModelListing[]> {
  const config = await readConfig(cwd);
  const detections = await detectAdapters();

  const listings = await Promise.all(
    (Object.keys(MODEL_CATALOG) as AdapterId[]).map(async (adapter) => {
      const detection = detections.find((d) => d.id === adapter);
      let source: ModelListing["source"] = modelsForAdapter(adapter).length > 0 ? "catalog" : "empty";
      let infos = modelsForAdapter(adapter);

      if (detection?.detected && detection.binary && canDiscover(adapter)) {
        const discovered = await discoverModels(adapter, detection.binary);
        if (discovered) {
          source = "cli";
          infos = toModelInfos(adapter, discovered);
        }
      }

      return {
        adapter,
        detected: detection?.detected ?? false,
        source,
        models: infos.map((model) => ({
          id: model.id,
          label: model.label,
          description: model.description,
          selectedFor: selectionFor(config, adapter, model.id),
        })),
      } satisfies ModelListing;
    }),
  );

  return listings;
}

export function printModels(listings: ModelListing[]): void {
  for (const listing of listings) {
    const detail =
      listing.source === "cli"
        ? "detected · models from CLI"
        : listing.detected && listing.source === "empty"
          ? "detected · CLI manages its own models"
          : listing.detected
            ? "detected · catalog"
            : "not detected · catalog";
    console.log(`\n${listing.adapter} (${detail})`);
    if (listing.models.length === 0) {
      console.log("  (no preset models — uses the CLI's default)");
      continue;
    }
    for (const model of listing.models) {
      const marker = model.selectedFor.length > 0 ? ` ← ${model.selectedFor.join(", ")}` : "";
      console.log(`  ${model.id.padEnd(24)} ${model.description}${marker}`);
    }
  }
}
