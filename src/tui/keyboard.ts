import { matchesKey } from "@earendil-works/pi-tui";

export interface KeyboardAction {
  type: "quit" | "clear" | "close-overlay";
}

/**
 * Global keys are kept minimal so they never collide with the Editor's own
 * bindings (ctrl+a/e/k/u/w, tab, arrows). Everything else is a slash command.
 */
export function resolveGlobalKey(data: string): KeyboardAction | undefined {
  if (matchesKey(data, "ctrl+c")) return { type: "quit" };
  if (matchesKey(data, "ctrl+l")) return { type: "clear" };
  if (matchesKey(data, "escape")) return { type: "close-overlay" };
  return undefined;
}

export interface SlashCommand {
  name: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show keyboard shortcuts and commands" },
  { name: "settings", description: "Open the settings panel (models, theme, mode, access)" },
  { name: "models", description: "Pick the orchestrator and worker models" },
  { name: "model", description: "Select a model for a role: /model orchestrator|worker" },
  { name: "effort", description: "Set reasoning effort per role (claude/kiro/codex)" },
  { name: "mode", description: "Switch mode: /mode plan|build|workflow" },
  { name: "theme", description: "Switch theme: /theme <name> (no arg cycles)" },
  { name: "access", description: "Open access-control settings (approval, sandbox, network)" },
  { name: "adapters", description: "Show detected coding CLIs on PATH" },
  { name: "usage", description: "Toggle the orchestrator/worker usage panel" },
  { name: "clear", description: "Clear the conversation and metrics" },
  { name: "quit", description: "Exit OLAP" },
];

export const SHORTCUT_HINTS = [
  "Enter run",
  "/settings",
  "/models",
  "/mode",
  "/theme",
  "^L clear",
  "^C quit",
] as const;

export const HELP_LINES = [
  "OLAP — orchestrated loop architect/worker CLI",
  "",
  "The orchestrator plans and reviews; the worker writes the code.",
  "Choose a model for each role, pick a mode, and run a task.",
  "",
  "Commands:",
  "  /settings   Models, theme, mode, access control",
  "  /models     Pick orchestrator + worker models",
  "  /mode       plan · build · workflow",
  "  /theme      Switch color theme",
  "  /access     Approval, sandbox, network, execution",
  "  /adapters   Detected CLIs (grok, claude, gemini, codex)",
  "  /usage      Toggle usage panel",
  "  /clear      Reset the conversation",
  "  /help       This overlay",
  "",
  "Shortcuts:",
  "  Enter       Run the task in the editor",
  "  Ctrl+L      Clear the conversation",
  "  Ctrl+C      Quit",
  "  Escape      Close an overlay",
] as const;

export const MODE_HINTS: Record<string, string> = {
  plan: "orchestrator plans only; workers are not run",
  build: "full architect/worker loop",
  workflow: "full loop with validation gates",
};
