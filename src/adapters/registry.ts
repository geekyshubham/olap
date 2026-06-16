import type { AdapterId } from "../types.js";

/** Canonical adapter list — keep in sync when adding new CLIs. */
export const ADAPTER_IDS: AdapterId[] = [
  "grok",
  "claude",
  "gemini",
  "codex",
  "kiro",
  "opencode",
  "openrouter",
  "ollama",
];