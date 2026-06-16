import { DEFAULT_STATE, type OrchestratorState } from "../domain/state.js";
import { readJson, writeJson } from "./fs-utils.js";
import type { OlapPaths } from "./paths.js";

export class StateStore {
  constructor(private readonly paths: OlapPaths) {}

  async load(): Promise<OrchestratorState> {
    const stored = await readJson<OrchestratorState>(this.paths.state);
    if (!stored) return { ...DEFAULT_STATE, updated_at: new Date().toISOString() };
    return { ...DEFAULT_STATE, ...stored };
  }

  async save(state: OrchestratorState): Promise<void> {
    state.updated_at = new Date().toISOString();
    await writeJson(this.paths.state, state);
  }
}