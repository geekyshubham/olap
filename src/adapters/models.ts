import type { AdapterId, RoleId } from "../types.js";

export interface ModelInfo {
  /** Model identifier passed to the adapter CLI via its --model flag. */
  id: string;
  /** Short human label for the selection list. */
  label: string;
  /** One-line description shown under the label. */
  description: string;
  /** Roles this model is a good fit for (used to suggest defaults). */
  goodFor: RoleId[];
}

/**
 * Known models per adapter. This is a curated, best-effort catalog used to
 * populate the model-selection UI; it is not exhaustive and never blocks a
 * user from typing a custom model id. Capabilities, not prices, are described.
 */
export const MODEL_CATALOG: Record<AdapterId, ModelInfo[]> = {
  grok: [
    {
      id: "grok-composer-2.5-fast",
      label: "Grok Composer 2.5 Fast",
      description: "Default Grok CLI model; balanced planning and coding.",
      goodFor: ["orchestrator", "worker"],
    },
    {
      id: "grok-build",
      label: "Grok Build",
      description: "Coding-focused Grok CLI model.",
      goodFor: ["worker"],
    },
    {
      id: "grok-4-latest",
      label: "Grok 4 (latest)",
      description: "Strong reasoning; best for planning and review.",
      goodFor: ["orchestrator"],
    },
    {
      id: "grok-4",
      label: "Grok 4",
      description: "Pinned reasoning flagship.",
      goodFor: ["orchestrator"],
    },
    {
      id: "grok-code-fast-1",
      label: "Grok Code Fast",
      description: "Fast, low-latency coding worker.",
      goodFor: ["worker"],
    },
    {
      id: "grok-3",
      label: "Grok 3",
      description: "General purpose, balanced.",
      goodFor: ["orchestrator", "worker"],
    },
    {
      id: "grok-3-mini",
      label: "Grok 3 Mini",
      description: "Cheapest/fastest; light worker tasks.",
      goodFor: ["worker"],
    },
  ],
  claude: [
    {
      id: "opus",
      label: "Claude Opus",
      description: "Deepest reasoning; planning and hard reviews.",
      goodFor: ["orchestrator"],
    },
    {
      id: "sonnet",
      label: "Claude Sonnet",
      description: "Balanced coding and reasoning.",
      goodFor: ["orchestrator", "worker"],
    },
    {
      id: "haiku",
      label: "Claude Haiku",
      description: "Fast, inexpensive worker.",
      goodFor: ["worker"],
    },
  ],
  gemini: [
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      description: "Large-context reasoning and planning.",
      goodFor: ["orchestrator"],
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      description: "Fast worker with large context.",
      goodFor: ["worker"],
    },
    {
      id: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      description: "Lightweight, fast worker.",
      goodFor: ["worker"],
    },
  ],
  codex: [
    {
      id: "gpt-5-codex",
      label: "GPT-5 Codex",
      description: "Agentic coding worker.",
      goodFor: ["orchestrator", "worker"],
    },
    {
      id: "gpt-5",
      label: "GPT-5",
      description: "General reasoning and planning.",
      goodFor: ["orchestrator"],
    },
    {
      id: "o4-mini",
      label: "o4-mini",
      description: "Fast reasoning worker.",
      goodFor: ["worker"],
    },
  ],
  // Kiro manages its own model list (selected via `kiro-cli settings` or `--model`).
  // Left empty so OLAP defers to Kiro's configured default unless you pick one.
  kiro: [],
};

export function modelsForAdapter(adapter: AdapterId): ModelInfo[] {
  return MODEL_CATALOG[adapter] ?? [];
}

export function findModel(adapter: AdapterId, id: string): ModelInfo | undefined {
  return modelsForAdapter(adapter).find((model) => model.id === id);
}

/** Suggested default model for a given adapter + role. */
export function defaultModelFor(adapter: AdapterId, role: RoleId): string {
  const models = modelsForAdapter(adapter);
  const preferred = models.find((model) => model.goodFor.includes(role));
  return preferred?.id ?? models[0]?.id ?? "";
}

/** Models suitable for a role first, then the rest, for ordering selection lists. */
export function modelsForRole(adapter: AdapterId, role: RoleId): ModelInfo[] {
  const models = modelsForAdapter(adapter);
  const suited = models.filter((model) => model.goodFor.includes(role));
  const rest = models.filter((model) => !model.goodFor.includes(role));
  return [...suited, ...rest];
}
